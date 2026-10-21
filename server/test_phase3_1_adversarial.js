/**
 * MediFind AI — Phase 3.1: Adversarial Integration & Security Audit Test Suite
 *
 * Verifies confirmed defect fixes and adversarial security boundaries:
 * 1. Role-based access gating: Non-patients (Assistants, Pharmacists) blocked from creating appointments (403)
 * 2. Self-booking prevention: Professional cannot book an appointment with themselves (400)
 * 3. Address ownership validation: Patients cannot link other users' address IDs (403)
 * 4. Operational necessity address redaction: Inactive appointments (REJECTED, CANCELLED) redact service addresses for professionals
 * 5. Prescription safety: Suspicious or unverified prescriptions rejected for clinical services (400)
 * 6. 30-day booking horizon enforcement: Dates > 30 days rejected server-side (400)
 * 7. Schedule enforcement: Operating days, hours bounds, and slot durations enforced server-side on creation (400)
 * 8. Schedule modification conflict safety: Invalid hours rejected (400); conflicts with active bookings rejected with 409 Conflict
 * 9. Administrative dual notification: Admin status updates notify both patient and professional
 * 10. Prohibited & obsolete clinical procedures rejected unconditionally
 * 11. Database integrity and fixture isolation check
 */

const prisma = require('./src/prisma');
const appointmentController = require('./src/controllers/appointmentController');
const {
  CLINICAL_SERVICE_TYPES,
  HIGH_RISK_CLINICAL_SERVICES,
  OBSOLETE_SERVICE_TYPES,
  isBookableClinicalService,
  isHighRiskService
} = require('./src/utils/serviceCatalogue');

let pass = 0;
let fail = 0;

function check(label, value) {
  if (value) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.data = d; return this; }
  };
}

async function runAdversarialAuditTests() {
  console.log('\n======================================================================');
  console.log('🛡️  MediFind AI — Phase 3.1 Adversarial Integration & Security Audit');
  console.log('======================================================================\n');

  // 1. Initial State Snapshot
  const initialUsers = await prisma.user.count();
  const initialOrders = await prisma.order.count();
  const initialPharmacies = await prisma.pharmacy.count();
  const initialPayments = await prisma.payment.count();
  const initialTasks = await prisma.assistantTask.count();
  const initialMedicines = await prisma.medicine.count();

  console.log('--- 1. Baseline Data Preservation Verification ---');
  check('Historical users preserved (116+)', initialUsers >= 116);
  check('Historical orders preserved (64+)', initialOrders >= 64);
  check('Historical pharmacies preserved (3+)', initialPharmacies >= 3);
  check('Historical payments preserved (13+)', initialPayments >= 13);
  check('Historical assistant tasks preserved (47+)', initialTasks >= 47);
  check('Historical medicines preserved (50+)', initialMedicines >= 50);

  // Set up isolated audit fixtures
  const prefix = `audit31_${Date.now()}`;
  let patient1, patient2, assistantUser, pharmacistUser, professionalUser, profProfile, testAddrPatient2, suspiciousRx;

  try {
    patient1 = await prisma.user.create({
      data: {
        email: `${prefix}_pat1@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Audit Patient One',
        phone: '+919876543210',
        role: 'PATIENT'
      }
    });

    patient2 = await prisma.user.create({
      data: {
        email: `${prefix}_pat2@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Audit Patient Two',
        phone: '+919876543211',
        role: 'PATIENT'
      }
    });

    testAddrPatient2 = await prisma.patientAddress.create({
      data: {
        userId: patient2.id,
        addressLine1: '456 Secret Patient Lane',
        city: 'Chengannur',
        postalCode: '689121',
        isDefault: true
      }
    });

    assistantUser = await prisma.user.create({
      data: {
        email: `${prefix}_asst@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Audit Delivery Assistant',
        phone: '+919876543212',
        role: 'ASSISTANT'
      }
    });

    pharmacistUser = await prisma.user.create({
      data: {
        email: `${prefix}_pharm@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Audit Pharmacist',
        phone: '+919876543213',
        role: 'PHARMACIST'
      }
    });

    professionalUser = await prisma.user.create({
      data: {
        email: `${prefix}_prof@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Nurse Anitha Nair',
        phone: '+919876543214',
        role: 'ASSISTANT'
      }
    });

    profProfile = await prisma.assistantProfile.create({
      data: {
        userId: professionalUser.id,
        assistantType: 'HEALTHCARE_PROFESSIONAL',
        professionTitle: 'Registered Home Care Nurse',
        registrationNumber: 'KNC-AUDIT-9921',
        qualifications: 'B.Sc Nursing',
        issuingAuthority: 'Kerala Nursing Council',
        yearsOfExperience: 6,
        verificationStatus: 'APPROVED',
        isActive: true,
        isAvailable: true,
        operatingCity: 'Chengannur',
        approvedServices: JSON.stringify(['NURSING_VISIT', 'POST_HOSPITAL_CARE', 'VITAL_SIGN_MEASUREMENT']),
        workingDays: JSON.stringify(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        slotDurationMinutes: 60,
        serviceFee: 300
      }
    });

    suspiciousRx = await prisma.prescription.create({
      data: {
        userId: patient1.id,
        originalFileName: 'suspicious_forged_order.pdf',
        filePath: 'rx_audit_suspicious.pdf',
        status: 'PENDING',
        screeningStatus: 'POTENTIALLY_SUSPICIOUS'
      }
    });

    // Helper to find next target day string (YYYY-MM-DD)
    function getNextDayDate(targetDayOfWeek) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== targetDayOfWeek) {
        d.setDate(d.getDate() + 1);
      }
      return d.toISOString().slice(0, 10);
    }

    // Monday is day 1
    const nextMondayStr = getNextDayDate(1);
    // Sunday is day 0
    const nextSundayStr = getNextDayDate(0);

    console.log('\n--- 2. Healthcare Appointment Security & Role Access Gating ---');

    // Test: Delivery Assistant cannot create healthcare appointments
    const resAsst = createMockRes();
    await appointmentController.createAppointment({
      user: { id: assistantUser.id, role: 'ASSISTANT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resAsst);
    check('Assistant role cannot create appointment (403)', resAsst.statusCode === 403);

    // Test: Pharmacist cannot create healthcare appointments
    const resPharm = createMockRes();
    await appointmentController.createAppointment({
      user: { id: pharmacistUser.id, role: 'PHARMACIST' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resPharm);
    check('Pharmacist role cannot create appointment (403)', resPharm.statusCode === 403);

    // Test: Professional cannot book with themselves
    const resSelf = createMockRes();
    await appointmentController.createAppointment({
      user: { id: professionalUser.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resSelf);
    check('Self-booking is blocked (400)', resSelf.statusCode === 400);

    // Test: Patient cannot link addressId belonging to another patient
    const resAddrTheft = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        addressId: testAddrPatient2.id,
        consentAccepted: true
      }
    }, resAddrTheft);
    check('Using unowned addressId is rejected (403)', resAddrTheft.statusCode === 403);

    console.log('\n--- 3. Prescription Screening & Verification Rules ---');

    // Test: Service requiring prescription rejects POTENTIALLY_SUSPICIOUS screening
    const resSuspicious = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'POST_HOSPITAL_CARE',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true,
        prescriptionId: suspiciousRx.id
      }
    }, resSuspicious);
    check('Suspicious prescription rejected for clinical service (400)', resSuspicious.statusCode === 400);

    console.log('\n--- 4. Date Horizon & Schedule Boundary Constraints ---');

    // Test: 30-day booking horizon limit
    const farFutureDate = new Date();
    farFutureDate.setDate(farFutureDate.getDate() + 35);
    const farFutureDateStr = farFutureDate.toISOString().slice(0, 10);

    const resFarFuture = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: farFutureDateStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resFarFuture);
    check('Booking beyond 30-day horizon is rejected (400)', resFarFuture.statusCode === 400);

    // Test: Non-working day rejection (Sunday)
    const resSunday = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextSundayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resSunday);
    check('Booking on non-working day is rejected (400)', resSunday.statusCode === 400);

    // Test: Slot outside working hours (e.g. 07:00 - 08:00 when working hours are 09:00 - 17:00)
    const resEarly = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '07:00 - 08:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resEarly);
    check('Slot before working hours start is rejected (400)', resEarly.statusCode === 400);

    // Test: Mismatched slot duration (e.g. 120m when professional configured 60m)
    const resMismatchedDur = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 12:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resMismatchedDur);
    check('Mismatched slot duration is rejected (400)', resMismatchedDur.statusCode === 400);

    // Test: Inverted slot (end before start: 11:00 - 10:00)
    const resInverted = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '11:00 - 10:00',
        serviceAddress: '123 Main Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resInverted);
    check('Inverted slot (end before start) is rejected (400)', resInverted.statusCode === 400);

    console.log('\n--- 5. Valid Appointment Creation & Address Privacy ---');

    // Create a valid appointment for patient1
    const resValid = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Confidential Home Rd, Chengannur',
        consentAccepted: true
      }
    }, resValid);
    check('Valid appointment request succeeds (201)', resValid.statusCode === 201 && Boolean(resValid.data?.appointment?.id));

    const validAptId = resValid.data?.appointment?.id;

    // Reject the appointment so it transitions to terminal REJECTED status
    const resReject = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      params: { id: validAptId },
      body: { action: 'REJECT', reason: 'Emergency hospital duty call.' }
    }, resReject);
    check('Professional can reject appointment with mandatory reason (200)', resReject.statusCode === 200);

    // Test: Address is redacted for professional when viewing non-active appointment
    const resProfGet = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      params: { id: validAptId }
    }, resProfGet);
    check('Address redacted for professional on non-active appointment',
      resProfGet.statusCode === 200 &&
      resProfGet.data?.appointment?.serviceAddress?.includes('[REDACTED')
    );

    // Patient can still see their own address on the rejected appointment
    const resPatGet = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: patient1.id, role: 'PATIENT' },
      params: { id: validAptId }
    }, resPatGet);
    check('Patient retains visibility of their own address (200)',
      resPatGet.statusCode === 200 &&
      resPatGet.data?.appointment?.serviceAddress === '123 Confidential Home Rd, Chengannur'
    );

    // Unrelated user cannot view appointment details
    const resIntruder = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: patient2.id, role: 'PATIENT' },
      params: { id: validAptId }
    }, resIntruder);
    check('Unrelated patient blocked from accessing appointment (403)', resIntruder.statusCode === 403);

    console.log('\n--- 6. Schedule Modifications & Conflict Detection ---');

    // Create another active booking (REQUESTED) to test schedule conflict prevention
    const resActiveBooking = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMondayStr,
        timeSlot: '14:00 - 15:00',
        serviceAddress: '789 Recovery St, Chengannur',
        consentAccepted: true
      }
    }, resActiveBooking);
    check('Second active appointment created (201)', resActiveBooking.statusCode === 201 && Boolean(resActiveBooking.data?.appointment?.id));
    const activeAptId = resActiveBooking.data?.appointment?.id;

    // Test: Update schedule with invalid time format (e.g. 25:00)
    const resInvalidHours = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '25:00' }
    }, resInvalidHours);
    check('Schedule update with invalid hour (25:00) rejected (400)', resInvalidHours.statusCode === 400);

    // Test: Update schedule with start >= end (17:00 to 09:00)
    const resInvertedHours = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '17:00', workingHoursEnd: '09:00' }
    }, resInvertedHours);
    check('Schedule update with start >= end rejected (400)', resInvertedHours.statusCode === 400);

    // Test: Modifying working hours to exclude active booking (14:00 - 15:00) triggers 409 Conflict
    const resConflictHours = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '09:00', workingHoursEnd: '13:00' }
    }, resConflictHours);
    check('Schedule shrinking conflicting with active booking rejected (409 Conflict)', resConflictHours.statusCode === 409);

    // Test: Removing working day (MONDAY) that has active booking triggers 409 Conflict
    const resConflictDays = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: professionalUser.id, role: 'ASSISTANT' },
      body: { workingDays: ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }
    }, resConflictDays);
    check('Removing MONDAY conflicting with active booking rejected (409 Conflict)', resConflictDays.statusCode === 409);

    console.log('\n--- 7. Administrative Dual Notification Verification ---');

    // Admin updates active appointment status
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (adminUser && activeAptId) {
      const resAdminCancel = createMockRes();
      await appointmentController.updateAppointmentStatus({
        user: { id: adminUser.id, role: 'ADMIN' },
        params: { id: activeAptId },
        body: { action: 'CANCEL', reason: 'Administrative health facility maintenance override.' }
      }, resAdminCancel);
      check('Admin can cancel appointment (200)', resAdminCancel.statusCode === 200);

      // Verify notifications exist for BOTH patient and professional
      const patNotif = await prisma.notification.findFirst({
        where: { userId: patient1.id, message: { contains: 'administration' } }
      });
      const profNotif = await prisma.notification.findFirst({
        where: { userId: professionalUser.id, message: { contains: 'administration' } }
      });
      check('Admin status update generates notification for patient', Boolean(patNotif));
      check('Admin status update generates notification for professional', Boolean(profNotif));
    }

    console.log('\n--- 8. Prohibited and Obsolete Services Direct Request Rejection ---');

    // Test high risk direct request
    const resHighRisk = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'INVASIVE_INJECTION',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Rd, Chengannur',
        consentAccepted: true
      }
    }, resHighRisk);
    check('Prohibited invasive injection directly rejected (400)', resHighRisk.statusCode === 400);

    // Test obsolete service direct request
    const resObsolete = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patient1.id, role: 'PATIENT' },
      body: {
        professionalId: professionalUser.id,
        serviceType: 'HOME_NURSING_CARE',
        scheduledDate: nextMondayStr,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Main Rd, Chengannur',
        consentAccepted: true
      }
    }, resObsolete);
    check('Obsolete category HOME_NURSING_CARE directly rejected (400)', resObsolete.statusCode === 400);

  } finally {
    // Clean up isolated test fixtures
    console.log('\n--- 9. Isolated Fixture Teardown & Database Integrity Verification ---');
    try {
      if (patient1 || professionalUser) {
        await prisma.appointmentStatusHistory.deleteMany({
          where: { appointment: { patientId: { in: [patient1?.id, patient2?.id].filter(Boolean) } } }
        });
        await prisma.healthcareAppointment.deleteMany({
          where: { patientId: { in: [patient1?.id, patient2?.id].filter(Boolean) } }
        });
      }
      if (testAddrPatient2) {
        await prisma.patientAddress.delete({ where: { id: testAddrPatient2.id } });
      }
      if (suspiciousRx) {
        await prisma.prescription.delete({ where: { id: suspiciousRx.id } });
      }
      if (profProfile) {
        await prisma.assistantProfile.delete({ where: { id: profProfile.id } });
      }
      if (patient1) {
        await prisma.notification.deleteMany({ where: { userId: patient1.id } });
        await prisma.user.delete({ where: { id: patient1.id } });
      }
      if (patient2) {
        await prisma.user.delete({ where: { id: patient2.id } });
      }
      if (assistantUser) {
        await prisma.user.delete({ where: { id: assistantUser.id } });
      }
      if (pharmacistUser) {
        await prisma.user.delete({ where: { id: pharmacistUser.id } });
      }
      if (professionalUser) {
        await prisma.notification.deleteMany({ where: { userId: professionalUser.id } });
        await prisma.user.delete({ where: { id: professionalUser.id } });
      }
    } catch (cleanErr) {
      console.error('Fixture cleanup warning:', cleanErr.message);
    }

    const finalUsers = await prisma.user.count();
    const finalOrders = await prisma.order.count();
    const finalPharmacies = await prisma.pharmacy.count();
    const finalPayments = await prisma.payment.count();
    const finalTasks = await prisma.assistantTask.count();
    const finalMedicines = await prisma.medicine.count();

    check('User count strictly restored to baseline', finalUsers === initialUsers);
    check('Order count strictly restored to baseline', finalOrders === initialOrders);
    check('Pharmacy count strictly restored to baseline', finalPharmacies === initialPharmacies);
    check('Payment count strictly restored to baseline', finalPayments === initialPayments);
    check('Task count strictly restored to baseline', finalTasks === initialTasks);
    check('Medicine count strictly restored to baseline', finalMedicines === initialMedicines);
  }

  console.log('\n======================================================================');
  console.log(`📊 Phase 3.1 Audit Results: ${pass} PASSED, ${fail} FAILED`);
  console.log('======================================================================\n');

  if (fail > 0) {
    process.exit(1);
  }
}

runAdversarialAuditTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
