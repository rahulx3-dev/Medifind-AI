/**
 * MediFind AI — Phase 6.1E.3 Test Suite
 * Local PaddleOCR Runtime Compatibility, Live Engine Execution & End-to-End Hardening
 *
 * Verifies:
 *  1. Python executable resolves to dedicated venv (or configured PYTHON_EXECUTABLE)
 *  2. PaddlePaddle imports cleanly without fatal C++ errors
 *  3. PaddleOCR imports cleanly in local environment
 *  4. Model initialization succeeds on CPU
 *  5. Actual image fixture loads without I/O or decode errors
 *  6. Actual OCR produces non-empty text regions
 *  7. Dolo 650 fixture produces actual catalogue candidate with HIGH_CONFIDENCE
 *  8. Layout processing segments document regions
 *  9. Header separation excludes clinic/doctor info from medicine candidates
 * 10. Multi-medicine prescription extracts multiple distinct medicine candidates
 * 11. Unknown medicine input is safely flagged as NOT_IN_CATALOGUE
 * 12. Unreadable / blank image handled safely without crashing
 * 13. Node → Python bridge executes and parses output cleanly
 * 14. Timeout guard terminates hung workers reliably
 * 15. Malformed JSON output is safely rejected with descriptive error
 * 16. Tesseract is never invoked automatically
 * 17. 50-medicine catalogue sync check passes
 * 18. Patient verification remains mandatory (isConfirmed=false, status=VERIFICATION_REQUIRED)
 * 19. Document screening integration remains functional
 * 20. End-to-end performance metrics recorded (preprocessing, layout, OCR latency)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { executePythonOCRWorker, getPythonExecutable } = require('./src/utils/pythonOcrBridge');
const { runOCR } = require('./src/utils/ocrEngine');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DOLO_FIXTURE = path.join(__dirname, 'test_fixtures/test_prescription_dolo.jpg');
const MULTI_FIXTURE = path.join(__dirname, 'uploads/prescriptions/synthetic_rx_1.png');
const BLANK_FIXTURE = path.join(__dirname, 'test_fixtures/blank_white.jpg');
const NON_MED_FIXTURE = path.join(__dirname, 'test_fixtures/test_non_medical_list.png');
const CATALOG_PATH = path.join(__dirname, 'ocr/catalog_50.json');

let passedTests = 0;
let failedTests = 0;

function report(testNum, title, passed, detail = '') {
  if (passed) {
    passedTests++;
    console.log(`✅ Test #${testNum}: ${title}`);
    if (detail) console.log(`   └─ ${detail}`);
  } else {
    failedTests++;
    console.error(`❌ Test #${testNum}: ${title}`);
    if (detail) console.error(`   └─ ${detail}`);
  }
}

async function runAllTests() {
  console.log('=========================================================================');
  console.log('  MediFind AI — Phase 6.1E.3: Local PaddleOCR Runtime & Verification');
  console.log('=========================================================================\n');

  const resolvedPy = getPythonExecutable();
  console.log(`[Config] Resolved Python Executable: ${resolvedPy}`);

  // ── Test 1: Python executable resolves correctly ───────────────────────────
  try {
    const exists = fs.existsSync(resolvedPy);
    report(
      1,
      'Python executable resolves correctly',
      exists && resolvedPy.toLowerCase().includes('.venv'),
      `Path: ${resolvedPy} (exists: ${exists})`
    );
  } catch (err) {
    report(1, 'Python executable resolves correctly', false, err.message);
  }

  // ── Test 2: PaddlePaddle imports cleanly ────────────────────────────────────
  try {
    const checkPP = spawnSync(resolvedPy, ['-c', 'import paddle; print("PADDLE_VER:", paddle.__version__)'], {
      encoding: 'utf-8',
      timeout: 15000
    });
    const stdout = checkPP.stdout || '';
    const isOk = checkPP.status === 0 && stdout.includes('PADDLE_VER:');
    report(
      2,
      'PaddlePaddle imports cleanly in selected Python environment',
      isOk,
      `Output: ${stdout.trim() || checkPP.stderr.trim()}`
    );
  } catch (err) {
    report(2, 'PaddlePaddle imports cleanly in selected Python environment', false, err.message);
  }

  // ── Test 3: PaddleOCR imports cleanly ───────────────────────────────────────
  try {
    const checkOCR = spawnSync(resolvedPy, ['-c', 'import paddleocr; print("PADDLEOCR_VER:", paddleocr.__version__)'], {
      encoding: 'utf-8',
      timeout: 15000
    });
    const stdout = checkOCR.stdout || '';
    const isOk = checkOCR.status === 0 && stdout.includes('PADDLEOCR_VER:');
    report(
      3,
      'PaddleOCR imports cleanly in selected Python environment',
      isOk,
      `Output: ${stdout.trim() || checkOCR.stderr.trim()}`
    );
  } catch (err) {
    report(3, 'PaddleOCR imports cleanly in selected Python environment', false, err.message);
  }

  // ── Test 4: Model initialization succeeds on CPU ───────────────────────────
  try {
    const initCheck = spawnSync(resolvedPy, [
      '-c',
      'from paddleocr import PaddleOCR; ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False); print("MODEL_INIT_SUCCESS")'
    ], {
      encoding: 'utf-8',
      timeout: 30000
    });
    const isOk = initCheck.status === 0 && (initCheck.stdout || '').includes('MODEL_INIT_SUCCESS');
    report(
      4,
      'PaddleOCR model initialization succeeds on CPU',
      isOk,
      `Result: ${isOk ? 'Success' : initCheck.stderr.slice(0, 150)}`
    );
  } catch (err) {
    report(4, 'PaddleOCR model initialization succeeds on CPU', false, err.message);
  }

  // ── Test 5: Actual image fixture loads without I/O errors ──────────────────
  try {
    const exists = fs.existsSync(DOLO_FIXTURE);
    const size = exists ? fs.statSync(DOLO_FIXTURE).size : 0;
    report(
      5,
      'Actual prescription image fixture exists and is readable',
      exists && size > 1000,
      `Path: ${path.basename(DOLO_FIXTURE)}, Size: ${size} bytes`
    );
  } catch (err) {
    report(5, 'Actual prescription image fixture exists and is readable', false, err.message);
  }

  // ── Test 6 & 7: Actual OCR produces text & matches Dolo 650 ─────────────────
  let doloResult = null;
  const startTime = Date.now();
  try {
    doloResult = await executePythonOCRWorker(DOLO_FIXTURE);
    const durationMs = Date.now() - startTime;
    const hasText = doloResult && doloResult.success && doloResult.rawText && doloResult.rawText.includes('Dolo 650');
    report(
      6,
      'Actual OCR executes and extracts text from image',
      hasText,
      `Primary: ${doloResult?.engine?.primary}, Extracted: "${doloResult?.rawText?.replace(/\n/g, ' ')}", Latency: ${durationMs}ms`
    );

    const firstMed = doloResult?.medicineLines?.[0];
    const topCandidate = firstMed?.medicineCandidates?.[0];
    const isDolo = topCandidate && topCandidate.medicineName === 'Dolo 650' && firstMed.confidenceClass === 'HIGH_CONFIDENCE';
    report(
      7,
      'Dolo 650 fixture produces actual catalogue candidate with HIGH_CONFIDENCE',
      isDolo,
      `Candidate: ${topCandidate?.medicineName}, MatchConfidence: ${topCandidate?.matchConfidence}, Class: ${firstMed?.confidenceClass}`
    );
  } catch (err) {
    report(6, 'Actual OCR executes and extracts text from image', false, err.message);
    report(7, 'Dolo 650 fixture produces actual catalogue candidate with HIGH_CONFIDENCE', false, err.message);
  }

  // ── Test 8 & 9: Layout processing and header exclusion ─────────────────────
  let multiResult = null;
  try {
    multiResult = await executePythonOCRWorker(MULTI_FIXTURE);
    const regions = multiResult?.regions || [];
    const hasHeader = regions.some(r => r.type === 'HEADER');
    const hasMedicine = regions.some(r => r.type === 'MEDICINE_SECTION');
    report(
      8,
      'Layout processing segments document regions (HEADER and MEDICINE_SECTION)',
      hasHeader && hasMedicine,
      `Total regions: ${regions.length} (HEADER: ${regions.filter(r => r.type === 'HEADER').length}, MEDICINE: ${regions.filter(r => r.type === 'MEDICINE_SECTION').length})`
    );

    const headerTexts = regions.filter(r => r.type === 'HEADER').map(r => r.text.toLowerCase());
    const clinicOrDocInHeader = headerTexts.some(t => t.includes('clinic') || t.includes('dr.'));
    const clinicInMedicine = (multiResult?.medicineLines || []).some(m => m.rawLine.toLowerCase().includes('clinic'));
    report(
      9,
      'Header exclusion prevents clinic/doctor text from becoming medicine candidates',
      clinicOrDocInHeader && !clinicInMedicine,
      `Clinic/Doc in HEADER: ${clinicOrDocInHeader}, Excluded from medicineLines: ${!clinicInMedicine}`
    );
  } catch (err) {
    report(8, 'Layout processing segments document regions', false, err.message);
    report(9, 'Header exclusion prevents clinic/doctor text from becoming medicine candidates', false, err.message);
  }

  // ── Test 10: Multi-medicine prescription reconstruction ────────────────────
  try {
    const medLines = multiResult?.medicineLines || [];
    const validCandidates = medLines.filter(m => m.medicineCandidates && m.medicineCandidates.length > 0);
    const medNames = validCandidates.map(m => m.medicineCandidates[0].medicineName);
    const foundAugmentin = medNames.some(n => n.includes('Augmentin'));
    const foundDolo = medNames.some(n => n.includes('Dolo'));
    report(
      10,
      'Multi-medicine prescription extracts multiple distinct catalogue medicines',
      foundAugmentin && foundDolo,
      `Detected medicines: ${medNames.join(', ')} (Total lines: ${validCandidates.length})`
    );
  } catch (err) {
    report(10, 'Multi-medicine prescription extracts multiple distinct catalogue medicines', false, err.message);
  }

  // ── Test 11: Unknown medicine handling ─────────────────────────────────────
  try {
    const nonMedResult = await executePythonOCRWorker(NON_MED_FIXTURE);
    const medLines = nonMedResult?.medicineLines || [];
    const allNotCatalogue = medLines.every(m => m.confidenceClass === 'NOT_IN_CATALOGUE');
    report(
      11,
      'Unknown medicine / non-medical content correctly classified as NOT_IN_CATALOGUE',
      allNotCatalogue && medLines.length > 0,
      `Lines evaluated: ${medLines.length}, all classified NOT_IN_CATALOGUE: ${allNotCatalogue}`
    );
  } catch (err) {
    report(11, 'Unknown medicine handling', false, err.message);
  }

  // ── Test 12: Unreadable / blank image handling ─────────────────────────────
  try {
    const blankResult = await executePythonOCRWorker(BLANK_FIXTURE);
    const isSafe = blankResult && blankResult.success && (!blankResult.rawText || blankResult.rawText.trim() === '');
    report(
      12,
      'Unreadable / blank image produces safe zero-detection state without crash',
      isSafe,
      `Blocks: ${blankResult?.regions?.length || 0}, rawText length: ${blankResult?.rawText?.length || 0}`
    );
  } catch (err) {
    report(12, 'Unreadable / blank image produces safe zero-detection state without crash', false, err.message);
  }

  // ── Test 13: Node → Python bridge integration ──────────────────────────────
  try {
    const bridgeResult = await runOCR(DOLO_FIXTURE);
    const isOk = bridgeResult && bridgeResult.success === true && bridgeResult.engine.includes('PaddleOCR');
    report(
      13,
      'Node runOCR() invokes Python bridge and parses structured output',
      isOk,
      `Engine: ${bridgeResult?.engine}, Confidence: ${bridgeResult?.confidence}%, RawText lines: ${bridgeResult?.rawText?.split('\n').length}`
    );
  } catch (err) {
    report(13, 'Node runOCR() invokes Python bridge and parses structured output', false, err.message);
  }

  // ── Test 14: Timeout enforcement ───────────────────────────────────────────
  try {
    const sleepScript = path.join(__dirname, 'test_fixtures/sleep_5s_worker.py');
    let timedOut = false;
    try {
      await executePythonOCRWorker(DOLO_FIXTURE, { workerScriptPath: sleepScript, timeoutMs: 1500 });
    } catch (err) {
      timedOut = err.message.includes('timed out');
    }
    report(
      14,
      'Process timeout guard terminates hung OCR workers after configured timeoutMs',
      timedOut,
      `Killed timed-out worker successfully: ${timedOut}`
    );
  } catch (err) {
    report(14, 'Process timeout guard terminates hung OCR workers', false, err.message);
  }

  // ── Test 15: Malformed JSON output rejection ───────────────────────────────
  try {
    const badScript = path.join(__dirname, 'test_fixtures/bad_json_worker.py');
    let caughtMalformed = false;
    try {
      await executePythonOCRWorker(DOLO_FIXTURE, { workerScriptPath: badScript });
    } catch (err) {
      caughtMalformed = err.message.includes('Malformed JSON output');
    }
    report(
      15,
      'Malformed JSON output from worker is safely rejected with descriptive error',
      caughtMalformed,
      `Error boundary caught malformed JSON: ${caughtMalformed}`
    );
  } catch (err) {
    report(15, 'Malformed JSON output from worker is safely rejected', false, err.message);
  }

  // ── Test 16: Tesseract is never automatically invoked ──────────────────────
  try {
    const ocrEngineSrc = fs.readFileSync(path.join(__dirname, 'src/utils/ocrEngine.js'), 'utf-8');
    const catchMatch = ocrEngineSrc.match(/catch\s*\(\s*pyErr\s*\)\s*\{([\s\S]*?)\}/);
    const autoFallbackPresent = catchMatch ? catchMatch[1].includes('_runTesseractLegacy') : false;
    const defaultEngine = ocrEngineSrc.includes("process.env.PRESCRIPTION_OCR_ENGINE || 'paddle'");
    report(
      16,
      'Tesseract is never automatically invoked on PaddleOCR failure',
      !autoFallbackPresent && defaultEngine,
      `Auto-fallback in catch block: ${autoFallbackPresent}, Default engine: paddle (${defaultEngine})`
    );
  } catch (err) {
    report(16, 'Tesseract is never automatically invoked on PaddleOCR failure', false, err.message);
  }

  // ── Test 17: Catalogue synchronization check ───────────────────────────────
  try {
    const syncCheck = spawnSync('node', ['ocr/sync_catalog_50.js', '--check'], {
      encoding: 'utf-8',
      cwd: __dirname
    });
    const isSync = syncCheck.status === 0 && (syncCheck.stdout || '').includes('Check passed');
    report(
      17,
      'Catalogue synchronization check (sync_catalog_50.js --check) passes',
      isSync,
      (syncCheck.stdout || syncCheck.stderr).trim()
    );
  } catch (err) {
    report(17, 'Catalogue synchronization check passes', false, err.message);
  }

  // ── Test 18: Patient verification remains mandatory ────────────────────────
  try {
    const ocrWorkerSrc = fs.readFileSync(path.join(__dirname, 'ocr/ocr_worker.py'), 'utf-8');
    const controllerSrc = fs.readFileSync(path.join(__dirname, 'src/controllers/prescriptionController.js'), 'utf-8');
    const workerRequires = ocrWorkerSrc.includes('"requiresPatientVerification": True');
    const controllerIsConfirmed = controllerSrc.includes('isConfirmed: false');
    const controllerStatus = controllerSrc.includes("status: 'VERIFICATION_REQUIRED'");
    report(
      18,
      'Patient verification remains mandatory across OCR pipeline and database',
      workerRequires && controllerIsConfirmed && controllerStatus,
      `worker requiresPatientVerification: ${workerRequires}, controller isConfirmed=false: ${controllerIsConfirmed}, status=VERIFICATION_REQUIRED: ${controllerStatus}`
    );
  } catch (err) {
    report(18, 'Patient verification remains mandatory', false, err.message);
  }

  // ── Test 19: Prescription screening remains intact ─────────────────────────
  try {
    const { screenPrescriptionDocument } = require('./src/utils/documentScreeningEngine');
    const screeningRes = await screenPrescriptionDocument({
      rawText: 'Rx: Dolo 650 1 tab twice daily',
      confidence: 95,
      detectedItems: [{ medicineName: 'Dolo 650', confidence: 1.0 }],
      warnings: []
    }, null);
    const isScreened = screeningRes && Boolean(screeningRes.status) && typeof screeningRes.requiresManualReview === 'boolean';
    report(
      19,
      'Prescription document screening engine executes cleanly with OCR output',
      isScreened,
      `Status: ${screeningRes?.status}, RequiresManualReview: ${screeningRes?.requiresManualReview}`
    );
  } catch (err) {
    report(19, 'Prescription document screening engine executes cleanly', false, err.message);
  }

  // ── Test 20: Performance metrics ───────────────────────────────────────────
  try {
    const perfStart = Date.now();
    const runRes = await executePythonOCRWorker(DOLO_FIXTURE);
    const totalDuration = Date.now() - perfStart;
    const perf = runRes?.performance || {};
    report(
      20,
      'OCR runtime performance metrics recorded',
      totalDuration < 15000,
      `Preprocessing: ${perf.preprocessingMs}ms, OCR: ${perf.ocrMs}ms, Worker Total: ${perf.totalMs}ms, End-to-End: ${totalDuration}ms`
    );
  } catch (err) {
    report(20, 'OCR runtime performance metrics recorded', false, err.message);
  }

  console.log('\n=========================================================================');
  console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('=========================================================================\n');

  await prisma.$disconnect();

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
