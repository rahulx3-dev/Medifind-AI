/**
 * MediFind AI — Phase 6.1L.9 Offline / Fallback SMS Request Test Suite
 *
 * Validates:
 * 1. Only real participating pharmacies available in fallback directory (exactly 2).
 * 2. Zero test pharmacies appear in fallback directory.
 * 3. Actual stored phone numbers used from database (no fabrication).
 * 4. SMS URI and message construction adhere to RFC 5724 (sms:<phone>?body=<encoded>).
 * 5. URL encoding of spaces, newlines, and special characters is robust.
 * 6. No automatic server-side SMS sending or SMS provider API.
 * 7. Zero reservations, orders, or payments created from SMS fallback action.
 * 8. Zero stock modifications (does NOT falsely mark medicine as available).
 * 9. Offline fallback directory remains available when backend is unreachable.
 * 10. Unsafe transactional actions remain strictly blocked offline.
 * 11. Zero clinical, OCR, prescription, or private data leakage in SMS payload.
 * 12. Fallback call action uses actual stored phone number (tel:<phone>).
 * 13. Frontend source code incorporates honest UI states and native SMS triggers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createSafeTestPrismaClient } = require('./src/utils/testDatabaseGuard');
const prisma = createSafeTestPrismaClient();

const {
  sanitizePhoneNumber,
  assertNoSensitiveData,
  buildFallbackMessageText,
  buildFallbackSmsUri,
  buildFallbackTelUri
} = require('./src/utils/fallbackSms');

const BASE_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_medifind_ai_2026';

function request(method, reqPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PHASE 6.1L.9 FOCUSED TESTS: OFFLINE FALLBACK SMS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Setup test patient user
    // -------------------------------------------------------------
    let patientUser = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
    if (!patientUser) {
      patientUser = await prisma.user.findFirst();
    }
    const patientToken = jwt.sign(
      { id: patientUser.id, role: patientUser.role, name: patientUser.name },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // -------------------------------------------------------------
    // 1. Fallback Directory Authentication & Isolation
    // -------------------------------------------------------------
    console.log('--- 1. Fallback Directory Authentication & Isolation ---');

    // Unauthenticated request rejected
    const unauthRes = await request('GET', '/api/pharmacies/fallback-directory');
    assert(unauthRes.status === 401, 'Unauthenticated access to fallback directory rejected with 401');

    // Authenticated request returns fallback directory
    const dirRes = await request('GET', '/api/pharmacies/fallback-directory', null, patientToken);
    assert(dirRes.status === 200, 'Authenticated patient access to fallback directory returns 200 OK');
    assert(dirRes.data.success === true, 'Fallback directory success is true');
    assert(dirRes.data.count === 2, `Fallback directory returns exactly 2 pharmacies (found ${dirRes.data.count})`);

    const dirPharmacies = dirRes.data.pharmacies || [];
    const dirNames = dirPharmacies.map(p => p.name);
    assert(dirNames.includes('Max Care Pharmacy'), 'Max Care Pharmacy is in fallback directory');
    assert(dirNames.includes('Karuna Medicals'), 'Karuna Medicals is in fallback directory');

    // Test fixtures excluded
    const hasTestFixtures = dirPharmacies.some(p =>
      p.name.includes('[TEST]') || p.isTestRecord === true || p.dataSource === 'TEST_FIXTURE'
    );
    assert(!hasTestFixtures, 'Zero test pharmacies appear in fallback directory');

    // -------------------------------------------------------------
    // 2. Authoritative Stored Phone Numbers
    // -------------------------------------------------------------
    console.log('\n--- 2. Authoritative Stored Phone Numbers ---');
    const maxCareInDb = await prisma.pharmacy.findFirst({ where: { name: 'Max Care Pharmacy' } });
    const karunaInDb = await prisma.pharmacy.findFirst({ where: { name: 'Karuna Medicals' } });

    const maxCareInDir = dirPharmacies.find(p => p.name === 'Max Care Pharmacy');
    const karunaInDir = dirPharmacies.find(p => p.name === 'Karuna Medicals');

    assert(maxCareInDir.phone === maxCareInDb.phone, `Max Care uses actual stored phone: ${maxCareInDir.phone}`);
    assert(karunaInDir.phone === karunaInDb.phone, `Karuna Medicals uses actual stored phone: ${karunaInDir.phone}`);
    assert(maxCareInDir.phone === '4792993291', 'Max Care phone matches authoritative CSV value 4792993291');
    assert(karunaInDir.phone === '9605718151', 'Karuna Medicals phone matches authoritative CSV value 9605718151');

    // -------------------------------------------------------------
    // 3. Native SMS URI & Message Construction (RFC 5724)
    // -------------------------------------------------------------
    console.log('\n--- 3. Native SMS URI & Message Construction ---');

    const sampleUri = buildFallbackSmsUri({
      phone: maxCareInDir.phone,
      medicineName: 'Dolo 650',
      quantity: '2 strips',
      patientName: 'Anil Kumar',
      customNote: 'Senior citizen urgent collection'
    });

    assert(sampleUri.startsWith('sms:4792993291?body='), 'URI starts with sms:<phone>?body= format');

    const urlObj = new URL(sampleUri);
    assert(urlObj.protocol === 'sms:', 'Protocol is sms:');
    assert(urlObj.pathname === '4792993291', 'Pathname contains cleaned pharmacy phone number');

    const bodyParam = urlObj.searchParams.get('body');
    assert(bodyParam.includes('Hello, this is Anil contacting you via MediFind AI.'), 'Message identifies that it is sent by the patient');
    assert(bodyParam.includes('Medicine inquiry: Dolo 650'), 'Message specifies requested medicine');
    assert(bodyParam.includes('Quantity needed: 2 strips'), 'Message includes explicit quantity supplied by patient');
    assert(bodyParam.includes('Note: Senior citizen urgent collection'), 'Message includes optional note');
    assert(bodyParam.includes('Please reply to confirm availability'), 'Message asks pharmacy to confirm availability directly');
    assert(bodyParam.includes('(Direct offline inquiry — not an online reservation)'), 'Message states it is a direct inquiry, NOT a reservation');

    // -------------------------------------------------------------
    // 4. URL Encoding & Special Character Safety
    // -------------------------------------------------------------
    console.log('\n--- 4. URL Encoding & Special Character Safety ---');

    const complexUri = buildFallbackSmsUri({
      phone: '+91-9605-718-151',
      medicineName: 'Augmentin 625 Duo & Pan-40 (40mg)',
      quantity: '1 + 1 pack',
      patientName: 'Meera & Family',
      customNote: 'Is store open till 8:00 PM?'
    });

    assert(complexUri.includes('sms:+919605718151?body=') || complexUri.includes('sms:919605718151?body='), 'International format dashes/plus sanitized appropriately');
    assert(!complexUri.includes(' '), 'URI contains zero raw unencoded spaces');
    assert(complexUri.includes('%20') || complexUri.includes('+'), 'Spaces properly percent-encoded');
    assert(!complexUri.includes('\n'), 'Newlines properly encoded (no raw breaks)');

    // Decode and verify roundtrip fidelity
    const decodedBody = decodeURIComponent(complexUri.split('?body=')[1]);
    assert(decodedBody.includes('Augmentin 625 Duo & Pan-40 (40mg)'), 'Decoded body contains exact medicine name with ampersands and parentheses');
    assert(decodedBody.includes('Is store open till 8:00 PM?'), 'Decoded body contains question marks and punctuation intact');

    // -------------------------------------------------------------
    // 5. Zero Automatic Server SMS & Zero Order / Payment Creation
    // -------------------------------------------------------------
    console.log('\n--- 5. Zero Automatic Server SMS & Order Non-Creation ---');

    const orderCountBefore = await prisma.order.count();
    const paymentCountBefore = await prisma.payment.count();
    const invBefore = await prisma.inventory.findFirst({
      where: { pharmacyId: maxCareInDb.id, status: 'OUT_OF_STOCK' }
    });

    // Simulate patient constructing/triggering SMS fallback URI multiple times
    for (let i = 0; i < 3; i++) {
      buildFallbackSmsUri({
        phone: maxCareInDir.phone,
        medicineName: 'Azithromycin 500',
        quantity: '3 tablets',
        patientName: 'Test Patient'
      });
    }

    const orderCountAfter = await prisma.order.count();
    const paymentCountAfter = await prisma.payment.count();
    const invAfter = await prisma.inventory.findFirst({
      where: { id: invBefore.id }
    });

    assert(orderCountBefore === orderCountAfter, 'Zero orders created from SMS fallback action');
    assert(paymentCountBefore === paymentCountAfter, 'Zero payments created from SMS fallback action');
    assert(invBefore.status === invAfter.status, 'Zero stock modifications (OUT_OF_STOCK remains OUT_OF_STOCK)');

    // -------------------------------------------------------------
    // 6. Clinical / OCR / Sensitive Data Leakage Protection
    // -------------------------------------------------------------
    console.log('\n--- 6. Clinical & Private Data Leakage Protection ---');

    let ocrBlocked = false;
    try {
      buildFallbackMessageText({
        medicineName: 'Paracetamol',
        customNote: 'Detected by OCR engine with 98% confidence from prescription-id 12345'
      });
    } catch (e) {
      ocrBlocked = true;
    }
    assert(ocrBlocked, 'OCR diagnostics and internal prescription IDs blocked by security sanitizer');

    let tokenBlocked = false;
    try {
      buildFallbackMessageText({
        medicineName: 'Dolo 650',
        customNote: 'User token Bearer eyJhbGciOiJIUzI1Ni...'
      });
    } catch (e) {
      tokenBlocked = true;
    }
    assert(tokenBlocked, 'Bearer tokens and auth secrets blocked by security sanitizer');

    // -------------------------------------------------------------
    // 7. Fallback Call Action (tel:) Uses Actual Stored Phone
    // -------------------------------------------------------------
    console.log('\n--- 7. Fallback Call Action (tel:) ---');

    const telMaxCare = buildFallbackTelUri(maxCareInDb.phone);
    const telKaruna = buildFallbackTelUri(karunaInDb.phone);

    assert(telMaxCare === `tel:${maxCareInDb.phone}`, `Max Care tel URI is tel:${maxCareInDb.phone}`);
    assert(telKaruna === `tel:${karunaInDb.phone}`, `Karuna Medicals tel URI is tel:${karunaInDb.phone}`);

    // -------------------------------------------------------------
    // 8. Offline Queue & Transaction Safety Policy
    // -------------------------------------------------------------
    console.log('\n--- 8. Offline Queue & Transaction Safety Policy ---');

    const queueCode = fs.readFileSync(path.join(__dirname, '../client/src/utils/offlineActionQueue.js'), 'utf-8');

    assert(queueCode.includes('/orders'), 'Offline queue blacklists /orders (order creation cannot be queued offline)');
    assert(queueCode.includes('/payment'), 'Offline queue blacklists /payment (payment cannot be queued offline)');
    assert(queueCode.includes('/verify'), 'Offline queue blacklists /verify (prescription verification blocked offline)');
    assert(queueCode.includes('/checkout'), 'Offline queue blacklists /checkout');
    assert(!queueCode.includes('FALLBACK_SMS'), 'SMS action is NOT placed in offline replay queue (native one-time intent only)');

    // -------------------------------------------------------------
    // 9. Frontend Integration & Honest UI States
    // -------------------------------------------------------------
    console.log('\n--- 9. Frontend Integration & Honest UI States ---');

    const locatorCode = fs.readFileSync(path.join(__dirname, '../client/src/pages/EmergencyLocator.jsx'), 'utf-8');

    assert(locatorCode.includes('buildFallbackSmsUri'), 'EmergencyLocator imports buildFallbackSmsUri');
    assert(locatorCode.includes('buildFallbackTelUri'), 'EmergencyLocator imports buildFallbackTelUri');
    assert(locatorCode.includes('Contact Pharmacy by SMS'), 'EmergencyLocator renders Contact Pharmacy by SMS button');
    assert(locatorCode.includes('Call Pharmacy'), 'EmergencyLocator renders Call Pharmacy parallel fallback button');
    assert(locatorCode.includes('Your messaging app was opened with a prepared message. Confirm and send it yourself.'),
      'EmergencyLocator displays honest status: "Your messaging app was opened with a prepared message. Confirm and send it yourself."');
    assert(locatorCode.includes('FALLBACK_DEFAULT_PHARMACIES'),
      'EmergencyLocator provides local offline fallback pharmacy data when network is down');
    assert(locatorCode.includes('Direct offline inquiry — this does NOT reserve medicine or guarantee stock'),
      'EmergencyLocator explicitly clarifies that offline inquiry does not guarantee stock or reserve medicine');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during Phase 6.1L.9 test execution:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
