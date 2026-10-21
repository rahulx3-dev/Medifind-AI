const prisma = require('../prisma');
const {
  CLINICAL_SERVICE_TYPES,
  isBookableClinicalService,
  isHighRiskService,
  isObsoleteService
} = require('../utils/serviceCatalogue');

/**
 * 1. GET /api/appointments/services
 * Returns all active, bookable clinical services for patients to browse.
 * Excludes high-risk prohibited and obsolete services.
 */
async function getMarketplaceServices(req, res) {
  try {
    const services = Object.values(CLINICAL_SERVICE_TYPES)
      .filter(s => s.bookable && !s.isProhibited && !s.isObsolete)
      .map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        durationMinutes: s.durationMinutes || 60,
        baseFee: s.baseFee || 200,
        requiresPrescription: Boolean(s.requiresPrescription),
        requiresClinicalVerification: s.requiresClinicalVerification,
        requiredCredential: s.requiredCredential,
        approvedScope: s.approvedScope,
        preparationInfo: s.preparationInfo,
        consentNotice: s.consentNotice,
        disclaimer: s.disclaimer,
        icon: s.icon,
        bookable: s.bookable
      }));

    return res.json({
      success: true,
      count: services.length,
      services
    });
  } catch (err) {
    console.error('getMarketplaceServices error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve healthcare service catalogue.' });
  }
}

/**
 * 2. GET /api/appointments/marketplace
 * Patient-facing discovery endpoint to find approved, eligible healthcare professionals.
 * Server-side checks:
 * 1. User role ASSISTANT
 * 2. assistantType HEALTHCARE_PROFESSIONAL
 * 3. verificationStatus APPROVED
 * 4. isActive === true
 * 5. isAvailable === true
 * 6. Requested service in admin-approved service list
 * 7. Requested service is bookable in catalogue
 * 8. Operating city match (if provided)
 */
async function discoverProfessionals(req, res) {
  try {
    const { serviceType, operatingArea, date } = req.query;

    if (serviceType) {
      if (isHighRiskService(serviceType)) {
        return res.status(400).json({
          success: false,
          error: `Service '${serviceType}' is a prohibited clinical procedure and cannot be booked.`
        });
      }
      if (isObsoleteService(serviceType)) {
        return res.status(400).json({
          success: false,
          error: `Service '${serviceType}' is obsolete and no longer supported.`
        });
      }
      if (!isBookableClinicalService(serviceType)) {
        return res.status(400).json({
          success: false,
          error: `Service '${serviceType}' is not a valid bookable healthcare service.`
        });
      }
    }

    // Query genuine approved professionals from database
    const professionals = await prisma.user.findMany({
      where: {
        role: 'ASSISTANT',
        assistantProfile: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          verificationStatus: 'APPROVED',
          isActive: true,
          isAvailable: true
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        assistantProfile: {
          select: {
            id: true,
            professionTitle: true,
            registrationNumber: true,
            qualifications: true,
            issuingAuthority: true,
            yearsOfExperience: true,
            approvedServices: true,
            operatingCity: true,
            operatingRadiusKm: true,
            workingDays: true,
            workingHoursStart: true,
            workingHoursEnd: true,
            slotDurationMinutes: true,
            serviceFee: true,
            verificationStatus: true,
            isActive: true,
            isAvailable: true
          }
        }
      }
    });

    // Server-side filtering
    const eligibleList = [];

    for (const p of professionals) {
      const profile = p.assistantProfile;
      if (!profile) continue;

      let approvedCategories = [];
      try {
        approvedCategories = profile.approvedServices ? JSON.parse(profile.approvedServices) : [];
      } catch (e) {
        approvedCategories = [];
      }

      // Check if requested service is in approved categories
      if (serviceType && !approvedCategories.includes(serviceType)) {
        continue;
      }

      // Check operating area match (case-insensitive substring)
      if (operatingArea && profile.operatingCity) {
        const areaNormalized = operatingArea.trim().toLowerCase();
        const cityNormalized = profile.operatingCity.trim().toLowerCase();
        if (!cityNormalized.includes(areaNormalized) && !areaNormalized.includes(cityNormalized)) {
          continue;
        }
      }

      // Parse working days
      let workingDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
      try {
        if (profile.workingDays) {
          workingDays = JSON.parse(profile.workingDays);
        }
      } catch (e) {}

      // Calculate service fee
      let calculatedFee = profile.serviceFee;
      if (!calculatedFee && serviceType && CLINICAL_SERVICE_TYPES[serviceType]) {
        calculatedFee = CLINICAL_SERVICE_TYPES[serviceType].baseFee;
      } else if (!calculatedFee) {
        calculatedFee = 250; // default base fee
      }

      eligibleList.push({
        id: p.id,
        name: p.name,
        professionTitle: profile.professionTitle || 'Registered Healthcare Professional',
        qualifications: profile.qualifications || 'Verified Professional Nursing Credentials',
        yearsOfExperience: profile.yearsOfExperience || 0,
        issuingAuthority: profile.issuingAuthority || 'State Nursing & Healthcare Council',
        registrationNumber: profile.registrationNumber || null,
        operatingCity: profile.operatingCity || 'Chengannur',
        approvedServices: approvedCategories,
        workingDays,
        workingHoursStart: profile.workingHoursStart || '09:00',
        workingHoursEnd: profile.workingHoursEnd || '17:00',
        slotDurationMinutes: profile.slotDurationMinutes || 60,
        serviceFee: calculatedFee,
        verificationStatus: 'APPROVED',
        // Authentic rating: only real completed ratings if available, never fabricated
        rating: null,
        reviewCount: 0
      });
    }

    return res.json({
      success: true,
      count: eligibleList.length,
      professionals: eligibleList,
      meta: {
        filterService: serviceType || null,
        filterArea: operatingArea || null,
        message: eligibleList.length === 0
          ? 'No verified healthcare professionals are currently available for the selected criteria. Please check back later or adjust your filters.'
          : null
      }
    });
  } catch (err) {
    console.error('discoverProfessionals error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search for healthcare professionals.' });
  }
}

/**
 * Helper to validate date string YYYY-MM-DD
 */
function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

/**
 * 3. GET /api/appointments/availability/:professionalId
 * Computes actual available time slots for a specific date derived from stored schedule and existing bookings.
 */
async function getProfessionalAvailability(req, res) {
  try {
    const { professionalId } = req.params;
    const { date } = req.query;

    if (!isValidDateString(date)) {
      return res.status(400).json({
        success: false,
        error: 'A valid date in YYYY-MM-DD format is required to check availability.'
      });
    }

    // Verify professional exists and is APPROVED and active
    const professional = await prisma.user.findFirst({
      where: {
        id: professionalId,
        role: 'ASSISTANT',
        assistantProfile: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          verificationStatus: 'APPROVED',
          isActive: true,
          isAvailable: true
        }
      },
      select: {
        id: true,
        name: true,
        assistantProfile: {
          select: {
            professionTitle: true,
            workingDays: true,
            workingHoursStart: true,
            workingHoursEnd: true,
            slotDurationMinutes: true,
            serviceFee: true
          }
        }
      }
    });

    if (!professional || !professional.assistantProfile) {
      return res.status(404).json({
        success: false,
        error: 'Approved healthcare professional not found or currently unavailable.'
      });
    }

    const profile = professional.assistantProfile;

    // Check date against past dates and booking horizon (30 days)
    const targetDate = new Date(`${date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (targetDate < today) {
      return res.status(400).json({
        success: false,
        error: 'Appointments cannot be scheduled for past dates.'
      });
    }

    const maxHorizonDate = new Date(today);
    maxHorizonDate.setDate(maxHorizonDate.getDate() + 30);
    if (targetDate > maxHorizonDate) {
      return res.status(400).json({
        success: false,
        error: 'Appointments can only be scheduled up to 30 days in advance.'
      });
    }

    // Check working days
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const targetDayName = dayNames[targetDate.getDay()];

    let workingDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    try {
      if (profile.workingDays) workingDays = JSON.parse(profile.workingDays);
    } catch (e) {}

    if (!workingDays.includes(targetDayName)) {
      return res.json({
        success: true,
        date,
        dayOfWeek: targetDayName,
        available: false,
        reason: `Professional does not operate on ${targetDayName}s.`,
        slots: []
      });
    }

    // Working hours & slots
    const startHourStr = profile.workingHoursStart || '09:00';
    const endHourStr = profile.workingHoursEnd || '17:00';
    const slotDuration = profile.slotDurationMinutes || 60;

    const [startH, startM] = startHourStr.split(':').map(Number);
    const [endH, endM] = endHourStr.split(':').map(Number);

    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    // Fetch existing active bookings for this professional on that date
    const existingBookings = await prisma.healthcareAppointment.findMany({
      where: {
        professionalId,
        scheduledDate: date,
        status: { in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
      },
      select: {
        id: true,
        timeSlot: true,
        startAt: true,
        endAt: true,
        status: true
      }
    });

    const bookedSlotsSet = new Set(existingBookings.map(b => b.timeSlot));

    // Generate slots
    const slots = [];
    const now = new Date();

    for (let m = startMinutes; m + slotDuration <= endMinutes; m += slotDuration) {
      const slotStartH = String(Math.floor(m / 60)).padStart(2, '0');
      const slotStartM = String(m % 60).padStart(2, '0');
      const slotEndH = String(Math.floor((m + slotDuration) / 60)).padStart(2, '0');
      const slotEndM = String((m + slotDuration) % 60).padStart(2, '0');

      const slotLabel = `${slotStartH}:${slotStartM} - ${slotEndH}:${slotEndM}`;
      const slotStartTime = new Date(`${date}T${slotStartH}:${slotStartM}:00`);
      const slotEndTime = new Date(`${date}T${slotEndH}:${slotEndM}:00`);

      const isBooked = bookedSlotsSet.has(slotLabel);
      const isPast = slotStartTime <= now;

      slots.push({
        timeSlot: slotLabel,
        startAt: slotStartTime.toISOString(),
        endAt: slotEndTime.toISOString(),
        available: !isBooked && !isPast,
        reason: isBooked ? 'Already booked' : isPast ? 'Time slot has passed' : 'Available'
      });
    }

    return res.json({
      success: true,
      date,
      dayOfWeek: targetDayName,
      professional: {
        id: professional.id,
        name: professional.name,
        professionTitle: profile.professionTitle
      },
      workingHours: {
        start: startHourStr,
        end: endHourStr,
        slotDurationMinutes: slotDuration
      },
      slots
    });
  } catch (err) {
    console.error('getProfessionalAvailability error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve professional availability.' });
  }
}

/**
 * 4. POST /api/appointments
 * Request an appointment with an eligible healthcare professional.
 * Enforces server-side eligibility, consent, prescription validation, and concurrency double-booking prevention.
 */
async function createAppointment(req, res) {
  try {
    const patientId = req.user.id;

    // Enforce patient role: only patients may book healthcare appointments
    if (req.user.role !== 'PATIENT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Only patient accounts can request healthcare appointments.'
      });
    }

    const {
      professionalId,
      serviceType,
      scheduledDate,
      timeSlot,
      serviceAddress,
      addressId,
      consentAccepted,
      consentVersion,
      prescriptionId,
      patientNotes
    } = req.body;

    // Validate inputs
    if (!professionalId) {
      return res.status(400).json({ success: false, error: 'Healthcare professional ID is required.' });
    }
    if (patientId === professionalId) {
      return res.status(400).json({ success: false, error: 'Cannot book an appointment with yourself.' });
    }
    if (!serviceType) {
      return res.status(400).json({ success: false, error: 'Requested service type is required.' });
    }
    if (!scheduledDate || !isValidDateString(scheduledDate)) {
      return res.status(400).json({ success: false, error: 'A valid appointment date (YYYY-MM-DD) is required.' });
    }
    if (!timeSlot || typeof timeSlot !== 'string') {
      return res.status(400).json({ success: false, error: 'A valid appointment time slot is required.' });
    }
    if (!serviceAddress || String(serviceAddress).trim().length < 8) {
      return res.status(400).json({ success: false, error: 'A complete service address (at least 8 characters) is required for home nursing visits.' });
    }

    // Verify addressId ownership if provided
    if (addressId) {
      const savedAddr = await prisma.patientAddress.findUnique({ where: { id: addressId } });
      if (!savedAddr || savedAddr.userId !== patientId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: The selected service address does not belong to your account.'
        });
      }
    }

    // 1. Service validation
    if (isHighRiskService(serviceType)) {
      return res.status(400).json({
        success: false,
        error: `Requested procedure '${serviceType}' is a prohibited clinical service and cannot be scheduled.`
      });
    }
    if (isObsoleteService(serviceType)) {
      return res.status(400).json({
        success: false,
        error: `Requested service '${serviceType}' is obsolete and no longer bookable.`
      });
    }
    if (!isBookableClinicalService(serviceType)) {
      return res.status(400).json({
        success: false,
        error: `Requested service '${serviceType}' is not a valid bookable healthcare service.`
      });
    }

    const serviceDef = CLINICAL_SERVICE_TYPES[serviceType];

    // 2. Consent validation
    if (!consentAccepted || consentAccepted !== true) {
      return res.status(400).json({
        success: false,
        error: 'Patient consent acknowledging clinical service boundaries must be accepted before booking.'
      });
    }

    // 3. Prescription gating validation
    if (serviceDef.requiresPrescription) {
      if (!prescriptionId) {
        return res.status(400).json({
          success: false,
          error: `The service '${serviceDef.name}' requires a valid medical prescription or hospital discharge summary.`
        });
      }

      // Check prescription in database
      const prescription = await prisma.prescription.findUnique({
        where: { id: prescriptionId }
      });

      if (!prescription) {
        return res.status(400).json({
          success: false,
          error: 'Provided medical prescription record was not found.'
        });
      }
      if (prescription.userId !== patientId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Provided prescription record does not belong to your patient account.'
        });
      }
      if (prescription.status === 'FAILED' || prescription.screeningStatus === 'POTENTIALLY_SUSPICIOUS') {
        return res.status(400).json({
          success: false,
          error: 'The provided prescription document could not be verified or was flagged as suspicious and cannot be used for this service.'
        });
      }
    }

    // 4. Date validation
    const targetDate = new Date(`${scheduledDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      return res.status(400).json({ success: false, error: 'Appointments cannot be booked for past dates.' });
    }

    const maxHorizonDate = new Date(today);
    maxHorizonDate.setDate(maxHorizonDate.getDate() + 30);
    if (targetDate > maxHorizonDate) {
      return res.status(400).json({
        success: false,
        error: 'Appointments can only be scheduled up to 30 days in advance.'
      });
    }

    // Parse timeSlot: "09:00 - 10:00"
    const slotParts = timeSlot.split('-').map(s => s.trim());
    if (slotParts.length !== 2) {
      return res.status(400).json({ success: false, error: 'Time slot must be in format "HH:MM - HH:MM".' });
    }
    const [startH, startM] = slotParts[0].split(':').map(Number);
    const [endH, endM] = slotParts[1].split(':').map(Number);
    if (
      isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM) ||
      startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
      endH < 0 || endH > 23 || endM < 0 || endM > 59
    ) {
      return res.status(400).json({ success: false, error: 'Invalid time slot format or values.' });
    }

    const slotStartMinutes = startH * 60 + startM;
    const slotEndMinutes = endH * 60 + endM;
    if (slotEndMinutes <= slotStartMinutes) {
      return res.status(400).json({ success: false, error: 'Time slot end time must be after start time.' });
    }

    const startAt = new Date(`${scheduledDate}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`);
    const endAt = new Date(`${scheduledDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`);

    if (startAt <= new Date()) {
      return res.status(400).json({ success: false, error: 'The selected appointment time slot has already passed.' });
    }

    // 5. Professional eligibility validation
    const professional = await prisma.user.findFirst({
      where: {
        id: professionalId,
        role: 'ASSISTANT',
        assistantProfile: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          verificationStatus: 'APPROVED',
          isActive: true,
          isAvailable: true
        }
      },
      include: {
        assistantProfile: true
      }
    });

    if (!professional || !professional.assistantProfile) {
      return res.status(404).json({
        success: false,
        error: 'The selected healthcare professional is either not approved, inactive, or unavailable.'
      });
    }

    const profile = professional.assistantProfile;

    // Check operating day against professional's workingDays
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const targetDayName = dayNames[targetDate.getDay()];

    let workingDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    try {
      if (profile.workingDays) workingDays = JSON.parse(profile.workingDays);
    } catch (e) {}

    if (!workingDays.includes(targetDayName)) {
      return res.status(400).json({
        success: false,
        error: `Professional does not operate on ${targetDayName}s.`
      });
    }

    // Check slot bounds against professional's workingHours
    const profStartHourStr = profile.workingHoursStart || '09:00';
    const profEndHourStr = profile.workingHoursEnd || '17:00';
    const [pStartH, pStartM] = profStartHourStr.split(':').map(Number);
    const [pEndH, pEndM] = profEndHourStr.split(':').map(Number);
    const profStartMinutes = pStartH * 60 + (pStartM || 0);
    const profEndMinutes = pEndH * 60 + (pEndM || 0);

    if (slotStartMinutes < profStartMinutes || slotEndMinutes > profEndMinutes) {
      return res.status(400).json({
        success: false,
        error: `Selected slot is outside the professional's working hours (${profStartHourStr} - ${profEndHourStr}).`
      });
    }

    // Check slot duration matches professional's configured slot duration
    const expectedDuration = profile.slotDurationMinutes || 60;
    const actualDuration = slotEndMinutes - slotStartMinutes;
    if (actualDuration !== expectedDuration) {
      return res.status(400).json({
        success: false,
        error: `Invalid slot duration (${actualDuration}m). Professional requires ${expectedDuration}-minute slots.`
      });
    }

    // Check slot aligns with professional's scheduled slot intervals
    if ((slotStartMinutes - profStartMinutes) % expectedDuration !== 0) {
      return res.status(400).json({
        success: false,
        error: `Selected slot does not align with the professional's scheduled slot intervals (${expectedDuration}m starting at ${profStartHourStr}).`
      });
    }

    // Check professional has approved service
    let approvedCategories = [];
    try {
      approvedCategories = profile.approvedServices ? JSON.parse(profile.approvedServices) : [];
    } catch (e) {
      approvedCategories = [];
    }

    if (!approvedCategories.includes(serviceType)) {
      return res.status(400).json({
        success: false,
        error: `Professional is not authorized by administration to perform '${serviceDef.name}'.`
      });
    }

    // Determine price snapshot
    const feeAmount = profile.serviceFee || serviceDef.baseFee || 250;

    // Concurrency-safe double booking check & creation inside transaction
    const appointmentNumber = `APT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newAppointment = await prisma.$transaction(async (tx) => {
      // Re-verify no active overlapping booking exists (exact timeSlot match OR interval overlap)
      const conflict = await tx.healthcareAppointment.findFirst({
        where: {
          professionalId,
          scheduledDate,
          status: { in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
          OR: [
            { timeSlot },
            {
              AND: [
                { startAt: { lt: endAt } },
                { endAt: { gt: startAt } }
              ]
            }
          ]
        }
      });

      if (conflict) {
        throw new Error('SLOT_CONFLICT');
      }

      // Create appointment
      const created = await tx.healthcareAppointment.create({
        data: {
          appointmentNumber,
          patientId,
          professionalId,
          serviceType,
          status: 'REQUESTED',
          scheduledDate,
          timeSlot,
          startAt,
          endAt,
          serviceAddress: String(serviceAddress).trim(),
          addressId: addressId || null,
          feeAmount,
          currency: 'INR',
          paymentStatus: 'PENDING',
          consentAccepted: true,
          consentAcceptedAt: new Date(),
          consentVersion: consentVersion || 'v1.0',
          prescriptionId: prescriptionId || null,
          patientNotes: patientNotes ? String(patientNotes).trim() : null
        }
      });

      // Record initial audit status history
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: created.id,
          status: 'REQUESTED',
          comment: `Appointment requested by patient for ${serviceDef.name}.`,
          changedById: patientId
        }
      });

      // Send notifications to professional & patient
      await tx.notification.create({
        data: {
          userId: professionalId,
          title: 'New Clinical Appointment Request',
          message: `You have received a new appointment request for ${serviceDef.name} on ${scheduledDate} at ${timeSlot}.`,
          type: 'ASSISTANT',
          linkUrl: `/assistant-portal?tab=appointments`
        }
      });

      await tx.notification.create({
        data: {
          userId: patientId,
          title: 'Appointment Request Submitted',
          message: `Your appointment request for ${serviceDef.name} (${appointmentNumber}) has been submitted and is awaiting confirmation from ${professional.name}.`,
          type: 'INFO',
          linkUrl: `/appointments/${created.id}`
        }
      });

      return created;
    });

    return res.status(201).json({
      success: true,
      message: 'Healthcare appointment requested successfully. Awaiting confirmation by the professional.',
      appointment: {
        id: newAppointment.id,
        appointmentNumber: newAppointment.appointmentNumber,
        serviceType: newAppointment.serviceType,
        serviceName: serviceDef.name,
        status: newAppointment.status,
        scheduledDate: newAppointment.scheduledDate,
        timeSlot: newAppointment.timeSlot,
        feeAmount: newAppointment.feeAmount,
        currency: newAppointment.currency,
        paymentStatus: newAppointment.paymentStatus,
        serviceAddress: newAppointment.serviceAddress,
        professional: {
          id: professional.id,
          name: professional.name,
          professionTitle: profile.professionTitle
        },
        createdAt: newAppointment.createdAt
      }
    });
  } catch (err) {
    if (err.message === 'SLOT_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: 'This time slot is no longer available. Another patient may have just booked it. Please select an alternate slot.'
      });
    }
    console.error('createAppointment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create healthcare appointment.' });
  }
}

/**
 * 5. GET /api/appointments/patient
 * Retrieve appointments belonging to the logged-in patient.
 */
async function getPatientAppointments(req, res) {
  try {
    const patientId = req.user.id;

    const appointments = await prisma.healthcareAppointment.findMany({
      where: { patientId },
      include: {
        professional: {
          select: {
            id: true,
            name: true,
            phone: true,
            assistantProfile: {
              select: {
                professionTitle: true,
                registrationNumber: true,
                operatingCity: true
              }
            }
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = appointments.map(a => {
      const sDef = CLINICAL_SERVICE_TYPES[a.serviceType] || { name: a.serviceType, icon: 'medical_services' };
      return {
        id: a.id,
        appointmentNumber: a.appointmentNumber,
        serviceType: a.serviceType,
        serviceName: sDef.name,
        serviceIcon: sDef.icon,
        status: a.status,
        scheduledDate: a.scheduledDate,
        timeSlot: a.timeSlot,
        feeAmount: a.feeAmount,
        currency: a.currency,
        paymentStatus: a.paymentStatus,
        serviceAddress: a.serviceAddress,
        patientNotes: a.patientNotes,
        rejectionReason: a.rejectionReason,
        cancellationReason: a.cancellationReason,
        professional: {
          id: a.professional.id,
          name: a.professional.name,
          professionTitle: a.professional.assistantProfile?.professionTitle || 'Healthcare Professional',
          phone: a.professional.phone
        },
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      };
    });

    return res.json({
      success: true,
      count: formatted.length,
      appointments: formatted
    });
  } catch (err) {
    console.error('getPatientAppointments error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve patient appointments.' });
  }
}

/**
 * 6. GET /api/appointments/professional
 * Healthcare Professional portal endpoint to view assigned appointments.
 */
async function getProfessionalAppointments(req, res) {
  try {
    const professionalId = req.user.id;

    // Verify user is an approved healthcare professional
    const profile = await prisma.assistantProfile.findUnique({
      where: { userId: professionalId }
    });

    if (!profile || profile.assistantType !== 'HEALTHCARE_PROFESSIONAL' || profile.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        error: 'Access restricted to approved Healthcare Professionals.'
      });
    }

    const appointments = await prisma.healthcareAppointment.findMany({
      where: { professionalId },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        prescription: {
          select: {
            id: true,
            originalFileName: true,
            status: true
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = appointments.map(a => {
      const sDef = CLINICAL_SERVICE_TYPES[a.serviceType] || { name: a.serviceType, icon: 'medical_services' };
      return {
        id: a.id,
        appointmentNumber: a.appointmentNumber,
        serviceType: a.serviceType,
        serviceName: sDef.name,
        serviceIcon: sDef.icon,
        status: a.status,
        scheduledDate: a.scheduledDate,
        timeSlot: a.timeSlot,
        feeAmount: a.feeAmount,
        currency: a.currency,
        paymentStatus: a.paymentStatus,
        serviceAddress: (a.status === 'REJECTED' || a.status === 'CANCELLED')
          ? '[REDACTED: Not required for non-active appointment]'
          : a.serviceAddress,
        patientNotes: a.patientNotes,
        rejectionReason: a.rejectionReason,
        cancellationReason: a.cancellationReason,
        consentAccepted: a.consentAccepted,
        consentAcceptedAt: a.consentAcceptedAt,
        prescription: a.prescription ? {
          id: a.prescription.id,
          originalFileName: a.prescription.originalFileName,
          status: a.prescription.status
        } : null,
        patient: {
          id: a.patient.id,
          name: a.patient.name,
          phone: a.patient.phone
        },
        statusHistory: a.statusHistory,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      };
    });

    return res.json({
      success: true,
      count: formatted.length,
      appointments: formatted
    });
  } catch (err) {
    console.error('getProfessionalAppointments error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve professional appointments.' });
  }
}

/**
 * 7. GET /api/appointments/:id
 * Retrieve single appointment details with strict access control and address privacy.
 */
async function getAppointmentById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const appointment = await prisma.healthcareAppointment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        professional: {
          select: {
            id: true,
            name: true,
            phone: true,
            assistantProfile: {
              select: {
                professionTitle: true,
                registrationNumber: true,
                issuingAuthority: true,
                operatingCity: true
              }
            }
          }
        },
        prescription: {
          select: {
            id: true,
            originalFileName: true,
            status: true
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }

    // Access control: Patient who owns the booking, assigned professional, or ADMIN
    const isPatient = appointment.patientId === userId;
    const isAssignedProfessional = appointment.professionalId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isPatient && !isAssignedProfessional && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You are not authorized to view this appointment.'
      });
    }

    const sDef = CLINICAL_SERVICE_TYPES[appointment.serviceType] || {
      name: appointment.serviceType,
      preparationInfo: 'Standard clinical preparation.',
      consentNotice: 'Standard patient consent.',
      icon: 'medical_services'
    };

    let displayAddress = appointment.serviceAddress;
    if (isAssignedProfessional && !isPatient && !isAdmin) {
      if (appointment.status === 'REJECTED' || appointment.status === 'CANCELLED') {
        displayAddress = '[REDACTED: Not required for non-active appointment]';
      }
    }

    return res.json({
      success: true,
      appointment: {
        id: appointment.id,
        appointmentNumber: appointment.appointmentNumber,
        serviceType: appointment.serviceType,
        serviceName: sDef.name,
        serviceIcon: sDef.icon,
        preparationInfo: sDef.preparationInfo,
        consentNotice: sDef.consentNotice,
        status: appointment.status,
        scheduledDate: appointment.scheduledDate,
        timeSlot: appointment.timeSlot,
        feeAmount: appointment.feeAmount,
        currency: appointment.currency,
        paymentStatus: appointment.paymentStatus,
        serviceAddress: displayAddress,
        patientNotes: appointment.patientNotes,
        rejectionReason: appointment.rejectionReason,
        cancellationReason: appointment.cancellationReason,
        consentAccepted: appointment.consentAccepted,
        consentAcceptedAt: appointment.consentAcceptedAt,
        prescription: appointment.prescription ? {
          id: appointment.prescription.id,
          originalFileName: appointment.prescription.originalFileName,
          status: appointment.prescription.status
        } : null,
        patient: {
          id: appointment.patient.id,
          name: appointment.patient.name,
          phone: isAssignedProfessional || isPatient || isAdmin ? appointment.patient.phone : null
        },
        professional: {
          id: appointment.professional.id,
          name: appointment.professional.name,
          professionTitle: appointment.professional.assistantProfile?.professionTitle,
          registrationNumber: appointment.professional.assistantProfile?.registrationNumber,
          phone: appointment.professional.phone
        },
        statusHistory: appointment.statusHistory,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt
      }
    });
  } catch (err) {
    console.error('getAppointmentById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve appointment details.' });
  }
}

/**
 * 8. PATCH /api/appointments/:id/status
 * Handle appointment status lifecycle transitions.
 * Lifecycle:
 * REQUESTED -> ACCEPTED -> IN_PROGRESS -> COMPLETED
 * Alternative:
 * REQUESTED -> REJECTED (by professional, requires rejectionReason)
 * REQUESTED -> CANCELLED (by patient or professional, requires reason)
 * ACCEPTED  -> CANCELLED (by patient or professional, requires reason)
 */
async function updateAppointmentStatus(req, res) {
  try {
    const { id } = req.params;
    const { action, reason, comment } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!action) {
      return res.status(400).json({ success: false, error: 'Action is required.' });
    }

    const appointment = await prisma.healthcareAppointment.findUnique({
      where: { id },
      include: {
        patient: true,
        professional: true
      }
    });

    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }

    const currentStatus = appointment.status;
    const isPatient = appointment.patientId === userId;
    const isProfessional = appointment.professionalId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isPatient && !isProfessional && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You are not authorized to update this appointment.'
      });
    }

    // Terminal states check
    if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        error: `Cannot modify appointment: Appointment is already in terminal state '${currentStatus}'.`
      });
    }

    let nextStatus = null;
    let statusComment = comment || null;
    let rejectionReason = null;
    let cancellationReason = null;

    switch (action.toUpperCase()) {
      case 'ACCEPT': {
        if (!isProfessional && !isAdmin) {
          return res.status(403).json({ success: false, error: 'Only the assigned healthcare professional can accept this appointment.' });
        }
        if (currentStatus !== 'REQUESTED') {
          return res.status(400).json({ success: false, error: `Cannot accept appointment in status '${currentStatus}'. Must be 'REQUESTED'.` });
        }
        nextStatus = 'ACCEPTED';
        statusComment = statusComment || 'Appointment accepted by professional.';
        break;
      }

      case 'REJECT': {
        if (!isProfessional && !isAdmin) {
          return res.status(403).json({ success: false, error: 'Only the assigned healthcare professional can reject this appointment.' });
        }
        if (currentStatus !== 'REQUESTED') {
          return res.status(400).json({ success: false, error: `Cannot reject appointment in status '${currentStatus}'. Must be 'REQUESTED'.` });
        }
        if (!reason || !String(reason).trim()) {
          return res.status(400).json({ success: false, error: 'A rejection reason is required.' });
        }
        nextStatus = 'REJECTED';
        rejectionReason = String(reason).trim();
        statusComment = statusComment || `Appointment declined by professional: ${rejectionReason}`;
        break;
      }

      case 'START':
      case 'IN_PROGRESS': {
        if (!isProfessional && !isAdmin) {
          return res.status(403).json({ success: false, error: 'Only the assigned healthcare professional can start the appointment.' });
        }
        if (currentStatus !== 'ACCEPTED') {
          return res.status(400).json({ success: false, error: `Cannot start appointment in status '${currentStatus}'. Must be 'ACCEPTED'.` });
        }
        nextStatus = 'IN_PROGRESS';
        statusComment = statusComment || 'Clinical visit started by professional.';
        break;
      }

      case 'COMPLETE': {
        if (!isProfessional && !isAdmin) {
          return res.status(403).json({ success: false, error: 'Only the assigned healthcare professional can complete the clinical appointment.' });
        }
        if (currentStatus !== 'IN_PROGRESS') {
          return res.status(400).json({ success: false, error: `Cannot complete appointment in status '${currentStatus}'. Must be 'IN_PROGRESS'.` });
        }
        nextStatus = 'COMPLETED';
        statusComment = statusComment || 'Clinical visit completed successfully.';
        break;
      }

      case 'CANCEL': {
        if (currentStatus !== 'REQUESTED' && currentStatus !== 'ACCEPTED') {
          return res.status(400).json({ success: false, error: `Cannot cancel appointment in status '${currentStatus}'.` });
        }
        if (!reason || !String(reason).trim()) {
          return res.status(400).json({ success: false, error: 'A cancellation reason is required.' });
        }
        nextStatus = 'CANCELLED';
        cancellationReason = String(reason).trim();
        statusComment = statusComment || `Appointment cancelled by ${isPatient ? 'patient' : 'professional'}: ${cancellationReason}`;
        break;
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown action '${action}'. Allowed: ACCEPT, REJECT, START, COMPLETE, CANCEL.` });
    }

    // Persist status change inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      const apt = await tx.healthcareAppointment.update({
        where: { id },
        data: {
          status: nextStatus,
          rejectionReason: rejectionReason || appointment.rejectionReason,
          cancellationReason: cancellationReason || appointment.cancellationReason
        }
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: id,
          status: nextStatus,
          comment: statusComment,
          changedById: userId
        }
      });

      // Send notifications to appropriate parties
      if (isAdmin) {
        await tx.notification.create({
          data: {
            userId: appointment.patientId,
            title: `Appointment ${nextStatus} by Administrator`,
            message: `Appointment ${appointment.appointmentNumber} has been updated to ${nextStatus} by administration.`,
            type: 'INFO',
            linkUrl: `/appointments/${id}`
          }
        });
        await tx.notification.create({
          data: {
            userId: appointment.professionalId,
            title: `Appointment ${nextStatus} by Administrator`,
            message: `Appointment ${appointment.appointmentNumber} has been updated to ${nextStatus} by administration.`,
            type: 'ASSISTANT',
            linkUrl: `/assistant-portal?tab=appointments`
          }
        });
      } else {
        const notifyUserId = isPatient ? appointment.professionalId : appointment.patientId;
        const notifyTitle = `Appointment ${nextStatus}`;
        const notifyMessage = `Appointment ${appointment.appointmentNumber} has been updated to ${nextStatus}.`;

        await tx.notification.create({
          data: {
            userId: notifyUserId,
            title: notifyTitle,
            message: notifyMessage,
            type: isPatient ? 'ASSISTANT' : 'INFO',
            linkUrl: isPatient ? `/assistant-portal?tab=appointments` : `/appointments/${id}`
          }
        });
      }

      return apt;
    });

    return res.json({
      success: true,
      message: `Appointment successfully updated to ${nextStatus}.`,
      appointment: {
        id: updated.id,
        appointmentNumber: updated.appointmentNumber,
        status: updated.status,
        rejectionReason: updated.rejectionReason,
        cancellationReason: updated.cancellationReason,
        updatedAt: updated.updatedAt
      }
    });
  } catch (err) {
    console.error('updateAppointmentStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update appointment status.' });
  }
}

/**
 * 9. PUT /api/appointments/professional/schedule
 * Healthcare Professional manages their working schedule and fee.
 */
async function updateProfessionalSchedule(req, res) {
  try {
    const professionalId = req.user.id;
    const { workingDays, workingHoursStart, workingHoursEnd, slotDurationMinutes, serviceFee } = req.body;

    const profile = await prisma.assistantProfile.findUnique({
      where: { userId: professionalId }
    });

    if (!profile || profile.assistantType !== 'HEALTHCARE_PROFESSIONAL') {
      return res.status(403).json({
        success: false,
        error: 'Only Healthcare Professionals can configure clinical scheduling.'
      });
    }

    const updateData = {};

    if (workingDays) {
      if (!Array.isArray(workingDays) || workingDays.length === 0) {
        return res.status(400).json({ success: false, error: 'workingDays must be a non-empty array of days.' });
      }
      const validDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      for (const d of workingDays) {
        if (!validDays.includes(String(d).toUpperCase())) {
          return res.status(400).json({ success: false, error: `Invalid day '${d}'. Allowed: ${validDays.join(', ')}` });
        }
      }
      updateData.workingDays = JSON.stringify(workingDays.map(d => String(d).toUpperCase()));
    }

    if (workingHoursStart) {
      if (!workingHoursStart.match(/^\d{2}:\d{2}$/)) {
        return res.status(400).json({ success: false, error: 'workingHoursStart must be in HH:MM format.' });
      }
      updateData.workingHoursStart = workingHoursStart;
    }

    if (workingHoursEnd) {
      if (!workingHoursEnd.match(/^\d{2}:\d{2}$/)) {
        return res.status(400).json({ success: false, error: 'workingHoursEnd must be in HH:MM format.' });
      }
      updateData.workingHoursEnd = workingHoursEnd;
    }

    // Strict 24-hour time range validation & ensure start < end
    const effectiveStart = updateData.workingHoursStart || profile.workingHoursStart || '09:00';
    const effectiveEnd = updateData.workingHoursEnd || profile.workingHoursEnd || '17:00';
    const [sH, sM] = effectiveStart.split(':').map(Number);
    const [eH, eM] = effectiveEnd.split(':').map(Number);
    if (
      isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM) ||
      sH < 0 || sH > 23 || sM < 0 || sM > 59 ||
      eH < 0 || eH > 23 || eM < 0 || eM > 59
    ) {
      return res.status(400).json({ success: false, error: 'Working hours must have valid 24-hour time values (00:00 - 23:59).' });
    }
    const startTotalMin = sH * 60 + sM;
    const endTotalMin = eH * 60 + eM;
    if (startTotalMin >= endTotalMin) {
      return res.status(400).json({ success: false, error: 'Working hours start time must be before end time.' });
    }

    // Verify whether schedule changes conflict with existing active bookings
    const todayStr = new Date().toISOString().slice(0, 10);
    const activeFutureBookings = await prisma.healthcareAppointment.findMany({
      where: {
        professionalId,
        scheduledDate: { gte: todayStr },
        status: { in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
      }
    });

    if (activeFutureBookings.length > 0) {
      // 1. Check if any active booking falls on a removed working day
      if (workingDays) {
        const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        const newDaysUpper = workingDays.map(d => String(d).toUpperCase());
        for (const b of activeFutureBookings) {
          const bDate = new Date(`${b.scheduledDate}T00:00:00`);
          const bDay = dayNames[bDate.getDay()];
          if (!newDaysUpper.includes(bDay)) {
            return res.status(409).json({
              success: false,
              error: `Cannot remove ${bDay} from working days: You have an existing active appointment (${b.appointmentNumber}) scheduled on ${b.scheduledDate}.`
            });
          }
        }
      }

      // 2. Check if any active booking falls outside new working hours
      if (workingHoursStart || workingHoursEnd) {
        for (const b of activeFutureBookings) {
          const parts = b.timeSlot.split('-').map(s => s.trim());
          if (parts.length === 2) {
            const [bsh, bsm] = parts[0].split(':').map(Number);
            const [beh, bem] = parts[1].split(':').map(Number);
            const bStartMin = bsh * 60 + bsm;
            const bEndMin = beh * 60 + bem;
            if (bStartMin < startTotalMin || bEndMin > endTotalMin) {
              return res.status(409).json({
                success: false,
                error: `New working hours (${effectiveStart} - ${effectiveEnd}) conflict with existing active appointment (${b.appointmentNumber}) at ${b.timeSlot} on ${b.scheduledDate}.`
              });
            }
          }
        }
      }
    }

    if (slotDurationMinutes !== undefined) {
      const dur = parseInt(slotDurationMinutes, 10);
      if (isNaN(dur) || dur < 15 || dur > 240) {
        return res.status(400).json({ success: false, error: 'slotDurationMinutes must be between 15 and 240 minutes.' });
      }
      updateData.slotDurationMinutes = dur;
    }

    if (serviceFee !== undefined) {
      const fee = parseFloat(serviceFee);
      if (isNaN(fee) || fee < 0 || fee > 10000) {
        return res.status(400).json({ success: false, error: 'serviceFee must be a valid amount between 0 and 10000 INR.' });
      }
      updateData.serviceFee = fee;
    }

    const updatedProfile = await prisma.assistantProfile.update({
      where: { userId: professionalId },
      data: updateData
    });

    let parsedDays = [];
    try {
      parsedDays = updatedProfile.workingDays ? JSON.parse(updatedProfile.workingDays) : [];
    } catch (e) {}

    return res.json({
      success: true,
      message: 'Professional schedule updated successfully.',
      schedule: {
        workingDays: parsedDays,
        workingHoursStart: updatedProfile.workingHoursStart,
        workingHoursEnd: updatedProfile.workingHoursEnd,
        slotDurationMinutes: updatedProfile.slotDurationMinutes,
        serviceFee: updatedProfile.serviceFee
      }
    });
  } catch (err) {
    console.error('updateProfessionalSchedule error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update professional schedule.' });
  }
}

/**
 * 10. GET /api/appointments/admin/all
 * Administrator overview of all healthcare appointments.
 */
async function getAdminAppointments(req, res) {
  try {
    const { status, serviceType, professionalId } = req.query;

    const where = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;
    if (professionalId) where.professionalId = professionalId;

    const appointments = await prisma.healthcareAppointment.findMany({
      where,
      include: {
        patient: {
          select: { id: true, name: true, phone: true }
        },
        professional: {
          select: {
            id: true,
            name: true,
            phone: true,
            assistantProfile: {
              select: { professionTitle: true, verificationStatus: true, operatingCity: true }
            }
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (err) {
    console.error('getAdminAppointments error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve admin appointments.' });
  }
}

module.exports = {
  getMarketplaceServices,
  discoverProfessionals,
  getProfessionalAvailability,
  createAppointment,
  getPatientAppointments,
  getProfessionalAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  updateProfessionalSchedule,
  getAdminAppointments
};
