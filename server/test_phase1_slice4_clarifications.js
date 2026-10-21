/**
 * MediFind AI — Phase 1, Step 11M: Slice 4 Pharmacy Clarification Unit & Regression Tests
 *
 * Tests:
 * 1. Authorized pharmacist creates a clarification for their own pharmacy's order (201 Created).
 * 2. Cross-pharmacy pharmacist access is rejected with 403 Forbidden.
 * 3. Patient can retrieve and respond to their own clarification (200 OK, PENDING -> RESPONDED).
 * 4. Cross-patient access is rejected with 403 Forbidden.
 * 5. ASSISTANT is denied all clarification endpoints with 403 Forbidden.
 * 6. Orders without prescriptions and mismatched prescription/patient relationships are rejected (400 Bad Request).
 * 7. Empty, undersized, and oversized questions/responses are rejected (400 Bad Request).
 * 8. Duplicate active-question submissions on the same order are rejected (409 Conflict).
 * 9. Concurrent creation requests serialize under the modeled parent-order lock [Mocked Concurrency].
 * 10. Identical response retries are idempotent (200 OK); conflicting retries return 409 Conflict.
 * 11. Resolved clarifications cannot be modified contrary to the status policy (409 Conflict).
 * 12. Clarification actions do not mutate order, payment, inventory, or prescription-verification state.
 * 13. Missing Prisma delegates use safe parameterized SQL with bound positional parameters.
 * 14. Notification failures do not undo a successfully committed clarification.
 * 15. Pharmacist directly resolves a clarification from PENDING to RESOLVED (200 OK).
 * 16. ADMIN authorization for create, view, respond, and resolve succeeds.
 * 17. Delegate fallback where root Prisma client has clarification delegate but transaction client does not.
 * 18. Raw SQL queries construct narrow row lock clause FOR UPDATE OF c [Mocked SQL Structure].
 *
 * Offline execution: uses mocks and deterministic assertions.
 * Does not connect to or modify any staging or production database.
 */

'use strict';

const assert = require('assert');
const prisma = require('./src/prisma');
const {
  installHermeticPrismaGuard,
  uninstallHermeticPrismaGuard,
  createMockAuditLogDelegate
} = require('./test_hermetic_prisma');
const {
  createClarification,
  getClarifications,
  respondToClarification,
  resolveClarification
} = require('./src/controllers/clarificationController');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runSuite() {
  console.log('\n=== MediFind AI — Step 11M: Slice 4 Pharmacy Clarification Tests ===\n');
  installHermeticPrismaGuard(prisma);

  // Save originals for teardown
  const origTransaction = prisma.$transaction;
  const origQueryRawUnsafe = prisma.$queryRawUnsafe;
  const origExecuteRawUnsafe = prisma.$executeRawUnsafe;
  const origOrderFindUnique = prisma.order?.findUnique;
  const origOrderUpdate = prisma.order?.update;
  const origPrescriptionFindUnique = prisma.prescription?.findUnique;
  const origPharmacyFindUnique = prisma.pharmacy?.findUnique;
  const origClarificationFindMany = prisma.prescriptionClarification?.findMany;
  const origClarificationFindFirst = prisma.prescriptionClarification?.findFirst;
  const origClarificationFindUnique = prisma.prescriptionClarification?.findUnique;
  const origClarificationCreate = prisma.prescriptionClarification?.create;
  const origClarificationUpdate = prisma.prescriptionClarification?.update;
  const origNotificationCreate = prisma.notification?.create;
  const origPrescriptionAuditLog = prisma.prescriptionAuditLog;

  function restoreAll() {
    prisma.$transaction = origTransaction;
    prisma.$queryRawUnsafe = origQueryRawUnsafe;
    prisma.$executeRawUnsafe = origExecuteRawUnsafe;
    if (prisma.order) {
      prisma.order.findUnique = origOrderFindUnique;
      prisma.order.update = origOrderUpdate;
    }
    if (prisma.prescription) {
      prisma.prescription.findUnique = origPrescriptionFindUnique;
    }
    if (prisma.pharmacy) {
      prisma.pharmacy.findUnique = origPharmacyFindUnique;
    }
    if (prisma.prescriptionClarification) {
      prisma.prescriptionClarification.findMany = origClarificationFindMany;
      prisma.prescriptionClarification.findFirst = origClarificationFindFirst;
      prisma.prescriptionClarification.findUnique = origClarificationFindUnique;
      prisma.prescriptionClarification.create = origClarificationCreate;
      prisma.prescriptionClarification.update = origClarificationUpdate;
    }
    if (prisma.notification) {
      prisma.notification.create = async (d) => ({ id: 'mock-notif-id', ...d?.data });
    }
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Authorized pharmacist creates clarification for own pharmacy's order
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Authorized pharmacist creates a clarification for their own pharmacy\'s order', async () => {
    restoreAll();
    const pharmacistId = 'user-pharmacist-1';
    const pharmacyId = 'pharmacy-city-meds';
    const orderId = 'order-clarif-1';
    const prescriptionId = 'rx-clarif-1';
    const patientId = 'user-patient-alice';

    const mockOrder = {
      id: orderId,
      orderNumber: 'MF-2026-101',
      userId: patientId,
      pharmacyId,
      prescriptionId,
      status: 'CONFIRMED'
    };

    const mockRx = {
      id: prescriptionId,
      userId: patientId,
      status: 'VERIFIED'
    };

    const mockPharmacy = {
      id: pharmacyId,
      name: 'City Meds',
      managerId: pharmacistId
    };

    let createdClarif = null;
    let notificationCreated = null;

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: { findUnique: async () => mockOrder },
      prescription: { findUnique: async () => mockRx },
      pharmacy: { findUnique: async () => mockPharmacy },
      prescriptionClarification: {
        findFirst: async () => null,
        create: async ({ data }) => {
          createdClarif = { ...data };
          return createdClarif;
        }
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.notification = {
      create: async ({ data }) => {
        notificationCreated = data;
        return data;
      }
    };

    const req = {
      params: { id: orderId },
      user: { id: pharmacistId, role: 'PHARMACIST' },
      body: {
        question: 'Prescribed brand Amoxicillin 500mg is out of stock. May we dispense equivalent generic Amoxil 500mg?'
      }
    };
    const res = mockRes();

    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 201, 'Should return HTTP 201 Created');
    assert.ok(createdClarif, 'Clarification record must be created');
    assert.strictEqual(createdClarif.orderId, orderId);
    assert.strictEqual(createdClarif.prescriptionId, prescriptionId);
    assert.strictEqual(createdClarif.pharmacyId, pharmacyId);
    assert.strictEqual(createdClarif.patientId, patientId);
    assert.strictEqual(createdClarif.pharmacistId, pharmacistId);
    assert.strictEqual(createdClarif.status, 'PENDING');
    assert.strictEqual(createdClarif.response, null);

    // Verify non-blocking notification to patient
    assert.ok(notificationCreated, 'Notification must be dispatched to patient');
    assert.strictEqual(notificationCreated.userId, patientId);
    assert.ok(notificationCreated.title.includes('Clarification Requested'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Cross-pharmacy pharmacist access is rejected
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Cross-pharmacy pharmacist access is rejected', async () => {
    restoreAll();
    const intruderPharmacistId = 'user-pharmacist-intruder';
    const pharmacyA = 'pharmacy-a';
    const pharmacyB = 'pharmacy-b';
    const orderId = 'order-rx-2';

    const mockOrder = {
      id: orderId,
      userId: 'patient-bob',
      pharmacyId: pharmacyA, // Order belongs to Pharmacy A
      prescriptionId: 'rx-2',
      status: 'CONFIRMED'
    };

    const mockPharmacyB = {
      id: pharmacyB,
      name: 'Pharmacy B',
      managerId: intruderPharmacistId // Intruder manages Pharmacy B
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: { findUnique: async () => mockOrder },
      prescription: { findUnique: async () => ({ id: 'rx-2', userId: 'patient-bob' }) },
      pharmacy: { findUnique: async () => mockPharmacyB },
      prescriptionClarification: { findFirst: async () => null }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const req = {
      params: { id: orderId },
      user: { id: intruderPharmacistId, role: 'PHARMACIST' },
      body: { question: 'Attempting cross-pharmacy clarification inquiry?' }
    };
    const res = mockRes();

    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 403, 'Must return 403 Forbidden for cross-pharmacy attempt');
    assert.ok(res.body.error.includes('managed pharmacy'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Patient can retrieve and respond to their own clarification
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Patient can retrieve and respond to their own clarification', async () => {
    restoreAll();
    const patientId = 'patient-charlie';
    const orderId = 'order-rx-3';
    const clarifId = 'clarif-3';

    let clarifDb = {
      id: clarifId,
      orderId,
      prescriptionId: 'rx-3',
      pharmacyId: 'pharmacy-c',
      patientId,
      pharmacistId: 'pharmacist-c',
      question: 'Please confirm daily dosage frequency.',
      response: null,
      status: 'PENDING'
    };

    const mockOrder = { id: orderId, userId: patientId, pharmacyId: 'pharmacy-c' };

    let pharmacistNotified = null;

    // Subcase 3a: Patient views clarification history
    prisma.order = { findUnique: async () => mockOrder };
    prisma.prescriptionClarification = { findMany: async () => [clarifDb] };

    const getReq = {
      params: { id: orderId },
      user: { id: patientId, role: 'PATIENT' }
    };
    const getRes = mockRes();
    await getClarifications(getReq, getRes);

    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.body.clarifications.length, 1);
    assert.strictEqual(getRes.body.clarifications[0].id, clarifId);

    // Subcase 3b: Patient responds to clarification
    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescriptionClarification: {
        findUnique: async () => clarifDb,
        update: async ({ data }) => {
          Object.assign(clarifDb, data);
          return clarifDb;
        }
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.notification = {
      create: async ({ data }) => {
        pharmacistNotified = data;
        return data;
      }
    };

    const respondReq = {
      params: { id: orderId, clarificationId: clarifId },
      user: { id: patientId, role: 'PATIENT' },
      body: { response: 'Doctor prescribed one tablet twice daily after meals.' }
    };
    const respondRes = mockRes();
    await respondToClarification(respondReq, respondRes);

    assert.strictEqual(respondRes.statusCode, 200);
    assert.strictEqual(clarifDb.status, 'RESPONDED');
    assert.strictEqual(clarifDb.response, 'Doctor prescribed one tablet twice daily after meals.');
    assert.ok(pharmacistNotified);
    assert.strictEqual(pharmacistNotified.userId, 'pharmacist-c');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Cross-patient access is rejected
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Cross-patient access is rejected', async () => {
    restoreAll();
    const orderId = 'order-rx-4';
    const clarifId = 'clarif-4';

    const mockClarif = {
      id: clarifId,
      orderId,
      patientId: 'patient-owner',
      status: 'PENDING'
    };

    // Intruder patient attempts to view
    prisma.order = { findUnique: async () => ({ id: orderId, userId: 'patient-owner' }) };
    const getReq = {
      params: { id: orderId },
      user: { id: 'patient-intruder', role: 'PATIENT' }
    };
    const getRes = mockRes();
    await getClarifications(getReq, getRes);
    assert.strictEqual(getRes.statusCode, 403, 'Must reject stranger patient from viewing clarifications');

    // Intruder patient attempts to respond
    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescriptionClarification: { findUnique: async () => mockClarif }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const respondReq = {
      params: { id: orderId, clarificationId: clarifId },
      user: { id: 'patient-intruder', role: 'PATIENT' },
      body: { response: 'Malicious hijacked response' }
    };
    const respondRes = mockRes();
    await respondToClarification(respondReq, respondRes);
    assert.strictEqual(respondRes.statusCode, 403, 'Must reject stranger patient from responding');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: ASSISTANT is denied all clarification endpoints
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('ASSISTANT is denied all clarification endpoints', async () => {
    restoreAll();
    const assistantUser = { id: 'assistant-user', role: 'ASSISTANT' };

    // 5a. Create
    {
      const req = { params: { id: 'order-1' }, user: assistantUser, body: { question: 'Valid question?' } };
      const res = mockRes();
      await createClarification(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.body.error.includes('Assistants cannot'));
    }

    // 5b. Get
    {
      const req = { params: { id: 'order-1' }, user: assistantUser };
      const res = mockRes();
      await getClarifications(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.body.error.includes('Assistants cannot'));
    }

    // 5c. Respond
    {
      const req = { params: { id: 'order-1', clarificationId: 'c-1' }, user: assistantUser, body: { response: 'Valid' } };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.body.error.includes('Assistants cannot'));
    }

    // 5d. Resolve
    {
      const req = { params: { id: 'order-1', clarificationId: 'c-1' }, user: assistantUser };
      const res = mockRes();
      await resolveClarification(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.body.error.includes('Assistants cannot'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Orders without prescriptions and mismatched prescription/patient relationships are rejected
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Orders without prescriptions and mismatched prescription/patient relationships are rejected', async () => {
    restoreAll();
    const pharmacistUser = { id: 'pharm-1', role: 'PHARMACIST' };

    // 6a: Order has prescriptionId = null (OTC order)
    {
      const mockOrderNoRx = {
        id: 'order-no-rx',
        userId: 'patient-1',
        pharmacyId: 'p-1',
        prescriptionId: null,
        status: 'CONFIRMED'
      };
      const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
        order: { findUnique: async () => mockOrderNoRx }
      };
      prisma.$transaction = async (cb) => cb(mockTx);

      const req = {
        params: { id: 'order-no-rx' },
        user: pharmacistUser,
        body: { question: 'Question on OTC order?' }
      };
      const res = mockRes();
      await createClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('requires an associated prescription'));
    }

    // 6b: Order prescription belongs to a different patient
    {
      const mockOrder = {
        id: 'order-rx-mismatch',
        userId: 'patient-alice',
        pharmacyId: 'p-1',
        prescriptionId: 'rx-bob',
        status: 'CONFIRMED'
      };
      const mockRxBob = {
        id: 'rx-bob',
        userId: 'patient-bob' // Mismatched!
      };
      const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
        order: { findUnique: async () => mockOrder },
        prescription: { findUnique: async () => mockRxBob }
      };
      prisma.$transaction = async (cb) => cb(mockTx);

      const req = {
        params: { id: 'order-rx-mismatch' },
        user: pharmacistUser,
        body: { question: 'Question on mismatched prescription?' }
      };
      const res = mockRes();
      await createClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Cross-entity validation failed'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Empty and oversized questions/responses are rejected
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Empty and oversized questions/responses are rejected', async () => {
    restoreAll();

    // 7a: Question < 5 chars
    {
      const req = { params: { id: 'order-1' }, user: { id: 'ph-1', role: 'PHARMACIST' }, body: { question: 'Hi' } };
      const res = mockRes();
      await createClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('between 5 and 1000 characters'));
    }

    // 7b: Question > 1000 chars
    {
      const req = { params: { id: 'order-1' }, user: { id: 'ph-1', role: 'PHARMACIST' }, body: { question: 'A'.repeat(1001) } };
      const res = mockRes();
      await createClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('between 5 and 1000 characters'));
    }

    // 7c: Response < 2 chars
    {
      const req = { params: { id: 'order-1', clarificationId: 'c-1' }, user: { id: 'pat-1', role: 'PATIENT' }, body: { response: '?' } };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('between 2 and 2000 characters'));
    }

    // 7d: Response > 2000 chars
    {
      const req = { params: { id: 'order-1', clarificationId: 'c-1' }, user: { id: 'pat-1', role: 'PATIENT' }, body: { response: 'X'.repeat(2001) } };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('between 2 and 2000 characters'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: Duplicate active-question submissions are safely handled
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Duplicate active-question submissions are safely handled', async () => {
    restoreAll();
    const orderId = 'order-dup-1';
    const mockOrder = {
      id: orderId,
      userId: 'patient-1',
      pharmacyId: 'p-1',
      prescriptionId: 'rx-1',
      status: 'CONFIRMED'
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: { findUnique: async () => mockOrder },
      prescription: { findUnique: async () => ({ id: 'rx-1', userId: 'patient-1' }) },
      pharmacy: { findUnique: async () => ({ id: 'p-1', managerId: 'ph-1' }) },
      prescriptionClarification: {
        findFirst: async () => ({ id: 'active-c-1', status: 'PENDING' }) // Active exists!
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const req = {
      params: { id: orderId },
      user: { id: 'ph-1', role: 'PHARMACIST' },
      body: { question: 'Attempting to open second clarification while first is active' }
    };
    const res = mockRes();
    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 409, 'Must return 409 Conflict when active clarification exists');
    assert.ok(res.body.error.includes('active clarification inquiry is already open'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: Concurrent creation requests serialize under parent-order lock [Mocked Concurrency]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Concurrent creation requests serialize under the modeled parent-order lock [Mocked Concurrency]', async () => {
    restoreAll();
    const orderId = 'order-lock-test';
    let lockAcquired = false;
    let activeRecords = [];

    const mockOrder = {
      id: orderId,
      userId: 'patient-1',
      pharmacyId: 'p-1',
      prescriptionId: 'rx-1',
      status: 'CONFIRMED'
    };

    prisma.$transaction = async (callback) => {
      // Simulate PostgreSQL row-level lock serialization
      if (lockAcquired) {
        // Second concurrent worker waits for first to complete
        await new Promise(r => setTimeout(r, 20));
      }
      lockAcquired = true;

      const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
        $queryRawUnsafe: async (sql) => {
          if (sql.includes('FOR UPDATE')) return [mockOrder];
          return [];
        },
        order: { findUnique: async () => mockOrder },
        prescription: { findUnique: async () => ({ id: 'rx-1', userId: 'patient-1' }) },
        pharmacy: { findUnique: async () => ({ id: 'p-1', managerId: 'ph-1' }) },
        prescriptionClarification: {
          findFirst: async () => (activeRecords.length > 0 ? activeRecords[0] : null),
          create: async ({ data }) => {
            activeRecords.push(data);
            return data;
          }
        }
      };

      try {
        return await callback(mockTx);
      } finally {
        lockAcquired = false;
      }
    };

    const req1 = { params: { id: orderId }, user: { id: 'ph-1', role: 'PHARMACIST' }, body: { question: 'Worker 1 question' } };
    const req2 = { params: { id: orderId }, user: { id: 'ph-1', role: 'PHARMACIST' }, body: { question: 'Worker 2 question' } };
    const res1 = mockRes();
    const res2 = mockRes();

    // Fire concurrently
    await Promise.all([createClarification(req1, res1), createClarification(req2, res2)]);

    const results = [res1.statusCode, res2.statusCode].sort();
    assert.deepStrictEqual(results, [201, 409], 'Exactly one request succeeds (201) and competing request is rejected (409)');
    assert.strictEqual(activeRecords.length, 1, 'Only one record created under lock');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: Identical response retries are idempotent; conflicting retries return 409
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Identical response retries are idempotent; conflicting retries return 409', async () => {
    restoreAll();
    const orderId = 'order-retry-test';
    const clarifId = 'c-retry-1';
    const originalText = 'Doctor approved 1 tablet OD.';

    const clarifState = {
      id: clarifId,
      orderId,
      patientId: 'pat-1',
      pharmacistId: 'ph-1',
      question: 'Dosage clarification?',
      response: originalText,
      status: 'RESPONDED'
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescriptionClarification: { findUnique: async () => clarifState }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    // Subcase 10a: Identical retry -> returns idempotent 200
    {
      const req = {
        params: { id: orderId, clarificationId: clarifId },
        user: { id: 'pat-1', role: 'PATIENT' },
        body: { response: originalText }
      };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.message.includes('already recorded'));
    }

    // Subcase 10b: Conflicting response retry -> returns 409 Conflict
    {
      const req = {
        params: { id: orderId, clarificationId: clarifId },
        user: { id: 'pat-1', role: 'PATIENT' },
        body: { response: 'Conflicting new answer after already responded' }
      };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 409);
      assert.ok(res.body.error.includes('must be in PENDING status'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: Resolved clarifications cannot be modified contrary to policy
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Resolved clarifications cannot be changed contrary to the status policy', async () => {
    restoreAll();
    const orderId = 'order-resolved-test';
    const clarifId = 'c-res-1';

    const clarifResolved = {
      id: clarifId,
      orderId,
      pharmacyId: 'p-1',
      patientId: 'pat-1',
      status: 'RESOLVED',
      response: 'Previously approved'
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescriptionClarification: {
        findUnique: async () => clarifResolved
      },
      pharmacy: { findUnique: async () => ({ id: 'p-1', managerId: 'ph-1' }) }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    // Attempt to respond to resolved clarification -> 409 Conflict
    {
      const req = {
        params: { id: orderId, clarificationId: clarifId },
        user: { id: 'pat-1', role: 'PATIENT' },
        body: { response: 'Attempting to edit response post-resolution' }
      };
      const res = mockRes();
      await respondToClarification(req, res);
      assert.strictEqual(res.statusCode, 409);
      assert.ok(res.body.error.includes('must be in PENDING status'));
    }

    // Repeated resolution by pharmacist -> idempotent 200
    {
      const req = {
        params: { id: orderId, clarificationId: clarifId },
        user: { id: 'ph-1', role: 'PHARMACIST' }
      };
      const res = mockRes();
      await resolveClarification(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.message.includes('already marked as resolved'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 12: Clarification actions do not mutate order, payment, inventory, or rx
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Clarification actions do not mutate order, payment, inventory, or prescription-verification state', async () => {
    restoreAll();
    const orderId = 'order-immutable-check';
    const initialOrder = Object.freeze({
      id: orderId,
      orderNumber: 'IMMUT-101',
      status: 'CONFIRMED',
      userId: 'pat-1',
      pharmacyId: 'p-1',
      prescriptionId: 'rx-1'
    });

    let orderUpdateCalled = false;
    let paymentUpdateCalled = false;
    let inventoryUpdateCalled = false;
    let prescriptionUpdateCalled = false;

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: {
        findUnique: async () => initialOrder,
        update: async () => { orderUpdateCalled = true; }
      },
      prescription: {
        findUnique: async () => ({ id: 'rx-1', userId: 'pat-1', status: 'VERIFIED' }),
        update: async () => { prescriptionUpdateCalled = true; }
      },
      pharmacy: { findUnique: async () => ({ id: 'p-1', managerId: 'ph-1' }) },
      prescriptionClarification: {
        findFirst: async () => null,
        create: async ({ data }) => data
      },
      payment: { update: async () => { paymentUpdateCalled = true; } },
      inventory: { update: async () => { inventoryUpdateCalled = true; } }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const req = {
      params: { id: orderId },
      user: { id: 'ph-1', role: 'PHARMACIST' },
      body: { question: 'Valid clarification question?' }
    };
    const res = mockRes();
    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(orderUpdateCalled, false, 'Order.update must NOT be called');
    assert.strictEqual(paymentUpdateCalled, false, 'Payment.update must NOT be called');
    assert.strictEqual(inventoryUpdateCalled, false, 'Inventory.update must NOT be called');
    assert.strictEqual(prescriptionUpdateCalled, false, 'Prescription.update must NOT be called');
    assert.strictEqual(initialOrder.status, 'CONFIRMED', 'Order status must remain unchanged');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 13: Missing Prisma delegates use safe parameterized SQL
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Missing Prisma delegates use safe parameterized SQL where applicable', async () => {
    restoreAll();
    const sqlCalls = [];
    const orderId = 'order-sql-fallback';
    const mockOrder = {
      id: orderId,
      userId: 'pat-1',
      pharmacyId: 'p-1',
      prescriptionId: 'rx-1',
      status: 'CONFIRMED'
    };

    // Client with NO prescriptionClarification delegate, forcing SQL branch
    prisma.prescriptionClarification = undefined;
    prisma.order = undefined;
    prisma.prescription = undefined;
    prisma.pharmacy = undefined;

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescriptionClarification: undefined,
      $queryRawUnsafe: async (sql, ...params) => {
        sqlCalls.push({ type: 'query', sql, params });
        if (sql.includes('FROM "Order"')) return [mockOrder];
        if (sql.includes('FROM "Prescription"')) return [{ id: 'rx-1', userId: 'pat-1' }];
        if (sql.includes('FROM "Pharmacy"')) return [{ id: 'p-1', managerId: 'ph-1' }];
        if (sql.includes('FROM "PrescriptionClarification"')) return [];
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        sqlCalls.push({ type: 'execute', sql, params });
        return 1;
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const maliciousQuestion = "Special chars; DROP TABLE \"Order\"; --";
    const req = {
      params: { id: orderId },
      user: { id: 'ph-1', role: 'PHARMACIST' },
      body: { question: maliciousQuestion }
    };
    const res = mockRes();
    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 201);
    const insertCall = sqlCalls.find(c => c.type === 'execute' && c.sql.includes('INSERT INTO "PrescriptionClarification"'));
    assert.ok(insertCall, 'INSERT must be executed via $executeRawUnsafe');
    assert.ok(insertCall.sql.includes('$1'), 'SQL must use positional placeholder $1');
    assert.ok(insertCall.sql.includes('$7'), 'SQL must use positional placeholder $7 for question');
    assert.ok(insertCall.params.includes(maliciousQuestion), 'Malicious text must be passed as bound parameter');
    assert.strictEqual(insertCall.sql.includes(maliciousQuestion), false, 'Special characters must NEVER be interpolated into SQL');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 14: Notification failures do not undo a successfully committed clarification
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Notification failures do not undo a successfully committed clarification', async () => {
    restoreAll();
    const orderId = 'order-notif-fail';
    let clarifCreated = false;

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: {
        findUnique: async () => ({ id: orderId, userId: 'pat-1', pharmacyId: 'p-1', prescriptionId: 'rx-1', status: 'CONFIRMED' })
      },
      prescription: { findUnique: async () => ({ id: 'rx-1', userId: 'pat-1' }) },
      pharmacy: { findUnique: async () => ({ id: 'p-1', managerId: 'ph-1' }) },
      prescriptionClarification: {
        findFirst: async () => null,
        create: async ({ data }) => {
          clarifCreated = true;
          return data;
        }
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    // Notification service fails post-commit
    prisma.notification = {
      create: async () => {
        throw new Error('Simulated notification delivery network timeout');
      }
    };

    const req = {
      params: { id: orderId },
      user: { id: 'ph-1', role: 'PHARMACIST' },
      body: { question: 'Will notification failure abort the action?' }
    };
    const res = mockRes();
    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 201, 'Action must succeed even if notification fails');
    assert.strictEqual(clarifCreated, true, 'Clarification must be successfully committed to database');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 15: Pharmacist directly resolves clarification from PENDING to RESOLVED
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Pharmacist directly resolves a clarification from PENDING to RESOLVED', async () => {
    restoreAll();
    const orderId = 'order-direct-resolve-1';
    const clarifId = 'clarif-pending-to-resolved';
    const pharmacyId = 'p-city-1';
    const pharmacistId = 'ph-direct-1';
    const patientId = 'pat-alice';

    let updatedClarifRecord = null;

    const mockClarif = {
      id: clarifId,
      orderId,
      pharmacyId,
      patientId,
      pharmacistId,
      question: 'Patient confirmed dosage verbally over phone?',
      response: null,
      status: 'PENDING',
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: {
        findUnique: async () => ({ id: orderId, userId: patientId, pharmacyId, prescriptionId: 'rx-1', status: 'CONFIRMED' })
      },
      prescription: { findUnique: async () => ({ id: 'rx-1', userId: patientId }) },
      pharmacy: { findUnique: async () => ({ id: pharmacyId, managerId: pharmacistId }) },
      prescriptionClarification: {
        findUnique: async () => mockClarif,
        update: async ({ where, data }) => {
          updatedClarifRecord = { ...mockClarif, ...data };
          return updatedClarifRecord;
        }
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const req = {
      params: { id: orderId, clarificationId: clarifId },
      user: { id: pharmacistId, role: 'PHARMACIST' }
    };
    const res = mockRes();
    await resolveClarification(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.clarification.status, 'RESOLVED');
    assert.ok(res.body.clarification.resolvedAt, 'resolvedAt must be populated');
    assert.strictEqual(updatedClarifRecord.status, 'RESOLVED');
    assert.strictEqual(updatedClarifRecord.response, null, 'Response remains null if resolved directly from PENDING');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 16: ADMIN authorization across all endpoints (create, view, respond, resolve)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('ADMIN authorization for create, view, respond, and resolve succeeds', async () => {
    restoreAll();
    const orderId = 'order-admin-flow-1';
    const clarifId = 'clarif-admin-c1';
    const pharmacyId = 'p-admin-target';
    const patientId = 'pat-admin-target';
    const adminUser = { id: 'admin-super-1', role: 'ADMIN' };

    let createdData = null;

    let clarifState = {
      id: clarifId,
      orderId,
      prescriptionId: 'rx-admin-1',
      pharmacyId,
      patientId,
      pharmacistId: 'admin-super-1',
      question: 'Admin initiated question on order',
      response: null,
      status: 'PENDING',
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: {
        findUnique: async () => ({
          id: orderId,
          orderNumber: 'MF-ADM-001',
          userId: patientId,
          pharmacyId,
          prescriptionId: 'rx-admin-1',
          status: 'CONFIRMED'
        })
      },
      prescription: { findUnique: async () => ({ id: 'rx-admin-1', userId: patientId }) },
      pharmacy: { findUnique: async () => ({ id: pharmacyId, name: 'Admin Test Pharmacy', managerId: 'other-ph-mgr' }) },
      prescriptionClarification: {
        findFirst: async () => null,
        findMany: async () => [clarifState],
        findUnique: async () => clarifState,
        create: async ({ data }) => {
          createdData = data;
          clarifState = { ...data };
          return data;
        },
        update: async ({ data }) => {
          clarifState = { ...clarifState, ...data };
          return clarifState;
        }
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescriptionClarification = mockTx.prescriptionClarification;
    prisma.order = mockTx.order;
    prisma.pharmacy = mockTx.pharmacy;

    // 16a. ADMIN creates clarification (even though admin is not pharmacy manager)
    const reqCreate = {
      params: { id: orderId },
      user: adminUser,
      body: { question: 'Admin question regarding medication verification' }
    };
    const resCreate = mockRes();
    await createClarification(reqCreate, resCreate);
    assert.strictEqual(resCreate.statusCode, 201, 'ADMIN must be allowed to create clarification');
    assert.strictEqual(resCreate.body.success, true);
    assert.ok(createdData, 'Clarification record must be created');

    // 16b. ADMIN views clarifications for the order
    const reqGet = {
      params: { id: orderId },
      user: adminUser
    };
    const resGet = mockRes();
    await getClarifications(reqGet, resGet);
    assert.strictEqual(resGet.statusCode, 200, 'ADMIN must be allowed to retrieve clarifications');
    assert.strictEqual(resGet.body.success, true);
    assert.strictEqual(resGet.body.clarifications.length, 1);

    // 16c. ADMIN responds to clarification (even though admin is not patient)
    const reqRespond = {
      params: { id: orderId, clarificationId: clarifId },
      user: adminUser,
      body: { response: 'Admin provided patient clearance instructions.' }
    };
    const resRespond = mockRes();
    await respondToClarification(reqRespond, resRespond);
    assert.strictEqual(resRespond.statusCode, 200, 'ADMIN must be allowed to respond to clarification');
    assert.strictEqual(resRespond.body.success, true);
    assert.strictEqual(resRespond.body.clarification.status, 'RESPONDED');

    // 16d. ADMIN resolves clarification (even though admin is not pharmacy manager)
    const reqResolve = {
      params: { id: orderId, clarificationId: clarifId },
      user: adminUser
    };
    const resResolve = mockRes();
    await resolveClarification(reqResolve, resResolve);
    assert.strictEqual(resResolve.statusCode, 200, 'ADMIN must be allowed to resolve clarification');
    assert.strictEqual(resResolve.body.success, true);
    assert.strictEqual(resResolve.body.clarification.status, 'RESOLVED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 17: Delegate fallback when root client has delegate but tx client does not
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Delegate fallback case where root Prisma client has clarification delegate but transaction client does not', async () => {
    restoreAll();
    const orderId = 'order-delegate-fallback-1';
    const pharmacyId = 'p-del-1';
    const pharmacistId = 'ph-del-1';
    const patientId = 'pat-del-1';

    let rootFindFirstCalled = false;
    let rootCreateCalled = false;

    // Root client HAS prescriptionClarification delegate
    prisma.prescriptionClarification = {
      findFirst: async () => {
        rootFindFirstCalled = true;
        return null;
      },
      create: async ({ data }) => {
        rootCreateCalled = true;
        return data;
      }
    };

    // Transaction client deliberately lacks prescriptionClarification delegate (Fix F-01 validation)
    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      order: {
        findUnique: async () => ({
          id: orderId,
          orderNumber: 'MF-DEL-001',
          userId: patientId,
          pharmacyId,
          prescriptionId: 'rx-del-1',
          status: 'CONFIRMED'
        })
      },
      prescription: { findUnique: async () => ({ id: 'rx-del-1', userId: patientId }) },
      pharmacy: { findUnique: async () => ({ id: pharmacyId, managerId: pharmacistId }) },
      prescriptionClarification: undefined // Undefined on tx!
    };
    prisma.$transaction = async (cb) => cb(mockTx);

    const req = {
      params: { id: orderId },
      user: { id: pharmacistId, role: 'PHARMACIST' },
      body: { question: 'Testing delegate fallback when tx client lacks delegate?' }
    };
    const res = mockRes();
    await createClarification(req, res);

    assert.strictEqual(res.statusCode, 201, 'createClarification must succeed via clarifDelegate fallback');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(rootFindFirstCalled, true, 'root clarifDelegate.findFirst must be invoked instead of crashing on tx');
    assert.strictEqual(rootCreateCalled, true, 'root clarifDelegate.create must be invoked');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 18: Correct lock-clause construction for raw SQL paths (FOR UPDATE OF c)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Raw SQL queries in respond and resolve construct narrow lock clause FOR UPDATE OF c [Mocked SQL Structure]', async () => {
    restoreAll();
    const orderId = 'order-lock-test-1';
    const clarifId = 'clarif-lock-test-1';
    const patientId = 'pat-lock-1';
    const pharmacistId = 'ph-lock-1';
    const pharmacyId = 'p-lock-1';

    const sqlQueries = [];

    const mockClarifJoinedRespond = {
      id: clarifId,
      orderId,
      pharmacyId,
      patientId,
      pharmacistId,
      question: 'Question needing lock test',
      response: null,
      status: 'PENDING',
      orderNumber: 'MF-LOCK-001',
      orderUserId: patientId,
      managerId: pharmacistId
    };

    const mockClarifJoinedResolve = {
      ...mockClarifJoinedRespond,
      response: 'Patient response',
      status: 'RESPONDED',
      pharmacyName: 'Lock Test Pharmacy'
    };

    // 18a. respondToClarification query inspection
    const mockTxRespond = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      $queryRawUnsafe: async (sql, ...params) => {
        sqlQueries.push(sql);
        if (sql.includes('FROM "PrescriptionClarification" c')) {
          return [mockClarifJoinedRespond];
        }
        return [];
      },
      prescriptionClarification: {
        update: async ({ data }) => ({ ...mockClarifJoinedRespond, ...data })
      }
    };
    prisma.$transaction = async (cb) => cb(mockTxRespond);

    const reqRespond = {
      params: { id: orderId, clarificationId: clarifId },
      user: { id: patientId, role: 'PATIENT' },
      body: { response: 'Valid patient response for lock test' }
    };
    const resRespond = mockRes();
    await respondToClarification(reqRespond, resRespond);
    assert.strictEqual(resRespond.statusCode, 200);

    const respondLockQuery = sqlQueries.find(q => q.includes('FROM "PrescriptionClarification" c'));
    assert.ok(respondLockQuery, 'respondToClarification must execute raw joined query');
    assert.ok(
      respondLockQuery.includes('FOR UPDATE OF c'),
      'respondToClarification raw SQL must use FOR UPDATE OF c to narrow lock to clarification table alias'
    );
    assert.strictEqual(
      /FOR UPDATE\s*$/.test(respondLockQuery.trim()),
      false,
      'Query must not end with un-narrowed FOR UPDATE across all joined tables'
    );

    // 18b. resolveClarification query inspection
    sqlQueries.length = 0; // Clear
    const mockTxResolve = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      $queryRawUnsafe: async (sql, ...params) => {
        sqlQueries.push(sql);
        if (sql.includes('FROM "PrescriptionClarification" c')) {
          return [mockClarifJoinedResolve];
        }
        return [];
      },
      pharmacy: { findUnique: async () => ({ id: pharmacyId, managerId: pharmacistId }) },
      prescriptionClarification: {
        update: async ({ data }) => ({ ...mockClarifJoinedResolve, ...data })
      }
    };
    prisma.$transaction = async (cb) => cb(mockTxResolve);

    const reqResolve = {
      params: { id: orderId, clarificationId: clarifId },
      user: { id: pharmacistId, role: 'PHARMACIST' }
    };
    const resResolve = mockRes();
    await resolveClarification(reqResolve, resResolve);
    assert.strictEqual(resResolve.statusCode, 200);

    const resolveLockQuery = sqlQueries.find(q => q.includes('FROM "PrescriptionClarification" c'));
    assert.ok(resolveLockQuery, 'resolveClarification must execute raw joined query');
    assert.ok(
      resolveLockQuery.includes('FOR UPDATE OF c'),
      'resolveClarification raw SQL must use FOR UPDATE OF c to narrow lock to clarification table alias'
    );
    assert.strictEqual(
      /FOR UPDATE\s*$/.test(resolveLockQuery.trim()),
      false,
      'Query must not end with un-narrowed FOR UPDATE across all joined tables'
    );
  });

  restoreAll();
  if (prisma.notification) {
    prisma.notification.create = origNotificationCreate;
  }
  uninstallHermeticPrismaGuard(prisma);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('Results: 18 / 18 tests passed.');
  console.log('✓ All Slice 4 Pharmacy Clarification tests PASSED successfully!\n');
}

runSuite().catch((err) => {
  console.error('\n✗ Test suite failed with error:', err);
  process.exit(1);
});
