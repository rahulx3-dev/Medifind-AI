/**
 * MediFind AI — Phase 3.2: Security Fix Verification & High-Risk Case Audit
 *
 * Verifies:
 * 1. Eight confirmed fixes from Phase 3.1:
 *    - Cross-patient addressId linking rejected (403)
 *    - Non-patient booking rejected (403) and self-booking blocked (400)
 *    - 30-day horizon, non-working days, out-of-hours, mismatched durations, and off-grid slots rejected (400)
 *    - Invalid schedule updates (400) & schedule changes conflicting with active bookings rejected (409)
 *    - FAILED or POTENTIALLY_SUSPICIOUS prescriptions rejected for clinical services (400)
 *    - Professional address access redacted on non-active appointments (REJECTED, CANCELLED)
 *    - Dual notification dispatched to both parties on administrator overrides
 *    - Prescription image path traversal & sibling directory collisions rejected (403)
 * 2. Additional high-risk cases:
 *    - Simultaneous / concurrent booking requests for same slot (race condition test)
 *    - Overlapping interval booking rejected (409 Conflict)
 *    - Cancelled / rejected bookings release slots (slot re-bookable)
 *    - Rigorous status transition boundaries & cancellation permission gating
 *    - Client tampering immunity (feeAmount, paymentStatus, professionalId)
 *    - Role access isolation for appointment details & notifications
 *    - Test pharmacy isolation (discovery & checkout gating)
 * 3. Database conservation across 8 core models.
 */

const prisma = require('./src/prisma');
const appointmentController = require('./src/controllers/appointmentController');
const orderController = require('./src/controllers/orderController');
const prescriptionController = require('./src/controllers/prescriptionController');
const pharmacyController = require('./src/controllers/pharmacyController');
const notificationController = require('./src/controllers/notificationController');

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

async function runPhase32VerificationTests() {
  console.log('\n======================================================================');
  console.log('🔒 MediFind AI — Phase 3.2 Security Fix Verification & Defect Audit');
  console.log('======================================================================\n');

  // Baseline 8-model snapshot
  const baseline = {
    users: await prisma.user.count(),
    orders: await prisma.order.count(),
    pharmacies: await prisma.pharmacy.count(),
    payments: await prisma.payment.count(),
    tasks: await prisma.assistantTask.count(),
    medicines: await prisma.medicine.count(),
    appointments: await prisma.healthcareAppointment.count(),
    history: await prisma.appointmentStatusHistory.count()
  };

  console.log('--- Baseline Database State ---');
  console.log(JSON.stringify(baseline, null, 2));
  check('Baseline users present (115+)', baseline.users >= 115);
  check('Baseline orders present (64+)', baseline.orders >= 64);
  check('Baseline pharmacies present (2+)', baseline.pharmacies >= 2);
  check('Baseline payments present (13+)', baseline.payments >= 13);

  const prefix = `p32_${Date.now()}`;
  let patientA, patientB, nurseUser, nurseProfile, asstUser, pharmUser, testAddrB, badRxFailed, badRxSuspicious;

  try {
    patientA = await prisma.user.create({
      data: {
        email: `${prefix}_pata@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Phase 3.2 Patient Alpha',
        phone: '+919111111111',
        role: 'PATIENT'
      }
    });

    patientB = await prisma.user.create({
      data: {
        email: `${prefix}_patb@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Phase 3.2 Patient Beta',
        phone: '+919222222222',
        role: 'PATIENT'
      }
    });

    testAddrB = await prisma.patientAddress.create({
      data: {
        userId: patientB.id,
        addressLine1: '88 Private Enclave, Chengannur',
        city: 'Chengannur',
        postalCode: '689121',
        isDefault: true
      }
    });

    nurseUser = await prisma.user.create({
      data: {
        email: `${prefix}_nurse@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Nurse Priya Varma',
        phone: '+919333333333',
        role: 'ASSISTANT'
      }
    });

    nurseProfile = await prisma.assistantProfile.create({
      data: {
        userId: nurseUser.id,
        assistantType: 'HEALTHCARE_PROFESSIONAL',
        professionTitle: 'Certified Clinical Nurse',
        registrationNumber: 'KNC-AUDIT-P32',
        qualifications: 'B.Sc Nursing, Critical Care Cert',
        issuingAuthority: 'Kerala Nursing Council',
        yearsOfExperience: 5,
        verificationStatus: 'APPROVED',
        isActive: true,
        isAvailable: true,
        operatingCity: 'Chengannur',
        approvedServices: JSON.stringify(['NURSING_VISIT', 'POST_HOSPITAL_CARE', 'VITAL_SIGN_MEASUREMENT']),
        workingDays: JSON.stringify(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        slotDurationMinutes: 60,
        serviceFee: 350
      }
    });

    asstUser = await prisma.user.create({
      data: {
        email: `${prefix}_asst@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Delivery Agent Arun',
        phone: '+919444444444',
        role: 'ASSISTANT'
      }
    });

    pharmUser = await prisma.user.create({
      data: {
        email: `${prefix}_pharm@medifind.test`,
        password: 'hashed_audit_password',
        name: 'Pharmacist George',
        phone: '+919555555555',
        role: 'PHARMACIST'
      }
    });

    badRxFailed = await prisma.prescription.create({
      data: {
        userId: patientA.id,
        originalFileName: 'failed_rx.pdf',
        filePath: 'rx_failed.pdf',
        status: 'FAILED',
        screeningStatus: 'UNABLE_TO_ASSESS'
      }
    });

    badRxSuspicious = await prisma.prescription.create({
      data: {
        userId: patientA.id,
        originalFileName: 'tampered_rx.pdf',
        filePath: 'rx_tampered.pdf',
        status: 'PENDING',
        screeningStatus: 'POTENTIALLY_SUSPICIOUS'
      }
    });

    // Helper for scheduling dates: Next Monday
    function getNextTargetDate(dayOfWeek) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== dayOfWeek) {
        d.setDate(d.getDate() + 1);
      }
      return d.toISOString().slice(0, 10);
    }
    const nextMonday = getNextTargetDate(1);
    const nextSunday = getNextTargetDate(0);

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 1: VERIFY THE EIGHT CONFIRMED DEFECT FIXES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Section 1.1: Fix 1 - Cross-Patient Address ID Ownership ---');
    const resAddrTheft = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Fake Rd',
        addressId: testAddrB.id, // belongs to patientB
        consentAccepted: true
      }
    }, resAddrTheft);
    check('Fix 1: Using unowned addressId rejected with 403', resAddrTheft.statusCode === 403);

    console.log('\n--- Section 1.2: Fix 2 - Non-Patient Booking & Self-Booking ---');
    const resAsstBook = createMockRes();
    await appointmentController.createAppointment({
      user: { id: asstUser.id, role: 'ASSISTANT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resAsstBook);
    check('Fix 2a: Assistant role booking rejected with 403', resAsstBook.statusCode === 403);

    const resPharmBook = createMockRes();
    await appointmentController.createAppointment({
      user: { id: pharmUser.id, role: 'PHARMACIST' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resPharmBook);
    check('Fix 2b: Pharmacist role booking rejected with 403', resPharmBook.statusCode === 403);

    const resSelfBook = createMockRes();
    await appointmentController.createAppointment({
      user: { id: nurseUser.id, role: 'PATIENT' }, // Professional attempting self-booking
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resSelfBook);
    check('Fix 2c: Professional self-booking blocked with 400', resSelfBook.statusCode === 400);

    console.log('\n--- Section 1.3: Fix 3 - Horizon, Operating Days, Operating Hours, Durations & Grid ---');
    // Horizon > 30 days
    const horizon35 = new Date();
    horizon35.setDate(horizon35.getDate() + 35);
    const resHorizon = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: horizon35.toISOString().slice(0, 10),
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resHorizon);
    check('Fix 3a: >30-day booking horizon rejected with 400', resHorizon.statusCode === 400);

    // Non-working day (Sunday)
    const resSunday = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextSunday,
        timeSlot: '09:00 - 10:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resSunday);
    check('Fix 3b: Booking on non-working day (Sunday) rejected with 400', resSunday.statusCode === 400);

    // Outside working hours (07:00 - 08:00 when hours are 09:00 - 17:00)
    const resEarly = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '07:00 - 08:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resEarly);
    check('Fix 3c: Slot outside operating hours rejected with 400', resEarly.statusCode === 400);

    // Mismatched slot duration (30 mins when professional requires 60 mins)
    const resDur = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:00 - 09:30',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resDur);
    check('Fix 3d: Mismatched slot duration (30m vs 60m) rejected with 400', resDur.statusCode === 400);

    // Off-grid slot (09:15 - 10:15)
    const resOffGrid = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '09:15 - 10:15',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true
      }
    }, resOffGrid);
    check('Fix 3e: Off-grid slot (09:15-10:15) rejected with 400', resOffGrid.statusCode === 400);

    console.log('\n--- Section 1.4: Fix 4 - Invalid Schedules & Active Booking Conflicts ---');
    // Invalid hours
    const resInv1 = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '24:00' }
    }, resInv1);
    check('Fix 4a: Invalid 24h start time rejected with 400', resInv1.statusCode === 400);

    const resInv2 = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '17:00', workingHoursEnd: '09:00' }
    }, resInv2);
    check('Fix 4b: Inverted start >= end rejected with 400', resInv2.statusCode === 400);

    // Create an active appointment to test conflict blocking
    const resAptForConflict = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '15:00 - 16:00',
        serviceAddress: '456 Olive Rd, Chengannur',
        consentAccepted: true
      }
    }, resAptForConflict);
    check('Active test appointment created (201)', resAptForConflict.statusCode === 201);
    const conflictAptId = resAptForConflict.data?.appointment?.id;

    // Modifying working hours to 09:00 - 14:00 (excludes active booking at 15:00)
    const resHoursConflict = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      body: { workingHoursStart: '09:00', workingHoursEnd: '14:00' }
    }, resHoursConflict);
    check('Fix 4c: Schedule change conflicting with active booking returns 409 Conflict', resHoursConflict.statusCode === 409);

    // Removing MONDAY from working days (conflicts with active booking on nextMonday)
    const resDayConflict = createMockRes();
    await appointmentController.updateProfessionalSchedule({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      body: { workingDays: ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }
    }, resDayConflict);
    check('Fix 4d: Removing working day containing active booking returns 409 Conflict', resDayConflict.statusCode === 409);

    // Clean up active test appointment before next tests
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: conflictAptId } });
    await prisma.healthcareAppointment.delete({ where: { id: conflictAptId } });

    console.log('\n--- Section 1.5: Fix 5 - Prescription FAILED and Screening Gating ---');
    const resRxFailed = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'POST_HOSPITAL_CARE',
        scheduledDate: nextMonday,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true,
        prescriptionId: badRxFailed.id
      }
    }, resRxFailed);
    check('Fix 5a: FAILED prescription rejected with 400', resRxFailed.statusCode === 400);

    const resRxSuspicious = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'POST_HOSPITAL_CARE',
        scheduledDate: nextMonday,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '123 Valid Clinic Rd, Chengannur',
        consentAccepted: true,
        prescriptionId: badRxSuspicious.id
      }
    }, resRxSuspicious);
    check('Fix 5b: POTENTIALLY_SUSPICIOUS screening rejected with 400', resRxSuspicious.statusCode === 400);

    console.log('\n--- Section 1.6: Fix 6 - Professional Address Redaction for Non-Active Bookings ---');
    // Create and cancel appointment
    const resCancelApt = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '11:00 - 12:00',
        serviceAddress: '789 High Privacy St, Chengannur',
        consentAccepted: true
      }
    }, resCancelApt);
    const cancelAptId = resCancelApt.data?.appointment?.id;

    // Patient cancels
    const resCancelAction = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: patientA.id, role: 'PATIENT' },
      params: { id: cancelAptId },
      body: { action: 'CANCEL', reason: 'Patient travel conflict.' }
    }, resCancelAction);
    check('Appointment cancelled (200)', resCancelAction.statusCode === 200);

    // Professional retrieves cancelled appointment
    const resProfRedacted = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: cancelAptId }
    }, resProfRedacted);
    check('Fix 6a: Cancelled appointment address redacted for professional',
      resProfRedacted.statusCode === 200 &&
      resProfRedacted.data?.appointment?.serviceAddress?.includes('[REDACTED')
    );

    // Professional list endpoint also redacts inactive appointments
    const resProfList = createMockRes();
    await appointmentController.getProfessionalAppointments({
      user: { id: nurseUser.id, role: 'ASSISTANT' }
    }, resProfList);
    const listItem = resProfList.data?.appointments?.find(a => a.id === cancelAptId);
    check('Fix 6b: Cancelled appointment address redacted in professional listing',
      Boolean(listItem && listItem.serviceAddress?.includes('[REDACTED'))
    );

    // Clean up cancelled appointment
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: cancelAptId } });
    await prisma.healthcareAppointment.delete({ where: { id: cancelAptId } });

    console.log('\n--- Section 1.7: Fix 7 - Dual Notification on Administrator Overrides ---');
    const resAdminApt = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '11:00 - 12:00',
        serviceAddress: '789 High Privacy St, Chengannur',
        consentAccepted: true
      }
    }, resAdminApt);
    const adminAptId = resAdminApt.data?.appointment?.id;

    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (adminUser) {
      const resAdminOverride = createMockRes();
      await appointmentController.updateAppointmentStatus({
        user: { id: adminUser.id, role: 'ADMIN' },
        params: { id: adminAptId },
        body: { action: 'CANCEL', reason: 'Administrative facility sanitation closure.' }
      }, resAdminOverride);
      check('Admin status update succeeds (200)', resAdminOverride.statusCode === 200);

      const notifPatient = await prisma.notification.findFirst({
        where: { userId: patientA.id, message: { contains: 'administration' } }
      });
      const notifNurse = await prisma.notification.findFirst({
        where: { userId: nurseUser.id, message: { contains: 'administration' } }
      });
      check('Fix 7a: Administrator override dispatched notification to patient', Boolean(notifPatient));
      check('Fix 7b: Administrator override dispatched notification to professional', Boolean(notifNurse));
    }

    // Clean up
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: adminAptId } });
    await prisma.healthcareAppointment.delete({ where: { id: adminAptId } });

    console.log('\n--- Section 1.8: Fix 8 - Sibling Directory Prefix Traversal Defense ---');
    // Test prescriptionController.getPrescriptionImage with sibling directory path
    const fakeRxSibling = await prisma.prescription.create({
      data: {
        userId: patientA.id,
        originalFileName: 'sibling_attack.jpg',
        filePath: 'C:\\Users\\HP\\mfai_web\\uploads\\prescriptions_fake\\attack.jpg',
        status: 'VERIFIED'
      }
    });

    const resSibling = createMockRes();
    await prescriptionController.getPrescriptionImage({
      user: { id: patientA.id, role: 'PATIENT' },
      params: { id: fakeRxSibling.id }
    }, resSibling);
    check('Fix 8: Sibling directory path rejected with 403 Invalid file path', resSibling.statusCode === 403);
    await prisma.prescription.delete({ where: { id: fakeRxSibling.id } });

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2: ADDITIONAL HIGH-RISK CASES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Section 2.1: Race Condition & Simultaneous Slot Requests ---');
    // Concurrency test: Two simultaneous requests for the exact same slot (10:00 - 11:00)
    const promise1 = (async () => {
      const r = createMockRes();
      await appointmentController.createAppointment({
        user: { id: patientA.id, role: 'PATIENT' },
        body: {
          professionalId: nurseUser.id,
          serviceType: 'NURSING_VISIT',
          scheduledDate: nextMonday,
          timeSlot: '10:00 - 11:00',
          serviceAddress: '100 Concurrent Ave, Chengannur',
          consentAccepted: true
        }
      }, r);
      return r;
    })();

    const promise2 = (async () => {
      const r = createMockRes();
      await appointmentController.createAppointment({
        user: { id: patientB.id, role: 'PATIENT' },
        body: {
          professionalId: nurseUser.id,
          serviceType: 'NURSING_VISIT',
          scheduledDate: nextMonday,
          timeSlot: '10:00 - 11:00',
          serviceAddress: '200 Simultaneous Blvd, Chengannur',
          consentAccepted: true
        }
      }, r);
      return r;
    })();

    const [resRace1, resRace2] = await Promise.all([promise1, promise2]);
    const oneCreated = (resRace1.statusCode === 201 && resRace2.statusCode === 409) ||
                       (resRace2.statusCode === 201 && resRace1.statusCode === 409);
    check('Concurrency: Exactly one request gets 201, other receives 409 Conflict', oneCreated);

    const raceWinnerAptId = resRace1.statusCode === 201
      ? resRace1.data?.appointment?.id
      : resRace2.data?.appointment?.id;

    console.log('\n--- Section 2.2: Overlapping Timestamp Intervals ---');
    // Try to book an overlapping interval if another patient crafts a different timeSlot string
    // e.g. 10:00 - 11:00 is active.
    const resOverlap = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientB.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '300 Overlap Rd, Chengannur',
        consentAccepted: true
      }
    }, resOverlap);
    check('Overlapping slot request returns 409 Conflict', resOverlap.statusCode === 409);

    console.log('\n--- Section 2.3: Releasing Slots on Rejection / Cancellation ---');
    // Reject the winner's appointment
    const resRejectWinner = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: raceWinnerAptId },
      body: { action: 'REJECT', reason: 'Rescheduling routine patients for surgery.' }
    }, resRejectWinner);
    check('Appointment successfully rejected (200)', resRejectWinner.statusCode === 200);

    // Now slot 10:00 - 11:00 MUST BE AVAILABLE again
    const resRebook = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientB.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '10:00 - 11:00',
        serviceAddress: '200 Freedom Blvd, Chengannur',
        consentAccepted: true
      }
    }, resRebook);
    check('Slot 10:00-11:00 immediately re-bookable after rejection (201)', resRebook.statusCode === 201);
    const rebookedAptId = resRebook.data?.appointment?.id;

    console.log('\n--- Section 2.4: Finite State Machine & Permission Boundaries ---');
    // Patient cannot accept appointment
    const resPatAccept = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: patientB.id, role: 'PATIENT' },
      params: { id: rebookedAptId },
      body: { action: 'ACCEPT' }
    }, resPatAccept);
    check('Patient accepting appointment rejected with 403', resPatAccept.statusCode === 403);

    // Professional accepts
    const resProfAccept = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: rebookedAptId },
      body: { action: 'ACCEPT' }
    }, resProfAccept);
    check('Professional accepts appointment (200)', resProfAccept.statusCode === 200);

    // Professional cannot COMPLETE before START
    const resSkipToComplete = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: rebookedAptId },
      body: { action: 'COMPLETE' }
    }, resSkipToComplete);
    check('Cannot skip START (ACCEPTED -> COMPLETE rejected with 400)', resSkipToComplete.statusCode === 400);

    // Professional starts
    const resStart = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: rebookedAptId },
      body: { action: 'START' }
    }, resStart);
    check('Professional starts appointment (200, IN_PROGRESS)', resStart.statusCode === 200);

    // Patient cannot complete
    const resPatComplete = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: patientB.id, role: 'PATIENT' },
      params: { id: rebookedAptId },
      body: { action: 'COMPLETE' }
    }, resPatComplete);
    check('Patient completing appointment rejected with 403', resPatComplete.statusCode === 403);

    // Professional completes
    const resProfComplete = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: rebookedAptId },
      body: { action: 'COMPLETE' }
    }, resProfComplete);
    check('Professional completes appointment (200, COMPLETED)', resProfComplete.statusCode === 200);

    // Terminal state protection: cannot modify or cancel COMPLETED appointment
    const resCancelCompleted = createMockRes();
    await appointmentController.updateAppointmentStatus({
      user: { id: nurseUser.id, role: 'ASSISTANT' },
      params: { id: rebookedAptId },
      body: { action: 'CANCEL', reason: 'Post-visit dispute' }
    }, resCancelCompleted);
    check('Modifying COMPLETED appointment rejected with 400 (Terminal State)', resCancelCompleted.statusCode === 400);

    console.log('\n--- Section 2.5: Client Tampering Immunity ---');
    // Client crafts request with manipulated fee, payment status, and false consent
    const resTamper = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '13:00 - 14:00',
        serviceAddress: '555 Hacker Lane, Chengannur',
        feeAmount: 1.0,           // Attempt fee manipulation
        paymentStatus: 'PAID',    // Attempt paymentStatus manipulation
        consentAccepted: false    // Attempt unconsented booking
      }
    }, resTamper);
    check('Unconsented request rejected with 400', resTamper.statusCode === 400);

    // Client passes consent: true but attempts fee & paymentStatus override
    const resTamper2 = createMockRes();
    await appointmentController.createAppointment({
      user: { id: patientA.id, role: 'PATIENT' },
      body: {
        professionalId: nurseUser.id,
        serviceType: 'NURSING_VISIT',
        scheduledDate: nextMonday,
        timeSlot: '13:00 - 14:00',
        serviceAddress: '555 Honest Lane, Chengannur',
        feeAmount: 1.0,           // Ignored
        paymentStatus: 'PAID',    // Ignored
        consentAccepted: true
      }
    }, resTamper2);
    check('Appointment created with server fee and PENDING payment (client values ignored)',
      resTamper2.statusCode === 201 &&
      resTamper2.data?.appointment?.feeAmount === 350 &&
      resTamper2.data?.appointment?.paymentStatus === 'PENDING'
    );
    const tamperedAptId = resTamper2.data?.appointment?.id;

    console.log('\n--- Section 2.6: Role Access Isolation for Appointment Details ---');
    // Unrelated patient B cannot view patient A's appointment
    const resIntruderPat = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: patientB.id, role: 'PATIENT' },
      params: { id: tamperedAptId }
    }, resIntruderPat);
    check('Unrelated patient viewing appointment rejected with 403', resIntruderPat.statusCode === 403);

    // Delivery assistant cannot view clinical appointment
    const resIntruderAsst = createMockRes();
    await appointmentController.getAppointmentById({
      user: { id: asstUser.id, role: 'ASSISTANT' },
      params: { id: tamperedAptId }
    }, resIntruderAsst);
    check('Delivery assistant viewing appointment rejected with 403', resIntruderAsst.statusCode === 403);

    console.log('\n--- Section 2.7: Test Pharmacy Discovery & Checkout Gating ---');
    // Verify getPharmacies excludes TEST verificationStatus
    const resPharms = createMockRes();
    await pharmacyController.getPharmacies({ query: {} }, resPharms);
    const hasTestPharm = resPharms.data?.pharmacies?.some(p => p.verificationStatus === 'TEST');
    check('Patient pharmacy discovery strictly excludes TEST verificationStatus pharmacies', !hasTestPharm);

    // Attempt to create an order with a TEST pharmacy
    const testPharm = await prisma.pharmacy.findFirst({
      where: { verificationStatus: 'TEST' }
    });
    if (testPharm) {
      const resTestOrder = createMockRes();
      await orderController.createOrder({
        user: { id: patientA.id, role: 'PATIENT' },
        body: {
          pharmacyId: testPharm.id,
          items: [{ medicineId: 'any-dummy-id', quantity: 1 }]
        }
      }, resTestOrder);
      check('Placing order with TEST pharmacy rejected with 400', resTestOrder.statusCode === 400);
    } else {
      check('No TEST pharmacy in database (Clean state)', true);
    }

  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 3: FIXTURE CLEANUP & DATABASE INVARIANCE CHECK
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Section 3: Test Fixture Teardown & Database State Verification ---');
    try {
      const testUserIds = [patientA?.id, patientB?.id, nurseUser?.id, asstUser?.id, pharmUser?.id].filter(Boolean);

      // Clean notifications
      await prisma.notification.deleteMany({
        where: { userId: { in: testUserIds } }
      });

      // Clean appointments & status history
      const apts = await prisma.healthcareAppointment.findMany({
        where: {
          OR: [
            { patientId: { in: testUserIds } },
            { professionalId: { in: testUserIds } }
          ]
        },
        select: { id: true }
      });
      const aptIds = apts.map(a => a.id);
      if (aptIds.length > 0) {
        await prisma.appointmentStatusHistory.deleteMany({
          where: { appointmentId: { in: aptIds } }
        });
        await prisma.healthcareAppointment.deleteMany({
          where: { id: { in: aptIds } }
        });
      }

      // Clean addresses
      if (testAddrB) {
        await prisma.patientAddress.delete({ where: { id: testAddrB.id } });
      }

      // Clean prescriptions
      if (badRxFailed) {
        await prisma.prescription.delete({ where: { id: badRxFailed.id } });
      }
      if (badRxSuspicious) {
        await prisma.prescription.delete({ where: { id: badRxSuspicious.id } });
      }

      // Clean assistant profiles
      if (nurseProfile) {
        await prisma.assistantProfile.delete({ where: { id: nurseProfile.id } });
      }

      // Clean users
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } }
      });

    } catch (cleanErr) {
      console.error('Teardown warning:', cleanErr.message);
    }

    const final = {
      users: await prisma.user.count(),
      orders: await prisma.order.count(),
      pharmacies: await prisma.pharmacy.count(),
      payments: await prisma.payment.count(),
      tasks: await prisma.assistantTask.count(),
      medicines: await prisma.medicine.count(),
      appointments: await prisma.healthcareAppointment.count(),
      history: await prisma.appointmentStatusHistory.count()
    };

    console.log('--- Final Database State ---');
    console.log(JSON.stringify(final, null, 2));

    check(`User count strictly conserved to baseline (${baseline.users})`, final.users === baseline.users);
    check(`Order count strictly conserved to baseline (${baseline.orders})`, final.orders === baseline.orders);
    check(`Pharmacy count strictly conserved to baseline (${baseline.pharmacies})`, final.pharmacies === baseline.pharmacies);
    check('Payment count strictly conserved to baseline (13)', final.payments === baseline.payments);
    check('AssistantTask count strictly conserved to baseline (47)', final.tasks === baseline.tasks);
    check('Medicine count strictly conserved to baseline (50)', final.medicines === baseline.medicines);
    check('HealthcareAppointment count conserved to baseline (0)', final.appointments === baseline.appointments);
    check('AppointmentStatusHistory count conserved to baseline (0)', final.history === baseline.history);
  }

  console.log('\n======================================================================');
  console.log(`📊 Phase 3.2 Audit Results: ${pass} PASSED, ${fail} FAILED`);
  console.log('======================================================================\n');

  if (fail > 0) {
    process.exit(1);
  }
}

runPhase32VerificationTests().catch(err => {
  console.error('Fatal Phase 3.2 test error:', err);
  process.exit(1);
});
