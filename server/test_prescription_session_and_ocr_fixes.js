'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testAll() {
  console.log('=========================================================================');
  console.log('  MediFind AI — Targeted Verification: OCR Fallback Removal & Session Lifecycle');
  console.log('=========================================================================\n');

  let passed = 0;
  let total = 0;

  function runCheck(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`✅ [PASS] ${name}`);
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // ── 1. Verify ocrEngine.js source code has 0 Tesseract fallbacks ────────────
  runCheck('ocrEngine.js does not fall back to Tesseract on empty/zero text or error', () => {
    const ocrEnginePath = path.join(__dirname, 'src/utils/ocrEngine.js');
    const content = fs.readFileSync(ocrEnginePath, 'utf8');

    // Ensure _runTesseractLegacy is only called in the explicit developer override
    const matches = content.match(/_runTesseractLegacy/g) || [];
    // Should only have 2 mentions: the dev check `if (selectedEngine === 'tesseract') return _runTesseractLegacy(imagePath);` and `async function _runTesseractLegacy`
    assert.strictEqual(matches.length, 2, `Expected exactly 2 occurrences of _runTesseractLegacy, found ${matches.length}`);

    // Ensure catch block in runOCR returns structured failure and does not call tesseract
    assert.ok(content.includes('[OCR-Bridge] Python OCR worker error:'), 'Should log Python OCR worker error');
    assert.ok(content.includes('OCR processed the image but could not extract readable text'), 'Should return structured empty-text error');
  });

  // ── 2. Verify AuthContext.jsx clears prescription session on logout ────────
  runCheck('AuthContext.jsx clears prescription session and image in try...finally block', () => {
    const authContextPath = path.join(__dirname, '../client/src/context/AuthContext.jsx');
    const content = fs.readFileSync(authContextPath, 'utf8');

    assert.ok(content.includes("localStorage.removeItem('medifind_prescription_session');"), 'Must clear medifind_prescription_session');
    assert.ok(content.includes("sessionStorage.removeItem('medifind_rx_image');"), 'Must clear medifind_rx_image');
    assert.ok(content.includes("finally {"), 'Must use finally block to ensure cleanup on error');
  });

  // ── 3. Verify PrescriptionUpload.jsx does NOT clear session on navigation ────
  runCheck('PrescriptionUpload.jsx removed premature session clearing on navigation to pharmacies', () => {
    const rxUploadPath = path.join(__dirname, '../client/src/pages/PrescriptionUpload.jsx');
    const content = fs.readFileSync(rxUploadPath, 'utf8');

    // Check around "Find Available Pharmacies" button:
    const buttonIndex = content.indexOf('Find Available Pharmacies');
    assert.ok(buttonIndex > -1, 'Find Available Pharmacies button must exist');
    const surrounding = content.substring(buttonIndex - 1200, buttonIndex + 100);
    assert.ok(!surrounding.includes('clearPrescriptionSession()'), 'Find Available Pharmacies onClick must NOT prematurely clear prescription session');
    assert.ok(content.includes('Session is strictly preserved until reservation hold succeeds'), 'Must note session is preserved');
  });

  // ── 4. Verify PrescriptionUpload.jsx user isolation ─────────────────────────
  runCheck('PrescriptionUpload.jsx validates userId for user isolation', () => {
    const rxUploadPath = path.join(__dirname, '../client/src/pages/PrescriptionUpload.jsx');
    const content = fs.readFileSync(rxUploadPath, 'utf8');

    assert.ok(content.includes('session.userId && user?.id && session.userId !== user.id'), 'Must check user isolation condition');
    assert.ok(content.includes('userId: user?.id'), 'savePrescriptionSession must include userId');
  });

  // ── 5. Verify PrescriptionUpload.jsx prevents showing completed prescriptions ─
  runCheck('PrescriptionUpload.jsx detects completed/archived prescriptions and resets to Step 1', () => {
    const rxUploadPath = path.join(__dirname, '../client/src/pages/PrescriptionUpload.jsx');
    const content = fs.readFileSync(rxUploadPath, 'utf8');

    assert.ok(content.includes("rx.status === 'COMPLETED' || rx.status === 'ARCHIVED' || (rx.activeOrdersCount > 0)"), 'Must check completed/archived status to prevent stale state display');
  });

  // ── 6. Verify Step 1 Previous Prescriptions History is rendered ─────────────
  runCheck('PrescriptionUpload.jsx renders Previous Prescriptions & Clinical Records section on Step 1', () => {
    const rxUploadPath = path.join(__dirname, '../client/src/pages/PrescriptionUpload.jsx');
    const content = fs.readFileSync(rxUploadPath, 'utf8');

    assert.ok(content.includes('Previous Prescriptions &amp; Clinical Records'), 'Must render Previous Prescriptions section');
    assert.ok(content.includes('loadPrescriptionById(rx.id)'), 'Must allow loading previous prescription by ID');
  });

  // ── 7. Verify reservation handlers clear session ONLY on success ────────────
  runCheck('Reservation success handlers clear session only on success', () => {
    const pharmacyDiscoveryPath = path.join(__dirname, '../client/src/pages/PharmacyDiscovery.jsx');
    const pdContent = fs.readFileSync(pharmacyDiscoveryPath, 'utf8');

    // In PharmacyDiscovery.jsx: inside `if (data.success && data.order)`:
    const pdMatch = pdContent.match(/if \(data\.success && data\.order\) \{([\s\S]*?)\} else \{/);
    assert.ok(pdMatch, 'PharmacyDiscovery must have if (data.success && data.order) block');
    assert.ok(pdMatch[1].includes("localStorage.removeItem('medifind_prescription_session')"), 'Must clear session on success');

    const modalPath = path.join(__dirname, '../client/src/components/AvailabilityModal.jsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');
    assert.ok(modalContent.includes("localStorage.removeItem('medifind_prescription_session')"), 'AvailabilityModal must clear session on success');

    const appPath = path.join(__dirname, '../client/src/App.jsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    assert.ok(appContent.includes("localStorage.removeItem('medifind_prescription_session')"), 'App.jsx handleOrderCreated must clear session');
  });

  // ── 8. Runtime ocrEngine test with mocked python worker returning empty text ──
  await (async () => {
    total++;
    try {
      const { runOCR } = require('./src/utils/ocrEngine');
      // Pass a non-existent or blank file to trigger the empty text path or worker error
      const blankPath = path.join(__dirname, 'test_fixtures/blank_white.jpg');
      const res = await runOCR(blankPath);
      assert.strictEqual(res.success, false, 'Expected success=false for blank/empty image');
      assert.ok(res.engine.includes('PaddleOCR'), `Engine should be PaddleOCR, got: ${res.engine}`);
      assert.strictEqual(res.rawText, '', 'rawText should be empty');
      passed++;
      console.log('✅ [PASS] Runtime runOCR on blank image returns structured failure without calling Tesseract');
    } catch (err) {
      console.error(`❌ [FAIL] Runtime runOCR check: ${err.message}`);
    }
  })();

  console.log(`\n=========================================================================`);
  console.log(`  Targeted Checks Complete: ${passed}/${total} passed`);
  console.log(`=========================================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

testAll().catch(e => {
  console.error('Fatal error during test run:', e);
  process.exit(1);
});
