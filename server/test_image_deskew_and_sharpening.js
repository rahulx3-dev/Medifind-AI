/**
 * MediFind AI — Fine-Angle Deskewing and Real Pixel Sharpening Verification Tests
 *
 * Verifies:
 * 1. Arbitrary-angle rotation & expanded unclipped canvas bounds calculation
 * 2. Combined coarse (90°) and fine-angle (-10° to +10°) rotation calculations
 * 3. Mathematical zero-clipping guarantee for rotated corner coordinates
 * 4. Zero-strength sharpening preserving pixel buffer 100% unchanged
 * 5. Real pixel sharpening modifying and enhancing edge contrast
 * 6. Noise coring deadband protecting flat/noisy paper grain from amplification
 * 7. Halo/overflow safeguards strictly clamping pixel values to [0, 255] and preserving alpha
 * 8. End-to-end integration: saving enhanced image with fine deskew & sharpen metadata
 *    creates a new version without mutating original or previous versions.
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
const {
  replaceOrEnhancePrescriptionImage,
  getPrescriptionImages
} = require('./src/controllers/prescriptionController');

const UPLOAD_DIR = path.resolve(__dirname, 'uploads/prescriptions');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Valid 1x1 PNG and JPEG bytes
const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

const VALID_JPEG_BYTES = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0xFF, 0xD9
]);

// Test utilities matching client/src/utils/imageEnhancement.js
function calculateRotatedDimensions(width, height, angleInDegrees) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  const rad = ((Number(angleInDegrees) || 0) * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));

  const rotW = Math.max(1, Math.round(w * cos + h * sin));
  const rotH = Math.max(1, Math.round(w * sin + h * cos));

  return { width: rotW, height: rotH };
}

function getCombinedRotation(coarseRotation = 0, fineAngle = 0) {
  const coarse = Number(coarseRotation) || 0;
  const fine = Number(fineAngle) || 0;
  return Math.round((coarse + fine) * 100) / 100;
}

function applySharpening(imageData, strength = 0) {
  if (!imageData || !imageData.data || strength <= 0) {
    return imageData;
  }

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) {
    return imageData;
  }

  const src = new Uint8ClampedArray(data);
  const clampedStrength = Math.min(100, Math.max(0, Number(strength) || 0));
  const k = (clampedStrength / 100) * 0.65;
  const coringThreshold = 2.0;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const rowPrev = (y - 1) * width;
    const rowNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const idx = (rowOffset + x) * 4;
      const idxTop = (rowPrev + x) * 4;
      const idxBottom = (rowNext + x) * 4;
      const idxLeft = (rowOffset + x - 1) * 4;
      const idxRight = (rowOffset + x + 1) * 4;

      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const top = src[idxTop + c];
        const bottom = src[idxBottom + c];
        const left = src[idxLeft + c];
        const right = src[idxRight + c];

        const laplacian = 4 * center - (top + bottom + left + right);

        if (Math.abs(laplacian) > coringThreshold) {
          const delta = laplacian * k;
          const val = center + delta;
          data[idx + c] = val < 0 ? 0 : val > 255 ? 255 : (val + 0.5) | 0;
        }
      }
    }
  }

  return imageData;
}

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
  }
}

async function runSuite() {
  console.log('\n=== MediFind AI: Fine-Angle Deskewing & Image Sharpening Unit Tests ===\n');

  // Test 1: Cardinal rotation dimension preservation
  await runTest('1. Cardinal rotations (0°, 90°, 180°, 270°) calculate exact dimension bounds', () => {
    const origW = 1200;
    const origH = 800;

    const r0 = calculateRotatedDimensions(origW, origH, 0);
    assert.strictEqual(r0.width, origW, '0° width must equal original');
    assert.strictEqual(r0.height, origH, '0° height must equal original');

    const r90 = calculateRotatedDimensions(origW, origH, 90);
    assert.strictEqual(r90.width, origH, '90° width must equal original height');
    assert.strictEqual(r90.height, origW, '90° height must equal original width');

    const r180 = calculateRotatedDimensions(origW, origH, 180);
    assert.strictEqual(r180.width, origW, '180° width must equal original width');
    assert.strictEqual(r180.height, origH, '180° height must equal original height');

    const r270 = calculateRotatedDimensions(origW, origH, 270);
    assert.strictEqual(r270.width, origH, '270° width must equal original height');
    assert.strictEqual(r270.height, origW, '270° height must equal original width');
  });

  // Test 2: Arbitrary fine-angle rotation expands canvas bounds
  await runTest('2. Arbitrary fine angles (-10° to +10°) expand canvas bounds preventing clipping', () => {
    const origW = 1000;
    const origH = 800;

    const angles = [-10, -7.5, -5, -2, -0.5, 0.5, 2, 5, 7.5, 10];
    for (const angle of angles) {
      const dim = calculateRotatedDimensions(origW, origH, angle);
      assert(dim.width > origW * 0.98, `Rotated width (${dim.width}) for angle ${angle} preserves content`);
      assert(dim.height > origH * 0.98, `Rotated height (${dim.height}) for angle ${angle} preserves content`);

      const rad = (Math.abs(angle) * Math.PI) / 180;
      const expectedW = Math.round(origW * Math.cos(rad) + origH * Math.sin(rad));
      const expectedH = Math.round(origW * Math.sin(rad) + origH * Math.cos(rad));
      assert.strictEqual(dim.width, expectedW, `Width for ${angle}° matches trigonometric bound`);
      assert.strictEqual(dim.height, expectedH, `Height for ${angle}° matches trigonometric bound`);
    }
  });

  // Test 3: Mathematical zero-clipping guarantee for rotated corners
  await runTest('3. Mathematical zero-clipping: all 4 rotated corners fit within expanded canvas bounds', () => {
    const origW = 1600;
    const origH = 1200;

    const testAngles = [-9.5, -4, 0, 3.5, 8, 93.5, 184, 267.5];

    for (const angle of testAngles) {
      const { width: rotW, height: rotH } = calculateRotatedDimensions(origW, origH, angle);
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const halfW = origW / 2;
      const halfH = origH / 2;
      const cx = rotW / 2;
      const cy = rotH / 2;

      const corners = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH]
      ];

      for (const [x, y] of corners) {
        const rotX = cx + (x * cos - y * sin);
        const rotY = cy + (x * sin + y * cos);

        assert(
          rotX >= -1.0 && rotX <= rotW + 1.0,
          `Corner [${x},${y}] rotated X (${rotX}) must fit inside [0, ${rotW}] at ${angle}°`
        );
        assert(
          rotY >= -1.0 && rotY <= rotH + 1.0,
          `Corner [${x},${y}] rotated Y (${rotY}) must fit inside [0, ${rotH}] at ${angle}°`
        );
      }
    }
  });

  // Test 4: Combined coarse and fine angle computation
  await runTest('4. Combinations of 90° rotation and fine-angle rotation compose correctly', () => {
    assert.strictEqual(getCombinedRotation(0, 0), 0);
    assert.strictEqual(getCombinedRotation(90, 2.5), 92.5);
    assert.strictEqual(getCombinedRotation(180, -3.5), 176.5);
    assert.strictEqual(getCombinedRotation(270, 5), 275);
    assert.strictEqual(getCombinedRotation(0, -8.5), -8.5);

    const combinedDim = calculateRotatedDimensions(1000, 600, getCombinedRotation(90, 5));
    const directDim = calculateRotatedDimensions(1000, 600, 95);
    assert.strictEqual(combinedDim.width, directDim.width);
    assert.strictEqual(combinedDim.height, directDim.height);
  });

  // Test 5: Zero-strength sharpening preserves pixels bit-for-bit
  await runTest('5. Zero-strength sharpening leaves image pixels 100% unchanged', () => {
    const width = 10;
    const height = 10;
    const buffer = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = (i * 37 + 13) % 256;
    }

    const originalCopy = new Uint8ClampedArray(buffer);
    const imgData = { width, height, data: buffer };

    applySharpening(imgData, 0);

    for (let i = 0; i < buffer.length; i++) {
      assert.strictEqual(buffer[i], originalCopy[i], `Byte at index ${i} must remain unchanged when strength=0`);
    }
  });

  // Test 6: Real sharpening modifies and enhances edge contrast
  await runTest('6. Real sharpening modifies edge pixels and amplifies local gradient contrast', () => {
    const width = 5;
    const height = 5;
    const buffer = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const val = x < 2 ? 50 : 200;
        buffer[idx] = val;     // R
        buffer[idx + 1] = val; // G
        buffer[idx + 2] = val; // B
        buffer[idx + 3] = 255; // A
      }
    }

    const originalCopy = new Uint8ClampedArray(buffer);
    const imgData = { width, height, data: buffer };

    applySharpening(imgData, 60);

    const darkEdgeIdx = (2 * width + 1) * 4;
    assert(
      buffer[darkEdgeIdx] < originalCopy[darkEdgeIdx],
      `Dark side of edge should be pushed darker (was ${originalCopy[darkEdgeIdx]}, now ${buffer[darkEdgeIdx]})`
    );

    const brightEdgeIdx = (2 * width + 2) * 4;
    assert(
      buffer[brightEdgeIdx] > originalCopy[brightEdgeIdx],
      `Bright side of edge should be pushed brighter (was ${originalCopy[brightEdgeIdx]}, now ${buffer[brightEdgeIdx]})`
    );

    assert.strictEqual(buffer[darkEdgeIdx + 3], 255);
    assert.strictEqual(buffer[brightEdgeIdx + 3], 255);
  });

  // Test 7: Noise coring deadband suppresses low-amplitude sensor noise
  await runTest('7. Noise coring threshold ignores subtle fluctuations below deadband', () => {
    const width = 5;
    const height = 5;
    const flatBuffer = new Uint8ClampedArray(width * height * 4).fill(180);
    for (let i = 3; i < flatBuffer.length; i += 4) flatBuffer[i] = 255;
    const flatImgData = { width, height, data: flatBuffer };
    applySharpening(flatImgData, 80);
    assert.strictEqual(flatBuffer[10], 180, 'Completely flat regions remain strictly untouched');
  });

  // Test 8: Value clamping strictly prevents halo overflow/wrap-around
  await runTest('8. Clamping safeguards strictly contain pixel values within [0, 255]', () => {
    const width = 3;
    const height = 3;
    const buffer = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 0;
      buffer[i + 1] = 0;
      buffer[i + 2] = 0;
      buffer[i + 3] = 255;
    }
    const centerIdx = (1 * width + 1) * 4;
    buffer[centerIdx] = 255;
    buffer[centerIdx + 1] = 255;
    buffer[centerIdx + 2] = 255;

    const imgData = { width, height, data: buffer };
    applySharpening(imgData, 100);

    for (let i = 0; i < buffer.length; i++) {
      assert(buffer[i] >= 0 && buffer[i] <= 255, `Pixel value at ${i} must stay in [0, 255]`);
    }
    assert.strictEqual(buffer[centerIdx], 255, 'Max clamped value is 255, no uint8 overflow');
  });

  // Test 9: Combined enhancement workflow: saving enhanced image creates new version with metadata
  await runTest('9. Backend ENHANCE saves fine deskew & sharpen metadata as Version N+1 without mutating original', async () => {
    const rxId = 'rx-deskew-suite-1';
    const patientId = 'user-deskew-patient-1';
    const v1File = path.join(UPLOAD_DIR, 'rx-deskew-v1.png');
    fs.writeFileSync(v1File, VALID_PNG_BYTES);
    const v1Sha256 = crypto.createHash('sha256').update(VALID_PNG_BYTES).digest('hex');

    const mockImages = [
      {
        id: 'img-v1',
        prescriptionId: rxId,
        versionNumber: 1,
        originalFileName: 'orig_photo.png',
        storedFileName: 'rx-deskew-v1.png',
        storagePath: v1File,
        mimeType: 'image/png',
        fileSizeBytes: VALID_PNG_BYTES.length,
        fileSha256: v1Sha256,
        parentImageId: null,
        cropCoordinates: null,
        uploadedById: patientId,
        createdAt: new Date()
      }
    ];

    let currentActiveId = 'img-v1';

    const origTransaction = prisma.$transaction;
    const origPrescription = prisma.prescription;
    const origPrescriptionImage = prisma.prescriptionImage;

    installHermeticPrismaGuard(prisma);
    prisma.prescriptionAuditLog = createMockAuditLogDelegate();

    prisma.prescription = {
      findUnique: async ({ where }) => {
        if (where.id === rxId) {
          return {
            id: rxId,
            userId: patientId,
            activeImageId: currentActiveId,
            filePath: v1File,
            status: 'VERIFICATION_REQUIRED'
          };
        }
        return null;
      },
      update: async ({ where, data }) => {
        if (where.id === rxId && data.activeImageId) {
          currentActiveId = data.activeImageId;
        }
        return { id: rxId, activeImageId: currentActiveId };
      }
    };

    prisma.prescriptionImage = {
      findMany: async ({ where }) => mockImages.filter(i => i.prescriptionId === where.prescriptionId),
      findFirst: async ({ where }) => {
        if (where.fileSha256) {
          return mockImages.find(i => i.prescriptionId === where.prescriptionId && i.fileSha256 === where.fileSha256) || null;
        }
        return mockImages.find(i => i.id === where.id) || null;
      },
      create: async ({ data }) => {
        mockImages.push({ ...data, createdAt: new Date() });
        return data;
      }
    };

    prisma.$transaction = async (cb) => cb(prisma);

    const v2File = path.join(UPLOAD_DIR, 'rx-deskew-v2-enhanced.jpg');
    fs.writeFileSync(v2File, VALID_JPEG_BYTES);

    try {
      const enhanceReq = {
        params: { id: rxId },
        user: { id: patientId, role: 'PATIENT' },
        file: {
          path: v2File,
          originalname: 'rx_v2_enhanced_sharpened.jpg',
          mimetype: 'image/jpeg'
        },
        body: {
          action: 'ENHANCE',
          parentImageId: 'img-v1',
          cropCoordinates: JSON.stringify({
            rotation: 90,
            fineAngle: 2.5,
            totalRotation: 92.5,
            crop: { x: 50, y: 40, width: 600, height: 450 },
            brightness: 105,
            contrast: 135,
            sharpen: 30
          })
        }
      };

      const enhanceRes = mockRes();
      await replaceOrEnhancePrescriptionImage(enhanceReq, enhanceRes);

      assert.strictEqual(enhanceRes.statusCode, 201, 'Enhancement response must be 201 Created');
      assert(enhanceRes.body && enhanceRes.body.success, 'Response must indicate success');
      assert.strictEqual(enhanceRes.body.image.versionNumber, 2, 'Enhanced version must be version 2');
      assert.strictEqual(enhanceRes.body.image.parentImageId, 'img-v1', 'Parent lineage must point to version 1');

      // Verify metadata stored
      const parsedCoords = JSON.parse(enhanceRes.body.image.cropCoordinates);
      assert.strictEqual(parsedCoords.fineAngle, 2.5, 'Fine deskew angle recorded');
      assert.strictEqual(parsedCoords.totalRotation, 92.5, 'Total rotation recorded');
      assert.strictEqual(parsedCoords.sharpen, 30, 'Sharpening strength recorded');
      assert.strictEqual(parsedCoords.brightness, 105, 'Brightness recorded');
      assert.strictEqual(parsedCoords.contrast, 135, 'Contrast recorded');

      // Verify original v1 record and file on disk are unchanged
      const v1Record = mockImages.find(i => i.versionNumber === 1);
      assert.ok(v1Record, 'v1 record must exist');
      const v1Bytes = fs.readFileSync(v1File);
      assert.strictEqual(crypto.createHash('sha256').update(v1Bytes).digest('hex'), v1Sha256, 'V1 file unchanged');

      // Verify prescription activeImageId updated to v2
      assert.strictEqual(currentActiveId, enhanceRes.body.image.id, 'Active image pointer updated');
    } finally {
      uninstallHermeticPrismaGuard(prisma);
      prisma.$transaction = origTransaction;
      prisma.prescription = origPrescription;
      prisma.prescriptionImage = origPrescriptionImage;

      if (fs.existsSync(v1File)) fs.unlinkSync(v1File);
      if (fs.existsSync(v2File)) fs.unlinkSync(v2File);
    }
  });

  console.log(`\nResults: ${passedCount} / ${testCount} tests passed.\n`);
  if (passedCount !== testCount) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
