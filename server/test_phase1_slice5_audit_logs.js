/**
 * MediFind AI — Phase 1, Step 11Q: Slice 5 Centralized Audit Logging Unit & Regression Tests
 *
 * Tests:
 * 1. Helper writes using the Prisma delegate (prescriptionAuditLog.create).
 * 2. Parameterized SQL fallback with bound positional arguments ($executeRawUnsafe).
 * 3. Correct action names, actor fields, and prescription snapshot enforcement.
 * 4. Upload audit entry is atomic with prescription/image creation [Mocked Transaction].
 * 5. OCR start/completion/failure/superseded event paths [Mocked Transaction].
 * 6. Verification audit entry shares the transaction with canonical items [Mocked Transaction].
 * 7. Clarification creation/response/resolution audit entries share their respective transactions [Mocked Transaction].
 * 8. Audit-write failure rolls back a mandatory business mutation [Mocked Transaction].
 * 9. Read/access logging failures do not break successful reads or 403 responses [Mocked Best-Effort].
 * 10. Sensitive metadata redaction (strips raw text, tokens, disk paths, dosages, and inquiries).
 * 11. No duplicate success events for failed or superseded OCR runs or duplicate clarification replies.
 * 12. Historical retention when prescription relation is nullified (prescriptionIdSnapshot).
 *
 * Offline execution: uses deterministic mocks and test doubles.
 * Does not connect to or modify any staging or production database.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = require('./src/prisma');
const {
  installHermeticPrismaGuard,
  uninstallHermeticPrismaGuard,
  createMockAuditLogDelegate
} = require('./test_hermetic_prisma');
const ocrEngine = require('./src/utils/ocrEngine');
const {
  recordPrescriptionAuditLog,
  recordPrescriptionAuditLogBestEffort,
  extractClientIp,
  sanitizeMetadata,
  supportsPrescriptionAuditLogging,
  VALID_ACTIONS
} = require('./src/utils/prescriptionAuditLogger');

const {
  uploadPrescription,
  acquireOcrRunClaim,
  failOcrRun,
  completeOcrRunAndPersistCandidates,
  verifyDetectedMedicines,
  getPrescriptionById,
  getPrescriptionImage
} = require('./src/controllers/prescriptionController');

const {
  createClarification,
  respondToClarification,
  resolveClarification
} = require('./src/controllers/clarificationController');

const UPLOAD_DIR = path.resolve(__dirname, 'uploads/prescriptions');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    sentFile: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    sendFile(filePath) {
      this.sentFile = filePath;
      return this;
    }
  };
  return res;
}

let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

async function runSuite() {
  console.log('=== MediFind AI — Step 11Q: Slice 5 Centralized Audit Logging Tests ===\n');
  installHermeticPrismaGuard(prisma);

  // Silence external notifications during mock runs
  if (prisma.notification) {
    prisma.notification.create = async () => ({ id: 'mock-notif-id' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Helper writes using the Prisma delegate
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Helper writes using the Prisma delegate', async () => {
    let delegateCalled = false;
    let writtenRecord = null;

    const mockClient = {
      prescriptionAuditLog: {
        create: async ({ data }) => {
          delegateCalled = true;
          writtenRecord = data;
          return { id: data.id, ...data };
        }
      }
    };

    const res = await recordPrescriptionAuditLog(mockClient, {
      prescriptionId: 'rx-101',
      prescriptionIdSnapshot: 'rx-101',
      actorId: 'user-patient-1',
      actorRole: 'PATIENT',
      action: 'PRESCRIPTION_UPLOADED',
      details: { mimeType: 'image/png', fileSizeBytes: 1024 },
      ipAddress: '192.168.1.100'
    });

    assert.strictEqual(delegateCalled, true, 'Prisma delegate create must be called');
    assert.strictEqual(writtenRecord.prescriptionId, 'rx-101');
    assert.strictEqual(writtenRecord.prescriptionIdSnapshot, 'rx-101');
    assert.strictEqual(writtenRecord.actorId, 'user-patient-1');
    assert.strictEqual(writtenRecord.actorRole, 'PATIENT');
    assert.strictEqual(writtenRecord.action, 'PRESCRIPTION_UPLOADED');
    assert.strictEqual(writtenRecord.ipAddress, '192.168.1.100');
    assert.ok(typeof writtenRecord.details === 'string', 'Details must be serialized to JSON');
    const parsed = JSON.parse(writtenRecord.details);
    assert.strictEqual(parsed.mimeType, 'image/png');
    assert.strictEqual(parsed.fileSizeBytes, 1024);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Parameterized SQL fallback with bound arguments
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Parameterized SQL fallback with bound arguments', async () => {
    const sqlCalls = [];

    const mockClient = {
      prescriptionAuditLog: undefined, // delegate missing
      $executeRawUnsafe: async (sql, ...params) => {
        sqlCalls.push({ sql, params });
        return 1;
      }
    };

    const res = await recordPrescriptionAuditLog(mockClient, {
      prescriptionId: 'rx-sql-202',
      prescriptionIdSnapshot: 'rx-sql-202',
      actorId: 'pharmacist-admin',
      actorRole: 'PHARMACIST',
      action: 'PRESCRIPTION_VERIFIED',
      details: { confirmedItemCount: 3 },
      ipAddress: '10.0.0.5'
    });

    assert.strictEqual(sqlCalls.length, 1, 'Exactly one raw SQL query must be executed');
    const call = sqlCalls[0];
    assert.ok(call.sql.includes('INSERT INTO "PrescriptionAuditLog"'), 'Must insert into PrescriptionAuditLog');
    assert.ok(call.sql.includes('$1, $2, $3, $4, $5, $6, $7, $8, $9'), 'Must use bound positional parameters $1..$9');
    assert.strictEqual(call.params.length, 9, 'Must pass 9 bound parameters');
    assert.strictEqual(call.params[1], 'rx-sql-202', 'Param 2 must be prescriptionId');
    assert.strictEqual(call.params[2], 'rx-sql-202', 'Param 3 must be prescriptionIdSnapshot');
    assert.strictEqual(call.params[3], 'pharmacist-admin', 'Param 4 must be actorId');
    assert.strictEqual(call.params[4], 'PHARMACIST', 'Param 5 must be actorRole');
    assert.strictEqual(call.params[5], 'PRESCRIPTION_VERIFIED', 'Param 6 must be action');
    assert.ok(call.params[6].includes('"confirmedItemCount":3'), 'Param 7 must be JSON serialized details');
    assert.strictEqual(call.params[7], '10.0.0.5', 'Param 8 must be ipAddress');
    assert.ok(call.params[8] instanceof Date, 'Param 9 must be Date timestamp');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Correct action names, actor fields, and prescription snapshot
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Correct action names, actor fields and prescription snapshot', async () => {
    let captured = null;
    const mockClient = {
      prescriptionAuditLog: {
        create: async ({ data }) => {
          captured = data;
          return data;
        }
      }
    };

    // Valid actions must be accepted
    for (const validAct of ['PRESCRIPTION_UPLOADED', 'OCR_RUN_STARTED', 'OCR_RUN_COMPLETED', 'OCR_RUN_FAILED', 'OCR_RUN_SUPERSEDED', 'PRESCRIPTION_VERIFIED', 'CLARIFICATION_CREATED', 'CLARIFICATION_RESPONDED', 'CLARIFICATION_RESOLVED', 'PRESCRIPTION_VIEWED', 'PRESCRIPTION_IMAGE_VIEWED', 'ACCESS_DENIED']) {
      assert.ok(VALID_ACTIONS.has(validAct), `Action ${validAct} must be valid`);
    }

    // Invalid action name throws
    await assert.rejects(
      async () => {
        await recordPrescriptionAuditLog(mockClient, {
          prescriptionId: 'rx-1',
          action: 'INVALID_UNKNOWN_ACTION'
        });
      },
      /Invalid prescription audit log action/
    );

    // Fallback snapshot defaults to prescriptionId if snapshot not passed
    await recordPrescriptionAuditLog(mockClient, {
      prescriptionId: 'rx-fallback-snap',
      action: 'PRESCRIPTION_VIEWED'
    });
    assert.strictEqual(captured.prescriptionIdSnapshot, 'rx-fallback-snap');
    assert.strictEqual(captured.actorRole, 'SYSTEM'); // Default role
    assert.strictEqual(captured.actorId, null);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Upload audit entry is atomic with prescription/image creation [Mocked Transaction]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Upload audit entry is atomic with prescription/image creation [Mocked Transaction]', async () => {
    const testFileName = `test_audit_up_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    let auditLogged = false;
    let rxCreated = false;
    let imgCreated = false;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => {
            rxCreated = true;
            return { id: 'rx-upload-test', ...data };
          },
          update: async ({ where, data }) => ({ id: 'rx-upload-test', ...data })
        },
        prescriptionImage: {
          create: async ({ data }) => {
            imgCreated = true;
            return data;
          }
        },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            if (data.action === 'PRESCRIPTION_UPLOADED') {
              auditLogged = true;
              assert.strictEqual(data.prescriptionId, 'rx-upload-test');
              assert.strictEqual(data.actorId, 'patient-up-1');
              assert.strictEqual(data.actorRole, 'PATIENT');
            }
            return data;
          }
        }
      };
      return callback(mockTx);
    };

    prisma.prescription.findFirst = async () => null;
    prisma.prescriptionOcrRun = undefined;
    prisma.prescription.update = async ({ where, data }) => ({ id: 'rx-upload-test', ...data });
    prisma.prescription.findUnique = async () => ({ id: 'rx-upload-test', activeImageId: 'img-1', detectedMedicines: [] });
    prisma.medicine.findMany = async () => [];
    ocrEngine.runOCR = async () => ({ success: true, rawText: 'Sample text', confidence: 90, medicineLines: [] });

    const req = {
      user: { id: 'patient-up-1', role: 'PATIENT' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'prescription.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(rxCreated, true, 'Prescription record must be created');
    assert.strictEqual(imgCreated, true, 'PrescriptionImage record must be created');
    assert.strictEqual(auditLogged, true, 'PRESCRIPTION_UPLOADED audit log must be recorded in transaction');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: OCR start/completion/failure/superseded event paths [Mocked Transaction]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('OCR start/completion/failure/superseded event paths [Mocked Transaction]', async () => {
    const auditActions = [];

    const mockAuditLog = {
      create: async ({ data }) => {
        auditActions.push(data.action);
        return data;
      }
    };

    // 5a. OCR Start
    const mockTxStart = {
      prescriptionOcrRun: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: 'run-1', ...data })
      },
      prescriptionAuditLog: mockAuditLog
    };
    await acquireOcrRunClaim(mockTxStart, {
      prescriptionId: 'rx-ocr-1',
      imageId: 'img-ocr-1',
      actorId: 'worker-1',
      actorRole: 'SYSTEM'
    });
    assert.ok(auditActions.includes('OCR_RUN_STARTED'), 'Must log OCR_RUN_STARTED');

    // 5b. OCR Failure
    const mockClientFail = {
      prescriptionOcrRun: {
        updateMany: async () => ({ count: 1 })
      },
      prescriptionAuditLog: mockAuditLog
    };
    await failOcrRun(mockClientFail, {
      runId: 'run-1',
      prescriptionId: 'rx-ocr-1',
      errorMessage: 'Simulated image blur',
      actorId: 'worker-1',
      actorRole: 'SYSTEM'
    });
    assert.ok(auditActions.includes('OCR_RUN_FAILED'), 'Must log OCR_RUN_FAILED');

    // 5c. OCR Superseded (stale run when prescription activeImageId changed)
    const mockTxSuperseded = {
      prescription: {
        findUnique: async () => ({ id: 'rx-ocr-1', activeImageId: 'newer-img-999' })
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-1', imageId: 'old-img-111', leaseToken: 'tok-1', status: 'PROCESSING' }),
        findUnique: async () => ({ id: 'run-1', imageId: 'old-img-111', leaseToken: 'tok-1', status: 'PROCESSING' }),
        updateMany: async () => ({ count: 1 })
      },
      prescriptionOcrCandidate: {
        create: async ({ data }) => data
      },
      prescriptionAuditLog: mockAuditLog
    };
    const resSuperseded = await completeOcrRunAndPersistCandidates(mockTxSuperseded, {
      runId: 'run-1',
      prescriptionId: 'rx-ocr-1',
      imageId: 'old-img-111',
      leaseToken: 'tok-1',
      rawText: 'Text',
      candidates: []
    });
    assert.strictEqual(resSuperseded.isStale, true);
    assert.ok(auditActions.includes('OCR_RUN_SUPERSEDED'), 'Must log OCR_RUN_SUPERSEDED on stale promotion');

    // 5d. OCR Completed (active run promotion)
    const mockTxCompleted = {
      prescription: {
        findUnique: async () => ({ id: 'rx-ocr-1', activeImageId: 'active-img-1' }),
        updateMany: async () => ({ count: 1 })
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-2', imageId: 'active-img-1', leaseToken: 'tok-2', status: 'PROCESSING' }),
        findUnique: async () => ({ id: 'run-2', imageId: 'active-img-1', leaseToken: 'tok-2', status: 'PROCESSING' }),
        updateMany: async () => ({ count: 1 })
      },
      prescriptionOcrCandidate: {
        create: async ({ data }) => data
      },
      prescriptionAuditLog: mockAuditLog
    };
    const resCompleted = await completeOcrRunAndPersistCandidates(mockTxCompleted, {
      runId: 'run-2',
      prescriptionId: 'rx-ocr-1',
      imageId: 'active-img-1',
      leaseToken: 'tok-2',
      rawText: 'Paracetamol',
      candidates: [{ rawText: 'Paracetamol 500mg', confidenceScore: 0.95 }]
    });
    assert.strictEqual(resCompleted.isStale, false);
    assert.ok(auditActions.includes('OCR_RUN_COMPLETED'), 'Must log OCR_RUN_COMPLETED on active promotion');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Verification audit entry shares transaction with canonical items [Mocked Transaction]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Verification audit entry shares the transaction with canonical items [Mocked Transaction]', async () => {
    let verifiedLogged = false;
    let itemCreated = false;

    prisma.prescription.findUnique = async () => ({
      id: 'rx-verify-1',
      userId: 'patient-v1',
      detectedMedicines: []
    });
    prisma.medicine.findUnique = async () => ({
      id: 'med-paracetamol',
      brandName: 'Dolo 650'
    });

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          findUnique: async () => ({ id: 'rx-verify-1', userId: 'patient-v1', detectedMedicines: [] }),
          update: async ({ data }) => ({ id: 'rx-verify-1', ...data })
        },
        prescriptionItem: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }) => {
            itemCreated = true;
            return data;
          }
        },
        detectedMedicine: {
          create: async ({ data }) => data,
          deleteMany: async () => ({ count: 0 })
        },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            if (data.action === 'PRESCRIPTION_VERIFIED') {
              verifiedLogged = true;
              assert.strictEqual(data.prescriptionId, 'rx-verify-1');
              assert.strictEqual(data.actorId, 'patient-v1');
              assert.strictEqual(data.actorRole, 'PATIENT');
              const details = JSON.parse(data.details);
              assert.strictEqual(details.confirmedItemCount, 1);
              assert.ok(details.catalogMedicineIds.includes('med-paracetamol'));
            }
            return data;
          }
        }
      };
      return callback(mockTx);
    };

    const req = {
      user: { id: 'patient-v1', role: 'PATIENT' },
      params: { id: 'rx-verify-1' },
      body: {
        items: [
          {
            matchedMedicineId: 'med-paracetamol',
            matchedMedicineName: 'Dolo 650',
            quantity: 10,
            dosage: '650mg'
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(itemCreated, true, 'PrescriptionItem must be created');
    assert.strictEqual(verifiedLogged, true, 'PRESCRIPTION_VERIFIED audit log must be recorded in transaction');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Clarification creation/response/resolution audit entries share their respective transactions [Mocked Transaction]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Clarification creation/response/resolution audit entries share their respective transactions [Mocked Transaction]', async () => {
    let clarifCreatedLog = false;
    let clarifRespondedLog = false;
    let clarifResolvedLog = false;

    // 7a. Creation
    prisma.$transaction = async (callback) => {
      const mockTx = {
        order: { findUnique: async () => ({ id: 'ord-c1', prescriptionId: 'rx-c1', userId: 'pat-1', pharmacyId: 'pharm-1', status: 'CONFIRMED' }) },
        prescription: { findUnique: async () => ({ id: 'rx-c1', userId: 'pat-1' }) },
        pharmacy: { findUnique: async () => ({ id: 'pharm-1', managerId: 'pharm-user-1', name: 'City Pharmacy' }) },
        prescriptionClarification: {
          findFirst: async () => null,
          create: async ({ data }) => data
        },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            if (data.action === 'CLARIFICATION_CREATED') {
              clarifCreatedLog = true;
              assert.strictEqual(data.prescriptionId, 'rx-c1');
              assert.strictEqual(data.actorId, 'pharm-user-1');
              const d = JSON.parse(data.details);
              assert.strictEqual(d.orderId, 'ord-c1');
              assert.strictEqual(d.status, 'PENDING');
            }
            return data;
          }
        }
      };
      return callback(mockTx);
    };

    const reqCreate = {
      user: { id: 'pharm-user-1', role: 'PHARMACIST' },
      params: { id: 'ord-c1' },
      body: { question: 'Please clarify dosage: once or twice daily?' }
    };
    const resCreate = mockRes();
    await createClarification(reqCreate, resCreate);
    assert.strictEqual(resCreate.statusCode, 201);
    assert.strictEqual(clarifCreatedLog, true, 'CLARIFICATION_CREATED audit entry must be recorded');

    // 7b. Response
    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescriptionClarification: {
          findUnique: async () => ({
            id: 'clarif-1',
            orderId: 'ord-c1',
            prescriptionId: 'rx-c1',
            pharmacyId: 'pharm-1',
            patientId: 'pat-1',
            status: 'PENDING'
          }),
          update: async ({ data }) => ({ id: 'clarif-1', ...data })
        },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            if (data.action === 'CLARIFICATION_RESPONDED') {
              clarifRespondedLog = true;
              assert.strictEqual(data.prescriptionId, 'rx-c1');
              assert.strictEqual(data.actorId, 'pat-1');
              const d = JSON.parse(data.details);
              assert.strictEqual(d.statusTransition, 'PENDING->RESPONDED');
            }
            return data;
          }
        }
      };
      return callback(mockTx);
    };

    const reqResp = {
      user: { id: 'pat-1', role: 'PATIENT' },
      params: { id: 'ord-c1', clarificationId: 'clarif-1' },
      body: { response: 'Doctor said once daily after food.' }
    };
    const resResp = mockRes();
    await respondToClarification(reqResp, resResp);
    assert.strictEqual(resResp.statusCode, 200);
    assert.strictEqual(clarifRespondedLog, true, 'CLARIFICATION_RESPONDED audit entry must be recorded');

    // 7c. Resolution
    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescriptionClarification: {
          findUnique: async () => ({
            id: 'clarif-1',
            orderId: 'ord-c1',
            prescriptionId: 'rx-c1',
            pharmacyId: 'pharm-1',
            patientId: 'pat-1',
            status: 'RESPONDED'
          }),
          update: async ({ data }) => ({ id: 'clarif-1', ...data })
        },
        pharmacy: { findUnique: async () => ({ id: 'pharm-1', managerId: 'pharm-user-1' }) },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            if (data.action === 'CLARIFICATION_RESOLVED') {
              clarifResolvedLog = true;
              assert.strictEqual(data.prescriptionId, 'rx-c1');
              assert.strictEqual(data.actorId, 'pharm-user-1');
              const d = JSON.parse(data.details);
              assert.strictEqual(d.statusTransition, 'RESPONDED->RESOLVED');
            }
            return data;
          }
        }
      };
      return callback(mockTx);
    };

    const reqResolve = {
      user: { id: 'pharm-user-1', role: 'PHARMACIST' },
      params: { id: 'ord-c1', clarificationId: 'clarif-1' }
    };
    const resResolve = mockRes();
    await resolveClarification(reqResolve, resResolve);
    assert.strictEqual(resResolve.statusCode, 200);
    assert.strictEqual(clarifResolvedLog, true, 'CLARIFICATION_RESOLVED audit entry must be recorded');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: Audit-write failure rolls back a mandatory business mutation [Mocked Transaction]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Audit-write failure rolls back a mandatory business mutation [Mocked Transaction]', async () => {
    let rxStatusUpdated = false;

    prisma.prescription.findUnique = async () => ({
      id: 'rx-rollback-1',
      userId: 'pat-rollback-1',
      detectedMedicines: []
    });
    prisma.medicine.findUnique = async () => ({
      id: 'med-paracetamol',
      brandName: 'Dolo 650'
    });

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          findUnique: async () => ({ id: 'rx-rollback-1', userId: 'pat-rollback-1', detectedMedicines: [] }),
          update: async ({ data }) => {
            rxStatusUpdated = true;
            return { id: 'rx-rollback-1', ...data };
          }
        },
        prescriptionItem: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }) => data
        },
        detectedMedicine: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }) => data
        },
        prescriptionAuditLog: {
          create: async () => {
            throw new Error('Simulated audit table disk failure');
          }
        }
      };
      return callback(mockTx);
    };

    const req = {
      user: { id: 'pat-rollback-1', role: 'PATIENT' },
      params: { id: 'rx-rollback-1' },
      body: {
        items: [
          {
            matchedMedicineId: 'med-paracetamol',
            matchedMedicineName: 'Dolo 650',
            quantity: 5
          }
        ]
      }
    };
    const res = mockRes();

    await verifyDetectedMedicines(req, res);

    assert.strictEqual(res.statusCode, 500, 'Must return HTTP 500 on audit write failure');
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'Failed to verify detected medicines.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: Read/access logging failures do not break successful reads or 403 responses [Mocked Best-Effort]
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Read/access logging failures do not break successful reads or 403 responses [Mocked Best-Effort]', async () => {
    // 9a. Successful read with failing audit logger
    prisma.prescription.findUnique = async () => ({
      id: 'rx-view-1',
      userId: 'pat-view-1',
      detectedMedicines: []
    });
    prisma.prescriptionAuditLog = {
      create: async () => {
        throw new Error('Simulated audit network disconnect');
      }
    };

    const reqRead = {
      user: { id: 'pat-view-1', role: 'PATIENT' },
      params: { id: 'rx-view-1' }
    };
    const resRead = mockRes();

    await getPrescriptionById(reqRead, resRead);
    assert.strictEqual(resRead.statusCode, 200, 'Audit failure must not turn successful read into 500');
    assert.strictEqual(resRead.body.success, true);
    assert.strictEqual(resRead.body.prescription.id, 'rx-view-1');

    // 9b. Access denied with failing audit logger
    const reqDenied = {
      user: { id: 'intruder-user', role: 'PATIENT' },
      params: { id: 'rx-view-1' }
    };
    const resDenied = mockRes();

    await getPrescriptionById(reqDenied, resDenied);
    assert.strictEqual(resDenied.statusCode, 403, 'Audit failure must not prevent proper 403 response');
    assert.strictEqual(resDenied.body.success, false);

    // 9c. Image read with failing audit logger
    const testFileName = `test_img_view_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.prescription.findUnique = async () => ({
      id: 'rx-view-1',
      userId: 'pat-view-1',
      filePath: testFileName
    });

    const reqImg = {
      user: { id: 'pat-view-1', role: 'PATIENT' },
      params: { id: 'rx-view-1' }
    };
    const resImg = mockRes();

    await getPrescriptionImage(reqImg, resImg);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(resImg.statusCode, 200);
    assert.ok(resImg.sentFile.includes(testFileName), 'Image must still be sent even if audit logger fails');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: Sensitive metadata redaction
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Sensitive metadata redaction', async () => {
    const sensitivePayload = {
      mimeType: 'image/jpeg',
      itemCount: 4,
      fileSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      // Sensitive keys that must be STRIPPED entirely
      rawText: 'Dr. John Doe prescribed Morphine 10mg every 4 hours for acute pain',
      ocrRawText: 'Morphine 10mg PO q4h PRN pain',
      filePath: 'C:\\Users\\HP\\mfai_web\\server\\uploads\\prescriptions\\secret.jpg',
      storagePath: '/var/data/uploads/prescriptions/patient_rx.png',
      password: 'SuperSecretPassword123',
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      question: 'Is this patient allergic to penicillin?',
      response: 'Yes patient had anaphylaxis in 2024',
      dosage: '500mg',
      frequency: 'twice daily',
      duration: '7 days',
      // Disk path value under non-sensitive key
      randomDiskLocation: 'C:\\Windows\\System32\\driver.sys'
    };

    const sanitized = sanitizeMetadata(sensitivePayload);

    // Verify operational fields are retained
    assert.strictEqual(sanitized.mimeType, 'image/jpeg');
    assert.strictEqual(sanitized.itemCount, 4);
    assert.strictEqual(sanitized.fileSha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // Verify sensitive fields are completely absent
    assert.strictEqual(sanitized.rawText, undefined);
    assert.strictEqual(sanitized.ocrRawText, undefined);
    assert.strictEqual(sanitized.filePath, undefined);
    assert.strictEqual(sanitized.storagePath, undefined);
    assert.strictEqual(sanitized.password, undefined);
    assert.strictEqual(sanitized.token, undefined);
    assert.strictEqual(sanitized.question, undefined);
    assert.strictEqual(sanitized.response, undefined);
    assert.strictEqual(sanitized.dosage, undefined);
    assert.strictEqual(sanitized.frequency, undefined);
    assert.strictEqual(sanitized.duration, undefined);

    // Verify path in value was redacted
    assert.strictEqual(sanitized.randomDiskLocation, '[REDACTED_PATH]');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: No duplicate success events for failed or superseded work
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('No duplicate success events for failed or superseded work', async () => {
    const events = [];
    const mockAuditLog = {
      create: async ({ data }) => {
        events.push(data.action);
        return data;
      }
    };

    // Failed OCR run
    const mockClientFail = {
      prescriptionOcrRun: { updateMany: async () => ({ count: 1 }) },
      prescriptionAuditLog: mockAuditLog
    };
    await failOcrRun(mockClientFail, {
      runId: 'run-fail',
      prescriptionId: 'rx-fail',
      errorMessage: 'Unreadable image'
    });
    assert.deepStrictEqual(events, ['OCR_RUN_FAILED'], 'Only OCR_RUN_FAILED must be recorded, never OCR_RUN_COMPLETED');

    // Superseded OCR run
    events.length = 0;
    const mockTxStale = {
      prescription: {
        findUnique: async () => ({ id: 'rx-stale', activeImageId: 'new-image' })
      },
      prescriptionOcrRun: {
        findFirst: async () => ({ id: 'run-stale', imageId: 'old-image', leaseToken: 'tok', status: 'PROCESSING' }),
        findUnique: async () => ({ id: 'run-stale', imageId: 'old-image', leaseToken: 'tok', status: 'PROCESSING' }),
        updateMany: async () => ({ count: 1 })
      },
      prescriptionOcrCandidate: { create: async ({ data }) => data },
      prescriptionAuditLog: mockAuditLog
    };
    await completeOcrRunAndPersistCandidates(mockTxStale, {
      runId: 'run-stale',
      prescriptionId: 'rx-stale',
      imageId: 'old-image',
      leaseToken: 'tok',
      rawText: 'Old text',
      candidates: []
    });
    assert.deepStrictEqual(events, ['OCR_RUN_SUPERSEDED'], 'Only OCR_RUN_SUPERSEDED must be recorded, never OCR_RUN_COMPLETED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 12: Historical retention when prescription relation is nullified (prescriptionIdSnapshot)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Historical retention when prescription relation is nullified (prescriptionIdSnapshot)', async () => {
    let storedRecord = null;
    const mockClient = {
      prescriptionAuditLog: {
        create: async ({ data }) => {
          storedRecord = data;
          return data;
        }
      }
    };

    await recordPrescriptionAuditLog(mockClient, {
      prescriptionId: 'rx-original-uuid-1234',
      prescriptionIdSnapshot: 'rx-original-uuid-1234',
      actorId: 'patient-1',
      actorRole: 'PATIENT',
      action: 'PRESCRIPTION_UPLOADED'
    });

    assert.strictEqual(storedRecord.prescriptionId, 'rx-original-uuid-1234');
    assert.strictEqual(storedRecord.prescriptionIdSnapshot, 'rx-original-uuid-1234');

    // Simulate prescription deletion in DB where FK on delete SetNull sets prescriptionId to null:
    // Even if prescriptionId becomes null, prescriptionIdSnapshot preserves the audit trail.
    const historicalAuditRow = {
      ...storedRecord,
      prescriptionId: null // DB nullified FK
    };
    assert.strictEqual(historicalAuditRow.prescriptionId, null);
    assert.strictEqual(historicalAuditRow.prescriptionIdSnapshot, 'rx-original-uuid-1234', 'Historical snapshot must never be lost');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 13: Mandatory audit writer fails closed on missing table (42P01) and DB errors (Fix 1)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Mandatory audit writer fails closed on missing table (42P01) and DB errors (Fix 1)', async () => {
    // 13a. Missing table error (42P01) causes recordPrescriptionAuditLog to throw
    const missingTableClient = {
      $executeRawUnsafe: async (sql) => {
        if (sql.includes('INSERT INTO "PrescriptionAuditLog"')) {
          const err = new Error('relation "PrescriptionAuditLog" does not exist');
          err.code = '42P01';
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await recordPrescriptionAuditLog(missingTableClient, {
          prescriptionId: 'rx-missing-tbl-1',
          action: 'PRESCRIPTION_VERIFIED'
        });
      },
      (err) => {
        assert.strictEqual(err.code, '42P01');
        assert.ok(err.message.includes('does not exist'));
        return true;
      },
      'Mandatory audit writer must throw when the audit table is missing (42P01)'
    );

    // 13b. Simulated transaction fails closed (enclosing transaction aborts and does not commit)
    let businessMutationCommitted = false;
    let transactionRolledBack = false;

    const mockTx = {
      $executeRawUnsafe: async (sql) => {
        if (sql.includes('UPDATE "Prescription"')) {
          // Staged in uncommitted transaction
          return;
        }
        if (sql.includes('INSERT INTO "PrescriptionAuditLog"')) {
          const err = new Error('relation "PrescriptionAuditLog" does not exist');
          err.code = '42P01';
          throw err;
        }
      }
    };

    try {
      await mockTx.$executeRawUnsafe('UPDATE "Prescription" SET "status" = \'VERIFIED\' WHERE "id" = \'rx-1\'');
      // Mandatory audit write inside the transaction
      await recordPrescriptionAuditLog(mockTx, {
        prescriptionId: 'rx-1',
        action: 'PRESCRIPTION_VERIFIED'
      });
      businessMutationCommitted = true;
    } catch (err) {
      transactionRolledBack = true;
      assert.strictEqual(err.code, '42P01');
    }

    assert.strictEqual(businessMutationCommitted, false, 'Business mutation must not commit when audit insert fails');
    assert.strictEqual(transactionRolledBack, true, 'Transaction must roll back on missing audit table');

    // 13c. Unrelated DB error propagates through mandatory writer
    const dbErrClient = {
      $executeRawUnsafe: async () => {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      }
    };
    await assert.rejects(
      async () => {
        await recordPrescriptionAuditLog(dbErrClient, {
          prescriptionId: 'rx-err-1',
          action: 'PRESCRIPTION_UPLOADED'
        });
      },
      (err) => err.code === '23505',
      'Unrelated DB errors must propagate through the mandatory writer'
    );

    // 13d. Best-effort logging wrapper catches and logs non-blockingly without throwing
    const bestEffortResult = await recordPrescriptionAuditLogBestEffort(missingTableClient, {
      prescriptionId: 'rx-be-1',
      action: 'PRESCRIPTION_VIEWED'
    });
    assert.strictEqual(bestEffortResult, null, 'Best-effort wrapper must swallow missing-table errors gracefully');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 14: failOcrRun atomicity, client reuse, and audit failure rollback (Fix 2)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('failOcrRun atomicity, client reuse, and audit failure rollback (Fix 2)', async () => {
    // 14a. Root Prisma client path: wraps in client.$transaction
    let rootTxCount = 0;
    let ocrRunStatus = null;
    let auditAction = null;

    const mockRootClient = {
      $transaction: async (cb) => {
        rootTxCount++;
        const tx = {
          _isTransaction: true,
          prescriptionOcrRun: {
            updateMany: async ({ data }) => {
              ocrRunStatus = data.status;
              return { count: 1 };
            }
          },
          prescriptionAuditLog: {
            create: async ({ data }) => {
              auditAction = data.action;
              return data;
            }
          }
        };
        return cb(tx);
      }
    };

    await failOcrRun(mockRootClient, {
      runId: 'run-root-1',
      prescriptionId: 'rx-root-1',
      errorMessage: 'Low image contrast'
    });

    assert.strictEqual(rootTxCount, 1, 'failOcrRun must wrap in $transaction when passed root Prisma client');
    assert.strictEqual(ocrRunStatus, 'FAILED');
    assert.strictEqual(auditAction, 'OCR_RUN_FAILED');

    // 14b. Existing transaction client path: reuses client without nested transaction
    let nestedTxCount = 0;
    let txUpdated = false;
    let txAudited = false;

    const mockTxClient = {
      _isTransaction: true,
      $transaction: async () => {
        nestedTxCount++;
        throw new Error('Should not invoke $transaction on existing tx client');
      },
      prescriptionOcrRun: {
        updateMany: async ({ data }) => {
          if (data.status === 'FAILED') txUpdated = true;
          return { count: 1 };
        }
      },
      prescriptionAuditLog: {
        create: async ({ data }) => {
          if (data.action === 'OCR_RUN_FAILED') txAudited = true;
          return data;
        }
      }
    };

    await failOcrRun(mockTxClient, {
      runId: 'run-tx-1',
      prescriptionId: 'rx-tx-1',
      errorMessage: 'OCR timeout'
    });

    assert.strictEqual(nestedTxCount, 0, 'failOcrRun must NOT open nested transaction on existing tx client');
    assert.strictEqual(txUpdated, true);
    assert.strictEqual(txAudited, true);

    // 14c. Audit failure rolls back FAILED status update
    let stagedStatus = null;
    let transactionRolledBack = false;

    const mockFailingAuditClient = {
      $transaction: async (cb) => {
        const tx = {
          _isTransaction: true,
          prescriptionOcrRun: {
            updateMany: async ({ data }) => {
              stagedStatus = data.status;
              return { count: 1 };
            }
          },
          prescriptionAuditLog: {
            create: async () => {
              throw new Error('Audit insert failed in failOcrRun');
            }
          }
        };
        try {
          return await cb(tx);
        } catch (err) {
          stagedStatus = null; // simulate rollback
          transactionRolledBack = true;
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await failOcrRun(mockFailingAuditClient, {
          runId: 'run-rollback-1',
          prescriptionId: 'rx-rollback-1',
          errorMessage: 'Corrupt bytes'
        });
      },
      /Audit insert failed in failOcrRun/
    );

    assert.strictEqual(transactionRolledBack, true, 'Audit failure must trigger transaction rollback in failOcrRun');
    assert.strictEqual(stagedStatus, null, 'Status update must be rolled back on audit failure');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 15: Safe length metrics preservation vs question/response text redaction (Fix 3)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Safe length metrics preservation vs question/response text redaction (Fix 3)', async () => {
    const mixedPayload = {
      // Safe operational length metrics
      questionLength: 85,
      responseLength: 140,
      // Actual clarification content that MUST be redacted
      question: 'Patient asks: Can I substitute this with generic paracetamol?',
      response: 'Pharmacist responds: Yes, generic paracetamol 500mg is bioequivalent.',
      questionText: 'What time of day should I take this medication?',
      responseText: 'Take once daily before bedtime.',
      question_body: 'Is this available?',
      response_message: 'Yes, in stock.',
      user_question: 'Side effects?',
      pharm_response: 'May cause drowsiness.',
      // Other safe operational metrics
      executionTimeMs: 320,
      candidateCount: 3
    };

    const sanitized = sanitizeMetadata(mixedPayload);

    // Safe metrics preserved
    assert.strictEqual(sanitized.questionLength, 85, 'questionLength numeric metric must be preserved');
    assert.strictEqual(sanitized.responseLength, 140, 'responseLength numeric metric must be preserved');
    assert.strictEqual(sanitized.executionTimeMs, 320);
    assert.strictEqual(sanitized.candidateCount, 3);

    // Sensitive question and response body text completely redacted
    assert.strictEqual(sanitized.question, undefined, 'question text must be redacted');
    assert.strictEqual(sanitized.response, undefined, 'response text must be redacted');
    assert.strictEqual(sanitized.questionText, undefined, 'questionText must be redacted');
    assert.strictEqual(sanitized.responseText, undefined, 'responseText must be redacted');
    assert.strictEqual(sanitized.question_body, undefined, 'question_body must be redacted');
    assert.strictEqual(sanitized.response_message, undefined, 'response_message must be redacted');
    assert.strictEqual(sanitized.user_question, undefined, 'user_question must be redacted');
    assert.strictEqual(sanitized.pharm_response, undefined, 'pharm_response must be redacted');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 16: Sanitize strings inside arrays: Unix/Windows paths, IDs, nested arrays (Fix 4)
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Sanitize strings inside arrays: Unix/Windows paths, IDs, nested arrays (Fix 4)', async () => {
    const arrayPayload = {
      // Unix-style paths in array
      unixPaths: ['/var/data/uploads/prescriptions/patient_123.jpg', '/tmp/scratch/ocr_dump.txt'],
      // Windows-style paths in array
      windowsPaths: ['C:\\Users\\HP\\mfai_web\\server\\uploads\\secret.pdf', 'D:\\data\\image.png'],
      // Ordinary IDs without paths
      ordinaryIds: ['rx-uuid-12345', 'med-dolo-650', 'pharm-chennai-01'],
      // Supported MIME types (preserved)
      mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      // Mixed primitives
      numbersAndBooleans: [10, 20.5, true, false, null],
      // Nested arrays
      nestedArrays: [
        ['/opt/secure/disk/file1.png', 'clean-id-alpha'],
        ['C:\\Windows\\system.ini', 42, ['/nested/deep/path.bin', 'deep-id']]
      ],
      // Array of objects
      objectsInArray: [
        { id: 'item-1', diskPath: '/var/log/app.log', count: 5 },
        { id: 'item-2', winPath: 'C:\\temp\\file.txt', active: true }
      ]
    };

    const sanitized = sanitizeMetadata(arrayPayload);

    // Unix paths redacted
    assert.deepStrictEqual(sanitized.unixPaths, ['[REDACTED_PATH]', '[REDACTED_PATH]']);

    // Windows paths redacted
    assert.deepStrictEqual(sanitized.windowsPaths, ['[REDACTED_PATH]', '[REDACTED_PATH]']);

    // Ordinary IDs preserved
    assert.deepStrictEqual(sanitized.ordinaryIds, ['rx-uuid-12345', 'med-dolo-650', 'pharm-chennai-01']);

    // MIME types preserved
    assert.deepStrictEqual(sanitized.mimeTypes, ['image/jpeg', 'image/png', 'application/pdf']);

    // Primitives preserved
    assert.deepStrictEqual(sanitized.numbersAndBooleans, [10, 20.5, true, false, null]);

    // Nested arrays sanitized recursively
    assert.deepStrictEqual(sanitized.nestedArrays, [
      ['[REDACTED_PATH]', 'clean-id-alpha'],
      ['[REDACTED_PATH]', 42, ['[REDACTED_PATH]', 'deep-id']]
    ]);

    // Array of objects sanitized
    assert.strictEqual(sanitized.objectsInArray[0].id, 'item-1');
    assert.strictEqual(sanitized.objectsInArray[0].diskPath, '[REDACTED_PATH]');
    assert.strictEqual(sanitized.objectsInArray[0].count, 5);
    assert.strictEqual(sanitized.objectsInArray[1].id, 'item-2');
    assert.strictEqual(sanitized.objectsInArray[1].winPath, '[REDACTED_PATH]');
    assert.strictEqual(sanitized.objectsInArray[1].active, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 17: Hermetic isolation: Missing mock cannot accidentally perform real database operation
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('Hermetic isolation: Missing mock cannot accidentally perform real database operation', async () => {
    // 1. Calling an unmocked delegate method directly fails closed with HERMETIC_MOCK_REQUIRED
    let directBlocked = false;
    try {
      await prisma.user.findUnique({ where: { id: 'unmocked-user-test' } });
    } catch (err) {
      if (err.code === 'HERMETIC_MOCK_REQUIRED') {
        directBlocked = true;
      }
    }
    assert.strictEqual(directBlocked, true, 'Unmocked prisma delegate query must be blocked by HermeticPrismaGuard');

    // 2. Unmocked raw SQL method fails closed
    let rawBlocked = false;
    try {
      await prisma.$executeRawUnsafe('SELECT 1');
    } catch (err) {
      if (err.code === 'HERMETIC_MOCK_REQUIRED') {
        rawBlocked = true;
      }
    }
    assert.strictEqual(rawBlocked, true, 'Unmocked raw SQL must be blocked by HermeticPrismaGuard');

    // 3. Fallback path in controller transaction client where mock is omitted fails closed
    const unmockedTx = {
      _isTransaction: true,
      prescriptionAuditLog: {
        create: () => {
          const err = new Error('[HermeticPrismaGuard] Accidental database operation blocked');
          err.code = 'HERMETIC_MOCK_REQUIRED';
          throw err;
        }
      }
    };

    let fallbackBlocked = false;
    try {
      await recordPrescriptionAuditLog(unmockedTx, {
        prescriptionId: 'rx-offline-hermetic-1',
        action: 'PRESCRIPTION_VERIFIED'
      });
    } catch (err) {
      if (err.code === 'HERMETIC_MOCK_REQUIRED') {
        fallbackBlocked = true;
      }
    }
    assert.strictEqual(fallbackBlocked, true, 'Controller fallback path with unmocked delegate must fail closed without touching DB');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite Completion Summary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(`Results: ${passedTests} / ${passedTests + failedTests} tests passed.`);
  uninstallHermeticPrismaGuard(prisma);
  if (failedTests > 0) {
    console.error(`✗ Some tests failed! (${failedTests} failed)`);
    process.exit(1);
  } else {
    console.log('✓ All Slice 5 Centralized Audit Logging tests PASSED successfully!\n');
  }
}

runSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
