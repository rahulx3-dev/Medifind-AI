/**
 * MediFind AI — Phase 1, Step 11B: Slice 1 Image Versioning Foundation Unit & Regression Tests
 *
 * Tests:
 * 1. Genuine image upload creates PrescriptionImage with version 1 and correct SHA-256.
 * 2. Prescription.activeImageId references the created image.
 * 3. File size, MIME type, storage path, and original filename are stored correctly.
 * 4. Database transaction failure safely cleans up newly uploaded file (no orphan file).
 * 5. Image retrieval resolves the active image via PrescriptionImage.
 * 6. Legacy image retrieval falls back to Prescription.filePath when activeImageId is null.
 * 7. Sample text prescriptions do NOT create PrescriptionImage records.
 * 8. Role-based image authorization remains enforced (Admin, Patient owner, Pharmacist order, Assistant denied).
 * 9. Path containment and missing file protection.
 *
 * Offline execution: uses mocks and isolated test fixtures in scratch/uploads.
 * Does not touch staging or production databases.
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
  createMockAuditLogDelegate
} = require('./test_hermetic_prisma');
const ocrEngine = require('./src/utils/ocrEngine');
const { uploadPrescription, getPrescriptionImage } = require('./src/controllers/prescriptionController');

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
  console.log('\n=== MediFind AI — Step 11B: Slice 1 Image Versioning Tests ===\n');

  // Save original functions to restore after tests
  const origTransaction = prisma.$transaction;
  const origPrescriptionCreate = prisma.prescription.create;
  const origPrescriptionUpdate = prisma.prescription.update;
  const origPrescriptionFindUnique = prisma.prescription.findUnique;
  const origDetectedMedicineCreate = prisma.detectedMedicine ? prisma.detectedMedicine.create : null;
  const origMedicineFindMany = prisma.medicine.findMany;
  const origPharmacyFindUnique = prisma.pharmacy.findUnique;
  const origOrderFindFirst = prisma.order.findFirst;
  const origRunOCR = ocrEngine.runOCR;
  const origPrescriptionAuditLog = prisma.prescriptionAuditLog;
  const origPrescriptionOcrRun = prisma.prescriptionOcrRun;
  installHermeticPrismaGuard(prisma);
  prisma.prescriptionAuditLog = createMockAuditLogDelegate();
  prisma.prescriptionOcrRun = undefined;
  prisma.prescription.findFirst = async () => null;

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Genuine image upload creates PrescriptionImage v1 with SHA-256
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Genuine image upload creates PrescriptionImage v1 with correct SHA-256 and activeImageId', async () => {
    const testFileName = `test_upload_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    const expectedSha256 = crypto.createHash('sha256').update(VALID_PNG_BYTES).digest('hex');
    const expectedSize = VALID_PNG_BYTES.length;

    let createdPrescription = null;
    let createdImage = null;
    let updatedActiveImageId = null;

    // Mock prisma transaction and operations
    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => {
            createdPrescription = { id: 'rx-test-uuid', ...data };
            return createdPrescription;
          },
          update: async ({ where, data }) => {
            if (data.activeImageId) {
              updatedActiveImageId = data.activeImageId;
            }
            return { ...createdPrescription, ...data };
          }
        },
        prescriptionImage: {
          create: async ({ data }) => {
            createdImage = { ...data };
            return createdImage;
          }
        },
        prescriptionAuditLog: createMockAuditLogDelegate()
      };
      return callback(mockTx);
    };

    prisma.prescription.update = async ({ where, data }) => ({ ...createdPrescription, ...data });
    prisma.prescription.findUnique = async () => ({
      ...createdPrescription,
      activeImageId: createdImage?.id,
      detectedMedicines: []
    });
    if (prisma.detectedMedicine) {
      prisma.detectedMedicine.create = async ({ data }) => ({ id: 'dm-1', ...data });
    }
    prisma.medicine.findMany = async () => [];
    ocrEngine.runOCR = async () => ({ success: true, rawText: 'Sample raw text', confidence: 95, medicineLines: [] });

    const req = {
      user: { id: 'user-patient-1' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'original_presc.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: expectedSize
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    // Cleanup test file
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 201, `Expected status 201, got ${res.statusCode}`);
    assert.ok(createdImage, 'PrescriptionImage should have been created');
    assert.strictEqual(createdImage.versionNumber, 1, 'Version number must be 1');
    assert.strictEqual(createdImage.fileSha256, expectedSha256, 'SHA-256 hash must match validated file bytes');
    assert.strictEqual(createdImage.fileSizeBytes, expectedSize, 'File size must match file byte length');
    assert.strictEqual(createdImage.mimeType, 'image/png', 'MIME type must be preserved');
    assert.strictEqual(createdImage.originalFileName, 'original_presc.png', 'Original filename must be recorded');
    assert.strictEqual(createdImage.storagePath, testFilePath, 'Storage path must match');
    assert.strictEqual(createdImage.uploadedById, 'user-patient-1', 'UploadedById must match authenticated user');
    assert.strictEqual(updatedActiveImageId, createdImage.id, 'Prescription.activeImageId must point to new image ID');
    assert.strictEqual(res.body.prescription.activeImageId, createdImage.id, 'Response must include activeImageId');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Database transaction failure cleans up newly created upload file
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Database transaction failure cleans up newly created upload file (no orphan file)', async () => {
    const testFileName = `test_fail_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    // Also create a separate existing file that must NEVER be deleted
    const existingFileName = `existing_file_${Date.now()}.png`;
    const existingFilePath = path.join(UPLOAD_DIR, existingFileName);
    fs.writeFileSync(existingFilePath, VALID_PNG_BYTES);

    // Mock transaction throwing an error
    prisma.$transaction = async () => {
      throw new Error('Simulated database deadlock / constraint failure');
    };

    const req = {
      user: { id: 'user-patient-1' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'fail.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    const uploadedFileExists = fs.existsSync(testFilePath);
    const existingFileExists = fs.existsSync(existingFilePath);

    // Clean up existing file fixture
    if (fs.existsSync(existingFilePath)) fs.unlinkSync(existingFilePath);

    assert.strictEqual(res.statusCode, 500, 'Expected 500 status on transaction failure');
    assert.strictEqual(uploadedFileExists, false, 'Uploaded file must be removed on transaction failure');
    assert.strictEqual(existingFileExists, true, 'Existing unrelated file must NEVER be deleted');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Sample text prescriptions do NOT create PrescriptionImage records
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Sample text prescriptions do NOT create PrescriptionImage records and work properly', async () => {
    let prescriptionCreated = false;
    let imageCreated = false;

    prisma.prescription.create = async ({ data }) => {
      prescriptionCreated = true;
      return { id: 'rx-sample-id', ...data };
    };
    prisma.prescription.update = async ({ where, data }) => ({ id: 'rx-sample-id', ...data });
    prisma.prescription.findUnique = async () => ({
      id: 'rx-sample-id',
      userId: 'user-patient-1',
      filePath: 'samples/sample-fever-bronchitis.txt',
      detectedMedicines: []
    });
    if (prisma.detectedMedicine) {
      prisma.detectedMedicine.create = async ({ data }) => ({ id: 'dm-sample-1', ...data });
    }
    prisma.medicine.findMany = async () => [];

    // Mock transaction or prescriptionImage to detect any improper image creation
    prisma.$transaction = async () => {
      imageCreated = true;
    };
    if (prisma.prescriptionImage) {
      prisma.prescriptionImage.create = async () => {
        imageCreated = true;
      };
    }

    const req = {
      user: { id: 'user-patient-1' },
      body: { sampleId: 'sample-fever-bronchitis' }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    assert.strictEqual(res.statusCode, 201, `Expected status 201, got ${res.statusCode}`);
    assert.strictEqual(prescriptionCreated, true, 'Sample prescription record should be created');
    assert.strictEqual(imageCreated, false, 'PrescriptionImage must NOT be created for sample text presets');
    assert.strictEqual(res.body.prescription.activeImageId, null, 'activeImageId should be null for sample preset');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Image retrieval resolves active image via PrescriptionImage
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage resolves active image via PrescriptionImage record', async () => {
    const testFileName = `test_active_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.prescription.findUnique = async ({ where }) => ({
      id: 'rx-active-id',
      userId: 'patient-owner',
      activeImageId: 'img-v1-uuid',
      filePath: 'legacy/fallback/path.png'
    });

    // Provide mock for prescriptionImage.findUnique
    const origPrescriptionImage = prisma.prescriptionImage;
    prisma.prescriptionImage = {
      findUnique: async ({ where }) => {
        if (where.id === 'img-v1-uuid') {
          return {
            id: 'img-v1-uuid',
            storagePath: testFilePath,
            mimeType: 'image/png',
            versionNumber: 1
          };
        }
        return null;
      }
    };

    const req = {
      params: { id: 'rx-active-id' },
      user: { id: 'patient-owner', role: 'PATIENT' }
    };
    const res = mockRes();

    await getPrescriptionImage(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    prisma.prescriptionImage = origPrescriptionImage;

    assert.strictEqual(res.sentFile, path.resolve(testFilePath), 'Must serve the active image resolved from PrescriptionImage');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Legacy image retrieval fallback when activeImageId is null
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage falls back to Prescription.filePath for legacy prescriptions', async () => {
    const testFileName = `test_legacy_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.prescription.findUnique = async ({ where }) => ({
      id: 'rx-legacy-id',
      userId: 'patient-owner',
      activeImageId: null,
      filePath: testFilePath
    });

    const req = {
      params: { id: 'rx-legacy-id' },
      user: { id: 'patient-owner', role: 'PATIENT' }
    };
    const res = mockRes();

    await getPrescriptionImage(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.sentFile, path.resolve(testFilePath), 'Must fall back to legacy filePath when activeImageId is null');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Sample prescription image retrieval is safely rejected
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage safely rejects sample .txt prescriptions with 404', async () => {
    prisma.prescription.findUnique = async ({ where }) => ({
      id: 'rx-sample-id',
      userId: 'patient-owner',
      activeImageId: null,
      filePath: 'samples/sample-fever-bronchitis.txt'
    });

    const req = {
      params: { id: 'rx-sample-id' },
      user: { id: 'patient-owner', role: 'PATIENT' }
    };
    const res = mockRes();

    await getPrescriptionImage(req, res);

    assert.strictEqual(res.statusCode, 404, 'Must return 404 for sample prescriptions');
    assert.strictEqual(res.body.error, 'No image file associated with this prescription.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Role-based image authorization
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage enforces strict role-based authorization', async () => {
    const testFileName = `test_auth_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.prescription.findUnique = async () => ({
      id: 'rx-auth-id',
      userId: 'patient-alice',
      activeImageId: null,
      filePath: testFilePath
    });

    // 7a. Another patient -> 403
    {
      const req = { params: { id: 'rx-auth-id' }, user: { id: 'patient-bob', role: 'PATIENT' } };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.statusCode, 403, 'Another patient must be denied');
    }

    // 7b. Assistant -> 403
    {
      const req = { params: { id: 'rx-auth-id' }, user: { id: 'assistant-1', role: 'ASSISTANT' } };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.statusCode, 403, 'Assistant role must be denied');
    }

    // 7c. Pharmacist without order at managed pharmacy -> 403
    {
      prisma.pharmacy.findUnique = async () => ({ id: 'pharmacy-1', managerId: 'pharmacist-1' });
      prisma.order.findFirst = async () => null; // No order

      const req = { params: { id: 'rx-auth-id' }, user: { id: 'pharmacist-1', role: 'PHARMACIST' } };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.statusCode, 403, 'Pharmacist without associated order must be denied');
    }

    // 7d. Pharmacist with order at managed pharmacy -> 200 (sendFile)
    {
      prisma.pharmacy.findUnique = async () => ({ id: 'pharmacy-1', managerId: 'pharmacist-1' });
      prisma.order.findFirst = async () => ({ id: 'order-1', prescriptionId: 'rx-auth-id', pharmacyId: 'pharmacy-1' });

      const req = { params: { id: 'rx-auth-id' }, user: { id: 'pharmacist-1', role: 'PHARMACIST' } };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.sentFile, path.resolve(testFilePath), 'Pharmacist with order must be authorized');
    }

    // 7e. Admin -> 200 (sendFile)
    {
      const req = { params: { id: 'rx-auth-id' }, user: { id: 'admin-1', role: 'ADMIN' } };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.sentFile, path.resolve(testFilePath), 'Admin must be authorized');
    }

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 8: Path containment protection
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage enforces upload directory containment against path traversal', async () => {
    // Provide an absolute path located outside UPLOAD_DIR
    const outsidePath = path.resolve(__dirname, 'package.json');

    prisma.prescription.findUnique = async () => ({
      id: 'rx-traversal-id',
      userId: 'patient-alice',
      activeImageId: null,
      filePath: outsidePath
    });

    const req = { params: { id: 'rx-traversal-id' }, user: { id: 'patient-alice', role: 'PATIENT' } };
    const res = mockRes();
    await getPrescriptionImage(req, res);

    assert.strictEqual(res.statusCode, 403, 'Path traversal must be rejected with 403');
    assert.strictEqual(res.body.error, 'Invalid file path.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 9: Missing image on disk returns safe 404 without leaking path
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('getPrescriptionImage safely returns 404 for missing disk file without path leakage', async () => {
    prisma.prescription.findUnique = async () => ({
      id: 'rx-missing-id',
      userId: 'patient-alice',
      activeImageId: null,
      filePath: path.join(UPLOAD_DIR, 'non_existent_rx_image_12345.png')
    });

    const req = { params: { id: 'rx-missing-id' }, user: { id: 'patient-alice', role: 'PATIENT' } };
    const res = mockRes();
    await getPrescriptionImage(req, res);

    assert.strictEqual(res.statusCode, 404, 'Missing file must return 404');
    assert.strictEqual(res.body.error, 'Prescription image file not found.');
    assert.strictEqual(JSON.stringify(res.body).includes('non_existent'), false, 'Response must not leak internal disk path');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 10: Post-commit failure does NOT delete the uploaded file
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Post-commit failure preserves uploaded file on disk (does not orphan committed DB record)', async () => {
    const testFileName = `test_postcommit_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    let createdPrescription = null;
    let createdImage = null;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => {
            createdPrescription = { id: 'rx-post-commit-id', ...data };
            return createdPrescription;
          },
          update: async ({ where, data }) => ({ ...createdPrescription, ...data })
        },
        prescriptionImage: {
          create: async ({ data }) => {
            createdImage = { ...data };
            return createdImage;
          }
        }
      };
      return callback(mockTx);
    };

    // Simulate unexpected post-commit crash during OCR execution
    ocrEngine.runOCR = async () => {
      throw new Error('Simulated unhandled OCR pipeline crash post-commit');
    };

    const req = {
      user: { id: 'user-patient-1' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'postcommit_presc.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    const fileStillExists = fs.existsSync(testFilePath);

    // Clean up test fixture
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 500, 'Expected 500 status on post-commit error');
    assert.strictEqual(res.body.success, false, 'Expected success: false in response');
    assert.strictEqual(fileStillExists, true, 'Uploaded file MUST NOT be deleted after transaction has committed');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 11: Parameterized raw SQL fallback with bound parameters and special chars
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Parameterized raw SQL fallback passes bound positional parameters for special chars and Unicode', async () => {
    const testFileName = `test_rawsql_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    const specialOriginalName = "Dr. O'Connor & Müller — Rx (2026); DROP TABLE \"PrescriptionImage\"; --.png";
    const sqlCalls = [];

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => ({ id: 'rx-rawsql-id', ...data }),
          update: async ({ where, data }) => ({ id: 'rx-rawsql-id', ...data })
        },
        // Force fallback branch by omitting prescriptionImage delegate
        prescriptionImage: undefined,
        $executeRawUnsafe: async (sql, ...params) => {
          sqlCalls.push({ sql, params });
          return 1;
        }
      };
      return callback(mockTx);
    };

    prisma.prescription.update = async ({ where, data }) => ({ id: 'rx-rawsql-id', ...data });
    prisma.prescription.findUnique = async () => ({
      id: 'rx-rawsql-id',
      activeImageId: sqlCalls[0]?.params?.[0] || 'mock-id',
      detectedMedicines: []
    });
    prisma.medicine.findMany = async () => [];
    ocrEngine.runOCR = async () => ({ success: true, rawText: 'Sample text', confidence: 90, medicineLines: [] });

    const req = {
      user: { id: 'user-patient-rawsql' },
      body: {},
      file: {
        path: testFilePath,
        originalname: specialOriginalName,
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 201, `Expected status 201, got ${res.statusCode}`);
    assert.strictEqual(sqlCalls.length, 2, 'Must execute exactly 2 raw SQL statements (INSERT PrescriptionImage, UPDATE Prescription)');

    // Statement 1: INSERT into PrescriptionImage
    const insertCall = sqlCalls[0];
    assert.ok(insertCall.sql.includes('INSERT INTO "PrescriptionImage"'), 'First statement must be INSERT into PrescriptionImage');
    assert.ok(insertCall.sql.includes('$1, $2, $3, $4, $5, $6, $7, $8, $9, $10'), 'SQL must use positional parameter placeholders $1..$10');
    // Verify special characters are NOT interpolated into the SQL string itself
    assert.strictEqual(insertCall.sql.includes("O'Connor"), false, 'Special character must not be interpolated into SQL text');
    assert.strictEqual(insertCall.sql.includes('DROP TABLE'), false, 'Malicious SQL fragment must not be in SQL text');
    // Verify bound parameters
    assert.strictEqual(insertCall.params.length, 10, 'INSERT must receive 10 bound parameters');
    const imageId = insertCall.params[0];
    assert.ok(typeof imageId === 'string' && imageId.length > 10, 'Param 1 must be generated imageId');
    assert.strictEqual(insertCall.params[1], 'rx-rawsql-id', 'Param 2 must be prescriptionId');
    assert.strictEqual(insertCall.params[2], 1, 'Param 3 must be versionNumber 1');
    assert.strictEqual(insertCall.params[3], specialOriginalName, 'Param 4 must preserve exact special/Unicode filename as bound parameter');
    assert.strictEqual(insertCall.params[5], testFilePath, 'Param 6 must be storagePath');
    assert.strictEqual(insertCall.params[9], 'user-patient-rawsql', 'Param 10 must be uploadedById');

    // Statement 2: UPDATE Prescription activeImageId
    const updateCall = sqlCalls[1];
    assert.ok(updateCall.sql.includes('UPDATE "Prescription" SET "activeImageId" = $1'), 'Second statement must UPDATE Prescription');
    assert.strictEqual(updateCall.params.length, 3, 'UPDATE must receive 3 bound parameters');
    assert.strictEqual(updateCall.params[0], imageId, 'Param 1 of UPDATE must be the created imageId');
    assert.strictEqual(updateCall.params[1], 'IMAGE_UPLOAD', 'Param 2 of UPDATE must be sourceType');
    assert.strictEqual(updateCall.params[2], 'rx-rawsql-id', 'Param 3 of UPDATE must be prescriptionId');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 12: Simulated SQL fallback failure triggers transaction rollback and file cleanup
  // ─────────────────────────────────────────────────────────────────────────────
  await runTestAsync('Simulated SQL fallback failure rejects transaction and deletes newly uploaded file', async () => {
    const testFileName = `test_sqlfail_${Date.now()}.png`;
    const testFilePath = path.join(UPLOAD_DIR, testFileName);
    fs.writeFileSync(testFilePath, VALID_PNG_BYTES);

    prisma.$transaction = async (callback) => {
      const mockTx = {
        prescription: {
          create: async ({ data }) => ({ id: 'rx-sqlfail-id', ...data })
        },
        prescriptionImage: undefined,
        $executeRawUnsafe: async () => {
          throw new Error('Simulated PostgreSQL unique constraint violation on PrescriptionImage');
        }
      };
      return callback(mockTx);
    };

    const req = {
      user: { id: 'user-patient-1' },
      body: {},
      file: {
        path: testFilePath,
        originalname: 'sqlfail.png',
        filename: testFileName,
        mimetype: 'image/png',
        size: VALID_PNG_BYTES.length
      }
    };
    const res = mockRes();

    await uploadPrescription(req, res);

    const uploadedFileExists = fs.existsSync(testFilePath);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    assert.strictEqual(res.statusCode, 500, 'Expected 500 status on SQL failure');
    assert.strictEqual(uploadedFileExists, false, 'Newly uploaded file must be deleted when SQL fallback fails');
  });

  // Restore prisma and ocrEngine
  prisma.$transaction = origTransaction;
  prisma.prescription.create = origPrescriptionCreate;
  prisma.prescription.update = origPrescriptionUpdate;
  prisma.prescription.findUnique = origPrescriptionFindUnique;
  if (origDetectedMedicineCreate && prisma.detectedMedicine) {
    prisma.detectedMedicine.create = origDetectedMedicineCreate;
  }
  prisma.medicine.findMany = origMedicineFindMany;
  prisma.pharmacy.findUnique = origPharmacyFindUnique;
  prisma.order.findFirst = origOrderFindFirst;
  ocrEngine.runOCR = origRunOCR;
  if (origPrescriptionAuditLog) prisma.prescriptionAuditLog = origPrescriptionAuditLog;
  if (origPrescriptionOcrRun) prisma.prescriptionOcrRun = origPrescriptionOcrRun;
  uninstallHermeticPrismaGuard(prisma);

  console.log(`\n─────────────────────────────────────────────────────────────`);
  console.log(`Results: ${passedCount} / ${testCount} tests passed.`);
  if (passedCount === testCount) {
    console.log(`✓ All Slice 1 Image Versioning tests PASSED successfully!\n`);
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
