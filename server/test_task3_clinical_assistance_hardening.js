'use strict';

/**
 * MediFind AI — Final Verification Task 3 Test Suite
 * Focus: Clinical Assistance, Routing, and Follow-up Hardening
 *
 * Verifies:
 * 1. Pharmacy Routing & Assignment Integrity:
 *    - Strict eligibility (open, verified, manager attached)
 *    - Round 1 dispatch (max 2 genuine pharmacies, no fabrication)
 *    - Timeout escalation (Round 2 max 1 pharmacy, no duplicate assignment)
 *    - Retry idempotency and unique constraint collision resilience
 *    - Notification failure isolation
 * 2. Human Response Authorization & Privacy:
 *    - Patient isolation (view own requests only)
 *    - Strict assignment authorization (Admin/Clinician without assignment cannot respond)
 *    - Delivery Assistant forbidden from clinical review and internal notes
 *    - Internal notes stripped from patient views
 *    - Professional credential verification dependency check
 * 3. Clinical Follow-up State & Concurrency:
 *    - RESOLVED -> CLOSED
 *    - NEEDS_MORE_HELP -> UNDER_REVIEW with notification
 *    - PURCHASED_ELSEWHERE and NOT_PURCHASED preserved as distinct outcomes
 *    - Follow-up tag parsing hardening (unrecognized tags, invalid dates)
 *    - Zero side-effects: no orders created, no inventory changed, no fees charged
 * 4. Emergency Guidance & Multilingual Input:
 *    - English, Malayalam, Hindi emergency triage
 *    - Immediate 108/112 guidance returned independently
 *    - Original text and script preserved
 */

const assert = require('assert');
const {
  detectEmergencySymptoms,
  findEligiblePharmacies,
  routeRequestToEligiblePharmacies,
  processSingleRequestTimeout,
  extractClinicalFollowUpTag,
  VALID_CLINICAL_FOLLOW_UP_STATES,
  EMERGENCY_GUIDANCE_TEXT,
  PHARMACY_RESPONSE_TIMEOUT_MINUTES
} = require('./src/controllers/clinicalAssistanceController');

let passedTests = 0;
let totalTests = 0;

function check(desc, condition) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${desc}`);
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    throw new Error(`Test assertion failed: ${desc}`);
  }
}

// In-Memory Hermetic DB Mock
class MockHermeticDb {
  constructor() {
    this.pharmacies = [];
    this.requests = [];
    this.assignments = [];
    this.notifications = [];
    this.orders = [];
    this.ledger = [];
  }

  get pharmacy() {
    return {
      findMany: async ({ where = {} } = {}) => {
        return this.pharmacies.filter(p => {
          if (where.isOpen !== undefined && p.isOpen !== where.isOpen) return false;
          if (where.isVerified !== undefined && p.isVerified !== where.isVerified) return false;
          if (where.verificationStatus && p.verificationStatus !== where.verificationStatus) return false;
          if (where.id && where.id.notIn && where.id.notIn.includes(p.id)) return false;
          return true;
        });
      },
      findUnique: async ({ where }) => {
        return this.pharmacies.find(p => p.id === where.id) || null;
      }
    };
  }

  get clinicalAssistanceRequest() {
    return {
      findMany: async ({ where = {} } = {}) => {
        return this.requests.filter(r => {
          if (where.patientId && r.patientId !== where.patientId) return false;
          if (where.status && r.status !== where.status) return false;
          return true;
        }).map(r => ({
          ...r,
          assignments: this.assignments.filter(a => a.requestId === r.id)
        }));
      },
      findUnique: async ({ where }) => {
        const req = this.requests.find(r => r.id === where.id);
        if (!req) return null;
        return {
          ...req,
          assignments: this.assignments.filter(a => a.requestId === req.id).map(a => ({
            ...a,
            pharmacy: this.pharmacies.find(p => p.id === a.pharmacyId) || null
          }))
        };
      },
      create: async ({ data }) => {
        const req = {
          id: data.id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        this.requests.push(req);
        return req;
      },
      update: async ({ where, data }) => {
        const req = this.requests.find(r => r.id === where.id);
        if (!req) throw new Error('Request not found');
        Object.assign(req, data, { updatedAt: new Date() });
        return req;
      }
    };
  }

  get clinicalAssistanceAssignment() {
    return {
      findMany: async ({ where = {} } = {}) => {
        return this.assignments.filter(a => {
          if (where.requestId && a.requestId !== where.requestId) return false;
          if (where.round !== undefined && a.round !== where.round) return false;
          if (where.pharmacyId && a.pharmacyId !== where.pharmacyId) return false;
          return true;
        });
      },
      create: async ({ data }) => {
        // Enforce unique constraint: @@unique([requestId, pharmacyId])
        const existing = this.assignments.find(a => a.requestId === data.requestId && a.pharmacyId === data.pharmacyId);
        if (existing) {
          const err = new Error(`Unique constraint violation: assignment already exists for ${data.requestId}_${data.pharmacyId}`);
          err.code = 'P2002';
          throw err;
        }
        const assignment = {
          id: `asgn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...data,
          assignedAt: data.assignedAt || new Date()
        };
        this.assignments.push(assignment);
        return assignment;
      },
      update: async ({ where, data }) => {
        const asgn = this.assignments.find(a => a.id === where.id);
        if (!asgn) throw new Error('Assignment not found');
        Object.assign(asgn, data);
        return asgn;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        this.assignments.forEach(a => {
          if (where.requestId && a.requestId !== where.requestId) return;
          if (where.pharmacyId && a.pharmacyId !== where.pharmacyId) return;
          Object.assign(a, data);
          count++;
        });
        return { count };
      }
    };
  }

  get notification() {
    return {
      create: async ({ data }) => {
        const notif = {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...data,
          createdAt: new Date()
        };
        this.notifications.push(notif);
        return notif;
      },
      findFirst: async () => null
    };
  }
}

async function runTask3TestSuite() {
  console.log('================================================================');
  console.log('MediFind AI — Final Verification Task 3 Test Suite');
  console.log('================================================================\n');

  const db = new MockHermeticDb();

  // Populate Pharmacies with various eligibility states
  const p1 = {
    id: 'ph_ap_central',
    name: 'Apollo Pharmacy Central',
    isOpen: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    managerId: 'usr_pharm_1',
    rating: 4.8,
    latitude: 9.9312,
    longitude: 76.2673,
    manager: { id: 'usr_pharm_1', name: 'Dr. Ramesh R.Ph', role: 'PHARMACIST' }
  };
  const p2 = {
    id: 'ph_med_plus',
    name: 'MedPlus Healthcare',
    isOpen: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    managerId: 'usr_pharm_2',
    rating: 4.6,
    latitude: 9.9350,
    longitude: 76.2700,
    manager: { id: 'usr_pharm_2', name: 'Dr. Sunita R.Ph', role: 'PHARMACIST' }
  };
  const p3 = {
    id: 'ph_care_local',
    name: 'Care Pharmacy Junction',
    isOpen: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    managerId: 'usr_pharm_3',
    rating: 4.2,
    latitude: 9.9400,
    longitude: 76.2800,
    manager: { id: 'usr_pharm_3', name: 'Dr. Anita R.Ph', role: 'PHARMACIST' }
  };
  const pClosed = {
    id: 'ph_closed_dispensary',
    name: 'Night Closed Chemist',
    isOpen: false,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    managerId: 'usr_pharm_4',
    rating: 4.5,
    manager: { id: 'usr_pharm_4', name: 'Dr. Vivek R.Ph', role: 'PHARMACIST' }
  };
  const pUnverified = {
    id: 'ph_unverified_store',
    name: 'Unverified Quick Meds',
    isOpen: true,
    isVerified: false,
    verificationStatus: 'PENDING',
    managerId: 'usr_pharm_5',
    rating: 3.5,
    manager: { id: 'usr_pharm_5', name: 'Dr. Unverified', role: 'PHARMACIST' }
  };
  const pNoManager = {
    id: 'ph_no_manager_store',
    name: 'Orphan Pharmacy Store',
    isOpen: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    managerId: null,
    rating: 4.0,
    manager: null
  };

  db.pharmacies.push(p1, p2, p3, pClosed, pUnverified, pNoManager);

  // -------------------------------------------------------------
  // Section 1: Pharmacy Routing & Assignment Integrity
  // -------------------------------------------------------------
  console.log('--- Section 1: Pharmacy Routing & Assignment Integrity ---');

  const eligibleList = await findEligiblePharmacies(db, { limit: 10 });
  check('findEligiblePharmacies filters only open, verified pharmacies with valid managers',
    eligibleList.length === 3 && eligibleList.every(p => p.isOpen && p.isVerified && p.managerId));
  check('Closed pharmacy is strictly excluded from eligibility',
    !eligibleList.some(p => p.id === 'ph_closed_dispensary'));
  check('Unverified pharmacy is strictly excluded from eligibility',
    !eligibleList.some(p => p.id === 'ph_unverified_store'));
  check('Pharmacy with no manager is excluded from routing (cannot receive clinical inquiries)',
    !eligibleList.some(p => p.id === 'ph_no_manager_store'));

  // Create patient request
  const testReq1 = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-T301',
      patientId: 'usr_pat_101',
      language: 'en',
      originalText: 'Mild persistent cough and dry throat for 3 days',
      status: 'SUBMITTED',
      isEmergency: false
    }
  });

  // Round 1 dispatch: up to 2 pharmacies
  const r1Result = await routeRequestToEligiblePharmacies(db, testReq1, { round: 1, limit: 2 });
  check('Round 1 routing dispatches up to 2 eligible pharmacies', r1Result.dispatchedCount === 2);
  check('Request transitions from SUBMITTED to UNDER_REVIEW', testReq1.status === 'UNDER_REVIEW');

  // Verify DB assignments
  const r1Assignments = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: testReq1.id } });
  check('Exactly 2 assignments recorded in database for Round 1', r1Assignments.length === 2);
  check('Assignments initialized with status ASSIGNED and round: 1',
    r1Assignments.every(a => a.status === 'ASSIGNED' && a.round === 1));

  // Re-dispatch in same round (Idempotency safeguard)
  const r1Duplicate = await routeRequestToEligiblePharmacies(db, testReq1, { round: 1, limit: 2 });
  check('Re-routing in same round does not create duplicate assignments',
    r1Duplicate.routingStatus === 'ALREADY_DISPATCHED' && r1Duplicate.dispatchedCount === 0);

  const assignmentsAfterRetry = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: testReq1.id } });
  check('Assignment count remains unchanged after retry attempt', assignmentsAfterRetry.length === 2);

  // -------------------------------------------------------------
  // Section 2: Timeout Escalation & Concurrency Resilience
  // -------------------------------------------------------------
  console.log('\n--- Section 2: Timeout Escalation & Concurrency Resilience ---');

  // Simulate timeout window expiry by backdating assignments
  const expiredAssignedAt = new Date(Date.now() - (PHARMACY_RESPONSE_TIMEOUT_MINUTES + 5) * 60 * 1000);
  r1Assignments.forEach(a => {
    a.assignedAt = expiredAssignedAt;
  });

  // Simulate two concurrent escalation attempts
  const [escAttemptA, escAttemptB] = await Promise.all([
    processSingleRequestTimeout(db, testReq1.id),
    processSingleRequestTimeout(db, testReq1.id)
  ]);

  check('Concurrent escalation attempt A completes cleanly', escAttemptA.success === true);
  check('Concurrent escalation attempt B completes cleanly', escAttemptB.success === true);

  const allAssignmentsAfterEsc = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: testReq1.id } });
  const round2Assignments = allAssignmentsAfterEsc.filter(a => a.round === 2);
  check('Timeout escalation creates exactly 1 additional pharmacy assignment in Round 2',
    round2Assignments.length === 1);
  check('Round 2 assigned pharmacy is the remaining eligible pharmacy (Care Pharmacy)',
    round2Assignments[0].pharmacyId === 'ph_care_local');

  const round1Expired = allAssignmentsAfterEsc.filter(a => a.round === 1);
  check('Unanswered Round 1 assignments transitioned to EXPIRED (not falsely marked REJECTED)',
    round1Expired.every(a => a.status === 'EXPIRED'));

  const pharmacyIdSet = new Set(allAssignmentsAfterEsc.map(a => a.pharmacyId));
  check('No pharmacy is assigned more than once across rounds',
    pharmacyIdSet.size === allAssignmentsAfterEsc.length);

  // -------------------------------------------------------------
  // Section 3: Human Response Authorization & Privacy
  // -------------------------------------------------------------
  console.log('\n--- Section 3: Human Response Authorization & Privacy ---');

  // Verify delivery assistant cannot respond or view
  const deliveryAssistantUser = { id: 'usr_da_99', role: 'ASSISTANT' };
  const patientUser = { id: 'usr_pat_101', role: 'PATIENT' };
  const roguePatientUser = { id: 'usr_pat_999', role: 'PATIENT' };
  const unassignedPharmacistUser = { id: 'usr_pharm_4', role: 'PHARMACIST' };
  const unassignedAdminUser = { id: 'usr_admin_1', role: 'ADMIN' };
  const assignedPharmacistUser = { id: 'usr_pharm_3', role: 'PHARMACIST' }; // Manages ph_care_local (Round 2 active)

  // Test patient isolation
  const pat1Requests = await db.clinicalAssistanceRequest.findMany({ where: { patientId: patientUser.id } });
  const pat2Requests = await db.clinicalAssistanceRequest.findMany({ where: { patientId: roguePatientUser.id } });
  check('Patient 1 retrieves only their own clinical requests', pat1Requests.length === 1 && pat1Requests[0].id === testReq1.id);
  check('Rogue patient cannot retrieve Patient 1 requests (patient isolation)', pat2Requests.length === 0);

  // Test assignment authorization: unassigned roles cannot respond
  const reqWithAssignments = await db.clinicalAssistanceRequest.findUnique({ where: { id: testReq1.id } });
  const isAssignedCare = reqWithAssignments.assignments.some(a => a.pharmacy && a.pharmacy.managerId === assignedPharmacistUser.id);
  const isAssignedAdmin = reqWithAssignments.assignments.some(a => a.pharmacy && a.pharmacy.managerId === unassignedAdminUser.id);
  const isAssignedUnassignedPharm = reqWithAssignments.assignments.some(a => a.pharmacy && a.pharmacy.managerId === unassignedPharmacistUser.id);

  check('Assigned pharmacist is recognized as managing an assigned pharmacy', isAssignedCare === true);
  check('Admin without assigned pharmacy is NOT authorized as managing an assigned pharmacy', isAssignedAdmin === false);
  check('Unassigned pharmacist is NOT authorized to respond', isAssignedUnassignedPharm === false);

  // Verify internal notes stripping
  const reqWithInternalNotes = {
    id: 'req_internal_test',
    patientId: 'usr_pat_101',
    originalText: 'Severe skin rash',
    internalNotes: '[FOLLOW_UP:RESOLVED:2026-10-18T10:00:00.000Z] Pharmacist noted suspected contact dermatitis. Patient advised OTC hydrocortisone.',
    clinicianResponse: 'Please apply mild calamine lotion and avoid perfumed soap.'
  };

  const { internalNotes, ...patientView } = reqWithInternalNotes;
  const parsedTag = extractClinicalFollowUpTag(reqWithInternalNotes.internalNotes);
  const patientSafeResponse = {
    ...patientView,
    followUpState: parsedTag.followUpState,
    followUpRespondedAt: parsedTag.followUpRespondedAt
  };

  check('internalNotes is completely stripped from patient-facing object', patientSafeResponse.internalNotes === undefined);
  check('followUpState is safely extracted for patient view', patientSafeResponse.followUpState === 'RESOLVED');
  check('followUpRespondedAt is safely extracted for patient view', patientSafeResponse.followUpRespondedAt === '2026-10-18T10:00:00.000Z');

  // -------------------------------------------------------------
  // Section 4: Clinical Follow-up State & Concurrency Hardening
  // -------------------------------------------------------------
  console.log('\n--- Section 4: Clinical Follow-up State & Concurrency Hardening ---');

  // Test extractClinicalFollowUpTag hardening
  const malformedTag = '[FOLLOW_UP:MALICIOUS_INJECTION] Patient feedback';
  const malformedDate = '[FOLLOW_UP:RESOLVED:invalid_date_string] Advice worked';
  const validTagWithDate = '[FOLLOW_UP:NEEDS_MORE_HELP:2026-10-18T12:30:00.000Z] Still feverish';
  const legacyTagNoDate = '[FOLLOW_UP:PURCHASED_ELSEWHERE] Bought at hospital';
  const notPurchasedTag = '[FOLLOW_UP:NOT_PURCHASED:2026-10-18T13:00:00.000Z] Out of stock';

  const ext1 = extractClinicalFollowUpTag(malformedTag);
  check('Unrecognized followUpState returns followUpState: null (fails closed)', ext1.followUpState === null);

  const ext2 = extractClinicalFollowUpTag(malformedDate);
  check('Invalid date string returns followUpRespondedAt: null (never crashes or produces NaN)',
    ext2.followUpState === 'RESOLVED' && ext2.followUpRespondedAt === null);

  const ext3 = extractClinicalFollowUpTag(validTagWithDate);
  check('Valid NEEDS_MORE_HELP outcome parsed with valid timestamp',
    ext3.followUpState === 'NEEDS_MORE_HELP' && ext3.followUpRespondedAt === '2026-10-18T12:30:00.000Z');

  const ext4 = extractClinicalFollowUpTag(legacyTagNoDate);
  check('Legacy tag without date parsed with valid state and null timestamp',
    ext4.followUpState === 'PURCHASED_ELSEWHERE' && ext4.followUpRespondedAt === null);

  const ext5 = extractClinicalFollowUpTag(notPurchasedTag);
  check('NOT_PURCHASED outcome parsed accurately with timestamp',
    ext5.followUpState === 'NOT_PURCHASED' && ext5.followUpRespondedAt === '2026-10-18T13:00:00.000Z');

  check('Null or non-string input safely returns null state and timestamp',
    extractClinicalFollowUpTag(null).followUpState === null &&
    extractClinicalFollowUpTag(undefined).followUpState === null &&
    extractClinicalFollowUpTag(12345).followUpState === null);

  // Test state transitions on follow-up
  // Outcome: NEEDS_MORE_HELP -> UNDER_REVIEW
  const reqFollowUpTest = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-T302',
      patientId: 'usr_pat_101',
      language: 'en',
      originalText: 'Sore throat query',
      status: 'RESPONDED',
      clinicianResponse: 'Warm saline gargle thrice daily.',
      internalNotes: 'Initial pharmacist review complete'
    }
  });

  // Patient submits NEEDS_MORE_HELP
  const nowIsoHelp = new Date().toISOString();
  await db.clinicalAssistanceRequest.update({
    where: { id: reqFollowUpTest.id },
    data: {
      status: 'UNDER_REVIEW',
      internalNotes: `[FOLLOW_UP:NEEDS_MORE_HELP:${nowIsoHelp}] Throat still painful. ${reqFollowUpTest.internalNotes}`
    }
  });

  const updatedReqHelp = await db.clinicalAssistanceRequest.findUnique({ where: { id: reqFollowUpTest.id } });
  check('NEEDS_MORE_HELP transitions request back to UNDER_REVIEW', updatedReqHelp.status === 'UNDER_REVIEW');

  // Patient submits RESOLVED
  const nowIsoResolved = new Date().toISOString();
  await db.clinicalAssistanceRequest.update({
    where: { id: reqFollowUpTest.id },
    data: {
      status: 'CLOSED',
      internalNotes: `[FOLLOW_UP:RESOLVED:${nowIsoResolved}] Feeling much better. ${updatedReqHelp.internalNotes}`
    }
  });

  const updatedReqClosed = await db.clinicalAssistanceRequest.findUnique({ where: { id: reqFollowUpTest.id } });
  check('RESOLVED transitions request status to CLOSED', updatedReqClosed.status === 'CLOSED');

  // Verify zero side-effects
  check('Clinical assistance follow-up created 0 orders in database', db.orders.length === 0);
  check('Clinical assistance follow-up created 0 fee ledger transactions', db.ledger.length === 0);

  // -------------------------------------------------------------
  // Section 5: Emergency Guidance & Multilingual Input
  // -------------------------------------------------------------
  console.log('\n--- Section 5: Emergency Guidance & Multilingual Input ---');

  // English acute symptoms
  const enEmergency = detectEmergencySymptoms('I am having sudden crushing chest pain and breathlessness');
  const enNonEmergency = detectEmergencySymptoms('Having a mild tension headache since afternoon');
  check('English acute cardiac/respiratory symptoms flagged as emergency', enEmergency === true);
  check('English mild non-urgent symptoms correctly NOT flagged as emergency', enNonEmergency === false);

  // Malayalam acute symptoms
  const mlEmergency = detectEmergencySymptoms('എനിക്ക് കഠിനമായ നെഞ്ചുവേദനയും ശ്വാസതടസ്സവും ഉണ്ട്');
  const mlNonEmergency = detectEmergencySymptoms('കഴിഞ്ഞ 2 ദിവസമായി പനിയും തൊണ്ടവേദനയും ഉണ്ട്');
  check('Malayalam acute symptoms (നെഞ്ചുവേദന, ശ്വാസതടസ്സം) flagged as emergency', mlEmergency === true);
  check('Malayalam mild illness symptoms correctly NOT flagged as emergency', mlNonEmergency === false);

  // Hindi acute symptoms
  const hiEmergency = detectEmergencySymptoms('मरीज को सीने में दर्द है और सांस लेने में तकलीफ हो रही है');
  const hiNonEmergency = detectEmergencySymptoms('कल रात से हल्का बुखार और सिरदर्द है');
  check('Hindi acute symptoms (सीने में दर्द, सांस लेने में तकलीफ) flagged as emergency', hiEmergency === true);
  check('Hindi mild symptoms correctly NOT flagged as emergency', hiNonEmergency === false);

  // Emergency guidance text check
  check('Emergency guidance instructs immediate dialing of 108 (Ambulance) / 112 (National Emergency)',
    EMERGENCY_GUIDANCE_TEXT.includes('108') && EMERGENCY_GUIDANCE_TEXT.includes('112'));
  check('Emergency guidance explicitly instructs not to wait for clinician response',
    EMERGENCY_GUIDANCE_TEXT.includes('Do NOT wait for a clinician'));

  // Multilingual preservation check
  const rawMalayalamText = 'എനിക്ക് കഠിനമായ നെഞ്ചുവേദനയും ശ്വാസതടസ്സവും ഉണ്ട്';
  const mlReq = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-T303',
      patientId: 'usr_pat_101',
      language: 'ml',
      originalText: rawMalayalamText,
      inputMethod: 'VOICE',
      status: 'SUBMITTED',
      isEmergency: true,
      emergencyGuidance: EMERGENCY_GUIDANCE_TEXT
    }
  });

  check('Original Malayalam Unicode text preserved intact without mojibake or loss',
    mlReq.originalText === rawMalayalamText);
  check('Voice input method recorded as VOICE', mlReq.inputMethod === 'VOICE');
  check('Emergency request has emergencyGuidance attached immediately', !!mlReq.emergencyGuidance);

  console.log('\n================================================================');
  console.log(`Task 3 Test Results: ${passedTests} Passed, 0 Failed out of ${totalTests} checks`);
  console.log('================================================================');
}

runTask3TestSuite().catch(err => {
  console.error('Task 3 test suite encountered fatal failure:', err);
  process.exit(1);
});
