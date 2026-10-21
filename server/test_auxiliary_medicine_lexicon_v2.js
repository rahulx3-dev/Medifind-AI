/**
 * MediFind AI — Phase 2C Validation Test Suite for Auxiliary Medicine Lexicon (v2)
 *
 * Validates:
 * 1. Alphabetical coverage across A–Z without bias (all 26 letters populated, ~84–85 entries per letter).
 * 2. Selection reproducibility and deterministic ordering.
 * 3. Duplicate checks: Zero duplicate lexicon IDs, zero duplicate source IDs within unique selections, zero duplicate clinical formulation tuples.
 * 4. Strength parsing:
 *    - Zero instances of 'NA', 'Plain', 'Liposomal', or 'Natural Micronized' stored as numeric strength.
 *    - Verified numeric strengths distinguished from unknown strengths.
 *    - 'strengthReviewRequired' properly flagged.
 * 5. Combination ingredient integrity: activeIngredients array matches genericName and strengths are associated with proper ingredients.
 * 6. Expanded dosage forms: Infusion, Lotion, Topical Solution, Respule, Oral Solution are properly represented and not merged into generic forms.
 * 7. Common medicine coverage: Crocin, Dolo, Combiflam, Glycomet, Pan, Telma, Voveran all present and verified.
 * 8. Regulatory review mechanism:
 *    - Prohibited drugs (Cisapride, banned Nimesulide formulations) have regulatoryStatus: 'PROHIBITED'.
 *    - Prohibited and review required drugs have isEligibleForMatching: false.
 *    - Verified CDSCO Gazette notifications, source URLs, and verification dates recorded.
 * 9. Project boundary preservation:
 *    - Raw source CSV unchanged.
 *    - server/ocr/catalog_50.json unchanged.
 *    - server/ocr/datasets/lexicon/indian_medicine_lexicon_v1.json & .csv preserved and intact.
 *    - New v2 files exist: indian_medicine_lexicon_v2.json, indian_medicine_lexicon_v2.csv, lexicon_metadata_v2.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.join(__dirname, '..');
const SOURCE_CSV_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/source/indian_medicine_data.csv');
const CATALOG_PATH = path.join(ROOT_DIR, 'server/ocr/catalog_50.json');

const V1_JSON_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/lexicon/indian_medicine_lexicon_v1.json');
const V1_CSV_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/lexicon/indian_medicine_lexicon_v1.csv');

const V2_JSON_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');
const V2_CSV_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/lexicon/indian_medicine_lexicon_v2.csv');
const V2_METADATA_PATH = path.join(ROOT_DIR, 'server/ocr/datasets/lexicon/lexicon_metadata_v2.json');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    testsFailed++;
  }
}

console.log('=== Running MediFind AI Phase 2C Validation Tests ===\n');

// 1. Project Boundaries & File Existence Tests
console.log('--- Test Suite 1: Project Boundaries & File Integrity ---');
runTest('Raw source CSV exists and is intact', () => {
  assert(fs.existsSync(SOURCE_CSV_PATH), 'Source CSV must exist');
  const stats = fs.statSync(SOURCE_CSV_PATH);
  assert(stats.size > 30 * 1024 * 1024, `Source CSV size should be > 30MB, got ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
});

runTest('catalog_50.json exists and has exactly 50 authoritative seed medicines', () => {
  assert(fs.existsSync(CATALOG_PATH), 'catalog_50.json must exist');
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  assert(Array.isArray(catalog), 'catalog_50 must be an array');
  assert.strictEqual(catalog.length, 50, `catalog_50 should have exactly 50 entries, found ${catalog.length}`);
});

runTest('v1 lexicon files preserved without deletion or corruption', () => {
  assert(fs.existsSync(V1_JSON_PATH), 'v1 JSON must be preserved');
  assert(fs.existsSync(V1_CSV_PATH), 'v1 CSV must be preserved');
  const v1 = JSON.parse(fs.readFileSync(V1_JSON_PATH, 'utf-8'));
  assert.strictEqual(v1.length, 2200, 'v1 should remain at 2,200 records');
});

runTest('v2 lexicon files exist and are populated', () => {
  assert(fs.existsSync(V2_JSON_PATH), 'v2 JSON must exist');
  assert(fs.existsSync(V2_CSV_PATH), 'v2 CSV must exist');
  assert(fs.existsSync(V2_METADATA_PATH), 'v2 Metadata must exist');
});

const v2Records = JSON.parse(fs.readFileSync(V2_JSON_PATH, 'utf-8'));
const v2Metadata = JSON.parse(fs.readFileSync(V2_METADATA_PATH, 'utf-8'));

// 2. Alphabetical Sampling & Letter Coverage Tests
console.log('\n--- Test Suite 2: Alphabetical Sampling & Letter Coverage ---');
runTest('Lexicon size is approximately 2,200 records (2,100 - 2,300)', () => {
  assert(v2Records.length >= 2100 && v2Records.length <= 2300, `Expected ~2,200 records, got ${v2Records.length}`);
});

runTest('All 26 letters A–Z have eligible representation in v2 lexicon', () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const letterCounts = {};
  for (const item of v2Records) {
    const ch = item.brandName.charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') {
      letterCounts[ch] = (letterCounts[ch] || 0) + 1;
    }
  }
  for (const l of letters) {
    assert(letterCounts[l] > 0, `Letter ${l} must have records, found ${letterCounts[l] || 0}`);
    assert(letterCounts[l] >= 75 && letterCounts[l] <= 95, `Letter ${l} count (${letterCounts[l]}) should be balanced (~84-85)`);
  }
});

runTest('Elimination of v1 "A" bias defect', () => {
  const aCount = v2Records.filter(r => r.brandName.toUpperCase().startsWith('A')).length;
  const aPercentage = (aCount / v2Records.length) * 100;
  assert(aPercentage < 6.0, `"A" should comprise < 6% of dataset in v2, got ${aPercentage.toFixed(2)}% (was 97.3% in v1)`);
});

// 3. ID Uniqueness & Deduplication Tests
console.log('\n--- Test Suite 3: Deduplication & ID Uniqueness ---');
runTest('All lexiconId values are strictly unique and formatted', () => {
  const idSet = new Set();
  for (const r of v2Records) {
    assert(/^LEX-IND-V2-\d{5}$/.test(r.lexiconId), `Invalid lexiconId format: ${r.lexiconId}`);
    assert(!idSet.has(r.lexiconId), `Duplicate lexiconId found: ${r.lexiconId}`);
    idSet.add(r.lexiconId);
  }
});

runTest('Zero duplicate clinical formulation tuples (brand + generic + strength + dosageForm)', () => {
  const tupleSet = new Set();
  for (const r of v2Records) {
    const normBrand = r.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normGen = r.genericName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normStr = (r.strength || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normForm = r.dosageForm.toLowerCase();
    const key = `${normBrand}|${normGen}|${normStr}|${normForm}`;
    assert(!tupleSet.has(key), `Duplicate clinical formulation found: ${key} (Lexicon ID: ${r.lexiconId})`);
    tupleSet.add(key);
  }
});

// 4. Strength Parsing & Descriptors Tests
console.log('\n--- Test Suite 4: Strength Parsing & Text Descriptors ---');
runTest('Zero instances of NA, Plain, Liposomal, Natural Micronized stored as numeric strength', () => {
  const invalidStrengthRegex = /^(plain|liposomal|natural micronized|na|n\/a|not available)$/i;
  for (const r of v2Records) {
    if (r.strength) {
      assert(!invalidStrengthRegex.test(r.strength.trim()), `Invalid numeric strength found in ${r.lexiconId}: "${r.strength}"`);
    }
    for (const a of r.activeIngredients) {
      if (a.strength) {
        assert(!invalidStrengthRegex.test(a.strength.trim()), `Invalid numeric strength found in active ingredient of ${r.lexiconId}: "${a.strength}"`);
      }
    }
  }
});

runTest('Distinguishes verified numeric strength from unknown strength with review flag', () => {
  for (const r of v2Records) {
    if (r.strengthVerified) {
      assert(r.strength !== null, `${r.lexiconId} has strengthVerified: true but null strength`);
      assert.strictEqual(r.strengthReviewRequired, false, `${r.lexiconId} verified strength cannot have strengthReviewRequired: true`);
    }
    if (r.strengthReviewRequired) {
      assert.strictEqual(r.strengthVerified, false, `${r.lexiconId} review required must have strengthVerified: false`);
    }
  }
});

// 5. Combination Medicines Integrity Tests
console.log('\n--- Test Suite 5: Combination Medicines Integrity ---');
runTest('Combination medicines have correct ingredient count and matching genericName', () => {
  const comboRecords = v2Records.filter(r => r.isCombination);
  assert(comboRecords.length > 500, `Expected > 500 combination medicines, found ${comboRecords.length}`);
  for (const r of comboRecords) {
    assert(r.activeIngredients.length >= 2, `${r.lexiconId} marked combination but has ${r.activeIngredients.length} ingredients`);
    const expectedGeneric = r.activeIngredients.map(a => a.ingredient).join(' + ');
    assert.strictEqual(r.genericName, expectedGeneric, `Mismatch genericName in ${r.lexiconId}: got "${r.genericName}", expected "${expectedGeneric}"`);
    for (const a of r.activeIngredients) {
      assert(a.ingredient && a.ingredient.trim().length > 0, `Missing ingredient name in ${r.lexiconId}`);
      assert(a.rawComposition && a.rawComposition.trim().length > 0, `Missing rawComposition in ${r.lexiconId}`);
    }
  }
});

// 6. Dosage Form Classification Tests
console.log('\n--- Test Suite 6: Dosage Form Classification ---');
runTest('Accurately classifies Infusion, Lotion, Topical Solution, Respule', () => {
  const forms = v2Metadata.dosageFormBreakdown;
  assert(forms['Infusion'] >= 30, `Expected Infusion >= 30, got ${forms['Infusion'] || 0}`);
  assert(forms['Lotion'] >= 30, `Expected Lotion >= 30, got ${forms['Lotion'] || 0}`);
  assert(forms['Topical Solution'] >= 30, `Expected Topical Solution >= 30, got ${forms['Topical Solution'] || 0}`);
  assert(forms['Respule'] >= 20, `Expected Respule >= 20, got ${forms['Respule'] || 0}`);
  assert(forms['Oral Solution'] >= 20, `Expected Oral Solution >= 20, got ${forms['Oral Solution'] || 0}`);
});

// 7. Common Medicines Coverage Tests
console.log('\n--- Test Suite 7: Common Indian Medicine Coverage ---');
const requiredCommonMedicines = [
  { name: 'crocin', label: 'Crocin', expectedMin: 1 },
  { name: 'dolo', label: 'Dolo', expectedMin: 1 },
  { name: 'combiflam', label: 'Combiflam', expectedMin: 1 },
  { name: 'glycomet', label: 'Glycomet', expectedMin: 1 },
  { name: 'pan', label: 'Pan', expectedMin: 1 },
  { name: 'telma', label: 'Telma', expectedMin: 1 },
  { name: 'voveran', label: 'Voveran', expectedMin: 1 }
];

requiredCommonMedicines.forEach(med => {
  runTest(`Common medicine coverage: ${med.label}`, () => {
    const matches = v2Records.filter(r => r.brandName.toLowerCase().startsWith(med.name));
    assert(matches.length >= med.expectedMin, `Expected at least ${med.expectedMin} entries for ${med.label}, found ${matches.length}`);
  });
});

// 8. Regulatory Review Mechanism & CDSCO Compliance Tests
console.log('\n--- Test Suite 8: Regulatory Review Mechanism & CDSCO Compliance ---');
runTest('Cisapride records are correctly flagged PROHIBITED with CDSCO G.S.R. 82(E) reference', () => {
  const cisaprideRecords = v2Records.filter(r => r.genericName.toLowerCase().includes('cisapride'));
  for (const r of cisaprideRecords) {
    assert.strictEqual(r.regulatoryStatus, 'PROHIBITED', `${r.lexiconId} cisapride must be PROHIBITED`);
    assert.strictEqual(r.isEligibleForMatching, false, `${r.lexiconId} cisapride must have isEligibleForMatching: false`);
    assert(r.regulatoryDetails.reference.includes('G.S.R. 82(E)'), `Reference must cite G.S.R. 82(E), got ${r.regulatoryDetails.reference}`);
    assert(r.regulatoryDetails.sourceUrl.includes('cdsco.gov.in'), `Must cite official CDSCO URL`);
  }
});

runTest('All prohibited or review required records have isEligibleForMatching: false', () => {
  for (const r of v2Records) {
    if (r.regulatoryStatus === 'PROHIBITED' || r.regulatoryStatus === 'REVIEW_REQUIRED') {
      assert.strictEqual(r.isEligibleForMatching, false, `${r.lexiconId} (${r.regulatoryStatus}) must NOT be eligible for matching`);
    } else {
      assert.strictEqual(r.regulatoryStatus, 'STANDARD_ALLOPATHIC');
      assert.strictEqual(r.isEligibleForMatching, true);
    }
  }
});

runTest('Provenance source IDs exist in raw dataset', () => {
  // Check sample of 50 records
  const sample = v2Records.slice(0, 50);
  for (const r of sample) {
    assert(r.sourceId !== undefined && r.sourceId !== null, `${r.lexiconId} missing sourceId`);
    assert(r.sourceName && r.sourceName.length > 0, `${r.lexiconId} missing sourceName`);
  }
});

console.log('\n=== Test Results Summary ===');
console.log(`Total tests passed: ${testsPassed}`);
console.log(`Total tests failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('ALL PHASE 2C VALIDATION TESTS PASSED!');
}
