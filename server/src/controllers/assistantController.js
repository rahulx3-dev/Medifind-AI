const prisma = require('../prisma');

// Canonical 8 non-clinical assistant service types
const VALID_ASSISTANT_SERVICE_TYPES = [
  'MEDICINE_COLLECTION',
  'PHARMACY_VISIT',
  'PHARMACY_COMPANION',
  'MEDICINE_DELIVERY',
  'DIGITAL_ASSISTANCE',
  'PHARMACY_COMMS',
  'RESTOCK_ASSISTANCE',
  'PRESCRIPTION_ASSISTANCE'
];

/**
 * Assistant Clinical-Data Isolation Helper
 * Ensures no prescription images, prescription IDs, or clinical diagnostics are leaked to assistants.
 * Strips sensitive clinical references and handover PIN from task/order payloads.
 */
function sanitizeTaskForAssistant(task, { includeHandoverPin = false, isAssigned = false } = {}) {
  if (!task) return null;
  const clone = { ...task };

  if (!includeHandoverPin) {
    delete clone.handoverPin;
  }

  const NON_ADDRESS_SERVICE_TYPES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'];
  const isNonAddressService = NON_ADDRESS_SERVICE_TYPES.includes(clone.serviceType);

  // Address privacy: Do not expose patient addresses to assistants until a task is actually assigned/authorized,
  // and never expose delivery address for non-address services (digital assistance, comms, etc.)
  if (!isAssigned || isNonAddressService) {
    delete clone.deliveryAddress;
    if (clone.order) {
      const orderClone = { ...clone.order };
      delete orderClone.deliveryAddress;
      delete orderClone.addressId;
      delete orderClone.address;
      clone.order = orderClone;
    }
  }

  // Clinical isolation: assistants do not have access to prescription IDs, documents, or diagnostics
  delete clone.prescriptionId;
  delete clone.prescription;
  delete clone.detectedMedicines;
  delete clone.verificationPin;

  if (clone.order) {
    const orderClone = { ...clone.order };
    delete orderClone.prescriptionId;
    delete orderClone.prescription;
    delete orderClone.detectedMedicines;
    delete orderClone.verificationPin;
    clone.order = orderClone;
  }

  return clone;
}

/**
 * Parse capabilities string (stored as comma-delimited or JSON string) into a canonical string array.
 */
function parseCapabilities(capabilitiesStr) {
  if (!capabilitiesStr) return [];
  if (Array.isArray(capabilitiesStr)) return capabilitiesStr.map(s => String(s).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(capabilitiesStr);
    if (Array.isArray(parsed)) return parsed.map(s => String(s).trim()).filter(Boolean);
  } catch (e) {}
  return String(capabilitiesStr).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Helper to get or auto-initialize an AssistantProfile record for a user.
 * Default capability assignment: empty array (assistant must explicitly select supported services).
 */
async function getOrCreateAssistantProfile(userId) {
  let profile = await prisma.assistantProfile.findUnique({
    where: { userId }
  });

  if (!profile) {
    profile = await prisma.assistantProfile.create({
      data: {
        userId,
        isActive: true,
        isAvailable: true,
        capabilities: ''
      }
    });
  }

  return profile;
}

/**
 * Service-aware progress wording generator.
 * Only MEDICINE_DELIVERY is permitted to use explicit delivery/drop-off wording.
 * Non-delivery services use non-delivery terminology (Initiated, In Progress, Concluded, Completed).
 */
function getServiceProgressDetails(serviceType, status, pharmacyName, assistantName) {
  const isDelivery = serviceType === 'MEDICINE_DELIVERY';
  const isCollection = serviceType === 'MEDICINE_COLLECTION';

  let historyComment = `Assistant ${assistantName} updated service to ${status}.`;
  let notifTitle = 'Service Progress Update';
  let notifMsg = `Your medicine access service is now in state: ${status}.`;

  if (status === 'COLLECTING') {
    if (isDelivery || isCollection) {
      historyComment = `Assistant ${assistantName} arrived at pharmacy to collect medicine.`;
      notifTitle = 'Medicine Collection Underway';
      notifMsg = `Assistant has arrived at ${pharmacyName} to collect your reserved medication.`;
    } else {
      historyComment = `Assistant ${assistantName} initiated assistance task.`;
      notifTitle = 'Service Assistance Started';
      notifMsg = `Assistant has begun your requested assistance service.`;
    }
  } else if (status === 'IN_TRANSIT') {
    if (isDelivery) {
      historyComment = `Medicine collected by ${assistantName}. In transit to patient delivery address.`;
      notifTitle = 'Medicines In Transit';
      notifMsg = `Your medicines are on the way. Keep your 4-digit verification PIN handy.`;
    } else if (isCollection) {
      historyComment = `Medicine collected by ${assistantName}. Ready for handover.`;
      notifTitle = 'Medicine Ready for Handover';
      notifMsg = `Your medicine has been collected from ${pharmacyName} and is ready for handover.`;
    } else {
      historyComment = `Assistant ${assistantName} is actively performing assistance service.`;
      notifTitle = 'Service In Progress';
      notifMsg = `Your assistance service is actively in progress.`;
    }
  } else if (status === 'DELIVERED') {
    if (isDelivery) {
      historyComment = `Assistant ${assistantName} arrived at destination for delivery. Awaiting recipient PIN.`;
      notifTitle = 'Assistant Arrived at Delivery Address';
      notifMsg = `Your assistant has arrived with your medicines. Please provide your 4-digit PIN to confirm delivery.`;
    } else if (isCollection) {
      historyComment = `Assistant ${assistantName} ready for handover. Awaiting recipient PIN.`;
      notifTitle = 'Ready for Handover';
      notifMsg = `Your assistant is ready to hand over your medicines. Please provide your 4-digit PIN to verify.`;
    } else {
      historyComment = `Assistant ${assistantName} finished service. Awaiting patient confirmation PIN.`;
      notifTitle = 'Service Ready for Confirmation';
      notifMsg = `Assistance has been rendered. Please provide your 4-digit PIN to confirm completion.`;
    }
  } else if (status === 'CONFIRMED') {
    if (isDelivery) {
      historyComment = `Delivery handover confirmed with PIN. Package successfully delivered.`;
      notifTitle = 'Medicine Delivery Confirmed';
      notifMsg = `Medicine package successfully delivered and verified. Thank you for using MediFind AI!`;
    } else if (isCollection) {
      historyComment = `Medicine handover confirmed with PIN. Medicines received.`;
      notifTitle = 'Medicine Collection Confirmed';
      notifMsg = `Medicine collection successfully confirmed and verified. Thank you for using MediFind AI!`;
    } else {
      historyComment = `Service task confirmed with PIN. Assistance successfully completed.`;
      notifTitle = 'Service Handover Complete';
      notifMsg = `Medicine access assistance successfully completed. Thank you for using MediFind AI!`;
    }
  }

  return { historyComment, notifTitle, notifMsg };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assistant/profile
/**
 * Helper to format assistant profile response with Phase 1 fields
 */
function formatProfileResponse(profile, user) {
  const capabilities = parseCapabilities(profile.capabilities);
  let parsedServiceAreas = [];
  if (profile.serviceAreasApplied) {
    try {
      parsedServiceAreas = JSON.parse(profile.serviceAreasApplied);
    } catch (e) {
      parsedServiceAreas = String(profile.serviceAreasApplied).split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return {
    id: profile.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    bio: profile.bio || '',
    isActive: profile.isActive,
    isAvailable: profile.isAvailable,
    capabilities,
    supportedServiceTypes: VALID_ASSISTANT_SERVICE_TYPES,
    // Phase 1 Role Selection & Onboarding Foundation
    assistantType: profile.assistantType || null,
    onboardingCompleted: Boolean(profile.onboardingCompleted),
    onboardingStep: profile.onboardingStep || (profile.assistantType ? 'COMPLETED' : 'ROLE_SELECTION'),
    // Delivery Assistant Profile
    operatingCity: profile.operatingCity || null,
    operatingRadiusKm: profile.operatingRadiusKm != null ? profile.operatingRadiusKm : null,
    vehicleType: profile.vehicleType || null,
    maxActiveTasks: profile.maxActiveTasks || 2,
    // Healthcare Professional Foundation & Phase 2 Verification Lifecycle
    professionTitle: profile.professionTitle || null,
    registrationNumber: profile.registrationNumber || null,
    qualifications: profile.qualifications || null,
    issuingAuthority: profile.issuingAuthority || null,
    yearsOfExperience: profile.yearsOfExperience != null ? profile.yearsOfExperience : null,
    declarationAccepted: Boolean(profile.declarationAccepted),
    declarationAcceptedAt: profile.declarationAcceptedAt || null,
    serviceAreasApplied: parsedServiceAreas,
    approvedServices: profile.approvedServices ? parseCapabilities(profile.approvedServices) : [],
    verificationStatus: profile.verificationStatus || 'NOT_SUBMITTED',
    verificationNotes: profile.verificationNotes || null,
    rejectionReason: profile.rejectionReason || null,
    correctionReason: profile.correctionReason || null,
    suspensionReason: profile.suspensionReason || null,
    submittedAt: profile.submittedAt || null,
    reviewedAt: profile.reviewedAt || null,
    reviewedById: profile.reviewedById || null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assistant/profile
// Retrieves current assistant profile, active/available status, and supported capabilities
// ─────────────────────────────────────────────────────────────────────────────
async function getAssistantProfile(req, res) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, role: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.role !== 'ASSISTANT' && user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only registered assistants can view an assistant profile.' });
    }

    const profile = await getOrCreateAssistantProfile(userId);

    return res.json({
      success: true,
      profile: formatProfileResponse(profile, user)
    });
  } catch (err) {
    console.error('getAssistantProfile error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve assistant profile.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assistant/role-selection
// Mandatory First-Time Role Selection:
// - DELIVERY_ASSISTANT: Medicine collection and delivery assistant
// - HEALTHCARE_PROFESSIONAL: Qualified healthcare professional applicant
// ─────────────────────────────────────────────────────────────────────────────
async function selectAssistantRole(req, res) {
  try {
    const userId = req.user.id;
    const assistantType = req.body.assistantType || req.body.role;

    if (!assistantType || !['DELIVERY_ASSISTANT', 'HEALTHCARE_PROFESSIONAL'].includes(assistantType)) {
      return res.status(400).json({
        success: false,
        error: "Invalid assistant role selection. Must be either 'DELIVERY_ASSISTANT' or 'HEALTHCARE_PROFESSIONAL'."
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, role: true }
    });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.role !== 'ASSISTANT' && user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only registered assistants can select an assistant track.' });
    }

    const profile = await getOrCreateAssistantProfile(userId);

    // Suspension check: Suspended assistants cannot change role
    if (profile.verificationStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: `Unauthorized: Assistant account is SUSPENDED (${profile.suspensionReason || 'Administrator suspension in effect'}). Cannot modify role selection.`
      });
    }

    // Prevent duplicate submission if user has already completed onboarding with this role
    if (profile.onboardingCompleted && profile.assistantType === assistantType) {
      return res.json({
        success: true,
        message: 'Role already configured.',
        profile: formatProfileResponse(profile, user)
      });
    }

    // Role-specific setup
    const updateData = {
      assistantType,
      updatedAt: new Date()
    };

    if (assistantType === 'DELIVERY_ASSISTANT') {
      updateData.onboardingCompleted = false;
      updateData.onboardingStep = 'DELIVERY_SETUP';
      updateData.verificationStatus = 'PENDING';
      // Default delivery capabilities if none configured
      if (!profile.capabilities || profile.capabilities.trim() === '') {
        updateData.capabilities = 'MEDICINE_DELIVERY,MEDICINE_COLLECTION';
      }
    } else {
      // Healthcare Professional path:
      // Begins onboarding foundation with default PENDING verification status
      updateData.onboardingStep = 'PROFESSIONAL_APPLICATION';
      updateData.verificationStatus = 'PENDING';
      updateData.onboardingCompleted = false;
      // Clinical tasks require approved credentials; delivery capabilities are empty
      updateData.capabilities = '';
    }

    const updated = await prisma.assistantProfile.update({
      where: { id: profile.id },
      data: updateData
    });

    return res.json({
      success: true,
      message: assistantType === 'DELIVERY_ASSISTANT'
        ? 'Successfully registered as Delivery Assistant.'
        : 'Healthcare Professional track initiated. Please complete your professional application.',
      profile: formatProfileResponse(updated, user)
    });
  } catch (err) {
    console.error('selectAssistantRole error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process role selection.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/assistant/delivery-profile
// Updates delivery assistant operational profile (operating city, radius, vehicle, availability).
// ─────────────────────────────────────────────────────────────────────────────
async function updateDeliveryProfile(req, res) {
  try {
    const userId = req.user.id;
    const { name, phone, bio, operatingCity, operatingRadiusKm, vehicleType, isAvailable, isActive } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const profile = await getOrCreateAssistantProfile(userId);
    if (profile.assistantType !== 'DELIVERY_ASSISTANT' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Delivery profile settings only apply to Delivery Assistants.'
      });
    }

    const VALID_VEHICLES = ['BICYCLE', 'MOTORCYCLE', 'SCOOTER', 'CAR', 'ON_FOOT'];
    if (vehicleType && !VALID_VEHICLES.includes(vehicleType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid vehicle type. Must be one of: ${VALID_VEHICLES.join(', ')}`
      });
    }

    let parsedRadius = profile.operatingRadiusKm;
    if (operatingRadiusKm !== undefined) {
      const num = parseFloat(operatingRadiusKm);
      if (isNaN(num) || num <= 0 || num > 50) {
        return res.status(400).json({ success: false, error: 'Operating radius must be between 1 and 50 km.' });
      }
      parsedRadius = num;
    }

    // Update user name/phone if provided
    const userUpdate = {};
    if (name && typeof name === 'string' && name.trim()) userUpdate.name = name.trim();
    if (phone !== undefined) userUpdate.phone = phone ? phone.trim() : null;
    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdate });
    }

    const profileUpdate = {
      onboardingCompleted: true,
      onboardingStep: 'COMPLETED'
    };
    if (profile.verificationStatus !== 'APPROVED') {
      profileUpdate.verificationStatus = 'PENDING';
      profileUpdate.submittedAt = profile.submittedAt || new Date();
    }
    if (bio !== undefined) profileUpdate.bio = bio ? String(bio).trim() : null;
    if (operatingCity !== undefined) profileUpdate.operatingCity = String(operatingCity).trim();
    if (operatingRadiusKm !== undefined) profileUpdate.operatingRadiusKm = parsedRadius;
    if (vehicleType !== undefined) profileUpdate.vehicleType = vehicleType;
    if (isAvailable !== undefined) profileUpdate.isAvailable = Boolean(isAvailable);
    if (isActive !== undefined) profileUpdate.isActive = Boolean(isActive);

    const updated = await prisma.assistantProfile.update({
      where: { id: profile.id },
      data: profileUpdate,
      include: { user: true }
    });

    return res.json({
      success: true,
      message: 'Delivery profile updated successfully.',
      profile: formatProfileResponse(updated, updated.user)
    });
  } catch (err) {
    console.error('updateDeliveryProfile error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update delivery profile.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assistant/professional-application
// Submits healthcare professional application foundation.
// Default status: PENDING. Does NOT grant clinical permissions or mark user as verified.
// ─────────────────────────────────────────────────────────────────────────────
async function submitProfessionalApplication(req, res) {
  try {
    const userId = req.user.id;
    const { professionTitle, registrationNumber, qualifications, serviceAreasApplied, bio } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const profile = await getOrCreateAssistantProfile(userId);
    if (profile.assistantType !== 'HEALTHCARE_PROFESSIONAL' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Professional application can only be submitted for Healthcare Professional role.'
      });
    }

    if (!professionTitle || !professionTitle.trim()) {
      return res.status(400).json({ success: false, error: 'Professional title or category is required.' });
    }
    if (!registrationNumber || !registrationNumber.trim()) {
      return res.status(400).json({ success: false, error: 'Professional registration or council license number is required.' });
    }
    if (!qualifications || !qualifications.trim()) {
      return res.status(400).json({ success: false, error: 'Relevant qualifications summary is required.' });
    }

    const { FUTURE_CLINICAL_SERVICE_TYPES } = require('../utils/serviceCatalogue');
    const validClinicalKeys = Object.keys(FUTURE_CLINICAL_SERVICE_TYPES);

    let parsedServices = [];
    if (Array.isArray(serviceAreasApplied)) {
      parsedServices = serviceAreasApplied.filter(s => validClinicalKeys.includes(s));
    } else if (typeof serviceAreasApplied === 'string') {
      parsedServices = serviceAreasApplied.split(',').map(s => s.trim()).filter(s => validClinicalKeys.includes(s));
    }

    if (parsedServices.length === 0) {
      return res.status(400).json({
        success: false,
        error: `Please select at least one clinical service category applied for. Eligible options: ${validClinicalKeys.join(', ')}`
      });
    }

    const updated = await prisma.assistantProfile.update({
      where: { id: profile.id },
      data: {
        professionTitle: professionTitle.trim(),
        registrationNumber: registrationNumber.trim(),
        qualifications: qualifications.trim(),
        issuingAuthority: req.body.issuingAuthority ? String(req.body.issuingAuthority).trim() : (profile.issuingAuthority || 'State Nursing Council'),
        yearsOfExperience: req.body.yearsOfExperience !== undefined ? parseInt(req.body.yearsOfExperience, 10) || 0 : (profile.yearsOfExperience || 0),
        declarationAccepted: req.body.declarationAccepted !== undefined ? Boolean(req.body.declarationAccepted) : true,
        declarationAcceptedAt: new Date(),
        serviceAreasApplied: JSON.stringify(parsedServices),
        operatingCity: req.body.operatingCity ? String(req.body.operatingCity).trim() : (profile.operatingCity || 'Chengannur'),
        operatingRadiusKm: req.body.operatingRadiusKm !== undefined ? parseFloat(req.body.operatingRadiusKm) || 15.0 : (profile.operatingRadiusKm || 15.0),
        bio: bio ? bio.trim() : profile.bio,
        verificationStatus: 'PENDING',
        submittedAt: new Date(),
        onboardingCompleted: true,
        onboardingStep: 'COMPLETED'
      },
      include: { user: true }
    });

    return res.json({
      success: true,
      message: 'Healthcare professional application submitted successfully. Your application is now PENDING administrator review.',
      profile: formatProfileResponse(updated, updated.user)
    });
  } catch (err) {
    console.error('submitProfessionalApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to submit professional application.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assistant/switch-role
// Explicit role switching between Delivery Assistant and Healthcare Professional.
// ─────────────────────────────────────────────────────────────────────────────
async function switchAssistantRole(req, res) {
  try {
    const userId = req.user.id;
    const { targetRole } = req.body;

    if (!targetRole || !['DELIVERY_ASSISTANT', 'HEALTHCARE_PROFESSIONAL'].includes(targetRole)) {
      return res.status(400).json({
        success: false,
        error: "Target role must be either 'DELIVERY_ASSISTANT' or 'HEALTHCARE_PROFESSIONAL'."
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const profile = await getOrCreateAssistantProfile(userId);

    // Suspension check: Suspended assistants cannot switch role to regain access or bypass suspension
    if (profile.verificationStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: `Unauthorized: Assistant account is SUSPENDED (${profile.suspensionReason || 'Administrator suspension in effect'}). Role switching is disabled.`
      });
    }

    // Role Lock: Once an assistant has registered in one track, they cannot switch to the other track
    if (profile.assistantType && profile.assistantType !== targetRole) {
      return res.status(403).json({
        success: false,
        error: `Role track locked: This account is permanently registered as ${profile.assistantType === 'DELIVERY_ASSISTANT' ? 'Delivery Assistant' : 'Healthcare Professional'}. Track switching is disabled.`
      });
    }

    if (profile.assistantType === targetRole) {
      return res.json({
        success: true,
        message: `Already in ${targetRole} role.`,
        profile: formatProfileResponse(profile, user)
      });
    }

    const updateData = { assistantType: targetRole };

    if (targetRole === 'DELIVERY_ASSISTANT') {
      updateData.onboardingCompleted = true;
      updateData.onboardingStep = 'COMPLETED';
      // Default delivery capabilities if empty
      if (!profile.capabilities || profile.capabilities.trim() === '') {
        updateData.capabilities = 'MEDICINE_DELIVERY,MEDICINE_COLLECTION';
      }
    } else {
      // Switching to Healthcare Professional:
      // Does NOT grant verified status! Preserves existing verificationStatus if previously approved or sets to NOT_SUBMITTED / PENDING.
      if (profile.verificationStatus !== 'APPROVED') {
        updateData.verificationStatus = profile.submittedAt ? 'PENDING' : 'NOT_SUBMITTED';
        updateData.onboardingCompleted = Boolean(profile.submittedAt);
      }
      updateData.capabilities = ''; // Delivery tasks not assigned to unapproved professionals
    }

    const updated = await prisma.assistantProfile.update({
      where: { id: profile.id },
      data: updateData,
      include: { user: true }
    });

    return res.json({
      success: true,
      message: `Role switched to ${targetRole}.`,
      profile: formatProfileResponse(updated, updated.user)
    });
  } catch (err) {
    console.error('switchAssistantRole error:', err);
    return res.status(500).json({ success: false, error: 'Failed to switch role.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/assistant/profile
// Updates assistant profile, active/available status, and supported capabilities
// ─────────────────────────────────────────────────────────────────────────────
async function updateAssistantProfile(req, res) {
  try {
    const userId = req.user.id;
    const { name, phone, bio, isActive, isAvailable, capabilities, assistantType, operatingCity, operatingRadiusKm, vehicleType } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.role !== 'ASSISTANT' && user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only assistants can maintain an assistant profile.' });
    }

    // Validate capabilities if provided
    let capabilitiesStr;
    if (capabilities !== undefined) {
      if (!Array.isArray(capabilities)) {
        return res.status(400).json({ success: false, error: 'Capabilities must be an array of service types.' });
      }
      if (capabilities.length === 0) {
        return res.status(400).json({ success: false, error: 'Assistant must support at least one service capability.' });
      }
      for (const cap of capabilities) {
        if (!VALID_ASSISTANT_SERVICE_TYPES.includes(cap)) {
          return res.status(400).json({
            success: false,
            error: `Invalid service capability '${cap}'. Must be one of: ${VALID_ASSISTANT_SERVICE_TYPES.join(', ')}`
          });
        }
      }
      capabilitiesStr = [...new Set(capabilities)].join(',');
    }

    // Update user info if name or phone changed
    const userUpdate = {};
    if (name && typeof name === 'string') userUpdate.name = name.trim();
    if (phone !== undefined) userUpdate.phone = phone ? phone.trim() : null;
    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: userUpdate
      });
    }

    const existing = await getOrCreateAssistantProfile(userId);

    // If account is suspended, strictly prevent reactivating availability or modifying capabilities/role
    if (existing.verificationStatus === 'SUSPENDED') {
      if (isActive === true || isAvailable === true || capabilities !== undefined || assistantType !== undefined) {
        return res.status(403).json({
          success: false,
          error: `Unauthorized: Assistant account is SUSPENDED (${existing.suspensionReason || 'Administrator suspension in effect'}). Cannot activate availability or modify capabilities/role.`
        });
      }
    }

    const profileUpdate = {};
    if (bio !== undefined) profileUpdate.bio = bio ? String(bio).trim() : null;
    if (isActive !== undefined) profileUpdate.isActive = Boolean(isActive);
    if (isAvailable !== undefined) profileUpdate.isAvailable = Boolean(isAvailable);
    if (capabilitiesStr !== undefined) profileUpdate.capabilities = capabilitiesStr;
    if (assistantType !== undefined) profileUpdate.assistantType = assistantType;
    if (operatingCity !== undefined) profileUpdate.operatingCity = String(operatingCity).trim();
    if (operatingRadiusKm !== undefined) profileUpdate.operatingRadiusKm = parseFloat(operatingRadiusKm) || 10.0;
    if (vehicleType !== undefined) profileUpdate.vehicleType = vehicleType;

    const updatedProfile = await prisma.assistantProfile.update({
      where: { id: existing.id },
      data: profileUpdate,
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } }
    });

    return res.json({
      success: true,
      message: 'Assistant profile updated successfully.',
      profile: formatProfileResponse(updatedProfile, updatedProfile.user)
    });
  } catch (err) {
    console.error('updateAssistantProfile error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update assistant profile.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assistant/available
// Get available assistant tasks (status = 'AVAILABLE')
// Phase 1: Only returns tasks matching requesting assistant's capabilities when active/available.
// Healthcare professionals cannot receive delivery tasks unless approved.
// ─────────────────────────────────────────────────────────────────────────────
async function getAvailableTasks(req, res) {
  try {
    const assistantId = req.user.id;

    // Check assistant profile, active/available status, and capabilities
    const profile = await getOrCreateAssistantProfile(assistantId);

    // Suspension check: Suspended assistants cannot accept or view tasks
    if (profile.verificationStatus === 'SUSPENDED') {
      return res.json({
        success: true,
        count: 0,
        tasks: [],
        assistantStatus: {
          isActive: false,
          isAvailable: false,
          verificationStatus: 'SUSPENDED',
          message: `Assistant account is SUSPENDED: ${profile.suspensionReason || 'Account suspended by administrator.'}`
        }
      });
    }

    // Phase 1 & 2: Healthcare Professionals cannot take medicine delivery/collection tasks.
    if (profile.assistantType === 'HEALTHCARE_PROFESSIONAL') {
      let statusMsg = 'Your professional application is currently under review (PENDING). Clinical service tasks cannot be received until administrator verification is complete.';
      if (profile.verificationStatus === 'APPROVED') {
        statusMsg = 'Healthcare Professional credentials verified (APPROVED). Clinical task bookings will appear here once booked by patients (Phase 3).';
      } else if (profile.verificationStatus === 'NEEDS_CORRECTION') {
        statusMsg = `Application requires corrections: ${profile.correctionReason || 'Please review administrator instructions and resubmit.'}`;
      } else if (profile.verificationStatus === 'REJECTED') {
        statusMsg = `Professional application was rejected: ${profile.rejectionReason || 'Application rejected by administrator.'}`;
      } else if (profile.verificationStatus === 'UNDER_REVIEW') {
        statusMsg = 'Your application is currently UNDER_REVIEW by administrators. Verification is in progress.';
      } else if (profile.verificationStatus === 'DRAFT' || profile.verificationStatus === 'NOT_SUBMITTED') {
        statusMsg = 'Professional application not yet submitted. Please complete your application and upload required certificates.';
      }

      return res.json({
        success: true,
        count: 0,
        tasks: [],
        assistantStatus: {
          isActive: profile.isActive,
          isAvailable: profile.isAvailable,
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          verificationStatus: profile.verificationStatus || 'PENDING',
          message: statusMsg
        }
      });
    }

    if (!profile.isActive || !profile.isAvailable) {
      return res.json({
        success: true,
        count: 0,
        tasks: [],
        assistantStatus: {
          isActive: profile.isActive,
          isAvailable: profile.isAvailable,
          message: 'Assistant is currently inactive or unavailable for service assignments.'
        }
      });
    }

    const assistantCapabilities = parseCapabilities(profile.capabilities);
    if (assistantCapabilities.length === 0) {
      return res.json({
        success: true,
        count: 0,
        tasks: [],
        assistantStatus: {
          isActive: profile.isActive,
          isAvailable: profile.isAvailable,
          message: 'Assistant has no active capabilities configured. Please select supported services in your profile.'
        }
      });
    }

    const tasks = await prisma.assistantTask.findMany({
      where: {
        OR: [
          { status: 'AVAILABLE' },
          { status: 'ASSIGNED', assistantId }
        ],
        order: {
          pharmacy: {
            isVerified: true,
            verificationStatus: 'VERIFIED'
          }
        }
      },
      include: {
        order: {
          include: {
            pharmacy: true,
            user: { select: { id: true, name: true, phone: true } },
            items: { include: { medicine: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Strip handoverPin from all task responses — PIN is verified at handover, not returned in lists
    const sanitized = tasks.map(({ handoverPin: _hp, ...t }) => t).map(t => sanitizeTaskForAssistant(t, { includeHandoverPin: false }));

    const { calculateDistance, resolveCoordinates } = require('../utils/distance');
    const assistantCoords = resolveCoordinates(null, null, profile.operatingCity || 'Chengannur');
    const maxRadiusKm = parseFloat(profile.operatingRadiusKm) || 15.0;

    // Capability & Geographic Proximity Filtering:
    // Only return tasks whose serviceType matches assistant capabilities
    // AND whose pickup pharmacy / delivery destination falls within the assistant's operating radius
    const capableTasks = sanitized.filter(task => {
      const taskServiceType = task.serviceType || 'MEDICINE_DELIVERY';
      if (!assistantCapabilities.includes(taskServiceType)) {
        return false;
      }

      // If task is already assigned to this assistant, always keep it
      if (task.assistantId === assistantId) {
        return true;
      }

      // Geographic radius calculation
      const pharmacy = task.order?.pharmacy;
      let targetLat = pharmacy?.latitude;
      let targetLon = pharmacy?.longitude;

      if (targetLat == null || targetLon == null) {
        const resolvedPharmacy = resolveCoordinates(null, null, pharmacy?.address || pharmacy?.name || 'Chengannur');
        targetLat = resolvedPharmacy.lat;
        targetLon = resolvedPharmacy.lon;
      }

      const dist = calculateDistance(assistantCoords.lat, assistantCoords.lon, targetLat, targetLon);
      task.calculatedDistanceKm = dist;

      // Allow if within operating radius (with a 2km grace buffer for border coordinates)
      return dist <= (maxRadiusKm + 2.0);
    });

    return res.json({
      success: true,
      count: capableTasks.length,
      tasks: capableTasks,
      assistantLocation: {
        operatingCity: profile.operatingCity || 'Chengannur',
        coordinates: assistantCoords,
        radiusKm: maxRadiusKm
      }
    });
  } catch (err) {
    console.error('getAvailableTasks error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve available tasks.' });
  }
}

// Get tasks assigned to current assistant
async function getMyTasks(req, res) {
  try {
    const assistantId = req.user.id;

    const tasks = await prisma.assistantTask.findMany({
      where: {
        assistantId
      },
      include: {
        order: {
          include: {
            pharmacy: true,
            user: { select: { id: true, name: true, phone: true } },
            items: { include: { medicine: true } }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Strip handoverPin from all task responses — PIN is verified at handover, not returned in lists
    // Authorized: assigned assistant receives destination address details to fulfill service
    const sanitized = tasks.map(({ handoverPin: _hp, ...t }) => t).map(t => sanitizeTaskForAssistant(t, { includeHandoverPin: false, isAssigned: true }));

    return res.json({
      success: true,
      count: sanitized.length,
      tasks: sanitized
    });
  } catch (err) {
    console.error('getMyTasks error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve assistant tasks.' });
  }
}

// Accept an available task (AVAILABLE -> ACCEPTED)
// Phase 6.1L.5: Only assigns task if assistant is active, available, and possesses the capability.
async function acceptTask(req, res) {
  try {
    const { id } = req.params; // taskId
    const assistantId = req.user.id;

    if (req.user.role !== 'ASSISTANT' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only registered Medicine Access Assistants can accept service tasks.' });
    }

    const task = await prisma.assistantTask.findUnique({
      where: { id },
      include: { order: { include: { pharmacy: true } } }
    });

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    if (task.order) {
      if (task.order.status === 'CANCELLED' || task.order.status === 'REJECTED') {
        return res.status(400).json({
          success: false,
          error: `Cannot accept task for an order that has been ${task.order.status.toLowerCase()}.`
        });
      }
      if (task.order.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          error: 'Cannot accept task for an already completed order.'
        });
      }
    }

    // Validate serviceType against canonical 8 values
    const effectiveServiceType = task.serviceType || 'MEDICINE_DELIVERY';
    if (!VALID_ASSISTANT_SERVICE_TYPES.includes(effectiveServiceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid serviceType '${task.serviceType}'. Must be one of: ${VALID_ASSISTANT_SERVICE_TYPES.join(', ')}`
      });
    }

    // Phase 6.1L.5: Check assistant profile, active/available status, and capability
    const profile = await getOrCreateAssistantProfile(assistantId);

    // Suspension check: Suspended assistants cannot accept tasks
    if (profile.verificationStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: `Unauthorized: Assistant account is SUSPENDED (${profile.suspensionReason || 'Administrator suspension in effect'}). Cannot accept tasks.`
      });
    }

    // Explicit role guard: Healthcare Professionals cannot accept delivery tasks unless verified for delivery
    if (profile.assistantType === 'HEALTHCARE_PROFESSIONAL') {
      return res.status(403).json({
        success: false,
        error: profile.verificationStatus === 'APPROVED'
          ? 'Unauthorized: Healthcare Professionals cannot accept medicine delivery tasks. Delivery tasks are restricted to Delivery Assistants.'
          : 'Unauthorized: Healthcare Professionals with unapproved applications cannot accept tasks.'
      });
    }

    // Verification check: Delivery Assistants must be approved by admin
    if (profile.assistantType === 'DELIVERY_ASSISTANT' && profile.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Your Delivery Assistant account is pending administrator review and clearance. You cannot accept delivery tasks until verified.'
      });
    }

    if (!profile.isActive || !profile.isAvailable) {
      return res.status(400).json({
        success: false,
        error: 'Assistant is currently inactive or unavailable for service assignment. Please enable active and available status in your profile.'
      });
    }

    const capabilities = parseCapabilities(profile.capabilities);
    if (capabilities.length === 0 || !capabilities.includes(effectiveServiceType)) {
      return res.status(400).json({
        success: false,
        error: capabilities.length === 0
          ? `Assistant does not possess the supported capability for serviceType '${effectiveServiceType}'. Assistant has no registered service capabilities.`
          : `Assistant does not possess the supported capability for serviceType '${effectiveServiceType}'. Supported: ${capabilities.join(', ')}`
      });
    }

    const isUnassignedAvailable = task.status === 'AVAILABLE' && !task.assistantId;
    const isAssignedToThisAssistant = task.status === 'ASSIGNED' && task.assistantId === assistantId;

    if (!isUnassignedAvailable && !isAssignedToThisAssistant) {
      if (task.status === 'ASSIGNED' && task.assistantId !== assistantId) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: This task was specifically assigned to another assistant.'
        });
      }
      return res.status(400).json({ success: false, error: `Task cannot be accepted. Current status: ${task.status}` });
    }

    // Re-verify to prevent race conditions / double acceptance
    const current = await prisma.assistantTask.findUnique({ where: { id } });
    const currentCanAccept = current && (
      (current.status === 'AVAILABLE' && !current.assistantId) ||
      (current.status === 'ASSIGNED' && current.assistantId === assistantId)
    );
    if (!currentCanAccept) {
      return res.status(400).json({ success: false, error: 'This task has already been accepted.' });
    }

    const updated = await prisma.assistantTask.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        assistantId,
        acceptedAt: new Date()
      },
      include: {
        order: {
          include: {
            pharmacy: true,
            user: { select: { id: true, name: true, phone: true } }
          }
        }
      }
    });

    // Update order status history (non-blocking for resilient PgBouncer support)
    const isDelivery = effectiveServiceType === 'MEDICINE_DELIVERY';
    const isCollection = effectiveServiceType === 'MEDICINE_COLLECTION';
    const historyComment = isDelivery || isCollection
      ? `Medicine Access Assistant ${req.user.name} accepted service task. En route to pharmacy.`
      : `Medicine Access Assistant ${req.user.name} accepted service task. Initiating assistance service.`;

    try {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: task.orderId,
          status: 'IN_TRANSIT',
          comment: historyComment
        }
      });
    } catch (histErr) {
      console.warn('Non-fatal orderStatusHistory create warning:', histErr.message);
    }

    // Notify the patient (non-blocking)
    try {
      const notifMsg = isDelivery || isCollection
        ? `${req.user.name} has accepted your medicine access request and is heading to ${task.order?.pharmacy?.name || 'the pharmacy'}.`
        : `${req.user.name} has accepted your medicine access request.`;

      await prisma.notification.create({
        data: {
          userId: task.order.userId,
          title: 'Medicine Access Assistant Assigned!',
          message: notifMsg,
          type: 'ASSISTANT',
          linkUrl: `/orders/${task.orderId}`
        }
      });
    } catch (notifErr) {
      console.warn('Non-fatal notification create warning:', notifErr.message);
    }

    return res.json({
      success: true,
      message: 'Task accepted successfully.',
      task: sanitizeTaskForAssistant(updated, { includeHandoverPin: false, isAssigned: true })
    });
  } catch (err) {
    if (err.message === 'TASK_ALREADY_CLAIMED') {
      return res.status(400).json({ success: false, error: 'This task has already been accepted.' });
    }
    console.error('acceptTask error:', err);
    return res.status(500).json({ success: false, error: 'Failed to accept task.' });
  }
}

// Progress task status
// Transitions: ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED -> CONFIRMED
async function progressTaskStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, handoverPin } = req.body;
    const assistantId = req.user.id;

    const task = await prisma.assistantTask.findUnique({
      where: { id },
      include: {
        order: {
          include: { pharmacy: true, user: true }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    if (task.assistantId !== assistantId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only update your own assigned tasks.' });
    }

    if (task.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: 'A cancelled task cannot be progressed.'
      });
    }

    if (task.order) {
      if (task.order.status === 'CANCELLED' || task.order.status === 'REJECTED') {
        return res.status(400).json({
          success: false,
          error: `Cannot progress task for an order that has been ${task.order.status.toLowerCase()}.`
        });
      }
      if (task.order.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          error: 'Cannot progress task for an already completed order.'
        });
      }
    }

    // Validate serviceType against canonical 8 values
    const effectiveServiceType = task.serviceType || 'MEDICINE_DELIVERY';
    if (!VALID_ASSISTANT_SERVICE_TYPES.includes(effectiveServiceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid serviceType '${task.serviceType}'. Must be one of: ${VALID_ASSISTANT_SERVICE_TYPES.join(', ')}`
      });
    }

    // Strict sequential state transitions
    const VALID_TRANSITIONS = {
      'ASSIGNED': ['ACCEPTED'],
      'ACCEPTED': ['COLLECTING'],
      'COLLECTING': ['IN_TRANSIT'],
      'IN_TRANSIT': ['DELIVERED'],
      'DELIVERED': ['CONFIRMED']
    };

    if (!VALID_TRANSITIONS[task.status] || !VALID_TRANSITIONS[task.status].includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid transition. A task in ${task.status} status cannot move directly to ${status}. Expected: ${VALID_TRANSITIONS[task.status]?.join(', ') || 'None'}.`
      });
    }

    // Handover PIN verification if marking CONFIRMED
    if (status === 'CONFIRMED') {
      if (!handoverPin || handoverPin.trim() !== task.handoverPin) {
        return res.status(400).json({
          success: false,
          error: 'Invalid recipient handover PIN. Recipient must provide their 4-digit verification PIN.'
        });
      }
    }

    const updateData = { status };
    if (status === 'ACCEPTED') {
      updateData.acceptedAt = new Date();
    } else if (status === 'COLLECTING') {
      updateData.collectedAt = new Date();
    } else if (status === 'DELIVERED' || status === 'CONFIRMED') {
      updateData.deliveredAt = new Date();
    }

    const updated = await prisma.assistantTask.update({
      where: { id },
      data: updateData,
      include: {
        order: {
          include: { pharmacy: true, user: true }
        }
      }
    });

    // Update child order status if confirmed
    if (status === 'CONFIRMED') {
      try {
        await prisma.order.update({
          where: { id: task.orderId },
          data: { status: 'COMPLETED' }
        });
      } catch (ordErr) {
        console.warn('Non-fatal order update warning:', ordErr.message);
      }

      // Gate 4: Parent Aggregate Status Synchronization if child of a split order
      if (task.order?.parentOrderId) {
        try {
          const { syncParentAggregateStatus } = require('./orderController');
          await syncParentAggregateStatus(prisma, task.order.parentOrderId, task.orderId, 'COMPLETED');
        } catch (syncErr) {
          console.error('Error synchronizing parent aggregate status in updateTaskStatus:', syncErr);
        }
      }
    }

    // Generate service-specific progress details (strictly preventing delivery wording for non-delivery services)
    const { historyComment, notifTitle, notifMsg } = getServiceProgressDetails(
      effectiveServiceType,
      status,
      task.order?.pharmacy?.name || 'Pharmacy',
      req.user.name || 'Assistant'
    );

    try {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: task.orderId,
          status: status === 'CONFIRMED' ? 'COMPLETED' : 'IN_TRANSIT',
          comment: historyComment
        }
      });
    } catch (histErr) {
      console.warn('Non-fatal orderStatusHistory create warning:', histErr.message);
    }

    // Notify patient
    try {
      await prisma.notification.create({
        data: {
          userId: task.order.userId,
          title: notifTitle,
          message: notifMsg,
          type: 'ASSISTANT',
          linkUrl: `/orders/${task.orderId}`
        }
      });
    } catch (notifErr) {
      console.warn('Non-fatal notification create warning:', notifErr.message);
    }

    return res.json({
      success: true,
      message: `Task transitioned to ${status}.`,
      task: sanitizeTaskForAssistant(updated, { includeHandoverPin: false, isAssigned: true })
    });
  } catch (err) {
    console.error('progressTaskStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to progress task status.' });
  }
}

/**
 * Discover active + available assistants filtered by requested capability.
 * Exposes only safe public profile data (name, bio, capabilities, availability).
 */
async function discoverAssistants(req, res) {
  try {
    const { serviceType, city, area } = req.query;

    if (serviceType && !VALID_ASSISTANT_SERVICE_TYPES.includes(serviceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid serviceType '${serviceType}'. Must be one of: ${VALID_ASSISTANT_SERVICE_TYPES.join(', ')}`
      });
    }

    const assistantUsers = await prisma.user.findMany({
      where: { role: 'ASSISTANT' },
      include: { assistantProfile: true }
    });

    const targetArea = (city || area || '').trim().toLowerCase();

    const matching = assistantUsers.filter(u => {
      const prof = u.assistantProfile;
      if (!prof || !prof.isActive || !prof.isAvailable) return false;
      const caps = parseCapabilities(prof.capabilities);
      if (serviceType && !caps.includes(serviceType)) return false;
      if (targetArea) {
        const opCity = (prof.operatingCity || 'Chengannur').toLowerCase();
        if (!opCity.includes(targetArea) && !targetArea.includes(opCity)) return false;
      }
      return true;
    });

    const publicProfiles = matching.map(u => ({
      id: u.id,
      name: u.name,
      bio: u.assistantProfile?.bio || '',
      operatingCity: u.assistantProfile?.operatingCity || 'Chengannur',
      capabilities: parseCapabilities(u.assistantProfile?.capabilities),
      isActive: u.assistantProfile?.isActive ?? false,
      isAvailable: u.assistantProfile?.isAvailable ?? false
    }));

    return res.json({
      success: true,
      count: publicProfiles.length,
      assistants: publicProfiles
    });
  } catch (err) {
    console.error('discoverAssistants error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve available assistants.' });
  }
}

/**
 * Validates that an assistant exists, is active/available, and possesses the capability for a service.
 */
async function validateAssistantSelection(assistantId, serviceType) {
  if (!assistantId) return { valid: false, error: 'Assistant ID is required.' };

  const assistant = await prisma.user.findUnique({
    where: { id: assistantId },
    include: { assistantProfile: true }
  });

  if (!assistant || assistant.role !== 'ASSISTANT') {
    return { valid: false, error: 'Selected assistant was not found or is not a registered assistant.' };
  }

  if (!assistant.assistantProfile || !assistant.assistantProfile.isActive || !assistant.assistantProfile.isAvailable) {
    return { valid: false, error: 'Selected assistant is currently inactive or unavailable for service assignment.' };
  }

  const caps = parseCapabilities(assistant.assistantProfile.capabilities);
  if (caps.length === 0) {
    return {
      valid: false,
      error: 'Selected assistant has no registered service capabilities.'
    };
  }
  if (serviceType && !caps.includes(serviceType)) {
    return {
      valid: false,
      error: `Selected assistant does not possess the supported capability for service type '${serviceType}'.`
    };
  }

  return { valid: true, assistant };
}

module.exports = {
  VALID_ASSISTANT_SERVICE_TYPES,
  sanitizeTaskForAssistant,
  parseCapabilities,
  getOrCreateAssistantProfile,
  getAssistantProfile,
  updateAssistantProfile,
  getServiceProgressDetails,
  getAvailableTasks,
  getMyTasks,
  acceptTask,
  progressTaskStatus,
  discoverAssistants,
  validateAssistantSelection,
  selectAssistantRole,
  updateDeliveryProfile,
  submitProfessionalApplication,
  switchAssistantRole
};

