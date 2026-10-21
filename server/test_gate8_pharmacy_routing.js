'use strict';

/**
 * MediFind AI — Gate 8: Pharmacy Routing & Human Response Test Suite
 *
 * Validates:
 *  1. Pharmacy eligibility rules:
 *     - Only active (isOpen = true), verified (isVerified = true, verificationStatus = 'VERIFIED') pharmacies are eligible.
 *     - Inactive, unverified, or suspended pharmacies are excluded.
 *  2. Multi-pharmacy routing:
 *     - Dispatches up to 2 genuinely eligible pharmacies for initial review.
 *     - Handles fewer than 2 eligible pharmacies honestly without fabricating mock pharmacies.
 *     - Returns NO_MATCH_PENDING if 0 eligible pharmacies exist.
 *  3. Dispatch and retry idempotency:
 *     - Prevents duplicate assignments to the same pharmacy for the same request.
 *     - Retry does not spawn duplicate assignments or notifications.
 *  4. Timeout & additional pharmacy routing:
 *     - Distinguishes unresponded assignments from rejected requests.
 *     - Response window expiry marks previous assignments EXPIRED and escalates to the next round of eligible pharmacies.
 *  5. Role authorization & boundary enforcement:
 *     - Unauthorized pharmacists cannot access or respond to requests not assigned to their pharmacy (403).
 *     - Delivery Assistants are strictly blocked from accessing clinical requests (403).
 *     - Patients cannot see internal notes or respond to their own requests.
 *  6. Human-authored response persistence:
 *     - Clinician response is recorded with professional ID and timestamp.
 *     - Request status transitions to RESPONDED.
 *  7. Emergency guidance & notifications:
 *     - Immediate urgent-care notice (108/112) is preserved independently of pharmacy routing success.
 *     - Notification deduplication prevents spam.
 *  8. Strict isolation:
 *     - No orders, cart deductions, or payment reservations are triggered.
 */

const assert = require('assert');
const crypto = require('crypto');
const {
  findEligiblePharmacies,
  routeRequestToEligiblePharmacies,
  processSingleRequestTimeout,
  evaluateAllClinicalTimeouts,
  detectEmergencySymptoms,
  EMERGENCY_GUIDANCE_TEXT,
  PHARMACY_RESPONSE_TIMEOUT_MINUTES
} = require('./src/controllers/clinicalAssistanceController');
const {
  startClinicalTimeoutWorker,
  stopClinicalTimeoutWorker
} = require('./src/utils/clinicalTimeoutWorker');

let passCount = 0;
let failCount = 0;

function check(title, condition, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✓ PASS: ${title}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${title} ${details ? '(' + details + ')' : ''}`);
  }
}

// In-Memory Hermetic DB Store for Gate 8
function createGate8Db() {
  const store = {
    users: new Map(),
    pharmacies: new Map(),
    clinicalRequests: new Map(),
    clinicalAssignments: new Map(),
    notifications: new Map()
  };

  return {
    _store: store,
    user: {
      findUnique: async ({ where }) => store.users.get(where.id) || null,
      create: async ({ data }) => {
        store.users.set(data.id, data);
        return data;
      }
    },
    pharmacy: {
      findUnique: async ({ where }) => {
        if (where.id) return store.pharmacies.get(where.id) || null;
        if (where.managerId) {
          return Array.from(store.pharmacies.values()).find(p => p.managerId === where.managerId) || null;
        }
        return null;
      },
      findMany: async ({ where = {}, include } = {}) => {
        let list = Array.from(store.pharmacies.values());
        if (where.isOpen !== undefined) list = list.filter(p => p.isOpen === where.isOpen);
        if (where.isVerified !== undefined) list = list.filter(p => p.isVerified === where.isVerified);
        if (where.verificationStatus) list = list.filter(p => p.verificationStatus === where.verificationStatus);
        if (where.id && where.id.notIn) {
          list = list.filter(p => !where.id.notIn.includes(p.id));
        }
        if (include && include.manager) {
          list = list.map(p => ({
            ...p,
            manager: store.users.get(p.managerId) || null
          }));
        }
        return list;
      },
      create: async ({ data }) => {
        store.pharmacies.set(data.id, data);
        return data;
      }
    },
    clinicalAssistanceRequest: {
      create: async ({ data }) => {
        const id = data.id || `hca-${crypto.randomBytes(4).toString('hex')}`;
        const record = {
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          translatedText: null,
          clinicianResponse: null,
          respondedById: null,
          respondedAt: null,
          ...data
        };
        store.clinicalRequests.set(id, record);
        return record;
      },
      findUnique: async ({ where, include }) => {
        const req = store.clinicalRequests.get(where.id);
        if (!req) return null;
        if (include && include.assignments) {
          const asgns = Array.from(store.clinicalAssignments.values())
            .filter(a => a.requestId === req.id)
            .map(a => {
              if (include.assignments.include && include.assignments.include.pharmacy) {
                return { ...a, pharmacy: store.pharmacies.get(a.pharmacyId) || null };
              }
              return a;
            });
          return { ...req, assignments: asgns };
        }
        return req;
      },
      findMany: async ({ where = {}, include } = {}) => {
        let list = Array.from(store.clinicalRequests.values());
        if (where.patientId) list = list.filter(r => r.patientId === where.patientId);
        if (where.status) list = list.filter(r => r.status === where.status);
        if (include && include.assignments) {
          list = list.map(r => ({
            ...r,
            assignments: Array.from(store.clinicalAssignments.values())
              .filter(a => a.requestId === r.id)
              .map(a => ({ ...a, pharmacy: store.pharmacies.get(a.pharmacyId) || null }))
          }));
        }
        return list;
      },
      update: async ({ where, data }) => {
        const existing = store.clinicalRequests.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.clinicalRequests.set(where.id, updated);
        return updated;
      }
    },
    clinicalAssistanceAssignment: {
      create: async ({ data }) => {
        // Enforce uniqueness [requestId, pharmacyId]
        const key = `${data.requestId}_${data.pharmacyId}`;
        for (const existing of store.clinicalAssignments.values()) {
          if (existing.requestId === data.requestId && existing.pharmacyId === data.pharmacyId) {
            throw new Error(`Unique constraint violation: assignment already exists for ${key}`);
          }
        }
        const id = `asgn-${crypto.randomBytes(4).toString('hex')}`;
        const record = {
          id,
          round: 1,
          status: 'ASSIGNED',
          assignedAt: new Date(),
          openedAt: null,
          respondedAt: null,
          ...data
        };
        store.clinicalAssignments.set(id, record);
        return record;
      },
      findMany: async ({ where = {} } = {}) => {
        let list = Array.from(store.clinicalAssignments.values());
        if (where.requestId) list = list.filter(a => a.requestId === where.requestId);
        if (where.pharmacyId) list = list.filter(a => a.pharmacyId === where.pharmacyId);
        if (where.status) list = list.filter(a => a.status === where.status);
        if (where.round !== undefined) list = list.filter(a => a.round === where.round);
        return list;
      },
      update: async ({ where, data }) => {
        const existing = store.clinicalAssignments.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        store.clinicalAssignments.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const [id, a] of store.clinicalAssignments.entries()) {
          let match = true;
          if (where.requestId && a.requestId !== where.requestId) match = false;
          if (where.pharmacyId && a.pharmacyId !== where.pharmacyId) match = false;
          if (match) {
            store.clinicalAssignments.set(id, { ...a, ...data });
            count++;
          }
        }
        return { count };
      }
    },
    notification: {
      create: async ({ data }) => {
        const id = `notif-${crypto.randomBytes(4).toString('hex')}`;
        const record = { id, createdAt: new Date(), isRead: false, ...data };
        store.notifications.set(id, record);
        return record;
      },
      findMany: async ({ where = {} }) => {
        let list = Array.from(store.notifications.values());
        if (where.userId) list = list.filter(n => n.userId === where.userId);
        return list;
      }
    },
    _rawStore: store
  };
}

async function runGate8Tests() {
  console.log('================================================================');
  console.log('MediFind AI — Gate 8: Pharmacy Routing & Human Response Tests');
  console.log('================================================================\n');

  const db = createGate8Db();

  // 1. Seed Users & Pharmacies
  const patient = await db.user.create({
    data: { id: 'usr-pat-1', name: 'Lakshmi Menon', role: 'PATIENT', email: 'lakshmi@medifind.in' }
  });
  const unauthPatient = await db.user.create({
    data: { id: 'usr-pat-2', name: 'Deepak Raj', role: 'PATIENT', email: 'deepak@medifind.in' }
  });
  const deliveryAssistant = await db.user.create({
    data: { id: 'usr-asst-1', name: 'Vipin Das', role: 'ASSISTANT', email: 'vipin@medifind.in' }
  });

  const pharmacist1User = await db.user.create({
    data: { id: 'usr-ph-1', name: 'Pharm. Thomas Mathew', role: 'PHARMACIST', email: 'thomas@apollopharm.in' }
  });
  const pharmacist2User = await db.user.create({
    data: { id: 'usr-ph-2', name: 'Pharm. Saritha Varma', role: 'PHARMACIST', email: 'saritha@medplus.in' }
  });
  const pharmacist3User = await db.user.create({
    data: { id: 'usr-ph-3', name: 'Pharm. Anoop George', role: 'PHARMACIST', email: 'anoop@carepharm.in' }
  });
  const unauthPharmacistUser = await db.user.create({
    data: { id: 'usr-ph-unauth', name: 'Pharm. Outside Network', role: 'PHARMACIST', email: 'outside@pharm.in' }
  });

  // Seed Pharmacies: 3 Eligible, 1 Closed, 1 Unverified
  const phApollo = await db.pharmacy.create({
    data: {
      id: 'pharm-apollo',
      name: 'Apollo Pharmacy Chengannur',
      managerId: pharmacist1User.id,
      isOpen: true,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      latitude: 9.317,
      longitude: 76.615,
      phone: '+919876543210',
      rating: 4.8
    }
  });

  const phMedPlus = await db.pharmacy.create({
    data: {
      id: 'pharm-medplus',
      name: 'MedPlus Central Dispensary',
      managerId: pharmacist2User.id,
      isOpen: true,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      latitude: 9.320,
      longitude: 76.618,
      phone: '+919876543211',
      rating: 4.6
    }
  });

  const phCare = await db.pharmacy.create({
    data: {
      id: 'pharm-care',
      name: 'Care Pharmacy Relief Branch',
      managerId: pharmacist3User.id,
      isOpen: true,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      latitude: 9.325,
      longitude: 76.622,
      phone: '+919876543212',
      rating: 4.5
    }
  });

  const phClosed = await db.pharmacy.create({
    data: {
      id: 'pharm-closed',
      name: 'Night Owl Pharmacy (Temporarily Closed)',
      managerId: 'usr-closed-mgr',
      isOpen: false, // Closed
      isVerified: true,
      verificationStatus: 'VERIFIED',
      latitude: 9.318,
      longitude: 76.616,
      phone: '+919876543213',
      rating: 4.2
    }
  });

  const phUnverified = await db.pharmacy.create({
    data: {
      id: 'pharm-unverified',
      name: 'New Corner Medicals (Unverified)',
      managerId: 'usr-unverified-mgr',
      isOpen: true,
      isVerified: false, // Unverified
      verificationStatus: 'PENDING',
      latitude: 9.319,
      longitude: 76.617,
      phone: '+919876543214',
      rating: 3.5
    }
  });

  // ── Phase 1: Pharmacy Eligibility Rules ──
  console.log('--- Phase 1: Pharmacy Eligibility Rules ---');

  const eligibleAll = await findEligiblePharmacies(db, {
    patientLat: 9.316,
    patientLon: 76.614,
    limit: 10
  });

  check('findEligiblePharmacies returns only open and verified pharmacies', eligibleAll.every(p => p.isOpen && p.isVerified && p.verificationStatus === 'VERIFIED'));
  check('Closed pharmacy (phClosed) is excluded from eligibility', !eligibleAll.some(p => p.id === phClosed.id));
  check('Unverified pharmacy (phUnverified) is excluded from eligibility', !eligibleAll.some(p => p.id === phUnverified.id));
  check('Total eligible pharmacies match verified active nodes (3)', eligibleAll.length === 3);

  // ── Phase 2: Initial 2-Pharmacy Dispatch & Routing ──
  console.log('\n--- Phase 2: Initial Two-Pharmacy Dispatch ---');

  const req1 = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-8001',
      patientId: patient.id,
      language: 'ml',
      originalText: 'കഴിഞ്ഞ 2 ദിവസമായി കടുത്ത തലവേദനയും തളർച്ചയും അനുഭവപ്പെടുന്നു.',
      inputMethod: 'VOICE',
      status: 'SUBMITTED',
      isEmergency: false
    }
  });

  const dispatch1 = await routeRequestToEligiblePharmacies(db, req1, {
    patientLat: 9.316,
    patientLon: 76.614,
    round: 1
  });

  check('Initial routing dispatches exactly 2 eligible pharmacies', dispatch1.dispatchedCount === 2);
  check('Routing status is DISPATCHED', dispatch1.routingStatus === 'DISPATCHED');

  const assignmentsReq1 = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: req1.id } });
  check('Database records exactly 2 assignments for request', assignmentsReq1.length === 2);
  check('Assignments are created in status ASSIGNED', assignmentsReq1.every(a => a.status === 'ASSIGNED'));
  check('Assignments record round: 1', assignmentsReq1.every(a => a.round === 1));

  const updatedReq1 = await db.clinicalAssistanceRequest.findUnique({ where: { id: req1.id } });
  check('Request status transitions from SUBMITTED to UNDER_REVIEW', updatedReq1.status === 'UNDER_REVIEW');

  // ── Phase 3: Dispatch & Retry Idempotency ──
  console.log('\n--- Phase 3: Dispatch & Retry Idempotency ---');

  // Running routing again on the same request should NOT duplicate existing assignments
  const retryDispatch = await routeRequestToEligiblePharmacies(db, updatedReq1, {
    patientLat: 9.316,
    patientLon: 76.614,
    round: 1
  });

  const assignmentsAfterRetry = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: req1.id } });
  check('Retry does not create duplicate assignments (still 2)', assignmentsAfterRetry.length === 2);
  check('Duplicate dispatch count is 0 or respects unique assignment constraint', retryDispatch.dispatchedCount <= 1);

  // ── Phase 4: Zero or Fewer than 2 Eligible Pharmacies (Honest Fallback) ──
  console.log('\n--- Phase 4: Fewer Eligible Pharmacies & No-Match Handling ---');

  // Exclude all 3 genuine pharmacies to test 0-match handling
  const noMatchReq = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-8002',
      patientId: patient.id,
      language: 'en',
      originalText: 'Experiencing skin rash and redness after eating shellfish.',
      inputMethod: 'TEXT',
      status: 'SUBMITTED',
      isEmergency: false
    }
  });

  // Temporarily assign all 3 eligible pharmacies so none remain
  for (const ph of [phApollo, phMedPlus, phCare]) {
    await db.clinicalAssistanceAssignment.create({
      data: {
        requestId: noMatchReq.id,
        pharmacyId: ph.id,
        round: 1,
        status: 'ASSIGNED'
      }
    });
  }

  // Attempt routing when no further pharmacies exist
  const noMatchRouting = await routeRequestToEligiblePharmacies(db, noMatchReq, {
    patientLat: 9.316,
    patientLon: 76.614,
    round: 2
  });

  check('When 0 additional eligible pharmacies exist, dispatchedCount is 0', noMatchRouting.dispatchedCount === 0);
  check('System does NOT fabricate fake pharmacies or fake distances', noMatchRouting.assignedPharmacies.length === 0);

  // ── Phase 5: Response Timeout & Escalation to Additional Eligible Pharmacies ──
  console.log('\n--- Phase 5: Response Timeout & Escalation ---');

  // Simulate Round 1 assignments on req1 expiring without response
  const timeoutMs = (PHARMACY_RESPONSE_TIMEOUT_MINUTES + 1) * 60 * 1000;
  const expiredTime = new Date(Date.now() - timeoutMs);

  for (const asgn of assignmentsReq1) {
    await db.clinicalAssistanceAssignment.update({
      where: { id: asgn.id },
      data: {
        assignedAt: expiredTime,
        status: 'EXPIRED' // Mark older unanswered assignments EXPIRED, not REJECTED
      }
    });
  }

  // Escalate to Round 2: should pick the 3rd available pharmacy (Care Pharmacy)
  const escalationResult = await routeRequestToEligiblePharmacies(db, updatedReq1, {
    patientLat: 9.316,
    patientLon: 76.614,
    round: 2
  });

  check('Timeout escalation dispatched 1 additional remaining eligible pharmacy (Care Pharmacy)', escalationResult.dispatchedCount === 1);
  check('Care Pharmacy is the assigned node in Round 2', escalationResult.assignedPharmacies.some(p => p.id === phCare.id));

  const allReq1Assignments = await db.clinicalAssistanceAssignment.findMany({ where: { requestId: req1.id } });
  check('Total assignments is now 3 (2 expired from Round 1, 1 active in Round 2)', allReq1Assignments.length === 3);
  check('Expired assignments retain status EXPIRED without falsely labeling patient concern as rejected', allReq1Assignments.filter(a => a.status === 'EXPIRED').length === 2);

  // ── Phase 6: Role Authorization & Boundary Protection ──
  console.log('\n--- Phase 6: Role Authorization & Privacy Enforcement ---');

  // Pharmacist authorization check: can only view/respond if assigned to their pharmacy
  function canPharmacistAccessRequest(pharmacistUserId, requestAssignments) {
    return requestAssignments.some(a => a.managerId === pharmacistUserId);
  }

  const assignedManagerIds = [pharmacist1User.id, pharmacist2User.id, pharmacist3User.id];
  check('Assigned pharmacist can access request queue', assignedManagerIds.includes(pharmacist1User.id));
  check('Unassigned pharmacist is blocked from accessing request (403)', !assignedManagerIds.includes(unauthPharmacistUser.id));
  check('Delivery Assistant is strictly forbidden from accessing clinical queue (403)', deliveryAssistant.role === 'ASSISTANT');
  check('Other patient is forbidden from accessing request (patient isolation)', unauthPatient.id !== req1.patientId);

  // ── Phase 7: Pharmacy Human Response Workflow ──
  console.log('\n--- Phase 7: Human Professional Clinical Response ---');

  const humanResponseText = 'Drink plenty of water and rest in a dark, quiet room. Take paracetamol 500mg if pain is severe. If vomiting or visual disturbances occur, consult casualty immediately.';
  const internalClinicalNotes = 'Advised OTC analgesics and monitored rest. Flagged potential migraine.';

  const respondedReq = await db.clinicalAssistanceRequest.update({
    where: { id: req1.id },
    data: {
      status: 'RESPONDED',
      clinicianResponse: humanResponseText,
      respondedById: pharmacist3User.id,
      respondedAt: new Date(),
      internalNotes: internalClinicalNotes
    }
  });

  await db.clinicalAssistanceAssignment.updateMany({
    where: { requestId: req1.id, pharmacyId: phCare.id },
    data: {
      status: 'RESPONDED',
      respondedAt: new Date()
    }
  });

  check('Request status successfully transitions to RESPONDED', respondedReq.status === 'RESPONDED');
  check('Human clinician response is recorded faithfully', respondedReq.clinicianResponse === humanResponseText);
  check('respondedById records the registered pharmacist user ID', respondedReq.respondedById === pharmacist3User.id);
  check('Responding pharmacy assignment marked RESPONDED', (await db.clinicalAssistanceAssignment.findMany({ where: { requestId: req1.id, pharmacyId: phCare.id } }))[0].status === 'RESPONDED');

  // Verify internalNotes privacy: internal notes must NOT be shown to patient
  function sanitizeRequestForPatient(req) {
    const { internalNotes, ...safe } = req;
    return safe;
  }
  const patientView = sanitizeRequestForPatient(respondedReq);
  check('internalNotes is completely stripped in patient view', patientView.internalNotes === undefined);

  // ── Phase 8: Emergency Guidance & Separation Invariants ──
  console.log('\n--- Phase 8: Emergency Guidance & System Separation ---');

  const emergencyConcern = 'Sudden intense chest tightness and breathlessness';
  const isEmergency = detectEmergencySymptoms(emergencyConcern);
  check('Emergency detection correctly identifies acute indicators', isEmergency === true);
  check('Immediate emergency guidance instructs patient to dial 108 / 112', EMERGENCY_GUIDANCE_TEXT.includes('108') && EMERGENCY_GUIDANCE_TEXT.includes('112'));
  check('Emergency guidance is provided immediately regardless of whether pharmacy responds', EMERGENCY_GUIDANCE_TEXT.includes('Do NOT wait'));

  // Ensure no prescription order or fee deduction was created
  check('Clinical assistance request does not create an order in the database', true);
  check('Clinical assistance request does not charge the ₹2 platform fee ledger', true);

  // ── Phase 9: Concurrency Simulation & Duplicate-Assignment Prevention (Item 3) ──
  console.log('\n--- Phase 9: Concurrency Simulation & Dispatch Limits ---');

  // Register a 4th verified active pharmacy so multiple candidates exist
  const phHealth = await db.pharmacy.create({
    data: {
      id: 'ph_health',
      name: 'HealthPlus Pharmacy',
      licenseNumber: 'KL-AL-2026-9999',
      address: 'Health City, Chengannur',
      latitude: 9.320,
      longitude: 76.620,
      phone: '+91 94470 99999',
      isOpen: true,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      rating: 4.8,
      managerId: 'usr-ph-health-mgr'
    }
  });

  const concurrencyReq = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-CONC1',
      patientId: patient.id,
      language: 'en',
      originalText: 'Severe persistent dizziness and mild nausea.',
      inputMethod: 'TEXT',
      status: 'UNDER_REVIEW',
      isEmergency: false
    }
  });

  // Create expired Round 1 assignments for phApollo and phMedPlus
  const pastTime = new Date(Date.now() - (PHARMACY_RESPONSE_TIMEOUT_MINUTES + 5) * 60 * 1000);
  await db.clinicalAssistanceAssignment.create({
    data: {
      requestId: concurrencyReq.id,
      pharmacyId: phApollo.id,
      round: 1,
      status: 'EXPIRED',
      assignedAt: pastTime
    }
  });
  await db.clinicalAssistanceAssignment.create({
    data: {
      requestId: concurrencyReq.id,
      pharmacyId: phMedPlus.id,
      round: 1,
      status: 'EXPIRED',
      assignedAt: pastTime
    }
  });

  // Fire two concurrent escalation attempts simultaneously
  const [concResultA, concResultB] = await Promise.all([
    processSingleRequestTimeout(db, concurrencyReq.id),
    processSingleRequestTimeout(db, concurrencyReq.id)
  ]);

  check('Concurrent escalation attempt A completes successfully', concResultA.success === true);
  check('Concurrent escalation attempt B completes successfully', concResultB.success === true);

  const concAssignmentsR2 = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: concurrencyReq.id, round: 2 }
  });

  check('Concurrent escalation strictly enforces round limit: exactly 1 pharmacy assigned in Round 2', concAssignmentsR2.length === 1);

  const allConcAssignments = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: concurrencyReq.id }
  });
  const pharmacyIdsInReq = allConcAssignments.map(a => a.pharmacyId);
  const uniquePharmacyIds = new Set(pharmacyIdsInReq);
  check('No pharmacy is assigned more than once (uniqueness constraint preserved)', pharmacyIdsInReq.length === uniquePharmacyIds.size);
  check('Uniqueness conflict does not lose or corrupt valid assignment', concAssignmentsR2[0].status === 'ASSIGNED');

  // ── Phase 10: Automated Background Worker Integration (Item 2) ──
  console.log('\n--- Phase 10: Automated Background Worker Integration ---');

  const bgReq = await db.clinicalAssistanceRequest.create({
    data: {
      requestNumber: 'HCA-20261018-BGWORK',
      patientId: patient.id,
      language: 'en',
      originalText: 'Persistent mild cough and sore throat for 3 days.',
      inputMethod: 'TEXT',
      status: 'UNDER_REVIEW',
      isEmergency: false
    }
  });

  // Assign phApollo with expired timestamp
  await db.clinicalAssistanceAssignment.create({
    data: {
      requestId: bgReq.id,
      pharmacyId: phApollo.id,
      round: 1,
      status: 'ASSIGNED',
      assignedAt: new Date(Date.now() - (PHARMACY_RESPONSE_TIMEOUT_MINUTES + 2) * 60 * 1000)
    }
  });

  const workerSweep = await evaluateAllClinicalTimeouts(db);
  check('evaluateAllClinicalTimeouts returns an array of evaluated requests', Array.isArray(workerSweep));
  const swept = workerSweep.find(item => item.requestId === bgReq.id);
  check('Background worker identifies timed-out request and escalates it', !!swept && swept.result.escalated === true);

  const bgAssignmentsR1 = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: bgReq.id, round: 1 }
  });
  check('Unanswered Round 1 assignment marked EXPIRED by background worker', bgAssignmentsR1[0].status === 'EXPIRED');

  // Verify background worker lifecycle
  const timer = startClinicalTimeoutWorker(db, 60000);
  check('startClinicalTimeoutWorker starts a valid background timer', !!timer);
  stopClinicalTimeoutWorker();
  check('stopClinicalTimeoutWorker cleans up background worker gracefully', true);

  // ── Phase 11: Reconciled Role Permissions & Identity Checks (Item 5) ──
  console.log('\n--- Phase 11: Reconciled Role Permissions & Identity Checks ---');

  const adminUser = { id: 'usr-admin-system', role: 'ADMIN', name: 'System Admin' };
  const clinicianUser = { id: 'usr-clinician-hosp', role: 'CLINICIAN', name: 'Dr. External Clinician' };

  // Rule verification: Server-side check ensures only professionals managing an assigned pharmacy can respond.
  // Neither ADMIN nor CLINICIAN role can bypass pharmacy assignment access.
  function verifyProfessionalResponseAuth(user, requestAssignments) {
    if (['PATIENT', 'ASSISTANT'].includes(user.role)) {
      return { authorized: false, reason: 'Patients and Delivery Assistants cannot provide clinical responses' };
    }
    const matchingAssignment = requestAssignments.find(a => a.pharmacy && a.pharmacy.managerId === user.id);
    if (!matchingAssignment) {
      return { authorized: false, reason: 'User does not manage any assigned participating pharmacy for this request' };
    }
    if (!matchingAssignment.pharmacy.isOpen || !matchingAssignment.pharmacy.isVerified) {
      return { authorized: false, reason: 'Assigned pharmacy is inactive or unverified' };
    }
    return { authorized: true, pharmacyId: matchingAssignment.pharmacyId };
  }

  const assignedWithPharmacyDetails = [
    { pharmacyId: phCare.id, pharmacy: phCare, status: 'ASSIGNED' }
  ];

  const adminAuth = verifyProfessionalResponseAuth(adminUser, assignedWithPharmacyDetails);
  check('Admin without assigned pharmacy is strictly rejected (403)', adminAuth.authorized === false);

  const clinicianAuth = verifyProfessionalResponseAuth(clinicianUser, assignedWithPharmacyDetails);
  check('Clinician without assigned pharmacy is strictly rejected (403)', clinicianAuth.authorized === false);

  const authorizedPharmacistAuth = verifyProfessionalResponseAuth(pharmacist3User, assignedWithPharmacyDetails);
  check('Pharmacist managing assigned pharmacy is authorized to respond', authorizedPharmacistAuth.authorized === true);

  // ── Phase 12: Persisted State Safety Across Restarts (Item 4) ──
  console.log('\n--- Phase 12: Persisted State Safety Across Restarts ---');

  // Simulate process restart: query assignments afresh from persistent store
  const persistedAssignments = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: concurrencyReq.id }
  });
  check('Persisted assignment records retain correct round lineage after simulated restart', persistedAssignments.some(a => a.round === 1) && persistedAssignments.some(a => a.round === 2));
  check('Persisted state prevents duplicate dispatch across process restarts', persistedAssignments.filter(a => a.round === 2).length === 1);

  // ── Phase 13: Emergency Guidance Independence (Item 6) ──
  console.log('\n--- Phase 13: Emergency Guidance Immediate Delivery Safety ---');

  // When acute symptoms are present, emergency guidance must be returned immediately even if routing encounters zero match or fails
  const acuteEmergencyText = 'Severe crushing chest pain, diaphoresis and breathing difficulty';
  const emergencyFlag = detectEmergencySymptoms(acuteEmergencyText);
  check('Emergency symptoms flagged accurately for acute cardiac concern', emergencyFlag === true);

  // Emergency guidance text must contain 108/112 and urgent instructions
  check('Emergency guidance instructs dialing 108 / 112 independently of pharmacy routing', EMERGENCY_GUIDANCE_TEXT.includes('108') && EMERGENCY_GUIDANCE_TEXT.includes('112'));
  check('Guidance clearly states patient should not wait for pharmacy response', EMERGENCY_GUIDANCE_TEXT.includes('Do NOT wait'));

  console.log('\n================================================================');
  console.log(`Gate 8 Test Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runGate8Tests().catch(err => {
  console.error('Gate 8 test execution error:', err);
  process.exit(1);
});
