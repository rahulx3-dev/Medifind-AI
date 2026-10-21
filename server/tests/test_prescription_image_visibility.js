/**
 * Test Suite: Prescription Image Visibility & Authorization
 * 
 * Asserts:
 * 1. Image version resolution returns distinct original and enhanced image contents.
 * 2. Authenticated retrieval works via Bearer header and query param ?token=.
 * 3. Authorized patient receives 200 with proper file streaming.
 * 4. Authorized pharmacist (with order containing prescription) receives 200.
 * 5. Unauthorized pharmacist (without order) is denied with 403 Forbidden.
 * 6. Non-existent image version returns 404 Not Found.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const { getPrescriptionImage, getPrescriptionImages } = require('../src/controllers/prescriptionController');
const { authenticateToken, JWT_SECRET } = require('../src/middlewares/auth');

const UPLOAD_DIR = path.resolve(__dirname, '../uploads/prescriptions');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    sentFile: null,
    body: null,
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
    },
    setHeader(k, v) {
      this.headers[k] = v;
    }
  };
}

async function runSuite() {
  console.log('=== MediFind AI: Prescription Image Visibility & Auth Suite ===\n');

  const testFileV1 = path.join(UPLOAD_DIR, `test-v1-${Date.now()}.png`);
  const testFileV2 = path.join(UPLOAD_DIR, `test-v2-${Date.now()}.png`);
  fs.writeFileSync(testFileV1, Buffer.from('ORIGINAL_PRESCRIPTION_IMAGE_V1'));
  fs.writeFileSync(testFileV2, Buffer.from('ENHANCED_PRESCRIPTION_IMAGE_V2'));

  try {
    const prisma = require('../src/prisma');

    // Setup mock prescription and images
    const rxId = `rx-vis-${Date.now()}`;
    const img1Id = `img-vis-1-${Date.now()}`;
    const img2Id = `img-vis-2-${Date.now()}`;

    // Override prisma mocks for safe testing
    const originalFindUniqueRx = prisma.prescription.findUnique;
    const originalFindFirstOrder = prisma.order.findFirst;
    const originalFindUniquePharmacy = prisma.pharmacy.findUnique;
    const originalFindManyImages = prisma.prescriptionImage?.findMany;
    const originalFindFirstImage = prisma.prescriptionImage?.findFirst;

    prisma.prescription.findUnique = async ({ where }) => {
      if (where.id === rxId) {
        return {
          id: rxId,
          userId: 'patient-alice',
          activeImageId: img2Id,
          filePath: testFileV1
        };
      }
      return null;
    };

    if (prisma.prescriptionImage) {
      prisma.prescriptionImage.findFirst = async ({ where }) => {
        if (where.prescriptionId === rxId && where.id === img1Id) {
          return { id: img1Id, prescriptionId: rxId, versionNumber: 1, storagePath: testFileV1 };
        }
        if (where.prescriptionId === rxId && where.id === img2Id) {
          return { id: img2Id, prescriptionId: rxId, versionNumber: 2, storagePath: testFileV2 };
        }
        return null;
      };

      prisma.prescriptionImage.findMany = async ({ where }) => {
        if (where.prescriptionId === rxId) {
          return [
            { id: img1Id, versionNumber: 1, isOriginal: true, storagePath: testFileV1, createdAt: new Date() },
            { id: img2Id, versionNumber: 2, isOriginal: false, storagePath: testFileV2, createdAt: new Date() }
          ];
        }
        return [];
      };
    }

    // 1. Authenticate Token Middleware supports Bearer Header & Query Param
    console.log('Test 1: authenticateToken accepts Bearer header and query param ?token');
    {
      const token = jwt.sign({ id: 'patient-alice', role: 'PATIENT' }, JWT_SECRET);
      
      // Via Header
      const reqHeader = { headers: { authorization: `Bearer ${token}` } };
      const resHeader = mockRes();
      let nextCalled = false;
      authenticateToken(reqHeader, resHeader, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, 'Bearer header must authenticate');
      assert.strictEqual(reqHeader.user.id, 'patient-alice');

      // Via Query Param
      const reqQuery = { headers: {}, query: { token } };
      const resQuery = mockRes();
      let nextQueryCalled = false;
      authenticateToken(reqQuery, resQuery, () => { nextQueryCalled = true; });
      assert.strictEqual(nextQueryCalled, true, 'Query param token must authenticate');
      assert.strictEqual(reqQuery.user.id, 'patient-alice');
      console.log('  ✓ PASS: Both header and query token authentication validated');
    }

    // 2. Patient can retrieve distinct Original v1 and Enhanced v2 images
    console.log('Test 2: Patient retrieves distinct original (v1) and enhanced (v2) images');
    {
      const reqV1 = {
        params: { id: rxId },
        query: { imageId: img1Id },
        user: { id: 'patient-alice', role: 'PATIENT' }
      };
      const resV1 = mockRes();
      await getPrescriptionImage(reqV1, resV1);
      assert.strictEqual(resV1.sentFile, path.resolve(testFileV1), 'v1 must resolve testFileV1');

      const reqV2 = {
        params: { id: rxId },
        query: { imageId: img2Id },
        user: { id: 'patient-alice', role: 'PATIENT' }
      };
      const resV2 = mockRes();
      await getPrescriptionImage(reqV2, resV2);
      assert.strictEqual(resV2.sentFile, path.resolve(testFileV2), 'v2 must resolve testFileV2');
      console.log('  ✓ PASS: Version 1 and Version 2 resolve to distinct file assets');
    }

    // 3. Authorized Pharmacist can retrieve prescription image for assigned order
    console.log('Test 3: Authorized pharmacist can view prescription image for assigned order');
    {
      prisma.pharmacy.findUnique = async () => ({ id: 'pharmacy-city', managerId: 'pharmacist-bob' });
      prisma.order.findFirst = async () => ({ id: 'order-1', prescriptionId: rxId, pharmacyId: 'pharmacy-city' });

      const req = {
        params: { id: rxId },
        query: { imageId: img2Id },
        user: { id: 'pharmacist-bob', role: 'PHARMACIST' }
      };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.sentFile, path.resolve(testFileV2), 'Pharmacist with order must receive image');
      console.log('  ✓ PASS: Authorized pharmacist successfully received prescription image');
    }

    // 4. Unauthorized Pharmacist is strictly denied with 403 Forbidden
    console.log('Test 4: Pharmacist without assigned order is denied with 403 Forbidden');
    {
      prisma.pharmacy.findUnique = async () => ({ id: 'pharmacy-other', managerId: 'pharmacist-charlie' });
      prisma.order.findFirst = async () => null; // No order for this prescription!

      const req = {
        params: { id: rxId },
        query: { imageId: img1Id },
        user: { id: 'pharmacist-charlie', role: 'PHARMACIST' }
      };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.statusCode, 403, 'Must return 403 Forbidden');
      assert.strictEqual(res.body.success, false);
      console.log('  ✓ PASS: Unauthorized pharmacist denied with 403 Forbidden');
    }

    // 5. Non-existent image version returns 404
    console.log('Test 5: Requesting non-existent image version returns 404');
    {
      const req = {
        params: { id: rxId },
        query: { imageId: 'non-existent-image-id' },
        user: { id: 'patient-alice', role: 'PATIENT' }
      };
      const res = mockRes();
      await getPrescriptionImage(req, res);
      assert.strictEqual(res.statusCode, 404, 'Must return 404 Not Found');
      console.log('  ✓ PASS: Missing version returns 404 cleanly');
    }

    // Restore mocks
    prisma.prescription.findUnique = originalFindUniqueRx;
    prisma.order.findFirst = originalFindFirstOrder;
    prisma.pharmacy.findUnique = originalFindUniquePharmacy;
    if (prisma.prescriptionImage) {
      prisma.prescriptionImage.findMany = originalFindManyImages;
      prisma.prescriptionImage.findFirst = originalFindFirstImage;
    }

    console.log('\nAll 5 image visibility & authorization tests PASSED successfully!\n');
  } finally {
    if (fs.existsSync(testFileV1)) fs.unlinkSync(testFileV1);
    if (fs.existsSync(testFileV2)) fs.unlinkSync(testFileV2);
  }
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
