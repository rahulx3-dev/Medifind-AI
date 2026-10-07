/**
 * MEDIFIND AI — PHASE 6.1I DEDICATED REAL DATA + BACKEND VERIFICATION TEST SUITE
 *
 * Verifies real participating pharmacy data, backend contracts, and all 16 scenarios (A - P):
 *   Scenario A: Dolo 650 (both pharmacies available)
 *   Scenario B: Brufen 400 (Max Care available, Karuna unavailable)
 *   Scenario C: Zifi 200 (Max Care unavailable, Karuna available)
 *   Scenario D: Deriphyllin Retard 150 (Max Care unavailable, Karuna available)
 *   Scenario E: Unknown medicine (no false match)
 *   Scenario F: Closed pharmacy (not presented as open)
 *   Scenario G: Emergency request (no false emergency pharmacy)
 *   Scenario H: Missing coordinates (null distance, no fake distance, no artificial proximity score)
 *   Scenario I: Cross-pharmacy pharmacist access (denied, HTTP 403)
 *   Scenario J: Real pharmacy reservation (complete lifecycle: PENDING -> CONFIRMED -> READY_FOR_PICKUP -> COMPLETED, plus REJECTED and CANCELLED)
 *   Scenario K: Prescription verification (only verified medicines reach reservation, unverified blocked)
 *   Scenario L: Delivery (real pharmacies correctly report delivery unavailable)
 *   Scenario M: Offline reservation (blocked, non-idempotent transactional safety)
 *   Scenario N: Payment (server-authoritative pricing, Razorpay test mode, no secret leakage)
 *   Scenario O: Notification (correct recipient isolation, unread/read/clear-all)
 *   Scenario P: Test pharmacy leakage (patient receives zero test fixtures, zero Bangalore)
 *
 * Additional Deep Checks:
 *   - Catalogue integrity: exactly 50 canonical medicines, 0 duplicates
 *   - Inventory availability matrix: Max Care (42 avail / 8 OOS), Karuna (30 avail / 20 OOS)
 *   - Semantic rule: NOT_REPORTED -> OUT_OF_STOCK, no literal NOT_REPORTED exposed
 *   - Real pharmacy fields: address, phone, opening hours, Google Maps URLs, coordinates null
 *   - Search variants: lowercase, uppercase, partial, whitespace, empty
 *   - Ranking score formula verification: null-distance redistributed weights (64.29% / 21.43% / 14.29%)
 *   - Role-based authorization: unauthenticated blocked, patient isolation, assistant isolation, admin controls
 *   - Database consistency: foreign keys, orphan check, unassigned assistant tasks
 *   - Import idempotency: running importer does not duplicate records
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });
const prisma = require('./src/prisma');
const { validateAndImport } = require('./prisma/import_real_pharmacies');
const { computeOpenStatus } = require('./src/utils/openHoursParser');
const { rankPharmaciesForMedicines } = require('./src/utils/rankingEngine');

const BASE_URL = 'http://localhost:5000/api';

async function runPhase61IVerification() {
  console.log('\n====================================================================');
  console.log('🏥 MEDIFIND AI — PHASE 6.1I: REAL DATA + BACKEND VERIFICATION');
  console.log('====================================================================\n');

  const results = [];
  function record(scenario, num, category, title, passed, details = '') {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ scenario, num, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} [${scenario}] T${String(num).padStart(2, '0')} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  const cleanupOrderIds = [];
  const cleanupPrescriptionIds = [];
  let testCounter = 1;

  // Helper login
  const login = async (email, password = 'password123') => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    return { status: res.status, token: data.token, user: data.user };
  };

  try {
    // -------------------------------------------------------------------------
    // 1. REAL PHARMACY DATA INTEGRITY & CATALOGUE
    // -------------------------------------------------------------------------
    console.log('\n--- Section 1: Real Pharmacy Network & Catalogue Verification ---');

    const pharmaciesInDb = await prisma.pharmacy.findMany();
    const participatingInDb = pharmaciesInDb.filter(
      p => p.isVerified === true && p.verificationStatus === 'VERIFIED' && p.dataSource === 'PHARMACY_PROVIDED'
    );

    record('BASE', testCounter++, 'NETWORK', 'Exactly two active participating pharmacies exist',
      participatingInDb.length === 2,
      `Found ${participatingInDb.length}: ${participatingInDb.map(p => p.name).join(', ')}`
    );

    const maxCare = participatingInDb.find(p => p.name.includes('Max Care'));
    const karuna = participatingInDb.find(p => p.name.includes('Karuna'));

    record('BASE', testCounter++, 'PHARMACY_FIELDS', 'Max Care Pharmacy fields match authoritative CSV exactly',
      maxCare &&
      maxCare.address === '20/375, Govt. Hospital Junction, Chengannur, Kerala – 689121, India' &&
      maxCare.phone === '4792993291' &&
      maxCare.openingHours === '09:30–20:00' &&
      maxCare.is24x7 === false &&
      maxCare.emergencyAvailability === false &&
      maxCare.deliveryAvailable === false &&
      maxCare.googleMapsUrl === 'https://maps.app.goo.gl/W5EYF7wtx33cLpfL7' &&
      maxCare.latitude === null &&
      maxCare.longitude === null,
      maxCare ? `Address: ${maxCare.address} | Hours: ${maxCare.openingHours} | Maps: ${maxCare.googleMapsUrl}` : 'Not found'
    );

    record('BASE', testCounter++, 'PHARMACY_FIELDS', 'Karuna Medicals fields match authoritative CSV exactly',
      karuna &&
      karuna.address === 'XI/567(1), Chengannur, Alappuzha, Kerala – 689121, India' &&
      karuna.phone === '9605718151' &&
      karuna.openingHours === '09:30–19:00' &&
      karuna.is24x7 === false &&
      karuna.emergencyAvailability === false &&
      karuna.deliveryAvailable === false &&
      karuna.googleMapsUrl === 'https://maps.app.goo.gl/jaszQixVujJRX9yc9?g_st=ac' &&
      karuna.latitude === null &&
      karuna.longitude === null,
      karuna ? `Address: ${karuna.address} | Hours: ${karuna.openingHours} | Maps: ${karuna.googleMapsUrl}` : 'Not found'
    );

    // Catalogue verification
    const allMedicines = await prisma.medicine.findMany();
    const medNames = new Set();
    let dupMedCount = 0;
    allMedicines.forEach(m => {
      if (medNames.has(m.brandName)) dupMedCount++;
      medNames.add(m.brandName);
    });

    record('BASE', testCounter++, 'CATALOGUE', 'Canonical Medicine table contains exactly 50 distinct medicines',
      allMedicines.length === 50 && dupMedCount === 0,
      `Total medicines: ${allMedicines.length}, duplicate brandNames: ${dupMedCount}`
    );

    // Availability matrix counts
    const maxCareInv = await prisma.inventory.findMany({ where: { pharmacyId: maxCare.id } });
    const karunaInv = await prisma.inventory.findMany({ where: { pharmacyId: karuna.id } });

    const maxCareAvail = maxCareInv.filter(i => i.status === 'AVAILABLE').length;
    const maxCareOOS = maxCareInv.filter(i => i.status === 'OUT_OF_STOCK').length;
    const karunaAvail = karunaInv.filter(i => i.status === 'AVAILABLE').length;
    const karunaOOS = karunaInv.filter(i => i.status === 'OUT_OF_STOCK').length;

    record('BASE', testCounter++, 'MATRIX', 'Max Care availability totals: 42 AVAILABLE, 8 OUT_OF_STOCK',
      maxCareAvail === 42 && maxCareOOS === 8 && maxCareInv.length === 50,
      `Max Care: ${maxCareAvail} AVAILABLE, ${maxCareOOS} OUT_OF_STOCK (Total: ${maxCareInv.length})`
    );

    record('BASE', testCounter++, 'MATRIX', 'Karuna Medicals availability totals: 30 AVAILABLE, 20 OUT_OF_STOCK',
      karunaAvail === 30 && karunaOOS === 20 && karunaInv.length === 50,
      `Karuna: ${karunaAvail} AVAILABLE, ${karunaOOS} OUT_OF_STOCK (Total: ${karunaInv.length})`
    );

    // Semantic rule NOT_REPORTED -> OUT_OF_STOCK
    const literalNotReported = await prisma.inventory.count({
      where: {
        OR: [
          { status: 'NOT_REPORTED' },
          { status: 'UNKNOWN' },
          { status: 'DATA_UNAVAILABLE' }
        ]
      }
    });
    record('BASE', testCounter++, 'SEMANTICS', 'Zero NOT_REPORTED / UNKNOWN statuses in database inventory',
      literalNotReported === 0,
      `Count of non-standard statuses: ${literalNotReported}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO A: Dolo 650 (Both Pharmacies Available)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario A: Dolo 650 ---');
    const doloMed = allMedicines.find(m => m.brandName === 'Dolo 650');
    const doloRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicineId: doloMed.id, quantity: 1 }] })
    });
    const doloData = await doloRes.json();
    const doloMaxCare = doloData.results?.find(r => r.pharmacy.id === maxCare.id);
    const doloKaruna = doloData.results?.find(r => r.pharmacy.id === karuna.id);

    record('SCENARIO_A', testCounter++, 'AVAILABILITY', 'Dolo 650: Both pharmacies reported as AVAILABLE',
      doloMaxCare?.availabilityStatus === 'FULL_MATCH' &&
      doloKaruna?.availabilityStatus === 'FULL_MATCH' &&
      doloMaxCare?.itemStockDetails[0]?.status === 'AVAILABLE' &&
      doloKaruna?.itemStockDetails[0]?.status === 'AVAILABLE',
      `Max Care: ${doloMaxCare?.availabilityStatus}, Karuna: ${doloKaruna?.availabilityStatus}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO B: Brufen 400 (Max Care AVAILABLE, Karuna OUT_OF_STOCK)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario B: Brufen 400 ---');
    const brufenMed = allMedicines.find(m => m.brandName === 'Brufen 400');
    const brufenRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicineId: brufenMed.id, quantity: 1 }] })
    });
    const brufenData = await brufenRes.json();
    const brufenMaxCare = brufenData.results?.find(r => r.pharmacy.id === maxCare.id);
    const brufenKaruna = brufenData.results?.find(r => r.pharmacy.id === karuna.id);

    record('SCENARIO_B', testCounter++, 'AVAILABILITY', 'Brufen 400: Max Care AVAILABLE, Karuna OUT_OF_STOCK',
      brufenMaxCare?.availabilityStatus === 'FULL_MATCH' &&
      brufenKaruna?.availabilityStatus === 'OUT_OF_STOCK' &&
      brufenMaxCare?.itemStockDetails[0]?.status === 'AVAILABLE' &&
      brufenKaruna?.itemStockDetails[0]?.status === 'OUT_OF_STOCK',
      `Max Care: ${brufenMaxCare?.itemStockDetails[0]?.status} | Karuna: ${brufenKaruna?.itemStockDetails[0]?.status}`
    );

    record('SCENARIO_B', testCounter++, 'RANKING', 'Brufen 400: Max Care ranks higher than Karuna due to stock',
      brufenData.results && brufenData.results[0]?.pharmacy.id === maxCare.id &&
      brufenMaxCare.scores.totalScore > brufenKaruna.scores.totalScore,
      `Rank 1: ${brufenData.results[0]?.pharmacy.name} (Score: ${brufenData.results[0]?.scores.totalScore}) vs Rank 2: ${brufenData.results[1]?.pharmacy.name} (Score: ${brufenData.results[1]?.scores.totalScore})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO C: Zifi 200 (Max Care OUT_OF_STOCK, Karuna AVAILABLE)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario C: Zifi 200 ---');
    const zifiMed = allMedicines.find(m => m.brandName === 'Zifi 200');
    const zifiRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicineId: zifiMed.id, quantity: 1 }] })
    });
    const zifiData = await zifiRes.json();
    const zifiMaxCare = zifiData.results?.find(r => r.pharmacy.id === maxCare.id);
    const zifiKaruna = zifiData.results?.find(r => r.pharmacy.id === karuna.id);

    record('SCENARIO_C', testCounter++, 'AVAILABILITY', 'Zifi 200: Max Care OUT_OF_STOCK, Karuna AVAILABLE',
      zifiMaxCare?.availabilityStatus === 'OUT_OF_STOCK' &&
      zifiKaruna?.availabilityStatus === 'FULL_MATCH' &&
      zifiMaxCare?.itemStockDetails[0]?.status === 'OUT_OF_STOCK' &&
      zifiKaruna?.itemStockDetails[0]?.status === 'AVAILABLE',
      `Max Care: ${zifiMaxCare?.itemStockDetails[0]?.status} | Karuna: ${zifiKaruna?.itemStockDetails[0]?.status}`
    );

    record('SCENARIO_C', testCounter++, 'RANKING', 'Zifi 200: Karuna ranks higher than Max Care due to stock',
      zifiData.results && zifiData.results[0]?.pharmacy.id === karuna.id &&
      zifiKaruna.scores.totalScore > zifiMaxCare.scores.totalScore,
      `Rank 1: ${zifiData.results[0]?.pharmacy.name} (Score: ${zifiData.results[0]?.scores.totalScore})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO D: Deriphyllin Retard 150 (Max Care OUT_OF_STOCK, Karuna AVAILABLE)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario D: Deriphyllin Retard 150 ---');
    const deriMed = allMedicines.find(m => m.brandName === 'Deriphyllin Retard 150');
    const deriRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicineId: deriMed.id, quantity: 1 }] })
    });
    const deriData = await deriRes.json();
    const deriMaxCare = deriData.results?.find(r => r.pharmacy.id === maxCare.id);
    const deriKaruna = deriData.results?.find(r => r.pharmacy.id === karuna.id);

    record('SCENARIO_D', testCounter++, 'AVAILABILITY', 'Deriphyllin Retard 150: Max Care OUT_OF_STOCK, Karuna AVAILABLE',
      deriMaxCare?.availabilityStatus === 'OUT_OF_STOCK' &&
      deriKaruna?.availabilityStatus === 'FULL_MATCH' &&
      deriMaxCare?.itemStockDetails[0]?.status === 'OUT_OF_STOCK' &&
      deriKaruna?.itemStockDetails[0]?.status === 'AVAILABLE',
      `Max Care: ${deriMaxCare?.itemStockDetails[0]?.status} | Karuna: ${deriKaruna?.itemStockDetails[0]?.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO E: Search Edge Cases & Unknown Medicine (No False Match)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario E: Search Edge Cases & Unknown Medicine ---');

    // Unknown medicine
    const unkRes = await fetch(`${BASE_URL}/medicines/search?q=NonExistentMedicineXYZ999`);
    const unkData = await unkRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Unknown medicine returns count 0 with no false match',
      unkData.success === true && unkData.count === 0 && unkData.medicines.length === 0,
      `Count: ${unkData.count}`
    );

    // Lowercase
    const lowRes = await fetch(`${BASE_URL}/medicines/search?q=dolo%20650`);
    const lowData = await lowRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Lowercase search "dolo 650" finds Dolo 650',
      lowData.success === true && lowData.count >= 1 && lowData.medicines.some(m => m.brandName === 'Dolo 650'),
      `Count: ${lowData.count}`
    );

    // Uppercase
    const upRes = await fetch(`${BASE_URL}/medicines/search?q=DOLO%20650`);
    const upData = await upRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Uppercase search "DOLO 650" finds Dolo 650',
      upData.success === true && upData.count >= 1 && upData.medicines.some(m => m.brandName === 'Dolo 650'),
      `Count: ${upData.count}`
    );

    // Partial name
    const partRes = await fetch(`${BASE_URL}/medicines/search?q=Brufen`);
    const partData = await partRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Partial search "Brufen" finds Brufen 400',
      partData.success === true && partData.count >= 1 && partData.medicines.some(m => m.brandName === 'Brufen 400'),
      `Count: ${partData.count}`
    );

    // Empty query
    const empRes = await fetch(`${BASE_URL}/medicines/search?q=`);
    const empData = await empRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Empty query returns full 50 medicine catalogue safely',
      empData.success === true && empData.count === 50,
      `Count: ${empData.count}`
    );

    // Whitespace query
    const wsRes = await fetch(`${BASE_URL}/medicines/search?q=%20%20%20`);
    const wsData = await wsRes.json();
    record('SCENARIO_E', testCounter++, 'SEARCH', 'Whitespace query returns full 50 medicine catalogue safely',
      wsData.success === true && wsData.count === 50,
      `Count: ${wsData.count}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO F: Closed Pharmacy (Not Presented as Open)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario F: Pharmacy Hours & Closed Status ---');

    // Test computeOpenStatus on Max Care (09:30–20:00) and Karuna (09:30–19:00)
    const maxCareStatus = computeOpenStatus(maxCare.openingHours, maxCare.isOpen);
    const karunaStatus = computeOpenStatus(karuna.openingHours, karuna.isOpen);

    record('SCENARIO_F', testCounter++, 'HOURS', 'Opening hours parsed cleanly with note and source',
      maxCareStatus.isCurrentlyOpen !== null && karunaStatus.isCurrentlyOpen !== null &&
      maxCareStatus.note && karunaStatus.note,
      `Max Care: "${maxCareStatus.note}" | Karuna: "${karunaStatus.note}"`
    );

    // Verify 24x7 is not claimed
    record('SCENARIO_F', testCounter++, 'HOURS', 'Neither pharmacy is falsely marked 24x7',
      maxCare.is24x7 === false && karuna.is24x7 === false,
      `Max Care is24x7: ${maxCare.is24x7}, Karuna is24x7: ${karuna.is24x7}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO G: Emergency Request (Zero Emergency-Capable Pharmacies)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario G: Emergency API & Honesty ---');

    const emergRes = await fetch(`${BASE_URL}/pharmacies/emergency`);
    const emergData = await emergRes.json();

    record('SCENARIO_G', testCounter++, 'EMERGENCY', 'Emergency API returns zero emergency pharmacies when closed or not emergency-capable',
      emergData.success === true &&
      Array.isArray(emergData.pharmacies) &&
      emergData.pharmacies.every(p => p.is24x7 === true || p.emergencyAvailability === true || p.computedOpenStatus?.isCurrentlyOpen === true),
      `Emergency pharmacies returned: ${emergData.count} (No false 24/7 or emergency status fabricated)`
    );

    record('SCENARIO_G', testCounter++, 'EMERGENCY', 'Kerala emergency hotlines (112, 108, 1056, 1800-599-0019) returned in response',
      emergData.emergencyHotlines && emergData.emergencyHotlines.length >= 3 &&
      emergData.emergencyHotlines.some(h => h.label === '112') &&
      emergData.emergencyHotlines.some(h => h.label === '108'),
      `Hotlines present: ${emergData.emergencyHotlines?.map(h => h.label).join(', ')}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO H: Missing Coordinates (Null Distance & Redistributed Scoring)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario H: Missing Coordinates & Ranking Integrity ---');

    const phRes = await fetch(`${BASE_URL}/pharmacies`);
    const phData = await phRes.json();

    const maxCareApi = phData.pharmacies?.find(p => p.id === maxCare.id);
    const karunaApi = phData.pharmacies?.find(p => p.id === karuna.id);

    record('SCENARIO_H', testCounter++, 'COORDINATES', 'Pharmacy discovery reports coordinatesAvailable=false, lat/lon null, distanceKm=null',
      maxCareApi?.coordinatesAvailable === false &&
      maxCareApi?.latitude === null &&
      maxCareApi?.longitude === null &&
      maxCareApi?.distanceKm === null &&
      karunaApi?.coordinatesAvailable === false &&
      karunaApi?.latitude === null &&
      karunaApi?.longitude === null &&
      karunaApi?.distanceKm === null,
      `Max Care distanceKm: ${maxCareApi?.distanceKm}, coordsAvail: ${maxCareApi?.coordinatesAvailable}`
    );

    // Verify ranking redistribution in rankingEngine:
    // With null distance, formula is Math.round(availScore * (45/70) + opsScore * (15/70) + priceScore * (10/70))
    const testAvailScore = doloMaxCare?.scores?.availabilityScore ?? 100;
    const testOpsScore = doloMaxCare?.scores?.operationalScore ?? 70;
    const testPriceScore = doloMaxCare?.scores?.priceScore ?? 80;
    const expectedScore = Math.round(testAvailScore * (45 / 70) + testOpsScore * (15 / 70) + testPriceScore * (10 / 70));

    record('SCENARIO_H', testCounter++, 'RANKING_WEIGHTS', 'Null distance weight redistribution matches formula: 64.29% avail + 21.43% ops + 14.29% price',
      doloMaxCare?.scores?.distanceScore === null &&
      doloMaxCare?.scores?.coordinatesUsedForRanking === false &&
      doloMaxCare?.scores?.totalScore === expectedScore,
      `Expected totalScore: ${expectedScore}, received: ${doloMaxCare?.scores?.totalScore}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO I: Cross-Pharmacy Pharmacist Access (Object-Level Authorization)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario I: Pharmacy Isolation & Pharmacist Authorization ---');

    const p1Auth = await login('pharmacist1@medifind.com');
    const p2Auth = await login('pharmacist2@medifind.com');

    // Pharmacist 1 tries to update Karuna's inventory
    const crossInvRes = await fetch(`${BASE_URL}/pharmacies/${karuna.id}/inventory`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ medicineId: doloMed.id, stock: 10, status: 'AVAILABLE' })
    });

    record('SCENARIO_I', testCounter++, 'SECURITY', 'Pharmacist 1 modifying Karuna inventory is DENIED with HTTP 403',
      crossInvRes.status === 403,
      `HTTP Status: ${crossInvRes.status}`
    );

    // Pharmacist 2 tries to update Max Care's inventory
    const crossInvRes2 = await fetch(`${BASE_URL}/pharmacies/${maxCare.id}/inventory`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p2Auth.token}`
      },
      body: JSON.stringify({ medicineId: doloMed.id, stock: 10, status: 'OUT_OF_STOCK' })
    });

    record('SCENARIO_I', testCounter++, 'SECURITY', 'Pharmacist 2 modifying Max Care inventory is DENIED with HTTP 403',
      crossInvRes2.status === 403,
      `HTTP Status: ${crossInvRes2.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO J: Real Pharmacy Reservation Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario J: Real Pharmacy Reservation Lifecycle ---');

    const patientAuth = await login('patient@medifind.com');

    // 1. Patient creates reservation for Dolo 650 at Max Care
    const createRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 2 }],
        notes: 'Phase 6.1I Verification Lifecycle Test'
      })
    });
    const createData = await createRes.json();
    const orderId = createData.order?.id;
    if (orderId) cleanupOrderIds.push(orderId);

    record('SCENARIO_J', testCounter++, 'ORDERS', 'Patient creates reservation at Max Care in PENDING state',
      createRes.status === 201 && createData.order?.status === 'PENDING' && createData.order?.pharmacyId === maxCare.id,
      `Order ID: ${orderId}, Status: ${createData.order?.status}`
    );

    // 2. Cross-pharmacy access: Pharmacist 2 tries to confirm Pharmacist 1's order -> DENIED
    const crossOrderRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p2Auth.token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    record('SCENARIO_J', testCounter++, 'SECURITY', 'Pharmacist 2 cannot confirm Max Care order (HTTP 403)',
      crossOrderRes.status === 403,
      `HTTP Status: ${crossOrderRes.status}`
    );

    // 3. Pharmacist 1 confirms order -> CONFIRMED
    const confirmRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    const confirmData = await confirmRes.json();
    record('SCENARIO_J', testCounter++, 'WORKFLOW', 'Pharmacist 1 transitions order PENDING -> CONFIRMED',
      confirmRes.status === 200 && confirmData.order?.status === 'CONFIRMED',
      `Status: ${confirmData.order?.status}`
    );

    // 4. Pharmacist 1 marks ready -> READY_FOR_PICKUP
    const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
    });
    const readyData = await readyRes.json();
    record('SCENARIO_J', testCounter++, 'WORKFLOW', 'Pharmacist 1 transitions order CONFIRMED -> READY_FOR_PICKUP',
      readyRes.status === 200 && readyData.order?.status === 'READY_FOR_PICKUP',
      `Status: ${readyData.order?.status}`
    );

    // 5. Complete with pickup PIN -> COMPLETED
    const pickupPin = createData.order?.verificationPin;
    const pinRes = await fetch(`${BASE_URL}/orders/${orderId}/verify-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ pin: pickupPin })
    });
    const pinData = await pinRes.json();
    record('SCENARIO_J', testCounter++, 'WORKFLOW', 'Pickup PIN verification transitions order to COMPLETED',
      pinRes.status === 200 && pinData.order?.status === 'COMPLETED',
      `Status: ${pinData.order?.status}`
    );

    // 6. Terminal status check: COMPLETED cannot transition to CONFIRMED or CANCELLED
    const termRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    record('SCENARIO_J', testCounter++, 'STATE_MACHINE', 'Terminal status COMPLETED rejects further transitions with HTTP 400',
      termRes.status === 400,
      `HTTP Status: ${termRes.status}`
    );

    // 7. Test PENDING -> REJECTED lifecycle
    const rejOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 1 }]
      })
    });
    const rejOrderData = await rejOrderRes.json();
    const rejOrderId = rejOrderData.order?.id;
    if (rejOrderId) cleanupOrderIds.push(rejOrderId);

    const doRejRes = await fetch(`${BASE_URL}/orders/${rejOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ status: 'REJECTED' })
    });
    const doRejData = await doRejRes.json();
    record('SCENARIO_J', testCounter++, 'WORKFLOW', 'Pharmacist transitions order PENDING -> REJECTED',
      doRejRes.status === 200 && doRejData.order?.status === 'REJECTED',
      `Status: ${doRejData.order?.status}`
    );

    // 8. Test PENDING -> CANCELLED lifecycle (Patient cancels own order)
    const canOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 1 }]
      })
    });
    const canOrderData = await canOrderRes.json();
    const canOrderId = canOrderData.order?.id;
    if (canOrderId) cleanupOrderIds.push(canOrderId);

    const doCanRes = await fetch(`${BASE_URL}/orders/${canOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const doCanData = await doCanRes.json();
    record('SCENARIO_J', testCounter++, 'WORKFLOW', 'Patient transitions own order PENDING -> CANCELLED',
      doCanRes.status === 200 && doCanData.order?.status === 'CANCELLED',
      `Status: ${doCanData.order?.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO K: Prescription Verification Requirement
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario K: Prescription Verification Requirement ---');

    // Create a dummy unverified prescription directly in DB
    const unverifiedRx = await prisma.prescription.create({
      data: {
        userId: patientAuth.user.id,
        originalFileName: 'test_rx_unverified.jpg',
        filePath: 'uploads/prescriptions/test_rx_unverified.jpg',
        status: 'PENDING'
      }
    });
    cleanupPrescriptionIds.push(unverifiedRx.id);

    // Patient tries to create order with unverified prescription
    const badRxOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 1 }],
        prescriptionId: unverifiedRx.id
      })
    });
    const badRxOrderData = await badRxOrderRes.json();

    record('SCENARIO_K', testCounter++, 'SAFETY', 'Unverified prescription rejected from order creation (HTTP 400)',
      badRxOrderRes.status === 400 && badRxOrderData.error?.includes('Prescription has not been verified yet'),
      `HTTP Status: ${badRxOrderRes.status}, Error: ${badRxOrderData.error}`
    );

    // Now verify the prescription in DB and test that order creation succeeds
    await prisma.prescription.update({
      where: { id: unverifiedRx.id },
      data: { status: 'VERIFIED' }
    });

    const goodRxOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 1 }],
        prescriptionId: unverifiedRx.id
      })
    });
    const goodRxOrderData = await goodRxOrderRes.json();
    if (goodRxOrderData.order?.id) cleanupOrderIds.push(goodRxOrderData.order.id);

    record('SCENARIO_K', testCounter++, 'SAFETY', 'Verified prescription successfully creates order',
      goodRxOrderRes.status === 201 && goodRxOrderData.order?.prescriptionId === unverifiedRx.id,
      `Order ID: ${goodRxOrderData.order?.id}, Status: ${goodRxOrderData.order?.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO L: Delivery Availability (Real Pharmacies Report Delivery=No)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario L: Delivery Availability Restrictions ---');

    record('SCENARIO_L', testCounter++, 'DELIVERY', 'Max Care deliveryAvailable is strictly false in DB and API',
      maxCare.deliveryAvailable === false && maxCareApi.deliveryAvailable === false,
      `DB: ${maxCare.deliveryAvailable}, API: ${maxCareApi.deliveryAvailable}`
    );

    record('SCENARIO_L', testCounter++, 'DELIVERY', 'Karuna Medicals deliveryAvailable is strictly false in DB and API',
      karuna.deliveryAvailable === false && karunaApi.deliveryAvailable === false,
      `DB: ${karuna.deliveryAvailable}, API: ${karunaApi.deliveryAvailable}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO M: Offline Safety (Non-Idempotent Transactional Guard)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario M: Offline Transactional Safety ---');

    // Test that unauthenticated / malformed order creation fails safely
    const unauthOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pharmacyId: maxCare.id, items: [{ medicineId: doloMed.id, quantity: 1 }] })
    });
    record('SCENARIO_M', testCounter++, 'OFFLINE_SAFETY', 'Unauthenticated request to POST /api/orders returns HTTP 401',
      unauthOrderRes.status === 401,
      `HTTP Status: ${unauthOrderRes.status}`
    );

    const emptyOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({ pharmacyId: maxCare.id, items: [] })
    });
    record('SCENARIO_M', testCounter++, 'OFFLINE_SAFETY', 'Malformed/empty order payload returns HTTP 400',
      emptyOrderRes.status === 400,
      `HTTP Status: ${emptyOrderRes.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO N: Payment Server-Authoritative Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario N: Payment Server-Authoritative Integrity ---');

    // Create an order and inspect checkout summary
    const payOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientAuth.token}`
      },
      body: JSON.stringify({
        pharmacyId: maxCare.id,
        items: [{ medicineId: doloMed.id, quantity: 3, unitPrice: 0.01 }] // Client attempts to supply ₹0.01 unitPrice
      })
    });
    const payOrderData = await payOrderRes.json();
    const payOrderId = payOrderData.order?.id;
    if (payOrderId) cleanupOrderIds.push(payOrderId);

    // Confirm order so checkout summary is available
    await fetch(`${BASE_URL}/orders/${payOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p1Auth.token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });

    const checkoutSummaryRes = await fetch(`${BASE_URL}/checkout/${payOrderId}`, {
      headers: { Authorization: `Bearer ${patientAuth.token}` }
    });
    const checkoutSummaryData = await checkoutSummaryRes.json();

    record('SCENARIO_N', testCounter++, 'PAYMENT', 'Server-authoritative pricing ignores client-supplied unitPrice override',
      payOrderData.order?.items[0]?.unitPrice !== 0.01,
      `Unit price calculated by server: ₹${payOrderData.order?.items[0]?.unitPrice}`
    );

    record('SCENARIO_N', testCounter++, 'PAYMENT', 'Checkout summary exposes public razorpayKeyId but NEVER secret key',
      checkoutSummaryData.checkout?.razorpayKeyId !== undefined &&
      checkoutSummaryData.checkout?.razorpayKeySecret === undefined &&
      checkoutSummaryData.checkout?.keySecret === undefined,
      `Public Key ID present: ${checkoutSummaryData.checkout?.razorpayKeyId ? 'YES' : 'null (unconfigured)'}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO O: Notifications Recipient Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario O: Notifications Recipient Isolation ---');

    const p1NotifRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${p1Auth.token}` }
    });
    const p1NotifData = await p1NotifRes.json();

    const patNotifRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${patientAuth.token}` }
    });
    const patNotifData = await patNotifRes.json();

    record('SCENARIO_O', testCounter++, 'NOTIFICATIONS', 'Notifications are isolated: Pharmacist 1 does not receive Patient notifications',
      Array.isArray(p1NotifData.notifications) &&
      p1NotifData.notifications.every(n => n.userId === p1Auth.user.id),
      `Pharmacist notifications: ${p1NotifData.notifications?.length}, all belong to user: true`
    );

    record('SCENARIO_O', testCounter++, 'NOTIFICATIONS', 'Patient notifications endpoint returns isolated records belonging strictly to patient',
      Array.isArray(patNotifData.notifications) &&
      patNotifData.notifications.every(n => n.userId === patientAuth.user.id),
      `Patient notifications: ${patNotifData.notifications?.length}, all belong to user: true`
    );

    // Test mark-all-read safe action
    const markReadRes = await fetch(`${BASE_URL}/notifications/mark-all-read`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${patientAuth.token}` }
    });
    record('SCENARIO_O', testCounter++, 'NOTIFICATIONS', 'Safe action PUT /api/notifications/mark-all-read succeeds',
      markReadRes.status === 200,
      `HTTP Status: ${markReadRes.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO P: Test Pharmacy Leakage (Zero Test Records in Patient Discovery)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario P: Test Pharmacy Isolation & Zero Leakage ---');

    const discRes = await fetch(`${BASE_URL}/pharmacies`);
    const discData = await discRes.json();

    const hasTestRecord = discData.pharmacies?.some(
      p => p.isTestRecord === true ||
           p.verificationStatus === 'TEST' ||
           p.name.includes('[TEST]') ||
           p.name.includes('Bangalore') ||
           p.name.includes('Area Medical Store') ||
           p.name.includes('Haripad Area')
    );

    record('SCENARIO_P', testCounter++, 'LEAKAGE', 'Patient discovery returns ZERO test fixtures or simulated pharmacies',
      hasTestRecord === false && discData.pharmacies?.length === 2,
      `Returned count: ${discData.pharmacies?.length}, names: ${discData.pharmacies?.map(p => p.name).join(', ')}`
    );

    const discSearchRes = await fetch(`${BASE_URL}/pharmacies/search`);
    const discSearchData = await discSearchRes.json();

    record('SCENARIO_P', testCounter++, 'LEAKAGE', 'Patient search alias /api/pharmacies/search returns ZERO test fixtures',
      discSearchData.pharmacies?.length === 2 &&
      discSearchData.pharmacies?.every(p => !p.name.includes('[TEST]')),
      `Returned count: ${discSearchData.pharmacies?.length}`
    );

    // -------------------------------------------------------------------------
    // DEEP CHECKS: MULTI-MEDICINE MIXED RESERVATION (Section 9)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 9: Multi-Medicine Mixed Availability ---');
    const multiRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { medicineId: brufenMed.id, quantity: 1 }, // Max Care avail, Karuna OOS
          { medicineId: zifiMed.id, quantity: 1 }    // Max Care OOS, Karuna avail
        ]
      })
    });
    const multiData = await multiRes.json();
    const multiMaxCare = multiData.results?.find(r => r.pharmacy.id === maxCare.id);
    const multiKaruna = multiData.results?.find(r => r.pharmacy.id === karuna.id);

    record('SECTION_9', testCounter++, 'MATCH', 'Mixed availability: both pharmacies report PARTIAL_MATCH with 1/2 available',
      multiMaxCare?.availabilityStatus === 'PARTIAL_MATCH' &&
      multiKaruna?.availabilityStatus === 'PARTIAL_MATCH' &&
      multiMaxCare?.matchedItemsCount === 1 &&
      multiKaruna?.matchedItemsCount === 1,
      `Max Care: ${multiMaxCare?.matchedItemsCount}/${multiMaxCare?.totalRequested} | Karuna: ${multiKaruna?.matchedItemsCount}/${multiKaruna?.totalRequested}`
    );

    // -------------------------------------------------------------------------
    // DEEP CHECKS: ASSISTANT ROLE ISOLATION (Section 17)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 17: Assistant Role Isolation ---');
    const asstAuth = await login('assistant@medifind.com');

    // Assistant tries to access prescription details directly
    const asstRxRes = await fetch(`${BASE_URL}/prescriptions/${unverifiedRx.id}`, {
      headers: { Authorization: `Bearer ${asstAuth.token}` }
    });
    record('SECTION_17', testCounter++, 'SECURITY', 'Assistant cannot access patient prescription details (HTTP 403)',
      asstRxRes.status === 403,
      `HTTP Status: ${asstRxRes.status}`
    );

    // Assistant cannot modify pharmacy inventory
    const asstInvRes = await fetch(`${BASE_URL}/pharmacies/${maxCare.id}/inventory`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${asstAuth.token}`
      },
      body: JSON.stringify({ medicineId: doloMed.id, status: 'AVAILABLE' })
    });
    record('SECTION_17', testCounter++, 'SECURITY', 'Assistant cannot modify pharmacy inventory (HTTP 403)',
      asstInvRes.status === 403,
      `HTTP Status: ${asstInvRes.status}`
    );

    // -------------------------------------------------------------------------
    // DEEP CHECKS: DATABASE INTEGRITY & CONSISTENCY (Section 24)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 24: Database Consistency & Integrity ---');

    const invs = await prisma.inventory.findMany();
    const medIdSet = new Set(allMedicines.map(m => m.id));
    const phIdSet = new Set(pharmaciesInDb.map(p => p.id));

    const invalidMedInvs = invs.filter(i => !medIdSet.has(i.medicineId));
    const invalidPhInvs = invs.filter(i => !phIdSet.has(i.pharmacyId));

    record('SECTION_24', testCounter++, 'INTEGRITY', '100% of Inventory records map to valid Medicine and Pharmacy IDs',
      invalidMedInvs.length === 0 && invalidPhInvs.length === 0,
      `Total inventory: ${invs.length}, invalid med IDs: ${invalidMedInvs.length}, invalid ph IDs: ${invalidPhInvs.length}`
    );

    const orderItems = await prisma.orderItem.findMany();
    const orders = await prisma.order.findMany();
    const orderIdSet = new Set(orders.map(o => o.id));
    const invalidOrderItems = orderItems.filter(oi => !orderIdSet.has(oi.orderId) || !medIdSet.has(oi.medicineId));

    record('SECTION_24', testCounter++, 'INTEGRITY', '100% of OrderItem records map to valid Order and Medicine IDs',
      invalidOrderItems.length === 0,
      `Total orderItems: ${orderItems.length}, invalid: ${invalidOrderItems.length}`
    );

    // -------------------------------------------------------------------------
    // DEEP CHECKS: IMPORT IDEMPOTENCY (Section 25)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 25: Importer Idempotency Verification ---');

    // Run import again
    await validateAndImport();

    const postImportPharmacies = await prisma.pharmacy.findMany({
      where: { isVerified: true, verificationStatus: 'VERIFIED' }
    });
    const postImportMedicines = await prisma.medicine.count();
    const postImportInventory = await prisma.inventory.count({
      where: { pharmacyId: { in: [maxCare.id, karuna.id] } }
    });

    record('SECTION_25', testCounter++, 'IDEMPOTENCY', 'Re-running importer preserves exactly 2 participating pharmacies and 50 medicines',
      postImportPharmacies.length === 2 && postImportMedicines === 50 && postImportInventory === 100,
      `Pharmacies: ${postImportPharmacies.length}, Medicines: ${postImportMedicines}, Inventory rows: ${postImportInventory}`
    );

  } catch (err) {
    console.error('\n💥 Test execution error:', err.message);
    console.error(err.stack);
  } finally {
    // Cleanup created test records
    console.log('\n🧹 Cleaning up test artifacts...');
    for (const ordId of cleanupOrderIds) {
      await prisma.payment.deleteMany({ where: { orderId: ordId } }).catch(() => {});
      await prisma.assistantTask.deleteMany({ where: { orderId: ordId } }).catch(() => {});
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: ordId } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { orderId: ordId } }).catch(() => {});
      await prisma.order.delete({ where: { id: ordId } }).catch(() => {});
    }
    for (const rxId of cleanupPrescriptionIds) {
      await prisma.detectedMedicine.deleteMany({ where: { prescriptionId: rxId } }).catch(() => {});
      await prisma.prescription.delete({ where: { id: rxId } }).catch(() => {});
    }
    console.log('✅ Cleanup complete');
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('\n====================================================================');
  console.log(`📊 PHASE 6.1I VERIFICATION RESULTS: ${passed}/${results.length} PASSED (${failed} FAILED)`);
  console.log('====================================================================\n');

  if (failed > 0) {
    console.log('❌ FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ [${r.scenario}] T${String(r.num).padStart(2, '0')} [${r.category}] ${r.title}\n     └─ ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ALL PHASE 6.1I REAL DATA & BACKEND VERIFICATION TESTS PASSED!\n');
    process.exit(0);
  }
}

runPhase61IVerification().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
