/**
 * MediFind AI — Phase 1, Step 11K: Slice 3 Confirmed Prescription Items and Provenance Unit & Regression Tests
 *
 * Tests:
 * 1. Valid OCR-derived item links to the correct validated candidate (sourceType: OCR_DERIVED, sourceCandidateId).
 * 2. Manually added item gets MANUALLY_ADDED and no candidate link (sourceType: MANUALLY_ADDED, sourceCandidateId: null).
 * 3. Similar medicine names or IDs alone cannot fabricate OCR provenance (sourceType: UNSPECIFIED).
 * 4. Candidate records remain unchanged after patient edits (OCR candidate immutability).
 * 5. Re-verification replaces the canonical item list without duplicates (atomic replacement, idempotent re-verification).
 * 6. Invalid medicine IDs or quantities reject the request (400 Bad Request, quantity 1..500 bounds, catalog existence).
 * 7. Failure during persistence rolls back canonical items, compatibility changes, and status updates (atomic transaction).
 * 8. Another patient cannot verify the prescription (403); admin behavior remains consistent with existing authorization.
 * 9. Legacy DetectedMedicine compatibility remains intact (isConfirmed: true, getPrescriptionById returns both detectedMedicines & items).
 * 10. Missing Prisma delegates use the safe parameterized SQL path with bound positional arguments.
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
  verifyDetectedMedicines,
  getPrescriptionById
} = require('./src/controllers/prescriptionController');

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
  console.log('\n=== MediFind AI — Step 11K: Slice 3 Confirmed Prescription Items & Provenance Tests ===\n');
  installHermeticPrismaGuard(prisma);

  // Preserve originals for clean restoration
  const origTransaction = prisma.$transaction;
  const origQueryRawUnsafe = prisma.$queryRawUnsafe;
  const origExecuteRawUnsafe = prisma.$executeRawUnsafe;
  const origPrescriptionFindUnique = prisma.prescription?.findUnique;
  const origPrescriptionUpdate = prisma.prescription?.update;
  const origMedicineFindUnique = prisma.medicine?.findUnique;
  const origMedicineFindMany = prisma.medicine?.findMany;
  const origMedicineFindFirst = prisma.medicine?.findFirst;
  const origDetectedMedicineFindMany = prisma.detectedMedicine?.findMany;
  const origDetectedMedicineUpdate = prisma.detectedMedicine?.update;
  const origDetectedMedicineCreate = prisma.detectedMedicine?.create;
  const origDetectedMedicineDeleteMany = prisma.detectedMedicine?.deleteMany;
  const origPrescriptionItemFindMany = prisma.prescriptionItem?.findMany;
  const origPrescriptionItemCreate = prisma.prescriptionItem?.create;
  const origPrescriptionItemDeleteMany = prisma.prescriptionItem?.deleteMany;
  const origCandidateFindMany = prisma.prescriptionOcrCandidate?.findMany;
  const origRunFindFirst = prisma.prescriptionOcrRun?.findFirst;
  const origPrescriptionAuditLog = prisma.prescriptionAuditLog;

  function restoreAll() {
    prisma.$transaction = origTransaction;
    prisma.$queryRawUnsafe = origQueryRawUnsafe;
    prisma.$executeRawUnsafe = origExecuteRawUnsafe;
    if (prisma.prescription) {
      prisma.prescription.findUnique = origPrescriptionFindUnique;
      prisma.prescription.update = origPrescriptionUpdate;
    }
    if (prisma.medicine) {
      prisma.medicine.findUnique = origMedicineFindUnique;
      prisma.medicine.findMany = origMedicineFindMany;
      prisma.medicine.findFirst = origMedicineFindFirst;
    }
    if (prisma.detectedMedicine) {
      prisma.detectedMedicine.findMany = origDetectedMedicineFindMany;
      prisma.detectedMedicine.update = origDetectedMedicineUpdate;
      prisma.detectedMedicine.create = origDetectedMedicineCreate;
      prisma.detectedMedicine.deleteMany = origDetectedMedicineDeleteMany;
    }
    if (prisma.prescriptionItem) {
      prisma.prescriptionItem.findMany = origPrescriptionItemFindMany;
      prisma.prescriptionItem.create = origPrescriptionItemCreate;
      prisma.prescriptionItem.deleteMany = origPrescriptionItemDeleteMany;
    }
    if (prisma.prescriptionOcrCandidate) {
      prisma.prescriptionOcrCandidate.findMany = origCandidateFindMany;
    }
    if (prisma.prescriptionOcrRun) {
      prisma.prescriptionOcrRun.findFirst = origRunFindFirst;
    }
    if (prisma.prescriptionAuditLog) {
      prisma.prescriptionAuditLog = origPrescriptionAuditLog;
    }
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Valid OCR-derived item links to correct validated candidate
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Valid OCR-derived item links to the correct validated candidate', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-1';
    const candidateId = 'cand-ocr-101';
    const medicineId = 'med-amox-500';

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-alice',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: [
        { id: 'dm-1', prescriptionId, rawName: 'Amoxicillin 500mg', matchedMedicineId: medicineId, quantity: 15, isConfirmed: false }
      ]
    };

    const mockCandidates = [
      {
        id: candidateId,
        ocrRunId: 'run-1',
        matchedMedicineId: medicineId,
        rawText: 'Amoxicillin 500mg TID',
        extractedQuantity: 15
      }
    ];

    const mockMedicine = {
      id: medicineId,
      brandName: 'Amoxil 500mg',
      genericName: 'Amoxicillin',
      dosageForm: 'CAPSULE'
    };

    const createdItems = [];

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async () => mockCandidates
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-1', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
          createdItems.push(data);
          return data;
        }
      },
      detectedMedicine: {
        findMany: async () => mockPrescription.detectedMedicines,
        update: async ({ where, data }) => ({ id: where.id, ...data }),
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => (where.id === medicineId ? mockMedicine : null);

    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-alice', role: 'PATIENT' },
      body: {
        items: [
          {
            id: 'dm-1',
            matchedMedicineId: medicineId,
            matchedMedicineName: 'Amoxil 500mg',
            sourceCandidateId: candidateId,
            quantity: 15,
            dosage: '500mg',
            frequency: '3 times daily',
            duration: '5 days',
            instructions: 'Take after meals'
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200, 'Verification should return HTTP 200');
    assert.strictEqual(createdItems.length, 1, 'Should create exactly 1 canonical PrescriptionItem');
    const item = createdItems[0];
    assert.strictEqual(item.prescriptionId, prescriptionId);
    assert.strictEqual(item.medicineId, medicineId);
    assert.strictEqual(item.sourceType, 'OCR_DERIVED', 'Genuine associated candidate must have sourceType OCR_DERIVED');
    assert.strictEqual(item.sourceCandidateId, candidateId, 'Item must point to validated candidate ID');
    assert.strictEqual(item.isVerified, true);
    assert.strictEqual(item.verifiedById, 'patient-alice');
    assert.strictEqual(item.quantity, 15);
    assert.strictEqual(item.dosage, '500mg');
    assert.strictEqual(item.frequency, '3 times daily');
    assert.strictEqual(item.duration, '5 days');
    assert.strictEqual(item.instructions, 'Take after meals');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Manually added item gets MANUALLY_ADDED and no candidate link
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Manually added item gets MANUALLY_ADDED and no candidate link', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-2';
    const medicineId = 'med-paracetamol-650';

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-bob',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: []
    };

    const mockMedicine = {
      id: medicineId,
      brandName: 'Dolo 650',
      genericName: 'Paracetamol'
    };

    const createdItems = [];

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async () => []
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-bob-1', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
          createdItems.push(data);
          return data;
        }
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => (where.id === medicineId ? mockMedicine : null);

    // Patient manually adds an OTC medicine during review (no dm id, no candidate id)
    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-bob', role: 'PATIENT' },
      body: {
        items: [
          {
            matchedMedicineId: medicineId,
            matchedMedicineName: 'Dolo 650',
            quantity: 10,
            dosage: '650mg',
            frequency: 'SOS',
            duration: '3 days'
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200, 'HTTP 200 returned');
    assert.strictEqual(createdItems.length, 1);
    const item = createdItems[0];
    assert.strictEqual(item.sourceType, 'MANUALLY_ADDED', 'Items added without candidate must have MANUALLY_ADDED');
    assert.strictEqual(item.sourceCandidateId, null, 'sourceCandidateId must be null for manually added items');
    assert.strictEqual(item.isVerified, true);
    assert.strictEqual(item.verifiedById, 'patient-bob');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Similar medicine names or IDs alone cannot fabricate OCR provenance
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Similar medicine names or IDs alone cannot fabricate OCR provenance', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-3';
    const medicineId = 'med-azithro-500';

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-charlie',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: [
        { id: 'dm-charlie-1', prescriptionId, rawName: 'Azithromycin 500mg', matchedMedicineId: medicineId, isConfirmed: false }
      ]
    };

    // Candidates in DB belong to another candidate ID or have matching name, but request passes
    // either an unknown candidate ID or no candidate ID
    const mockCandidates = [
      {
        id: 'genuine-cand-404',
        ocrRunId: 'run-other-rx',
        matchedMedicineId: medicineId,
        rawText: 'Azithromycin 500mg'
      }
    ];

    const mockMedicine = {
      id: medicineId,
      brandName: 'Azithral 500',
      genericName: 'Azithromycin'
    };

    const createdItems = [];

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async () => [] // Returns no validated candidates for THIS prescription
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-charlie-1', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
          createdItems.push(data);
          return data;
        }
      },
      detectedMedicine: {
        findMany: async () => mockPrescription.detectedMedicines,
        update: async ({ where, data }) => ({ id: where.id, ...data }),
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => (where.id === medicineId ? mockMedicine : null);

    // Request submits matching medicine name and ID, and an unauthorized candidate ID from another prescription
    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-charlie', role: 'PATIENT' },
      body: {
        items: [
          {
            id: 'dm-charlie-1',
            matchedMedicineId: medicineId,
            matchedMedicineName: 'Azithral 500',
            sourceCandidateId: 'genuine-cand-404', // Not belonging to this prescription
            quantity: 5
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(createdItems.length, 1);
    const item = createdItems[0];
    assert.strictEqual(
      item.sourceType,
      'UNSPECIFIED',
      'Cannot infer OCR provenance solely from matching medicine name/ID or unvalidated candidate ID'
    );
    assert.strictEqual(item.sourceCandidateId, null, 'Must not link to unvalidated candidate ID');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Candidate records remain unchanged after patient edits
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Candidate records remain unchanged after patient edits', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-4';
    const candidateId = 'cand-metformin-1';
    const medicineId = 'med-metformin-500';

    const candidateOriginal = Object.freeze({
      id: candidateId,
      ocrRunId: 'run-4',
      matchedMedicineId: medicineId,
      rawText: 'Metformin HCl 500mg OD',
      dosage: '500mg',
      extractedQuantity: 10,
      suggestedInstruction: 'Take after dinner'
    });

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-diana',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: [
        { id: 'dm-4', prescriptionId, rawName: 'Metformin HCl 500mg', matchedMedicineId: medicineId, quantity: 10 }
      ]
    };

    let candidateUpdateCalled = false;
    let candidateDeleteCalled = false;

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async () => [candidateOriginal],
        update: async () => {
          candidateUpdateCalled = true;
          throw new Error('IMMUTABILITY VIOLATION: PrescriptionOcrCandidate must never be updated during verification');
        },
        delete: async () => {
          candidateDeleteCalled = true;
          throw new Error('IMMUTABILITY VIOLATION: PrescriptionOcrCandidate must never be deleted during verification');
        }
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-4', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => data
      },
      detectedMedicine: {
        findMany: async () => mockPrescription.detectedMedicines,
        update: async ({ where, data }) => ({ id: where.id, ...data }),
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async () => ({ id: medicineId, brandName: 'Glycomet 500' });

    // Patient significantly modifies quantity, dosage, instructions
    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-diana', role: 'PATIENT' },
      body: {
        items: [
          {
            id: 'dm-4',
            sourceCandidateId: candidateId,
            matchedMedicineId: medicineId,
            quantity: 60, // changed from 10 to 60
            dosage: '1000mg', // changed from 500mg
            frequency: 'Twice daily',
            instructions: 'Take with morning and evening meals'
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(candidateUpdateCalled, false, 'PrescriptionOcrCandidate.update was never called');
    assert.strictEqual(candidateDeleteCalled, false, 'PrescriptionOcrCandidate.delete was never called');
    assert.strictEqual(candidateOriginal.extractedQuantity, 10, 'Candidate extracted quantity is immutable');
    assert.strictEqual(candidateOriginal.dosage, '500mg', 'Candidate dosage is immutable');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Re-verification replaces canonical item list without duplicates
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Re-verification replaces the canonical item list without duplicates', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-5';
    const medicineIdA = 'med-item-a';
    const medicineIdB = 'med-item-b';

    let itemTable = [
      { id: 'item-old-1', prescriptionId, medicineId: 'med-old-1', quantity: 10 },
      { id: 'item-old-2', prescriptionId, medicineId: 'med-old-2', quantity: 20 }
    ];

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-edward',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: []
    };

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async () => []
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-5', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async ({ where }) => {
          if (where.prescriptionId === prescriptionId) {
            const count = itemTable.length;
            itemTable = [];
            return { count };
          }
          return { count: 0 };
        },
        create: async ({ data }) => {
          itemTable.push(data);
          return data;
        }
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => {
      if (where.id === medicineIdA) return { id: medicineIdA, brandName: 'Medicine A' };
      if (where.id === medicineIdB) return { id: medicineIdB, brandName: 'Medicine B' };
      return null;
    };

    // Patient confirms 2 new items on re-verification
    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-edward', role: 'PATIENT' },
      body: {
        items: [
          { matchedMedicineId: medicineIdA, quantity: 5 },
          { matchedMedicineId: medicineIdB, quantity: 15 }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(itemTable.length, 2, 'Old items must be wiped and exactly 2 items must exist');
    assert.ok(itemTable.every(it => it.prescriptionId === prescriptionId));
    assert.ok(itemTable.some(it => it.medicineId === medicineIdA && it.quantity === 5));
    assert.ok(itemTable.some(it => it.medicineId === medicineIdB && it.quantity === 15));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Invalid medicine IDs or quantities reject the request
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Invalid medicine IDs or quantities reject the request', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-6';

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-fiona',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: []
    };

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async () => mockPrescription
      }
    };
    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => {
      if (where.id === 'med-valid') return { id: 'med-valid', brandName: 'Valid Med' };
      return null;
    };

    // Subcase 6a: Quantity 0 (below bounds)
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-fiona', role: 'PATIENT' },
        body: { items: [{ matchedMedicineId: 'med-valid', quantity: 0 }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Must be an integer between 1 and 500'));
    }

    // Subcase 6b: Quantity 501 (above bounds)
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-fiona', role: 'PATIENT' },
        body: { items: [{ matchedMedicineId: 'med-valid', quantity: 501 }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Must be an integer between 1 and 500'));
    }

    // Subcase 6c: Fractional quantity
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-fiona', role: 'PATIENT' },
        body: { items: [{ matchedMedicineId: 'med-valid', quantity: 2.5 }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Must be an integer between 1 and 500'));
    }

    // Subcase 6d: Empty items array
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-fiona', role: 'PATIENT' },
        body: { items: [] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('at least one verified medicine'));
    }

    // Subcase 6e: Medicine not found in catalogue
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-fiona', role: 'PATIENT' },
        body: { items: [{ matchedMedicineId: 'med-does-not-exist', quantity: 10, matchedMedicineName: 'Fictional Drug' }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('not mapped to an approved medicine in the catalogue'));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Failure during persistence rolls back canonical items, compatibility changes, and status
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Failure during persistence rolls back canonical items, compatibility changes, and status updates', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-7';
    let prescriptionStatus = 'VERIFICATION_REQUIRED';
    let itemsInDb = [{ id: 'existing-1', prescriptionId, quantity: 5 }];

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-george',
      status: prescriptionStatus,
      detectedMedicines: []
    };

    prisma.medicine.findUnique = async () => ({ id: 'med-valid', brandName: 'Valid Med' });

    // Transaction executes: inside, deleteMany happens, then create throws a database deadlock
    prisma.$transaction = async (cb) => {
      const rollbackSnapshotItems = [...itemsInDb];
      const mockTx = {
        prescription: {
          findUnique: async () => mockPrescription,
          update: async ({ data }) => {
            prescriptionStatus = data.status;
            return { ...mockPrescription, status: data.status };
          }
        },
        prescriptionOcrCandidate: {
          findMany: async () => []
        },
        prescriptionOcrRun: {
          findFirst: async () => null
        },
        prescriptionItem: {
          deleteMany: async () => {
            itemsInDb = [];
          },
          create: async () => {
            throw new Error('Simulated database write conflict / deadlock during item persistence');
          }
        },
        detectedMedicine: {
          findMany: async () => [],
          create: async () => ({})
        }
      };

      try {
        return await cb(mockTx);
      } catch (err) {
        // Transaction roll back: restore snapshot
        itemsInDb = rollbackSnapshotItems;
        prescriptionStatus = 'VERIFICATION_REQUIRED';
        throw err;
      }
    };

    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-george', role: 'PATIENT' },
      body: { items: [{ matchedMedicineId: 'med-valid', quantity: 10 }] }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 500, 'Must return 500 when transaction rejects');
    assert.strictEqual(prescriptionStatus, 'VERIFICATION_REQUIRED', 'Prescription status must NOT be updated to VERIFIED');
    assert.strictEqual(itemsInDb.length, 1, 'Existing items must be restored upon rollback');
    assert.strictEqual(itemsInDb[0].id, 'existing-1');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: Another patient cannot verify; admin authorization remains consistent
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Another patient cannot verify the prescription; admin behavior remains consistent with existing authorization', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-8';
    const ownerUserId = 'patient-owner-8';

    const mockPrescription = {
      id: prescriptionId,
      userId: ownerUserId,
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: []
    };

    let statusUpdated = false;

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => {
          statusUpdated = true;
          return { ...mockPrescription, ...data };
        }
      },
      prescriptionOcrCandidate: { findMany: async () => [] },
      prescriptionOcrRun: { findFirst: async () => null },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => data
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async () => ({ id: 'med-8', brandName: 'Med 8' });

    // Subcase 8a: Stranger patient attempt -> 403 Forbidden
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'patient-intruder', role: 'PATIENT' },
        body: { items: [{ matchedMedicineId: 'med-8', quantity: 5 }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.body.error.includes('Unauthorized: You can only verify your own prescription'));
      assert.strictEqual(statusUpdated, false);
    }

    // Subcase 8b: Admin attempt -> Allowed with HTTP 200
    {
      const req = {
        params: { id: prescriptionId },
        user: { id: 'admin-user-1', role: 'ADMIN' },
        body: { items: [{ matchedMedicineId: 'med-8', quantity: 5 }] }
      };
      const res = mockRes();
      await verifyDetectedMedicines(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(statusUpdated, true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: Legacy DetectedMedicine compatibility remains intact
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Legacy DetectedMedicine compatibility remains intact', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-9';
    const medicineId = 'med-legacy-9';

    const existingDms = [
      { id: 'dm-keep', prescriptionId, rawName: 'Old Med 1', matchedMedicineId: medicineId, quantity: 5, isConfirmed: false },
      { id: 'dm-drop', prescriptionId, rawName: 'Old Med 2', matchedMedicineId: 'med-unselected', quantity: 1, isConfirmed: false }
    ];

    let updatedDm = null;
    let deletedDmIds = [];

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-legacy-user',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: existingDms
    };

    const mockTx = {
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: { findMany: async () => [] },
      prescriptionOcrRun: { findFirst: async () => null },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => data
      },
      detectedMedicine: {
        findMany: async () => existingDms,
        update: async ({ where, data }) => {
          updatedDm = { id: where.id, ...data };
          return updatedDm;
        },
        deleteMany: async ({ where }) => {
          deletedDmIds = where.id.notIn;
          return { count: 1 };
        }
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async () => ({ id: medicineId, brandName: 'Updated Brand' });

    // Patient keeps dm-keep with new qty 12 and drops dm-drop
    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-legacy-user', role: 'PATIENT' },
      body: {
        items: [
          {
            id: 'dm-keep',
            matchedMedicineId: medicineId,
            matchedMedicineName: 'Updated Brand',
            quantity: 12,
            dosage: '250mg'
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(updatedDm, 'DetectedMedicine.update must have been called');
    assert.strictEqual(updatedDm.id, 'dm-keep');
    assert.strictEqual(updatedDm.quantity, 12);
    assert.strictEqual(updatedDm.isConfirmed, true);
    assert.deepStrictEqual(deletedDmIds, ['dm-keep'], 'dm-drop must be excluded from retained list and deleted');

    // Test getPrescriptionById compatibility
    prisma.prescription.findUnique = async () => ({
      ...mockPrescription,
      status: 'VERIFIED',
      detectedMedicines: [updatedDm]
    });
    prisma.prescriptionItem = {
      findMany: async () => [
        { id: 'item-1', prescriptionId, medicineId, quantity: 12, sourceType: 'LEGACY_CONFIRMED' }
      ]
    };

    const getReq = {
      params: { id: prescriptionId },
      user: { id: 'patient-legacy-user', role: 'PATIENT' }
    };
    const getRes = mockRes();

    await getPrescriptionById(getReq, getRes);

    assert.strictEqual(getRes.statusCode, 200);
    assert.ok(Array.isArray(getRes.body.prescription.detectedMedicines), 'Must include detectedMedicines for backward compatibility');
    assert.ok(Array.isArray(getRes.body.prescription.items), 'Must include canonical items');
    assert.strictEqual(getRes.body.prescription.items[0].sourceType, 'LEGACY_CONFIRMED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: Missing Prisma delegates use the safe parameterized SQL path
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Missing Prisma delegates use the safe parameterized SQL path, where applicable', async () => {
    restoreAll();
    const prescriptionId = 'rx-test-sql-10';
    const medicineId = 'med-sql-10';

    const sqlExecLog = [];

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-sql-user',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: []
    };

    // Client has NO prescriptionItem delegate and NO candidate delegate, forcing raw SQL
    const mockTx = {
      prescriptionItem: undefined,
      prescriptionOcrCandidate: undefined,
      prescriptionOcrRun: undefined,
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      },
      $queryRawUnsafe: async (sql, ...params) => {
        sqlExecLog.push({ type: 'query', sql, params });
        if (sql.includes('SELECT "id", "userId", "status" FROM "Prescription"')) {
          return [mockPrescription];
        }
        if (sql.includes('FROM "PrescriptionOcrCandidate"')) {
          return [];
        }
        if (sql.includes('FROM "PrescriptionOcrRun"')) {
          return [{ id: 'run-sql-1' }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        sqlExecLog.push({ type: 'execute', sql, params });
        return 1;
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescriptionItem = undefined;
    prisma.prescriptionOcrCandidate = undefined;
    prisma.prescriptionAuditLog = undefined;
    prisma.medicine.findUnique = async () => ({ id: medicineId, brandName: "Sql's Inject; DROP TABLE \"Users\";" });

    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-sql-user', role: 'PATIENT' },
      body: {
        items: [
          {
            matchedMedicineId: medicineId,
            quantity: 3,
            dosage: '500mg',
            instructions: "Take with water; SELECT * FROM 'Secret';"
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);

    // Verify DELETE was executed safely via parameterized SQL
    const deleteCall = sqlExecLog.find(c => c.sql.includes('DELETE FROM "PrescriptionItem"'));
    assert.ok(deleteCall, 'DELETE FROM PrescriptionItem must be called via $executeRawUnsafe');
    assert.strictEqual(deleteCall.params[0], prescriptionId);
    assert.ok(deleteCall.sql.includes('$1'), 'SQL must use positional placeholder $1');

    // Verify INSERT was executed safely via parameterized SQL with bound parameters
    const insertCall = sqlExecLog.find(c => c.sql.includes('INSERT INTO "PrescriptionItem"'));
    assert.ok(insertCall, 'INSERT INTO PrescriptionItem must be called via $executeRawUnsafe');
    assert.ok(insertCall.sql.includes('$1'), 'SQL must use positional placeholders');
    assert.ok(insertCall.sql.includes('$10'), 'SQL must use positional placeholders up to parameters');
    // Ensure the sensitive instruction string is passed as a bound parameter, NOT interpolated into SQL text
    assert.ok(
      insertCall.params.includes("Take with water; SELECT * FROM 'Secret';"),
      'Special characters must be passed as bound parameter value'
    );
    assert.strictEqual(
      insertCall.sql.includes("Take with water; SELECT * FROM 'Secret';"),
      false,
      'User strings must NEVER be directly concatenated or interpolated into SQL'
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: Hardened candidate provenance (older image, failed run, active image, manual item)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Hardened candidate provenance (older image, failed run, active image, manual item)', async () => {
    restoreAll();
    const prescriptionId = 'rx-provenance-test';
    const activeImageId = 'img-active-v2';
    const oldImageId = 'img-older-v1';

    const mockPrescription = {
      id: prescriptionId,
      userId: 'patient-alice',
      status: 'VERIFICATION_REQUIRED',
      activeImageId: activeImageId,
      detectedMedicines: []
    };

    const mockCandidates = [
      // 1. Valid candidate on current active image + completed run
      {
        id: 'cand-valid-active',
        ocrRunId: 'run-completed-active',
        matchedMedicineId: 'med-dolo',
        rawText: 'Dolo 650mg TDS',
        ocrRun: {
          id: 'run-completed-active',
          prescriptionId,
          imageId: activeImageId,
          status: 'COMPLETED'
        }
      },
      // 2. Stale candidate on older image version
      {
        id: 'cand-stale-image',
        ocrRunId: 'run-older-image',
        matchedMedicineId: 'med-paracetamol',
        rawText: 'Paracetamol 500mg',
        ocrRun: {
          id: 'run-older-image',
          prescriptionId,
          imageId: oldImageId,
          status: 'COMPLETED'
        }
      },
      // 3. Candidate from failed OCR run
      {
        id: 'cand-failed-run',
        ocrRunId: 'run-failed',
        matchedMedicineId: 'med-amox',
        rawText: 'Amoxicillin 500mg',
        ocrRun: {
          id: 'run-failed',
          prescriptionId,
          imageId: activeImageId,
          status: 'FAILED'
        }
      }
    ];

    const medicines = {
      'med-dolo': { id: 'med-dolo', brandName: 'Dolo 650' },
      'med-paracetamol': { id: 'med-paracetamol', brandName: 'Calpol 500' },
      'med-amox': { id: 'med-amox', brandName: 'Amoxil 500' },
      'med-manual': { id: 'med-manual', brandName: 'Cetirizine 10' }
    };

    const createdItems = [];

    const mockTx = {
      prescriptionAuditLog: createMockAuditLogDelegate(),
      prescription: {
        findUnique: async () => mockPrescription,
        update: async ({ data }) => ({ ...mockPrescription, ...data })
      },
      prescriptionOcrCandidate: {
        findMany: async ({ where }) => {
          // If query filter includes ocrRun condition, filter candidates appropriately
          if (where && where.ocrRun) {
            return mockCandidates.filter(c => {
              if (where.ocrRun.prescriptionId && c.ocrRun.prescriptionId !== where.ocrRun.prescriptionId) return false;
              if (where.ocrRun.status && c.ocrRun.status !== where.ocrRun.status) return false;
              if (where.ocrRun.imageId && c.ocrRun.imageId !== where.ocrRun.imageId) return false;
              return true;
            });
          }
          return mockCandidates;
        }
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-completed-active', prescriptionId })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
          createdItems.push(data);
          return data;
        }
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.medicine.findUnique = async ({ where }) => medicines[where.id] || null;

    const req = {
      params: { id: prescriptionId },
      user: { id: 'patient-alice', role: 'PATIENT' },
      body: {
        items: [
          // Item 1: Valid candidate from active image
          {
            matchedMedicineId: 'med-dolo',
            sourceCandidateId: 'cand-valid-active',
            quantity: 10
          },
          // Item 2: Stale candidate from older image
          {
            matchedMedicineId: 'med-paracetamol',
            sourceCandidateId: 'cand-stale-image',
            quantity: 5
          },
          // Item 3: Candidate from failed run
          {
            matchedMedicineId: 'med-amox',
            sourceCandidateId: 'cand-failed-run',
            quantity: 15
          },
          // Item 4: Manually added medicine
          {
            matchedMedicineId: 'med-manual',
            quantity: 20
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(createdItems.length, 4);

    const validActiveItem = createdItems.find(i => i.medicineId === 'med-dolo');
    assert.ok(validActiveItem, 'Valid active item must exist');
    assert.strictEqual(validActiveItem.sourceType, 'OCR_DERIVED', 'Active completed candidate must be OCR_DERIVED');
    assert.strictEqual(validActiveItem.sourceCandidateId, 'cand-valid-active');

    const staleImageItem = createdItems.find(i => i.medicineId === 'med-paracetamol');
    assert.ok(staleImageItem, 'Stale image item must exist');
    assert.strictEqual(staleImageItem.sourceType, 'UNSPECIFIED', 'Candidate from older image must be classified UNSPECIFIED');
    assert.strictEqual(staleImageItem.sourceCandidateId, null, 'Stale candidate link must be nullified');

    const failedRunItem = createdItems.find(i => i.medicineId === 'med-amox');
    assert.ok(failedRunItem, 'Failed run item must exist');
    assert.strictEqual(failedRunItem.sourceType, 'UNSPECIFIED', 'Candidate from failed run must be classified UNSPECIFIED');
    assert.strictEqual(failedRunItem.sourceCandidateId, null, 'Failed run candidate link must be nullified');

    const manualItem = createdItems.find(i => i.medicineId === 'med-manual');
    assert.ok(manualItem, 'Manual item must exist');
    assert.strictEqual(manualItem.sourceType, 'MANUALLY_ADDED', 'Manual item must be classified MANUALLY_ADDED');
    assert.strictEqual(manualItem.sourceCandidateId, null);
  });

  restoreAll();
  uninstallHermeticPrismaGuard(prisma);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('Results: 11 / 11 tests passed.');
  console.log('✓ All Slice 3 Confirmed Prescription Items & Provenance tests PASSED successfully!\n');
}

runSuite().catch((err) => {
  console.error('\n✗ Test suite failed with error:', err);
  process.exit(1);
});
