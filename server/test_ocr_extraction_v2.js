/**
 * MediFind AI — OCR Medicine Extraction Unit Tests (v2)
 *
 * Tests the new row-aware, evidence-based extraction engine against:
 * 1. The real test prescription (Cefixime, Domperidone, Pantoprazole, ORS)
 * 2. The academic sample prescriptions
 * 3. False-positive regression: ensures Lasix 40, Pan 40, Taxim-O etc.
 *    are NOT fabricated when processing the real prescription.
 *
 * Usage: node test_ocr_extraction_v2.js
 */

'use strict';

const {
  identifyMedicineRows,
  extractMedicineNameFromRow,
  extractPrescribedQuantity,
  processPrescriptionText,
  calculateSimilarity,
} = require('./src/utils/ocrEngine');

// ─── Minimal medicine catalogue (same as production DB) ──────────────────────
const CATALOGUE = [
  { id: 'med-01', brandName: 'Crocin 650',        genericName: 'Paracetamol',                        alternativeGenerics: '["Dolo 650","Calpol 650","Pacimol 650"]' },
  { id: 'med-02', brandName: 'Dolo 650',           genericName: 'Paracetamol',                        alternativeGenerics: '["Crocin 650","Calpol 650","Sumo L 650"]' },
  { id: 'med-03', brandName: 'Augmentin 625 Duo',  genericName: 'Amoxicillin + Potassium Clavulanate',alternativeGenerics: '["Moxikind-CV 625","Clavam 625"]' },
  { id: 'med-04', brandName: 'Pan 40',             genericName: 'Pantoprazole',                       alternativeGenerics: '["Pantocid 40","Pantodac 40"]' },
  { id: 'med-05', brandName: 'Pantocid DSR',       genericName: 'Pantoprazole + Domperidone',         alternativeGenerics: '["Pan-D","Pantocar-DSR"]' },
  { id: 'med-06', brandName: 'Taxim-O 200',        genericName: 'Cefixime',                           alternativeGenerics: '["Mahacef 200","Zifi 200"]' },
  { id: 'med-07', brandName: 'Zifi 200',           genericName: 'Cefixime',                           alternativeGenerics: '["Taxim-O 200","Mahacef 200"]' },
  { id: 'med-08', brandName: 'Lasix 40',           genericName: 'Furosemide',                         alternativeGenerics: '["Frusenex 40","Salurin 40"]' },
  { id: 'med-09', brandName: 'Tramazac 50',        genericName: 'Tramadol Hydrochloride',             alternativeGenerics: '["Ultracet","Tramatas"]' },
  { id: 'med-10', brandName: 'Atropine Injection', genericName: 'Atropine Sulfate',                   alternativeGenerics: '["Tropex","Tropine"]' },
  { id: 'med-11', brandName: 'Deriphyllin Retard 150', genericName: 'Etofylline + Theophylline',      alternativeGenerics: '["Phyllocontin","Theo-Asthalin"]' },
  { id: 'med-12', brandName: 'Emeset 4',           genericName: 'Ondansetron',                        alternativeGenerics: '["Zofran 4","Ondem 4"]' },
  { id: 'med-13', brandName: 'Domperidone 10',     genericName: 'Domperidone',                        alternativeGenerics: '["Domstal 10","Motilium 10"]' },
  { id: 'med-14', brandName: 'Pantoprazole 40',    genericName: 'Pantoprazole',                       alternativeGenerics: '["Pan 40","Pantocid 40","Pantodac 40"]' },
  { id: 'med-15', brandName: 'Cefixime 200',       genericName: 'Cefixime',                           alternativeGenerics: '["Taxim-O 200","Zifi 200","Mahacef 200"]' },
];

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${detail ? '\n         ' + detail : ''}`);
    failed++;
  }
}

function assertIncludes(description, array, matcher) {
  const found = array.some(matcher);
  assert(description, found, `Actual items: ${JSON.stringify(array.map(i => i.matchedMedicineName || i.medicineName || i.rawName))}`);
}

function assertExcludes(description, array, matcher) {
  const found = array.some(matcher);
  assert(description, !found, `Found unexpected item in: ${JSON.stringify(array.map(i => i.matchedMedicineName || i.rawName))}`);
}

// ─── Real prescription OCR text (simulating what Tesseract would produce) ────
// This simulates the OCR output from the real test prescription with the
// standard Indian prescription table format.

const REAL_PRESCRIPTION_OCR_TEXT = `
SOME HOSPITAL / CLINIC
Dr. Some Doctor, MBBS, MD
Patient Name: Test Patient
Date: 27-09-2026 UHID: 123456

Medicines Prescribed

Sl. No. Drug & Strength     Dosage  Frequency  Duration  Prescribed Qty
1       Cefixime Tab IP 200 mg  1 Tab   OD         5 Days    10
2       Domperidone Tab IP 10 Mg  1 Tab  BD         3 Days     6
3       Pantoprazole (Gastro Resistant) Tab IP 40 mg  1 Tab  OD  5 Days  5
4       ORS Powder IP 20.5 gm  1 Sachet  SOS        -          1

Signature: Dr. Some Doctor
Reg. No: XXX-12345
`;

// ─── Free-text / Rx-style sample prescription ────────────────────────────────
const SAMPLE_FEVER_TEXT = `CITY HEALTHCARE CLINIC
Dr. Alok Verma, MD | Reg: KMC-58291
Patient: Rohan Sharma | Date: 12-Sep-2026
Rx:

1. Augmentin 625 Duo - 1 tab twice daily x 5 days

2. Dolo 650 - 1 tab SOS for fever x 3 days

3. Pan 40 - 1 tab before meals x 5 days

Signature: Dr. A. Verma`;

// ─── Test Suite 1: Row identification ─────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 1: Row Identification');
console.log('══════════════════════════════════════════════════════\n');

{
  const rows = identifyMedicineRows(REAL_PRESCRIPTION_OCR_TEXT);
  console.log('  Identified rows:');
  rows.forEach(r => console.log(`    [${r.lineIndex}] ${r.row}`));
  console.log();

  assert(
    'Should identify 4 medicine rows',
    rows.length === 4,
    `Got ${rows.length} rows`
  );

  assert(
    'Row 1 should contain Cefixime',
    rows.some(r => /cefixime/i.test(r.row)),
    `Rows: ${rows.map(r => r.row).join(' | ')}`
  );

  assert(
    'Row 2 should contain Domperidone',
    rows.some(r => /domperidone/i.test(r.row))
  );

  assert(
    'Row 3 should contain Pantoprazole',
    rows.some(r => /pantoprazole/i.test(r.row))
  );

  assert(
    'Row 4 should contain ORS',
    rows.some(r => /ORS/i.test(r.row))
  );

  assert(
    'Should NOT include table header row (Sl. No. Drug & Strength...)',
    !rows.some(r => /Drug\s*&\s*Strength/i.test(r.row))
  );

  assert(
    'Should NOT include doctor signature line',
    !rows.some(r => /Signature/i.test(r.row))
  );
}

// ─── Test Suite 2: Medicine name extraction ───────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 2: Medicine Name Extraction from Rows');
console.log('══════════════════════════════════════════════════════\n');

{
  const tests = [
    {
      row: '1       Cefixime Tab IP 200 mg  1 Tab   OD         5 Days    10',
      expectedName: 'Cefixime',
      expectedStrength: '200 mg'
    },
    {
      row: '2       Domperidone Tab IP 10 Mg  1 Tab  BD         3 Days     6',
      expectedName: 'Domperidone',
      expectedStrength: '10 Mg'
    },
    {
      row: '3       Pantoprazole (Gastro Resistant) Tab IP 40 mg  1 Tab  OD  5 Days  5',
      expectedName: 'Pantoprazole',
      expectedStrength: '40 mg'
    },
    {
      row: '4       ORS Powder IP 20.5 gm  1 Sachet  SOS        -          1',
      expectedName: 'ORS',
      // ORS is a tricky case — may or may not extract a strength
    },
  ];

  for (const t of tests) {
    const { medicineName, strength } = extractMedicineNameFromRow(t.row);
    console.log(`  Row: "${t.row.trim()}"`);
    console.log(`  → extracted name: "${medicineName}", strength: "${strength}"`);
    console.log();

    assert(
      `Extracted name from row contains "${t.expectedName}"`,
      medicineName && medicineName.toLowerCase().includes(t.expectedName.toLowerCase()),
      `Got: "${medicineName}"`
    );

    if (t.expectedStrength) {
      assert(
        `Extracted strength contains digits from "${t.expectedStrength}"`,
        strength && /\d/.test(strength),
        `Got strength: "${strength}"`
      );
    }
  }
}

// ─── Test Suite 3: Quantity extraction ───────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 3: Prescribed Quantity Extraction');
console.log('══════════════════════════════════════════════════════\n');

{
  const qtyTests = [
    { row: '1       Cefixime Tab IP 200 mg  1 Tab   OD  5 Days    10', expected: 10 },
    { row: '2       Domperidone Tab IP 10 Mg  1 Tab  BD  3 Days     6', expected: 6 },
    { row: '3       Pantoprazole Tab IP 40 mg  1 Tab  OD  5 Days    5', expected: 5 },
    { row: '4       ORS Powder IP 20.5 gm  1 Sachet  SOS  -          1', expected: 1 },
  ];

  for (const t of qtyTests) {
    const qty = extractPrescribedQuantity(t.row);
    console.log(`  Row ends with qty ${t.expected}: "${t.row.trim()}" → ${qty}`);
    assert(
      `Quantity extracted as ${t.expected}`,
      qty === t.expected,
      `Got: ${qty}`
    );
  }
}

// ─── Test Suite 4: End-to-end processPrescriptionText ─────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 4: End-to-End processPrescriptionText');
console.log('══════════════════════════════════════════════════════\n');

{
  const results = processPrescriptionText(REAL_PRESCRIPTION_OCR_TEXT, CATALOGUE);

  console.log('  Detected medicines:');
  results.forEach(r => {
    const status = r.needsMapping ? '⚠ NEEDS MAPPING' : `✔ matched → ${r.matchedMedicineName} (${Math.round(r.confidence * 100)}%)`;
    console.log(`    • "${r.medicineName || r.rawName}" — ${status} — Qty: ${r.extractedQuantity ?? 'not found'}`);
    if (r.evidenceSummary) console.log(`      Evidence: ${r.evidenceSummary}`);
  });
  console.log();

  // Must find exactly 4 candidate rows (matching the 4 prescription rows)
  assert(
    'Should detect exactly 4 medicine candidates',
    results.length === 4,
    `Got ${results.length}`
  );

  // Cefixime — should match Cefixime 200 or Taxim-O 200 or similar
  const cefiximeResult = results.find(r => r.medicineName && /cefixime/i.test(r.medicineName));
  assert(
    'Cefixime row should be detected',
    !!cefiximeResult,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );
  if (cefiximeResult) {
    assert(
      'Cefixime extracted quantity should be 10',
      cefiximeResult.extractedQuantity === 10,
      `Got: ${cefiximeResult.extractedQuantity}`
    );
    assert(
      'Cefixime quantity field should be 10',
      cefiximeResult.quantity === 10,
      `Got: ${cefiximeResult.quantity}`
    );
  }

  // Domperidone — should match Domperidone 10 or needs mapping
  const domResult = results.find(r => r.medicineName && /domperidone/i.test(r.medicineName));
  assert(
    'Domperidone row should be detected',
    !!domResult,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );
  if (domResult) {
    assert(
      'Domperidone extracted quantity should be 6',
      domResult.extractedQuantity === 6,
      `Got: ${domResult.extractedQuantity}`
    );
  }

  // Pantoprazole — should match some Pantoprazole entry or be ambiguous (NOT Lasix 40)
  const pantoResult = results.find(r => r.medicineName && /pantoprazole/i.test(r.medicineName));
  assert(
    'Pantoprazole row should be detected',
    !!pantoResult,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );
  if (pantoResult) {
    assert(
      'Pantoprazole should NOT be matched to Lasix 40',
      pantoResult.matchedMedicineName !== 'Lasix 40',
      `Got match: ${pantoResult.matchedMedicineName}`
    );
    assert(
      'Pantoprazole extracted quantity should be 5',
      pantoResult.extractedQuantity === 5,
      `Got: ${pantoResult.extractedQuantity}`
    );
  }

  // ORS — NOT in catalogue, should be Needs Mapping
  const orsResult = results.find(r => r.medicineName && /ORS/i.test(r.medicineName));
  assert(
    'ORS row should be detected',
    !!orsResult,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );
  if (orsResult) {
    assert(
      'ORS should be flagged as Needs Mapping (not in catalogue)',
      orsResult.needsMapping === true,
      `Got needsMapping: ${orsResult.needsMapping}, matchedMedicineName: ${orsResult.matchedMedicineName}`
    );
    assert(
      'ORS extracted quantity should be 1',
      orsResult.extractedQuantity === 1,
      `Got: ${orsResult.extractedQuantity}`
    );
  }
}

// ─── Test Suite 5: False-positive regression ──────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 5: False Positive Regression');
console.log('══════════════════════════════════════════════════════\n');

{
  const results = processPrescriptionText(REAL_PRESCRIPTION_OCR_TEXT, CATALOGUE);
  const matchedNames = results.map(r => r.matchedMedicineName).filter(Boolean);
  const allNames = results.map(r => r.medicineName || r.rawName);

  console.log('  All matched catalogue names:', matchedNames);
  console.log('  All extracted names:', allNames);
  console.log();

  const falsePosWhitelist = [
    'Lasix 40',
    'Tramazac 50',
    'Augmentin 625 Duo',
    'Atropine Injection',
    'Deriphyllin Retard 150',
  ];

  for (const fp of falsePosWhitelist) {
    assert(
      `"${fp}" should NOT appear as a false positive match`,
      !matchedNames.includes(fp),
      `matchedNames: ${JSON.stringify(matchedNames)}`
    );
  }
}

// ─── Test Suite 6: Academic sample (backward-compatible free-text Rx) ─────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 6: Academic Sample — Free-text Rx');
console.log('══════════════════════════════════════════════════════\n');

{
  const results = processPrescriptionText(SAMPLE_FEVER_TEXT, CATALOGUE);

  console.log('  Detected medicines from sample Rx:');
  results.forEach(r => {
    const status = r.needsMapping ? '⚠ NEEDS MAPPING' : `✔ matched → ${r.matchedMedicineName} (${Math.round(r.confidence * 100)}%)`;
    console.log(`    • "${r.medicineName || r.rawName}" — ${status}`);
  });
  console.log();

  assert(
    'Should detect at least 3 medicines from academic sample',
    results.length >= 3,
    `Got ${results.length}`
  );

  // Augmentin 625 Duo should match
  const aug = results.find(r =>
    r.matchedMedicineName === 'Augmentin 625 Duo' ||
    (r.medicineName && /augmentin/i.test(r.medicineName))
  );
  assert(
    'Augmentin 625 Duo should be matched',
    !!aug,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );

  // Pan 40 should match Pantoprazole brand
  const pan = results.find(r =>
    r.matchedMedicineName === 'Pan 40' ||
    (r.medicineName && /pan\s*40/i.test(r.medicineName))
  );
  assert(
    'Pan 40 should be detected and matched',
    !!pan,
    `Results: ${JSON.stringify(results.map(r => r.medicineName))}`
  );
}

// ─── Test Suite 7: calculateSimilarity regression ────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  TEST SUITE 7: calculateSimilarity Short-String Safety');
console.log('══════════════════════════════════════════════════════\n');

{
  // Short strings must NOT create false positives
  assert('sim("40", "40") == 1.0', calculateSimilarity('40', '40') === 1.0);
  assert('sim("40", "Lasix 40") < 0.65', calculateSimilarity('40', 'Lasix 40') < 0.65,
    `Got ${calculateSimilarity('40', 'Lasix 40')}`);
  assert('sim("40", "Pan 40") < 0.65', calculateSimilarity('40', 'Pan 40') < 0.65,
    `Got ${calculateSimilarity('40', 'Pan 40')}`);

  // Same-name matches should score very high
  assert('sim("Cefixime", "Cefixime") == 1.0', calculateSimilarity('Cefixime', 'Cefixime') === 1.0);
  assert('sim("Pantoprazole", "Pantoprazole") == 1.0', calculateSimilarity('Pantoprazole', 'Pantoprazole') === 1.0);

  // Generic vs brand: acceptable similarity
  const cefVsBrand = calculateSimilarity('Cefixime', 'Taxim-O 200');
  console.log(`  sim("Cefixime", "Taxim-O 200") = ${cefVsBrand.toFixed(3)}`);
  assert('Cefixime vs Taxim-O 200 is not an exact match (< 0.9)', cefVsBrand < 0.9);

  const domvsdom = calculateSimilarity('Domperidone', 'Domperidone 10');
  console.log(`  sim("Domperidone", "Domperidone 10") = ${domvsdom.toFixed(3)}`);
  assert('Domperidone vs Domperidone 10 should be fairly high (> 0.65)', domvsdom > 0.65,
    `Got ${domvsdom}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('  All tests passed. OCR extraction engine v2 is verified.\n');
  process.exit(0);
}
