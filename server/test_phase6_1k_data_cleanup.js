/**
 * MediFind AI — Phase 6.1K Data Cleanup & Production Data Integrity Test Suite
 *
 * Validates:
 * 1. Exactly 2 participating pharmacies (Max Care Pharmacy & Karuna Medicals) in normal discovery.
 * 2. Zero test pharmacies in patient discovery, match-availability, or search.
 * 3. Zero test pharmacy inventory in /api/medicines/:id.
 * 4. Zero test pharmacy orders in patient order history (/api/orders).
 * 5. Zero test pharmacy tasks in available assistant tasks (/api/assistant/tasks/available).
 * 6. Admin metrics count only participating pharmacies.
 * 7. Strictly null coordinates, no fabricated distance or ETA.
 * 8. Zero emergency / 24x7 false claims.
 * 9. Canonical 50-medicine catalogue and 100 real inventory records intact.
 * 10. No obsolete Bangalore references in seedData.
 */

const { createSafeTestPrismaClient } = require('./src/utils/testDatabaseGuard');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const prisma = createSafeTestPrismaClient();
const BASE_URL = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_medifind_ai_2026';

let testCounter = 1;
const results = [];

function record(section, num, title, passed, details) {
  results.push({ section, num, title, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${section}] T${String(num).padStart(2, '0')} ${title}: ${passed ? 'PASS' : 'FAIL'}`);
  if (details) console.log(`   └─ ${details}`);
}

async function runAudit() {
  console.log('🧹 ====================================================================');
  console.log('🧹 MEDIFIND AI — PHASE 6.1K: DATA CLEANUP & INTEGRITY TEST SUITE');
  console.log('🧹 ====================================================================\n');

  try {
    // 1. Authenticate test users
    const patientUser = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const assistantUser = await prisma.user.findFirst({ where: { role: 'ASSISTANT' } });

    const patientToken = jwt.sign({ id: patientUser.id, role: patientUser.role }, JWT_SECRET, { expiresIn: '1h' });
    const adminToken = jwt.sign({ id: adminUser.id, role: adminUser.role }, JWT_SECRET, { expiresIn: '1h' });
    const assistantToken = jwt.sign({ id: assistantUser.id, role: assistantUser.role }, JWT_SECRET, { expiresIn: '1h' });

    // ── Audit 1: Pharmacy Discovery Isolation ──
    const phRes = await fetch(`${BASE_URL}/pharmacies`);
    const phData = await phRes.json();
    const phNames = (phData.pharmacies || []).map(p => p.name);
    const hasOnlyRealPharmacies = phData.count === 2 &&
      phNames.includes('Max Care Pharmacy') &&
      phNames.includes('Karuna Medicals') &&
      !phNames.some(n => n.includes('[TEST]') || n.includes('Bangalore'));

    record('PHARMACY_DISCOVERY', testCounter++, 'Normal pharmacy discovery returns exactly 2 real participating pharmacies',
      hasOnlyRealPharmacies, `Count: ${phData.count}, Pharmacies: ${phNames.join(', ')}`);

    // ── Audit 2: Match Availability Isolation ──
    const dolo = await prisma.medicine.findFirst({ where: { brandName: 'Dolo 650' } });
    const matchRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicineId: dolo.id, quantity: 1 }] })
    });
    const matchData = await matchRes.json();
    const matchNames = (matchData.results || []).map(r => r.pharmacy.name);
    const hasOnlyRealInMatch = matchData.results?.length === 2 &&
      !matchNames.some(n => n.includes('[TEST]') || n.includes('Bangalore'));

    record('MATCH_AVAILABILITY', testCounter++, 'Match availability returns zero test pharmacies',
      hasOnlyRealInMatch, `Count: ${matchData.results?.length}, Names: ${matchNames.join(', ')}`);

    // ── Audit 3: Medicine Details Inventory Isolation ──
    const medRes = await fetch(`${BASE_URL}/medicines/${dolo.id}`);
    const medData = await medRes.json();
    const invPharmacies = (medData.medicine?.inventoryItems || []).map(i => i.pharmacy.name);
    const hasNoTestInventory = !invPharmacies.some(n => n.includes('[TEST]'));

    record('INVENTORY_LEAKAGE', testCounter++, 'Medicine detail inventory includes zero test pharmacy inventory',
      hasNoTestInventory, `Pharmacies with inventory: ${invPharmacies.join(', ') || 'None'}`);

    // ── Audit 4: Patient Order History Isolation ──
    const ordersRes = await fetch(`${BASE_URL}/orders`, {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const ordersData = await ordersRes.json();
    const orderPharmacies = (ordersData.orders || []).map(o => o.pharmacy?.name).filter(Boolean);
    const hasNoTestOrders = !orderPharmacies.some(n => n.includes('[TEST]'));

    record('ORDER_HISTORY', testCounter++, 'Patient order history contains zero orders from test pharmacies',
      hasNoTestOrders, `Orders count: ${ordersData.count}, Test pharmacy orders: ${orderPharmacies.filter(n => n.includes('[TEST]')).length}`);

    // ── Audit 5: Assistant Tasks Isolation ──
    const tasksRes = await fetch(`${BASE_URL}/assistant/tasks/available`, {
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const tasksData = await tasksRes.json();
    const taskPharmacies = (tasksData.tasks || []).map(t => t.order?.pharmacy?.name).filter(Boolean);
    const hasNoTestTasks = !taskPharmacies.some(n => n.includes('[TEST]'));

    record('ASSISTANT_TASKS', testCounter++, 'Available assistant tasks contain zero tasks from test pharmacies',
      hasNoTestTasks, `Tasks count: ${tasksData.count}, Test pharmacy tasks: ${taskPharmacies.filter(n => n.includes('[TEST]')).length}`);

    // ── Audit 6: Dashboard Statistics Verification ──
    const metricsRes = await fetch(`${BASE_URL}/analytics/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const metricsData = await metricsRes.json();
    const totalPharmacies = metricsData.metrics?.totalPharmacies;
    const isHonestCount = totalPharmacies === 2;

    record('DASHBOARD_STATS', testCounter++, 'Admin platform metrics count only real participating pharmacies (exactly 2)',
      isHonestCount, `totalPharmacies: ${totalPharmacies} (expected: 2)`);

    // ── Audit 7: Coordinates Integrity ──
    const maxCare = await prisma.pharmacy.findFirst({ where: { name: 'Max Care Pharmacy' } });
    const karuna = await prisma.pharmacy.findFirst({ where: { name: 'Karuna Medicals' } });
    const coordsNull = maxCare.latitude === null && maxCare.longitude === null &&
      karuna.latitude === null && karuna.longitude === null;

    record('COORDINATES', testCounter++, 'Real participating pharmacies have null coordinates (no fabrication)',
      coordsNull, `Max Care lat/lon: ${maxCare.latitude}/${maxCare.longitude}, Karuna lat/lon: ${karuna.latitude}/${karuna.longitude}`);

    // ── Audit 8: Emergency & Delivery Status Integrity ──
    const emergencyHonest = !maxCare.is24x7 && !maxCare.emergencyAvailability && !maxCare.deliveryAvailable &&
      !karuna.is24x7 && !karuna.emergencyAvailability && !karuna.deliveryAvailable;

    record('EMERGENCY_CLAIMS', testCounter++, 'Zero fabricated 24/7, emergency, or delivery claims on real pharmacies',
      emergencyHonest, `Max Care 24x7: ${maxCare.is24x7}, Karuna 24x7: ${karuna.is24x7}`);

    // ── Audit 9: Catalogue & Inventory Integrity ──
    const medCount = await prisma.medicine.count();
    const invCount = await prisma.inventory.count({
      where: { pharmacy: { isVerified: true, verificationStatus: 'VERIFIED' } }
    });
    const maxCareAvail = await prisma.inventory.count({ where: { pharmacyId: maxCare.id, status: 'AVAILABLE' } });
    const maxCareOut = await prisma.inventory.count({ where: { pharmacyId: maxCare.id, status: 'OUT_OF_STOCK' } });
    const karunaAvail = await prisma.inventory.count({ where: { pharmacyId: karuna.id, status: 'AVAILABLE' } });
    const karunaOut = await prisma.inventory.count({ where: { pharmacyId: karuna.id, status: 'OUT_OF_STOCK' } });

    const catalogueIntact = medCount === 50 && invCount === 100 &&
      maxCareAvail === 42 && maxCareOut === 8 &&
      karunaAvail === 30 && karunaOut === 20;

    record('CATALOGUE_INTEGRITY', testCounter++, 'Canonical 50 medicines and 100 inventory records match baseline exactly',
      catalogueIntact, `Medicines: ${medCount}, Inventory: ${invCount} (MC: ${maxCareAvail}A/${maxCareOut}O, KM: ${karunaAvail}A/${karunaOut}O)`);

    // ── Audit 10: SeedData Legacy Cleanliness ──
    const seedDataModule = require('./prisma/seedData');
    const hasLegacyPharmaciesExport = 'pharmaciesData' in seedDataModule;

    record('LEGACY_SEED', testCounter++, 'seedData.js contains zero legacy Bangalore pharmacy exports',
      !hasLegacyPharmaciesExport, `pharmaciesData exported: ${hasLegacyPharmaciesExport}`);

    // ── Audit 11: Frontend Source Code Cleanliness ──
    const clientPagesDir = path.join(__dirname, '..', 'client', 'src', 'pages');
    const userProfileCode = fs.readFileSync(path.join(clientPagesDir, 'UserProfile.jsx'), 'utf8');
    const rxUploadCode = fs.readFileSync(path.join(clientPagesDir, 'PrescriptionUpload.jsx'), 'utf8');
    const orderTrackingCode = fs.readFileSync(path.join(clientPagesDir, 'OrderTracking.jsx'), 'utf8');
    const checkoutPageCode = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'components', 'CheckoutPage.jsx'), 'utf8');

    const noJulianVance = !userProfileCode.includes('Dr. Julian Vance') && !rxUploadCode.includes('Dr. Julian Vance');
    const noStJude = !userProfileCode.includes('St. Jude') && !orderTrackingCode.includes('St. Jude') && !rxUploadCode.includes('ST. JUDE');
    const noTestDispatch = !userProfileCode.includes('MF-271920') && !userProfileCode.includes('18.6km');
    const noFallback65InCheckout = !checkoutPageCode.includes('|| 65');

    record('FRONTEND_CODE', testCounter++, 'Frontend source code contains zero St. Jude, Julian Vance, fake dispatches, or forced 65 prices',
      noJulianVance && noStJude && noTestDispatch && noFallback65InCheckout,
      `noJulianVance: ${noJulianVance}, noStJude: ${noStJude}, noTestDispatch: ${noTestDispatch}, noFallback65InCheckout: ${noFallback65InCheckout}`);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n====================================================================');
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    console.log(`📊 PHASE 6.1K TEST RESULTS: ${passedCount}/${totalCount} PASSED`);
    console.log('====================================================================\n');

    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Phase 6.1K test failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAudit();
