/**
 * MEDIFIND AI — PHASE 2 AUTOMATED TEST SUITE
 * REAL PRESCRIPTION IMAGE UPLOAD, OCR & VERIFICATION PIPELINE
 * Tests all 25 required test cases from Section 20 of prompt.
 */

const fs = require('fs');
const path = require('path');
const { Jimp, loadFont } = require('jimp');
const { SANS_32_BLACK } = require('jimp/fonts');
const prisma = require('./src/prisma');

const BASE_URL = 'http://localhost:5000/api';

async function runPhase2Tests() {
  console.log('🔬 =======================================================');
  console.log('🔬 MEDIFIND AI - PHASE 2 OCR & PRESCRIPTION VERIFICATION SUITE');
  console.log('🔬 =======================================================\n');

  const results = [];
  function record(testNum, category, title, passed, details) {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testNum, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} Test #${testNum} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  // ── Authentication Setup ───────────────────────────────────────────────────
  console.log('🔑 Authenticating test accounts...');
  
  // Patient 1
  const p1Res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@medifind.com', password: 'password123' })
  });
  const p1Data = await p1Res.json();
  const patient1Token = p1Data.token;
  const patient1Id = p1Data.user.id;

  // Pharmacist 1
  const pharmRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pharmacist1@medifind.com', password: 'password123' })
  });
  const pharmData = await pharmRes.json();
  const pharmacistToken = pharmData.token;

  // Assistant
  const asstRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'assistant@medifind.com', password: 'password123' })
  });
  const asstData = await asstRes.json();
  const assistantToken = asstData.token;

  // Patient 2 (register fresh patient for isolation tests)
  const p2Email = `patient2_test_${Date.now()}@medifind.com`;
  const p2Res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Sunita Rao',
      email: p2Email,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  const p2Data = await p2Res.json();
  const patient2Token = p2Data.token;
  const patient2Id = p2Data.user.id;

  console.log('🔑 Authentication completed.\n');

  // ── Create Synthetic Test Fixtures ─────────────────────────────────────────
  console.log('🎨 Generating synthetic academic image fixtures...');
  const font = await loadFont(SANS_32_BLACK);
  const tmpDir = path.join(__dirname, 'test_fixtures');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // 1. Synthetic Dolo 650 JPEG prescription
  const doloImg = new Jimp({ width: 700, height: 250, color: 0xffffffff });
  doloImg.print({ font, x: 30, y: 40, text: 'Rx: Dolo 650' });
  doloImg.print({ font, x: 30, y: 110, text: '1 tab twice daily' });
  const doloJpgPath = path.join(tmpDir, 'test_prescription_dolo.jpg');
  await doloImg.write(doloJpgPath);

  // 2. Synthetic Augmentin PNG prescription
  const augImg = new Jimp({ width: 750, height: 250, color: 0xffffffff });
  augImg.print({ font, x: 30, y: 40, text: 'Augmentin 625 Duo' });
  augImg.print({ font, x: 30, y: 110, text: '1 tab daily 5 days' });
  const augPngPath = path.join(tmpDir, 'test_prescription_aug.png');
  await augImg.write(augPngPath);

  // 3. Synthetic Non-Medical Grocery List PNG (No medicines)
  const nonMedImg = new Jimp({ width: 700, height: 250, color: 0xffffffff });
  nonMedImg.print({ font, x: 30, y: 40, text: 'Shopping List' });
  nonMedImg.print({ font, x: 30, y: 110, text: 'Milk Bread Butter' });
  const nonMedPngPath = path.join(tmpDir, 'test_non_medical_list.png');
  await nonMedImg.write(nonMedPngPath);

  // 4. Unsupported Text File disguised as JPEG
  const fakeJpgPath = path.join(tmpDir, 'fake_disguised.jpg');
  fs.writeFileSync(fakeJpgPath, 'This is plain text and definitely not a real JPEG image!');

  // 5. Unsupported pure .txt file
  const txtFilePath = path.join(tmpDir, 'plain_document.txt');
  fs.writeFileSync(txtFilePath, 'Some medical notes in text format');

  console.log('🎨 Synthetic fixtures ready.\n');

  let verifiedPrescriptionId = null;
  let detectedDoloItem = null;
  let doloMedicineCatalogItem = null;

  try {
    // ----------------------------------------------------
    // TEST 1: Unauthenticated upload -> 401
    // ----------------------------------------------------
    try {
      const fd = new FormData();
      const buffer = fs.readFileSync(doloJpgPath);
      fd.append('prescriptionImage', new Blob([buffer], { type: 'image/jpeg' }), 'test.jpg');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        body: fd
      });
      const passed = res.status === 401;
      record(1, 'UPLOAD', 'Unauthenticated upload is rejected with 401', passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(1, 'UPLOAD', 'Unauthenticated upload is rejected with 401', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 2: Authenticated patient upload valid JPG -> accepted
    // ----------------------------------------------------
    let rxJpgData = null;
    try {
      const fd = new FormData();
      const buffer = fs.readFileSync(doloJpgPath);
      fd.append('prescriptionImage', new Blob([buffer], { type: 'image/jpeg' }), 'prescription_dolo.jpg');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      rxJpgData = await res.json();
      const passed = res.status === 201 && rxJpgData.success && rxJpgData.prescription?.status === 'VERIFICATION_REQUIRED';
      verifiedPrescriptionId = rxJpgData.prescription?.id;
      record(2, 'UPLOAD', 'Authenticated patient upload valid JPG is accepted (201)', passed, `Rx ID: ${verifiedPrescriptionId}, Status: ${rxJpgData.prescription?.status}`);
    } catch (e) {
      record(2, 'UPLOAD', 'Authenticated patient upload valid JPG is accepted', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 3: PNG upload -> accepted
    // ----------------------------------------------------
    try {
      const fd = new FormData();
      const buffer = fs.readFileSync(augPngPath);
      fd.append('prescriptionImage', new Blob([buffer], { type: 'image/png' }), 'prescription_aug.png');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      const data = await res.json();
      const passed = res.status === 201 && data.success && !!data.prescription?.id;
      record(3, 'UPLOAD', 'PNG prescription upload is accepted (201)', passed, `Rx ID: ${data.prescription?.id}`);
    } catch (e) {
      record(3, 'UPLOAD', 'PNG prescription upload is accepted', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 4: WEBP upload -> accepted if valid image
    // ----------------------------------------------------
    try {
      // Valid lossless 1x1 pixel WebP buffer
      const webpPayload = Buffer.from('524946461a000000574542505650384c0d0000002f00000010071011118888fe0700', 'hex');
      const fd = new FormData();
      fd.append('prescriptionImage', new Blob([webpPayload], { type: 'image/webp' }), 'rx.webp');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      // Accepts upload (201 or 422 if empty OCR text, but NOT 415 rejected file type)
      const passed = res.status === 201 || res.status === 422;
      record(4, 'UPLOAD', 'WEBP image format is recognized and accepted', passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(4, 'UPLOAD', 'WEBP image format is recognized and accepted', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 5: Unsupported file type -> rejected
    // ----------------------------------------------------
    try {
      const fd = new FormData();
      const buffer = fs.readFileSync(txtFilePath);
      fd.append('prescriptionImage', new Blob([buffer], { type: 'text/plain' }), 'notes.txt');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      const data = await res.json();
      const passed = res.status === 415 && !data.success;
      record(5, 'SECURITY', 'Unsupported file type (.txt) is rejected with 415', passed, `HTTP status ${res.status}, Error: ${data.error}`);
    } catch (e) {
      record(5, 'SECURITY', 'Unsupported file type (.txt) is rejected', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 6: Oversized file (>10MB) -> rejected
    // ----------------------------------------------------
    try {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
      const fd = new FormData();
      fd.append('prescriptionImage', new Blob([largeBuffer], { type: 'image/jpeg' }), 'huge.jpg');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      const passed = res.status === 413;
      record(6, 'SECURITY', 'Oversized file (>10MB) is rejected with 413', passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(6, 'SECURITY', 'Oversized file (>10MB) is rejected', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 7: Missing file -> rejected
    // ----------------------------------------------------
    try {
      const fd = new FormData();
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      const passed = res.status === 400;
      record(7, 'VALIDATION', 'Missing prescription file is rejected with 400', passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(7, 'VALIDATION', 'Missing prescription file is rejected', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 8: Uploaded image produces real OCR processing
    // ----------------------------------------------------
    try {
      const ocrRaw = rxJpgData?.prescription?.ocrRawText || '';
      const passed = rxJpgData?.success && ocrRaw.length > 0 && rxJpgData?.ocrConfidence > 0;
      record(8, 'OCR', 'Uploaded image produces genuine OCR processing & non-empty text', passed, `Confidence: ${rxJpgData?.ocrConfidence}%, Extracted: "${ocrRaw.replace(/\n/g, ' ')}"`);
    } catch (e) {
      record(8, 'OCR', 'Uploaded image produces genuine OCR processing', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 9: OCR result creates candidate matches
    // ----------------------------------------------------
    try {
      const detected = rxJpgData?.prescription?.detectedMedicines || [];
      detectedDoloItem = detected.find(m => /dolo/i.test(m.matchedMedicineName || ''));
      const passed = !!detectedDoloItem && !!detectedDoloItem.matchedMedicineId;
      record(9, 'EXTRACTION', 'OCR result creates candidate match against catalogue', passed, `Matched: "${detectedDoloItem?.matchedMedicineName}", Confidence: ${detectedDoloItem?.confidence}`);
    } catch (e) {
      record(9, 'EXTRACTION', 'OCR result creates candidate match against catalogue', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 10: No-match OCR does not invent medicine
    // ----------------------------------------------------
    try {
      const fd = new FormData();
      const buffer = fs.readFileSync(nonMedPngPath);
      fd.append('prescriptionImage', new Blob([buffer], { type: 'image/png' }), 'groceries.png');
      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient1Token}` },
        body: fd
      });
      const data = await res.json();
      const detected = data.prescription?.detectedMedicines || [];
      const falseMedicines = detected.filter(d => d.matchedMedicineId !== null);
      const passed = falseMedicines.length === 0;
      record(10, 'SAFETY', 'Non-medical image does not invent catalogue medicines', passed, `False matches: ${falseMedicines.length}, Raw OCR: "${data.prescription?.ocrRawText?.replace(/\n/g, ' ')}"`);
    } catch (e) {
      record(10, 'SAFETY', 'Non-medical image does not invent catalogue medicines', false, e.message);
    }

    // Find catalogue medicine ID for Dolo 650 for verification tests
    doloMedicineCatalogItem = await prisma.medicine.findFirst({
      where: { brandName: { contains: 'Dolo' } }
    });

    // ----------------------------------------------------
    // TEST 11: Patient can verify detected medicine
    // ----------------------------------------------------
    let verifyResultData = null;
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              id: detectedDoloItem?.id,
              matchedMedicineId: doloMedicineCatalogItem.id,
              matchedMedicineName: doloMedicineCatalogItem.brandName,
              quantity: 10,
              dosage: '1 tablet',
              frequency: 'Twice daily',
              duration: '5 days',
              isConfirmed: true
            }
          ]
        })
      });
      verifyResultData = await res.json();
      const passed = res.status === 200 && verifyResultData.success && verifyResultData.prescription?.status === 'VERIFIED';
      record(11, 'VERIFICATION', 'Patient explicitly verifies detected medicine (status -> VERIFIED)', passed, `Prescription status: ${verifyResultData.prescription?.status}`);
    } catch (e) {
      record(11, 'VERIFICATION', 'Patient explicitly verifies detected medicine', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 12: Patient can edit quantity
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              id: detectedDoloItem?.id,
              matchedMedicineId: doloMedicineCatalogItem.id,
              matchedMedicineName: doloMedicineCatalogItem.brandName,
              quantity: 24, // Explicit user edit
              dosage: '1 tablet',
              frequency: 'Twice daily',
              duration: '12 days',
              isConfirmed: true
            }
          ]
        })
      });
      const data = await res.json();
      const updatedItem = data.prescription?.detectedMedicines?.find(d => d.matchedMedicineId === doloMedicineCatalogItem.id);
      const passed = res.status === 200 && updatedItem?.quantity === 24;
      record(12, 'VERIFICATION', 'Patient can edit medicine quantity (persisted in DB)', passed, `Preserved Qty: ${updatedItem?.quantity}`);
    } catch (e) {
      record(12, 'VERIFICATION', 'Patient can edit medicine quantity', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 13: Patient can remove candidate
    // ----------------------------------------------------
    try {
      // Find another catalogue medicine for manual addition
      const crocinMed = await prisma.medicine.findFirst({
        where: { brandName: { contains: 'Crocin' } }
      });
      
      // Submit verification with Crocin, omitting Dolo (removing Dolo candidate)
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              matchedMedicineId: crocinMed.id,
              matchedMedicineName: crocinMed.brandName,
              quantity: 5,
              dosage: '1 tablet',
              frequency: 'Once daily',
              duration: '5 days',
              isConfirmed: true
            }
          ]
        })
      });
      const data = await res.json();
      const hasDolo = data.prescription?.detectedMedicines?.some(d => d.matchedMedicineId === doloMedicineCatalogItem.id);
      const hasCrocin = data.prescription?.detectedMedicines?.some(d => d.matchedMedicineId === crocinMed.id);
      const passed = res.status === 200 && !hasDolo && hasCrocin;
      record(13, 'VERIFICATION', 'Patient can remove candidate item (unselected item purged)', passed, `Dolo removed: ${!hasDolo}, Crocin added: ${hasCrocin}`);
    } catch (e) {
      record(13, 'VERIFICATION', 'Patient can remove candidate item', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 14: Patient can manually add catalogue medicine
    // ----------------------------------------------------
    try {
      const azithroMed = await prisma.medicine.findFirst({
        where: { brandName: { contains: 'Azithral' } }
      });
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              matchedMedicineId: azithroMed.id,
              matchedMedicineName: azithroMed.brandName,
              quantity: 3,
              dosage: '500mg',
              frequency: 'Once daily',
              duration: '3 days',
              isConfirmed: true
            }
          ]
        })
      });
      const data = await res.json();
      const addedItem = data.prescription?.detectedMedicines?.find(d => d.matchedMedicineId === azithroMed.id);
      const passed = res.status === 200 && !!addedItem;
      record(14, 'VERIFICATION', 'Patient can manually add catalogue medicine', passed, `Added: ${addedItem?.matchedMedicineName}, Qty: ${addedItem?.quantity}`);
    } catch (e) {
      record(14, 'VERIFICATION', 'Patient can manually add catalogue medicine', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 15: Invalid medicine ID -> rejected
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              matchedMedicineId: 'non-existent-fake-medicine-uuid-9999',
              matchedMedicineName: 'Fake Drug',
              quantity: 1
            }
          ]
        })
      });
      const data = await res.json();
      const passed = res.status === 400 && !data.success;
      record(15, 'VALIDATION', 'Invalid medicine ID is rejected with 400', passed, `HTTP status ${res.status}, Error: ${data.error}`);
    } catch (e) {
      record(15, 'VALIDATION', 'Invalid medicine ID is rejected', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 16: Invalid quantity -> rejected
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          items: [
            {
              matchedMedicineId: doloMedicineCatalogItem.id,
              quantity: -5 // Invalid negative quantity
            }
          ]
        })
      });
      const data = await res.json();
      const passed = res.status === 400 && !data.success;
      record(16, 'VALIDATION', 'Invalid quantity (<= 0 or non-integer) is rejected with 400', passed, `HTTP status ${res.status}, Error: ${data.error}`);
    } catch (e) {
      record(16, 'VALIDATION', 'Invalid quantity is rejected', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 17: Patient cannot access another patient's prescription (403)
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}`, {
        headers: { Authorization: `Bearer ${patient2Token}` }
      });
      const passed = res.status === 403;
      record(17, 'SECURITY', "Patient cannot access another patient's prescription (403)", passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(17, 'SECURITY', "Patient cannot access another patient's prescription", false, e.message);
    }

    // ----------------------------------------------------
    // TEST 18: Patient cannot access another patient's prescription image (403)
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/image`, {
        headers: { Authorization: `Bearer ${patient2Token}` }
      });
      const passed = res.status === 403;
      record(18, 'SECURITY', "Patient cannot access another patient's prescription image (403)", passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(18, 'SECURITY', "Patient cannot access another patient's prescription image", false, e.message);
    }

    // ----------------------------------------------------
    // TEST 19: Assistant cannot access prescription image (403)
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/image`, {
        headers: { Authorization: `Bearer ${assistantToken}` }
      });
      const passed = res.status === 403;
      record(19, 'SECURITY', 'Assistant is strictly forbidden from viewing prescription image (403)', passed, `HTTP status ${res.status}`);
    } catch (e) {
      record(19, 'SECURITY', 'Assistant is forbidden from viewing prescription image', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 20: Unverified prescription cannot create order
    // ----------------------------------------------------
    let unverifiedRxId = null;
    try {
      // Create an unverified prescription record
      const unverifiedRx = await prisma.prescription.create({
        data: {
          userId: patient1Id,
          originalFileName: 'pending_rx.jpg',
          filePath: 'uploads/prescriptions/dummy.jpg',
          status: 'VERIFICATION_REQUIRED' // Not verified yet!
        }
      });
      unverifiedRxId = unverifiedRx.id;

      // Attempt to place order using unverified prescription
      const pharmacy = await prisma.pharmacy.findFirst();
      const orderRes = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacy.id,
          prescriptionId: unverifiedRxId,
          items: [{ medicineId: doloMedicineCatalogItem.id, quantity: 1 }],
          orderType: 'RESERVATION'
        })
      });
      const orderData = await orderRes.json();
      const passed = orderRes.status === 400 && !orderData.success;
      record(20, 'SAFETY', 'Unverified prescription cannot create an order (400 rejected)', passed, `HTTP status ${orderRes.status}, Error: ${orderData.error}`);
    } catch (e) {
      record(20, 'SAFETY', 'Unverified prescription cannot create an order', false, e.message);
    }

    // Re-verify the verified prescription with Dolo 650 for remaining business tests
    await fetch(`${BASE_URL}/prescriptions/${verifiedPrescriptionId}/verify`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patient1Token}`
      },
      body: JSON.stringify({
        items: [
          {
            matchedMedicineId: doloMedicineCatalogItem.id,
            matchedMedicineName: doloMedicineCatalogItem.brandName,
            quantity: 2,
            dosage: '1 tablet',
            frequency: 'Twice daily',
            duration: '5 days',
            isConfirmed: true
          }
        ]
      })
    });

    // ----------------------------------------------------
    // TEST 21: Existing verified prescription/order workflow still works
    // ----------------------------------------------------
    let placedOrder = null;
    try {
      const pharmUser = await prisma.user.findUnique({
        where: { email: 'pharmacist1@medifind.com' },
        include: { pharmacy: true }
      });
      const pharmacy = pharmUser.pharmacy;
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient1Token}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacy.id,
          prescriptionId: verifiedPrescriptionId,
          items: [{ medicineId: doloMedicineCatalogItem.id, quantity: 2 }],
          orderType: 'RESERVATION'
        })
      });
      const data = await res.json();
      placedOrder = data.order;
      const passed = res.status === 201 && data.success && !!placedOrder?.verificationPin;
      record(21, 'WORKFLOW', 'Verified prescription successfully creates order reservation', passed, `Order: ${placedOrder?.orderNumber}, PIN: ${placedOrder?.verificationPin}`);
    } catch (e) {
      record(21, 'WORKFLOW', 'Verified prescription successfully creates order reservation', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 22: Existing stock reservation still works
    // ----------------------------------------------------
    try {
      const orderInDb = await prisma.order.findUnique({
        where: { id: placedOrder.id },
        include: { items: true }
      });
      const passed = orderInDb?.status === 'PENDING' && orderInDb?.items?.length > 0;
      record(22, 'WORKFLOW', 'Stock reservation record properly established in database', passed, `Order items count: ${orderInDb?.items?.length}`);
    } catch (e) {
      record(22, 'WORKFLOW', 'Stock reservation record properly established', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 23: Existing PIN workflow still works
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/orders/${placedOrder.id}/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({ pin: placedOrder.verificationPin })
      });
      const data = await res.json();
      const passed = res.status === 200 && data.success && data.order?.status === 'COMPLETED';
      record(23, 'WORKFLOW', 'Pharmacist counter handover PIN verification completes order', passed, `Order status: ${data.order?.status}`);
    } catch (e) {
      record(23, 'WORKFLOW', 'Pharmacist counter handover PIN verification completes order', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 24: Existing assistant workflow still works
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/assistant/available`, {
        headers: { Authorization: `Bearer ${assistantToken}` }
      });
      const data = await res.json();
      const passed = res.status === 200 && data.success && Array.isArray(data.tasks);
      record(24, 'WORKFLOW', 'Assistant task management endpoint remains functional', passed, `Available tasks: ${data.tasks?.length}`);
    } catch (e) {
      record(24, 'WORKFLOW', 'Assistant task management endpoint remains functional', false, e.message);
    }

    // ----------------------------------------------------
    // TEST 25: Existing emergency workflow still works
    // ----------------------------------------------------
    try {
      const res = await fetch(`${BASE_URL}/medicines/emergency`);
      const data = await res.json();
      const passed = res.status === 200 && data.success && data.medicines?.length > 0;
      record(25, 'WORKFLOW', 'Emergency medicines discovery endpoint remains functional', passed, `Emergency medicines count: ${data.medicines?.length}`);
    } catch (e) {
      record(25, 'WORKFLOW', 'Emergency medicines discovery endpoint remains functional', false, e.message);
    }

  } finally {
    // ── Cleanup Test Records ───────────────────────────────────────────────────
    console.log('\n🧹 Cleaning up test generated records...');
    try {
      if (unverifiedRxId) {
        await prisma.prescription.delete({ where: { id: unverifiedRxId } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: patient2Id } }).catch(() => {});

      // Clean test image files
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('\n=======================================================');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  console.log(`🏁 PHASE 2 TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED out of ${results.length} total tests.`);
  console.log('=======================================================\n');

  return { passCount, failCount, results };
}

runPhase2Tests()
  .then(({ failCount }) => {
    if (failCount > 0) process.exit(1);
    else process.exit(0);
  })
  .catch(err => {
    console.error('Test suite runtime error:', err);
    process.exit(1);
  });
