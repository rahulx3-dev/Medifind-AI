/**
 * MediFind AI — Sync Inventory with Authoritative Reference Pricing
 *
 * Updates inventory items in SQLite database to match the authoritative unit prices
 * researched and recorded in server/src/data/medicineReferencePricing.json.
 *
 * RULES:
 * - Verified and estimated medicines receive their calculated per-unit price (per tablet, capsule, bottle, inhaler, vial).
 * - Unavailable products (e.g. Epinephrine Auto-Injector) are set to price: null.
 * - Displays exact update counts and before/after comparisons.
 */

const { createSafeTestPrismaClient } = require('../src/utils/testDatabaseGuard');
const { getAllReferencePricing, getReferencePricing } = require('../src/utils/referencePricing');

// Explicit test-only authorization gate for inventory price mutation
if (process.env.ALLOW_TEST_PRICE_SYNC !== 'true') {
  const errMsg = '[CRITICAL REFUSAL] syncReferencePrices mutates inventory pricing records. Execution is strictly prohibited unless explicitly authorized via ALLOW_TEST_PRICE_SYNC=true and validated against a disposable test database.';
  console.error(errMsg);
  const err = new Error(errMsg);
  err.code = 'UNAUTHORIZED_PRICE_SYNC';
  throw err;
}

const prisma = createSafeTestPrismaClient();

async function syncPrices() {
  console.log('🔄 MediFind AI — Syncing Inventory with Reference Pricing Catalog...\n');

  const catalogue = getAllReferencePricing();
  console.log(`Loaded ${catalogue.length} reference pricing records from medicineReferencePricing.json.\n`);

  const pharmacies = await prisma.pharmacy.findMany({
    include: {
      inventory: {
        include: { medicine: true }
      }
    }
  });

  let totalUpdated = 0;
  let totalNull = 0;

  for (const pharm of pharmacies) {
    console.log(`Pharmacy: ${pharm.name} (${pharm.inventory.length} items)`);

    for (const inv of pharm.inventory) {
      const ref = getReferencePricing(inv.medicine.brandName, inv.medicine.genericName);
      // Authoritative Unit Pricing:
      // For tablets & capsules in multi-unit strips: unitPrice is the price per tablet (e.g. ₹12.85 for Pan 40, ₹2.15 for Dolo 650)
      // For syrups, inhalers, injections: unitPrice equals pack MRP.
      const newPrice = (ref && ref.unitPrice != null) ? ref.unitPrice : ((ref && ref.publishedMrp != null) ? ref.publishedMrp : null);

      await prisma.inventory.update({
        where: { id: inv.id },
        data: { price: newPrice }
      });

      if (newPrice != null) {
        totalUpdated++;
      } else {
        totalNull++;
        console.log(`   [UNPRICED/COUNTER] ${inv.medicine.brandName} -> price: null (${ref ? ref.status : 'NOT_FOUND'})`);
      }
    }
  }

  console.log(`\n✅ Sync complete: ${totalUpdated} inventory items updated with unit prices, ${totalNull} items kept unpriced (null).`);
}

syncPrices()
  .catch(err => {
    console.error('Error syncing prices:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
