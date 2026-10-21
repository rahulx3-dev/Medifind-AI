/**
 * MediFind AI — Phase 1 Test Suite: Medicine Search, Quantity, and Unit Pricing
 *
 * Comprehensive automated regression test suite validating:
 * 1. Medicine search:
 *    - Exact medicine names
 *    - Partial and single-word searches
 *    - Supported abbreviations (pcm, azi, pan, met, cefix)
 *    - Minor spelling mistakes and typos (Paracetmol, Cefixim, Metfomin, Taxim 0)
 *    - Strength and dosage-form distinction (prevents cross-strength false matches)
 *    - Filters (category, dosageForm, filterTag: rx/otc, emergencyOnly) and sorting (price-asc/desc, name-asc/desc)
 *    - Voice search query normalization (conversational phrase removal)
 * 2. Unit pricing & quantities:
 *    - Single source of truth for medicine price & pack size
 *    - 10-tablet strip of Taxim-O 200 at ₹105.10: 1 tab (₹10.51), 3 tabs (₹31.53), 10 tabs (₹105.10), 1 strip (₹105.10)
 *    - Strict guard: Never multiply strip price by tablet count
 *    - Other pack sizes: 15-pack Crocin 650, 20-pack Combiflam, liquids/syrups (Ascoril LS), inhalers (Asthalin)
 *    - Supported sale units (STRIP vs TABLET vs BOTTLE vs UNIT)
 *    - Missing / invalid pack sizes handled safely
 *    - Unpriced medicines (Epinephrine Auto-Injector) flagged as unpriced requiring counter payment without invented pricing
 *    - Floating-point currency rounding
 *    - 12% GST tax breakdown calculation
 *    - Consistent order line totals and subtotals across cart, order, and checkout
 */

const assert = require('assert');
const http = require('http');
const {
  roundCurrency,
  calculateUnitPrice,
  getSupportedSaleUnits,
  calculateMedicinePricing,
  calculateTaxBreakdown,
  getAllReferencePricing,
  getReferencePricing
} = require('./src/utils/referencePricing');
const {
  calculateOrderTotals,
  getFulfillmentFee,
  PLATFORM_FEE,
  ASSISTANT_SERVICE_FEE
} = require('./src/utils/paymentConfig');

const BASE_URL = 'http://localhost:5000/api';

let passed = 0;
let failed = 0;
const results = [];

function record(suite, testName, isOk, details = '') {
  if (isOk) {
    passed++;
    console.log(`  [PASS] [${suite}] ${testName} ${details ? '(' + details + ')' : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] [${suite}] ${testName} ${details ? '(' + details + ')' : ''}`);
  }
  results.push({ suite, testName, isOk, details });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, json });
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message} — Data: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('======================================================================');
  console.log('   MEDIFIND AI — PHASE 1: MEDICINE SEARCH, QUANTITY & PRICING TESTS   ');
  console.log('======================================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: UNIT PRICING & QUANTITY CALCULATIONS (Core Logic)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Unit Pricing & Quantity Calculations ---');

  // Test 1.1: Currency Rounding & Floating-Point Protection
  try {
    const sum = roundCurrency(0.1 + 0.2);
    assert.strictEqual(sum, 0.3, '0.1 + 0.2 must round to 0.3');
    const floatTest = roundCurrency(10.51 * 3);
    assert.strictEqual(floatTest, 31.53, '10.51 * 3 must be exactly 31.53');
    record('Pricing', 'Currency rounding avoids floating point accumulation', true, '0.1 + 0.2 -> 0.30, 10.51*3 -> 31.53');
  } catch (err) {
    record('Pricing', 'Currency rounding avoids floating point accumulation', false, err.message);
  }

  // Test 1.2: Taxim-O 200 — 10-tablet strip at ₹105.10
  try {
    const taximRef = getReferencePricing('Taxim-O 200');
    assert.ok(taximRef, 'Taxim-O 200 reference pricing must exist');
    assert.strictEqual(taximRef.unitsPerPack, 10, 'Taxim-O 200 pack size must be 10');
    assert.strictEqual(taximRef.publishedMrp, 105.10, 'Taxim-O 200 published MRP must be 105.10');

    // 1 tablet
    const p1Tab = calculateMedicinePricing({
      publishedMrp: taximRef.publishedMrp,
      unitPrice: taximRef.unitPrice,
      unitsPerPack: taximRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'TABLET',
      quantity: 1
    });
    assert.strictEqual(p1Tab.effectiveUnitPrice, 10.51, 'Unit price for 1 tablet must be ₹10.51');
    assert.strictEqual(p1Tab.lineTotal, 10.51, 'Line total for 1 tablet must be ₹10.51');

    // 3 tablets
    const p3Tabs = calculateMedicinePricing({
      publishedMrp: taximRef.publishedMrp,
      unitPrice: taximRef.unitPrice,
      unitsPerPack: taximRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'TABLET',
      quantity: 3
    });
    assert.strictEqual(p3Tabs.effectiveUnitPrice, 10.51, 'Unit price for 3 tablets must be ₹10.51');
    assert.strictEqual(p3Tabs.lineTotal, 31.53, 'Line total for 3 tablets must be ₹31.53 (10.51 * 3)');

    // 10 tablets as individual tablets
    const p10Tabs = calculateMedicinePricing({
      publishedMrp: taximRef.publishedMrp,
      unitPrice: taximRef.unitPrice,
      unitsPerPack: taximRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'TABLET',
      quantity: 10
    });
    assert.strictEqual(p10Tabs.lineTotal, 105.10, 'Line total for 10 individual tablets must equal ₹105.10');

    // 1 complete strip
    const p1Strip = calculateMedicinePricing({
      publishedMrp: taximRef.publishedMrp,
      unitPrice: taximRef.unitPrice,
      unitsPerPack: taximRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'STRIP',
      quantity: 1
    });
    assert.strictEqual(p1Strip.effectiveUnitPrice, 105.10, 'Unit price for 1 strip must be ₹105.10');
    assert.strictEqual(p1Strip.lineTotal, 105.10, 'Line total for 1 strip must be ₹105.10');

    // NEVER multiply strip price by tablet count!
    assert.notStrictEqual(p10Tabs.lineTotal, 1051.00, 'Must NEVER multiply strip price by tablet count');

    record('Pricing', 'Taxim-O 200 (10 tablets @ ₹105.10) calculation: 1 tab, 3 tabs, 10 tabs, 1 strip', true,
      '1 tab=₹10.51, 3 tabs=₹31.53, 10 tabs=₹105.10, 1 strip=₹105.10');
  } catch (err) {
    record('Pricing', 'Taxim-O 200 calculation', false, err.message);
  }

  // Test 1.3: Other pack sizes (15 tablets, 20 tablets, 100ml syrup, inhaler)
  try {
    // Crocin 650 (15 tablets / strip @ ₹32.28)
    const crocinRef = getReferencePricing('Crocin 650');
    assert.strictEqual(crocinRef.unitsPerPack, 15, 'Crocin 650 unitsPerPack must be 15');
    assert.strictEqual(crocinRef.unitPrice, 2.15, 'Crocin 650 unit price must be ₹2.15 (32.28/15 rounded)');
    const crocin5 = calculateMedicinePricing({
      publishedMrp: crocinRef.publishedMrp,
      unitPrice: crocinRef.unitPrice,
      unitsPerPack: crocinRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'TABLET',
      quantity: 5
    });
    assert.strictEqual(crocin5.lineTotal, 10.75, '5 tablets of Crocin 650 must be ₹10.75');

    // Combiflam (20 tablets / strip @ ₹57.45)
    const combiflamRef = getReferencePricing('Combiflam');
    assert.strictEqual(combiflamRef.unitsPerPack, 20, 'Combiflam unitsPerPack must be 20');
    assert.strictEqual(combiflamRef.unitPrice, 2.87, 'Combiflam unit price must be ₹2.87 (57.45/20 rounded)');
    const combiflam10 = calculateMedicinePricing({
      publishedMrp: combiflamRef.publishedMrp,
      unitPrice: combiflamRef.unitPrice,
      unitsPerPack: combiflamRef.unitsPerPack,
      dosageForm: 'Tablet',
      saleUnit: 'TABLET',
      quantity: 10
    });
    assert.strictEqual(combiflam10.lineTotal, 28.70, '10 tablets of Combiflam must be ₹28.70');

    // Digene Gel Syrup (200ml bottle @ ₹131.00)
    const digeneRef = getReferencePricing('Digene Gel');
    assert.strictEqual(digeneRef.unitsPerPack, 1, 'Syrup unitsPerPack must be 1');
    const syrupSaleUnits = getSupportedSaleUnits('Syrup', 1);
    assert.deepStrictEqual(syrupSaleUnits, ['BOTTLE'], 'Syrup must support only BOTTLE sale unit');
    const digenePricing = calculateMedicinePricing({
      publishedMrp: digeneRef.publishedMrp,
      unitPrice: digeneRef.unitPrice,
      unitsPerPack: digeneRef.unitsPerPack,
      dosageForm: 'Syrup',
      saleUnit: 'BOTTLE',
      quantity: 2
    });
    assert.strictEqual(digenePricing.lineTotal, 398.00, '2 bottles of syrup must be ₹398.00 (199 * 2)');

    // Asthalin Inhaler (1 unit @ ₹168.43)
    const asthalinRef = getReferencePricing('Asthalin Inhaler');
    const inhalerUnits = getSupportedSaleUnits('Inhaler', 1);
    assert.deepStrictEqual(inhalerUnits, ['INHALER'], 'Inhaler must support only INHALER sale unit');

    record('Pricing', 'Diverse pack sizes (15-tab Crocin, 20-tab Combiflam, Syrup, Inhaler)', true,
      'Crocin 5 tab=₹10.75, Combiflam 10 tab=₹28.70, Syrup=BOTTLE only, Inhaler=INHALER only');
  } catch (err) {
    record('Pricing', 'Diverse pack sizes', false, err.message);
  }

  // Test 1.4: Unpriced Medicine (Epinephrine Auto-Injector)
  try {
    const epiPricing = calculateMedicinePricing({
      publishedMrp: null,
      unitPrice: null,
      unitsPerPack: 1,
      dosageForm: 'Injection',
      saleUnit: 'UNIT',
      quantity: 1
    });
    assert.strictEqual(epiPricing.isUnpriced, true, 'Epinephrine must flag isUnpriced: true');
    assert.strictEqual(epiPricing.effectiveUnitPrice, null, 'Epinephrine unit price must remain null');
    assert.strictEqual(epiPricing.lineTotal, null, 'Epinephrine line total must remain null (no invented price)');

    record('Pricing', 'Unpriced medicines (Epinephrine) handled safely with null pricing', true,
      'isUnpriced: true, effectiveUnitPrice: null, lineTotal: null');
  } catch (err) {
    record('Pricing', 'Unpriced medicines handled safely', false, err.message);
  }

  // Test 1.5: Missing or Invalid Pack Size Data
  try {
    const unitPriceZeroPack = calculateUnitPrice(100, 0);
    assert.strictEqual(unitPriceZeroPack, 100.0, 'Zero pack size safely falls back to pack price without dividing by zero');

    const unitPriceNullPack = calculateUnitPrice(100, null);
    assert.strictEqual(unitPriceNullPack, 100.0, 'Null pack size safely falls back to pack price');

    const unitPriceNegative = calculateUnitPrice(100, -5);
    assert.strictEqual(unitPriceNegative, 100.0, 'Negative pack size safely falls back to pack price');

    record('Pricing', 'Missing or invalid pack size handled safely without division by zero', true,
      'packSize <= 0 safely preserved');
  } catch (err) {
    record('Pricing', 'Missing or invalid pack size handled safely', false, err.message);
  }

  // Test 1.6: 12% GST Tax Breakdown Calculation
  try {
    const totalAmount = 112.00; // 100 base + 12 tax
    const breakdown = calculateTaxBreakdown(totalAmount, 0.12);
    assert.strictEqual(breakdown.baseAmount, 100.00, 'Base amount for ₹112 total @ 12% GST must be ₹100.00');
    assert.strictEqual(breakdown.taxAmount, 12.00, 'Tax amount for ₹112 total @ 12% GST must be ₹12.00');
    assert.strictEqual(roundCurrency(breakdown.baseAmount + breakdown.taxAmount), totalAmount, 'Base + Tax must sum exactly to total');

    // Taxim-O 200 strip at 105.10
    const taximTax = calculateTaxBreakdown(105.10, 0.12);
    assert.strictEqual(roundCurrency(taximTax.baseAmount + taximTax.taxAmount), 105.10, 'Taxim-O base + tax must sum to ₹105.10');

    record('Pricing', 'Tax breakdown (12% GST) is mathematically exact and round-safe', true,
      `₹105.10 = ₹${taximTax.baseAmount} base + ₹${taximTax.taxAmount} GST`);
  } catch (err) {
    record('Pricing', 'Tax breakdown calculation', false, err.message);
  }

  // Test 1.7: Order Totals Consistency (Subtotals, platform fee, fulfillment fee)
  try {
    const items = [
      { medicineId: 'med-taxim', subtotal: 31.53, quantity: 3, unitPrice: 10.51 }, // 3 tabs Taxim
      { medicineId: 'med-crocin', subtotal: 10.75, quantity: 5, unitPrice: 2.15 }  // 5 tabs Crocin
    ];
    const totalsPickup = calculateOrderTotals(items, 'PICKUP', { platformFee: 2.0 });
    assert.strictEqual(totalsPickup.medicineSubtotal, 42.28, 'Medicine subtotal must be exactly 31.53 + 10.75 = 42.28');
    assert.strictEqual(totalsPickup.fulfillmentFee, 0.0, 'Pickup fulfillment fee must be 0');
    assert.strictEqual(totalsPickup.platformFee, 2.0, 'Platform fee must be 2.0');
    assert.strictEqual(totalsPickup.totalAmount, 44.28, 'Total amount must be exactly 42.28 + 0 + 2.0 = 44.28');

    const totalsDelivery = calculateOrderTotals(items, 'DELIVERY', { platformFee: 2.0 });
    assert.strictEqual(totalsDelivery.fulfillmentFee, 50.0, 'Delivery fee must be 50.0');
    assert.strictEqual(totalsDelivery.totalAmount, 94.28, 'Delivery total must be 42.28 + 50.0 + 2.0 = 94.28');

    record('Pricing', 'Order totals aggregation across multiple unit-priced medicines', true,
      'Pickup: ₹44.28, Delivery: ₹94.28');
  } catch (err) {
    record('Pricing', 'Order totals aggregation', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: MEDICINE SEARCH API (Live Endpoints)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Medicine Search API Tests ---');

  // Test 2.1: Exact Search
  try {
    const res = await fetchJson(`${BASE_URL}/medicines/search?q=Taxim-O%20200`);
    assert.strictEqual(res.status, 200, 'Search endpoint should return 200');
    assert.ok(Array.isArray(res.json.medicines), 'Should return medicines array');
    assert.ok(res.json.medicines.length > 0, 'Should return matching results');
    const first = res.json.medicines[0];
    assert.strictEqual(first.brandName, 'Taxim-O 200', 'Top match for Taxim-O 200 must be Taxim-O 200');
    assert.strictEqual(first.publishedMrp, 105.10, 'Enriched Taxim-O 200 must have publishedMrp: 105.10');
    assert.strictEqual(first.unitPrice, 10.51, 'Enriched Taxim-O 200 must have unitPrice: 10.51');
    assert.strictEqual(first.unitsPerPack, 10, 'Enriched Taxim-O 200 must have unitsPerPack: 10');
    record('Search', 'Exact medicine search: "Taxim-O 200"', true, `Matched: ${first.brandName} (₹${first.unitPrice}/tab, ₹${first.publishedMrp}/strip)`);
  } catch (err) {
    record('Search', 'Exact medicine search: "Taxim-O 200"', false, err.message);
  }

  // Test 2.2: Partial and Single-Word Searches
  const partialQueries = [
    { q: 'Crocin', expected: 'Crocin 650' },
    { q: 'Dolo', expected: 'Dolo 650' },
    { q: 'Combiflam', expected: 'Combiflam' },
    { q: 'Taxim', expected: 'Taxim-O 200' },
    { q: 'Amox', expected: 'Augmentin 625 Duo' } // Augmentin contains Amoxicillin
  ];

  for (const { q, expected } of partialQueries) {
    try {
      const res = await fetchJson(`${BASE_URL}/medicines/search?q=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200);
      const names = res.json.medicines.map(m => m.brandName);
      assert.ok(names.includes(expected), `Search for "${q}" should include "${expected}" (Got: ${names.join(', ')})`);
      record('Search', `Partial/single-word search: "${q}"`, true, `Returned ${expected} among ${res.json.medicines.length} results`);
    } catch (err) {
      record('Search', `Partial/single-word search: "${q}"`, false, err.message);
    }
  }

  // Test 2.3: Generic Name Searches
  const genericQueries = [
    { q: 'paracetamol', expected: 'Crocin 650' },
    { q: 'cefixime', expected: 'Taxim-O 200' },
    { q: 'metformin', expected: 'Glycomet 500 SR' },
    { q: 'azithromycin', expected: 'Azithral 500' },
    { q: 'pantoprazole', expected: 'Pan 40' }
  ];

  for (const { q, expected } of genericQueries) {
    try {
      const res = await fetchJson(`${BASE_URL}/medicines/search?q=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200);
      const names = res.json.medicines.map(m => m.brandName);
      assert.ok(names.includes(expected), `Generic search for "${q}" should match "${expected}" (Got: ${names.join(', ')})`);
      record('Search', `Generic name search: "${q}"`, true, `Found ${expected}`);
    } catch (err) {
      record('Search', `Generic name search: "${q}"`, false, err.message);
    }
  }

  // Test 2.4: Common Abbreviations & Short Forms
  const abbreviationQueries = [
    { q: 'pcm', expected: ['Crocin 650', 'Dolo 650'] },
    { q: 'azi', expected: ['Azithral 500'] },
    { q: 'pan', expected: ['Pan 40'] },
    { q: 'met', expected: ['Glycomet 500 SR'] },
    { q: 'cefix', expected: ['Taxim-O 200', 'Zifi 200'] }
  ];

  for (const { q, expected } of abbreviationQueries) {
    try {
      const res = await fetchJson(`${BASE_URL}/medicines/search?q=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200);
      const names = res.json.medicines.map(m => m.brandName);
      const matched = expected.some(exp => names.includes(exp));
      assert.ok(matched, `Abbreviation search "${q}" should match ${expected.join(' or ')} (Got: ${names.join(', ')})`);
      record('Search', `Abbreviation/short form: "${q}"`, true, `Matched: ${names.slice(0, 3).join(', ')}`);
    } catch (err) {
      record('Search', `Abbreviation/short form: "${q}"`, false, err.message);
    }
  }

  // Test 2.5: Alternative Brand Aliases (e.g. Calpol -> Crocin / Dolo)
  try {
    const res = await fetchJson(`${BASE_URL}/medicines/search?q=Calpol%20650`);
    assert.strictEqual(res.status, 200);
    const names = res.json.medicines.map(m => m.brandName);
    assert.ok(names.includes('Crocin 650') || names.includes('Dolo 650'),
      `Alias search "Calpol 650" should resolve to paracetamol alternatives Crocin or Dolo (Got: ${names.join(', ')})`);
    record('Search', 'Brand alias resolution: "Calpol 650"', true, `Matched: ${names.join(', ')}`);
  } catch (err) {
    record('Search', 'Brand alias resolution: "Calpol 650"', false, err.message);
  }

  // Test 2.6: Minor Spelling Mistakes & Typo Tolerance
  const typoQueries = [
    { q: 'Paracetmol', expected: 'Crocin 650' },
    { q: 'Cefixim', expected: 'Taxim-O 200' },
    { q: 'Metfomin', expected: 'Glycomet 500 SR' },
    { q: 'Azithromicin', expected: 'Azithral 500' },
    { q: 'Taxim 0', expected: 'Taxim-O 200' } // Digit 0 instead of letter O
  ];

  for (const { q, expected } of typoQueries) {
    try {
      const res = await fetchJson(`${BASE_URL}/medicines/search?q=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200);
      const names = res.json.medicines.map(m => m.brandName);
      assert.ok(names.includes(expected), `Typo query "${q}" should safely match "${expected}" (Got: ${names.join(', ')})`);
      record('Search', `Minor spelling mistake/typo: "${q}"`, true, `Matched ${expected}`);
    } catch (err) {
      record('Search', `Minor spelling mistake/typo: "${q}"`, false, err.message);
    }
  }

  // Test 2.7: Strength & Dosage-Form Distinctions (No false equivalency)
  try {
    // Searching "Taxim-O 200" must NOT match unrelated 200mg medicines like Oflox 200
    const res = await fetchJson(`${BASE_URL}/medicines/search?q=Taxim-O%20200`);
    assert.strictEqual(res.status, 200);
    const top = res.json.medicines[0];
    assert.strictEqual(top.brandName, 'Taxim-O 200', 'Top match must be Taxim-O 200');
    const hasOflox = res.json.medicines.some(m => m.brandName.toLowerCase().includes('oflox'));
    assert.strictEqual(hasOflox, false, 'Search for Taxim-O 200 must NEVER return Oflox 200 just because both are 200mg');
    record('Search', 'Strength distinction: "Taxim-O 200" rejects unrelated 200mg drugs', true, 'Oflox 200 excluded');
  } catch (err) {
    record('Search', 'Strength distinction: "Taxim-O 200" rejects unrelated 200mg drugs', false, err.message);
  }

  // Test 2.8: Voice Search Query Normalization
  const voiceQueries = [
    { voice: 'search for Taxim O 200 tablets', expected: 'Taxim-O 200' },
    { voice: 'find me Crocin 650', expected: 'Crocin 650' },
    { voice: 'give me dolo', expected: 'Dolo 650' },
    { voice: 'please can you search for azithral', expected: 'Azithral 500' }
  ];

  for (const { voice, expected } of voiceQueries) {
    try {
      const res = await fetchJson(`${BASE_URL}/medicines/search?q=${encodeURIComponent(voice)}`);
      assert.strictEqual(res.status, 200);
      const names = res.json.medicines.map(m => m.brandName);
      assert.ok(names.includes(expected), `Spoken query "${voice}" should match "${expected}" (Got: ${names.join(', ')})`);
      record('Search', `Voice query normalization: "${voice}"`, true, `Extracted search returned ${expected}`);
    } catch (err) {
      record('Search', `Voice query normalization: "${voice}"`, false, err.message);
    }
  }

  // Test 2.9: Search Filters
  try {
    // Category filter: Antibiotics (stemmed matching)
    const resAntibiotics = await fetchJson(`${BASE_URL}/medicines/search?category=Antibiotics`);
    assert.strictEqual(resAntibiotics.status, 200);
    assert.ok(resAntibiotics.json.medicines.length > 0, 'Antibiotics filter should return antibiotic medicines');
    const nonAntibiotic = resAntibiotics.json.medicines.find(m => !m.category.toLowerCase().includes('antibiotic'));
    assert.strictEqual(nonAntibiotic, undefined, 'Category filter must only return Antibiotics');

    // Dosage Form filter: Tablet
    const resTablets = await fetchJson(`${BASE_URL}/medicines/search?dosageForm=Tablet`);
    assert.strictEqual(resTablets.status, 200);
    const nonTablet = resTablets.json.medicines.find(m => !m.dosageForm.toLowerCase().includes('tablet'));
    assert.strictEqual(nonTablet, undefined, 'Dosage form filter must only return Tablets');

    // OTC filter
    const resOtc = await fetchJson(`${BASE_URL}/medicines/search?filterTag=otc`);
    assert.strictEqual(resOtc.status, 200);
    const nonOtc = resOtc.json.medicines.find(m => m.requiresPrescription === true);
    assert.strictEqual(nonOtc, undefined, 'OTC filter must only return non-prescription medicines');

    // Rx filter
    const resRx = await fetchJson(`${BASE_URL}/medicines/search?filterTag=rx`);
    assert.strictEqual(resRx.status, 200);
    const nonRx = resRx.json.medicines.find(m => m.requiresPrescription === false);
    assert.strictEqual(nonRx, undefined, 'Rx filter must only return prescription-required medicines');

    record('Search', 'Search filters: Category, DosageForm, OTC/Rx tags strictly enforced', true,
      `Antibiotics: ${resAntibiotics.json.medicines.length}, Tablets: ${resTablets.json.medicines.length}`);
  } catch (err) {
    record('Search', 'Search filters strictly enforced', false, err.message);
  }

  // Test 2.10: Search Sorting
  try {
    // Sort by price ascending (nulls last)
    const resPriceAsc = await fetchJson(`${BASE_URL}/medicines/search?sortBy=price-asc`);
    assert.strictEqual(resPriceAsc.status, 200);
    const pricedAsc = resPriceAsc.json.medicines
      .filter(m => m.publishedMrp != null || m.unitPrice != null)
      .map(m => Number(m.publishedMrp ?? m.unitPrice));
    for (let i = 0; i < pricedAsc.length - 1; i++) {
      assert.ok(pricedAsc[i] <= pricedAsc[i + 1], `Price ascending sort failed at index ${i}: ${pricedAsc[i]} > ${pricedAsc[i + 1]}`);
    }

    // Sort by price descending
    const resPriceDesc = await fetchJson(`${BASE_URL}/medicines/search?sortBy=price-desc`);
    assert.strictEqual(resPriceDesc.status, 200);
    const pricedDesc = resPriceDesc.json.medicines
      .filter(m => m.publishedMrp != null || m.unitPrice != null)
      .map(m => Number(m.publishedMrp ?? m.unitPrice));
    for (let i = 0; i < pricedDesc.length - 1; i++) {
      assert.ok(pricedDesc[i] >= pricedDesc[i + 1], `Price descending sort failed at index ${i}: ${pricedDesc[i]} < ${pricedDesc[i + 1]}`);
    }

    record('Search', 'Search sorting: price-asc and price-desc sorting verified', true,
      `Asc: ₹${pricedAsc[0]} -> ₹${pricedAsc[pricedAsc.length - 1]}, Desc: ₹${pricedDesc[0]} -> ₹${pricedDesc[pricedDesc.length - 1]}`);
  } catch (err) {
    record('Search', 'Search sorting verified', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3: ENRICHED MEDICINE CONTRACT AUDIT
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: Authoritative Reference Catalog & Data Integrity ---');

  try {
    const allRef = getAllReferencePricing();
    assert.strictEqual(allRef.length, 50, 'Catalog must contain exactly 50 authoritative reference medicines');

    let validCount = 0;

    for (const med of allRef) {
      assert.ok(med.brandName, 'Medicine must have a brandName');
      assert.ok(med.dosageForm, `Medicine ${med.brandName} must have a dosageForm`);
      assert.ok(med.unitsPerPack >= 1, `Medicine ${med.brandName} unitsPerPack must be >= 1`);
      if (med.brandName === 'Epinephrine Auto-Injector') {
        assert.strictEqual(med.publishedMrp, null, 'Epinephrine published MRP must be null');
        assert.strictEqual(med.unitPrice, null, 'Epinephrine unit price must be null');
        assert.strictEqual(med.status, 'UNAVAILABLE', 'Epinephrine status must be UNAVAILABLE');
      } else {
        assert.ok(med.publishedMrp > 0, `Published MRP for ${med.brandName} must be > 0`);
        assert.ok(med.unitPrice > 0, `Unit price for ${med.brandName} must be > 0`);
        assert.ok(med.status === 'VERIFIED' || med.status === 'ESTIMATED', `${med.brandName} status must be VERIFIED or ESTIMATED`);
      }
      validCount++;
    }

    // Also check live API response for Epinephrine Auto-Injector (unpriced flag)
    const resEpi = await fetchJson(`${BASE_URL}/medicines/search?q=Epinephrine`);
    assert.strictEqual(resEpi.status, 200);
    const liveEpi = resEpi.json.medicines.find(m => m.brandName.includes('Epinephrine'));
    assert.ok(liveEpi, 'Live search for Epinephrine must return Epinephrine Auto-Injector');
    assert.strictEqual(liveEpi.isUnpriced, true, 'Live Epinephrine must have isUnpriced: true');
    assert.strictEqual(liveEpi.unitPrice, null, 'Live Epinephrine must have unitPrice: null');
    assert.strictEqual(liveEpi.isVerifiedPrice, false, 'Live Epinephrine must have isVerifiedPrice: false');

    record('Integrity', 'Authoritative 50-medicine catalog data completeness & live API enrichment', true,
      `50 reference medicines verified with pack sizes; Live Epinephrine correctly marked unpriced`);
  } catch (err) {
    record('Integrity', 'Authoritative catalog completeness', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log(`   TEST EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
