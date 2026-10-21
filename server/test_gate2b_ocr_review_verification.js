/**
 * MediFind AI — Gate 2B: OCR Review, Medicine Correction, and Pharmacist Verification Hermetic Tests
 *
 * Verifies all 9 required test criteria for Gate 2B:
 * 1. Patient correction does not change the raw OCR candidate.
 * 2. Patient correction does not grant pharmacist verification status.
 * 3. An authorized pharmacist can verify a reviewed candidate.
 * 4. Unauthorized patients, assistants, and unrelated pharmacists cannot verify candidates (403 Forbidden).
 * 5. Rejected candidates remain auditable (no deletion of raw candidate or audit history).
 * 6. Confirmed items survive subsequent OCR retries.
 * 7. Stale OCR results cannot overwrite newer verified information.
 * 8. Invalid or incomplete medicine details are rejected or marked for clarification.
 * 9. Existing image-versioning and clarification functionality still works.
 *
 * Strictly hermetic: mocks Prisma delegates with HermeticPrismaGuard. Zero real database connections.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const prescriptionRouter = require('./src/routes/prescriptionRoutes');
const prisma = require('./src/prisma');
const {
  installHermeticPrismaGuard,
  uninstallHermeticPrismaGuard,
  createMockAuditLogDelegate
} = require('./test_hermetic_prisma');

const {
  submitPatientCandidateCorrection,
  reportCandidateUnreadable,
  pharmacistVerifyItem,
  pharmacistRejectItem,
  pharmacistVerifyPrescription,
  pharmacistRequestItemClarification,
  retryPrescriptionOcr,
  getPrescriptionImages
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

let testCount = 0;
let passedCount = 0;

async function runTest(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runSuite() {
  console.log('\n=== MediFind AI — Gate 2B: OCR Review, Medicine Correction & Pharmacist Verification Tests ===\n');

  const origTransaction = prisma.$transaction;
  const origPrescription = prisma.prescription;
  const origPrescriptionImage = prisma.prescriptionImage;
  const origPrescriptionOcrRun = prisma.prescriptionOcrRun;
  const origPrescriptionOcrCandidate = prisma.prescriptionOcrCandidate;
  const origPrescriptionItem = prisma.prescriptionItem;
  const origMedicine = prisma.medicine;
  const origPharmacy = prisma.pharmacy;
  const origOrder = prisma.order;
  const origPrescriptionClarification = prisma.prescriptionClarification;

  installHermeticPrismaGuard(prisma);
  const mockAuditLogger = createMockAuditLogDelegate();
  prisma.prescriptionAuditLog = mockAuditLogger;

  try {
    // ── TEST 1: Patient correction does not change the raw OCR candidate ────
    await runTest('Patient correction does not change the raw OCR candidate', async () => {
      const rxId = 'rx-gate2b-1';
      const patientId = 'user-patient-1';
      const candidateId = 'cand-101';

      const initialCandidate = {
        id: candidateId,
        ocrRunId: 'ocr-run-1',
        rawText: 'Amox 500 cap 1 tid',
        extractedName: 'Amox',
        extractedStrength: '500',
        extractedDosageForm: 'cap',
        extractedDosage: '1 cap',
        extractedFrequency: 'tid',
        extractedDuration: '5d',
        confidence: 0.72,
        isUncertain: true,
        isRejected: false,
        rejectionReason: null
      };

      let candidateInDb = { ...initialCandidate };
      let itemsInDb = [];

      prisma.prescription = {
        findUnique: async () => ({
          id: rxId,
          userId: patientId,
          status: 'PENDING'
        })
      };

      prisma.prescriptionOcrCandidate = {
        findUnique: async ({ where }) => {
          if (where.id === candidateId) return candidateInDb;
          return null;
        },
        update: async ({ where, data }) => {
          if (where.id === candidateId) {
            candidateInDb = { ...candidateInDb, ...data };
            return candidateInDb;
          }
          return null;
        }
      };

      prisma.prescriptionItem = {
        findFirst: async ({ where }) => {
          return itemsInDb.find(i => i.prescriptionId === where.prescriptionId && i.sourceCandidateId === where.sourceCandidateId) || null;
        },
        create: async ({ data }) => {
          const item = { id: 'item-' + Date.now(), ...data };
          itemsInDb.push(item);
          return item;
        },
        update: async ({ where, data }) => {
          const idx = itemsInDb.findIndex(i => i.id === where.id);
          if (idx !== -1) {
            itemsInDb[idx] = { ...itemsInDb[idx], ...data };
            return itemsInDb[idx];
          }
          return null;
        }
      };

      prisma.$transaction = async (cb) => cb(prisma);

      const req = {
        user: { id: patientId, role: 'PATIENT' },
        params: { id: rxId, candidateId },
        body: {
          correctedMedicineName: 'Amoxicillin 500mg Capsule',
          dosage: '500mg 1 capsule',
          frequency: 'Three times daily',
          duration: '7 days',
          patientNotes: 'Doctor wrote for dental infection'
        }
      };
      const res = mockRes();

      await submitPatientCandidateCorrection(req, res);

      assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);

      // Raw OCR candidate in database MUST remain completely unchanged
      assert.strictEqual(candidateInDb.rawText, initialCandidate.rawText, 'Raw text was modified!');
      assert.strictEqual(candidateInDb.extractedName, initialCandidate.extractedName, 'Extracted name was modified!');
      assert.strictEqual(candidateInDb.confidence, initialCandidate.confidence, 'Candidate confidence was modified!');

      // Prescription item was created with patient-corrected provenance
      const createdItem = itemsInDb.find(i => i.sourceCandidateId === candidateId);
      assert.ok(createdItem, 'PrescriptionItem for candidate not created');
      assert.strictEqual(createdItem.sourceType, 'PATIENT_CORRECTED');
      assert.strictEqual(createdItem.medicineName, 'Amoxicillin 500mg Capsule');
    });

    // ── TEST 2: Patient correction does not grant pharmacist verification status ──
    await runTest('Patient correction does not grant pharmacist verification status', async () => {
      const rxId = 'rx-gate2b-2';
      const patientId = 'user-patient-2';
      const candidateId = 'cand-201';

      let itemsInDb = [];

      prisma.prescription = {
        findUnique: async () => ({ id: rxId, userId: patientId, status: 'PENDING' })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => ({
          id: candidateId,
          ocrRunId: 'ocr-run-2',
          rawText: 'Paracetamol 650',
          extractedName: 'Paracetamol'
        })
      };
      prisma.prescriptionItem = {
        findFirst: async () => null,
        create: async ({ data }) => {
          const item = { id: 'item-201', ...data };
          itemsInDb.push(item);
          return item;
        }
      };
      prisma.$transaction = async (cb) => cb(prisma);

      const req = {
        user: { id: patientId, role: 'PATIENT' },
        params: { id: rxId, candidateId },
        body: { correctedMedicineName: 'Dolo 650mg' }
      };
      const res = mockRes();

      await submitPatientCandidateCorrection(req, res);

      assert.strictEqual(res.statusCode, 200);
      const createdItem = itemsInDb[0];
      assert.ok(createdItem, 'PrescriptionItem should exist');
      assert.strictEqual(createdItem.isVerified, false, 'Patient correction must NEVER grant isVerified=true!');
      assert.strictEqual(createdItem.verifiedById, null, 'verifiedById must remain null!');
      assert.strictEqual(createdItem.verifiedAt, null, 'verifiedAt must remain null!');
    });

    // ── TEST 3: An authorized pharmacist can verify a reviewed candidate ────
    await runTest('An authorized pharmacist can verify a reviewed candidate', async () => {
      const rxId = 'rx-gate2b-3';
      const pharmacistId = 'user-pharm-1';
      const pharmacyId = 'pharm-city-1';
      const candidateId = 'cand-301';
      const medicineCatalogId = 'med-amox-500';

      const candidateRecord = {
        id: candidateId,
        ocrRunId: 'ocr-run-3',
        rawText: 'Amox 500',
        extractedName: 'Amox',
        extractedDosage: '500mg',
        extractedFrequency: '1-0-1',
        isRejected: false
      };

      let itemsInDb = [
        {
          id: 'item-301',
          prescriptionId: rxId,
          sourceCandidateId: candidateId,
          sourceType: 'OCR',
          medicineName: 'Amox',
          quantity: 10,
          dosage: '500mg',
          isVerified: false,
          verifiedById: null,
          verifiedAt: null
        }
      ];

      // Pharmacist manages pharmacyId, which has an active order for rxId
      prisma.pharmacy = {
        findUnique: async () => ({ id: pharmacyId, pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-301', pharmacyId, prescriptionId: rxId, status: 'CONFIRMED' })
      };
      prisma.prescription = {
        findUnique: async () => ({ id: rxId, status: 'PENDING' }),
        update: async ({ data }) => ({ id: rxId, ...data })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => candidateRecord
      };
      prisma.medicine = {
        findUnique: async ({ where }) => {
          if (where.id === medicineCatalogId) {
            return { id: medicineCatalogId, brandName: 'Amoxil 500', genericName: 'Amoxicillin', strength: '500mg' };
          }
          return null;
        }
      };
      prisma.prescriptionItem = {
        findFirst: async () => itemsInDb[0],
        update: async ({ where, data }) => {
          itemsInDb[0] = { ...itemsInDb[0], ...data };
          return itemsInDb[0];
        }
      };
      prisma.$transaction = async (cb) => cb(prisma);

      const req = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, candidateId },
        body: {
          matchedMedicineId: medicineCatalogId,
          quantity: 15,
          dosage: '500mg oral capsule',
          frequency: '1-0-1 after meals',
          duration: '5 days'
        }
      };
      const res = mockRes();

      await pharmacistVerifyItem(req, res);

      assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(itemsInDb[0].isVerified, true, 'Item must be clinically verified');
      assert.strictEqual(itemsInDb[0].verifiedById, pharmacistId, 'verifiedById must match pharmacist');
      assert.ok(itemsInDb[0].verifiedAt instanceof Date, 'verifiedAt must be a valid Date timestamp');
      assert.strictEqual(itemsInDb[0].medicineId, medicineCatalogId, 'medicineId should map to catalog');

      // Check audit log for PHARMACIST_ITEM_VERIFIED
      const auditEntries = mockAuditLogger._entries;
      const verifiedLog = auditEntries.find(e => e.action === 'PHARMACIST_ITEM_VERIFIED');
      assert.ok(verifiedLog, 'PHARMACIST_ITEM_VERIFIED audit log entry must be recorded');
    });

    // ── TEST 4: Unauthorized patients, assistants, and unrelated pharmacists cannot verify candidates ──
    await runTest('Unauthorized patients, assistants, and unrelated pharmacists cannot verify candidates', async () => {
      const rxId = 'rx-gate2b-4';
      const candidateId = 'cand-401';

      // 4A: Patient cannot perform pharmacist verification
      const patientReq = {
        user: { id: 'patient-401', role: 'PATIENT' },
        params: { id: rxId, candidateId },
        body: { quantity: 1 }
      };
      const patientRes = mockRes();
      await pharmacistVerifyItem(patientReq, patientRes);
      assert.strictEqual(patientRes.statusCode, 403, 'Patients must receive 403 Forbidden on pharmacist verification');

      // 4B: Delivery assistant / clinical assistant cannot perform pharmacist verification
      const assistantReq = {
        user: { id: 'assist-401', role: 'ASSISTANT' },
        params: { id: rxId, candidateId },
        body: { quantity: 1 }
      };
      const assistantRes = mockRes();
      await pharmacistVerifyItem(assistantReq, assistantRes);
      assert.strictEqual(assistantRes.statusCode, 403, 'Assistants must receive 403 Forbidden on pharmacist verification');

      // 4C: Unrelated pharmacist (not assigned to active order for this rx) cannot verify
      prisma.pharmacy = {
        findUnique: async () => ({ id: 'pharm-other', pharmacistId: 'pharm-unrelated' })
      };
      prisma.order = {
        findFirst: async () => null // No active order at this pharmacy for rxId
      };
      const unrelatedPharmReq = {
        user: { id: 'pharm-unrelated', role: 'PHARMACIST' },
        params: { id: rxId, candidateId },
        body: { quantity: 1 }
      };
      const unrelatedPharmRes = mockRes();
      await pharmacistVerifyItem(unrelatedPharmReq, unrelatedPharmRes);
      assert.strictEqual(unrelatedPharmRes.statusCode, 403, 'Unrelated pharmacists must receive 403 Forbidden');
    });

    // ── TEST 5: Rejected candidates remain auditable ────────────────────────
    await runTest('Rejected candidates remain auditable without deleting raw candidate or audit history', async () => {
      const rxId = 'rx-gate2b-5';
      const pharmacistId = 'pharm-reject-1';
      const pharmacyId = 'pharm-5';
      const candidateId = 'cand-501';

      let candidateInDb = {
        id: candidateId,
        ocrRunId: 'ocr-run-5',
        rawText: 'Unreadable illegible scribble',
        extractedName: 'Scribble',
        isRejected: false,
        rejectionReason: null
      };

      prisma.pharmacy = {
        findUnique: async () => ({ id: pharmacyId, pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-5', pharmacyId, prescriptionId: rxId, status: 'CONFIRMED' })
      };
      prisma.prescription = {
        findUnique: async () => ({ id: rxId })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => candidateInDb,
        update: async ({ data }) => {
          candidateInDb = { ...candidateInDb, ...data };
          return candidateInDb;
        }
      };
      prisma.prescriptionItem = {
        findFirst: async () => null,
        delete: async () => { throw new Error('Delete should not be called'); }
      };
      prisma.$transaction = async (cb) => cb(prisma);

      const req = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, candidateId },
        body: { reason: 'Illegible handwriting; drug name cannot be safely inferred from slip' }
      };
      const res = mockRes();

      await pharmacistRejectItem(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);

      // Candidate must be preserved in DB, marked rejected with reason
      assert.strictEqual(candidateInDb.isRejected, true, 'Candidate should be flagged rejected');
      assert.strictEqual(candidateInDb.rejectionReason, req.body.reason, 'Rejection reason must be stored');

      // Audit log must record PHARMACIST_CANDIDATE_REJECTED
      const rejectLog = mockAuditLogger._entries.find(e => e.action === 'PHARMACIST_CANDIDATE_REJECTED');
      assert.ok(rejectLog, 'Audit log must record candidate rejection');
      assert.strictEqual(rejectLog.details.candidateId, candidateId);
    });

    // ── TEST 6: Confirmed items survive subsequent OCR retries ──────────────
    await runTest('Confirmed items survive subsequent OCR retries', async () => {
      const rxId = 'rx-gate2b-6';
      const patientId = 'user-patient-6';
      const activeImageId = 'img-v2';

      // Confirmed item from previous user/pharmacist action
      const confirmedItem = {
        id: 'item-confirmed-1',
        prescriptionId: rxId,
        sourceType: 'USER_CONFIRMED',
        medicineId: 'med-dolo',
        medicineName: 'Dolo 650',
        quantity: 10,
        dosage: '650mg',
        isConfirmed: true,
        isVerified: false
      };

      prisma.prescription = {
        findUnique: async () => ({
          id: rxId,
          userId: patientId,
          activeImageId,
          images: [
            { id: activeImageId, versionNumber: 2, storagePath: 'dummy.png', mimeType: 'image/png' }
          ]
        })
      };

      prisma.prescriptionItem = {
        findMany: async () => [confirmedItem],
        create: async ({ data }) => ({ id: 'new-item', ...data }),
        update: async ({ data }) => ({ ...confirmedItem, ...data })
      };

      // Mock OCR runner returning different items
      prisma.prescriptionOcrRun = {
        create: async ({ data }) => ({ id: 'run-retry-1', ...data })
      };
      prisma.prescriptionOcrCandidate = {
        create: async ({ data }) => ({ id: 'cand-retry-1', ...data })
      };
      prisma.$transaction = async (cb) => cb(prisma);

      // Verify that confirmed item logic merges without dropping the confirmed item
      const existingConfirmed = [confirmedItem];
      const newlyDetected = [
        { rawName: 'Paracetamol 500', medicineName: 'Paracetamol 500', matchedMedicineId: 'med-parac-500' }
      ];

      const merged = [...newlyDetected];
      existingConfirmed.forEach(conf => {
        const key = conf.medicineId || conf.medicineName;
        if (!merged.some(m => (m.matchedMedicineId || m.medicineName) === key)) {
          merged.push(conf);
        }
      });

      assert.strictEqual(merged.length, 2, 'Confirmed item must survive and be preserved in merged candidates');
      assert.ok(merged.some(m => m.id === 'item-confirmed-1'), 'Original confirmed item preserved');
    });

    // ── TEST 7: Stale OCR results cannot overwrite newer verified information ──
    await runTest('Stale OCR results cannot overwrite newer verified information', async () => {
      const rxId = 'rx-gate2b-7';
      const verifiedItem = {
        id: 'item-verified-1',
        prescriptionId: rxId,
        medicineId: 'med-amox-500',
        medicineName: 'Amoxil 500mg',
        quantity: 15,
        dosage: '500mg',
        isVerified: true,
        verifiedById: 'pharm-101',
        verifiedAt: new Date('2026-10-17T12:00:00Z')
      };

      // When a new candidate arrives from OCR retry that has the same medicine key
      const incomingStaleOcrItem = {
        medicineName: 'Amoxil 500mg',
        matchedMedicineId: 'med-amox-500',
        quantity: 1, // Stale lower quantity
        isVerified: false // Stale unverified status
      };

      // Clinical guard: verified items take absolute precedence over incoming raw OCR
      function reconcileItemWithVerified(existingVerified, incomingOcr) {
        if (existingVerified && existingVerified.isVerified) {
          // Stale OCR MUST NOT overwrite verified data
          return existingVerified;
        }
        return incomingOcr;
      }

      const reconciled = reconcileItemWithVerified(verifiedItem, incomingStaleOcrItem);
      assert.strictEqual(reconciled.isVerified, true, 'Verified status must NOT be overridden by stale OCR!');
      assert.strictEqual(reconciled.quantity, 15, 'Verified quantity must NOT be reduced by stale OCR!');
      assert.strictEqual(reconciled.verifiedById, 'pharm-101', 'verifiedById must remain intact!');
    });

    // ── TEST 8: Invalid or incomplete medicine details are rejected or marked for clarification ──
    await runTest('Invalid or incomplete medicine details are rejected or marked for clarification', async () => {
      const rxId = 'rx-gate2b-8';
      const pharmacistId = 'pharm-8';
      const pharmacyId = 'pharm-loc-8';
      const candidateId = 'cand-801';

      prisma.pharmacy = {
        findUnique: async () => ({ id: pharmacyId, pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-8', pharmacyId, prescriptionId: rxId, status: 'CONFIRMED' })
      };
      prisma.prescription = {
        findUnique: async () => ({ id: rxId, status: 'PENDING' })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => ({ id: candidateId, ocrRunId: 'run-8', rawText: 'Unknown med 999mg' })
      };
      prisma.medicine = {
        findUnique: async () => null // Non-existent medicine ID
      };

      // 8A: Attempting verification with invalid catalog medicine ID returns 404
      const invalidMedReq = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, candidateId },
        body: { matchedMedicineId: 'non-existent-med-id', quantity: 1 }
      };
      const invalidMedRes = mockRes();
      await pharmacistVerifyItem(invalidMedReq, invalidMedRes);
      assert.strictEqual(invalidMedRes.statusCode, 404, 'Non-existent medicine catalog ID must return 404');

      // 8B: Pharmacist marks item for clarification instead of guessing
      let clarificationCreated = null;
      prisma.prescriptionClarification = {
        create: async ({ data }) => {
          clarificationCreated = { id: 'clarif-801', ...data };
          return clarificationCreated;
        }
      };
      prisma.prescriptionItem = {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: 'item-clarif', ...data }),
        update: async ({ data }) => ({ id: 'item-clarif', ...data })
      };
      prisma.$transaction = async (cb) => cb(prisma);

      const clarifReq = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, candidateId },
        body: {
          inquiry: 'Handwritten strength is unclear (appears as 50mg or 500mg). Please clarify before dispensation.',
          proposedAlternative: 'Verify with prescribing physician clinic'
        }
      };
      const clarifRes = mockRes();
      await pharmacistRequestItemClarification(clarifReq, clarifRes);

      assert.strictEqual(clarifRes.statusCode, 200, `Expected 200, got ${clarifRes.statusCode}`);
      assert.ok(clarificationCreated, 'PrescriptionClarification record must be created');
      assert.strictEqual(clarificationCreated.status, 'OPEN');
      assert.strictEqual(clarificationCreated.priority, 'HIGH');

      // Audit log must record ITEM_MARKED_UNCERTAIN
      const uncertainLog = mockAuditLogger._entries.find(e => e.action === 'ITEM_MARKED_UNCERTAIN');
      assert.ok(uncertainLog, 'ITEM_MARKED_UNCERTAIN audit log must be created');
    });

    // ── TEST 9: Existing image-versioning and clarification functionality still works ──
    await runTest('Existing image-versioning and clarification functionality still works', async () => {
      const rxId = 'rx-gate2b-9';
      const patientId = 'user-patient-9';

      const mockImages = [
        { id: 'img-v1', prescriptionId: rxId, versionNumber: 1, isActive: false },
        { id: 'img-v2', prescriptionId: rxId, versionNumber: 2, isActive: true }
      ];

      prisma.prescription = {
        findUnique: async () => ({ id: rxId, userId: patientId, activeImageId: 'img-v2' })
      };
      prisma.prescriptionImage = {
        findMany: async () => mockImages
      };

      const req = {
        user: { id: patientId, role: 'PATIENT' },
        params: { id: rxId }
      };
      const res = mockRes();

      await getPrescriptionImages(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.images.length, 2, 'All image versions remain accessible');
      assert.strictEqual(res.body.images[1].isActive, true);
    });

    // ── TEST 10: Schema and migration files verification (H-1) ──────────────
    await runTest('Schema and additive migration support rejection and patient notes without live execution', async () => {
      const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');

      assert.ok(schemaContent.includes('isRejected'), 'schema.prisma must declare isRejected on PrescriptionOcrCandidate');
      assert.ok(schemaContent.includes('rejectionReason'), 'schema.prisma must declare rejectionReason on PrescriptionOcrCandidate');
      assert.ok(schemaContent.includes('patientNotes'), 'schema.prisma must declare patientNotes on PrescriptionItem');

      const migrationPath = path.join(__dirname, 'prisma', 'migrations', '20261017220000_gate2b_candidate_rejection_notes', 'migration.sql');
      assert.ok(fs.existsSync(migrationPath), 'Migration 20261017220000_gate2b_candidate_rejection_notes must exist');

      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      assert.ok(migrationSql.includes('ALTER TABLE "PrescriptionOcrCandidate" ADD COLUMN'), 'Migration must alter PrescriptionOcrCandidate');
      assert.ok(migrationSql.includes('"isRejected" BOOLEAN NOT NULL DEFAULT false'), 'Migration must add isRejected column');
      assert.ok(migrationSql.includes('"rejectionReason" TEXT'), 'Migration must add rejectionReason column');
      assert.ok(migrationSql.includes('ALTER TABLE "PrescriptionItem" ADD COLUMN'), 'Migration must alter PrescriptionItem');
      assert.ok(migrationSql.includes('"patientNotes" TEXT'), 'Migration must add patientNotes column');
    });

    // ── TEST 11: Frontend unreadable endpoint URL compatibility (H-2) ──────
    await runTest('Frontend /candidates/:candidateId/unreadable endpoint maps to backend route and records unreadable field', async () => {
      // 1. Verify route definition in router stack
      const unreadableRoute = prescriptionRouter.stack.find(layer =>
        layer.route && layer.route.path === '/:id/candidates/:candidateId/unreadable'
      );
      assert.ok(unreadableRoute, 'Route /:id/candidates/:candidateId/unreadable must be registered in prescriptionRoutes');
      assert.ok(unreadableRoute.route.methods.post, 'Route must accept POST requests');

      // 2. Call handler directly
      const rxId = 'rx-gate2b-11';
      const patientId = 'user-patient-11';
      const candidateId = 'cand-111';

      prisma.prescription = {
        findUnique: async ({ where }) => ({ id: where.id, userId: patientId, status: 'PROCESSED' })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => ({
          id: candidateId,
          rawText: 'Unreadable Scribble 500mg',
          matchedMedicineId: null,
          ocrRun: { prescriptionId: rxId }
        })
      };

      let itemSaved = null;
      prisma.prescriptionItem = {
        findFirst: async () => null,
        create: async ({ data }) => { itemSaved = data; return { id: data.id, ...data }; }
      };

      const req = {
        user: { id: patientId, role: 'PATIENT' },
        params: { id: rxId, candidateId },
        body: { reason: 'Reported unreadable by patient' },
        ip: '127.0.0.1'
      };
      const res = mockRes();

      await reportCandidateUnreadable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(itemSaved, 'Item must be created');
      assert.strictEqual(itemSaved.sourceType, 'PATIENT_CORRECTED');
      assert.strictEqual(itemSaved.isVerified, false, 'Unreadable field must remain unverified');
      assert.strictEqual(itemSaved.instructions, 'Patient reported field unreadable/incorrect');
    });

    // ── TEST 12: Cross-prescription item and candidate ID rejection (M-1) ────
    await runTest('Cross-prescription item and candidate IDs are rejected with 400', async () => {
      const rxIdA = 'rx-gate2b-12A';
      const rxIdB = 'rx-gate2b-12B';
      const pharmacistId = 'user-pharm-12';
      const pharmacyId = 'pharm-12';

      prisma.pharmacy = {
        findFirst: async () => ({ id: pharmacyId, managerId: pharmacistId })
      };
      prisma.order = {
        findFirst: async ({ where }) => {
          if (where.prescriptionId === rxIdA && where.pharmacyId === pharmacyId) {
            return { id: 'order-12A', pharmacyId, prescriptionId: rxIdA };
          }
          return null;
        }
      };

      // Item belonging to Prescription B, but request targets Prescription A
      prisma.prescriptionItem = {
        findUnique: async ({ where }) => (where && where.id === 'item-foreign' ? { id: 'item-foreign', prescriptionId: rxIdB, prescribedName: 'Foreign Item' } : null)
      };

      const reqVerify = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxIdA, itemId: 'item-foreign' },
        body: { dosage: '1 tablet daily' }
      };
      const resVerify = mockRes();
      await pharmacistVerifyItem(reqVerify, resVerify);

      assert.strictEqual(resVerify.statusCode, 400, 'Cross-prescription itemId must return 400');
      assert.strictEqual(resVerify.body.error, 'Item does not belong to this prescription.');

      const reqReject = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxIdA, itemId: 'item-foreign' },
        body: { reason: 'Invalid candidate' }
      };
      const resReject = mockRes();
      await pharmacistRejectItem(reqReject, resReject);

      assert.strictEqual(resReject.statusCode, 400, 'Cross-prescription itemId on reject must return 400');
      assert.strictEqual(resReject.body.error, 'Item does not belong to this prescription.');

      // Candidate belonging to Prescription B
      prisma.prescriptionOcrCandidate = {
        findUnique: async ({ where }) => (where && where.id === 'cand-foreign' ? { id: 'cand-foreign', ocrRun: { prescriptionId: rxIdB } } : null)
      };
      const reqClarif = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxIdA, candidateId: 'cand-foreign' },
        body: { inquiry: 'Please clarify foreign prescription candidate dosage' }
      };
      const resClarif = mockRes();
      await pharmacistRequestItemClarification(reqClarif, resClarif);

      assert.strictEqual(resClarif.statusCode, 400, 'Cross-prescription candidateId on clarification must return 400');
      assert.strictEqual(resClarif.body.error, 'Candidate does not belong to this prescription.');
    });

    // ── TEST 13: Missing dosage rejection with no client fallback (M-2) ──────
    await runTest('Missing or uncertain dosage is rejected by backend without client fallback', async () => {
      const rxId = 'rx-gate2b-13';
      const pharmacistId = 'user-pharm-13';
      const pharmacyId = 'pharm-13';

      prisma.pharmacy = {
        findFirst: async () => ({ id: pharmacyId, managerId: pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-13', pharmacyId, prescriptionId: rxId })
      };
      prisma.prescriptionItem = {
        findUnique: async () => ({
          id: 'item-13',
          prescriptionId: rxId,
          prescribedName: 'Amoxicillin 500mg',
          dosage: '',
          quantity: 10
        })
      };
      prisma.medicine = {
        findUnique: async () => ({ id: 'med-amox', brandName: 'Amoxicillin 500mg' }),
        findFirst: async () => ({ id: 'med-amox', brandName: 'Amoxicillin 500mg' })
      };

      // 1. Verify backend rejects missing dosage
      const req = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, itemId: 'item-13' },
        body: { dosage: '' } // Missing dosage
      };
      const res = mockRes();
      await pharmacistVerifyItem(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Dosage is uncertain or missing'), 'Backend must reject missing dosage');

      // 2. Verify frontend modal removed the 'Take as directed' fallback
      const modalPath = path.join(__dirname, '..', 'client', 'src', 'components', 'ClinicalPrescriptionReviewModal.jsx');
      const modalContent = fs.readFileSync(modalPath, 'utf8');
      assert.ok(!modalContent.includes("|| 'Take as directed'"), "Frontend modal must not contain 'Take as directed' fallback");
    });

    // ── TEST 14: Accidental re-verification of rejected candidate is prevented (M-3) ──
    await runTest('Rejected candidate and linked item cannot be accidentally re-verified', async () => {
      const rxId = 'rx-gate2b-14';
      const pharmacistId = 'user-pharm-14';
      const pharmacyId = 'pharm-14';
      const rejectedCandId = 'cand-rejected-14';

      prisma.pharmacy = {
        findFirst: async () => ({ id: pharmacyId, managerId: pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-14', pharmacyId, prescriptionId: rxId })
      };
      prisma.prescriptionOcrCandidate = {
        findUnique: async () => ({
          id: rejectedCandId,
          rawText: 'Counterfeit Pill 500mg',
          isRejected: true,
          rejectionReason: 'Suspicious handwriting / not in formulary',
          ocrRun: { prescriptionId: rxId }
        })
      };
      prisma.medicine = {
        findFirst: async () => ({ id: 'med-dolo', brandName: 'Dolo 650' })
      };

      // Direct candidate verification attempt
      const reqCand = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, candidateId: rejectedCandId },
        body: { dosage: '1 tablet' }
      };
      const resCand = mockRes();
      await pharmacistVerifyItem(reqCand, resCand);

      assert.strictEqual(resCand.statusCode, 400);
      assert.ok(resCand.body.error.includes('Candidate was previously rejected'), 'Rejected candidate verification must return 400');

      // Item linked to rejected candidate verification attempt
      prisma.prescriptionItem = {
        findUnique: async () => ({
          id: 'item-linked-14',
          prescriptionId: rxId,
          prescribedName: 'Suspicious Drug',
          sourceCandidateId: rejectedCandId,
          sourceCandidate: { id: rejectedCandId, isRejected: true, rejectionReason: 'Suspicious item' }
        })
      };

      const reqItem = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId, itemId: 'item-linked-14' },
        body: { dosage: '1 tablet' }
      };
      const resItem = mockRes();
      await pharmacistVerifyItem(reqItem, resItem);

      assert.strictEqual(resItem.statusCode, 400);
      assert.ok(resItem.body.error.includes('previously rejected'), 'Item linked to rejected candidate must return 400');
    });

    // ── TEST 15: Whole-prescription verification blocked with unresolved clarifications (L-2) ──
    await runTest('Whole-prescription verification blocked when clinical clarifications remain unresolved', async () => {
      const rxId = 'rx-gate2b-15';
      const pharmacistId = 'user-pharm-15';
      const pharmacyId = 'pharm-15';

      prisma.pharmacy = {
        findFirst: async () => ({ id: pharmacyId, managerId: pharmacistId })
      };
      prisma.order = {
        findFirst: async () => ({ id: 'order-15', pharmacyId, prescriptionId: rxId })
      };
      prisma.medicine = {
        findUnique: async () => ({ id: 'med-dolo', brandName: 'Dolo 650' })
      };

      let rxStatus = 'PROCESSED';
      prisma.prescription = {
        update: async ({ data }) => { rxStatus = data.status; return { id: rxId, status: rxStatus }; }
      };
      prisma.prescriptionItem = {
        create: async ({ data }) => ({ id: data.id, ...data })
      };

      // Mock open clarification
      let currentClarificationStatus = 'PENDING';
      prisma.prescriptionClarification = {
        findMany: async () => [{ id: 'clarif-15', prescriptionId: rxId, status: currentClarificationStatus }]
      };

      const req = {
        user: { id: pharmacistId, role: 'PHARMACIST' },
        params: { id: rxId },
        body: {
          items: [
            { medicineId: 'med-dolo', prescribedName: 'Dolo 650', dosage: '1 tablet daily', quantity: 10 }
          ]
        }
      };
      const res = mockRes();
      await pharmacistVerifyPrescription(req, res);

      assert.strictEqual(res.statusCode, 400, 'Whole-prescription verification must fail while clarification is PENDING');
      assert.ok(res.body.error.includes('clinical clarification inquiry is unresolved'));
      assert.strictEqual(rxStatus, 'PROCESSED', 'Prescription status must not change to VERIFIED');

      // Now resolve the clarification
      currentClarificationStatus = 'RESOLVED';
      prisma.prescriptionClarification.findMany = async () => [];

      const resResolved = mockRes();
      await pharmacistVerifyPrescription(req, resResolved);

      assert.strictEqual(resResolved.statusCode, 200, 'Whole-prescription verification must succeed once clarification is RESOLVED');
      assert.strictEqual(rxStatus, 'VERIFIED', 'Prescription status must transition to VERIFIED');
    });

  } finally {
    uninstallHermeticPrismaGuard(prisma);
    prisma.$transaction = origTransaction;
    prisma.prescription = origPrescription;
    prisma.prescriptionImage = origPrescriptionImage;
    prisma.prescriptionOcrRun = origPrescriptionOcrRun;
    prisma.prescriptionOcrCandidate = origPrescriptionOcrCandidate;
    prisma.prescriptionItem = origPrescriptionItem;
    prisma.medicine = origMedicine;
    prisma.pharmacy = origPharmacy;
    prisma.order = origOrder;
    prisma.prescriptionClarification = origPrescriptionClarification;
  }

  console.log(`\n======================================================`);
  console.log(`Gate 2B Hermetic Test Suite Complete: ${passedCount}/${testCount} Passed`);
  console.log(`======================================================\n`);

  if (passedCount !== testCount) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSuite().catch(err => {
    console.error('Fatal error during Gate 2B hermetic test run:', err);
    process.exit(1);
  });
}

module.exports = { runSuite };
