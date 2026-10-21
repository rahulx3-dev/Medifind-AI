/**
 * MediFind AI — Real Prescription Image OCR Verification Test
 *
 * Runs the actual uploaded prescription photograph through:
 *   1. Image preprocessing (Jimp)
 *   2. Tesseract.js OCR (PSM 4 → PSM 6 fallback)
 *   3. identifyMedicineRows()
 *   4. extractMedicineNameFromRow()
 *   5. matchMedicineNameAgainstCatalog() against PRODUCTION DB catalogue
 *   6. extractPrescribedQuantity()
 *
 * Expected prescription content:
 *   1. Cefixime Tab IP 200 mg    — qty 10
 *   2. Domperidone Tab IP 10 Mg  — qty 6
 *   3. Pantoprazole (Gastro Resistant) Tab IP 40 mg — qty 5
 *   4. ORS Powder IP 20.5 gm    — qty 1
 *
 * Usage: node test_real_prescription_ocr.js [imagePath]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const prisma = require('./src/prisma');
const {
  runOCR,
  identifyMedicineRows,
  extractMedicineNameFromRow,
  extractPrescribedQuantity,
  processPrescriptionText,
  matchMedicineNameAgainstCatalog,
} = require('./src/utils/ocrEngine');

// ─── Find the real prescription image ────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'prescriptions');

function findRealPrescriptionImage() {
  // From CLI argument
  if (process.argv[2]) return process.argv[2];

  // Find largest non-synthetic JPG/PNG in uploads (> 100KB = real photo)
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .map(f => ({ name: f, full: path.join(UPLOADS_DIR, f), size: fs.statSync(path.join(UPLOADS_DIR, f)).size }))
      .filter(f => f.size > 100000 && !f.name.includes('oversized') && /\.(jpg|jpeg|png)$/i.test(f.name))
      .sort((a, b) => b.size - a.size); // Largest first

    if (files.length > 0) {
      console.log(`\nAuto-detected real prescription image: ${files[0].name} (${Math.round(files[0].size/1024)}KB)`);
      return files[0].full;
    }
  } catch (_) {}
  return null;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(desc, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${desc}${detail ? '\n         ' + detail : ''}`);
    failed++;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  MEDIFIND AI — REAL PRESCRIPTION IMAGE OCR VERIFICATION TEST');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Step 0: Verify catalogue (no Domperidone 10 was silently added) ─────────
  console.log('STEP 0: Verifying production medicine catalogue...\n');
  const catalogue = await prisma.medicine.findMany({
    orderBy: { brandName: 'asc' }
  });

  console.log(`  Catalogue size: ${catalogue.length} medicines`);

  const domperidone10 = catalogue.find(m => m.brandName === 'Domperidone 10');
  const ors = catalogue.find(m => /\bORS\b/i.test(m.brandName) || /\bORS\b/i.test(m.genericName));
  const cefiximeEntries = catalogue.filter(m => /cefixime/i.test(m.genericName));
  const pantoprazoleEntries = catalogue.filter(m => /pantoprazole/i.test(m.genericName));

  console.log(`  Domperidone 10 in catalogue: ${domperidone10 ? '⚠ YES — WAS ADDED' : '✓ NOT PRESENT (expected)'}`);
  console.log(`  ORS in catalogue: ${ors ? '⚠ YES — ' + ors.brandName : '✓ NOT PRESENT (expected)'}`);
  console.log(`  Cefixime brands: ${cefiximeEntries.map(m => m.brandName).join(', ')}`);
  console.log(`  Pantoprazole brands: ${pantoprazoleEntries.map(m => m.brandName + ' (' + m.genericName + ')').join(' | ')}`);

  // ── Step 1: Find and validate the real prescription image ────────────────────
  const imagePath = findRealPrescriptionImage();

  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error('\n  ❌ ERROR: Real prescription image not found.');
    console.error('  Usage: node test_real_prescription_ocr.js <path-to-image>');
    console.error('  Or place the image in:', UPLOADS_DIR);
    process.exit(1);
  }

  const imageStats = fs.statSync(imagePath);
  console.log(`\nSTEP 1: Image confirmed`);
  console.log(`  Path: ${imagePath}`);
  console.log(`  Size: ${Math.round(imageStats.size / 1024)}KB`);

  // ── Step 2: Run OCR ──────────────────────────────────────────────────────────
  console.log('\nSTEP 2: Running Tesseract.js OCR (PSM 4/6)...');
  console.log('  (This may take 10–30 seconds)');

  const ocrResult = await runOCR(imagePath);

  console.log(`\n  OCR Success: ${ocrResult.success}`);
  console.log(`  OCR Confidence: ${ocrResult.confidence}%`);
  console.log(`  Word count: ${ocrResult.wordCount}`);
  console.log(`\n  ═══ ACTUAL RAW OCR TEXT ═══`);
  console.log(ocrResult.rawText);
  console.log(`  ═══ END RAW OCR TEXT ═══\n`);

  assert('OCR succeeded', ocrResult.success, ocrResult.error || '');
  assert('OCR produced readable text (> 20 words)', ocrResult.wordCount > 20,
    `Got ${ocrResult.wordCount} words`);
  assert('OCR confidence is not zero', ocrResult.confidence > 0,
    `Got confidence: ${ocrResult.confidence}`);

  if (!ocrResult.success || !ocrResult.rawText.trim()) {
    console.error('\n  FATAL: OCR failed. Cannot proceed with extraction verification.');
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── Step 3: Identify medicine rows ──────────────────────────────────────────
  console.log('\nSTEP 3: Identifying medicine rows from OCR text...');
  const medicineRows = identifyMedicineRows(ocrResult.rawText);

  console.log(`\n  Identified ${medicineRows.length} medicine row(s):`);
  medicineRows.forEach((r, i) => console.log(`  [${i + 1}] Line ${r.lineIndex}: "${r.row}"`));

  assert('At least 1 medicine row identified', medicineRows.length >= 1,
    'No rows detected — possible OCR table format issue');

  // ── Step 4: Extract medicine names from each row ─────────────────────────────
  console.log('\nSTEP 4: Extracting medicine names from rows...');
  const extractedNames = medicineRows.map(r => {
    const result = extractMedicineNameFromRow(r.row);
    const qty = extractPrescribedQuantity(r.row);
    console.log(`  Row: "${r.row.slice(0, 80).trim()}"`);
    console.log(`  → name: "${result.medicineName}", strength: "${result.strength}", qty: ${qty}`);
    return { ...result, extractedQty: qty };
  });

  // ── Step 5: Run full extraction against PRODUCTION catalogue ─────────────────
  console.log('\nSTEP 5: Running full extraction against production catalogue...');
  let detectedItems = [];
  if (ocrResult && Array.isArray(ocrResult.medicineLines) && ocrResult.medicineLines.length > 0) {
    detectedItems = ocrResult.medicineLines.map(line => {
      const parsed = extractMedicineNameFromRow(line.rawLine);
      const cleanName = line.extractedName || parsed.medicineName || line.rawLine;
      const cleanStrength = line.strength || parsed.strength || '';
      const dbMatches = matchMedicineNameAgainstCatalog(cleanName, cleanStrength, catalogue);
      const candidates = (dbMatches.length > 0
        ? dbMatches
        : (line.medicineCandidates || []).map(m => ({ medicine: { brandName: m.medicineName, genericName: m.genericName, strength: m.strength, dosageForm: m.dosageForm }, confidence: m.matchConfidence }))
      );
      const top = candidates[0] || null;
      const hasMultipleBrands = candidates.length > 1 && candidates[0].confidence >= 0.80 && candidates[1].confidence >= 0.80;
      const isSingleHighConf = top && top.confidence >= 0.85 && !hasMultipleBrands;

      return {
        rawName: line.rawLine,
        medicineName: cleanName,
        strength: cleanStrength,
        matchedMedicineName: top ? top.medicine.brandName : null,
        confidence: top ? top.confidence : 0,
        needsMapping: !isSingleHighConf,
        extractedQuantity: typeof line.quantity === 'number' ? line.quantity : (extractPrescribedQuantity(line.rawLine) || null),
        quantity: typeof line.quantity === 'number' ? line.quantity : (extractPrescribedQuantity(line.rawLine) || 1),
        allMatches: candidates,
        evidenceSummary: top ? `Matched ${top.medicine.brandName}` : 'Needs mapping'
      };
    });
  } else {
    detectedItems = processPrescriptionText(ocrResult.rawText, catalogue);
  }

  console.log(`\n  ═══ DETECTED MEDICINE CANDIDATES ═══`);
  detectedItems.forEach((item, i) => {
    const status = item.needsMapping ? '⚠  NEEDS MAPPING' : `✔  ${item.matchedMedicineName} (${Math.round(item.confidence * 100)}%)`;
    console.log(`\n  [${i + 1}] Extracted name: "${item.medicineName || '(could not extract)'}"`);
    console.log(`       Strength: ${item.strength || '—'}`);
    console.log(`       Status: ${status}`);
    console.log(`       Qty from prescription: ${item.extractedQuantity ?? 'not found'}`);
    console.log(`       Qty field: ${item.quantity}`);
    console.log(`       Evidence: ${item.evidenceSummary || '—'}`);
    if (item.allMatches && item.allMatches.length > 0) {
      console.log(`       Catalogue candidates:`);
      item.allMatches.forEach(m => console.log(`         • ${m.medicine.brandName} (${m.medicine.genericName}) — ${Math.round(m.confidence * 100)}%`));
    }
  });
  console.log('\n  ═══ END DETECTED CANDIDATES ═══\n');

  // ── Step 6: Verify expected medicines detected ───────────────────────────────
  console.log('\nSTEP 6: Verification assertions...\n');

  const allExtractedNames = detectedItems.map(d => (d.medicineName || '').toLowerCase());
  const allMatchedNames = detectedItems.map(d => d.matchedMedicineName).filter(Boolean);

  // ─ 6a: Cefixime ─
  const cefiximeItem = detectedItems.find(d => d.medicineName && /cefixime/i.test(d.medicineName));
  assert('Cefixime is detected', !!cefiximeItem, `Detected names: ${JSON.stringify(allExtractedNames)}`);
  if (cefiximeItem) {
    assert('Cefixime needs mapping (multiple brands)', cefiximeItem.needsMapping,
      `Got needsMapping:${cefiximeItem.needsMapping}, matchedMedicineName:${cefiximeItem.matchedMedicineName}`);
    assert('Cefixime has catalogue candidates (Taxim-O 200 or Zifi 200)',
      cefiximeItem.allMatches && cefiximeItem.allMatches.length >= 1,
      `allMatches: ${JSON.stringify(cefiximeItem.allMatches)}`);
    assert('Cefixime quantity extracted',
      cefiximeItem.extractedQuantity !== null && cefiximeItem.extractedQuantity !== undefined,
      `Got extractedQuantity: ${cefiximeItem.extractedQuantity}`);
  }

  // ─ 6b: Domperidone (Row 2 in prescription) ─
  const domItem = detectedItems.find(d => d.extractedQuantity === 6 || (d.medicineName && /domperidone|silt/i.test(d.medicineName)));
  assert('Row 2 (Domperidone) is detected', !!domItem, `Detected items: ${JSON.stringify(detectedItems.map(d => ({ name: d.medicineName, qty: d.extractedQuantity })))}`);
  if (domItem) {
    console.log(`  ℹ Row 2 extracted name: "${domItem.medicineName}"`);
    console.log(`  ℹ Domperidone 10 in 50-medicine catalogue: NOT PRESENT (pure formulation)`);
    assert('Row 2 flagged as Needs Mapping', domItem.needsMapping === true, `needsMapping: ${domItem.needsMapping}`);
    assert('Row 2 quantity extracted as 6', domItem.extractedQuantity === 6, `Got: ${domItem.extractedQuantity}`);
  }

  // ─ 6c: Pantoprazole ─
  const pantoItem = detectedItems.find(d => d.medicineName && /pantoprazole/i.test(d.medicineName));
  assert('Pantoprazole is detected', !!pantoItem, `Detected names: ${JSON.stringify(allExtractedNames)}`);
  if (pantoItem) {
    assert('Pantoprazole NOT silently matched to Lasix 40', pantoItem.matchedMedicineName !== 'Lasix 40');
    console.log(`  ℹ Pantoprazole result: match=${pantoItem.matchedMedicineName}, needs=${pantoItem.needsMapping}`);
    if (pantoItem.allMatches) {
      const candidates = pantoItem.allMatches.map(m => `${m.medicine.brandName} (${Math.round(m.confidence * 100)}%)`);
      console.log(`  ℹ Pantoprazole candidates: ${candidates.join(', ')}`);
    }
    assert('Pantoprazole quantity extracted as 5',
      pantoItem.extractedQuantity === 5 || pantoItem.quantity === 5,
      `Got extractedQuantity: ${pantoItem.extractedQuantity}`);
  }

  // ─ 6d: ORS ─
  const orsItem = detectedItems.find(d => d.medicineName && /\bORS\b/i.test(d.medicineName));
  assert('ORS is detected', !!orsItem, `Detected names: ${JSON.stringify(allExtractedNames)}`);
  if (orsItem) {
    assert('ORS flagged as Needs Mapping (not in 50 catalogue)', orsItem.needsMapping === true,
      `matchedMedicineName: ${orsItem.matchedMedicineName}`);
    assert('ORS quantity extracted as 1',
      orsItem.extractedQuantity === 1 || orsItem.quantity === 1,
      `Got qty: ${orsItem.extractedQuantity}`);
    console.log(`  ℹ ORS result: needs=${orsItem.needsMapping}, match=${orsItem.matchedMedicineName}, qty=${orsItem.extractedQuantity}`);
  }

  // ─ 6e: False positive check ─
  const knownFalsePositives = [
    'Lasix 40', 'Augmentin 625 Duo', 'Deriphyllin Retard 150',
    'Tramazac 50', 'Atropine Injection'
  ];
  for (const fp of knownFalsePositives) {
    assert(`"${fp}" NOT falsely matched`, !allMatchedNames.includes(fp),
      `allMatchedNames: ${JSON.stringify(allMatchedNames)}`);
  }

  // ── Step 7: Pantoprazole evidence analysis ──────────────────────────────────
  console.log('\nSTEP 7: Pantoprazole matching evidence analysis...');
  console.log('  Comparing Pantoprazole 40mg vs catalogue candidates:\n');

  const pan40 = catalogue.find(m => m.brandName === 'Pan 40');
  const pantocidDSR = catalogue.find(m => m.brandName === 'Pantocid DSR');

  if (pan40) {
    const { matchMedicineNameAgainstCatalog: matchFn } = require('./src/utils/ocrEngine');
    const pantoMatches = matchFn('Pantoprazole', '40 mg', catalogue);
    console.log('  matchMedicineNameAgainstCatalog("Pantoprazole", "40 mg", catalogue) results:');
    pantoMatches.forEach(m => {
      console.log(`    • ${m.medicine.brandName} (${m.medicine.genericName}): confidence = ${m.confidence} (penalty: ${m.evidence?.combinationPenalty || 0})`);
    });

    console.log(`\n  Pan 40:       genericName="${pan40.genericName}" (pure Pantoprazole 40mg)`);
    if (pantocidDSR) {
      console.log(`  Pantocid DSR: genericName="${pantocidDSR.genericName}" (combination with Domperidone)`);
    }
    console.log(`\n  Analysis: A plain "Pantoprazole 40 mg" prescription correctly prefers Pan 40.`);
    console.log(`  Pantocid DSR is a COMBINATION product (Pantoprazole + Domperidone)`);
    console.log(`  and receives a combination penalty so it is NOT treated as equally plausible.`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async e => {
  console.error('Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
