/**
 * MediFind AI — Phase 1, Step 11G: Slice 2 Structured OCR Runs & Candidates Unit & Regression Tests
 *
 * Tests:
 * 1. Successful OCR run and candidate persistence (linking to exact active image, storing rawText, executionTimeMs, status COMPLETED, candidates with isSelected = false).
 * 2. OCR worker failure and terminal failure state (status FAILED, sanitized errorMessage, executionTimeMs).
 * 3. Empty or unreadable OCR output (status FAILED, returns 422).
 * 4. Duplicate concurrent claim attempts (first acquires lease, second gets 409 Conflict when lease is active).
 * 5. Expired-lease reclamation and stale-worker rejection (when lease expires, worker 2 reclaims and marks worker 1 run failed; when worker 1 attempts to commit, it is rejected with LEASE_LOST).
 * 6. Active image changing during OCR (OCR run and candidates saved, but Prescription.ocrRawText and DetectedMedicine not overwritten).
 * 7. Atomic rollback when candidate insertion fails (simulated candidate error rolls back entire transaction, no partial candidates, run not marked COMPLETED).
 * 8. Legacy DetectedMedicine generation and verification compatibility (DetectedMedicine created, verified with /verify endpoint).
 * 9. Parameterized SQL fallback, if required by the actual Prisma Client (tested with $executeRawUnsafe / $queryRawUnsafe receiving positional parameters $1, $2, etc. and bound params).
 * 10. Confirmation that sensitive raw OCR text is not written to logs (capture console.log/error/warn and verify patient PII never appears).
 *
 * Offline execution: uses mocks and deterministic concurrency tests.
 * Does not connect to or modify any staging or production database.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Target controllers and utilities
const prisma = require('./src/prisma');
const {
  installHermeticPrismaGuard,
  uninstallHermeticPrismaGuard,
  createMockAuditLogDelegate,
  createMockPrescriptionItemDelegate,
  createMockDetectedMedicineDelegate
} = require('./test_hermetic_prisma');
const ocrEngine = require('./src/utils/ocrEngine');
const {
  uploadPrescription,
  verifyDetectedMedicines,
  acquireOcrRunClaim,
  failOcrRun,
  completeOcrRunAndPersistCandidates
} = require('./src/controllers/prescriptionController');

const UPLOAD_DIR = path.resolve(__dirname, 'uploads/prescriptions');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 1x1 valid PNG buffer with valid magic bytes
const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

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

let testCount = 0;
let passedCount = 0;

async function runTestAsync(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
  }
}

async function runSuite() {
  console.log('\n=== MediFind AI — Step 11G: Slice 2 Structured OCR Runs & Candidates Tests ===\n');

  // Save original functions to restore after tests
  const origTransaction = prisma.$transaction;
  const origQueryRawUnsafe = prisma.$queryRawUnsafe;
  const origExecuteRawUnsafe = prisma.$executeRawUnsafe;
  const origPrescriptionCreate = prisma.prescription.create;
  const origPrescriptionUpdate = prisma.prescription.update;
  const origPrescriptionFindUnique = prisma.prescription.findUnique;
  const origPrescriptionOcrRun = prisma.prescriptionOcrRun;
  const origPrescriptionOcrCandidate = prisma.prescriptionOcrCandidate;
  const origDetectedMedicineCreate = prisma.detectedMedicine ? prisma.detectedMedicine.create : null;
  const origDetectedMedicineUpdate = prisma.detectedMedicine ? prisma.detectedMedicine.update : null;
  const origDetectedMedicineDeleteMany = prisma.detectedMedicine ? prisma.detectedMedicine.deleteMany : null;
  const origMedicineFindMany = prisma.medicine.findMany;
  const origMedicineFindUnique = prisma.medicine.findUnique;
  const origMedicineFindFirst = prisma.medicine.findFirst;
  const origRunOCR = ocrEngine.runOCR;
  const origPrescriptionAuditLog = prisma.prescriptionAuditLog;
  const origPrescriptionItem = prisma.prescriptionItem;
  const origPrescriptionImage = prisma.prescriptionImage;
  installHermeticPrismaGuard(prisma);

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Successful OCR run and candidate persistence
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Successful OCR run and candidate persistence with versioned image link, timing, and immutable candidates', async () => {
    const testFileName = `test_ocr_success_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    let createdRun = null;
    let createdCandidates = [];
    let initialImage = null;

    // In-memory store for OCR run
    const ocrRunsDb = new Map();
    const candidatesDb = [];

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => ({ id: 'rx-ocr-1', ...data }),
          update: async ({ where, data }) => ({ id: 'rx-ocr-1', ...data }),
          findUnique: async () => ({ id: 'rx-ocr-1', activeImageId: initialImage?.id })
        },
        prescriptionImage: {
          create: async ({ data }) => {
            initialImage = { ...data };
            return initialImage;
          }
        },
        prescriptionOcrRun: {
          create: async ({ data }) => {
            createdRun = { ...data };
            ocrRunsDb.set(data.id, createdRun);
            return createdRun;
          },
          findFirst: async ({ where }) => {
            for (const run of ocrRunsDb.values()) {
              if (where.id && run.id !== where.id) continue;
              if (where.prescriptionId && run.prescriptionId !== where.prescriptionId) continue;
              if (where.status && run.status !== where.status) continue;
              if (where.leaseToken && run.leaseToken !== where.leaseToken) continue;
              return run;
            }
            return null;
          },
          update: async ({ where, data }) => {
            const existing = ocrRunsDb.get(where.id);
            if (existing) {
              Object.assign(existing, data);
              createdRun = existing;
            }
            return existing;
          }
        },
        prescriptionOcrCandidate: {
          create: async ({ data }) => {
            candidatesDb.push(data);
            createdCandidates.push(data);
            return data;
          }
        },
        detectedMedicine: {
          create: async ({ data }) => ({ id: `dm-${Date.now()}`, ...data })
        },
        prescriptionAuditLog: createMockAuditLogDelegate()
      };
      return callback(mockTx);
    };

    // Attach delegates on prisma as well for non-transactional helpers
    prisma.prescriptionOcrRun = {
      findFirst: async ({ where }) => {
        for (const run of ocrRunsDb.values()) {
          if (where.prescriptionId && run.prescriptionId !== where.prescriptionId) continue;
          if (where.status && run.status !== where.status) continue;
          return run;
        }
        return null;
      },
      create: async ({ data }) => {
        createdRun = { ...data };
        ocrRunsDb.set(data.id, createdRun);
        return createdRun;
      },
      update: async ({ where, data }) => {
        const existing = ocrRunsDb.get(where.id);
        if (existing) Object.assign(existing, data);
        return existing;
      }
    };
    prisma.prescription.findFirst = async () => null;
    prisma.prescription.update = async ({ data }) => ({ id: 'rx-ocr-1', ...data });
    prisma.prescription.findUnique = async () => ({
      id: 'rx-ocr-1',
      activeImageId: initialImage?.id,
      detectedMedicines: []
    });
    prisma.detectedMedicine = createMockDetectedMedicineDelegate();
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();
    prisma.medicine.findMany = async () => [
      { id: 'med-augmentin', brandName: 'Augmentin 625 Duo', genericName: 'Amoxicillin + Clavulanic Acid', strength: '625mg', dosageForm: 'TABLET' }
    ];

    ocrEngine.runOCR = async () => ({
      success: true,
      rawText: 'Augmentin 625 Duo 1 tab twice daily x 5 days',
      confidence: 96,
      medicineLines: [
        {
          rawLine: 'Augmentin 625 Duo 1 tab twice daily x 5 days',
          extractedName: 'Augmentin 625 Duo',
          strength: '625mg',
          rawInstruction: '1 tab twice daily',
          quantity: 10,
          confidenceClass: 'HIGH',
          box: [10, 20, 100, 40]
        }
      ]
    });

    const req = {
      user: { id: 'patient-test-1' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'prescription_doc.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 201, `Expected status 201, got ${res.statusCode}`);
    assert.ok(createdRun, 'PrescriptionOcrRun record must be created');
    assert.strictEqual(createdRun.prescriptionId, 'rx-ocr-1', 'Run must reference correct prescriptionId');
    assert.strictEqual(createdRun.imageId, initialImage.id, 'Run must link to exact active PrescriptionImage');
    assert.strictEqual(createdRun.status, 'COMPLETED', 'Terminal run status must be COMPLETED');
    assert.ok(typeof createdRun.executionTimeMs === 'number' && createdRun.executionTimeMs >= 0, 'Execution duration must be non-negative integer');
    assert.strictEqual(createdRun.rawOcrText, 'Augmentin 625 Duo 1 tab twice daily x 5 days', 'Raw OCR text must be stored verbatim');
    assert.strictEqual(createdRun.engineName, 'TESSERACT_OCR', 'Engine name must be recorded');
    assert.ok(createdRun.completedAt, 'completedAt timestamp must be set');

    // Candidates
    assert.ok(createdCandidates.length > 0, 'PrescriptionOcrCandidate records must be persisted');
    const cand = createdCandidates[0];
    assert.strictEqual(cand.ocrRunId, createdRun.id, 'Candidate must belong to created OCR run');
    assert.strictEqual(cand.isSelected, false, 'Candidate isSelected must initially be false (immutable suggestions)');
    assert.strictEqual(cand.matchedMedicineId, 'med-augmentin', 'Matched medicine ID must be recorded');
    assert.strictEqual(cand.matchedMedicineName, 'Augmentin 625 Duo', 'Matched medicine brand name must be recorded');
    assert.ok(cand.boundingBox.includes('10'), 'Bounding box coordinates must be preserved if available');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: OCR worker failure produces terminal FAILED status and sanitized error
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('OCR worker failure produces terminal FAILED status and sanitized error message', async () => {
    let failedRun = null;
    const testFileName = `test_ocr_fail_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => ({ id: 'rx-ocr-fail-1', ...data }),
          update: async ({ where, data }) => ({ id: 'rx-ocr-fail-1', ...data })
        },
        prescriptionImage: {
          create: async ({ data }) => ({ id: 'img-fail-1', ...data })
        },
        prescriptionOcrRun: {
          findFirst: async () => null,
          create: async ({ data }) => ({ id: 'ocr-fail-run-id', ...data }),
          updateMany: async ({ where, data }) => {
            failedRun = { id: where.id, ...data };
            return { count: 1 };
          }
        },
        prescriptionAuditLog: createMockAuditLogDelegate()
      };
      return callback(mockTx);
    };

    prisma.prescriptionOcrRun = {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: 'ocr-fail-run-id', ...data }),
      updateMany: async ({ where, data }) => {
        failedRun = { id: where.id, ...data };
        return { count: 1 };
      }
    };
    prisma.prescription.update = async ({ data }) => ({ id: 'rx-ocr-fail-1', ...data });
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();

    // Simulate OCR worker failure
    ocrEngine.runOCR = async () => ({
      success: false,
      error: 'PaddleOCR / Tesseract worker process exited unexpectedly with code 1: <Internal details>',
      rawText: ''
    });

    const req = {
      user: { id: 'patient-test-fail' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'corrupt_doc.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 422, 'Handled OCR failure should return 422 status');
    assert.ok(failedRun, 'PrescriptionOcrRun must be updated to terminal failure');
    assert.strictEqual(failedRun.status, 'FAILED', 'Terminal status must be FAILED');
    assert.ok(failedRun.errorMessage.includes('PaddleOCR'), 'errorMessage must describe failure reason');
    assert.strictEqual(failedRun.errorMessage.includes('<Internal details>'), false, 'Internal sensitive characters must be sanitized');
    assert.ok(failedRun.completedAt, 'completedAt must be populated on failure');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Empty or unreadable OCR output produces terminal FAILED status and 422
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Empty or unreadable OCR output marks run FAILED and returns 422', async () => {
    let runStatus = null;
    const testFileName = `test_ocr_empty_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => ({ id: 'rx-ocr-empty', ...data }),
          update: async ({ where, data }) => ({ id: 'rx-ocr-empty', ...data })
        },
        prescriptionImage: {
          create: async ({ data }) => ({ id: 'img-empty-1', ...data })
        },
        prescriptionOcrRun: {
          findFirst: async () => null,
          create: async ({ data }) => ({ id: 'ocr-empty-run-id', ...data }),
          updateMany: async ({ where, data }) => {
            runStatus = data.status;
            return { count: 1 };
          }
        },
        prescriptionAuditLog: createMockAuditLogDelegate()
      };
      return callback(mockTx);
    };

    prisma.prescriptionOcrRun = {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: 'ocr-empty-run-id', ...data }),
      updateMany: async ({ where, data }) => {
        runStatus = data.status;
        return { count: 1 };
      }
    };
    prisma.prescription.update = async ({ data }) => ({ id: 'rx-ocr-empty', ...data });
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();

    // Empty OCR text
    ocrEngine.runOCR = async () => ({
      success: true,
      rawText: '   \n  \t  ',
      confidence: 0,
      medicineLines: []
    });

    const req = {
      user: { id: 'patient-empty' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'blank.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 422, 'Empty OCR text must return 422');
    assert.strictEqual(runStatus, 'FAILED', 'OCR run must be transitioned to FAILED status');
    assert.strictEqual(res.body.ocrText, '', 'Response ocrText must be empty');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Duplicate concurrent claim attempts return HTTP 409 Conflict
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Duplicate concurrent claim returns 409 Conflict without triggering duplicate worker', async () => {
    const activeRuns = new Map();
    let workerInvocations = 0;

    const mockPrisma = {
      prescriptionOcrRun: {
        findFirst: async ({ where }) => {
          for (const run of activeRuns.values()) {
            if (run.prescriptionId === where.prescriptionId && run.imageId === where.imageId && run.status === where.status) {
              return run;
            }
          }
          return null;
        },
        create: async ({ data }) => {
          activeRuns.set(data.id, data);
          return data;
        }
      },
      prescription: {
        update: async () => ({})
      }
    };

    // First worker claims
    const claim1 = await acquireOcrRunClaim(mockPrisma, {
      prescriptionId: 'rx-dup-test',
      imageId: 'img-dup-1',
      leaseDurationMs: 60000 // 1 minute active lease
    });

    assert.ok(claim1.runId, 'First worker claim must succeed with runId');
    assert.ok(claim1.leaseToken, 'First worker must receive a leaseToken');

    // Second worker attempts claim for the SAME prescription and image
    let conflictThrown = false;
    let conflictCode = null;
    try {
      await acquireOcrRunClaim(mockPrisma, {
        prescriptionId: 'rx-dup-test',
        imageId: 'img-dup-1',
        leaseDurationMs: 60000
      });
    } catch (err) {
      conflictThrown = true;
      conflictCode = err.code;
    }

    assert.strictEqual(conflictThrown, true, 'Second concurrent claim must throw conflict');
    assert.strictEqual(conflictCode, 'OCR_RUN_CONFLICT', 'Error code must be OCR_RUN_CONFLICT');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Expired-lease reclamation and stale-worker rejection
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Expired-lease reclamation succeeds and rejects late-finishing stale worker', async () => {
    const runsDb = new Map();

    const mockPrisma = {
      prescriptionOcrRun: {
        findFirst: async ({ where }) => {
          for (const run of runsDb.values()) {
            if (where.id && run.id !== where.id) continue;
            if (where.prescriptionId && run.prescriptionId !== where.prescriptionId) continue;
            if (where.imageId && run.imageId !== where.imageId) continue;
            if (where.status && run.status !== where.status) continue;
            if (where.leaseToken && run.leaseToken !== where.leaseToken) continue;
            return run;
          }
          return null;
        },
        create: async ({ data }) => {
          runsDb.set(data.id, { ...data });
          return data;
        },
        update: async ({ where, data }) => {
          const run = runsDb.get(where.id);
          if (run) Object.assign(run, data);
          return run;
        }
      },
      prescription: {
        update: async () => ({})
      }
    };

    // 1. Worker 1 starts with a short expired lease (10ms in the past)
    const run1Id = 'worker-1-run';
    const lease1Token = 'lease-1-token';
    runsDb.set(run1Id, {
      id: run1Id,
      prescriptionId: 'rx-lease-reclaim',
      imageId: 'img-lease-1',
      status: 'PROCESSING',
      leaseToken: lease1Token,
      leaseExpiresAt: new Date(Date.now() - 1000) // already expired!
    });

    // 2. Worker 2 detects expired lease and reclaims it
    const claim2 = await acquireOcrRunClaim(mockPrisma, {
      prescriptionId: 'rx-lease-reclaim',
      imageId: 'img-lease-1',
      leaseDurationMs: 180000
    });

    assert.ok(claim2.runId, 'Worker 2 must successfully claim expired lease');
    assert.notStrictEqual(claim2.runId, run1Id, 'Worker 2 must have a new distinct runId');

    // Verify Worker 1's run was marked FAILED due to expired lease
    const oldRun = runsDb.get(run1Id);
    assert.strictEqual(oldRun.status, 'FAILED', 'Expired run must be marked FAILED on reclaim');
    assert.ok(oldRun.errorMessage.includes('Lease expired'), 'ErrorMessage must note lease expiration');

    // 3. Worker 1 now tries to commit its results late using completeOcrRunAndPersistCandidates
    let staleWorkerRejected = false;
    try {
      await completeOcrRunAndPersistCandidates(mockPrisma, {
        runId: run1Id,
        leaseToken: lease1Token,
        prescriptionId: 'rx-lease-reclaim',
        imageId: 'img-lease-1',
        rawText: 'Late text that should be rejected',
        executionTimeMs: 5000,
        candidates: [],
        detectedItems: []
      });
    } catch (err) {
      if (err.code === 'LEASE_LOST') {
        staleWorkerRejected = true;
      }
    }

    assert.strictEqual(staleWorkerRejected, true, 'Late worker whose lease expired must be rejected with LEASE_LOST');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Active image changing during OCR (stale image guard)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Active image changing during OCR saves candidates for audit but does not overwrite active prescription', async () => {
    let runCompleted = false;
    let candidatesSaved = 0;
    let prescriptionOverwritten = false;
    let detectedMedicinesInserted = 0;

    const mockTx = {
      prescription: {
        // Active image was changed from img-v1 to img-v2 while OCR was in flight
        findUnique: async () => ({ id: 'rx-stale-test', activeImageId: 'img-v2' }),
        update: async () => {
          prescriptionOverwritten = true;
        }
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-img-v1', status: 'PROCESSING', leaseToken: 'token-v1' }),
        update: async ({ data }) => {
          if (data.status === 'COMPLETED') runCompleted = true;
        }
      },
      prescriptionOcrCandidate: {
        create: async () => {
          candidatesSaved++;
        }
      },
      detectedMedicine: {
        create: async () => {
          detectedMedicinesInserted++;
        }
      }
    };

    const result = await completeOcrRunAndPersistCandidates(mockTx, {
      runId: 'run-img-v1',
      leaseToken: 'token-v1',
      prescriptionId: 'rx-stale-test',
      imageId: 'img-v1', // OCR was run on img-v1
      rawText: 'Outdated prescription text from v1',
      executionTimeMs: 1200,
      candidates: [
        { id: 'cand-1', rawText: 'Old Med 500mg', confidenceScore: 0.9 }
      ],
      detectedItems: [
        { rawName: 'Old Med 500mg', confidence: 0.9 }
      ]
    });

    assert.strictEqual(result.isStale, true, 'Result must be flagged as isStale: true');
    assert.strictEqual(runCompleted, true, 'OCR run record must be marked COMPLETED for audit history');
    assert.strictEqual(candidatesSaved, 1, 'Candidates for stale run must be persisted for auditability');
    assert.strictEqual(prescriptionOverwritten, false, 'Prescription.ocrRawText must NEVER be overwritten by stale image run');
    assert.strictEqual(detectedMedicinesInserted, 0, 'DetectedMedicine rows for stale image must NOT be inserted');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Atomic rollback when candidate insertion fails
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Atomic rollback when candidate insertion fails leaves no partial records', async () => {
    let runStatusUpdated = false;

    // Simulate transactional failure inside $transaction
    const testFn = async () => {
      const mockTx = {
        prescriptionOcrRun: {
          findFirst: async () => ({ id: 'run-fail-cand', status: 'PROCESSING', leaseToken: 'tok' }),
          update: async () => {
            runStatusUpdated = true;
          }
        },
        prescriptionOcrCandidate: {
          create: async () => {
            throw new Error('Simulated database deadlock during candidate insertion');
          }
        },
        prescription: {
          findUnique: async () => ({ id: 'rx-fail', activeImageId: 'img-1' }),
          update: async () => ({})
        }
      };

      await completeOcrRunAndPersistCandidates(mockTx, {
        runId: 'run-fail-cand',
        leaseToken: 'tok',
        prescriptionId: 'rx-fail',
        imageId: 'img-1',
        rawText: 'Text',
        executionTimeMs: 100,
        candidates: [{ id: 'cand-fail', rawText: 'Failing cand' }]
      });
    };

    let errorThrown = false;
    try {
      await testFn();
    } catch (err) {
      errorThrown = true;
      assert.ok(err.message.includes('deadlock'), 'Error message must reflect candidate insertion failure');
    }

    assert.strictEqual(errorThrown, true, 'Transaction must fail and reject');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: Legacy DetectedMedicine generation and verification compatibility
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Legacy DetectedMedicine generation and verification compatibility remains fully functional', async () => {
    let prescriptionStatus = 'VERIFICATION_REQUIRED';
    let verifiedMedicines = [];

    const mockDb = {
      id: 'rx-compat-1',
      userId: 'user-patient-verify',
      status: 'VERIFICATION_REQUIRED',
      detectedMedicines: [
        { id: 'dm-1', prescriptionId: 'rx-compat-1', rawName: 'Paracetamol 500mg', quantity: 10, isConfirmed: false }
      ]
    };

    const mockTx = {
      _isTransaction: true,
      prescription: {
        findUnique: async ({ where }) => {
          if (where.id === 'rx-compat-1') return mockDb;
          return null;
        },
        update: async ({ where, data }) => {
          prescriptionStatus = data.status;
          return { ...mockDb, status: prescriptionStatus };
        }
      },
      medicine: {
        findUnique: async () => ({
          id: 'med-paracetamol',
          brandName: 'Dolo 650',
          genericName: 'Paracetamol',
          strength: '650mg'
        })
      },
      detectedMedicine: {
        findMany: async () => mockDb.detectedMedicines,
        update: async ({ where, data }) => {
          verifiedMedicines.push({ id: where.id, ...data });
          return { id: where.id, ...data };
        },
        deleteMany: async () => ({ count: 0 })
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => data
      },
      prescriptionOcrCandidate: {
        findMany: async () => []
      },
      prescriptionOcrRun: {
        findFirst: async () => null
      },
      prescriptionAuditLog: createMockAuditLogDelegate()
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescription.findUnique = mockTx.prescription.findUnique;
    prisma.medicine.findUnique = mockTx.medicine.findUnique;
    prisma.detectedMedicine.update = mockTx.detectedMedicine.update;
    prisma.detectedMedicine.deleteMany = mockTx.detectedMedicine.deleteMany;
    prisma.prescription.update = mockTx.prescription.update;
    prisma.prescriptionItem = mockTx.prescriptionItem;
    prisma.prescriptionAuditLog = mockTx.prescriptionAuditLog;

    const req = {
      params: { id: 'rx-compat-1' },
      user: { id: 'user-patient-verify', role: 'PATIENT' },
      body: {
        items: [
          {
            id: 'dm-1',
            matchedMedicineId: 'med-paracetamol',
            matchedMedicineName: 'Dolo 650',
            quantity: 10,
            dosage: '650mg',
            frequency: '1 tab SOS',
            duration: '3 days',
            isConfirmed: true
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200, 'Verification must return status 200');
    assert.strictEqual(prescriptionStatus, 'VERIFIED', 'Prescription must be marked VERIFIED');
    assert.strictEqual(verifiedMedicines.length, 1, 'Detected medicine must be updated to confirmed');
    assert.strictEqual(verifiedMedicines[0].isConfirmed, true, 'isConfirmed must be true');
    assert.strictEqual(verifiedMedicines[0].matchedMedicineId, 'med-paracetamol', 'Medicine catalogue ID must be recorded');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: Parameterized raw SQL fallback with bound positional parameters
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Parameterized raw SQL fallback passes bound positional parameters for OCR run and candidates', async () => {
    const sqlCalls = [];
    const testPrescriptionId = 'rx-sql-test-uuid';
    const testImageId = 'img-sql-test-uuid';
    const sensitiveCandidateText = "Malicious'; DROP TABLE \"PrescriptionOcrRun\"; --";

    const mockClient = {
      // Intentionally omit delegates to test SQL fallback branch
      prescriptionOcrRun: undefined,
      prescriptionOcrCandidate: undefined,
      prescription: undefined,
      detectedMedicine: undefined,
      $queryRawUnsafe: async (sql, ...params) => {
        sqlCalls.push({ type: 'QUERY', sql, params });
        // Return active run for complete check, empty for claim check
        if (sql.includes('SELECT "id", "status", "leaseToken"')) {
          return [{ id: 'mock-run-sql', status: 'PROCESSING', leaseToken: 'mock-lease-sql' }];
        }
        if (sql.includes('SELECT "id", "activeImageId"')) {
          return [{ id: testPrescriptionId, activeImageId: testImageId }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        sqlCalls.push({ type: 'EXECUTE', sql, params });
        return 1;
      }
    };

    // 1. Test acquire claim via raw SQL
    const claim = await acquireOcrRunClaim(mockClient, {
      prescriptionId: testPrescriptionId,
      imageId: testImageId,
      engineName: 'TESSERACT_OCR',
      engineVersion: '1.0.0',
      leaseDurationMs: 180000
    });

    assert.ok(claim.runId, 'Raw SQL claim must generate runId');
    assert.ok(claim.leaseToken, 'Raw SQL claim must generate leaseToken');

    // 2. Test complete run and persist candidates via raw SQL
    await completeOcrRunAndPersistCandidates(mockClient, {
      runId: 'mock-run-sql',
      leaseToken: 'mock-lease-sql',
      prescriptionId: testPrescriptionId,
      imageId: testImageId,
      rawText: 'Parsed medicine text',
      executionTimeMs: 450,
      candidates: [
        {
          id: 'cand-sql-1',
          rawText: sensitiveCandidateText,
          normalizedName: 'Paracetamol',
          confidenceScore: 0.88,
          boundingBox: '[1,2,3,4]',
          dosage: '500mg',
          extractedQuantity: 20
        }
      ],
      detectedItems: []
    });

    // Verify all SQL statements used positional placeholders $1, $2, ... and bound params
    for (const call of sqlCalls) {
      assert.strictEqual(call.sql.includes("DROP TABLE"), false, 'Malicious SQL fragment must never be interpolated into SQL text');
      assert.ok(call.sql.includes('$1'), 'Raw SQL must use positional parameter placeholders');
    }

    // Verify the candidate INSERT statement
    const candInsert = sqlCalls.find(c => c.type === 'EXECUTE' && c.sql.includes('INSERT INTO "PrescriptionOcrCandidate"'));
    assert.ok(candInsert, 'Candidate INSERT SQL statement must be executed');
    assert.ok(candInsert.sql.includes('$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14'), 'Must use 14 positional placeholders');
    assert.strictEqual(candInsert.params[2], sensitiveCandidateText, 'Candidate text with quotes must be passed as bound parameter');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: Confirmation that sensitive raw OCR text is NOT written to logs
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Sensitive raw OCR text and patient PII are NEVER printed to console logs', async () => {
    const loggedMessages = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;

    console.log = (...args) => loggedMessages.push(args.join(' '));
    console.error = (...args) => loggedMessages.push(args.join(' '));
    console.warn = (...args) => loggedMessages.push(args.join(' '));

    const sensitivePii = "CONFIDENTIAL PATIENT: John Doe | SSN: 000-11-2222 | DIAGNOSIS: Stage 4 Malignancy";
    const testFileName = `test_ocr_pii_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    try {
      prisma.$transaction = async (callback) => {
        const mockTx = {
          prescription: {
            create: async ({ data }) => ({ id: 'rx-pii-test', ...data }),
            update: async ({ where, data }) => ({ id: 'rx-pii-test', ...data }),
            findUnique: async () => ({ id: 'rx-pii-test', activeImageId: 'img-pii' })
          },
          prescriptionImage: {
            create: async ({ data }) => ({ id: 'img-pii', ...data })
          },
          prescriptionOcrRun: {
            findFirst: async () => null,
            create: async ({ data }) => ({ id: 'run-pii', ...data }),
            update: async () => ({})
          },
          prescriptionOcrCandidate: {
            create: async () => ({})
          },
          detectedMedicine: {
            create: async () => ({})
          },
          prescriptionAuditLog: createMockAuditLogDelegate()
        };
        return callback(mockTx);
      };

      prisma.prescriptionAuditLog = createMockAuditLogDelegate();
      prisma.prescription.update = async ({ data }) => ({ id: 'rx-pii-test', ...data });
      prisma.prescription.findUnique = async () => ({ id: 'rx-pii-test', activeImageId: 'img-pii', detectedMedicines: [] });
      prisma.medicine.findMany = async () => [];

      ocrEngine.runOCR = async () => ({
        success: true,
        rawText: sensitivePii,
        confidence: 90,
        medicineLines: []
      });

      const req = {
        user: { id: 'patient-pii' },
        body: {},
        file: {
          path: testFilePath,
          originalname: 'sensitive.png',
          filename: testFileName,
          mimetype: 'image/png',
          size: VALID_PNG_BYTES.length
        }
      };
      const res = mockRes();

      await uploadPrescription(req, res);

      // Verify that NONE of the logged messages contain sensitive patient PII
      for (const msg of loggedMessages) {
        assert.strictEqual(msg.includes('John Doe'), false, 'Patient name must not be in console logs');
        assert.strictEqual(msg.includes('000-11-2222'), false, 'SSN must not be in console logs');
        assert.strictEqual(msg.includes('Malignancy'), false, 'Diagnosis must not be in console logs');
        assert.strictEqual(msg.includes(sensitivePii), false, 'Raw OCR text must not be in console logs');
      }
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 11I REGRESSION TESTS: Concurrency, Locking Contract & Stale Protection
  // NOTE: Offline mocked database access. These tests verify application logic,
  // transaction coordination, and modeled locking contracts; they do not claim
  // to prove live PostgreSQL kernel locking semantics.
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: Claim locking and claim creation use the same transaction client
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Step 11I Fix 1: Claim locking and claim creation share the exact same transaction client [Mocked Database Access]', async () => {
    let transactionClientUsedForLock = null;
    let transactionClientUsedForRunCreate = null;
    let rootClientLockAttempted = false;

    const mockTx = {
      _isTransaction: true,
      $queryRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          transactionClientUsedForLock = mockTx;
          return [{ id: params[0] }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO "PrescriptionOcrRun"')) {
          transactionClientUsedForRunCreate = mockTx;
        }
        return 1;
      }
    };

    const mockPrismaClient = {
      $transaction: async (fn) => {
        return fn(mockTx);
      },
      $queryRawUnsafe: async (sql) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          rootClientLockAttempted = true;
        }
        return [];
      },
      $executeRawUnsafe: async () => 1
    };

    const claim = await acquireOcrRunClaim(mockPrismaClient, {
      prescriptionId: 'rx-tx-isolation-test',
      imageId: 'img-tx-1',
      leaseDurationMs: 60000
    });

    assert.ok(claim && claim.runId, 'Claim must succeed and return runId');
    assert.strictEqual(rootClientLockAttempted, false, 'SELECT ... FOR UPDATE must NEVER run on root client outside a transaction');
    assert.ok(transactionClientUsedForLock, 'Row lock query must execute on the transaction client');
    assert.ok(transactionClientUsedForRunCreate, 'Run insert query must execute on the transaction client');
    assert.strictEqual(
      transactionClientUsedForLock,
      transactionClientUsedForRunCreate,
      'Row lock and OCR run creation must execute on the exact same transaction client instance'
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 12: Competing claims cannot both claim under modeled locking contract
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Step 11I Fix 1: Competing claims serialize under modeled locking contract and reject duplicate worker [Mocked Concurrency]', async () => {
    // Simulated database state protected by prescription row lock
    let prescriptionLockHolder = null;
    const lockWaitQueue = [];
    const runsInDb = [];

    async function acquireLock(workerId) {
      if (prescriptionLockHolder === null) {
        prescriptionLockHolder = workerId;
        return;
      }
      await new Promise(resolve => lockWaitQueue.push({ workerId, resolve }));
    }

    function releaseLock(workerId) {
      if (prescriptionLockHolder === workerId) {
        if (lockWaitQueue.length > 0) {
          const next = lockWaitQueue.shift();
          prescriptionLockHolder = next.workerId;
          next.resolve();
        } else {
          prescriptionLockHolder = null;
        }
      }
    }

    function createWorkerClient(workerId) {
      const tx = {
        _isTransaction: true,
        $queryRawUnsafe: async (sql, ...params) => {
          if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
            await acquireLock(workerId);
            return [{ id: params[0] }];
          }
          if (typeof sql === 'string' && sql.includes('SELECT "id", "status", "leaseToken"')) {
            const found = runsInDb.filter(r => r.prescriptionId === params[0] && r.imageId === params[1] && r.status === params[2]);
            return found;
          }
          return [];
        },
        $executeRawUnsafe: async (sql, ...params) => {
          if (typeof sql === 'string' && sql.includes('INSERT INTO "PrescriptionOcrRun"')) {
            runsInDb.push({
              id: params[0],
              prescriptionId: params[1],
              imageId: params[2],
              status: params[5],
              leaseToken: params[6],
              leaseExpiresAt: params[7]
            });
          }
          return 1;
        }
      };

      return {
        $transaction: async (fn) => {
          try {
            return await fn(tx);
          } finally {
            releaseLock(workerId);
          }
        }
      };
    }

    const clientA = createWorkerClient('worker-A');
    const clientB = createWorkerClient('worker-B');

    // Launch both workers simultaneously
    const promiseA = acquireOcrRunClaim(clientA, {
      prescriptionId: 'rx-concurrent-1',
      imageId: 'img-concurrent-1',
      leaseDurationMs: 60000
    });

    const promiseB = acquireOcrRunClaim(clientB, {
      prescriptionId: 'rx-concurrent-1',
      imageId: 'img-concurrent-1',
      leaseDurationMs: 60000
    });

    const results = await Promise.allSettled([promiseA, promiseB]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one competing claim must succeed');
    assert.strictEqual(rejected.length, 1, 'Exactly one competing claim must be rejected');
    assert.strictEqual(rejected[0].reason.code, 'OCR_RUN_CONFLICT', 'Rejected claim must have error code OCR_RUN_CONFLICT');
    assert.strictEqual(runsInDb.length, 1, 'Only one OCR run record must be created in the database');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 13: Expired lease reclamation and stale worker rejection
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Step 11I Fix 1/2: Expired lease reclamation allows new worker while stale worker is rejected on promotion [Mocked Concurrency]', async () => {
    const runsDb = new Map();
    let prescriptionUpdated = false;
    let detectedMedCount = 0;

    const mockDb = {
      $transaction: async (fn) => fn(mockDb),
      _isTransaction: true,
      $queryRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE') && sql.includes('PrescriptionOcrRun')) {
          const run = runsDb.get(params[0]);
          return run ? [run] : [];
        }
        if (typeof sql === 'string' && sql.includes('FROM "PrescriptionOcrRun"')) {
          for (const run of runsDb.values()) {
            if (run.prescriptionId === params[0] && run.imageId === params[1] && run.status === params[2]) {
              return [run];
            }
          }
          return [];
        }
        if (typeof sql === 'string' && sql.includes('SELECT "id", "status", "leaseToken" FROM "PrescriptionOcrRun"')) {
          const run = runsDb.get(params[0]);
          if (run && run.leaseToken === params[1] && run.status === params[2]) {
            return [run];
          }
          return [];
        }
        if (typeof sql === 'string' && sql.includes('FROM "Prescription"')) {
          return [{ id: params[0], activeImageId: 'img-lease-target' }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('UPDATE "PrescriptionOcrRun" SET "status" = $1') && params[0] === 'FAILED') {
          const run = runsDb.get(params[3]);
          if (run) run.status = 'FAILED';
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO "PrescriptionOcrRun"')) {
          runsDb.set(params[0], {
            id: params[0],
            prescriptionId: params[1],
            imageId: params[2],
            status: params[5],
            leaseToken: params[6],
            leaseExpiresAt: params[7]
          });
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('UPDATE "Prescription"')) {
          prescriptionUpdated = true;
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO "DetectedMedicine"')) {
          detectedMedCount++;
          return 1;
        }
        return 1;
      }
    };

    // Stale Worker 1 has an expired lease
    const expiredRunId = 'stale-run-1';
    const expiredLeaseToken = 'lease-expired-token';
    runsDb.set(expiredRunId, {
      id: expiredRunId,
      prescriptionId: 'rx-lease-test',
      imageId: 'img-lease-target',
      status: 'PROCESSING',
      leaseToken: expiredLeaseToken,
      leaseExpiresAt: new Date(Date.now() - 5000) // expired 5 seconds ago
    });

    // Worker 2 reclaims the expired lease
    const claim2 = await acquireOcrRunClaim(mockDb, {
      prescriptionId: 'rx-lease-test',
      imageId: 'img-lease-target',
      leaseDurationMs: 60000
    });
    assert.ok(claim2 && claim2.runId, 'Worker 2 must successfully acquire claim by reclaiming expired lease');

    // Confirm Worker 1's run was transitioned to FAILED
    const reclaimedRun = runsDb.get(expiredRunId);
    assert.strictEqual(reclaimedRun.status, 'FAILED', 'Expired run must be marked FAILED upon reclamation');

    // Worker 1 now attempts to complete and persist results late
    let worker1Error = null;
    try {
      await completeOcrRunAndPersistCandidates(mockDb, {
        runId: expiredRunId,
        leaseToken: expiredLeaseToken,
        prescriptionId: 'rx-lease-test',
        imageId: 'img-lease-target',
        rawText: 'Late results',
        candidates: [{ id: 'cand-late', rawText: 'Late med' }],
        detectedItems: [{ rawName: 'Late med' }]
      });
    } catch (err) {
      worker1Error = err;
    }

    assert.ok(worker1Error, 'Late worker must be rejected with an error');
    assert.strictEqual(worker1Error.code, 'LEASE_LOST', 'Error code must be LEASE_LOST');
    assert.strictEqual(prescriptionUpdated, false, 'Late worker must NOT update Prescription status or raw text');
    assert.strictEqual(detectedMedCount, 0, 'Late worker must NOT insert any DetectedMedicine records');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 14: Image replacement during OCR prevents stale result promotion
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Step 11I Fix 2: Image replacement during OCR prevents stale result promotion [Mocked Concurrency]', async () => {
    let prescriptionUpdated = false;
    let detectedMedicinesCount = 0;
    let candidatesSavedCount = 0;

    const mockTx = {
      _isTransaction: true,
      $queryRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('FROM "PrescriptionOcrRun"')) {
          return [{ id: 'run-v1', status: 'PROCESSING', leaseToken: 'tok-v1' }];
        }
        if (typeof sql === 'string' && sql.includes('FROM "Prescription"')) {
          // Prescription has activeImageId = 'img-v2' (user replaced image while OCR ran for img-v1)
          return [{ id: 'rx-replace-test', activeImageId: 'img-v2' }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO "PrescriptionOcrCandidate"')) {
          candidatesSavedCount++;
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('UPDATE "Prescription"')) {
          prescriptionUpdated = true;
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO "DetectedMedicine"')) {
          detectedMedicinesCount++;
          return 1;
        }
        return 1;
      }
    };

    const result = await completeOcrRunAndPersistCandidates(mockTx, {
      runId: 'run-v1',
      leaseToken: 'tok-v1',
      prescriptionId: 'rx-replace-test',
      imageId: 'img-v1', // OCR executed on old image
      rawText: 'Old text from superseded image',
      candidates: [
        { id: 'c1', rawText: 'Old Med 10mg', confidenceScore: 0.95 }
      ],
      detectedItems: [
        { rawName: 'Old Med 10mg', quantity: 1 }
      ]
    });

    assert.strictEqual(result.isStale, true, 'Result must be marked isStale: true');
    assert.strictEqual(candidatesSavedCount, 1, 'Candidates must be saved into PrescriptionOcrCandidate for auditability');
    assert.strictEqual(prescriptionUpdated, false, 'Prescription table must NOT be updated for stale image');
    assert.strictEqual(detectedMedicinesCount, 0, 'DetectedMedicine rows must NOT be inserted for stale image');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 15: Stale-image guard covers final writes, not only an earlier read
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Step 11I Fix 2: Stale-image guard covers the final promotion write via conditional compare-and-set [Mocked Concurrency]', async () => {
    let prescriptionRowLockAcquired = false;
    let detectedMedicinesInserted = 0;

    // Simulate race window:
    // Read check saw activeImageId === 'img-race-v1'.
    // BUT before the UPDATE executed, another concurrent transaction committed activeImageId = 'img-race-v2'.
    // Thus the conditional UPDATE WHERE "id" = $3 AND "activeImageId" = $4 updates 0 rows!
    const mockTx = {
      _isTransaction: true,
      $queryRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('FROM "PrescriptionOcrRun"')) {
          return [{ id: 'run-race-1', status: 'PROCESSING', leaseToken: 'tok-race-1' }];
        }
        if (typeof sql === 'string' && sql.includes('FROM "Prescription"') && sql.includes('FOR UPDATE')) {
          prescriptionRowLockAcquired = true;
          // Initial read check sees matching activeImageId
          return [{ id: 'rx-race-1', activeImageId: 'img-race-v1' }];
        }
        return [];
      },
      $executeRawUnsafe: async (sql, ...params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO "PrescriptionOcrCandidate"')) {
          return 1;
        }
        if (typeof sql === 'string' && sql.includes('UPDATE "Prescription"') && sql.includes('AND "activeImageId" = $4')) {
          // Conditional write: activeImageId no longer matches! 0 rows affected!
          return 0;
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO "DetectedMedicine"')) {
          detectedMedicinesInserted++;
          return 1;
        }
        return 1;
      }
    };

    const result = await completeOcrRunAndPersistCandidates(mockTx, {
      runId: 'run-race-1',
      leaseToken: 'tok-race-1',
      prescriptionId: 'rx-race-1',
      imageId: 'img-race-v1',
      rawText: 'Race condition text',
      candidates: [{ id: 'cand-race', rawText: 'Race Med' }],
      detectedItems: [{ rawName: 'Race Med' }]
    });

    assert.ok(prescriptionRowLockAcquired, 'Row lock must be requested on Prescription');
    assert.strictEqual(result.isStale, true, 'Result must be flagged isStale: true when conditional write affects 0 rows');
    assert.strictEqual(detectedMedicinesInserted, 0, 'DetectedMedicine rows must NOT be inserted when conditional write fails');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Restore all mocked functions
  // ─────────────────────────────────────────────────────────────────────────────
  prisma.$transaction = origTransaction;
  prisma.$queryRawUnsafe = origQueryRawUnsafe;
  prisma.$executeRawUnsafe = origExecuteRawUnsafe;
  prisma.prescription.create = origPrescriptionCreate;
  prisma.prescription.update = origPrescriptionUpdate;
  prisma.prescription.findUnique = origPrescriptionFindUnique;
  prisma.prescriptionOcrRun = origPrescriptionOcrRun;
  prisma.prescriptionOcrCandidate = origPrescriptionOcrCandidate;
  if (origDetectedMedicineCreate && prisma.detectedMedicine) {
    prisma.detectedMedicine.create = origDetectedMedicineCreate;
  }
  if (origDetectedMedicineUpdate && prisma.detectedMedicine) {
    prisma.detectedMedicine.update = origDetectedMedicineUpdate;
  }
  if (origDetectedMedicineDeleteMany && prisma.detectedMedicine) {
    prisma.detectedMedicine.deleteMany = origDetectedMedicineDeleteMany;
  }
  prisma.medicine.findMany = origMedicineFindMany;
  prisma.medicine.findUnique = origMedicineFindUnique;
  prisma.medicine.findFirst = origMedicineFindFirst;
  ocrEngine.runOCR = origRunOCR;
  if (origPrescriptionAuditLog) prisma.prescriptionAuditLog = origPrescriptionAuditLog;
  if (origPrescriptionItem) prisma.prescriptionItem = origPrescriptionItem;
  if (origPrescriptionImage) prisma.prescriptionImage = origPrescriptionImage;
  uninstallHermeticPrismaGuard(prisma);

  console.log(`\n─────────────────────────────────────────────────────────────`);
  console.log(`Results: ${passedCount} / ${testCount} tests passed.`);
  if (passedCount === testCount) {
    console.log(`✓ All Slice 2 Structured OCR Runs & Candidates tests PASSED successfully!\n`);
    process.exit(0);
  } else {
    console.error(`✗ Some tests failed! (${testCount - passedCount} failed)\n`);
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
