'use strict';

/**
 * MediFind AI — Live HTTP PostgreSQL Integration Test Suite
 *
 * Real HTTP-backed integration test suite executing against the local Express app
 * and disposable database (medifind_disposable_test on localhost:5432).
 *
 * STRICT SAFETY ENFORCEMENT:
 * 1. Uses assertSafeTestDatabase() and createSafeTestPrismaClient() strictly bound
 *    to TEST_DATABASE_URL from server/.env.test.local.
 * 2. Preflight verification: Confirms current_database() === 'medifind_disposable_test'
 *    and port === 5432 for both the safe test client and the controller's global Prisma client.
 * 3. Never connects to Neon, production, or staging.
 * 4. Binds to 127.0.0.1 on an OS-assigned ephemeral port (PORT=0), ensuring zero collision.
 * 5. Cancels background timers immediately via stopClinicalTimeoutWorker().
 * 6. Generates unique ephemeral test fixtures tagged with an isolated run ID.
 * 7. Guarantees complete reverse-dependency cleanup in a finally block and verifies
 *    zero test artifacts remain in the database.
 * 8. Closes the HTTP server cleanly in finally.
 * 9. Exercises the 10 core HTTP scenarios with authentic JWT authorization headers:
 *    - Scenario 1: Authentication rejection on unauthenticated request (401).
 *    - Scenario 2: Role authorization boundary enforcement (Patient -> Pharmacist queue: 403).
 *    - Scenario 3: Live Split-Order creation and idempotency over HTTP (201).
 *    - Scenario 4: Live Checkout Summary retrieval (200, fee ledger calculation, zero payment calls).
 *    - Scenario 5: Live Order Confirmation & Inventory Decrement (200, atomic DB stock update).
 *    - Scenario 6: Live Multilingual Emergency Triage submission (201, voice input, 108 guidance).
 *    - Scenario 7: Live Pharmacy Queue retrieval and first-read OPENED transition (200).
 *    - Scenario 8: Live Cross-Pharmacy response rejection (403 Forbidden).
 *    - Scenario 9: Live Authorized Pharmacist response (200, status -> RESPONDED).
 *    - Scenario 10: Live Patient Follow-Up transition (200, status -> CLOSED).
 */

const assert = require('assert');
const { URL } = require('url');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createSafeTestPrismaClient, assertSafeTestDatabase } = require('./src/utils/testDatabaseGuard');

// ── Guard Validation & Environment Configuration ──────────────────────────────
const initialGuard = assertSafeTestDatabase();
if (!initialGuard.isSafe) {
  throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${initialGuard.error}`);
}

const parsedInitialUrl = new URL(initialGuard.resolvedUrl);
const allowedHosts = new Set(['localhost', '127.0.0.1']);
if (
  parsedInitialUrl.pathname !== '/medifind_disposable_test' ||
  !allowedHosts.has(parsedInitialUrl.hostname) ||
  Number(parsedInitialUrl.port || 5432) !== 5432
) {
  throw new Error(
    `[FAIL CLOSED] Target database must be strictly medifind_disposable_test on localhost:5432. Received: ${initialGuard.maskedHost}`
  );
}

// Configure process connection variables from validated local test URL
process.env.DATABASE_URL = initialGuard.resolvedUrl;
process.env.DATABASE_URL_UNPOOLED = initialGuard.resolvedUrl;
process.env.DIRECT_URL = initialGuard.resolvedUrl;
process.env.TEST_DATABASE_URL = initialGuard.resolvedUrl;
process.env.ENABLE_PLATFORM_FEE = 'true';
// Set PORT to 0 so when server.js executes app.listen(PORT), OS selects an ephemeral free port
process.env.PORT = '0';

// Evict cached modules to guarantee binding to the validated local test URL
try {
  delete require.cache[require.resolve('./src/prisma')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/utils/clinicalTimeoutWorker')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/server')];
} catch (_) {}

const { stopClinicalTimeoutWorker } = require('./src/utils/clinicalTimeoutWorker');
// Importing server.js will mount Express routes and start listening on port 0
const app = require('./src/server');
// Immediately cancel any background timer initiated by server.js
stopClinicalTimeoutWorker();

const globalPrisma = require('./src/prisma');
const { JWT_SECRET } = require('./src/middlewares/auth');

// Unique run tag to ensure zero collision with any other tests
const RUN_ID = `live_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

let passCount = 0;
let failCount = 0;

function check(title, condition, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✓ PASS: ${title}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${title} ${details ? '(' + details + ')' : ''}`);
    throw new Error(`Assertion failed: ${title}`);
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function apiRequest(baseUrl, path, { method = 'GET', headers = {}, body = null } = {}) {
  const url = `${baseUrl}${path}`;
  const reqHeaders = { ...headers };
  let payloadStr = null;

  if (body !== null && typeof body === 'object') {
    reqHeaders['Content-Type'] = 'application/json';
    payloadStr = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: payloadStr
  });

  let responseBody = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    responseBody = await response.json();
  } else {
    responseBody = await response.text();
  }

  return {
    status: response.status,
    headers: response.headers,
    body: responseBody
  };
}

async function runLiveHttpIntegrationTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('🌐  MEDIFIND AI — LIVE HTTP POSTGRESQL INTEGRATION TEST SUITE');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // ── Preflight Step 1: Guard Validation ──────────────────────────────────────
  console.log('─── Preflight 1: Offline Database Guard Validation ───');
  const guard = assertSafeTestDatabase();
  if (!guard.isSafe) {
    throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${guard.error}`);
  }
  console.log(`✓ Safety Guard Accepted: ${guard.identityType} (${guard.maskedHost})`);

  const prisma = createSafeTestPrismaClient();

  // ── Preflight Step 2: Live Connection & Identity Verification ──────────────
  console.log('\n─── Preflight 2: Verifying PostgreSQL Connection & Identity ───');
  const meta = await prisma.$queryRawUnsafe(`
    SELECT 
      current_database() as db_name,
      inet_server_port() as server_port,
      inet_server_addr()::text as server_ip,
      current_user as db_user
  `);

  const dbInfo = meta[0];
  console.log(`✓ Safe Test Client Connected to Database: "${dbInfo.db_name}"`);
  console.log(`✓ Safe Test Client Connected Port: ${dbInfo.server_port}`);
  console.log(`✓ Safe Test Client Connected Role: ${dbInfo.db_user}`);

  if (dbInfo.db_name !== 'medifind_disposable_test') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Safe test client connected to "${dbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(dbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Safe test client connected to port ${dbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // Also verify controller's global Prisma client targets exactly medifind_disposable_test on localhost
  const globalMeta = await globalPrisma.$queryRawUnsafe(`
    SELECT 
      current_database() as db_name,
      inet_server_port() as server_port,
      inet_server_addr()::text as server_ip,
      current_user as db_user
  `);

  const globalDbInfo = globalMeta[0];
  console.log(`✓ Global Controller Prisma Connected to Database: "${globalDbInfo.db_name}"`);
  console.log(`✓ Global Controller Prisma Connected Port: ${globalDbInfo.server_port}`);

  if (globalDbInfo.db_name !== 'medifind_disposable_test') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Global Prisma client connected to "${globalDbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(globalDbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Global Prisma client connected to port ${globalDbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // ── Preflight Step 3: Start Ephemeral HTTP Server on 127.0.0.1 ──────────────
  console.log('\n─── Preflight 3: Starting Ephemeral HTTP Server ───');
  let testServer = null;
  let baseUrl = '';

  await new Promise((resolve, reject) => {
    testServer = http.createServer(app);
    testServer.listen(0, '127.0.0.1', () => {
      const addr = testServer.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      console.log(`✓ Ephemeral HTTP Server listening on: ${baseUrl}`);
      resolve();
    });
    testServer.on('error', reject);
  });

  // Tracking fixture IDs for deterministic cleanup
  const createdUserIds = [];
  const createdPharmacyIds = [];
  const createdMedicineIds = [];
  const createdInventoryIds = [];
  const createdPrescriptionIds = [];
  const createdOrderIds = [];
  const createdRequestIds = [];

  const cleanupErrors = [];

  try {
    // ── Setup: Ephemeral Test Fixtures ──────────────────────────────────────
    console.log('\n─── Setting Up Ephemeral Test Fixtures ───');

    // 1. Patient User
    const patientUser = await prisma.user.create({
      data: {
        name: `HTTP Patient ${RUN_ID}`,
        email: `patient_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PATIENT',
        phone: '9876543220'
      }
    });
    createdUserIds.push(patientUser.id);
    const patientToken = signToken(patientUser);

    // 2. Two Pharmacists
    const pharmacistUser1 = await prisma.user.create({
      data: {
        name: `HTTP Pharmacist 1 ${RUN_ID}`,
        email: `pharm1_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PHARMACIST',
        phone: '9876543221'
      }
    });
    createdUserIds.push(pharmacistUser1.id);
    const pharmacistToken1 = signToken(pharmacistUser1);

    const pharmacistUser2 = await prisma.user.create({
      data: {
        name: `HTTP Pharmacist 2 ${RUN_ID}`,
        email: `pharm2_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PHARMACIST',
        phone: '9876543222'
      }
    });
    createdUserIds.push(pharmacistUser2.id);
    const pharmacistToken2 = signToken(pharmacistUser2);

    // 3. Two Verified Pharmacies managed by the pharmacists
    const pharmacy1 = await prisma.pharmacy.create({
      data: {
        name: `Live Care Pharmacy A ${RUN_ID}`,
        licenseNumber: `KL-LIVE-${RUN_ID}-1`,
        address: '100 Main St, Chengannur',
        phone: '9876543221',
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        rating: 4.8,
        latitude: 9.3176,
        longitude: 76.6120,
        managerId: pharmacistUser1.id
      }
    });
    createdPharmacyIds.push(pharmacy1.id);

    const pharmacy2 = await prisma.pharmacy.create({
      data: {
        name: `Live Care Pharmacy B ${RUN_ID}`,
        licenseNumber: `KL-LIVE-${RUN_ID}-2`,
        address: '200 River Rd, Chengannur',
        phone: '9876543222',
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        rating: 4.5,
        latitude: 9.3180,
        longitude: 76.6130,
        managerId: pharmacistUser2.id
      }
    });
    createdPharmacyIds.push(pharmacy2.id);

    // 4. Two Medicines & Inventory
    const medicineA = await prisma.medicine.create({
      data: {
        brandName: `LiveMed Alpha ${RUN_ID}`,
        genericName: 'Paracetamol 650mg',
        dosageForm: 'Tablet',
        strength: '650mg',
        category: 'Analgesic',
        manufacturer: 'Kerala State Pharma'
      }
    });
    createdMedicineIds.push(medicineA.id);

    const medicineB = await prisma.medicine.create({
      data: {
        brandName: `LiveMed Beta ${RUN_ID}`,
        genericName: 'Amoxicillin 500mg',
        dosageForm: 'Capsule',
        strength: '500mg',
        category: 'Antibiotic',
        manufacturer: 'Kerala State Pharma'
      }
    });
    createdMedicineIds.push(medicineB.id);

    const inventory1 = await prisma.inventory.create({
      data: {
        pharmacyId: pharmacy1.id,
        medicineId: medicineA.id,
        stock: 50,
        price: 25.0,
        status: 'AVAILABLE'
      }
    });
    createdInventoryIds.push(inventory1.id);

    const inventory2 = await prisma.inventory.create({
      data: {
        pharmacyId: pharmacy2.id,
        medicineId: medicineB.id,
        stock: 40,
        price: 45.0,
        status: 'AVAILABLE'
      }
    });
    createdInventoryIds.push(inventory2.id);

    // 5. Verified Prescription with Prescription Items for Split-Order
    const prescription = await prisma.prescription.create({
      data: {
        userId: patientUser.id,
        originalFileName: `prescription_${RUN_ID}.jpg`,
        filePath: `uploads/test_${RUN_ID}.jpg`,
        status: 'VERIFIED'
      }
    });
    createdPrescriptionIds.push(prescription.id);

    const pItemA = await prisma.prescriptionItem.create({
      data: {
        prescriptionId: prescription.id,
        medicineId: medicineA.id,
        prescribedName: `LiveMed Alpha ${RUN_ID}`,
        quantity: 10,
        isVerified: true
      }
    });

    const pItemB = await prisma.prescriptionItem.create({
      data: {
        prescriptionId: prescription.id,
        medicineId: medicineB.id,
        prescribedName: `LiveMed Beta ${RUN_ID}`,
        quantity: 5,
        isVerified: true
      }
    });

    console.log(`✓ Fixtures created: 1 Patient, 2 Pharmacists, 2 Pharmacies, 2 Medicines, 1 Verified Prescription.`);

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 1: Authentication Rejection (401)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 1: Authentication Rejection on Unauthenticated Request ───');
    {
      const res = await apiRequest(baseUrl, '/api/orders/split', {
        method: 'POST',
        body: { allocations: [] }
      });

      check('Scenario 1: Returns HTTP 401 Unauthorized', res.status === 401, `Status: ${res.status}`);
      check('Scenario 1: Error message indicates token required', res.body?.error?.includes('Access token required'));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 2: Role Authorization Boundary (403)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 2: Role Authorization Boundary (Patient -> Pharmacist Queue) ───');
    {
      const res = await apiRequest(baseUrl, '/api/clinical-assistance/pharmacy-queue', {
        method: 'GET',
        headers: { Authorization: `Bearer ${patientToken}` }
      });

      check('Scenario 2: Patient accessing pharmacist queue returns HTTP 403 Forbidden', res.status === 403, `Status: ${res.status}`);
      check('Scenario 2: Error message specifies role restriction', res.body?.error?.includes('pharmacists'));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 3: Live Split-Order Creation & Idempotency
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 3: Live Split-Order Creation & Idempotency over HTTP ───');
    let parentOrderId;
    let childOrder1Id;
    let childOrder2Id;
    {
      const idempotencyKey = `http_idem_${RUN_ID}`;
      const splitPayload = {
        idempotencyKey,
        prescriptionId: prescription.id,
        allocations: [
          {
            pharmacyId: pharmacy1.id,
            prescriptionItemId: pItemA.id,
            quantity: 4
          },
          {
            pharmacyId: pharmacy2.id,
            prescriptionItemId: pItemB.id,
            quantity: 3
          }
        ],
        notes: 'Live HTTP Split-Order'
      };

      // First Request
      const res1 = await apiRequest(baseUrl, '/api/orders/split', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${patientToken}`,
          'idempotency-key': idempotencyKey
        },
        body: splitPayload
      });

      check('Scenario 3: Split order creation returns HTTP 201 Created', res1.status === 201, `Status: ${res1.status}`);
      check('Scenario 3: Success flag is true', res1.body?.success === true);
      check('Scenario 3: Returns exactly 2 child orders', res1.body?.childOrders?.length === 2);

      parentOrderId = res1.body?.parentOrder?.id;
      createdOrderIds.push(parentOrderId);

      childOrder1Id = res1.body?.childOrders[0]?.id;
      childOrder2Id = res1.body?.childOrders[1]?.id;
      createdOrderIds.push(childOrder1Id, childOrder2Id);

      // Verify Idempotent Replay with same key
      const res2 = await apiRequest(baseUrl, '/api/orders/split', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${patientToken}`,
          'idempotency-key': idempotencyKey
        },
        body: splitPayload
      });

      check('Scenario 3: Idempotent replay returns HTTP 200 OK', res2.status === 200, `Status: ${res2.status}`);
      check('Scenario 3: Replayed response indicates isIdempotentReplay', res2.body?.isIdempotentReplay === true);
      check('Scenario 3: Replayed response matches parentOrderId', res2.body?.parentOrder?.id === parentOrderId);

      // Verify PostgreSQL state
      const childCountInDb = await prisma.order.count({
        where: { parentOrderId }
      });
      check('Scenario 3: Exactly 2 child orders persisted in PostgreSQL', childCountInDb === 2);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 4: Live Checkout Summary
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 4: Live Checkout Summary over HTTP ───');
    {
      const res = await apiRequest(baseUrl, `/api/checkout/${childOrder1Id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${patientToken}` }
      });

      check('Scenario 4: Checkout summary returns HTTP 200 OK', res.status === 200, `Status: ${res.status}`);
      check('Scenario 4: Returns checkout object', !!res.body?.checkout);
      check('Scenario 4: Returns correct orderId', res.body?.checkout?.orderId === childOrder1Id);
      check('Scenario 4: Returns totals breakdown', !!res.body?.checkout?.totals);
      check('Scenario 4: Currency is INR', res.body?.checkout?.totals?.currency === 'INR');
      check('Scenario 4: No payment initiated yet', res.body?.checkout?.payment === null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 5: Live Order Confirmation & Inventory Decrement
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 5: Live Order Confirmation & Inventory Decrement ───');
    {
      // Pharmacist 1 confirms childOrder1 (managed by Pharmacy 1)
      const initialStock = inventory1.stock; // 50 units

      const res = await apiRequest(baseUrl, `/api/orders/${childOrder1Id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${pharmacistToken1}` },
        body: {
          status: 'CONFIRMED',
          comment: 'Stock verified by pharmacist'
        }
      });

      check('Scenario 5: Pharmacist status update returns HTTP 200 OK', res.status === 200, `Status: ${res.status}`);
      check('Scenario 5: Order status is CONFIRMED', res.body?.order?.status === 'CONFIRMED');

      // Verify in PostgreSQL: inventory stock decremented by ordered quantity (4 units: 50 -> 46)
      const updatedInv = await prisma.inventory.findUnique({
        where: { id: inventory1.id }
      });
      check('Scenario 5: PostgreSQL inventory stock decremented from 50 to 46', updatedInv?.stock === 46, `Stock: ${updatedInv?.stock}`);

      // Verify status history created
      const history = await prisma.orderStatusHistory.findFirst({
        where: { orderId: childOrder1Id, status: 'CONFIRMED' }
      });
      check('Scenario 5: Status history record persisted in PostgreSQL', !!history);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 6: Live Multilingual Emergency Triage Submission
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 6: Live Multilingual Emergency Triage Submission ───');
    let clinicalReqId;
    {
      const res = await apiRequest(baseUrl, '/api/clinical-assistance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${patientToken}` },
        body: {
          concernText: 'കടുത്ത നെഞ്ചുവേദനയും ശ്വാസതടസ്സവും ഉണ്ട് (Severe chest tightness and breathing difficulty)',
          language: 'ml',
          inputMethod: 'VOICE',
          latitude: 9.3176,
          longitude: 76.6120
        }
      });

      check('Scenario 6: Clinical assistance submission returns HTTP 201 Created', res.status === 201, `Status: ${res.status}`);
      check('Scenario 6: Response indicates emergency is true', res.body?.request?.isEmergency === true);
      check('Scenario 6: Language is Malayalam (ml)', res.body?.request?.language === 'ml');
      check('Scenario 6: Status is UNDER_REVIEW', res.body?.request?.status === 'UNDER_REVIEW');
      check('Scenario 6: Routing dispatched eligible pharmacies', res.body?.routing?.dispatchedCount >= 1);

      clinicalReqId = res.body?.request?.id;
      createdRequestIds.push(clinicalReqId);

      // Verify in PostgreSQL
      const dbReq = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: clinicalReqId }
      });
      check('Scenario 6: Request persisted in PostgreSQL', !!dbReq);
      check('Scenario 6: Emergency guidance contains 108/112', dbReq?.emergencyGuidance?.includes('108'));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 7: Live Pharmacy Queue & First-Read OPENED Transition
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 7: Live Pharmacy Queue & First-Read OPENED Transition ───');
    {
      // 7A: Pharmacist 1 queries queue over HTTP
      const resQueue = await apiRequest(baseUrl, '/api/clinical-assistance/pharmacy-queue', {
        method: 'GET',
        headers: { Authorization: `Bearer ${pharmacistToken1}` }
      });

      check('Scenario 7A: Pharmacist queue returns HTTP 200 OK', resQueue.status === 200);
      const queueItems = resQueue.body?.queue || [];
      const item = queueItems.find(q => q.request?.id === clinicalReqId);
      check('Scenario 7A: Request is present in Pharmacist 1 queue', !!item);
      check('Scenario 7A: Initial queue status is ASSIGNED', item?.assignmentStatus === 'ASSIGNED');

      // 7B: Pharmacist 1 fetches request details over HTTP
      const resDetail = await apiRequest(baseUrl, `/api/clinical-assistance/${clinicalReqId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${pharmacistToken1}` }
      });

      check('Scenario 7B: Request detail returns HTTP 200 OK', resDetail.status === 200);
      check('Scenario 7B: Details include requestNumber', !!resDetail.body?.request?.requestNumber);

      // Verify in PostgreSQL: assignment status transitioned to OPENED
      const assignment1 = await prisma.clinicalAssistanceAssignment.findFirst({
        where: {
          requestId: clinicalReqId,
          pharmacyId: pharmacy1.id
        }
      });
      check('Scenario 7B: Assignment status transitioned to OPENED in PostgreSQL', assignment1?.status === 'OPENED');
      check('Scenario 7B: openedAt timestamp was populated', !!assignment1?.openedAt);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 8: Live Cross-Pharmacy Response Rejection
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 8: Live Cross-Pharmacy Response Rejection ───');
    {
      // Create an isolated pharmacy managed by Pharmacist 2 that is NOT assigned to this request
      // Pharmacist 2 tries to respond
      const unassignedPharmacistUser = await prisma.user.create({
        data: {
          name: `Unassigned Pharm ${RUN_ID}`,
          email: `unassigned_${RUN_ID}@example.com`,
          password: 'hashed_password_safe',
          role: 'PHARMACIST',
          phone: '9876543299'
        }
      });
      createdUserIds.push(unassignedPharmacistUser.id);

      const unassignedPharmacy = await prisma.pharmacy.create({
        data: {
          name: `Unassigned Pharmacy ${RUN_ID}`,
          licenseNumber: `KL-UNASS-${RUN_ID}`,
          address: '999 Far Away St',
          phone: '9876543299',
          isOpen: true,
          isVerified: true,
          verificationStatus: 'VERIFIED',
          managerId: unassignedPharmacistUser.id
        }
      });
      createdPharmacyIds.push(unassignedPharmacy.id);
      const unassignedToken = signToken(unassignedPharmacistUser);

      const res = await apiRequest(baseUrl, `/api/clinical-assistance/${clinicalReqId}/respond`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${unassignedToken}` },
        body: {
          clinicianResponse: 'Unauthorized clinical response attempt.'
        }
      });

      check('Scenario 8: Cross-pharmacy response rejected with HTTP 403 Forbidden', res.status === 403, `Status: ${res.status}`);
      check('Scenario 8: Error message indicates access denied', res.body?.error?.includes('Access denied'));

      // Verify in PostgreSQL: request status remains UNDER_REVIEW
      const dbReq = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: clinicalReqId }
      });
      check('Scenario 8: Request status remains UNDER_REVIEW in PostgreSQL', dbReq?.status === 'UNDER_REVIEW');
      check('Scenario 8: clinicianResponse remains null', dbReq?.clinicianResponse === null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 9: Live Authorized Pharmacist Response
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 9: Live Authorized Pharmacist Response over HTTP ───');
    {
      const responseText = 'Please proceed immediately to the nearest casualty or emergency room. Emergency services have been advised.';
      const res = await apiRequest(baseUrl, `/api/clinical-assistance/${clinicalReqId}/respond`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken1}` },
        body: {
          clinicianResponse: responseText,
          internalNotes: 'Patient advised on emergency protocol.'
        }
      });

      check('Scenario 9: Authorized response returns HTTP 200 OK', res.status === 200, `Status: ${res.status}`);
      check('Scenario 9: Success flag is true', res.body?.success === true);

      // Verify in PostgreSQL
      const dbReq = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: clinicalReqId }
      });
      check('Scenario 9: Request status transitioned to RESPONDED in PostgreSQL', dbReq?.status === 'RESPONDED');
      check('Scenario 9: clinicianResponse persisted accurately', dbReq?.clinicianResponse === responseText);
      check('Scenario 9: respondedById matches Pharmacist 1', dbReq?.respondedById === pharmacistUser1.id);

      // Verify assignment status transitioned to RESPONDED
      const assignment = await prisma.clinicalAssistanceAssignment.findFirst({
        where: {
          requestId: clinicalReqId,
          pharmacyId: pharmacy1.id
        }
      });
      check('Scenario 9: Pharmacy assignment status transitioned to RESPONDED in PostgreSQL', assignment?.status === 'RESPONDED');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 10: Live Patient Follow-Up Transition
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 10: Live Patient Follow-Up Transition over HTTP ───');
    {
      const res = await apiRequest(baseUrl, `/api/clinical-assistance/${clinicalReqId}/follow-up`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${patientToken}` },
        body: {
          followUpState: 'RESOLVED',
          notes: 'Emergency hospital visit attended; condition stable.'
        }
      });

      check('Scenario 10: Patient follow-up returns HTTP 200 OK', res.status === 200, `Status: ${res.status}`);
      check('Scenario 10: Follow-up state is RESOLVED', res.body?.followUpState === 'RESOLVED');
      check('Scenario 10: Request status transitioned to CLOSED', res.body?.request?.status === 'CLOSED');

      // Verify in PostgreSQL
      const dbReq = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: clinicalReqId }
      });
      check('Scenario 10: PostgreSQL status is strictly CLOSED', dbReq?.status === 'CLOSED');
      check('Scenario 10: Follow-up tag recorded in internalNotes', dbReq?.internalNotes?.includes('[FOLLOW_UP:RESOLVED:'));
    }

  } catch (error) {
    failCount++;
    console.error('\n❌ Unhandled Live HTTP Integration Test Error:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    console.log('\n─── Cleanup: Deleting Fixtures in Reverse Foreign-Key Order ───');

    // Close HTTP Server
    if (testServer) {
      try {
        await new Promise((resolve) => testServer.close(resolve));
        console.log('✓ Ephemeral HTTP server closed cleanly');
      } catch (err) {
        cleanupErrors.push(`Failed to close HTTP server: ${err.message}`);
      }
    }

    // 1. Delete Notifications referencing test users
    try {
      const deletedNotifs = await prisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } }
      });
      console.log(`✓ Deleted ${deletedNotifs.count} test notification records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Notifications: ${err.message}`);
    }

    // 2. Delete Clinical Assistance Assignments & Requests
    try {
      const deletedAssignments = await prisma.clinicalAssistanceAssignment.deleteMany({
        where: {
          OR: [
            { requestId: { in: createdRequestIds } },
            { pharmacyId: { in: createdPharmacyIds } }
          ]
        }
      });
      console.log(`✓ Deleted ${deletedAssignments.count} test clinical assignments`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete ClinicalAssistanceAssignment: ${err.message}`);
    }

    try {
      const deletedRequests = await prisma.clinicalAssistanceRequest.deleteMany({
        where: {
          OR: [
            { id: { in: createdRequestIds } },
            { patientId: { in: createdUserIds } }
          ]
        }
      });
      console.log(`✓ Deleted ${deletedRequests.count} test clinical requests`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete ClinicalAssistanceRequest: ${err.message}`);
    }

    // 3. Delete Idempotency Records
    try {
      const deletedIdempotency = await prisma.idempotencyRecord.deleteMany({
        where: { userId: { in: createdUserIds } }
      });
      console.log(`✓ Deleted ${deletedIdempotency.count} test idempotency records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete IdempotencyRecord: ${err.message}`);
    }

    // 4. Delete Order Status History, Order Items, and Orders
    try {
      const deletedHistory = await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } }
      });
      console.log(`✓ Deleted ${deletedHistory.count} test order status history records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete OrderStatusHistory: ${err.message}`);
    }

    try {
      const deletedItems = await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } }
      });
      console.log(`✓ Deleted ${deletedItems.count} test order item records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete OrderItem: ${err.message}`);
    }

    try {
      // Delete child orders first, then parent orders
      const deletedChildOrders = await prisma.order.deleteMany({
        where: {
          id: { in: createdOrderIds },
          parentOrderId: { not: null }
        }
      });
      const deletedParentOrders = await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } }
      });
      console.log(`✓ Deleted ${deletedChildOrders.count + deletedParentOrders.count} test order records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Order: ${err.message}`);
    }

    // 5. Delete Prescription Items & Prescriptions
    try {
      const deletedRxItems = await prisma.prescriptionItem.deleteMany({
        where: { prescriptionId: { in: createdPrescriptionIds } }
      });
      console.log(`✓ Deleted ${deletedRxItems.count} test prescription items`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete PrescriptionItem: ${err.message}`);
    }

    try {
      const deletedRx = await prisma.prescription.deleteMany({
        where: { id: { in: createdPrescriptionIds } }
      });
      console.log(`✓ Deleted ${deletedRx.count} test prescriptions`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Prescription: ${err.message}`);
    }

    // 6. Delete Inventory, Medicines, Pharmacies, Users
    try {
      const deletedInv = await prisma.inventory.deleteMany({
        where: { id: { in: createdInventoryIds } }
      });
      console.log(`✓ Deleted ${deletedInv.count} test inventory records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Inventory: ${err.message}`);
    }

    try {
      const deletedMeds = await prisma.medicine.deleteMany({
        where: { id: { in: createdMedicineIds } }
      });
      console.log(`✓ Deleted ${deletedMeds.count} test medicine records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Medicine: ${err.message}`);
    }

    try {
      const deletedPharmacies = await prisma.pharmacy.deleteMany({
        where: { id: { in: createdPharmacyIds } }
      });
      console.log(`✓ Deleted ${deletedPharmacies.count} test pharmacy records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Pharmacy: ${err.message}`);
    }

    try {
      const deletedUsers = await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } }
      });
      console.log(`✓ Deleted ${deletedUsers.count} test user records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete User: ${err.message}`);
    }

    // ── Residual Artifact Check ─────────────────────────────────────────────
    console.log('\n─── Residual Artifact Check ───');
    try {
      const remainingNotifs = await prisma.notification.count({ where: { userId: { in: createdUserIds } } });
      const remainingAssignments = await prisma.clinicalAssistanceAssignment.count({
        where: {
          OR: [
            { requestId: { in: createdRequestIds } },
            { pharmacyId: { in: createdPharmacyIds } }
          ]
        }
      });
      const remainingRequests = await prisma.clinicalAssistanceRequest.count({
        where: {
          OR: [
            { id: { in: createdRequestIds } },
            { patientId: { in: createdUserIds } }
          ]
        }
      });
      const remainingOrders = await prisma.order.count({ where: { id: { in: createdOrderIds } } });
      const remainingRx = await prisma.prescription.count({ where: { id: { in: createdPrescriptionIds } } });
      const remainingInv = await prisma.inventory.count({ where: { id: { in: createdInventoryIds } } });
      const remainingMeds = await prisma.medicine.count({ where: { id: { in: createdMedicineIds } } });
      const remainingPharmacies = await prisma.pharmacy.count({ where: { id: { in: createdPharmacyIds } } });
      const remainingUsers = await prisma.user.count({ where: { id: { in: createdUserIds } } });

      console.log(`✓ Residual Artifacts: Notifs: ${remainingNotifs}, Assignments: ${remainingAssignments}, Requests: ${remainingRequests}, Orders: ${remainingOrders}, Rx: ${remainingRx}, Inventory: ${remainingInv}, Meds: ${remainingMeds}, Pharmacies: ${remainingPharmacies}, Users: ${remainingUsers}`);

      if (
        remainingNotifs !== 0 ||
        remainingAssignments !== 0 ||
        remainingRequests !== 0 ||
        remainingOrders !== 0 ||
        remainingRx !== 0 ||
        remainingInv !== 0 ||
        remainingMeds !== 0 ||
        remainingPharmacies !== 0 ||
        remainingUsers !== 0
      ) {
        throw new Error(
          `[FAIL CLOSED] Residual test records detected after cleanup: Notifs=${remainingNotifs}, Assignments=${remainingAssignments}, Requests=${remainingRequests}, Orders=${remainingOrders}, Rx=${remainingRx}, Inventory=${remainingInv}, Meds=${remainingMeds}, Pharmacies=${remainingPharmacies}, Users=${remainingUsers}`
        );
      }
    } catch (err) {
      cleanupErrors.push(`Failed to verify residual artifacts: ${err.message}`);
      failCount++;
      console.error(`  ⚠️ Residual verification error: ${err.message}`);
    }

    // Disconnect clients cleanly
    try {
      await prisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Safe test client disconnect error: ${err.message}`);
    }

    try {
      await globalPrisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Global Prisma client disconnect error: ${err.message}`);
    }

    if (cleanupErrors.length > 0) {
      console.error(`\n⚠️ Cleanup completed with ${cleanupErrors.length} error(s):`);
      for (const msg of cleanupErrors) {
        console.error(`   - ${msg}`);
      }
    } else {
      console.log('✓ All cleanup operations and client disconnects completed without errors');
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`Live HTTP Integration Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (failCount > 0 || cleanupErrors.length > 0) {
    process.exit(1);
  }
}

// Direct invocation handler
if (require.main === module) {
  runLiveHttpIntegrationTest().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}

module.exports = {
  runLiveHttpIntegrationTest
};
