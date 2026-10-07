/**
 * MEDIFIND AI — PHASE 3 NETWORK & PHARMACY DISCOVERY TEST SUITE
 * 25 automated tests covering:
 *   T01–T03  Config endpoint
 *   T04–T06  Pharmacy list (TEST fixtures)
 *   T07–T09  Distance validation
 *   T10–T12  Radius filter
 *   T13–T15  Hours-based open/closed computation
 *   T16–T18  Emergency endpoint
 *   T19–T21  Match availability
 *   T22–T24  Coordinate privacy
 *   T25      TEST DATA labelling
 */

const BASE_URL = 'http://localhost:5000/api';

// Kerala network constants (must match pharmacyNetwork.js)
const KERALA_LAT = 9.3200;
const KERALA_LON = 76.6160;
const KERALA_REGION = 'Chengannur / Alappuzha, Kerala';
const EXPECTED_HOTLINES = ['112', '108', '1056'];

async function runPhase3Tests() {
  console.log('🌐 =====================================================');
  console.log('🌐 MEDIFIND AI — PHASE 3: KERALA NETWORK & PHARMACY DISCOVERY');
  console.log('🌐 =====================================================\n');

  const results = [];
  function record(testNum, category, title, passed, details = '') {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testNum, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} T${String(testNum).padStart(2, '0')} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  // ───────────────────────────────────────────────────────────
  // T01–T03: Config Endpoint
  // ───────────────────────────────────────────────────────────
  let config = null;

  try {
    const res = await fetch(`${BASE_URL}/pharmacies/config`);
    const data = await res.json();
    config = data.config;

    record(1, 'CONFIG', 'GET /pharmacies/config returns success and config object',
      res.status === 200 && data.success === true && !!config,
      `HTTP ${res.status}, success=${data.success}`);
  } catch (e) {
    record(1, 'CONFIG', 'GET /pharmacies/config returns success and config object', false, e.message);
  }

  try {
    const hasKeralaCoords =
      config &&
      Math.abs(config.defaultLat - KERALA_LAT) < 0.01 &&
      Math.abs(config.defaultLon - KERALA_LON) < 0.01 &&
      config.regionName === KERALA_REGION;

    record(2, 'CONFIG', 'Config contains Kerala coordinates and region name',
      hasKeralaCoords,
      config ? `lat=${config.defaultLat}, lon=${config.defaultLon}, region="${config.regionName}"` : 'No config object');
  } catch (e) {
    record(2, 'CONFIG', 'Config contains Kerala coordinates and region name', false, e.message);
  }

  try {
    const hotlines = config?.emergencyHotlines || [];
    const dialables = hotlines.map(h => h.label || h.dialable || '');
    const hasKeralaHotlines = EXPECTED_HOTLINES.every(n =>
      dialables.some(d => d.includes(n))
    );
    record(3, 'CONFIG', 'Config contains Kerala emergency hotlines (112, 108, 1056)',
      hasKeralaHotlines,
      `Hotline labels: ${dialables.join(', ')}`);
  } catch (e) {
    record(3, 'CONFIG', 'Config contains Kerala emergency hotlines (112, 108, 1056)', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T04–T06: Pharmacy List — Test Fixtures
  // ───────────────────────────────────────────────────────────
  let pharmacies = [];

  try {
    const res = await fetch(`${BASE_URL}/pharmacies?lat=${KERALA_LAT}&lon=${KERALA_LON}`);
    const data = await res.json();
    pharmacies = data.pharmacies || [];

    record(4, 'PHARMACY_LIST', 'GET /pharmacies with Chengannur coords returns success',
      res.status === 200 && data.success === true,
      `HTTP ${res.status}, count=${pharmacies.length}`);
  } catch (e) {
    record(4, 'PHARMACY_LIST', 'GET /pharmacies with Chengannur coords returns success', false, e.message);
  }

  try {
  // Phase 6.1H.1: Exactly 2 real participating pharmacies (Max Care + Karuna Medicals).
  // No Alappuzha test fixture — deactivated in Phase 6.1H.
  const maxCarePresent = pharmacies.some(p => p.name && p.name.includes('Max Care'));
  const karunaPresent  = pharmacies.some(p => p.name && p.name.includes('Karuna'));
  record(5, 'PHARMACY_LIST', 'Exactly 2 real participating pharmacies returned (Max Care + Karuna Medicals)',
    pharmacies.length === 2 && maxCarePresent && karunaPresent,
    `Pharmacy count: ${pharmacies.length}, MaxCare: ${maxCarePresent}, Karuna: ${karunaPresent}`);
  } catch (e) {
    record(5, 'PHARMACY_LIST', 'Exactly 2 real participating pharmacies returned', false, e.message);
  }

  try {
    // Phase 6.1H.1: Real participating pharmacies have isTestRecord=false and isParticipating=true.
    const allAreParticipating = pharmacies.length > 0 && pharmacies.every(p => p.isTestRecord === false && p.isParticipating === true);
    record(6, 'PHARMACY_LIST', 'All returned pharmacies are real participating pharmacies (isTestRecord=false, isParticipating=true)',
      allAreParticipating,
      pharmacies.map(p => `${p.name}: isTestRecord=${p.isTestRecord}, isParticipating=${p.isParticipating}`).join(' | '));
  } catch (e) {
    record(6, 'PHARMACY_LIST', 'All returned pharmacies are real participating pharmacies', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T07–T09: Distance Validation
  // ───────────────────────────────────────────────────────────
  try {
    // Phase 6.1H.1: Real participating pharmacies may have coordinatesAvailable=false when
    // authoritative coordinates are unavailable. distanceKm MUST be null — not fabricated.
    const allCoordsHandledCorrectly = pharmacies.every(p =>
      (p.coordinatesAvailable === true && typeof p.distanceKm === 'number') ||
      (p.coordinatesAvailable === false && p.distanceKm === null)
    );
    record(7, 'DISTANCE', 'Real pharmacies: coordinatesAvailable=false yields distanceKm=null (no fabrication); coordinatesAvailable=true yields numeric distanceKm',
      allCoordsHandledCorrectly,
      pharmacies.map(p => `${p.name}: coordsAvail=${p.coordinatesAvailable}, dist=${p.distanceKm}km`).join(' | '));
  } catch (e) {
    record(7, 'DISTANCE', 'coordinatesAvailable/distanceKm null-safety contract', false, e.message);
  }

  try {
    // Phase 6.1H.1: Coordinates are null for real pharmacies in this phase.
    // Verify none of the pharmacies have fabricated coordinates outside Kerala.
    const noFabricatedCoords = pharmacies.every(p =>
      p.coordinatesAvailable === false || // null coords — expected for current pharmacies
      (p.latitude >= 8 && p.latitude <= 13 && p.longitude >= 74 && p.longitude <= 78) // valid Kerala range
    );
    record(8, 'DISTANCE', 'No fabricated out-of-region coordinates — all pharmacies either have null coords or valid Kerala coords',
      noFabricatedCoords,
      pharmacies.map(p => `coordsAvail=${p.coordinatesAvailable}, lat=${p.latitude}, lon=${p.longitude}`).join(' | '));
  } catch (e) {
    record(8, 'DISTANCE', 'No fabricated out-of-region coordinates', false, e.message);
  }

  try {
    const noTravelTime = pharmacies.every(p => !('travelTimeMins' in p));
    record(9, 'DISTANCE', 'No travelTimeMins field present in pharmacy list response',
      noTravelTime,
      noTravelTime ? 'travelTimeMins correctly absent' : 'Found travelTimeMins in response!');
  } catch (e) {
    record(9, 'DISTANCE', 'No travelTimeMins field present in pharmacy list response', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T10–T12: Radius Filter
  // ───────────────────────────────────────────────────────────
  let pharmacies10km = [];
  let pharmacies30km = [];

  try {
    const res = await fetch(`${BASE_URL}/pharmacies?lat=${KERALA_LAT}&lon=${KERALA_LON}&radiusKm=10`);
    const data = await res.json();
    pharmacies10km = data.pharmacies || [];
    record(10, 'RADIUS', '?radiusKm=10 returns only pharmacies within 10 km',
      pharmacies10km.every(p => p.distanceKm <= 10),
      `${pharmacies10km.length} pharmacies within 10km`);
  } catch (e) {
    record(10, 'RADIUS', '?radiusKm=10 returns only pharmacies within 10 km', false, e.message);
  }

  try {
    // Phase 6.1H.1: Exactly 2 real participating pharmacies exist (no 3rd test fixture).
    // Radius filtering of null-coord pharmacies: include them (no coordinates to filter against).
    // This validates that null-coord pharmacies pass through the radius filter.
    const res = await fetch(`${BASE_URL}/pharmacies?lat=${KERALA_LAT}&lon=${KERALA_LON}&radiusKm=40`);
    const data = await res.json();
    pharmacies30km = data.pharmacies || [];
    record(11, 'RADIUS', '?radiusKm=40 returns both real participating pharmacies (null-coord pharmacies pass radius filter)',
      pharmacies30km.length === 2,
      `${pharmacies30km.length} pharmacies at 40km radius`);
  } catch (e) {
    record(11, 'RADIUS', '?radiusKm=40 returns both real participating pharmacies', false, e.message);
  }

  try {
    const smallerSubset = pharmacies10km.length <= pharmacies30km.length;
    record(12, 'RADIUS', '10 km radius returns fewer or equal pharmacies than 40 km radius',
      smallerSubset,
      `10km: ${pharmacies10km.length}, 40km: ${pharmacies30km.length}`);
  } catch (e) {
    record(12, 'RADIUS', '10 km radius returns fewer or equal pharmacies than 30 km radius', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T13–T15: Open/Closed Computation
  // ───────────────────────────────────────────────────────────
  try {
    // Phase 6.1H.1: Neither real participating pharmacy is 24x7.
    // The system correctly computes open status from operating hours (09:30-20:00 / 09:30-19:00).
    // Verify that no pharmacy is computed as always-open when it is not 24x7.
    const noFalse24x7 = pharmacies.every(p => !p.is24x7 || p.computedOpenStatus?.isCurrentlyOpen === true);
    const computedStatusExists = pharmacies.every(p => p.computedOpenStatus && 'isCurrentlyOpen' in p.computedOpenStatus);
    record(13, 'HOURS', 'No participating pharmacy claims 24x7 status; computed open status is derived from real operating hours',
      computedStatusExists && pharmacies.every(p => p.is24x7 === false),
      pharmacies.map(p => `${p.name}: is24x7=${p.is24x7}, computedOpen=${p.computedOpenStatus?.isCurrentlyOpen}`).join(' | '));
  } catch (e) {
    record(13, 'HOURS', 'No pharmacy claims false 24x7 status', false, e.message);
  }

  try {
    const allHaveComputedStatus = pharmacies.every(p =>
      p.computedOpenStatus !== undefined &&
      typeof p.computedOpenStatus === 'object' &&
      'note' in p.computedOpenStatus
    );
    record(14, 'HOURS', 'All pharmacies have computedOpenStatus object with note field',
      allHaveComputedStatus,
      pharmacies.map(p => `${p.name}: source=${p.computedOpenStatus?.source}`).join(' | '));
  } catch (e) {
    record(14, 'HOURS', 'All pharmacies have computedOpenStatus object with note field', false, e.message);
  }

  try {
    // Verify: none of the isOpen=true pharmacies have source='override'
    // (override source only appears when isOpen=false is stored in DB)
    const noneHaveSpuriousOverride = pharmacies.every(p =>
      p.computedOpenStatus?.source !== 'override'
    );
    record(15, 'HOURS', 'isOpen=true pharmacies are NOT labelled as manual override (override only fires on isOpen=false)',
      noneHaveSpuriousOverride,
      pharmacies.map(p => `${p.name}: source=${p.computedOpenStatus?.source}`).join(' | '));
  } catch (e) {
    record(15, 'HOURS', 'isOpen=true pharmacies are NOT labelled as manual override (override only fires on isOpen=false)', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T16–T18: Emergency Endpoint
  // ───────────────────────────────────────────────────────────
  let emergencyPharmacies = [];

  try {
    const res = await fetch(`${BASE_URL}/pharmacies/emergency?lat=${KERALA_LAT}&lon=${KERALA_LON}`);
    const data = await res.json();
    emergencyPharmacies = data.pharmacies || [];

    record(16, 'EMERGENCY', 'GET /pharmacies/emergency returns success with Kerala hotlines',
      res.status === 200 && data.success && Array.isArray(data.emergencyHotlines),
      `HTTP ${res.status}, pharmacies=${emergencyPharmacies.length}, hotlines=${data.emergencyHotlines?.length}`);
  } catch (e) {
    record(16, 'EMERGENCY', 'GET /pharmacies/emergency returns success with Kerala hotlines', false, e.message);
  }

  try {
    // Phase 6.1H.1: Neither participating pharmacy provides emergency/24x7 coverage.
    // The emergency endpoint must return the real pharmacies IF they have emergency medicines in stock
    // AND are currently open. If they have stock but are closed now, count=0 is also valid.
    // The test validates that the emergency endpoint is honest — not that it always finds a pharmacy.
    const noFabricatedEmergencyPharm = emergencyPharmacies.every(p =>
      p.isParticipating === true &&
      p.testDataNote === null
    );
    record(17, 'EMERGENCY', 'Emergency endpoint only returns real participating pharmacies (no fabricated emergency pharmacies)',
      noFabricatedEmergencyPharm,
      `Count: ${emergencyPharmacies.length}. All real: ${noFabricatedEmergencyPharm}. ` +
      `Note: 0 results is valid when real pharmacies are closed or have no emergency stock.`);
  } catch (e) {
    record(17, 'EMERGENCY', 'Emergency endpoint returns only real pharmacies', false, e.message);
  }

  try {
    const noTravelTimeEmergency = emergencyPharmacies.every(p => !('travelTimeMins' in p));
    record(18, 'EMERGENCY', 'No travelTimeMins in emergency endpoint response',
      noTravelTimeEmergency,
      noTravelTimeEmergency ? 'travelTimeMins correctly absent' : 'Found travelTimeMins in response!');
  } catch (e) {
    record(18, 'EMERGENCY', 'No travelTimeMins in emergency endpoint response', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T19–T21: Match Availability
  // ───────────────────────────────────────────────────────────
  let matchResults = [];

  try {
    // Login to get a medicine ID first
    const medRes = await fetch(`${BASE_URL}/medicines/search?q=Dolo`);
    const medData = await medRes.json();
    const medicine = medData.medicines?.[0];

    if (!medicine) throw new Error('No medicine found for availability test');

    const res = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ medicineId: medicine.id, quantity: 1 }],
        lat: KERALA_LAT,
        lon: KERALA_LON,
        isEmergency: false
      })
    });
    const data = await res.json();
    matchResults = data.results || [];

    record(19, 'MATCH_AVAIL', 'POST /pharmacies/match-availability returns ranked results',
      res.status === 200 && data.success && matchResults.length > 0,
      `HTTP ${res.status}, results=${matchResults.length}`);
  } catch (e) {
    record(19, 'MATCH_AVAIL', 'POST /pharmacies/match-availability returns ranked results', false, e.message);
  }

  try {
    const noTravelTime = matchResults.every(r => !('travelTimeMins' in r));
    record(20, 'MATCH_AVAIL', 'No travelTimeMins in match-availability response',
      noTravelTime,
      noTravelTime ? 'travelTimeMins correctly absent' : 'Found travelTimeMins in response!');
  } catch (e) {
    record(20, 'MATCH_AVAIL', 'No travelTimeMins in match-availability response', false, e.message);
  }

  try {
    // Check that at least one result has itemStockDetails with stockLastUpdated
    const hasLastUpdated = matchResults.some(r =>
      r.itemStockDetails?.some(item => item.stockLastUpdated !== undefined)
    );
    record(21, 'MATCH_AVAIL', 'Match results include stockLastUpdated freshness timestamp',
      hasLastUpdated,
      hasLastUpdated ? 'stockLastUpdated present in itemStockDetails' : 'stockLastUpdated missing from itemStockDetails');
  } catch (e) {
    record(21, 'MATCH_AVAIL', 'Match results include stockLastUpdated freshness timestamp', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T22–T24: Coordinate Privacy
  // ───────────────────────────────────────────────────────────
  try {
    // Response must not contain caller lat/lon — only pharmacy coords
    const responseStr = JSON.stringify(matchResults);
    // Patient's exact test coordinates (9.3200, 76.6160) as strings should not appear as standalone values
    const hasNoPatientCoordFields = matchResults.every(r => !('userLat' in r) && !('userLon' in r) && !('patientLat' in r) && !('patientLon' in r));
    record(22, 'PRIVACY', 'Match-availability response contains no userLat / userLon fields',
      hasNoPatientCoordFields,
      'Patient coordinate fields absent from response');
  } catch (e) {
    record(22, 'PRIVACY', 'Match-availability response contains no userLat / userLon fields', false, e.message);
  }

  try {
    // Pharmacy list response must not include caller coordinates
    const res = await fetch(`${BASE_URL}/pharmacies?lat=${KERALA_LAT}&lon=${KERALA_LON}`);
    const data = await res.json();
    const hasNoCaller = !('userLat' in data) && !('userLon' in data) && !('patientLat' in data) && !('patientLon' in data);
    record(23, 'PRIVACY', 'Pharmacy list response body contains no patient lat/lon fields',
      hasNoCaller,
      'Caller coordinate fields absent from pharmacy list response');
  } catch (e) {
    record(23, 'PRIVACY', 'Pharmacy list response body contains no patient lat/lon fields', false, e.message);
  }

  try {
    // Emergency endpoint response must not include caller coordinates
    const res = await fetch(`${BASE_URL}/pharmacies/emergency?lat=${KERALA_LAT}&lon=${KERALA_LON}`);
    const data = await res.json();
    const hasNoCaller = !('userLat' in data) && !('userLon' in data) && !('patientLat' in data) && !('patientLon' in data);
    record(24, 'PRIVACY', 'Emergency endpoint response body contains no patient lat/lon fields',
      hasNoCaller,
      'Caller coordinate fields absent from emergency response');
  } catch (e) {
    record(24, 'PRIVACY', 'Emergency endpoint response body contains no patient lat/lon fields', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // T25: TEST DATA Labelling
  // ───────────────────────────────────────────────────────────
  try {
    // Phase 6.1H.1: Real participating pharmacies are NOT test records.
    // Their participation is academic (permission given) — not government/regulatory verified.
    // isParticipating=true means approved for MediFind academic network only.
    // isTestRecord=false means they are real pharmacies, not test fixtures.
    const allRealAndLabelled = pharmacies.length > 0 && pharmacies.every(p =>
      p.isTestRecord === false &&
      p.isParticipating === true &&
      p.testDataNote === null
    );
    record(25, 'TEST_DATA', 'Real participating pharmacies have isTestRecord=false, isParticipating=true, testDataNote=null',
      allRealAndLabelled,
      pharmacies.map(p => `${p.name}: isTestRecord=${p.isTestRecord}, isParticipating=${p.isParticipating}`).join(' | '));
  } catch (e) {
    record(25, 'TEST_DATA', 'Real pharmacies correctly labelled (not test fixtures)', false, e.message);
  }

  // ───────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log('PHASE 3 TEST RESULTS SUMMARY');
  console.log('════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`✅ PASSED: ${passed}/25`);
  console.log(`❌ FAILED: ${failed}/25`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ T${String(r.testNum).padStart(2, '0')} [${r.category}] ${r.title}`);
      if (r.details) console.log(`     └─ ${r.details}`);
    });
  }

  console.log('\nPharmacy Data Classification Report (Phase 6.1H.1):');
  console.log('  Max Care Pharmacy    → REAL PARTICIPATING PHARMACY (academic project, permission given)');
  console.log('  Karuna Medicals      → REAL PARTICIPATING PHARMACY (academic project, permission given)');
  console.log('  [TEST] Alappuzha     → DEACTIVATED TEST FIXTURE (excluded from normal discovery)');
  console.log('════════════════════════════════════════════════════════');

  process.exitCode = failed > 0 ? 1 : 0;
}

runPhase3Tests().catch(err => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});
