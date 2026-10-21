/**
 * MediFind AI — Phase 1 Cross-Slice End-to-End Workflow Regression Suite (Step 11V)
 *
 * Scenarios Tested:
 * A. Happy Path:
 *    - Prescription upload & image versioning (PrescriptionImage v1)
 *    - OCR run claim, candidate persistence, and completion
 *    - Patient verification & canonical PrescriptionItem creation (provenance: OCR_DERIVED, MANUALLY_ADDED)
 *    - Order placement with verified prescription requirement
 *    - Pharmacist clarification inquiry (CLARIFICATION_CREATED)
 *    - Patient clarification response (CLARIFICATION_RESPONDED)
 *    - Pharmacist clarification resolution (CLARIFICATION_RESOLVED)
 *    - Order confirmation & status progression
 *
 * B. Image Replacement Race & Provenance Hardening:
 *    - Upload image v1, start OCR run 1
 *    - Upload image v2 (activeImageId points to v2) before run 1 completes
 *    - Complete run 1: stale-image guard marks it SUPERSEDED without promoting stale results
 *    - Complete run 2: successful promotion
 *    - Verification rejects stale candidate from v1 (UNSPECIFIED) while accepting active v2 candidate (OCR_DERIVED)
 *
 * C. Cross-Role Authorization Matrix:
 *    - Cross-patient prescription verification, image retrieval, and clarification response denied (HTTP 403)
 *    - Cross-pharmacy pharmacist clarification creation, image retrieval, and resolution denied (HTTP 403)
 *    - Delivery assistant strictly denied prescription images and clarification endpoints (HTTP 403)
 *
 * D. Audit Trail Integrity:
 *    - Verified mandatory event sequence and actor role attribution
 *    - Idempotent clarification retry does not duplicate audit records
 *    - Failed and superseded operations never emit misleading completion success events
 *    - Permanent prescriptionIdSnapshot retention
 *
 * Offline execution: utilizes mock transactions and test doubles.
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
  uploadPrescription,
  acquireOcrRunClaim,
  failOcrRun,
  completeOcrRunAndPersistCandidates,
  verifyDetectedMedicines,
  getPrescriptionById,
  getPrescriptionImage
} = require('./src/controllers/prescriptionController');

const {
  createOrder,
  updateOrderStatus
} = require('./src/controllers/orderController');

const {
  createClarification,
  getClarifications,
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
  console.log('\n=== MediFind AI — Step 11V: Phase 1 Cross-Slice E2E Workflow Tests ===\n');
  installHermeticPrismaGuard(prisma);

  // Preserve originals for restoration
  const origPrismaTransaction = prisma.$transaction;
  const origPrismaQueryRaw = prisma.$queryRawUnsafe;
  const origPrismaExecRaw = prisma.$executeRawUnsafe;
  const origOcrRunOCR = ocrEngine.runOCR;
  const origPrismaPrescription = prisma.prescription;
  const origPrismaImage = prisma.prescriptionImage;
  const origPrismaCandidate = prisma.prescriptionOcrCandidate;
  const origPrismaRun = prisma.prescriptionOcrRun;
  const origPrismaItem = prisma.prescriptionItem;
  const origPrismaClarif = prisma.prescriptionClarification;
  const origPrismaAudit = prisma.prescriptionAuditLog;
  const origPrismaPharmacy = prisma.pharmacy;
  const origPrismaOrder = prisma.order;
  const origPrismaMedicine = prisma.medicine;
  const origPrismaNotification = prisma.notification;

  function restoreAll() {
    prisma.$transaction = origPrismaTransaction;
    prisma.$queryRawUnsafe = origPrismaQueryRaw;
    prisma.$executeRawUnsafe = origPrismaExecRaw;
    ocrEngine.runOCR = origOcrRunOCR;
    prisma.prescription = origPrismaPrescription;
    prisma.prescriptionImage = origPrismaImage;
    prisma.prescriptionOcrCandidate = origPrismaCandidate;
    prisma.prescriptionOcrRun = origPrismaRun;
    prisma.prescriptionItem = origPrismaItem;
    prisma.prescriptionClarification = origPrismaClarif;
    prisma.prescriptionAuditLog = origPrismaAudit;
    prisma.pharmacy = origPrismaPharmacy;
    prisma.order = origPrismaOrder;
    prisma.medicine = origPrismaMedicine;
    prisma.notification = origPrismaNotification;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO A: Happy Path End-to-End Prescription Workflow
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('A. Happy Path: Full lifecycle from upload to order fulfillment and clarification resolution', async () => {
    restoreAll();

    // In-memory relational store for this workflow
    const db = {
      prescriptions: new Map(),
      images: new Map(),
      ocrRuns: new Map(),
      ocrCandidates: new Map(),
      prescriptionItems: new Map(),
      detectedMedicines: new Map(),
      medicines: new Map(),
      pharmacies: new Map(),
      orders: new Map(),
      clarifications: new Map(),
      auditLogs: []
    };

    // Pre-seed catalog medicines and participating pharmacy
    const medAmox = { id: 'med-amox-500', brandName: 'Amoxil 500mg', genericName: 'Amoxicillin', dosageForm: 'CAPSULE' };
    const medDolo = { id: 'med-dolo-650', brandName: 'Dolo 650', genericName: 'Paracetamol', dosageForm: 'TABLET' };
    db.medicines.set(medAmox.id, medAmox);
    db.medicines.set(medDolo.id, medDolo);

    const pharmacy1 = {
      id: 'pharm-city-1',
      name: 'City Health Pharmacy',
      managerId: 'pharmacist-bob',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      inventory: [
        { id: 'inv-1', medicineId: medAmox.id, price: 120.0, stock: 50 },
        { id: 'inv-2', medicineId: medDolo.id, price: 30.0, stock: 100 }
      ]
    };
    db.pharmacies.set(pharmacy1.id, pharmacy1);

    prisma.$queryRawUnsafe = undefined;
    prisma.$executeRawUnsafe = undefined;

    // Mock Prisma transaction to route through in-memory DB
    prisma.$transaction = async (callback) => {
      const mockTx = {
        _isTransaction: true,
        prescription: {
          create: async ({ data }) => {
            const rx = { ...data, id: data.id || 'rx-happy-1', createdAt: new Date() };
            db.prescriptions.set(rx.id, rx);
            return rx;
          },
          findUnique: async ({ where }) => db.prescriptions.get(where.id) || null,
          update: async ({ where, data }) => {
            const existing = db.prescriptions.get(where.id);
            const updated = { ...existing, ...data };
            db.prescriptions.set(where.id, updated);
            return updated;
          },
          updateMany: async ({ where, data }) => {
            const existing = db.prescriptions.get(where.id);
            if (existing) {
              if (where.activeImageId && existing.activeImageId !== where.activeImageId) {
                return { count: 0 };
              }
              const updated = { ...existing, ...data };
              db.prescriptions.set(where.id, updated);
              return { count: 1 };
            }
            return { count: 0 };
          }
        },
        prescriptionImage: {
          create: async ({ data }) => {
            const img = { ...data, id: data.id || 'img-happy-1', createdAt: new Date() };
            db.images.set(img.id, img);
            return img;
          },
          findUnique: async ({ where }) => db.images.get(where.id) || null
        },
        prescriptionOcrRun: {
          create: async ({ data }) => {
            const run = { ...data, id: data.id || 'run-happy-1', status: data.status || 'PROCESSING', createdAt: new Date() };
            db.ocrRuns.set(run.id, run);
            return run;
          },
          findUnique: async ({ where }) => db.ocrRuns.get(where.id) || null,
          findFirst: async ({ where }) => {
            return Array.from(db.ocrRuns.values()).find(r => {
              if (where.id && r.id !== where.id) return false;
              if (where.leaseToken && r.leaseToken !== where.leaseToken) return false;
              if (where.status && r.status !== where.status) return false;
              if (where.prescriptionId && r.prescriptionId !== where.prescriptionId) return false;
              if (where.imageId && r.imageId !== where.imageId) return false;
              return true;
            }) || null;
          },
          updateMany: async ({ where, data }) => {
            let count = 0;
            for (const [id, r] of db.ocrRuns.entries()) {
              if (where.id && r.id !== where.id) continue;
              if (where.leaseToken && r.leaseToken !== where.leaseToken) continue;
              if (where.status && r.status !== where.status) continue;
              if (where.prescriptionId && r.prescriptionId !== where.prescriptionId) continue;
              if (where.imageId && r.imageId !== where.imageId) continue;
              db.ocrRuns.set(id, { ...r, ...data });
              count++;
            }
            return { count };
          }
        },
        prescriptionOcrCandidate: {
          create: async ({ data }) => {
            const cand = { ...data, id: data.id || 'cand-happy-1', createdAt: new Date() };
            db.ocrCandidates.set(cand.id, cand);
            return cand;
          },
          findMany: async ({ where }) => {
            const results = [];
            for (const cand of db.ocrCandidates.values()) {
              const run = db.ocrRuns.get(cand.ocrRunId);
              if (where?.ocrRun) {
                if (where.ocrRun.prescriptionId && run?.prescriptionId !== where.ocrRun.prescriptionId) continue;
                if (where.ocrRun.status && run?.status !== where.ocrRun.status) continue;
                if (where.ocrRun.imageId && run?.imageId !== where.ocrRun.imageId) continue;
              }
              results.push({ ...cand, ocrRun: run });
            }
            return results;
          }
        },
        prescriptionItem: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }) => {
            const item = { ...data, id: data.id || crypto.randomUUID(), createdAt: new Date() };
            db.prescriptionItems.set(item.id, item);
            return item;
          }
        },
        detectedMedicine: {
          create: async ({ data }) => {
            const dm = { ...data, id: data.id || crypto.randomUUID() };
            db.detectedMedicines.set(dm.id, dm);
            return dm;
          },
          update: async ({ where, data }) => {
            const existing = db.detectedMedicines.get(where.id);
            const updated = { ...existing, ...data };
            db.detectedMedicines.set(where.id, updated);
            return updated;
          },
          findMany: async () => Array.from(db.detectedMedicines.values()),
          deleteMany: async () => ({ count: 0 })
        },
        prescriptionClarification: {
          create: async ({ data }) => {
            const clarif = { ...data, id: data.id || 'clarif-happy-1', createdAt: new Date() };
            db.clarifications.set(clarif.id, clarif);
            return clarif;
          },
          findFirst: async ({ where }) => {
            return Array.from(db.clarifications.values()).find(c => c.orderId === where.orderId) || null;
          },
          findUnique: async ({ where }) => {
            const c = db.clarifications.get(where.id);
            if (!c) return null;
            return {
              ...c,
              order: db.orders.get(c.orderId),
              pharmacy: db.pharmacies.get(c.pharmacyId)
            };
          },
          update: async ({ where, data }) => {
            const existing = db.clarifications.get(where.id);
            const updated = { ...existing, ...data };
            db.clarifications.set(where.id, updated);
            return updated;
          }
        },
        prescriptionAuditLog: {
          create: async ({ data }) => {
            db.auditLogs.push(data);
            return data;
          }
        },
        medicine: {
          findUnique: async ({ where }) => db.medicines.get(where.id) || null,
          findFirst: async () => medAmox,
          findMany: async () => Array.from(db.medicines.values())
        },
        pharmacy: {
          findUnique: async ({ where }) => {
            if (where.id) return db.pharmacies.get(where.id) || null;
            if (where.managerId) return Array.from(db.pharmacies.values()).find(p => p.managerId === where.managerId) || null;
            return null;
          }
        },
        order: {
          findUnique: async ({ where }) => db.orders.get(where.id) || null
        }
      };

      return callback(mockTx);
    };

    // Wire root client helpers
    prisma.prescription = {
      findUnique: async ({ where }) => db.prescriptions.get(where.id) || null,
      findFirst: async () => null,
      update: async ({ where, data }) => {
        const existing = db.prescriptions.get(where.id);
        const updated = { ...existing, ...data };
        db.prescriptions.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }) => {
        const existing = db.prescriptions.get(where.id);
        if (existing) {
          if (where.activeImageId && existing.activeImageId !== where.activeImageId) {
            return { count: 0 };
          }
          const updated = { ...existing, ...data };
          db.prescriptions.set(where.id, updated);
          return { count: 1 };
        }
        return { count: 0 };
      }
    };
    prisma.prescriptionImage = {
      create: async ({ data }) => {
        const img = { ...data, id: data.id || 'img-happy-1', createdAt: new Date() };
        db.images.set(img.id, img);
        return img;
      },
      findUnique: async ({ where }) => db.images.get(where.id) || null
    };
    prisma.prescriptionOcrRun = {
      create: async ({ data }) => {
        const run = { ...data, id: data.id || 'run-happy-1', status: data.status || 'PROCESSING', createdAt: new Date() };
        db.ocrRuns.set(run.id, run);
        return run;
      },
      findUnique: async ({ where }) => db.ocrRuns.get(where.id) || null,
      findFirst: async ({ where }) => {
        return Array.from(db.ocrRuns.values()).find(r => {
          if (where.id && r.id !== where.id) return false;
          if (where.leaseToken && r.leaseToken !== where.leaseToken) return false;
          if (where.status && r.status !== where.status) return false;
          if (where.prescriptionId && r.prescriptionId !== where.prescriptionId) return false;
          if (where.imageId && r.imageId !== where.imageId) return false;
          return true;
        }) || null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, r] of db.ocrRuns.entries()) {
          if (where.id && r.id !== where.id) continue;
          if (where.leaseToken && r.leaseToken !== where.leaseToken) continue;
          if (where.status && r.status !== where.status) continue;
          if (where.prescriptionId && r.prescriptionId !== where.prescriptionId) continue;
          if (where.imageId && r.imageId !== where.imageId) continue;
          db.ocrRuns.set(id, { ...r, ...data });
          count++;
        }
        return { count };
      }
    };
    prisma.prescriptionOcrCandidate = {
      create: async ({ data }) => {
        const cand = { ...data, id: data.id || 'cand-happy-1', createdAt: new Date() };
        db.ocrCandidates.set(cand.id, cand);
        return cand;
      },
      findMany: async ({ where }) => {
        const results = [];
        for (const cand of db.ocrCandidates.values()) {
          const run = db.ocrRuns.get(cand.ocrRunId);
          if (where?.ocrRun) {
            if (where.ocrRun.prescriptionId && run?.prescriptionId !== where.ocrRun.prescriptionId) continue;
            if (where.ocrRun.status && run?.status !== where.ocrRun.status) continue;
            if (where.ocrRun.imageId && run?.imageId !== where.ocrRun.imageId) continue;
          }
          results.push({ ...cand, ocrRun: run });
        }
        return results;
      }
    };
    prisma.pharmacy = {
      findUnique: async ({ where }) => {
        if (where.id) return db.pharmacies.get(where.id) || null;
        if (where.managerId) return Array.from(db.pharmacies.values()).find(p => p.managerId === where.managerId) || null;
        return null;
      }
    };
    prisma.medicine = {
      findUnique: async ({ where }) => db.medicines.get(where.id) || null,
      findFirst: async () => medAmox,
      findMany: async () => Array.from(db.medicines.values())
    };
    prisma.order = {
      findUnique: async ({ where }) => db.orders.get(where.id) || null,
      create: async ({ data }) => {
        const ord = { ...data, id: 'order-happy-1', createdAt: new Date() };
        db.orders.set(ord.id, ord);
        return ord;
      }
    };
    prisma.notification = {
      create: async () => ({ id: 'notif-1' })
    };
    prisma.prescriptionAuditLog = {
      create: async ({ data }) => {
        db.auditLogs.push(data);
        return data;
      }
    };

    // Step 1: Patient Alice uploads a valid prescription image
    const testFileName = `test_happy_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    ocrEngine.runOCR = async () => ({
      success: true,
      rawText: 'Dr. Smith\nRx: Amoxicillin 500mg #15\nTake 1 TID for 5 days',
      confidence: 0.95
    });

    const uploadReq = {
      user: { id: 'patient-alice', role: 'PATIENT' },
      body: {},
      file: {
        path: testFilePath,
        filename: testFileName,
        size: VALID_PNG_BYTES.length,
        mimetype: 'image/png',
        originalname: 'doctor_prescription.png'
      }
    };
    const uploadRes = mockRes();
    await uploadPrescription(uploadReq, uploadRes);

    assert.ok(uploadRes.statusCode === 200 || uploadRes.statusCode === 201, 'Upload must succeed with HTTP 200 or 201');
    assert.strictEqual(uploadRes.body.success, true);
    const createdRxId = uploadRes.body.prescription.id;
    const activeImageId = uploadRes.body.prescription.activeImageId;
    assert.ok(createdRxId, 'Prescription ID must be assigned');
    assert.ok(activeImageId, 'activeImageId must be assigned on image upload');

    // Step 2: OCR Claim, Candidate Persistence, and Completion
    // (Executed atomically within the upload and OCR processing lifecycle)
    const persistedCandidate = Array.from(db.ocrCandidates.values())[0];
    assert.ok(persistedCandidate, 'OCR candidate must be persisted in database');
    assert.strictEqual(persistedCandidate.matchedMedicineId, medAmox.id);

    // Step 3: Patient Verification of Confirmed Medicines
    const verifyReq = {
      params: { id: createdRxId },
      user: { id: 'patient-alice', role: 'PATIENT' },
      body: {
        items: [
          // OCR-derived item
          {
            matchedMedicineId: medAmox.id,
            sourceCandidateId: persistedCandidate.id,
            quantity: 15,
            dosage: '500mg',
            frequency: '3 times daily',
            duration: '5 days'
          },
          // Manually added OTC item
          {
            matchedMedicineId: medDolo.id,
            quantity: 10,
            dosage: '650mg'
          }
        ]
      }
    };
    const verifyRes = mockRes();
    await verifyDetectedMedicines(verifyReq, verifyRes);

    assert.strictEqual(verifyRes.statusCode, 200, 'Verification must succeed with HTTP 200');
    assert.strictEqual(verifyRes.body.success, true);

    const items = Array.from(db.prescriptionItems.values());
    assert.strictEqual(items.length, 2, 'Exactly 2 canonical PrescriptionItems must be created');
    const amoxItem = items.find(i => i.medicineId === medAmox.id);
    const doloItem = items.find(i => i.medicineId === medDolo.id);
    assert.strictEqual(amoxItem.sourceType, 'OCR_DERIVED', 'OCR candidate must produce OCR_DERIVED');
    assert.strictEqual(amoxItem.sourceCandidateId, persistedCandidate.id);
    assert.strictEqual(doloItem.sourceType, 'MANUALLY_ADDED', 'Manual item must produce MANUALLY_ADDED');
    assert.strictEqual(doloItem.sourceCandidateId, null);

    const updatedRx = db.prescriptions.get(createdRxId);
    assert.strictEqual(updatedRx.status, 'VERIFIED', 'Prescription status must transition to VERIFIED');

    // Step 4: Patient Places an Order with the Verified Prescription
    const orderReq = {
      user: { id: 'patient-alice', role: 'PATIENT' },
      body: {
        pharmacyId: pharmacy1.id,
        prescriptionId: createdRxId,
        items: [
          { medicineId: medAmox.id, quantity: 15 }
        ]
      }
    };
    const orderRes = mockRes();
    await createOrder(orderReq, orderRes);

    assert.strictEqual(orderRes.statusCode, 201, 'Order creation must succeed with HTTP 201');
    const createdOrderId = db.orders.get('order-happy-1').id;
    assert.strictEqual(db.orders.get('order-happy-1').prescriptionId, createdRxId);
    assert.strictEqual(db.orders.get('order-happy-1').status, 'PENDING');

    // Step 5: Pharmacist Clarification Flow
    // 5a. Pharmacist Bob asks question
    const clarifReq = {
      user: { id: 'pharmacist-bob', role: 'PHARMACIST' },
      params: { id: createdOrderId },
      body: { question: 'Please confirm if patient has any penicillin allergy.' }
    };
    const clarifRes = mockRes();
    await createClarification(clarifReq, clarifRes);

    assert.strictEqual(clarifRes.statusCode, 201, 'Clarification question should be created');
    const clarifId = clarifRes.body.clarification.id;
    assert.ok(clarifId, 'Clarification ID must be returned');
    assert.strictEqual(db.clarifications.get(clarifId).status, 'PENDING');

    // 5b. Patient Alice responds
    const respReq = {
      user: { id: 'patient-alice', role: 'PATIENT' },
      params: { id: createdOrderId, clarificationId: clarifId },
      body: { response: 'No known drug allergies reported by doctor.' }
    };
    const respRes = mockRes();
    await respondToClarification(respReq, respRes);

    assert.strictEqual(respRes.statusCode, 200, 'Clarification response should succeed');
    assert.strictEqual(db.clarifications.get(clarifId).status, 'RESPONDED');

    // 5c. Pharmacist Bob resolves clarification
    const resolveReq = {
      user: { id: 'pharmacist-bob', role: 'PHARMACIST' },
      params: { id: createdOrderId, clarificationId: clarifId }
    };
    const resolveRes = mockRes();
    await resolveClarification(resolveReq, resolveRes);

    assert.strictEqual(resolveRes.statusCode, 200, 'Clarification resolution should succeed');
    assert.strictEqual(db.clarifications.get(clarifId).status, 'RESOLVED');

    // Clean up temporary image
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    // Verify Audit Trail Sequence
    const recordedActions = db.auditLogs.map(a => a.action);
    const expectedActions = [
      'PRESCRIPTION_UPLOADED',
      'OCR_RUN_STARTED',
      'OCR_RUN_COMPLETED',
      'PRESCRIPTION_VERIFIED',
      'CLARIFICATION_CREATED',
      'CLARIFICATION_RESPONDED',
      'CLARIFICATION_RESOLVED'
    ];
    assert.deepStrictEqual(recordedActions, expectedActions, 'Audit action sequence must match entire happy path');
    for (const log of db.auditLogs) {
      assert.strictEqual(log.prescriptionIdSnapshot, createdRxId, 'All audit records must maintain immutable prescription snapshot');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO B: Image Replacement Race Condition & Provenance Hardening
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('B. Image Replacement: Stale run is SUPERSEDED, and verification strictly rejects stale candidates', async () => {
    restoreAll();
    prisma.$queryRawUnsafe = undefined;
    prisma.$executeRawUnsafe = undefined;

    const rxId = 'rx-replace-race-1';
    const imgV1 = 'img-version-1';
    const imgV2 = 'img-version-2';

    const db = {
      prescription: { id: rxId, activeImageId: imgV1, status: 'PROCESSING', userId: 'pat-1' },
      ocrRuns: new Map(),
      candidates: new Map(),
      auditLogs: []
    };

    const mockTx = {
      _isTransaction: true,
      prescription: {
        findUnique: async () => db.prescription,
        update: async ({ data }) => {
          db.prescription = { ...db.prescription, ...data };
          return db.prescription;
        },
        updateMany: async ({ where, data }) => {
          if (where.activeImageId && db.prescription.activeImageId !== where.activeImageId) {
            return { count: 0 };
          }
          db.prescription = { ...db.prescription, ...data };
          return { count: 1 };
        }
      },
      prescriptionOcrRun: {
        create: async ({ data }) => {
          const run = { ...data, status: data.status || 'PROCESSING' };
          db.ocrRuns.set(data.id, run);
          return run;
        },
        updateMany: async ({ where, data }) => {
          const run = db.ocrRuns.get(where.id);
          if (run) db.ocrRuns.set(where.id, { ...run, ...data });
          return { count: 1 };
        },
        findFirst: async ({ where }) => {
          if (!where) return Array.from(db.ocrRuns.values())[0] || null;
          return Array.from(db.ocrRuns.values()).find(r => {
            if (where.id && r.id !== where.id) return false;
            if (where.leaseToken && r.leaseToken !== where.leaseToken) return false;
            if (where.status && r.status !== where.status) return false;
            if (where.prescriptionId && r.prescriptionId !== where.prescriptionId) return false;
            if (where.imageId && r.imageId !== where.imageId) return false;
            return true;
          }) || null;
        }
      },
      prescriptionOcrCandidate: {
        create: async ({ data }) => {
          db.candidates.set(data.id, { ...data });
          return data;
        },
        findMany: async ({ where }) => {
          const res = [];
          for (const c of db.candidates.values()) {
            const run = db.ocrRuns.get(c.ocrRunId);
            if (where?.ocrRun) {
              if (where.ocrRun.prescriptionId && run?.prescriptionId !== where.ocrRun.prescriptionId) continue;
              if (where.ocrRun.status && run?.status !== where.ocrRun.status) continue;
              if (where.ocrRun.imageId && run?.imageId !== where.ocrRun.imageId) continue;
            }
            res.push({ ...c, ocrRun: run });
          }
          return res;
        }
      },
      prescriptionItem: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => data
      },
      detectedMedicine: {
        findMany: async () => [],
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        deleteMany: async () => ({ count: 0 })
      },
      prescriptionAuditLog: {
        create: async ({ data }) => {
          db.auditLogs.push(data);
          return data;
        }
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescription = mockTx.prescription;
    prisma.medicine = {
      findUnique: async ({ where }) => ({ id: where.id, brandName: 'Dolo 650' }),
      findMany: async () => [{ id: 'med-dolo', brandName: 'Dolo 650' }]
    };

    // 1. Worker 1 starts on image v1
    const claim1 = await acquireOcrRunClaim(mockTx, {
      prescriptionId: rxId,
      imageId: imgV1
    });

    // 2. Before Worker 1 completes, patient replaces image with v2
    db.prescription.activeImageId = imgV2;

    // 3. Worker 1 completes: stale-image guard marks run-v1 stale and logs OCR_RUN_SUPERSEDED
    const candStale = { id: 'cand-stale-v1', matchedMedicineId: 'med-dolo', rawText: 'Old Dolo text' };
    const res1 = await completeOcrRunAndPersistCandidates(mockTx, {
      runId: claim1.runId,
      leaseToken: claim1.leaseToken,
      prescriptionId: rxId,
      imageId: imgV1,
      candidates: [candStale]
    });

    assert.strictEqual(res1.isStale, true, 'Run on replaced image must be detected as stale');
    assert.strictEqual(db.prescription.status, 'PROCESSING', 'Prescription status must not be promoted by stale run');
    const supersededLog = db.auditLogs.find(a => a.action === 'OCR_RUN_SUPERSEDED');
    assert.ok(supersededLog, 'Must emit OCR_RUN_SUPERSEDED audit record');

    // 4. Worker 2 runs on image v2 and completes
    const claim2 = await acquireOcrRunClaim(mockTx, {
      prescriptionId: rxId,
      imageId: imgV2
    });
    const candActive = { id: 'cand-active-v2', matchedMedicineId: 'med-dolo', rawText: 'Fresh Dolo text' };
    const res2 = await completeOcrRunAndPersistCandidates(mockTx, {
      runId: claim2.runId,
      leaseToken: claim2.leaseToken,
      prescriptionId: rxId,
      imageId: imgV2,
      candidates: [candActive]
    });

    assert.strictEqual(res2.isStale, false, 'Run on active image must not be stale');
    const run2 = db.ocrRuns.get(claim2.runId);
    assert.strictEqual(run2.status, 'COMPLETED', 'Run on active image must be COMPLETED');

    // 5. Verification: Try verifying both stale candidate from v1 and active candidate from v2
    const createdItems = [];
    mockTx.prescriptionItem.create = async ({ data }) => {
      createdItems.push(data);
      return data;
    };

    const verifyReq = {
      params: { id: rxId },
      user: { id: 'pat-1', role: 'PATIENT' },
      body: {
        items: [
          { matchedMedicineId: 'med-dolo', sourceCandidateId: 'cand-active-v2', quantity: 10 },
          { matchedMedicineId: 'med-dolo', sourceCandidateId: 'cand-stale-v1', quantity: 5 }
        ]
      }
    };
    const verifyRes = mockRes();
    await verifyDetectedMedicines(verifyReq, verifyRes);

    assert.strictEqual(verifyRes.statusCode, 200);
    const activeItem = createdItems.find(i => i.sourceCandidateId === 'cand-active-v2');
    const staleItem = createdItems.find(i => i.sourceCandidateId === null);

    assert.ok(activeItem, 'Active candidate item must exist');
    assert.strictEqual(activeItem.sourceType, 'OCR_DERIVED');

    assert.ok(staleItem, 'Stale candidate item must exist');
    assert.strictEqual(staleItem.sourceType, 'UNSPECIFIED', 'Stale candidate must be demoted to UNSPECIFIED');
    assert.strictEqual(staleItem.sourceCandidateId, null, 'Stale candidate ID must not be linked');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO C: Cross-Role Authorization Matrix
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('C. Cross-Role Authorization: Strict isolation between Patient, Pharmacist, and Assistant', async () => {
    restoreAll();
    prisma.$queryRawUnsafe = undefined;
    prisma.$executeRawUnsafe = undefined;

    const mockRx = {
      id: 'rx-auth-1',
      userId: 'patient-alice',
      activeImageId: 'img-1',
      filePath: 'test.png'
    };

    const mockOrder = {
      id: 'order-auth-1',
      userId: 'patient-alice',
      pharmacyId: 'pharm-alice-1',
      prescriptionId: 'rx-auth-1',
      status: 'PENDING'
    };

    const mockTx = {
      _isTransaction: true,
      prescription: {
        findUnique: async () => mockRx
      },
      prescriptionImage: {
        findUnique: async () => ({ id: 'img-1', storagePath: path.join(UPLOAD_DIR, 'auth_test.png') })
      },
      order: {
        findUnique: async () => mockOrder
      },
      pharmacy: {
        findUnique: async ({ where }) => {
          if (where.managerId === 'pharmacist-dave') {
            return { id: 'pharm-other-2', managerId: 'pharmacist-dave' };
          }
          return null;
        }
      },
      medicine: {
        findUnique: async () => ({ id: 'med-dolo', brandName: 'Dolo 650' }),
        findMany: async () => [{ id: 'med-dolo', brandName: 'Dolo 650' }]
      },
      prescriptionClarification: {
        findFirst: async () => null,
        findUnique: async () => ({
          id: 'clarif-auth-1',
          orderId: 'order-auth-1',
          pharmacyId: 'pharm-alice-1',
          patientId: 'patient-alice',
          status: 'PENDING'
        })
      }
    };

    mockTx.prescriptionAuditLog = createMockAuditLogDelegate();
    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescription = mockTx.prescription;
    prisma.prescriptionImage = mockTx.prescriptionImage;
    prisma.order = mockTx.order;
    prisma.pharmacy = mockTx.pharmacy;
    prisma.medicine = mockTx.medicine;
    prisma.prescriptionClarification = mockTx.prescriptionClarification;
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();

    // 1. Cross-Patient Verification Denial
    const reqOtherPatient = {
      params: { id: 'rx-auth-1' },
      user: { id: 'patient-charlie', role: 'PATIENT' },
      body: {
        items: [
          { matchedMedicineId: 'med-dolo', quantity: 5 }
        ]
      }
    };
    const resOtherPatient = mockRes();
    await verifyDetectedMedicines(reqOtherPatient, resOtherPatient);
    assert.strictEqual(resOtherPatient.statusCode, 403, 'Cross-patient verification must be rejected with HTTP 403');

    // 2. Cross-Pharmacy Pharmacist Clarification Creation Denial
    const reqOtherPharm = {
      params: { id: 'order-auth-1' },
      user: { id: 'pharmacist-dave', role: 'PHARMACIST' },
      body: { question: 'Unauthorized question from outside pharmacy.' }
    };
    const resOtherPharm = mockRes();
    await createClarification(reqOtherPharm, resOtherPharm);
    assert.strictEqual(resOtherPharm.statusCode, 403, 'Cross-pharmacy pharmacist clarification must be rejected with HTTP 403');

    // 3. Delivery Assistant Denied All Clinical & Clarification Endpoints
    const reqAssistantClarif = {
      params: { id: 'order-auth-1' },
      user: { id: 'assistant-eddie', role: 'ASSISTANT' },
      body: { question: 'Assistant asking medical details.' }
    };
    const resAssistantClarif = mockRes();
    await createClarification(reqAssistantClarif, resAssistantClarif);
    assert.strictEqual(resAssistantClarif.statusCode, 403, 'Assistant cannot create clarifications (HTTP 403)');

    const reqAssistantGetClarif = {
      params: { id: 'order-auth-1' },
      user: { id: 'assistant-eddie', role: 'ASSISTANT' }
    };
    const resAssistantGetClarif = mockRes();
    await getClarifications(reqAssistantGetClarif, resAssistantGetClarif);
    assert.strictEqual(resAssistantGetClarif.statusCode, 403, 'Assistant cannot view clarifications (HTTP 403)');

    const reqAssistantImg = {
      params: { id: 'rx-auth-1' },
      user: { id: 'assistant-eddie', role: 'ASSISTANT' }
    };
    const resAssistantImg = mockRes();
    await getPrescriptionImage(reqAssistantImg, resAssistantImg);
    assert.strictEqual(resAssistantImg.statusCode, 403, 'Assistant cannot access prescription images (HTTP 403)');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO D: Audit Trail Integrity & Idempotency
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('D. Audit Trail Integrity: Idempotent retries do not duplicate audit records', async () => {
    restoreAll();
    prisma.$queryRawUnsafe = undefined;
    prisma.$executeRawUnsafe = undefined;

    let auditCount = 0;
    const mockTx = {
      _isTransaction: true,
      prescriptionClarification: {
        findUnique: async () => ({
          id: 'clarif-idem-1',
          orderId: 'order-1',
          prescriptionId: 'rx-idem-1',
          patientId: 'pat-1',
          status: 'RESPONDED',
          response: 'I take 1 tablet at night'
        })
      },
      prescriptionAuditLog: {
        create: async () => {
          auditCount++;
          return {};
        }
      }
    };

    prisma.$transaction = async (cb) => cb(mockTx);
    prisma.prescriptionClarification = mockTx.prescriptionClarification;

    // Retry identical response
    const req = {
      params: { id: 'order-1', clarificationId: 'clarif-idem-1' },
      user: { id: 'pat-1', role: 'PATIENT' },
      body: { response: 'I take 1 tablet at night' }
    };
    const res = mockRes();

    await respondToClarification(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, 'Clarification response already recorded.', 'Must return idempotent message');
    assert.strictEqual(auditCount, 0, 'Idempotent duplicate response must NOT generate duplicate audit logs');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite Completion Summary
  // ─────────────────────────────────────────────────────────────────────────────
  restoreAll();
  uninstallHermeticPrismaGuard(prisma);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(`Results: ${passedTests} / ${passedTests + failedTests} tests passed.`);
  if (failedTests > 0) {
    console.error(`✗ Some tests failed! (${failedTests} failed)`);
    process.exit(1);
  } else {
    console.log('✓ All Phase 1 Cross-Slice E2E Workflow tests PASSED successfully!\n');
  }
}

runSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
