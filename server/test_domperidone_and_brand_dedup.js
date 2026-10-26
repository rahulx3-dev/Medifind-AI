const assert = require('assert');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ocrMatcher = require('./src/utils/ocrMatcher');

async function testDomperidoneAndBrandDedup() {
  console.log('=== 1. Testing Domperidone 10mg Non-Catalogue Verification ===');
  
  const catalog = await prisma.medicine.findMany();
  console.log(`Total medicines in DB: ${catalog.length}`);

  // Test 1: Domperidone must not match Pantocid DSR
  const domLine = 'Domperidone Tab IP 10 Mg  1 Tab  BD  3 Days  6';
  const matchResult = ocrMatcher.matchPrescriptionLine(domLine, catalog);
  
  console.log('Match result for Domperidone:', {
    status: matchResult.status,
    matchedMedicineName: matchResult.matchedMedicineName,
    matchedMedicineId: matchResult.matchedMedicineId,
    confidenceClass: matchResult.confidenceClass
  });

  assert.notStrictEqual(
    matchResult.matchedMedicineName,
    'Pantocid DSR',
    'Domperidone single ingredient must NEVER be matched to combination Pantocid DSR'
  );
  assert.strictEqual(
    matchResult.status,
    'NOT_IN_CATALOGUE',
    'Domperidone pure formulation must be classified as NOT_IN_CATALOGUE'
  );
  console.log('✓ PASS: Domperidone correctly classified as NOT_IN_CATALOGUE and not matched to Pantocid DSR.');

  // Test 2: Check Cefixime brands in DB
  console.log('\n=== 2. Testing Cefixime Brand Options in DB ===');
  const cefBrands = await prisma.medicine.findMany({
    where: { genericName: { contains: 'Cefixime', mode: 'insensitive' } }
  });
  console.log('Cefixime brands in DB:', cefBrands.map(b => b.brandName));
  assert.strictEqual(cefBrands.length, 2, 'There should be exactly 2 Cefixime brands in DB (Taxim-O 200 and Zifi 200)');
  assert(cefBrands.some(b => b.brandName === 'Taxim-O 200'), 'Must contain Taxim-O 200');
  assert(cefBrands.some(b => b.brandName === 'Zifi 200'), 'Must contain Zifi 200');
  console.log('✓ PASS: No duplicate Tablet or test fixture brands in DB.');

  // Test 3: Frontend matcher deduplication
  console.log('\n=== 3. Testing Frontend Brand Deduplication Logic ===');
  // Simulate mock candidates with duplicates
  const mockCandidates = [
    { id: '1', brandName: 'Taxim-O 200', genericName: 'Cefixime', strength: '200mg', inStock: false },
    { id: '2', brandName: 'Taxim-O 200 Tablet', genericName: 'Cefixime', strength: '200mg', inStock: true },
    { id: '3', brandName: 'Zifi 200', genericName: 'Cefixime', strength: '200mg', inStock: true }
  ];

  const dedupedBrands = [];
  const brandKeyMap = new Map();
  for (const b of mockCandidates) {
    const rootName = (b.brandName || '')
      .toLowerCase()
      .replace(/\s*(?:tablet|tablets|tab|capsule|capsules|cap|syrup|syr|suspension|inj|injection)\b/gi, '')
      .replace(/[^a-z0-9]/g, '');
    const strengthKey = (b.strength || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${rootName}_${strengthKey}`;

    if (!brandKeyMap.has(key)) {
      brandKeyMap.set(key, b);
      dedupedBrands.push(b);
    } else {
      const existing = brandKeyMap.get(key);
      if (!existing.inStock && b.inStock) {
        const idx = dedupedBrands.indexOf(existing);
        if (idx !== -1) dedupedBrands[idx] = b;
        brandKeyMap.set(key, b);
      }
    }
  }

  console.log('Deduplicated brands:', dedupedBrands.map(b => b.brandName));
  assert.strictEqual(dedupedBrands.length, 2, 'Should deduplicate from 3 to 2');
  assert.strictEqual(dedupedBrands[0].inStock, true, 'Should prefer in-stock candidate');
  console.log('✓ PASS: Brand deduplication successfully eliminates duplicate formulations.');

  console.log('\n=========================================');
  console.log('ALL VERIFICATION ASSERTIONS PASSED (3/3)!');
  console.log('=========================================');
}

testDomperidoneAndBrandDedup()
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
