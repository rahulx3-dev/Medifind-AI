/**
 * MEDIFIND AI — PRESCRIPTION DOCUMENT INTEGRITY & AUTHENTICITY SCREENING TEST SUITE
 * 
 * Verifies all 16 minimum requirements specified in Section 11 of the feature specification:
 * 1. Authenticated patient can screen own prescription
 * 2. Patient cannot screen another patient's prescription (403)
 * 3. Unauthenticated request rejected (401)
 * 4. Pharmacist authorization follows existing access rules (linked order check)
 * 5. Assistant cannot access prescription screening details (403)
 * 6. Clear synthetic prescription image produces expected non-suspicious screening result
 * 7. Very poor image produces unable-to-assess/review result
 * 8. Low OCR confidence produces review result
 * 9. Missing optional document information does not automatically mean fake
 * 10. Multiple warning indicators produce manual review / suspicious result
 * 11. No definitive "fake" certification is generated
 * 12. No definitive authenticity certification is generated
 * 13. Screening result does not modify prescription verification automatically
 * 14. Existing OCR workflow still passes
 * 15. Existing prescription verification still passes
 * 16. Duplicate / reused document check produces review indicator
 * 17. Assistant cannot access prescription details via getOrderById
 */

const fs = require('fs');
const path = require('path');
const { Jimp, loadFont } = require('jimp');
const { SANS_32_BLACK } = require('jimp/fonts');
const prisma = require('./src/prisma');
const {
  screenPrescriptionDocument,
  computeFileHash,
  assessImageQuality,
  assessOCRReadability,
  assessDocumentStructure,
  assessVisualIntegrity,
  assessSubmissionHistory
} = require('./src/utils/documentScreeningEngine');

const BASE_URL = 'http://localhost:5000/api';

async function runScreeningTests() {
  console.log('🔬 ===================================================================');
  console.log('🔬 MEDIFIND AI — PRESCRIPTION DOCUMENT INTEGRITY SCREENING TEST SUITE');
  console.log('🔬 ===================================================================\n');

  const results = [];
  function record(testId, title, passed, details) {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testId, title, status, details });
    console.log(`${passed ? '✅' : '❌'} [${testId}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  try {
    // ── 1. Authenticate Users ────────────────────────────────────────────────
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

    // Patient 2 (Isolated)
    const p2Email = `patient2_scr_${Date.now()}@medifind.com`;
    const p2Res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Isolated Patient',
        email: p2Email,
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    const p2Data = await p2Res.json();
    const patient2Token = p2Data.token;
    const patient2Id = p2Data.user.id;

    // Pharmacist
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

    // Admin
    const adminRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@medifind.com', password: 'password123' })
    });
    const adminData = await adminRes.json();
    const adminToken = adminData.token;

    console.log('🔑 Authentication completed.\n');

    // ── 2. Create Synthetic Test Fixtures ─────────────────────────────────────
    console.log('🎨 Generating synthetic test image fixtures...');
    const font = await loadFont(SANS_32_BLACK);
    const tmpDir = path.join(__dirname, 'test_fixtures_screening');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    // A. Clear Synthetic Prescription (Good quality, Dr header, Patient, Date, Rx)
    const clearImg = new Jimp({ width: 800, height: 500, color: 0xffffffff });
    clearImg.print({ font, x: 40, y: 40, text: 'CITY CLINIC - Dr. Alok Verma, MD' });
    clearImg.print({ font, x: 40, y: 110, text: 'Patient: Rohan Sharma | Date: 12-09-2026' });
    clearImg.print({ font, x: 40, y: 180, text: 'Rx: Dolo 650 - 1 tab SOS' });
    clearImg.print({ font, x: 40, y: 250, text: 'Augmentin 625 - 1 tab twice daily x 5 days' });
    clearImg.print({ font, x: 40, y: 340, text: 'Signature: Dr. A. Verma' });
    const clearImgPath = path.join(tmpDir, 'clear_synthetic_rx.png');
    await clearImg.write(clearImgPath);

    // B. Degraded / Tiny Image (100x60 px) -> Extreme Low Resolution
    const tinyImg = new Jimp({ width: 100, height: 60, color: 0x111111ff });
    const tinyImgPath = path.join(tmpDir, 'tiny_degraded_rx.png');
    await tinyImg.write(tinyImgPath);

    // C. Reusable Document for Hash Duplicate Test
    const dupImg = new Jimp({ width: 600, height: 400, color: 0xfdfdfdff });
    dupImg.print({ font, x: 30, y: 40, text: 'APOLLO CLINIC - Dr. K. S. Nair' });
    dupImg.print({ font, x: 30, y: 120, text: 'Rx: Glycomet 500 SR - 1 tab twice daily' });
    const dupImgPath = path.join(tmpDir, 'duplicate_test_rx.png');
    await dupImg.write(dupImgPath);

    // D. Engine-only Test Image (NEVER uploaded via API — used for direct engine unit tests)
    //    Unique color 0xf5f0e8ff ensures distinct hash from clearImg/dupImg
    const engineTestImg = new Jimp({ width: 800, height: 500, color: 0xf5f0e8ff });
    engineTestImg.print({ font, x: 40, y: 40, text: 'MEDICITY HOSPITAL - Dr. Priya Menon, MBBS' });
    engineTestImg.print({ font, x: 40, y: 110, text: 'Patient: Test Patient | Date: 01-01-2027' });
    engineTestImg.print({ font, x: 40, y: 180, text: 'Rx: Paracetamol 500mg - 1 tab TDS' });
    engineTestImg.print({ font, x: 40, y: 250, text: 'Cetirizine 10mg - 1 tab at night x 5 days' });
    engineTestImg.print({ font, x: 40, y: 340, text: 'Signature: Dr. P. Menon' });
    const engineTestImgPath = path.join(tmpDir, `engine_unit_test_rx_${Date.now()}.png`);
    await engineTestImg.write(engineTestImgPath);

    console.log('🎨 Synthetic fixtures ready.\n');

    // ── Helper: Upload Image Prescription ────────────────────────────────────
    async function uploadImageFile(filePath, token) {
      const boundary = `----WebKitFormBoundary${Date.now()}`;
      const fileContent = fs.readFileSync(filePath);
      const filename = path.basename(filePath);

      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="prescriptionImage"; filename="${filename}"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payload = Buffer.concat([header, fileContent, footer]);

      const res = await fetch(`${BASE_URL}/prescriptions/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: payload
      });
      return { status: res.status, data: await res.json() };
    }

    // ── TEST 1: Authenticated patient can screen own prescription ─────────────
    console.log('--- TEST GROUP 1: API & ACCESS CONTROL ---');
    // Upload a clear prescription for Patient 1
    const up1 = await uploadImageFile(clearImgPath, patient1Token);
    const p1RxId = up1.data.prescription ? up1.data.prescription.id : null;

    if (!p1RxId) {
      throw new Error(`Failed to upload test prescription: ${JSON.stringify(up1.data)}`);
    }

    // Call POST /api/prescriptions/:id/screen-integrity
    const screenRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const screenData = await screenRes.json();

    const t1Passed = screenRes.status === 200 &&
      screenData.success === true &&
      Array.isArray(screenData.checks) &&
      screenData.status !== undefined &&
      screenData.disclaimer !== undefined;
    record('T01', 'Authenticated patient can screen own prescription', t1Passed,
      `Status: ${screenRes.status}, ScreeningStatus: ${screenData.status}, Checks count: ${screenData.checks?.length}`);

    // Also verify GET /api/prescriptions/:id/screen-integrity
    const getScreenRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const getScreenData = await getScreenRes.json();
    const t1bPassed = getScreenRes.status === 200 && getScreenData.status === screenData.status;
    record('T01b', 'GET endpoint retrieves cached screening result', t1bPassed,
      `Status: ${getScreenRes.status}, MatchingStatus: ${getScreenData.status}`);

    // ── TEST 2: Patient cannot screen another patient's prescription ──────────
    const crossPatientRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patient2Token}` }
    });
    const crossPatientData = await crossPatientRes.json();
    const t2Passed = crossPatientRes.status === 403 && crossPatientData.success === false;
    record('T02', "Patient cannot screen another patient's prescription (403)", t2Passed,
      `HTTP status: ${crossPatientRes.status}, Error: ${crossPatientData.error}`);

    // ── TEST 3: Unauthenticated request rejected ──────────────────────────────
    const unauthRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'POST'
    });
    const t3Passed = unauthRes.status === 401;
    record('T03', 'Unauthenticated request rejected with 401', t3Passed,
      `HTTP status: ${unauthRes.status}`);

    // ── TEST 4: Pharmacist authorization follows existing access rules ────────
    // Without a linked order, pharmacist access is rejected (403)
    const pharmNoOrderRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pharmacistToken}` }
    });
    const pharmNoOrderData = await pharmNoOrderRes.json();
    const t4Passed = pharmNoOrderRes.status === 403;
    record('T04', 'Pharmacist denied when prescription is unlinked to pharmacy orders (403)', t4Passed,
      `HTTP status: ${pharmNoOrderRes.status}`);

    // ── TEST 5: Assistant cannot access prescription screening details ────────
    const asstScreenRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}/screen-integrity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const asstScreenData = await asstScreenRes.json();
    const t5Passed = asstScreenRes.status === 403 && asstScreenData.success === false;
    record('T05', 'Assistant denied from accessing prescription screening (403)', t5Passed,
      `HTTP status: ${asstScreenRes.status}, Error: ${asstScreenData.error}`);

    // Assistant also denied from GET /api/prescriptions/:id
    const asstGetRxRes = await fetch(`${BASE_URL}/prescriptions/${p1RxId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const t5bPassed = asstGetRxRes.status === 403;
    record('T05b', 'Assistant denied from GET prescription record (403)', t5bPassed,
      `HTTP status: ${asstGetRxRes.status}`);

    // ── TEST 6: Clear synthetic prescription image produces non-suspicious result
    // NOTE: Uses engineTestImgPath (not clearImgPath) — it has a unique hash that was
    //       never uploaded via API, so SUBMISSION_HISTORY check correctly returns PASS.
    console.log('\n--- TEST GROUP 2: SCREENING ENGINE ACCURACY & LOGIC ---');
    const clearScreening = await screenPrescriptionDocument({
      prescriptionId: null, // No DB update for engine unit tests
      filePath: engineTestImgPath,
      ocrText: 'MEDICITY HOSPITAL Dr. Priya Menon, MBBS\nPatient: Test Patient | Date: 01-01-2027\nRx: Paracetamol 500mg - 1 tab TDS\nCetirizine 10mg - 1 tab at night x 5 days\nSignature: Dr. P. Menon',
      ocrConfidence: 94,
      detectedMedicines: [
        { matchedMedicineId: 'med-para', matchedMedicineName: 'Paracetamol 500mg' },
        { matchedMedicineId: 'med-cet', matchedMedicineName: 'Cetirizine 10mg' }
      ],
      userId: 'test-user-1'
    });

    const t6Passed = clearScreening.status === 'NO_OBVIOUS_ISSUES' &&
      clearScreening.requiresManualReview === false &&
      clearScreening.checks.every(c => c.status === 'PASS');
    record('T06', 'Clear synthetic prescription produces NO_OBVIOUS_ISSUES', t6Passed,
      `Status: ${clearScreening.status}, requiresManualReview: ${clearScreening.requiresManualReview}`);

    // ── TEST 7: Very poor image produces unable-to-assess result ───────────────
    const poorImgQuality = await assessImageQuality(tinyImgPath);
    const poorScreening = await screenPrescriptionDocument({
      prescriptionId: null, // Engine unit test: no DB update
      filePath: tinyImgPath,
      ocrText: '',
      ocrConfidence: 0,
      detectedMedicines: [],
      userId: 'test-user-2'
    });

    const t7Passed = poorImgQuality.status === 'UNABLE_TO_ASSESS' &&
      poorScreening.status === 'UNABLE_TO_ASSESS' &&
      poorScreening.requiresManualReview === true;
    record('T07', 'Very poor image produces UNABLE_TO_ASSESS result', t7Passed,
      `QualityCheck: ${poorImgQuality.status}, MasterStatus: ${poorScreening.status}`);

    // ── TEST 8: Low OCR confidence produces review result ─────────────────────
    const lowOcrReadability = assessOCRReadability('tab dolo ?? 5 mg', 35);
    const lowOcrScreening = await screenPrescriptionDocument({
      prescriptionId: null, // Engine unit test: no DB update
      filePath: engineTestImgPath,
      ocrText: 'tab dolo ?? 5 mg',
      ocrConfidence: 35,
      detectedMedicines: [{ matchedMedicineId: 'med-dolo', matchedMedicineName: 'Dolo 650' }],
      userId: 'test-user-3'
    });

    const t8Passed = lowOcrReadability.status === 'REVIEW' &&
      lowOcrScreening.status === 'NEEDS_MANUAL_REVIEW' &&
      lowOcrScreening.requiresManualReview === true;
    record('T08', 'Low OCR confidence produces NEEDS_MANUAL_REVIEW result', t8Passed,
      `ReadabilityCheck: ${lowOcrReadability.status}, MasterStatus: ${lowOcrScreening.status}`);

    // ── TEST 9: Missing optional document info does NOT mean fake ──────────────
    // Has medicines directives but lacks Doctor header and Date
    const partialDocStructure = assessDocumentStructure('Rx: Dolo 650 1 tab twice daily', [
      { matchedMedicineId: 'med-dolo', matchedMedicineName: 'Dolo 650' }
    ]);
    const partialScreening = await screenPrescriptionDocument({
      prescriptionId: null, // Engine unit test: no DB update
      filePath: engineTestImgPath,
      ocrText: 'Rx: Dolo 650 1 tab twice daily',
      ocrConfidence: 85,
      detectedMedicines: [{ matchedMedicineId: 'med-dolo', matchedMedicineName: 'Dolo 650' }],
      userId: 'test-user-4'
    });

    const t9Passed = partialDocStructure.status === 'REVIEW' &&
      partialScreening.status === 'NEEDS_MANUAL_REVIEW' &&
      partialScreening.status !== 'POTENTIALLY_SUSPICIOUS' &&
      !JSON.stringify(partialScreening).toLowerCase().includes('fake');
    record('T09', 'Missing optional document info results in NEEDS_MANUAL_REVIEW (not fake)', t9Passed,
      `StructureCheck: ${partialDocStructure.status}, MasterStatus: ${partialScreening.status}`);

    // ── TEST 10: Multiple GENERIC warnings do NOT produce POTENTIALLY_SUSPICIOUS ─
    // Scenario: noisy OCR (symbol-heavy) + no medicine structure + low confidence.
    // These are quality/readability problems, NOT integrity indicators.
    // Correct result: NEEDS_MANUAL_REVIEW (never POTENTIALLY_SUSPICIOUS).
    const multiWarnScreening = await screenPrescriptionDocument({
      prescriptionId: null, // Engine unit test: no DB update
      filePath: engineTestImgPath,
      ocrText: '##!! @@## $$%% &&** ?? random receipt text without medical terms',
      ocrConfidence: 20,
      detectedMedicines: [],
      userId: 'test-user-5'
    });

    const t10Passed = multiWarnScreening.status !== 'POTENTIALLY_SUSPICIOUS' &&
      multiWarnScreening.requiresManualReview === true &&
      (multiWarnScreening.status === 'NEEDS_MANUAL_REVIEW' || multiWarnScreening.status === 'UNABLE_TO_ASSESS');
    record('T10', 'Multiple generic quality/readability warnings do NOT produce POTENTIALLY_SUSPICIOUS', t10Passed,
      `MasterStatus: ${multiWarnScreening.status}, Warnings: ${multiWarnScreening.checks.filter(c => c.status === 'WARNING').length}`);

    // ── TEST 10a: Duplicate upload alone produces NEEDS_MANUAL_REVIEW (not POTENTIALLY_SUSPICIOUS) ─
    // The engine's SUBMISSION_HISTORY=REVIEW should only contribute to NEEDS_MANUAL_REVIEW.
    // A legitimate patient re-uploading the same document must not be flagged as suspicious.
    const dupAloneScreening = await screenPrescriptionDocument({
      prescriptionId: null,
      filePath: clearImgPath, // clearImgPath WAS uploaded via API in T01 → hash exists in DB
      ocrText: 'CITY CLINIC Dr. Alok Verma, MD\nPatient: Rohan Sharma | Date: 12-09-2026\nRx: Dolo 650 - 1 tab SOS\nAugmentin 625 - 1 tab twice daily\nSignature: Dr. A. Verma',
      ocrConfidence: 92,
      detectedMedicines: [
        { matchedMedicineId: 'med-dolo', matchedMedicineName: 'Dolo 650' },
        { matchedMedicineId: 'med-aug', matchedMedicineName: 'Augmentin 625' }
      ],
      userId: 'test-user-dup'
    });
    const dupHistoryCheck = dupAloneScreening.checks.find(c => c.name === 'SUBMISSION_HISTORY');
    const t10aPassed = dupAloneScreening.status !== 'POTENTIALLY_SUSPICIOUS' &&
      dupAloneScreening.status === 'NEEDS_MANUAL_REVIEW' &&
      dupHistoryCheck?.status === 'REVIEW' &&
      dupHistoryCheck?.details?.duplicateDetected === true;
    record('T10a', 'Duplicate upload alone produces NEEDS_MANUAL_REVIEW (not POTENTIALLY_SUSPICIOUS)', t10aPassed,
      `MasterStatus: ${dupAloneScreening.status}, HistoryCheck: ${dupHistoryCheck?.status}`);

    // ── TEST 10b: Meaningful integrity indicator produces POTENTIALLY_SUSPICIOUS ─
    // A file whose header contains editing software references (e.g. Photoshop)
    // represents a meaningful document-integrity inconsistency.
    const baseEngineBuf = fs.readFileSync(engineTestImgPath);
    const keyword = Buffer.from('Software\0Adobe Photoshop');
    const chunkLen = Buffer.alloc(4);
    chunkLen.writeUInt32BE(keyword.length, 0);
    const chunkType = Buffer.from('tEXt');
    const crc32Calc = (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32Calc(Buffer.concat([chunkType, keyword])), 0);
    const textChunk = Buffer.concat([chunkLen, chunkType, keyword, crcBuf]);
    const editedSyntheticImgPath = path.join(tmpDir, `edited_synthetic_rx_${Date.now()}.png`);
    fs.writeFileSync(editedSyntheticImgPath, Buffer.concat([baseEngineBuf.subarray(0, 33), textChunk, baseEngineBuf.subarray(33)]));

    const integrityScreening = await screenPrescriptionDocument({
      prescriptionId: null,
      filePath: editedSyntheticImgPath,
      ocrText: 'MEDICITY HOSPITAL Dr. Priya Menon, MBBS\nPatient: Test Patient | Date: 01-01-2027\nRx: Paracetamol 500mg - 1 tab TDS\nSignature: Dr. P. Menon',
      ocrConfidence: 94,
      detectedMedicines: [{ matchedMedicineId: 'med-para', matchedMedicineName: 'Paracetamol 500mg' }],
      userId: 'test-user-integrity-flag'
    });

    const integrityCheck = integrityScreening.checks.find(c => c.name === 'VISUAL_INTEGRITY');
    const t10bPassed = integrityScreening.status === 'POTENTIALLY_SUSPICIOUS' &&
      integrityScreening.requiresManualReview === true &&
      integrityCheck?.status === 'WARNING' &&
      integrityScreening.summary.includes('Potential document inconsistencies detected');
    record('T10b', 'Meaningful integrity indicator produces POTENTIALLY_SUSPICIOUS', t10bPassed,
      `MasterStatus: ${integrityScreening.status}, VisualCheck: ${integrityCheck?.status}, Summary: ${integrityScreening.summary}`);

    // ── TEST 10c: Multiple generic warnings do NOT produce POTENTIALLY_SUSPICIOUS ─
    // Scenario: duplicate submission + missing optional info + low OCR confidence + weak document structure.
    // 4 distinct generic review/warning signals with ZERO integrity flags.
    // Must result in NEEDS_MANUAL_REVIEW, NEVER POTENTIALLY_SUSPICIOUS.
    const multiGenericScreening = await screenPrescriptionDocument({
      prescriptionId: null,
      filePath: clearImgPath, // Duplicate file hash (SUBMISSION_HISTORY = REVIEW)
      ocrText: 'tab dolo ?? 5 mg', // Low confidence, missing doctor header, missing date
      ocrConfidence: 35,
      detectedMedicines: [{ matchedMedicineId: 'med-dolo', matchedMedicineName: 'Dolo 650' }],
      userId: 'test-user-multi-generic'
    });

    const genericHistory = multiGenericScreening.checks.find(c => c.name === 'SUBMISSION_HISTORY');
    const genericStructure = multiGenericScreening.checks.find(c => c.name === 'DOCUMENT_STRUCTURE');
    const genericReadability = multiGenericScreening.checks.find(c => c.name === 'OCR_READABILITY');
    const nonPassChecksCount = multiGenericScreening.checks.filter(c => c.status !== 'PASS').length;

    const t10cPassed = multiGenericScreening.status === 'NEEDS_MANUAL_REVIEW' &&
      multiGenericScreening.status !== 'POTENTIALLY_SUSPICIOUS' &&
      genericHistory?.status === 'REVIEW' &&
      genericReadability?.status === 'REVIEW' &&
      genericStructure?.status === 'REVIEW' &&
      nonPassChecksCount >= 3;
    record('T10c', 'Multiple generic warnings (duplicate + low OCR + missing info) stay NEEDS_MANUAL_REVIEW', t10cPassed,
      `MasterStatus: ${multiGenericScreening.status}, NonPassChecks: ${nonPassChecksCount}, NotSuspicious: ${multiGenericScreening.status !== 'POTENTIALLY_SUSPICIOUS'}`);

    // ── TEST 10d: Duplicate upload does not independently contribute to fraud or suspicion ─
    // Verifies that a duplicate upload by a patient is treated as an intended re-order/retry,
    // only producing a manual review signal without preventing workflow or labeling fraud.
    const expLower = (genericHistory?.explanation || '').toLowerCase();
    const t10dPassed = genericHistory?.details?.duplicateDetected === true &&
      expLower.includes('previously submitted') &&
      !expLower.includes('fraud') &&
      !expLower.includes('fake') &&
      multiGenericScreening.status !== 'POTENTIALLY_SUSPICIOUS';
    record('T10d', 'Duplicate upload does not independently contribute to fraud or suspicion', t10dPassed,
      `DuplicateDetected: ${genericHistory?.details?.duplicateDetected}, ExplanationSafe: true`);

    // ── TEST 11: No definitive "fake" certification is generated ──────────────
    const allScreeningJson = JSON.stringify([
      clearScreening,
      poorScreening,
      lowOcrScreening,
      partialScreening,
      multiWarnScreening,
      dupAloneScreening
    ]);
    const hasDefinitiveFake = /\b(fake|forgery|fraudulent prescription|counterfeit prescription|forgery detected)\b/i.test(allScreeningJson);
    record('T11', 'No definitive "fake" certification is generated in any output', !hasDefinitiveFake,
      `Checked 6 distinct screening scenarios for forbidden fake accusations`);

    // ── TEST 12: No definitive authenticity certification is generated ────────
    const hasDefinitiveAuth = /\b(100% valid|100% genuine|certified authentic|verified genuine)\b/i.test(allScreeningJson);
    const hasMandatoryDisclaimer = clearScreening.disclaimer &&
      clearScreening.disclaimer.includes('Automated screening cannot confirm authenticity');
    const t12Passed = !hasDefinitiveAuth && hasMandatoryDisclaimer;
    record('T12', 'No definitive authenticity certification generated & disclaimer present', t12Passed,
      `Mandatory disclaimer: present=${hasMandatoryDisclaimer}`);

    // ── TEST 13: Screening does not automatically modify prescription verification
    console.log('\n--- TEST GROUP 3: WORKFLOW INTEGRATION & SAFETY ---');
    const rxAfterScreen = await prisma.prescription.findUnique({ where: { id: p1RxId } });
    const t13Passed = rxAfterScreen.status === 'VERIFICATION_REQUIRED';
    record('T13', 'Prescription status remains VERIFICATION_REQUIRED after screening', t13Passed,
      `DB Prescription.status: ${rxAfterScreen.status}, screeningStatus: ${rxAfterScreen.screeningStatus}`);

    // ── TEST 14: Existing OCR upload workflow still passes ─────────────────────
    // Upload academic sample to test sample OCR pipeline
    const sampleUploadRes = await fetch(`${BASE_URL}/prescriptions/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patient1Token}`
      },
      body: JSON.stringify({ sampleId: 'sample-fever-bronchitis' })
    });
    const sampleUploadData = await sampleUploadRes.json();
    const t14Passed = sampleUploadRes.status === 201 &&
      sampleUploadData.success === true &&
      sampleUploadData.prescription.detectedMedicines.length > 0 &&
      sampleUploadData.screening !== undefined;
    record('T14', 'Existing sample upload & OCR workflow succeeds with screening attached', t14Passed,
      `Status: ${sampleUploadRes.status}, Candidates: ${sampleUploadData.candidateCount}, Screening: ${sampleUploadData.screening?.status}`);

    // ── TEST 15: Existing prescription verification still passes ───────────────
    // Verify detected medicines on the sample prescription
    const sampleRxId = sampleUploadData.prescription.id;
    const detectedToConfirm = sampleUploadData.prescription.detectedMedicines.filter(d => d.matchedMedicineId);

    const verifyRes = await fetch(`${BASE_URL}/prescriptions/${sampleRxId}/verify`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patient1Token}`
      },
      body: JSON.stringify({
        items: detectedToConfirm.map(d => ({
          id: d.id,
          matchedMedicineId: d.matchedMedicineId,
          matchedMedicineName: d.matchedMedicineName,
          quantity: 2,
          dosage: d.dosage || '1 tab',
          frequency: d.frequency || 'Twice daily',
          duration: d.duration || '5 days',
          isConfirmed: true
        }))
      })
    });
    const verifyData = await verifyRes.json();
    const t15Passed = verifyRes.status === 200 &&
      verifyData.success === true &&
      verifyData.prescription.status === 'VERIFIED';
    record('T15', 'Existing patient verification transition to VERIFIED still passes', t15Passed,
      `HTTP status: ${verifyRes.status}, Final Rx Status: ${verifyData.prescription?.status}`);

    // ── TEST 16: Duplicate / Reused document check produces review indicator ───
    // Upload dupImg first time
    const dup1 = await uploadImageFile(dupImgPath, patient1Token);
    const dupRxId1 = dup1.data.prescription.id;

    // Upload identical dupImg second time under same patient
    const dup2 = await uploadImageFile(dupImgPath, patient1Token);
    const dupRxId2 = dup2.data.prescription.id;

    const dupScreenData = dup2.data.screening;
    const historyCheck = dupScreenData?.checks?.find(c => c.name === 'SUBMISSION_HISTORY');

    const t16Passed = historyCheck &&
      historyCheck.status === 'REVIEW' &&
      historyCheck.details?.duplicateDetected === true &&
      dupScreenData.status === 'NEEDS_MANUAL_REVIEW';
    record('T16', 'Duplicate document upload triggers SUBMISSION_HISTORY REVIEW indicator', t16Passed,
      `HistoryStatus: ${historyCheck?.status}, DuplicateDetected: ${historyCheck?.details?.duplicateDetected}`);

    // ── TEST 17: Assistant insulated from prescription details in getOrderById ──
    console.log('\n--- TEST GROUP 4: PRIVACY & INSULATION ---');
    // Create an order referencing the verified prescription
    const pharmacy = await prisma.pharmacy.findFirst();
    const medicine = await prisma.medicine.findFirst();

    const orderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patient1Token}`
      },
      body: JSON.stringify({
        pharmacyId: pharmacy.id,
        items: [{ medicineId: medicine.id, quantity: 1 }],
        prescriptionId: sampleRxId,
        orderType: 'RESERVATION'
      })
    });
    const orderData = await orderRes.json();
    const testOrderId = orderData.order?.id;

    // Assign order to assistant task for delivery
    const assistant = await prisma.user.findFirst({ where: { role: 'ASSISTANT' } });
    if (testOrderId && assistant) {
      await prisma.assistantTask.create({
        data: {
          orderId: testOrderId,
          assistantId: assistant.id,
          status: 'AVAILABLE',
          deliveryAddress: '123 Test Street, Mumbai, Maharashtra 400001'
        }
      });
    }

    // Patient views order: should see prescription & screening
    const patientOrderRes = await fetch(`${BASE_URL}/orders/${testOrderId}`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const patientOrderData = await patientOrderRes.json();
    const patientHasRx = !!patientOrderData.order?.prescription;

    // Assistant views order: should NOT see prescriptionId or prescription
    const asstOrderRes = await fetch(`${BASE_URL}/orders/${testOrderId}`, {
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const asstOrderData = await asstOrderRes.json();
    const asstHasNoRx = asstOrderData.order?.prescription === undefined &&
      asstOrderData.order?.prescriptionId === undefined;

    const t17Passed = patientHasRx && asstHasNoRx;
    record('T17', 'Assistant insulated from prescription & screening in order details', t17Passed,
      `Patient sees Rx: ${patientHasRx}, Assistant blocked from Rx: ${asstHasNoRx}`);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n===================================================================');
    const passedCount = results.filter(r => r.status === 'PASS').length;
    const totalCount = results.length;
    console.log(`📊 SCREENING TEST RESULTS: ${passedCount}/${totalCount} PASSED`);
    console.log('===================================================================\n');

    results.forEach(r => {
      if (r.status === 'FAIL') {
        console.error(`  ❌ FAILED: [${r.testId}] ${r.title}`);
        console.error(`     └─ ${r.details}`);
      }
    });

    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite execution failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runScreeningTests();
