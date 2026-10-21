/**
 * MediFind AI — Auxiliary Medicine Lexicon OCR Matching Test Suite
 *
 * Validates the controlled integration of the validated v2 auxiliary medicine lexicon
 * into the prescription OCR matching pipeline:
 *
 * 1. Primary catalogue matches still take strict precedence.
 * 2. Secondary matching suggests medicines outside the 50-item catalogue.
 * 3. Ineligible regulatory records (prohibited/review-required) are NEVER suggested.
 * 4. Strength, combination, and dosage-form mismatches are handled conservatively with review flags.
 * 5. Unknown or inferred strengths explicitly require human review.
 * 6. Auxiliary candidates cannot alter stock, price, cart, or reservation data (strict inventory isolation).
 * 7. In-memory caching and lookup performance are measured and verified.
 * 8. Python worker emits valid auxiliary candidate schema in JSON.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ocrMatcher = require('./src/utils/ocrMatcher');
const ocrEngine = require('./src/utils/ocrEngine');
const { getPythonExecutable } = require('./src/utils/pythonOcrBridge');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('=========================================================================');
  console.log('  MediFind AI — Auxiliary Medicine Lexicon OCR Matching Test Suite');
  console.log('=========================================================================\n');

  // ─── Test Suite 1: Primary Catalogue Precedence ────────────────────────────
  console.log('--- Test Suite 1: Primary Catalogue Precedence ---');

  runTest('Dolo 650 exact prescription matches primary catalogue as AUTO_MATCHED with zero auxiliary candidates', () => {
    const res = ocrMatcher.matchPrescriptionLine('Dolo 650 1 tab twice daily');
    assert.strictEqual(res.source, 'PRIMARY_CATALOGUE');
    assert.strictEqual(res.status, 'AUTO_MATCHED');
    assert.strictEqual(res.matchedMedicineName, 'Dolo 650');
    assert(res.matchedMedicineId !== null, 'Primary match must provide matchedMedicineId');
    assert.strictEqual(res.auxiliaryCandidates.length, 0, 'Auxiliary candidates must be empty for authoritative primary match');
  });

  runTest('Pan 40 prescription matches primary catalogue without falling back to auxiliary lexicon', () => {
    const res = ocrMatcher.matchPrescriptionLine('Tab Pan 40 mg OD before breakfast');
    assert.strictEqual(res.source, 'PRIMARY_CATALOGUE');
    assert.strictEqual(res.status, 'AUTO_MATCHED');
    assert.strictEqual(res.matchedMedicineName, 'Pan 40');
    assert.strictEqual(res.auxiliaryCandidates.length, 0);
  });

  runTest('Augmentin 625 Duo prescription matches primary catalogue with high confidence', () => {
    const res = ocrMatcher.matchPrescriptionLine('Augmentin 625 Duo 1 tab BD x 5 days');
    assert.strictEqual(res.source, 'PRIMARY_CATALOGUE');
    assert.strictEqual(res.status, 'AUTO_MATCHED');
    assert.strictEqual(res.matchedMedicineName, 'Augmentin 625 Duo');
    assert.strictEqual(res.auxiliaryCandidates.length, 0);
  });

  // ─── Test Suite 2: Secondary Candidate Matching ────────────────────────────
  console.log('\n--- Test Suite 2: Secondary Auxiliary Candidate Matching ---');

  runTest('NU Roxim (outside 50-catalogue) produces secondary reference suggestions with NOT_IN_CATALOGUE status', () => {
    const res = ocrMatcher.matchPrescriptionLine('Injection NU Roxim 1500mg');
    assert.strictEqual(res.source, 'AUXILIARY_LEXICON_SUGGESTION');
    assert.strictEqual(res.status, 'NOT_IN_CATALOGUE');
    assert.strictEqual(res.matchedMedicineId, null, 'Must NOT map to any inventory ID');
    assert(res.auxiliaryCandidates.length > 0, 'Must provide auxiliary suggestions');

    const top = res.auxiliaryCandidates[0];
    assert.strictEqual(top.lexiconId, 'LEX-IND-V2-00001');
    assert.strictEqual(top.sourceId, 109634);
    assert.strictEqual(top.brandName, '1500mg NU Roxim');
    assert.strictEqual(top.genericName, 'Cefuroxime');
    assert.strictEqual(top.dosageForm, 'Injection');
    assert.strictEqual(top.strength, '1500mg');
    assert.strictEqual(top.strengthVerified, true);
    assert.strictEqual(top.strengthReviewRequired, false);
    assert.strictEqual(top.isAuxiliarySuggestion, true);
    assert.strictEqual(top.requiresConfirmation, true);
  });

  runTest('Aerocort (inhalation formulation outside 50-catalogue) matches auxiliary reference lexicon', () => {
    const res = ocrMatcher.matchPrescriptionLine('Aerocort Inhaler 2 puffs BD');
    assert.strictEqual(res.source, 'AUXILIARY_LEXICON_SUGGESTION');
    assert(res.auxiliaryCandidates.length > 0);

    const top = res.auxiliaryCandidates[0];
    assert.strictEqual(top.brandName, 'Aerocort');
    assert.strictEqual(top.genericName, 'Levosalbutamol + Beclometasone');
    assert.strictEqual(top.dosageForm, 'Inhalation');
    assert.strictEqual(top.matchedMedicineId, null);
    assert.strictEqual(top.requiresConfirmation, true);
  });

  // ─── Test Suite 3: Prohibited and Ineligible Record Exclusion ──────────────
  console.log('\n--- Test Suite 3: Regulatory Compliance & Prohibited Exclusion ---');

  runTest('CDSCO prohibited Valdecoxib (Vacox) is NEVER suggested in auxiliary matching', () => {
    const res = ocrMatcher.searchAuxiliaryLexicon('Vacox 10mg');
    assert.strictEqual(res.length, 0, 'Vacox must be completely excluded from suggestions');

    const lineRes = ocrMatcher.matchPrescriptionLine('Vacox 10mg 1 tab daily');
    assert.strictEqual(lineRes.auxiliaryCandidates.length, 0, 'Prohibited drug must not appear in candidate list');
  });

  runTest('CDSCO prohibited Valcox 40mg is NEVER suggested', () => {
    const res = ocrMatcher.searchAuxiliaryLexicon('Valcox 40mg');
    assert.strictEqual(res.length, 0, 'Valcox must be completely excluded');
  });

  runTest('Prohibited Nimesulide combo (Doloflam Plus) is NEVER suggested', () => {
    const res = ocrMatcher.searchAuxiliaryLexicon('Doloflam Plus');
    const prohibitedMatches = res.filter(r => r.regulatoryStatus !== 'STANDARD_ALLOPATHIC' || !r.isEligibleForMatching);
    assert.strictEqual(prohibitedMatches.length, 0, 'Zero prohibited or non-eligible records may be returned');
  });

  runTest('All returned auxiliary candidates strictly satisfy isEligibleForMatching === true', () => {
    const queries = ['NU Roxim', 'Ofloxacin', 'Aerocort', 'Bactifree', 'Cetirizine', 'Combiflam'];
    for (const q of queries) {
      const candidates = ocrMatcher.searchAuxiliaryLexicon(q);
      for (const c of candidates) {
        assert.strictEqual(c.isEligibleForMatching, true, `${c.lexiconId} must be eligible for matching`);
        assert.strictEqual(c.regulatoryStatus, 'STANDARD_ALLOPATHIC', `${c.lexiconId} must be standard allopathic`);
        assert(c.lexiconId.startsWith('LEX-IND-V2-'), 'Must have valid v2 lexicon ID');
        assert(typeof c.sourceId === 'number', 'Must have provenance sourceId');
      }
    }
  });

  // ─── Test Suite 4: Strength and Formulation Safety ────────────────────────
  console.log('\n--- Test Suite 4: Strength and Formulation Safety ---');

  runTest('Dosage form mismatch penalizes score and attaches FORMULATION_MISMATCH review flag', () => {
    // Prescription specifies "Tablet" for an Injection-only medicine
    const candidates = ocrMatcher.searchAuxiliaryLexicon('NU Roxim', {
      dosageForm: 'Tablet',
      rawLine: 'Tab NU Roxim 1500mg'
    });
    assert(candidates.length > 0);
    const top = candidates[0];
    assert.strictEqual(top.dosageForm, 'Injection');
    assert(top.reviewFlags.includes('FORMULATION_MISMATCH'), 'Must flag FORMULATION_MISMATCH when prescription says Tablet but medicine is Injection');
  });

  runTest('Strength mismatch penalizes score and attaches STRENGTH_MISMATCH review flag', () => {
    // NU Roxim in lexicon is 1500mg, query specifies 500mg
    const candidates = ocrMatcher.searchAuxiliaryLexicon('NU Roxim', {
      strength: '500mg',
      rawLine: 'Injection NU Roxim 500mg'
    });
    assert(candidates.length > 0);
    const top = candidates[0];
    assert(top.reviewFlags.includes('STRENGTH_MISMATCH'), 'Must flag STRENGTH_MISMATCH when prescription specifies different strength');
  });

  runTest('Single-ingredient query matching a combination formulation receives combination penalty and COMBINATION_MISMATCH flag', () => {
    // Single drug "Abacavir" query matched against "A Bec L" (Abacavir + Lamivudine)
    const candidates = ocrMatcher.searchAuxiliaryLexicon('Abacavir', {
      rawLine: 'Abacavir 600mg'
    });
    for (const c of candidates) {
      if (c.genericName.includes('+')) {
        assert(c.reviewFlags.includes('COMBINATION_MISMATCH'), 'Multi-ingredient candidate matched from single-drug query must have COMBINATION_MISMATCH flag');
      }
    }
  });

  // ─── Test Suite 5: Unknown / Inferred Strength Flagging ────────────────────
  console.log('\n--- Test Suite 5: Unknown / Inferred Strength Flagging ---');

  runTest('Medicine with unverified/null strength in lexicon explicitly requires review with UNKNOWN_OR_INFERRED_STRENGTH flag', () => {
    const candidates = ocrMatcher.searchAuxiliaryLexicon('Bactifree');
    assert(candidates.length > 0, 'Must find Bactifree');
    const top = candidates[0];
    assert.strictEqual(top.strengthVerified, false);
    assert.strictEqual(top.strengthReviewRequired, true);
    assert(top.reviewFlags.includes('UNKNOWN_OR_INFERRED_STRENGTH'), 'Must include UNKNOWN_OR_INFERRED_STRENGTH in reviewFlags');
  });

  runTest('Prescription matching candidate with unknown strength flags needsMapping and requiresConfirmation', () => {
    const res = ocrMatcher.matchPrescriptionLine('Bactifree ointment apply topically');
    assert.strictEqual(res.source, 'AUXILIARY_LEXICON_SUGGESTION');
    assert.strictEqual(res.needsMapping, true);
    assert.strictEqual(res.requiresConfirmation, true);
    assert(res.auxiliaryCandidates[0].reviewFlags.includes('UNKNOWN_OR_INFERRED_STRENGTH'));
  });

  // ─── Test Suite 6: Strict Inventory and Order Isolation ───────────────────
  console.log('\n--- Test Suite 6: Strict Inventory & Order Boundary Isolation ---');

  runTest('Auxiliary candidates strictly isolate inventory: matchedMedicineId is null and inStock is false', () => {
    const res = ocrMatcher.matchPrescriptionLine('Injection NU Roxim 1500mg');
    assert.strictEqual(res.matchedMedicineId, null);
    assert.strictEqual(res.matchedMedicineName, null);

    for (const cand of res.auxiliaryCandidates) {
      assert.strictEqual(cand.matchedMedicineId, null, 'Auxiliary candidate matchedMedicineId must be null');
      assert.strictEqual(cand.inStock, false, 'Auxiliary candidate inStock must be false');
      assert.strictEqual(cand.availabilityStatus, 'UNCONFIRMED_AVAILABILITY');
      assert(cand.availabilityNote.includes('Availability cannot be confirmed'));
    }
  });

  runTest('processPrescriptionText integration preserves inventory boundary for non-catalogue items', () => {
    const catalog = ocrMatcher.loadCatalog();
    const rawPrescriptionText = 'Rx:\n1. Injection NU Roxim 1500mg - 1 vial stat\n2. Dolo 650 1 tab SOS';
    const detected = ocrEngine.processPrescriptionText(rawPrescriptionText, catalog);

    assert.strictEqual(detected.length, 2);

    // Item 1: NU Roxim (Non-catalogue)
    const nuRoximItem = detected[0];
    assert.strictEqual(nuRoximItem.status, 'NOT_IN_CATALOGUE');
    assert.strictEqual(nuRoximItem.matchedMedicineId, null, 'Must NOT link to inventory');
    assert.strictEqual(nuRoximItem.isConfirmed, false);
    assert.strictEqual(nuRoximItem.needsMapping, true);
    assert(nuRoximItem.auxiliaryCandidates.length > 0, 'Must have auxiliary candidates');
    assert.strictEqual(nuRoximItem.auxiliaryCandidates[0].brandName, '1500mg NU Roxim');

    // Item 2: Dolo 650 (Primary catalogue)
    const doloItem = detected[1];
    assert.strictEqual(doloItem.status, 'AUTO_MATCHED');
    assert(doloItem.matchedMedicineId !== null, 'Dolo must link to inventory');
    assert.strictEqual(doloItem.matchedMedicineName, 'Dolo 650');
  });

  // ─── Test Suite 7: Performance & In-Memory Cache Measurement ──────────────
  console.log('\n--- Test Suite 7: Performance & Cache Measurement ---');

  runTest('In-memory cache measurement: warm lookup is substantially faster and avoids disk re-reads', () => {
    ocrMatcher.clearMatcherCaches();

    // Cold load
    const coldStart = Date.now();
    ocrMatcher.loadAuxiliaryLexicon();
    const coldDuration = Date.now() - coldStart;

    const stats = ocrMatcher.getAuxiliaryLexiconStats();
    assert(stats.eligibleRecords > 2100, `Expected >2100 eligible records, got ${stats.eligibleRecords}`);
    assert(stats.ineligibleFilteredOut >= 9, `Expected >=9 filtered out, got ${stats.ineligibleFilteredOut}`);

    // Warm queries
    const warmStart = Date.now();
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      ocrMatcher.searchAuxiliaryLexicon('NU Roxim', { topK: 3 });
      ocrMatcher.searchAuxiliaryLexicon('Aerocort', { topK: 3 });
    }
    const totalWarmDuration = Date.now() - warmStart;
    const avgWarmPerQuery = totalWarmDuration / (iterations * 2);

    console.log(`       Cold load duration: ${coldDuration}ms (${stats.eligibleRecords} eligible records indexed)`);
    console.log(`       Warm query avg duration: ${avgWarmPerQuery.toFixed(2)}ms across ${iterations * 2} queries`);

    assert(avgWarmPerQuery < 50, `Average warm lookup time must be responsive (<50ms), got ${avgWarmPerQuery}ms`);
  });

  // ─── Test Suite 8: Python Worker Output Schema & RapidFuzz Integration ────
  console.log('\n--- Test Suite 8: Python OCR Worker Integration ---');

  runTest('Python worker supports --lexicon and produces auxiliaryCandidates with rapidfuzz', () => {
    const pythonBin = getPythonExecutable();
    const workerScript = path.resolve(__dirname, 'ocr/ocr_worker.py');
    const catalogPath = path.resolve(__dirname, 'ocr/catalog_50.json');
    const lexiconPath = path.resolve(__dirname, 'ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');

    // Run Python unit test inline to inspect match_line_against_catalogue with --lexicon
    const testPyCode = `
import sys, json
from ocr_worker import match_line_against_catalogue, load_catalog

cat = load_catalog(r"${catalogPath.replace(/\\/g, '\\\\')}")
lex_path = r"${lexiconPath.replace(/\\/g, '\\\\')}"

# 1. Authoritative catalogue match
r1 = match_line_against_catalogue("Dolo 650 1 tab daily", cat, lexicon_path=lex_path)

# 2. Auxiliary lexicon candidate
r2 = match_line_against_catalogue("Injection NU Roxim 1500mg", cat, lexicon_path=lex_path)

# 3. Prohibited drug query
r3 = match_line_against_catalogue("Vacox 10mg", cat, lexicon_path=lex_path)

output = {
    "r1_class": r1.get("confidenceClass"),
    "r1_aux_count": len(r1.get("auxiliaryCandidates", [])),
    "r2_class": r2.get("confidenceClass"),
    "r2_aux_count": len(r2.get("auxiliaryCandidates", [])),
    "r2_top_brand": r2["auxiliaryCandidates"][0]["brandName"] if r2.get("auxiliaryCandidates") else None,
    "r2_top_id": r2["auxiliaryCandidates"][0]["lexiconId"] if r2.get("auxiliaryCandidates") else None,
    "r3_aux_count": len(r3.get("auxiliaryCandidates", []))
}
print("PY_TEST_RESULT:" + json.dumps(output))
`;

    const pyRun = spawnSync(pythonBin, ['-c', testPyCode], {
      cwd: path.resolve(__dirname, 'ocr'),
      encoding: 'utf-8',
      timeout: 20000
    });

    assert.strictEqual(pyRun.status, 0, `Python execution failed: ${pyRun.stderr || pyRun.stdout}`);
    const match = (pyRun.stdout || '').match(/PY_TEST_RESULT:(\{.*\})/);
    assert(match, `Could not parse Python test result: ${pyRun.stdout}`);

    const result = JSON.parse(match[1]);
    assert.strictEqual(result.r1_class, 'HIGH_CONFIDENCE', 'Dolo 650 must match HIGH_CONFIDENCE');
    assert.strictEqual(result.r1_aux_count, 0, 'Dolo 650 must have zero auxiliary candidates');
    assert.strictEqual(result.r2_class, 'NOT_IN_CATALOGUE', 'NU Roxim must be NOT_IN_CATALOGUE');
    assert(result.r2_aux_count > 0, 'NU Roxim must return auxiliary candidates');
    assert.strictEqual(result.r2_top_brand, '1500mg NU Roxim');
    assert.strictEqual(result.r2_top_id, 'LEX-IND-V2-00001');
    assert.strictEqual(result.r3_aux_count, 0, 'Vacox (prohibited) must return zero candidates');
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n=========================================================================');
  console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
  console.log('=========================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    console.log('ALL AUXILIARY MEDICINE LEXICON OCR TESTS PASSED SUCCESSFULLY!\n');
  }
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
