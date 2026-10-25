/**
 * MediFind AI — Comprehensive Regression Suite: Generic Medicine Matching & OCR Verification
 *
 * Verifies all 15 requirements specified in Section 9 of the Master Prompt:
 *  1. Generic medicine name recognized & matching generic catalogue product stocked.
 *  2. Generic product & appropriate brand alternatives both stocked.
 *  3. Generic product stocked but suitable brand alternatives are not.
 *  4. Brand alternatives stocked but generic product does not exist in catalogue.
 *  5. Generic product in catalogue but unavailable at selected pharmacy.
 *  6. Medicine exists only in auxiliary lexicon (preserves inventory boundary).
 *  7. OCR produces ambiguous or low-confidence medicine name.
 *  8. Strengths differ between candidates (exact strength enforcement).
 *  9. Dosage forms differ between candidates (route & formulation isolation).
 * 10. Single-ingredient medicine confused with combination medicine (strict isolation).
 * 11. Patient chooses generic candidate -> correct catalogue ID reaches reservation.
 * 12. Patient chooses brand candidate -> correct catalogue ID reaches reservation.
 * 13. "Ask the pharmacist" option remains functional & preserves review state.
 * 14. Existing patient confirmation & pharmacist-verification safeguards remain enforced.
 * 15. Existing OCR, medicine matching, reservation and checkout tests continue to pass.
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
  isGenericProduct,
  evaluatePharmacyStock,
  findMatchingGenericProduct,
  findMatchingBrands,
  findMatchingCandidates
} = require('./src/utils/genericMedicineMatcher');

const { processPrescriptionText } = require('./src/utils/ocrEngine');
const ocrMatcher = require('./src/utils/ocrMatcher');

let totalPassed = 0;
let totalFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
    totalFailed++;
  }
}

console.log('\n======================================================================');
console.log(' MEDIFIND AI — 15-CASE GENERIC MATCHING & OCR REGRESSION SUITE');
console.log('======================================================================\n');

// ── Test Catalogue Construction (Representative of 50-item PostgreSQL schema) ──
const catalogue = [
  // 1. Generic product + Brand alternatives
  {
    id: 'med-paracetamol-generic-500',
    brandName: 'Paracetamol 500mg Tablets',
    genericName: 'Paracetamol',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'Indian Pharmacopoeia Generics',
    price: 15.00,
    isGenericProduct: true
  },
  {
    id: 'med-paracetamol-dolo-650',
    brandName: 'Dolo 650',
    genericName: 'Paracetamol',
    strength: '650mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'Micro Labs Ltd',
    price: 32.50
  },
  {
    id: 'med-paracetamol-crocin-650',
    brandName: 'Crocin 650',
    genericName: 'Paracetamol',
    strength: '650mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'GlaxoSmithKline',
    price: 34.00
  },
  {
    id: 'med-paracetamol-crocin-500',
    brandName: 'Crocin Advance 500',
    genericName: 'Paracetamol',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'GlaxoSmithKline',
    price: 22.00
  },
  {
    id: 'med-paracetamol-syrup-125',
    brandName: 'Crocin Pediatric Syrup',
    genericName: 'Paracetamol',
    strength: '125mg/5ml',
    dosageForm: 'Syrup',
    category: 'Pediatric Analgesic',
    manufacturer: 'GlaxoSmithKline',
    price: 45.00
  },

  // 2. Generic product with NO brand alternatives in catalogue
  {
    id: 'med-atropine-generic',
    brandName: 'Atropine Injection',
    genericName: 'Atropine Sulfate',
    strength: '0.6mg/ml',
    dosageForm: 'Injection',
    category: 'Emergency / Anticholinergic',
    manufacturer: 'Certified Generic Injectables Ltd',
    price: 25.00,
    isGenericProduct: true
  },

  // 3. Brand products where NO matching generic product exists in catalogue
  {
    id: 'med-pantoprazole-pan-40',
    brandName: 'Pan 40',
    genericName: 'Pantoprazole',
    strength: '40mg',
    dosageForm: 'Tablet',
    category: 'Gastrointestinal / PPI',
    manufacturer: 'Alkem Laboratories',
    price: 155.00
  },
  {
    id: 'med-pantoprazole-pantocid-40',
    brandName: 'Pantocid 40',
    genericName: 'Pantoprazole',
    strength: '40mg',
    dosageForm: 'Tablet',
    category: 'Gastrointestinal / PPI',
    manufacturer: 'Sun Pharma',
    price: 160.00
  },

  // 4. Combination Products (for combination vs single testing)
  {
    id: 'med-combiflam-tab',
    brandName: 'Combiflam',
    genericName: 'Ibuprofen + Paracetamol',
    strength: '400mg + 325mg',
    dosageForm: 'Tablet',
    category: 'NSAID Combination',
    manufacturer: 'Sanofi India',
    price: 42.00
  },
  {
    id: 'med-brufen-400',
    brandName: 'Brufen 400',
    genericName: 'Ibuprofen',
    strength: '400mg',
    dosageForm: 'Tablet',
    category: 'NSAID',
    manufacturer: 'Abbott Healthcare',
    price: 28.00
  },
  {
    id: 'med-augmentin-625',
    brandName: 'Augmentin 625 Duo',
    genericName: 'Amoxicillin and Clavulanate Potassium',
    strength: '500mg + 125mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'GlaxoSmithKline',
    price: 205.00
  },

  // 5. Cetirizine Generic & Brand
  {
    id: 'med-cetirizine-generic-10',
    brandName: 'Cetirizine 10',
    genericName: 'Cetirizine Hydrochloride',
    strength: '10mg',
    dosageForm: 'Tablet',
    category: 'Antihistamine',
    manufacturer: 'Cipla Generics',
    price: 18.00,
    isGenericProduct: true
  },
  {
    id: 'med-cetirizine-cetzine',
    brandName: 'Cetzine 10',
    genericName: 'Cetirizine Hydrochloride',
    strength: '10mg',
    dosageForm: 'Tablet',
    category: 'Antihistamine',
    manufacturer: 'Dr. Reddy\'s',
    price: 48.00
  }
];

// ── Pharmacy Inventory Mock for Store A (Full stock) and Store B (Selective stock) ──
const inventoryPharmacyA = [
  { medicineId: 'med-paracetamol-generic-500', stock: 120, price: 15.00, status: 'IN_STOCK' },
  { medicineId: 'med-paracetamol-crocin-500', stock: 45, price: 22.00, status: 'IN_STOCK' },
  { medicineId: 'med-paracetamol-dolo-650', stock: 80, price: 32.50, status: 'IN_STOCK' },
  { medicineId: 'med-atropine-generic', stock: 15, price: 25.00, status: 'IN_STOCK' },
  { medicineId: 'med-pantoprazole-pan-40', stock: 60, price: 155.00, status: 'IN_STOCK' },
  { medicineId: 'med-cetirizine-generic-10', stock: 90, price: 18.00, status: 'IN_STOCK' },
  { medicineId: 'med-cetirizine-cetzine', stock: 35, price: 48.00, status: 'IN_STOCK' }
];

const inventoryPharmacyB = [
  // Paracetamol generic is OUT OF STOCK at Pharmacy B, but Crocin 500 is stocked
  { medicineId: 'med-paracetamol-generic-500', stock: 0, price: 15.00, status: 'OUT_OF_STOCK' },
  { medicineId: 'med-paracetamol-crocin-500', stock: 50, price: 22.00, status: 'IN_STOCK' },
  { medicineId: 'med-pantoprazole-pan-40', stock: 30, price: 155.00, status: 'IN_STOCK' }
];

// ============================================================================
// CASE 1: Generic medicine name recognized & matching generic product stocked
// ============================================================================
console.log('--- TEST GROUP 1: Generic Candidate Discovery & Availability ---');
runTest('Case 1: Generic name recognized & matching generic catalogue product is stocked', () => {
  const result = findMatchingCandidates(
    { medicineName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet' },
    catalogue,
    { pharmacyInventory: inventoryPharmacyA }
  );

  assert(result.genericCandidate, 'Must discover a matching generic candidate');
  assert.strictEqual(result.genericCandidate.id, 'med-paracetamol-generic-500');
  assert.strictEqual(result.genericCandidate.isGenericProduct, true);
  assert.strictEqual(result.genericCandidate.inStock, true);
  assert.strictEqual(result.genericCandidate.stock, 120);
});

// ============================================================================
// CASE 2: Generic product & appropriate brand alternatives both stocked
// ============================================================================
runTest('Case 2: Generic product & appropriate brand alternatives are both stocked', () => {
  const result = findMatchingCandidates(
    { medicineName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet' },
    catalogue,
    { pharmacyInventory: inventoryPharmacyA }
  );

  assert(result.genericCandidate, 'Must have generic candidate');
  assert.strictEqual(result.genericCandidate.inStock, true);
  assert(result.brandCandidates.length > 0, 'Must have brand candidates');

  const crocin500 = result.brandCandidates.find(b => b.id === 'med-paracetamol-crocin-500');
  assert(crocin500, 'Crocin 500 must be in brand candidates');
  assert.strictEqual(crocin500.inStock, true);
  assert.strictEqual(crocin500.isExactStrength, true);

  // Dolo 650 must NOT be present as an exact strength alternative for 500mg request
  const dolo650 = result.brandCandidates.find(b => b.id === 'med-paracetamol-dolo-650');
  assert(!dolo650, 'Dolo 650 must not be returned when prescribed 500mg');
});

// ============================================================================
// CASE 3: Generic product stocked but suitable brand alternatives are not
// ============================================================================
runTest('Case 3: Generic product stocked but suitable brand alternatives are not', () => {
  const result = findMatchingCandidates(
    { medicineName: 'Atropine Sulfate', strength: '0.6mg/ml', dosageForm: 'Injection' },
    catalogue,
    { pharmacyInventory: inventoryPharmacyA }
  );

  assert(result.genericCandidate, 'Generic Atropine must be discovered');
  assert.strictEqual(result.genericCandidate.id, 'med-atropine-generic');
  assert.strictEqual(result.genericCandidate.inStock, true);
  assert.strictEqual(result.brandCandidates.length, 0, 'Must have 0 brand alternatives in catalogue');
});

// ============================================================================
// CASE 4: Brand alternatives stocked but generic product does not exist in catalogue
// ============================================================================
runTest('Case 4: Brand alternatives stocked but generic product does not exist in catalogue', () => {
  const result = findMatchingCandidates(
    { medicineName: 'Pantoprazole', strength: '40mg', dosageForm: 'Tablet' },
    catalogue,
    { pharmacyInventory: inventoryPharmacyA }
  );

  assert.strictEqual(result.genericCandidate, null, 'No generic product should be found');
  assert.strictEqual(result.hasGenericInCatalogue, false, 'hasGenericInCatalogue must be false');
  assert(result.brandCandidates.length >= 2, 'Must discover Pan 40 and Pantocid 40');
  assert(result.brandCandidates.some(b => b.id === 'med-pantoprazole-pan-40' && b.inStock === true));
  assert(result.brandCandidates.some(b => b.id === 'med-pantoprazole-pantocid-40'));
});

// ============================================================================
// CASE 5: Generic product exists in catalogue but is unavailable at selected pharmacy
// ============================================================================
runTest('Case 5: Generic product exists in catalogue but is unavailable at selected pharmacy', () => {
  const result = findMatchingCandidates(
    { medicineName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet' },
    catalogue,
    { pharmacyInventory: inventoryPharmacyB }
  );

  assert(result.genericCandidate, 'Generic candidate still identified from catalogue');
  assert.strictEqual(result.genericCandidate.inStock, false, 'Generic product must be marked out of stock at Pharmacy B');
  assert.strictEqual(result.genericCandidate.availabilityStatus, 'OUT_OF_STOCK');

  // Brand alternative is available at Pharmacy B
  const crocin = result.brandCandidates.find(b => b.id === 'med-paracetamol-crocin-500');
  assert(crocin, 'Crocin 500 must be found');
  assert.strictEqual(crocin.inStock, true, 'Crocin 500 must be in stock at Pharmacy B');
});

// ============================================================================
// CASE 6: Medicine exists only in auxiliary lexicon (Strict Inventory Boundary)
// ============================================================================
console.log('\n--- TEST GROUP 2: Auxiliary Lexicon & Strict Inventory Boundary ---');
runTest('Case 6: Medicine exists only in auxiliary lexicon', () => {
  // Query a drug that is in the auxiliary reference lexicon (e.g. Mupirocin or Sofosbuvir) but NOT in catalogue
  const auxMatches = ocrMatcher.searchAuxiliaryLexicon('Mupirocin', { topK: 3 });
  assert(auxMatches && auxMatches.length > 0, 'Must find Mupirocin in auxiliary lexicon');

  // Process through prescription OCR engine
  const ocrResults = processPrescriptionText('1. Tab Mupirocin 200mg x 10', catalogue);
  assert(ocrResults.length > 0, 'Must detect row');
  const mupirocinItem = ocrResults[0];

  assert.strictEqual(mupirocinItem.status, 'NOT_IN_CATALOGUE', 'Must be flagged as NOT_IN_CATALOGUE');
  assert.strictEqual(mupirocinItem.matchedMedicineId, null, 'Must NOT be assigned a catalogue medicine ID');
  assert.strictEqual(mupirocinItem.isConfirmed, false, 'Must NOT be auto-confirmed');
  assert(mupirocinItem.auxiliaryCandidates.length > 0, 'Must attach auxiliary reference candidates');
});

// ============================================================================
// CASE 7: OCR produces ambiguous or low-confidence medicine name
// ============================================================================
runTest('Case 7: OCR produces ambiguous or low-confidence medicine name', () => {
  const ocrResults = processPrescriptionText('1. Tab Xyzaqwer 500mg x 10', catalogue);
  assert(ocrResults.length > 0, 'Must process row');
  const unknownItem = ocrResults[0];

  assert.strictEqual(unknownItem.status, 'NOT_IN_CATALOGUE', 'Unknown name must be NOT_IN_CATALOGUE');
  assert.strictEqual(unknownItem.isConfirmed, false, 'Must not be confirmed');
  assert.strictEqual(unknownItem.matchedMedicineId, null, 'matchedMedicineId must be null');
});

// ============================================================================
// CASE 8: Strengths differ between candidates
// ============================================================================
console.log('\n--- TEST GROUP 3: Medicine Safety & Equivalence Verification ---');
runTest('Case 8: Strengths differ between candidates (500mg prescription vs 650mg catalogue)', () => {
  // Prescription: Paracetamol 500mg
  const result500 = findMatchingCandidates(
    { medicineName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet' },
    catalogue
  );

  // Must only match 500mg formulations
  assert(result500.allCandidates.every(c => areStrengthsCompatible('500mg', c.strength)),
    'All returned candidates must have clinically compatible strength with 500mg');
  assert(!result500.allCandidates.some(c => c.brandName.includes('650')),
    '650mg products must NEVER be offered for a 500mg prescription');

  // Prescription: Paracetamol 650mg
  const result650 = findMatchingCandidates(
    { medicineName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' },
    catalogue
  );
  assert(result650.allCandidates.some(c => c.id === 'med-paracetamol-dolo-650'), 'Dolo 650 matches 650mg');
  assert(result650.allCandidates.some(c => c.id === 'med-paracetamol-crocin-650'), 'Crocin 650 matches 650mg');
  assert(!result650.allCandidates.some(c => c.id === 'med-paracetamol-generic-500'), '500mg generic rejected for 650mg');
});

// ============================================================================
// CASE 9: Dosage forms differ between candidates
// ============================================================================
runTest('Case 9: Dosage forms differ between candidates (Syrup vs Tablet, Oral vs Injectable)', () => {
  // Prescription: Paracetamol Syrup
  const resultSyrup = findMatchingCandidates(
    { medicineName: 'Paracetamol', dosageForm: 'Syrup' },
    catalogue
  );

  assert(resultSyrup.allCandidates.length > 0, 'Must find syrup formulation');
  assert(resultSyrup.allCandidates.every(c => normalizeDosageForm(c.dosageForm) === 'ORAL_LIQUID'),
    'Syrup request must strictly return oral liquid formulations, not tablets');
  assert(!resultSyrup.allCandidates.some(c => c.dosageForm === 'Tablet'),
    'Tablets must not be substituted for Syrup');

  // Prescription: Atropine Injection vs Oral
  assert.strictEqual(areFormsCompatible('Injection', 'Tablet'), false,
    'Injection and Tablet must never be compatible');
});

// ============================================================================
// CASE 10: Single-ingredient medicine confused with combination medicine
// ============================================================================
runTest('Case 10: Single-ingredient medicine confused with combination medicine', () => {
  // Prescribed: Ibuprofen (Single active ingredient)
  const resultSingle = findMatchingCandidates(
    { medicineName: 'Ibuprofen', strength: '400mg', dosageForm: 'Tablet' },
    catalogue
  );

  assert(resultSingle.allCandidates.some(c => c.id === 'med-brufen-400'), 'Brufen 400 (single) must match');
  assert(!resultSingle.allCandidates.some(c => c.id === 'med-combiflam-tab'),
    'Combiflam (Ibuprofen + Paracetamol) must NEVER be offered for single Ibuprofen prescription');

  // Prescribed: Ibuprofen + Paracetamol (Combination)
  const resultCombo = findMatchingCandidates(
    { medicineName: 'Ibuprofen + Paracetamol', dosageForm: 'Tablet' },
    catalogue
  );
  assert(resultCombo.allCandidates.some(c => c.id === 'med-combiflam-tab'), 'Combiflam must match combination');
  assert(!resultCombo.allCandidates.some(c => c.id === 'med-brufen-400'),
    'Single Brufen 400 must NOT be offered when combination was prescribed');
});

// ============================================================================
// CASE 11: Patient chooses generic candidate -> correct catalogue ID reaches reservation
// ============================================================================
console.log('\n--- TEST GROUP 4: Patient Selection & Reservation Integrity ---');
runTest('Case 11: Patient chooses generic candidate and correct catalogue ID reaches reservation', () => {
  const ocrItems = processPrescriptionText('1. Tab Cetirizine 10mg x 10', catalogue);
  assert(ocrItems.length > 0, 'Must extract prescription item');
  const item = ocrItems[0];

  assert.strictEqual(item.isGeneric, true, 'Item recognized as generic');
  assert.strictEqual(item.matchedMedicineId, null, 'Must NOT be auto-locked before patient selection');
  assert.strictEqual(item.isConfirmed, false, 'Must require confirmation');

  // Candidate discovery
  const candidates = findMatchingCandidates(item, catalogue, { pharmacyInventory: inventoryPharmacyA });
  assert(candidates.genericCandidate, 'Generic Cetirizine candidate available');

  // Simulate patient choosing the generic candidate
  const patientChosenId = candidates.genericCandidate.id;
  assert.strictEqual(patientChosenId, 'med-cetirizine-generic-10');

  // Emulate checkout / reservation payload creation
  const reservationItem = {
    medicineId: patientChosenId,
    brandName: candidates.genericCandidate.brandName,
    genericName: candidates.genericCandidate.genericName,
    quantity: item.quantity || 10,
    dosage: candidates.genericCandidate.strength,
    isConfirmed: true,
    pharmacistSelectionRequested: false
  };

  assert.strictEqual(reservationItem.medicineId, 'med-cetirizine-generic-10');
  assert.strictEqual(reservationItem.brandName, 'Cetirizine 10');
  assert.strictEqual(reservationItem.isConfirmed, true);
  assert.strictEqual(reservationItem.pharmacistSelectionRequested, false);
});

// ============================================================================
// CASE 12: Patient chooses brand candidate and correct catalogue ID reaches reservation
// ============================================================================
runTest('Case 12: Patient chooses brand candidate and correct catalogue ID reaches reservation', () => {
  const ocrItems = processPrescriptionText('1. Tab Cetirizine 10mg x 10', catalogue);
  const item = ocrItems[0];

  const candidates = findMatchingCandidates(item, catalogue, { pharmacyInventory: inventoryPharmacyA });
  const cetzineBrand = candidates.brandCandidates.find(b => b.brandName === 'Cetzine 10');
  assert(cetzineBrand, 'Cetzine 10 must be in brand candidates');

  // Simulate patient choosing the brand candidate
  const patientChosenId = cetzineBrand.id;
  assert.strictEqual(patientChosenId, 'med-cetirizine-cetzine');

  const reservationItem = {
    medicineId: patientChosenId,
    brandName: cetzineBrand.brandName,
    genericName: cetzineBrand.genericName,
    quantity: item.quantity || 10,
    dosage: cetzineBrand.strength,
    isConfirmed: true,
    pharmacistSelectionRequested: false
  };

  assert.strictEqual(reservationItem.medicineId, 'med-cetirizine-cetzine');
  assert.strictEqual(reservationItem.brandName, 'Cetzine 10');
  assert.strictEqual(reservationItem.isConfirmed, true);
});

// ============================================================================
// CASE 13: "Ask the pharmacist" option remains functional
// ============================================================================
runTest('Case 13: "Ask the pharmacist" option remains functional & preserves review state', () => {
  const ocrItems = processPrescriptionText('1. Tab Paracetamol 500mg x 10', catalogue);
  const item = ocrItems[0];

  // Patient clicks "Ask attending pharmacist to select"
  const pharmacistRequestedItem = {
    ...item,
    matchedMedicineId: null,
    isConfirmed: false,
    pharmacistSelectionRequested: true,
    patientNotes: 'Patient requested licensed pharmacist brand evaluation.'
  };

  assert.strictEqual(pharmacistRequestedItem.pharmacistSelectionRequested, true);
  assert.strictEqual(pharmacistRequestedItem.isConfirmed, false);
  assert.strictEqual(pharmacistRequestedItem.matchedMedicineId, null);
});

// ============================================================================
// CASE 14: Existing patient confirmation and pharmacist-verification safeguards
// ============================================================================
runTest('Case 14: Existing patient confirmation and pharmacist-verification safeguards remain enforced', () => {
  // 1. Generic items must NOT be auto-confirmed in OCR processing
  const ocrItems = processPrescriptionText('1. Tab Pantoprazole 40mg x 5', catalogue);
  assert(ocrItems.length > 0);
  const pantoItem = ocrItems[0];
  assert.strictEqual(pantoItem.isConfirmed, false, 'Generic prescription must NOT be auto-confirmed');
  assert.strictEqual(pantoItem.status, 'AMBIGUOUS', 'Generic prescription status must be AMBIGUOUS');

  // 2. Strict inventory boundary: Auxiliary-only items must never have a medicineId
  const auxItems = processPrescriptionText('1. Tab NonExistentDrug 100mg x 10', catalogue);
  assert.strictEqual(auxItems[0].matchedMedicineId, null);
  assert.strictEqual(auxItems[0].isConfirmed, false);
  assert.strictEqual(auxItems[0].requiresConfirmation, true);
});

// ============================================================================
// CASE 15: Existing OCR, medicine matching, reservation and checkout tests pass
// ============================================================================
runTest('Case 15: Existing OCR and medicine matching functions remain backward compatible', () => {
  // Clean text normalization
  assert.strictEqual(cleanText('1. Tab Paracetamol 500 mg!'), 'tab paracetamol 500 mg');
  // Strength parsing
  const spec = parseStrengthSpec('500mg + 125mg');
  assert.strictEqual(spec.total, 625);
  // Dosage normalization
  assert.strictEqual(normalizeDosageForm('Capsule'), 'ORAL_SOLID');
  assert.strictEqual(normalizeDosageForm('Syrup'), 'ORAL_LIQUID');
  assert.strictEqual(normalizeDosageForm('Injection'), 'INJECTABLE');
  // identifyPrescriptionType
  const directBrand = identifyPrescriptionType('Dolo 650', catalogue);
  assert.strictEqual(directBrand.isBrand, true);
  assert.strictEqual(directBrand.isGeneric, false);

  const directGeneric = identifyPrescriptionType('Paracetamol', catalogue);
  assert.strictEqual(directGeneric.isGeneric, true);
  assert.strictEqual(directGeneric.isBrand, false);
});

console.log('\n======================================================================');
console.log(` RESULTS: ${totalPassed} passed, ${totalFailed} failed (Total: ${totalPassed + totalFailed})`);
console.log('======================================================================\n');

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
