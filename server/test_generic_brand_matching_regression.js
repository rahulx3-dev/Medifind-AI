const { identifyPrescriptionType, findMatchingCandidates } = require('./src/utils/genericMedicineMatcher');

const mockCatalog = [
  { id: 'taxim-o-200', brandName: 'Taxim-O 200', genericName: 'Cefixime', strength: '200mg', dosageForm: 'Tablet', price: 145, stock: 24, inStock: true, manufacturer: 'Alkem' },
  { id: 'zifi-200', brandName: 'Zifi 200', genericName: 'Cefixime', strength: '200mg', dosageForm: 'Tablet', price: 152, stock: 12, inStock: true, manufacturer: 'FDC Ltd' },
  { id: 'pan-40', brandName: 'Pan 40', genericName: 'Pantoprazole', strength: '40mg', dosageForm: 'Tablet', price: 95, stock: 40, inStock: true, manufacturer: 'Alkem' },
  { id: 'pantocid-40', brandName: 'Pantocid 40', genericName: 'Pantoprazole', strength: '40mg', dosageForm: 'Tablet', price: 102, stock: 18, inStock: true, manufacturer: 'Sun Pharma' },
  { id: 'dolo-650', brandName: 'Dolo 650', genericName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet', price: 30, stock: 100, inStock: true, manufacturer: 'Micro Labs' },
  { id: 'calpol-500', brandName: 'Calpol 500', genericName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet', price: 25, stock: 80, inStock: true, manufacturer: 'GSK' },
  { id: 'paracetamol-generic', brandName: 'Paracetamol 500 Generic', genericName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet', price: 12, stock: 50, inStock: true, manufacturer: 'Jan Aushadhi', isGenericProduct: true }
];

console.log('--- TEST 1: Physical Slip OCR "Cetixime Tab lp 200mg" ---');
const item1 = {
  medicineName: 'Taxim-O 200', // matched formulation
  rawName: 'Cetixime Tab lp 200mg', // raw OCR slip reading
  primaryOcrText: 'Cetixime Tab lp 200mg',
  matchedMedicineId: 'taxim-o-200',
  matchedMedicineName: 'Taxim-O 200',
  strength: '200mg'
};

const rxType1 = identifyPrescriptionType(item1, mockCatalog);
console.log('rxType1:', rxType1);
if (!rxType1.isGeneric) {
  throw new Error('FAILED: Cetixime Tab lp 200mg should be recognized as generic!');
}
if (rxType1.targetGeneric !== 'Cefixime') {
  throw new Error(`FAILED: targetGeneric should be Cefixime, got: ${rxType1.targetGeneric}`);
}

const candidates1 = findMatchingCandidates(item1, mockCatalog);
console.log('candidates1 brands count:', candidates1.brandCandidates.length);
if (candidates1.brandCandidates.length < 2) {
  throw new Error('FAILED: Expected at least 2 brand candidates (Taxim-O, Zifi)!');
}
console.log('✓ TEST 1 PASSED: Cefixime correctly identified as generic with bioequivalent brand options');

console.log('\n--- TEST 2: Direct Active Compound "Pantoprazole 40mg" ---');
const item2 = {
  rawName: 'Pantoprazole 40mg',
  medicineName: 'Pan 40',
  primaryOcrText: 'Pantoprazole 40mg',
  strength: '40mg'
};
const rxType2 = identifyPrescriptionType(item2, mockCatalog);
console.log('rxType2:', rxType2);
if (!rxType2.isGeneric || rxType2.targetGeneric !== 'Pantoprazole') {
  throw new Error('FAILED: Pantoprazole 40mg should be generic Pantoprazole');
}
console.log('✓ TEST 2 PASSED: Pantoprazole correctly classified as generic');

console.log('\n--- TEST 3: Doctor Prescribes Brand "Dolo 650" ---');
const item3 = {
  rawName: 'Dolo 650 1 tab TDS',
  medicineName: 'Dolo 650',
  primaryOcrText: 'Dolo 650 1 tab TDS',
  strength: '650mg'
};
const rxType3 = identifyPrescriptionType(item3, mockCatalog);
console.log('rxType3:', rxType3);
if (rxType3.isGeneric) {
  throw new Error('FAILED: Dolo 650 is a brand, not generic!');
}
console.log('✓ TEST 3 PASSED: Dolo 650 correctly classified as brand prescription');

console.log('\n--- TEST 4: Paracetamol Generic with Generic In Catalogue ---');
const item4 = {
  rawName: 'Tab Paracetamol 500mg',
  primaryOcrText: 'Tab Paracetamol 500mg',
  strength: '500mg'
};
const candidates4 = findMatchingCandidates(item4, mockCatalog);
console.log('candidates4 hasGenericInCatalogue:', candidates4.hasGenericInCatalogue);
console.log('candidates4 genericCandidate:', candidates4.genericCandidate?.brandName);
console.log('candidates4 brandCandidates count:', candidates4.brandCandidates.length);
if (!candidates4.genericCandidate) {
  throw new Error('FAILED: Expected genericCandidate for Paracetamol 500 Generic');
}
console.log('✓ TEST 4 PASSED: Generic Product detected and separated from Trade Brands');

console.log('\n🎉 ALL REGRESSION TESTS PASSED!');
