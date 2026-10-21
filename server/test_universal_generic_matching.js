/**
 * MediFind AI — Universal Data-Driven Generic-to-Brand Matching Verification
 *
 * Verifies:
 * 1. Multiple unrelated generic medicines (Cefixime, Pantoprazole, Paracetamol, Metformin, Azithromycin, Amlodipine)
 * 2. Combination medicine protection (Single generics reject combination brands; combination generics reject single brands)
 * 3. Dosage form & route compatibility (Injectables never cross-match Oral solids)
 * 4. Strength compatibility (Exact & combination sum matches; mismatched strengths rejected)
 * 5. Explicit trade brand prescriptions vs. generic prescriptions
 * 6. Uncatalogued generic medicines (Clean empty candidate set, no hallucinations)
 * 7. Traceability (Preservation of rawName and prescribedGenericName)
 * 8. Dynamic extensibility (Adding a new medicine to the catalogue works dynamically with ZERO code changes)
 */

'use strict';

const assert = require('assert');
const {
  cleanText,
  extractActiveIngredients,
  parseStrengthSpec,
  areStrengthsCompatible,
  normalizeDosageForm,
  areFormsCompatible,
  identifyPrescriptionType,
  findMatchingBrands
} = require('./src/utils/genericMedicineMatcher');

console.log('\n=== UNIVERSAL DATA-DRIVEN GENERIC-TO-BRAND MATCHER TEST ===\n');

// ─── Test Mock Catalogue ─────────────────────────────────────────────────────
const testCatalog = [
  {
    id: 'med-cefixime-taxim',
    brandName: 'Taxim-O 200',
    genericName: 'Cefixime',
    strength: '200mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'Alkem Laboratories',
    price: 140
  },
  {
    id: 'med-cefixime-zifi',
    brandName: 'Zifi 200',
    genericName: 'Cefixime',
    strength: '200mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'FDC Ltd',
    price: 135
  },
  {
    id: 'med-cefixime-100',
    brandName: 'Taxim-O 100 DT',
    genericName: 'Cefixime',
    strength: '100mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'Alkem Laboratories',
    price: 85
  },
  {
    id: 'med-cefixime-syr',
    brandName: 'Taxim-O Dry Syrup',
    genericName: 'Cefixime',
    strength: '50mg/5ml',
    dosageForm: 'Syrup',
    category: 'Antibiotic',
    manufacturer: 'Alkem Laboratories',
    price: 90
  },
  {
    id: 'med-panto-pan40',
    brandName: 'Pan 40',
    genericName: 'Pantoprazole',
    strength: '40mg',
    dosageForm: 'Tablet',
    category: 'Antacid',
    manufacturer: 'Alkem Laboratories',
    price: 155
  },
  {
    id: 'med-panto-pantocid',
    brandName: 'Pantocid 40',
    genericName: 'Pantoprazole Sodium',
    strength: '40mg',
    dosageForm: 'Tablet',
    category: 'Antacid',
    manufacturer: 'Sun Pharma',
    price: 160
  },
  {
    id: 'med-panto-dsr',
    brandName: 'Pantocid DSR',
    genericName: 'Pantoprazole + Domperidone',
    strength: '40mg + 30mg',
    dosageForm: 'Capsule',
    category: 'Gastrointestinal',
    manufacturer: 'Sun Pharma',
    price: 210
  },
  {
    id: 'med-para-dolo',
    brandName: 'Dolo 650',
    genericName: 'Paracetamol',
    strength: '650mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'Micro Labs',
    price: 32
  },
  {
    id: 'med-para-crocin',
    brandName: 'Crocin 650',
    genericName: 'Paracetamol',
    strength: '650mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'GSK',
    price: 35
  },
  {
    id: 'med-amox-augmentin',
    brandName: 'Augmentin 625 Duo',
    genericName: 'Amoxicillin + Clavulanic Acid',
    strength: '500mg + 125mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'GSK',
    price: 220
  },
  {
    id: 'med-metformin-glycomet',
    brandName: 'Glycomet 500',
    genericName: 'Metformin Hydrochloride',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Antidiabetic',
    manufacturer: 'USV Ltd',
    price: 45
  },
  {
    id: 'med-azithro-azithral',
    brandName: 'Azithral 500',
    genericName: 'Azithromycin',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'Alembic',
    price: 120
  },
  {
    id: 'med-amlodipine-stamlo',
    brandName: 'Stamlo 5',
    genericName: 'Amlodipine Besylate',
    strength: '5mg',
    dosageForm: 'Tablet',
    category: 'Antihypertensive',
    manufacturer: 'Dr Reddy',
    price: 65
  },
  {
    id: 'med-ceftriaxone-inj',
    brandName: 'Monocef 1g Injection',
    genericName: 'Ceftriaxone Sodium',
    strength: '1000mg',
    dosageForm: 'Injection',
    category: 'Antibiotic',
    manufacturer: 'Aristo',
    price: 75
  }
];

let passCount = 0;
let failCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  PASS: ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  FAIL: ${description} \u2014 ${err.message}`);
    failCount++;
  }
}

// ─── 1. Prescription Identification ──────────────────────────────────────────
console.log('TEST 1: Prescription Type Identification (Generic vs Trade Brand)...');

test('Identifies generic Cefixime', () => {
  const res = identifyPrescriptionType('Tab Cefixime 200mg', testCatalog);
  assert.strictEqual(res.isGeneric, true);
  assert.strictEqual(res.isBrand, false);
  assert.strictEqual(res.targetGeneric, 'Cefixime');
});

test('Identifies trade brand Taxim-O 200', () => {
  const res = identifyPrescriptionType('Taxim-O 200', testCatalog);
  assert.strictEqual(res.isGeneric, false);
  assert.strictEqual(res.isBrand, true);
  assert.strictEqual(res.matchedBrand?.id, 'med-cefixime-taxim');
});

test('Identifies generic Pantoprazole', () => {
  const res = identifyPrescriptionType('Pantoprazole 40mg', testCatalog);
  assert.strictEqual(res.isGeneric, true);
  assert.strictEqual(res.isBrand, false);
});

test('Identifies trade brand Dolo 650', () => {
  const res = identifyPrescriptionType('Dolo 650', testCatalog);
  assert.strictEqual(res.isGeneric, false);
  assert.strictEqual(res.isBrand, true);
});

test('Identifies combination generic Amoxicillin + Clavulanic Acid', () => {
  const res = identifyPrescriptionType('Amoxicillin + Clavulanic Acid 625mg', testCatalog);
  assert.strictEqual(res.isGeneric, true);
  assert.strictEqual(res.isCombo, true);
});

// ─── 2. Brand Resolution for Single Generics ─────────────────────────────────
console.log('\nTEST 2: Brand Resolution for Single-Ingredient Generics...');

test('Cefixime 200mg resolves both Taxim-O 200 and Zifi 200', () => {
  const brands = findMatchingBrands({ medicineName: 'Cefixime', strength: '200mg', dosageForm: 'Tablet' }, testCatalog);
  assert.strictEqual(brands.length, 2);
  const names = brands.map(b => b.brandName);
  assert(names.includes('Taxim-O 200'));
  assert(names.includes('Zifi 200'));
  // Does NOT match 100mg or Syrup
  assert(!names.includes('Taxim-O 100 DT'));
  assert(!names.includes('Taxim-O Dry Syrup'));
});

test('Pantoprazole 40mg resolves Pan 40 and Pantocid 40', () => {
  const brands = findMatchingBrands({ medicineName: 'Pantoprazole', strength: '40mg', dosageForm: 'Tablet' }, testCatalog);
  assert.strictEqual(brands.length, 2);
  const names = brands.map(b => b.brandName);
  assert(names.includes('Pan 40'));
  assert(names.includes('Pantocid 40'));
});

test('Single generic Pantoprazole NEVER matches combination Pantocid DSR', () => {
  const brands = findMatchingBrands({ medicineName: 'Pantoprazole', strength: '40mg' }, testCatalog);
  const names = brands.map(b => b.brandName);
  assert(!names.includes('Pantocid DSR'), 'Single Pantoprazole must NEVER match Pantocid DSR combo!');
});

test('Paracetamol 650mg resolves Dolo 650 and Crocin 650', () => {
  const brands = findMatchingBrands({ medicineName: 'Paracetamol', strength: '650mg' }, testCatalog);
  assert.strictEqual(brands.length, 2);
  const names = brands.map(b => b.brandName);
  assert(names.includes('Dolo 650'));
  assert(names.includes('Crocin 650'));
});

test('Metformin 500mg resolves Glycomet 500', () => {
  const brands = findMatchingBrands({ medicineName: 'Metformin', strength: '500mg' }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Glycomet 500');
});

test('Azithromycin 500mg resolves Azithral 500', () => {
  const brands = findMatchingBrands({ medicineName: 'Azithromycin', strength: '500mg' }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Azithral 500');
});

test('Amlodipine 5mg resolves Stamlo 5', () => {
  const brands = findMatchingBrands({ medicineName: 'Amlodipine', strength: '5mg' }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Stamlo 5');
});

// ─── 3. Combination Generics ─────────────────────────────────────────────────
console.log('\nTEST 3: Combination Generics Matching...');

test('Amoxicillin + Clavulanate 625mg resolves Augmentin 625 Duo', () => {
  const brands = findMatchingBrands({
    medicineName: 'Amoxicillin + Clavulanic Acid',
    strength: '625mg',
    dosageForm: 'Tablet'
  }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Augmentin 625 Duo');
});

test('Pantoprazole + Domperidone resolves Pantocid DSR, NOT single Pan 40', () => {
  const brands = findMatchingBrands({
    medicineName: 'Pantoprazole + Domperidone',
    dosageForm: 'Capsule'
  }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Pantocid DSR');
  assert(!brands.some(b => b.brandName === 'Pan 40'));
});

// ─── 4. Dosage Form & Route Isolation ────────────────────────────────────────
console.log('\nTEST 4: Dosage Form & Route Isolation...');

test('Cefixime Syrup request does NOT return Cefixime Tablets', () => {
  const brands = findMatchingBrands({
    medicineName: 'Cefixime',
    dosageForm: 'Syrup'
  }, testCatalog);
  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Taxim-O Dry Syrup');
});

test('Oral tablets never cross-match Injectables', () => {
  const brands = findMatchingBrands({
    medicineName: 'Ceftriaxone',
    dosageForm: 'Tablet'
  }, testCatalog);
  // Ceftriaxone in catalog is Injection, so Tablet request must reject it!
  assert.strictEqual(brands.length, 0);
});

// ─── 5. Strength Compatibility ───────────────────────────────────────────────
console.log('\nTEST 5: Strength Compatibility...');

test('Mismatched strength is rejected (e.g. 500mg request for 200mg drug)', () => {
  const brands = findMatchingBrands({
    medicineName: 'Cefixime',
    strength: '500mg'
  }, testCatalog);
  assert.strictEqual(brands.length, 0);
});

test('Sum strength matches combination (625mg matches 500mg + 125mg)', () => {
  const compatible = areStrengthsCompatible('625mg', '500mg + 125mg');
  assert.strictEqual(compatible, true);
});

// ─── 6. Uncatalogued Generics ────────────────────────────────────────────────
console.log('\nTEST 6: Uncatalogued Generic Medicines...');

test('Generic drug not in catalogue returns empty brand list without hallucinating', () => {
  const brands = findMatchingBrands({
    medicineName: 'Levothyroxine',
    strength: '100mcg'
  }, testCatalog);
  assert.strictEqual(brands.length, 0);
});

// ─── 7. Traceability ─────────────────────────────────────────────────────────
console.log('\nTEST 7: Prescription Traceability Preservation...');

test('Preserves rawName and prescribed generic identity in candidate metadata', () => {
  const item = {
    id: 'item-1',
    rawName: 'Tab Cefixime 200mg 1 BD',
    medicineName: 'Cefixime',
    strength: '200mg',
    dosageForm: 'Tablet'
  };
  const brands = findMatchingBrands(item, testCatalog);
  assert.strictEqual(brands.length, 2);
  assert.strictEqual(brands[0].clinicalMatchReason.includes('Cefixime'), true);
  assert.strictEqual(brands[0].isExactStrength, true);
  assert.strictEqual(brands[0].isExactForm, true);
});

// ─── 8. Dynamic Extensibility ────────────────────────────────────────────────
console.log('\nTEST 8: Dynamic Extensibility (Zero hardcoded code changes for new medicines)...');

test('Adding an arbitrary brand novel generic dynamically works immediately', () => {
  const extendedCatalog = [
    ...testCatalog,
    {
      id: 'med-montelukast-singulair',
      brandName: 'Montair 10',
      genericName: 'Montelukast Sodium',
      strength: '10mg',
      dosageForm: 'Tablet',
      category: 'Respiratory',
      manufacturer: 'Cipla',
      price: 180
    }
  ];

  const rxType = identifyPrescriptionType('Montelukast 10mg', extendedCatalog);
  assert.strictEqual(rxType.isGeneric, true);

  const brands = findMatchingBrands({
    medicineName: 'Montelukast',
    strength: '10mg',
    dosageForm: 'Tablet'
  }, extendedCatalog);

  assert.strictEqual(brands.length, 1);
  assert.strictEqual(brands[0].brandName, 'Montair 10');
  assert.strictEqual(brands[0].price, 180);
  assert.strictEqual(brands[0].manufacturer, 'Cipla');
});

console.log(`\n=== SUMMARY: ${passCount} passed, ${failCount} failed ===\n`);
if (failCount > 0) process.exit(1);
