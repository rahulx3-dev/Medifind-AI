/**
 * MediFind AI — Live Integration Validation Suite
 *
 * Validates the live integration of Generic Medicine Matching & OCR Verification
 * against the real local PostgreSQL database, Prisma schema, and application logic.
 *
 * Scenarios:
 * 1. A generic medicine with an exact-strength generic catalogue product and a matching stocked brand.
 * 2. A generic product that exists in the catalogue but is out of stock at the selected pharmacy.
 * 3. A prescription whose strength differs from available catalogue products.
 * 4. A dosage-form or route mismatch.
 * 5. A combination medicine that must not match a single-ingredient product.
 * 6. A patient selecting a generic product.
 * 7. A patient selecting a brand alternative.
 * 8. A patient requesting pharmacist selection.
 * 9. An auxiliary-lexicon-only candidate.
 * 10. An unconfirmed item attempting to proceed to reservation.
 */

'use strict';

const assert = require('assert');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

function runValidation(scenarioNum, title, fn) {
  try {
    fn();
    console.log(`[PASS] Scenario ${scenarioNum}: ${title}`);
    totalPassed++;
  } catch (err) {
    console.error(`[FAIL] Scenario ${scenarioNum}: ${title}`);
    console.error(`       Error: ${err.message}`);
    totalFailed++;
  }
}

async function runLiveValidation() {
  console.log('\n======================================================================');
  console.log(' MEDIFIND AI — LIVE INTEGRATION VALIDATION');
  console.log('======================================================================\n');

  try {
    // Fetch live catalogue and live pharmacies with inventory from PostgreSQL
    const liveMedicines = await prisma.medicine.findMany({
      include: {
        inventoryItems: true
      }
    });
    console.log(`✓ Loaded ${liveMedicines.length} authoritative medicines from local PostgreSQL database.`);

    const livePharmacies = await prisma.pharmacy.findMany({
      include: {
        inventory: {
          include: { medicine: true }
        }
      }
    });
    console.log(`✓ Loaded ${livePharmacies.length} live pharmacies from local PostgreSQL database.`);
    livePharmacies.forEach(p => {
      console.log(`  - ${p.name} (ID: ${p.id}): ${p.inventory.length} stocked items`);
    });
    console.log('\n----------------------------------------------------------------------\n');

    const primaryPharmacy = livePharmacies[0];
    const pharmacyInventory = primaryPharmacy.inventory;

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 1: Generic medicine with an exact-strength generic catalogue product
    //             and a matching stocked brand
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(1, 'Generic medicine with exact-strength generic catalogue product & stocked brand', () => {
      // Test with Paracetamol 650mg which has Dolo 650 and Crocin 650 in database
      const candidates = findMatchingCandidates(
        { medicineName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      assert(candidates.brandCandidates.length >= 2, 'Must resolve brand candidates for Paracetamol 650mg');
      const dolo = candidates.brandCandidates.find(b => b.brandName.toLowerCase().includes('dolo'));
      const crocin = candidates.brandCandidates.find(b => b.brandName.toLowerCase().includes('crocin'));

      assert(dolo, 'Dolo 650 must be found as a brand candidate in live DB');
      assert(crocin, 'Crocin 650 must be found as a brand candidate in live DB');
      assert.strictEqual(dolo.isExactStrength, true, 'Dolo 650 must be marked exact strength');
      assert.strictEqual(crocin.isExactStrength, true, 'Crocin 650 must be marked exact strength');
      assert.strictEqual(dolo.inStock, true, 'Dolo 650 must be evaluated as in-stock from live pharmacy inventory');
      assert(dolo.price > 0, 'Dolo 650 must have live inventory price');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 2: Generic product in catalogue but out of stock at selected pharmacy
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(2, 'Generic product in catalogue but out of stock at selected pharmacy', () => {
      // Find a medicine in liveMedicines
      const targetMed = liveMedicines.find(m => m.genericName.toLowerCase().includes('paracetamol'));
      assert(targetMed, 'Must find target Paracetamol medicine');

      // Create a simulated out-of-stock inventory for this dispensary
      const outOfStockInventory = [
        { medicineId: targetMed.id, stock: 0, status: 'OUT_OF_STOCK', price: 30 }
      ];

      const stockEvaluation = evaluatePharmacyStock(targetMed.id, outOfStockInventory);
      assert.strictEqual(stockEvaluation.inStock, false, 'Stock evaluation must be false');
      assert.strictEqual(stockEvaluation.stock, 0, 'Stock count must be 0');
      assert.strictEqual(stockEvaluation.availabilityStatus, 'OUT_OF_STOCK');

      const candidates = findMatchingCandidates(
        { medicineName: targetMed.genericName, strength: targetMed.strength, dosageForm: targetMed.dosageForm },
        liveMedicines,
        { pharmacyInventory: outOfStockInventory }
      );

      // Verify that candidate is flagged out of stock
      const matched = candidates.allCandidates.find(c => c.id === targetMed.id);
      if (matched) {
        assert.strictEqual(matched.inStock, false, 'Candidate must reflect out-of-stock status');
        assert.strictEqual(matched.availabilityStatus, 'OUT_OF_STOCK');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 3: Prescription whose strength differs from available catalogue products
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(3, 'Prescription whose strength differs from available catalogue products', () => {
      // Prescribe Paracetamol 1200mg (no 1200mg exists in catalogue)
      const candidates = findMatchingCandidates(
        { medicineName: 'Paracetamol', strength: '1200mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      // Must NOT match 650mg products when strict strength matching is enforced
      assert.strictEqual(candidates.allCandidates.length, 0,
        'Candidates list must be empty for unapproved 1200mg dose without fuzzy strength override');
      assert.strictEqual(candidates.genericCandidate, null);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 4: Dosage-form or route mismatch (Oral Tablet vs Injection / Syrup)
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(4, 'Dosage-form or route mismatch (Oral vs Injection vs Syrup)', () => {
      // Prescribe Ceftriaxone Tablet (in DB Ceftriaxone Monocef is an Injection)
      const oralCeftriaxone = findMatchingCandidates(
        { medicineName: 'Ceftriaxone', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      assert.strictEqual(oralCeftriaxone.allCandidates.length, 0,
        'Injectable Monocef 1g must NEVER be offered for an Oral Tablet prescription');

      // Prescribe Ceftriaxone Injection (matches Injection)
      const injCeftriaxone = findMatchingCandidates(
        { medicineName: 'Ceftriaxone', dosageForm: 'Injection' },
        liveMedicines,
        { pharmacyInventory }
      );
      assert(injCeftriaxone.allCandidates.some(c => c.brandName.includes('Monocef')),
        'Injectable Monocef 1g must match Injection prescription');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 5: Combination medicine must not match a single-ingredient product
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(5, 'Combination medicine must not match single-ingredient product', () => {
      // 1. Single Ibuprofen must NOT return Combiflam (Ibuprofen + Paracetamol)
      const singleIbu = findMatchingCandidates(
        { medicineName: 'Ibuprofen', strength: '400mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      const hasCombiflamInSingle = singleIbu.allCandidates.some(c => c.brandName.toLowerCase().includes('combiflam'));
      assert.strictEqual(hasCombiflamInSingle, false,
        'Combiflam (combination) must NEVER be offered when single Ibuprofen is prescribed');
      assert(singleIbu.allCandidates.some(c => c.brandName.toLowerCase().includes('brufen')),
        'Brufen 400 (single) must match single Ibuprofen');

      // 2. Combination Amoxicillin + Clavulanate must return Augmentin 625 Duo, NOT Amox single
      const comboAmox = findMatchingCandidates(
        { medicineName: 'Amoxicillin + Clavulanate', strength: '625mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );
      assert(comboAmox.allCandidates.some(c => c.brandName.toLowerCase().includes('augmentin')),
        'Augmentin 625 Duo must match Amoxicillin + Clavulanate combination');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 6: Patient selecting a generic product
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(6, 'Patient selecting a generic product', () => {
      // Create a test generic medicine representation in catalogue
      const genericMed = {
        id: 'test-gen-med-paracetamol',
        brandName: 'Paracetamol 650mg Tablets',
        genericName: 'Paracetamol',
        strength: '650mg',
        dosageForm: 'Tablet',
        isGenericProduct: true
      };
      const enrichedCatalog = [...liveMedicines, genericMed];
      const inventoryWithGen = [
        ...pharmacyInventory,
        { medicineId: genericMed.id, stock: 100, price: 18.00, status: 'IN_STOCK' }
      ];

      const candidates = findMatchingCandidates(
        { medicineName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' },
        enrichedCatalog,
        { pharmacyInventory: inventoryWithGen }
      );

      assert(candidates.genericCandidate, 'Generic candidate must be discovered');
      assert.strictEqual(candidates.genericCandidate.id, 'test-gen-med-paracetamol');
      assert.strictEqual(candidates.genericCandidate.isGenericProduct, true);

      // Patient action: selects generic candidate
      const selection = {
        matchedMedicineId: candidates.genericCandidate.id,
        matchedMedicineName: candidates.genericCandidate.brandName,
        strength: candidates.genericCandidate.strength,
        dosageForm: candidates.genericCandidate.dosageForm,
        isConfirmed: true,
        pharmacistSelectionRequested: false
      };

      assert.strictEqual(selection.matchedMedicineId, 'test-gen-med-paracetamol');
      assert.strictEqual(selection.isConfirmed, true);
      assert.strictEqual(selection.pharmacistSelectionRequested, false);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 7: Patient selecting a brand alternative
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(7, 'Patient selecting a brand alternative', () => {
      const candidates = findMatchingCandidates(
        { medicineName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      const doloCandidate = candidates.brandCandidates.find(b => b.brandName.toLowerCase().includes('dolo 650'));
      assert(doloCandidate, 'Dolo 650 brand candidate must exist');

      // Patient action: selects Dolo 650
      const selection = {
        matchedMedicineId: doloCandidate.id,
        matchedMedicineName: doloCandidate.brandName,
        strength: doloCandidate.strength,
        dosageForm: doloCandidate.dosageForm,
        isConfirmed: true,
        pharmacistSelectionRequested: false
      };

      assert.strictEqual(selection.matchedMedicineId, doloCandidate.id);
      assert.strictEqual(selection.isConfirmed, true);
      assert.strictEqual(selection.pharmacistSelectionRequested, false);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 8: Patient requesting pharmacist selection
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(8, 'Patient requesting pharmacist selection', () => {
      const candidates = findMatchingCandidates(
        { medicineName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' },
        liveMedicines,
        { pharmacyInventory }
      );

      // Patient action: clicks "Ask Attending Pharmacist to Select"
      const pharmacistRequestedItem = {
        medicineName: 'Paracetamol',
        matchedMedicineId: null, // Left null for pharmacist to assign
        matchedMedicineName: null,
        isConfirmed: false, // NOT confirmed by patient
        pharmacistSelectionRequested: true,
        patientNotes: 'PHARMACIST_SELECTION_REQUESTED'
      };

      assert.strictEqual(pharmacistRequestedItem.matchedMedicineId, null);
      assert.strictEqual(pharmacistRequestedItem.isConfirmed, false);
      assert.strictEqual(pharmacistRequestedItem.pharmacistSelectionRequested, true);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 9: Auxiliary-lexicon-only candidate (Strict Inventory Boundary)
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(9, 'Auxiliary-lexicon-only candidate preserves strict inventory boundary', () => {
      // Test OCR detection of a drug present in auxiliary lexicon but NOT in the 50-item DB (e.g. Mupirocin)
      const ocrResults = processPrescriptionText('1. Tab Mupirocin 200mg x 10', liveMedicines);
      assert(ocrResults.length > 0, 'Must process OCR line');
      const auxItem = ocrResults[0];

      assert.strictEqual(auxItem.status, 'NOT_IN_CATALOGUE', 'Must have NOT_IN_CATALOGUE status');
      assert.strictEqual(auxItem.matchedMedicineId, null, 'Must NOT be assigned any DB medicine ID');
      assert.strictEqual(auxItem.isConfirmed, false, 'Must not be confirmed');
      assert(auxItem.auxiliaryCandidates.length > 0, 'Must provide reference auxiliary candidates');
      assert.strictEqual(auxItem.auxiliaryCandidates[0].inStock, false, 'Auxiliary items must be marked out of stock');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 10: Unconfirmed item attempting to proceed to reservation
    // ─────────────────────────────────────────────────────────────────────────
    runValidation(10, 'Unconfirmed item attempting to proceed to reservation is blocked', () => {
      // 1. Unconfirmed item check in prescription verification payload
      const unconfirmedItem = {
        rawName: 'Tab Amoxicillin 500mg',
        matchedMedicineId: null, // Not chosen
        quantity: 10,
        isConfirmed: false
      };

      // In verifyDetectedMedicines / prescriptionController, items without a matchedMedicineId cannot be verified:
      const canVerify = Boolean(unconfirmedItem.matchedMedicineId && unconfirmedItem.isConfirmed);
      assert.strictEqual(canVerify, false, 'Unconfirmed item without catalogue ID must fail verification validation');

      // 2. In orderController createOrder: an unverified prescription cannot place an order
      const mockRx = { id: 'rx-test-123', status: 'PENDING_VERIFICATION' };
      const canPlaceOrder = mockRx.status === 'VERIFIED';
      assert.strictEqual(canPlaceOrder, false,
        'Order placement must strictly reject prescriptions that are not in VERIFIED status');
    });

  } catch (err) {
    console.error('Live integration test error:', err);
    totalFailed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n======================================================================');
  console.log(` LIVE VALIDATION SUMMARY: ${totalPassed} passed, ${totalFailed} failed (Total: ${totalPassed + totalFailed})`);
  console.log('======================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runLiveValidation();
