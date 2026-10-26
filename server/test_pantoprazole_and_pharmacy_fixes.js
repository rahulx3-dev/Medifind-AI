const assert = require('assert');
const { matchPrescriptionLine } = require('./src/utils/ocrMatcher');

async function runTests() {
  console.log('--- 1. Testing Pantoprazole 40mg Single-Formulation Auto-Match ---');
  const pantoRes = matchPrescriptionLine('Pantoprazole 40mg');
  console.log('Pantoprazole result:', {
    status: pantoRes.status,
    matchedMedicineName: pantoRes.matchedMedicineName,
    matchedMedicineId: pantoRes.matchedMedicineId,
    confidence: pantoRes.confidence,
    needsMapping: pantoRes.needsMapping,
    requiresConfirmation: pantoRes.requiresConfirmation
  });

  assert.strictEqual(pantoRes.status, 'AUTO_MATCHED', 'Pantoprazole 40mg should be AUTO_MATCHED');
  assert.strictEqual(pantoRes.matchedMedicineName, 'Pan 40', 'Should auto-match to Pan 40');
  assert.strictEqual(pantoRes.needsMapping, false, 'Should not require manual re-mapping');
  assert.strictEqual(pantoRes.requiresConfirmation, false, 'Should not require brand confirmation');
  console.log('✓ PASS: Pantoprazole 40mg auto-matches Pan 40 directly without Option A / Option B');

  console.log('\n--- 2. Testing Raw OCR line from user prescription slip ---');
  const rawPantoRes = matchPrescriptionLine('Pantoprazole (Gastro 1.00 Nosdngo e am Oral 5m 5');
  console.log('Raw line result:', {
    status: rawPantoRes.status,
    matchedMedicineName: rawPantoRes.matchedMedicineName,
    confidence: rawPantoRes.confidence
  });
  assert.strictEqual(rawPantoRes.status, 'AUTO_MATCHED');
  assert.strictEqual(rawPantoRes.matchedMedicineName, 'Pan 40');
  console.log('✓ PASS: Raw OCR prescription line matches Pan 40 decisively');

  console.log('\n--- 3. Testing Cefixime 200mg Multi-Brand Preservation ---');
  const cefiximeRes = matchPrescriptionLine('Cefixime 200mg');
  console.log('Cefixime result:', {
    status: cefiximeRes.status,
    matchedMedicineName: cefiximeRes.matchedMedicineName,
    needsMapping: cefiximeRes.needsMapping,
    requiresConfirmation: cefiximeRes.requiresConfirmation
  });
  assert.strictEqual(cefiximeRes.status, 'AMBIGUOUS', 'Cefixime 200mg must remain AMBIGUOUS due to competing brands (Taxim-O vs Zifi)');
  assert.strictEqual(cefiximeRes.matchedMedicineId, null, 'Must not auto-lock into a brand');
  assert.strictEqual(cefiximeRes.requiresConfirmation, true, 'Must require confirmation (Option A / Option B)');
  console.log('✓ PASS: Cefixime 200mg requires brand choice or pharmacy review');

  console.log('\n--- 4. Testing Verified Active Pharmacies ---');
  const res = await fetch('http://localhost:5000/api/pharmacies/search');
  const data = await res.json();
  const names = (data.pharmacies || []).map(p => p.name);
  console.log('Active pharmacies returned:', names);
  assert(names.includes('Karuna Medicals'), 'Karuna Medicals must be present');
  assert(names.includes('Max Care Pharmacy'), 'Max Care Pharmacy must be present');
  assert(!names.includes('MediFind Kerala Central Pharmacy'), 'MediFind Kerala Central Pharmacy must be removed');
  assert.strictEqual(names.length, 2, 'Only 2 verified pharmacies should be returned');
  console.log('✓ PASS: Only Karuna Medicals and Max Care Pharmacy are active');

  console.log('\n=========================================');
  console.log('ALL VERIFICATION ASSERTIONS PASSED (4/4)!');
  console.log('=========================================');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
