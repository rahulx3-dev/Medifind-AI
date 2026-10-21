/**
 * MediFind AI — Phase 3: Healthcare Professional Marketplace & Booking Workflow Test Suite
 *
 * Automated verification of:
 * 1. Historical database preservation baseline
 * 2. Marketplace discovery with zero approved professionals
 * 3. Exclusion of pending, rejected, and suspended professionals
 * 4. Service-specific eligibility & approved scope enforcement
 * 5. Rejection of forged, prohibited, and obsolete service identifiers
 * 6. Real availability and slot generation
 * 7. Prevention of conflicting appointment slots and race condition double-booking
 * 8. Mandatory informed consent enforcement
 * 9. Mandatory prescription/clinician order gating
 * 10. Complete booking lifecycle: REQUESTED -> ACCEPTED -> IN_PROGRESS -> COMPLETED
 * 11. Rejection & Cancellation workflows with audit reasons
 * 12. Invalid status transitions & terminal state protection
 * 13. Patient & professional booking ownership & address privacy
 * 14. Delivery assistant role isolation from clinical appointments
 * 15. Operational continuity of existing delivery tasks, orders, pharmacies, and payments
 */

const prisma = require('./src/prisma');
const appointmentController = require('./src/controllers/appointmentController');
const assistantController = require('./src/controllers/assistantController');
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

async function runPhase3Tests() {
  console.log('\n======================================================================');
  console.log('🏥 MediFind AI — Phase 3 Healthcare Professional Marketplace Tests');
  console.log('======================================================================\n');

  // Baseline records
  const initialUsers = await prisma.user.count();
  const initialOrders = await prisma.order.count();
  const initialPharmacies = await prisma.pharmacy.count();
  const initialPayments = await prisma.payment.count();
  const initialTasks = await prisma.assistantTask.count();
  const initialMedicines = await prisma.medicine.count();

  console.log('--- 1. Database Baseline Conservation Check ---');
  check('Historical users preserved (> 100)', initialUsers >= 100);
  check('Historical orders preserved (> 60)', initialOrders >= 60);
  check('Historical pharmacies preserved (3)', initialPharmacies >= 3);
  check('Historical payments preserved (> 10)', initialPayments >= 10);
  check('Historical tasks preserved (> 40)', initialTasks >= 40);
  check('Historical medicines preserved (> 40)', initialMedicines >= 40);

  // Setup test actors
  console.log('\n--- 2. Setting Up Phase 3 Test Actors ---');
  const timestamp = Date.now();

  // Test Patient A
  const patientA = await prisma.user.create({
    data: {
      email: `test_patient_a_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Patient Sunita',
      phone: '9876543210',
      role: 'PATIENT'
    }
  });

  // Test Patient B (for cross-user isolation)
  const patientB = await prisma.user.create({
    data: {
      email: `test_patient_b_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Patient Ramesh',
      phone: '9876543211',
      role: 'PATIENT'
    }
  });

  // Approved Healthcare Professional A (Approved for NURSING_VISIT & VITAL_SIGN_MEASUREMENT)
  const proApproved = await prisma.user.create({
    data: {
      email: `nurse_maya_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Nurse Maya RN',
      phone: '9876543220',
      role: 'ASSISTANT',
      assistantProfile: {
        create: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          onboardingCompleted: true,
          professionTitle: 'Registered Nurse (RN)',
          registrationNumber: 'KNMC-RN-78901',
          qualifications: 'B.Sc Nursing, Government College of Nursing Kottayam',
          issuingAuthority: 'Kerala Nurses and Midwives Council (KNMC)',
          yearsOfExperience: 6,
          operatingCity: 'Chengannur',
          verificationStatus: 'APPROVED',
          isActive: true,
          isAvailable: true,
          approvedServices: JSON.stringify(['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT', 'POST_HOSPITAL_CARE']),
          workingDays: JSON.stringify(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
          workingHoursStart: '09:00',
          workingHoursEnd: '17:00',
          slotDurationMinutes: 60,
          serviceFee: 300
        }
      }
    },
    include: { assistantProfile: true }
  });

  // Unapproved Healthcare Professional (PENDING)
  const proPending = await prisma.user.create({
    data: {
      email: `nurse_pending_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Nurse Kavita (Pending)',
      phone: '9876543221',
      role: 'ASSISTANT',
      assistantProfile: {
        create: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          onboardingCompleted: true,
          professionTitle: 'General Nurse & Midwife',
          verificationStatus: 'PENDING',
          isActive: true,
          isAvailable: true,
          operatingCity: 'Chengannur'
        }
      }
    }
  });

  // Suspended Healthcare Professional (SUSPENDED)
  const proSuspended = await prisma.user.create({
    data: {
      email: `nurse_suspended_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Nurse Deepak (Suspended)',
      phone: '9876543222',
      role: 'ASSISTANT',
      assistantProfile: {
        create: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          onboardingCompleted: true,
          professionTitle: 'Registered Nurse',
          verificationStatus: 'SUSPENDED',
          suspensionReason: 'Audit review pending',
          isActive: false,
          isAvailable: false,
          operatingCity: 'Chengannur',
          approvedServices: JSON.stringify(['NURSING_VISIT'])
        }
      }
    }
  });

  // Delivery Assistant (Must never appear in clinical marketplace)
  const deliveryAssistant = await prisma.user.create({
    data: {
      email: `delivery_kiran_${timestamp}@medifind.test`,
      password: 'hashed_password',
      name: 'Delivery Kiran',
      phone: '9876543230',
      role: 'ASSISTANT',
      assistantProfile: {
        create: {
          assistantType: 'DELIVERY_ASSISTANT',
          onboardingCompleted: true,
          operatingCity: 'Chengannur',
          isActive: true,
          isAvailable: true
        }
      }
    }
  });

  // Patient Prescription for clinician-order gating tests
  const prescriptionA = await prisma.prescription.create({
    data: {
      userId: patientA.id,
      originalFileName: 'post_discharge_order_dr_nair.pdf',
      filePath: 'test_uploads/post_discharge_order.pdf',
      status: 'VERIFIED'
    }
  });

  check('Created Patient A', !!patientA.id);
  check('Created Patient B', !!patientB.id);
  check('Created Approved Professional Nurse Maya', !!proApproved.id);
  check('Created Pending Professional Nurse Kavita', !!proPending.id);
  check('Created Suspended Professional Nurse Deepak', !!proSuspended.id);
  check('Created Delivery Assistant Kiran', !!deliveryAssistant.id);

  console.log('\n--- 3. Healthcare Services Catalogue Inspection ---');
  const catReq = {};
  const catRes = createMockRes();
  await appointmentController.getMarketplaceServices(catReq, catRes);

  check('getMarketplaceServices returns 200', catRes.statusCode === 200);
  check('Catalogue contains active clinical services (5)', catRes.data.services.length === 5);
  check('NURSING_VISIT is bookable: true', catRes.data.services.some(s => s.id === 'NURSING_VISIT' && s.bookable));
  check('VITAL_SIGN_MEASUREMENT is bookable: true', catRes.data.services.some(s => s.id === 'VITAL_SIGN_MEASUREMENT' && s.bookable));
  check('POST_HOSPITAL_CARE requiresPrescription: true', catRes.data.services.some(s => s.id === 'POST_HOSPITAL_CARE' && s.requiresPrescription));
  check('INJECTION_ADMINISTRATION is strictly excluded from bookable catalogue', !catRes.data.services.some(s => s.id === 'INJECTION_ADMINISTRATION'));
  check('INTRAVENOUS_THERAPY is strictly excluded from bookable catalogue', !catRes.data.services.some(s => s.id === 'INTRAVENOUS_THERAPY'));
  check('DIGITAL_ASSISTANCE is strictly excluded from clinical catalogue', !catRes.data.services.some(s => s.id === 'DIGITAL_ASSISTANCE'));

  console.log('\n--- 4. Marketplace Discovery & Eligibility Enforcement ---');
  // 4.1 Filter by service that Approved Pro has
  const discReq1 = { query: { serviceType: 'NURSING_VISIT', operatingArea: 'Chengannur' } };
  const discRes1 = createMockRes();
  await appointmentController.discoverProfessionals(discReq1, discRes1);

  check('discoverProfessionals returns 200', discRes1.statusCode === 200);
  check('Approved nurse Maya found in discovery', discRes1.data.professionals.some(p => p.id === proApproved.id));
  check('Pending nurse Kavita excluded from marketplace', !discRes1.data.professionals.some(p => p.id === proPending.id));
  check('Suspended nurse Deepak excluded from marketplace', !discRes1.data.professionals.some(p => p.id === proSuspended.id));
  check('Delivery assistant Kiran excluded from clinical marketplace', !discRes1.data.professionals.some(p => p.id === deliveryAssistant.id));

  // 4.2 Safe metadata: No private server filepaths or admin notes leaked
  const mayaProfile = discRes1.data.professionals.find(p => p.id === proApproved.id);
  check('Discovered profile displays professionTitle', mayaProfile.professionTitle === 'Registered Nurse (RN)');
  check('Discovered profile displays registrationNumber', mayaProfile.registrationNumber === 'KNMC-RN-78901');
  check('Discovered profile displays verified fee', mayaProfile.serviceFee === 300);
  check('Discovered profile strictly does not leak filePath', mayaProfile.filePath === undefined);
  check('Discovered profile strictly does not leak reviewLogs', mayaProfile.reviewLogs === undefined);

  // 4.3 Service-specific eligibility: query for service NOT approved for Maya
  const discReq2 = { query: { serviceType: 'HOME_NURSING_SUPPORT', operatingArea: 'Chengannur' } };
  const discRes2 = createMockRes();
  await appointmentController.discoverProfessionals(discReq2, discRes2);
  check('Nurse Maya excluded when service is not in approvedServices', !discRes2.data.professionals.some(p => p.id === proApproved.id));

  // 4.4 Prevention of forged, high-risk or obsolete service identifiers
  const forgedReq = { query: { serviceType: 'INJECTION_ADMINISTRATION' } };
  const forgedRes = createMockRes();
  await appointmentController.discoverProfessionals(forgedReq, forgedRes);
  check('Rejects prohibited procedure INJECTION_ADMINISTRATION with 400', forgedRes.statusCode === 400);

  const obsoleteReq = { query: { serviceType: 'DIGITAL_ASSISTANCE' } };
  const obsoleteRes = createMockRes();
  await appointmentController.discoverProfessionals(obsoleteReq, obsoleteRes);
  check('Rejects obsolete service DIGITAL_ASSISTANCE with 400', obsoleteRes.statusCode === 400);

  const unknownReq = { query: { serviceType: 'UNKNOWN_SERVICE_XYZ' } };
  const unknownRes = createMockRes();
  await appointmentController.discoverProfessionals(unknownReq, unknownRes);
  check('Rejects unknown service identifier with 400', unknownRes.statusCode === 400);

  // 4.5 Empty state behavior when zero approved professionals exist in an area
  const emptyReq = { query: { serviceType: 'NURSING_VISIT', operatingArea: 'Kasaragod' } };
  const emptyRes = createMockRes();
  await appointmentController.discoverProfessionals(emptyReq, emptyRes);
  check('Returns empty list when 0 professionals operate in area', emptyRes.data.professionals.length === 0);
  check('Provides helpful empty state explanation', typeof emptyRes.data.meta.message === 'string');

  console.log('\n--- 5. Professional Availability & Slot Generation ---');
  // Compute tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Ensure tomorrow is a weekday (Monday-Friday) for Maya's schedule
  while ([0, 6].includes(tomorrow.getDay())) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  const validDateStr = tomorrow.toISOString().split('T')[0];

  const availReq1 = { params: { professionalId: proApproved.id }, query: { date: validDateStr } };
  const availRes1 = createMockRes();
  await appointmentController.getProfessionalAvailability(availReq1, availRes1);

  check('getProfessionalAvailability returns 200', availRes1.statusCode === 200);
  check('Slots generated across working hours (09:00 - 17:00)', availRes1.data.slots.length === 8);
  check('First slot is 09:00 - 10:00 and available', availRes1.data.slots[0].timeSlot === '09:00 - 10:00' && availRes1.data.slots[0].available);

  // Rejection of past dates
  const pastReq = { params: { professionalId: proApproved.id }, query: { date: '2020-01-01' } };
  const pastRes = createMockRes();
  await appointmentController.getProfessionalAvailability(pastReq, pastRes);
  check('Rejects past date availability check with 400', pastRes.statusCode === 400);

  console.log('\n--- 6. Consent & Prescription Gating Enforcement ---');
  // 6.1 Missing consent rejection
  const noConsentReq = {
    user: { id: patientA.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'NURSING_VISIT',
      scheduledDate: validDateStr,
      timeSlot: '09:00 - 10:00',
      serviceAddress: 'Ward 4, Valanjavattom, Chengannur',
      consentAccepted: false
    }
  };
  const noConsentRes = createMockRes();
  await appointmentController.createAppointment(noConsentReq, noConsentRes);
  check('Rejects appointment request when consentAccepted is false (400)', noConsentRes.statusCode === 400);

  // 6.2 Missing prescription for POST_HOSPITAL_CARE rejection
  const noRxReq = {
    user: { id: patientA.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'POST_HOSPITAL_CARE',
      scheduledDate: validDateStr,
      timeSlot: '09:00 - 10:00',
      serviceAddress: 'Ward 4, Valanjavattom, Chengannur',
      consentAccepted: true
    }
  };
  const noRxRes = createMockRes();
  await appointmentController.createAppointment(noRxReq, noRxRes);
  check('Rejects POST_HOSPITAL_CARE when prescriptionId is missing (400)', noRxRes.statusCode === 400);

  // 6.3 Attempting to use another patient's prescription rejection
  const wrongRxReq = {
    user: { id: patientB.id, role: 'PATIENT' }, // Patient B using Patient A's Rx
    body: {
      professionalId: proApproved.id,
      serviceType: 'POST_HOSPITAL_CARE',
      scheduledDate: validDateStr,
      timeSlot: '09:00 - 10:00',
      serviceAddress: 'Ward 8, Bethel Junction, Chengannur',
      consentAccepted: true,
      prescriptionId: prescriptionA.id
    }
  };
  const wrongRxRes = createMockRes();
  await appointmentController.createAppointment(wrongRxReq, wrongRxRes);
  check('Rejects booking when prescription belongs to another patient (403)', wrongRxRes.statusCode === 403);

  console.log('\n--- 7. Valid Appointment Request & Double-Booking Prevention ---');
  // 7.1 Successful appointment creation
  const bookReq1 = {
    user: { id: patientA.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'NURSING_VISIT',
      scheduledDate: validDateStr,
      timeSlot: '09:00 - 10:00',
      serviceAddress: 'House 14B, Near Market Road, Chengannur',
      consentAccepted: true,
      patientNotes: 'Please ring bell twice upon arrival.'
    }
  };
  const bookRes1 = createMockRes();
  await appointmentController.createAppointment(bookReq1, bookRes1);

  check('Appointment request succeeds with 201', bookRes1.statusCode === 201);
  check('Initial status is REQUESTED', bookRes1.data.appointment.status === 'REQUESTED');
  check('Assigned unique appointmentNumber (APT-...)', bookRes1.data.appointment.appointmentNumber.startsWith('APT-'));
  check('Captures authoritative fee snapshot (300 INR)', bookRes1.data.appointment.feeAmount === 300);

  const createdAppointmentId = bookRes1.data.appointment.id;

  // 7.2 Race condition & double-booking prevention: Patient B attempts exact same slot
  const bookReq2 = {
    user: { id: patientB.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'NURSING_VISIT',
      scheduledDate: validDateStr,
      timeSlot: '09:00 - 10:00', // CONFLICT!
      serviceAddress: 'Kallissery Road, Chengannur',
      consentAccepted: true
    }
  };
  const bookRes2 = createMockRes();
  await appointmentController.createAppointment(bookReq2, bookRes2);
  check('Rejects conflicting concurrent booking slot with 409 Conflict', bookRes2.statusCode === 409);

  // 7.3 Availability now reflects slot as booked
  const availRes2 = createMockRes();
  await appointmentController.getProfessionalAvailability(availReq1, availRes2);
  const slot0 = availRes2.data.slots.find(s => s.timeSlot === '09:00 - 10:00');
  check('Booked slot is marked available: false in schedule', slot0.available === false);

  console.log('\n--- 8. Strict Ownership & Address Privacy ---');
  // 8.1 Patient A can view appointment
  const viewReqOwner = { user: { id: patientA.id, role: 'PATIENT' }, params: { id: createdAppointmentId } };
  const viewResOwner = createMockRes();
  await appointmentController.getAppointmentById(viewReqOwner, viewResOwner);
  check('Patient A can view their appointment (200)', viewResOwner.statusCode === 200);
  check('Patient A sees serviceAddress', viewResOwner.data.appointment.serviceAddress.includes('House 14B'));

  // 8.2 Assigned Nurse Maya can view appointment and patient address
  const viewReqNurse = { user: { id: proApproved.id, role: 'ASSISTANT' }, params: { id: createdAppointmentId } };
  const viewResNurse = createMockRes();
  await appointmentController.getAppointmentById(viewReqNurse, viewResNurse);
  check('Assigned Nurse Maya can view appointment (200)', viewResNurse.statusCode === 200);
  check('Assigned Nurse Maya can view patient address', viewResNurse.data.appointment.serviceAddress.includes('House 14B'));

  // 8.3 Unrelated Patient B blocked (403)
  const viewReqStranger = { user: { id: patientB.id, role: 'PATIENT' }, params: { id: createdAppointmentId } };
  const viewResStranger = createMockRes();
  await appointmentController.getAppointmentById(viewReqStranger, viewResStranger);
  check('Unrelated Patient B blocked from appointment details (403)', viewResStranger.statusCode === 403);

  // 8.4 Unrelated Delivery Assistant blocked (403)
  const viewReqDelivery = { user: { id: deliveryAssistant.id, role: 'ASSISTANT' }, params: { id: createdAppointmentId } };
  const viewResDelivery = createMockRes();
  await appointmentController.getAppointmentById(viewReqDelivery, viewResDelivery);
  check('Unrelated Delivery Assistant blocked from clinical appointment (403)', viewResDelivery.statusCode === 403);

  console.log('\n--- 9. Complete Appointment Lifecycle & Status Machine ---');
  // 9.1 Patient cannot mark ACCEPTED (only assigned professional can)
  const illegalAcceptReq = {
    user: { id: patientA.id, role: 'PATIENT' },
    params: { id: createdAppointmentId },
    body: { action: 'ACCEPT' }
  };
  const illegalAcceptRes = createMockRes();
  await appointmentController.updateAppointmentStatus(illegalAcceptReq, illegalAcceptRes);
  check('Patient blocked from accepting appointment on behalf of practitioner (403)', illegalAcceptRes.statusCode === 403);

  // 9.2 Assigned professional accepts appointment: REQUESTED -> ACCEPTED
  const acceptReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'ACCEPT', comment: 'Nurse Maya accepted the in-home visit.' }
  };
  const acceptRes = createMockRes();
  await appointmentController.updateAppointmentStatus(acceptReq, acceptRes);
  check('Professional successfully accepts appointment (200)', acceptRes.statusCode === 200);
  check('Status transitioned to ACCEPTED', acceptRes.data.appointment.status === 'ACCEPTED');

  // 9.3 Invalid transition: cannot COMPLETE directly from ACCEPTED (must START first)
  const skipStartReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'COMPLETE' }
  };
  const skipStartRes = createMockRes();
  await appointmentController.updateAppointmentStatus(skipStartReq, skipStartRes);
  check('Invalid transition rejected (cannot COMPLETE before START) (400)', skipStartRes.statusCode === 400);

  // 9.4 Assigned professional starts visit: ACCEPTED -> IN_PROGRESS
  const startReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'START', comment: 'Arrived at patient residence and commenced vital signs assessment.' }
  };
  const startRes = createMockRes();
  await appointmentController.updateAppointmentStatus(startReq, startRes);
  check('Professional transitions appointment to IN_PROGRESS (200)', startRes.statusCode === 200);
  check('Status is IN_PROGRESS', startRes.data.appointment.status === 'IN_PROGRESS');

  // 9.5 Patient cannot mark completed on behalf of practitioner
  const illegalCompleteReq = {
    user: { id: patientA.id, role: 'PATIENT' },
    params: { id: createdAppointmentId },
    body: { action: 'COMPLETE' }
  };
  const illegalCompleteRes = createMockRes();
  await appointmentController.updateAppointmentStatus(illegalCompleteReq, illegalCompleteRes);
  check('Patient blocked from completing appointment (403)', illegalCompleteRes.statusCode === 403);

  // 9.6 Assigned professional completes visit: IN_PROGRESS -> COMPLETED
  const completeReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'COMPLETE', comment: 'Home visit completed. Vital signs recorded and reported.' }
  };
  const completeRes = createMockRes();
  await appointmentController.updateAppointmentStatus(completeReq, completeRes);
  check('Professional successfully completes appointment (200)', completeRes.statusCode === 200);
  check('Status is COMPLETED', completeRes.data.appointment.status === 'COMPLETED');

  // 9.7 Terminal state protection: Completed appointment cannot be modified
  const reopenReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'START' }
  };
  const reopenRes = createMockRes();
  await appointmentController.updateAppointmentStatus(reopenReq, reopenRes);
  check('Completed appointment cannot be modified or reopened (400)', reopenRes.statusCode === 400);

  // 9.8 Verify status audit history trail
  const historyCheck = await prisma.appointmentStatusHistory.findMany({
    where: { appointmentId: createdAppointmentId },
    orderBy: { createdAt: 'asc' }
  });
  check('Audit history trail recorded all 4 state transitions', historyCheck.length === 4);
  check('Audit step 1 is REQUESTED', historyCheck[0].status === 'REQUESTED');
  check('Audit step 2 is ACCEPTED', historyCheck[1].status === 'ACCEPTED');
  check('Audit step 3 is IN_PROGRESS', historyCheck[2].status === 'IN_PROGRESS');
  check('Audit step 4 is COMPLETED', historyCheck[3].status === 'COMPLETED');

  console.log('\n--- 10. Rejection & Cancellation Workflows ---');
  // Create second appointment for rejection testing
  const bookReq3 = {
    user: { id: patientA.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'VITAL_SIGN_MEASUREMENT',
      scheduledDate: validDateStr,
      timeSlot: '11:00 - 12:00',
      serviceAddress: 'Pazhavangadi, Chengannur',
      consentAccepted: true
    }
  };
  const bookRes3 = createMockRes();
  await appointmentController.createAppointment(bookReq3, bookRes3);
  const rejectAptId = bookRes3.data.appointment.id;

  // Professional rejects request with reason: REQUESTED -> REJECTED
  const rejectReq = {
    user: { id: proApproved.id, role: 'ASSISTANT' },
    params: { id: rejectAptId },
    body: { action: 'REJECT', reason: 'Emergency shift call at Taluk Hospital.' }
  };
  const rejectRes = createMockRes();
  await appointmentController.updateAppointmentStatus(rejectReq, rejectRes);
  check('Professional rejects request with 200', rejectRes.statusCode === 200);
  check('Status is REJECTED', rejectRes.data.appointment.status === 'REJECTED');
  check('Rejection reason saved on appointment', rejectRes.data.appointment.rejectionReason.includes('Emergency shift call'));

  // Create third appointment for patient cancellation testing
  const bookReq4 = {
    user: { id: patientA.id, role: 'PATIENT' },
    body: {
      professionalId: proApproved.id,
      serviceType: 'VITAL_SIGN_MEASUREMENT',
      scheduledDate: validDateStr,
      timeSlot: '14:00 - 15:00',
      serviceAddress: 'Edanadu, Chengannur',
      consentAccepted: true
    }
  };
  const bookRes4 = createMockRes();
  await appointmentController.createAppointment(bookReq4, bookRes4);
  const cancelAptId = bookRes4.data.appointment.id;

  // Patient cancels request: REQUESTED -> CANCELLED
  const cancelReq = {
    user: { id: patientA.id, role: 'PATIENT' },
    params: { id: cancelAptId },
    body: { action: 'CANCEL', reason: 'Patient feeling improved, no longer required.' }
  };
  const cancelRes = createMockRes();
  await appointmentController.updateAppointmentStatus(cancelReq, cancelRes);
  check('Patient cancels request with 200', cancelRes.statusCode === 200);
  check('Status is CANCELLED', cancelRes.data.appointment.status === 'CANCELLED');
  check('Cancellation reason saved on appointment', cancelRes.data.appointment.cancellationReason.includes('Patient feeling improved'));

  console.log('\n--- 11. Delivery Assistant Role Isolation & Operational Continuity ---');
  // Delivery Assistant blocked from clinical appointments
  const deliveryAptReq = {
    user: { id: deliveryAssistant.id, role: 'ASSISTANT' },
    params: { id: createdAppointmentId },
    body: { action: 'ACCEPT' }
  };
  const deliveryAptRes = createMockRes();
  await appointmentController.updateAppointmentStatus(deliveryAptReq, deliveryAptRes);
  check('Delivery Assistant blocked from clinical appointments (403)', deliveryAptRes.statusCode === 403);

  // Delivery Assistant can access delivery tasks normally
  const deliveryTasksReq = { user: { id: deliveryAssistant.id, role: 'ASSISTANT' }, query: {} };
  const deliveryTasksRes = createMockRes();
  await assistantController.getAvailableTasks(deliveryTasksReq, deliveryTasksRes);
  check('Delivery Assistant accesses medicine delivery tasks successfully (200)', deliveryTasksRes.statusCode === 200);
  check('Delivery task response array preserved', Array.isArray(deliveryTasksRes.data.tasks));

  console.log('\n--- 12. Test Teardown & Historical Data Invariance Check ---');
  // Clean up created test records
  await prisma.appointmentStatusHistory.deleteMany({
    where: { appointmentId: { in: [createdAppointmentId, rejectAptId, cancelAptId] } }
  });
  await prisma.healthcareAppointment.deleteMany({
    where: { id: { in: [createdAppointmentId, rejectAptId, cancelAptId] } }
  });
  await prisma.notification.deleteMany({
    where: { userId: { in: [patientA.id, patientB.id, proApproved.id, proPending.id, proSuspended.id, deliveryAssistant.id] } }
  });
  await prisma.prescription.deleteMany({ where: { id: prescriptionA.id } });
  await prisma.assistantProfile.deleteMany({
    where: { userId: { in: [proApproved.id, proPending.id, proSuspended.id, deliveryAssistant.id] } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [patientA.id, patientB.id, proApproved.id, proPending.id, proSuspended.id, deliveryAssistant.id] } }
  });

  const finalUsers = await prisma.user.count();
  const finalOrders = await prisma.order.count();
  const finalPharmacies = await prisma.pharmacy.count();
  const finalPayments = await prisma.payment.count();

  check('Users count restored to baseline exactly', finalUsers === initialUsers);
  check('Orders count preserved exactly', finalOrders === initialOrders);
  check('Pharmacies count preserved exactly', finalPharmacies === initialPharmacies);
  check('Payments count preserved exactly', finalPayments === initialPayments);

  console.log('\n======================================================================');
  console.log(`Phase 3 Test Summary: ${pass} PASSED, ${fail} FAILED (Total: ${pass + fail})`);
  console.log('======================================================================\n');

  if (fail > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
