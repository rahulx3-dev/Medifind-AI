'use strict';

/**
 * MediFind AI — Gate 1A: Atomic Order Confirmation & Inventory Safety Integration Test
 *
 * Real PostgreSQL-backed integration test suite executing against the local
 * disposable database (medifind_disposable_test on localhost:5432).
 *
 * STRICT SAFETY ENFORCEMENT:
 * 1. Uses assertSafeTestDatabase() and createSafeTestPrismaClient() strictly bound
 *    to TEST_DATABASE_URL from server/.env.test.local.
 * 2. Preflight verification: Confirms current_database() === 'medifind_disposable_test'
 *    and port === 5432 for both the safe test client and the controller's global Prisma client.
 * 3. Never connects to Neon, production, or staging.
 * 4. Generates unique ephemeral test fixtures tagged with an isolated run ID.
 * 5. Guarantees complete reverse-dependency cleanup in a finally block and verifies
 *    zero test artifacts remain in the database.
 * 6. Tests the 8 core Gate 1A scenarios:
 *    - Scenario 1: Successful confirmation decrements stock and creates status history & notifications.
 *    - Scenario 2: Insufficient stock rejects confirmation with complete rollback.
 *    - Scenario 3: Multi-item partial failure rolls back earlier decrements.
 *    - Scenario 4: Exact stock depletion transitions inventory status to OUT_OF_STOCK.
 *    - Scenario 5: Duplicate confirmation rejection prevents double-decrement.
 *    - Scenario 6: Concurrent race condition for remaining stock produces exactly 1 winner, never negative stock.
 *    - Scenario 7: Confirmed order cancellation restores stock exactly once (no double-restore).
 *    - Scenario 8: Pending order cancellation does not falsely inflate stock.
 */

const assert = require('assert');
const { URL } = require('url');
const crypto = require('crypto');
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

// Evict cached modules to guarantee binding to the validated local test URL
try {
  delete require.cache[require.resolve('./src/prisma')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/controllers/orderController')];
} catch (_) {}

// Safely import primary controller and its bound PrismaClient
const { updateOrderStatus } = require('./src/controllers/orderController');
const globalPrisma = require('./src/prisma');

// Evict cached modules again to instantiate an isolated Controller 2 with its own PrismaClient
// to represent a separate concurrent incoming client request
delete require.cache[require.resolve('./src/prisma')];
delete require.cache[require.resolve('./src/controllers/orderController')];
const { updateOrderStatus: updateOrderStatusConcurrent } = require('./src/controllers/orderController');
const concurrentPrisma = require('./src/prisma');

// Unique run tag to ensure zero collision with any other tests
const RUN_ID = `g1a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

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

function createMockReq({ params = {}, body = {}, user = {}, headers = {} }) {
  return {
    params,
    body,
    user,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runPostgresGate1AIntegrationTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('🛡️  MEDIFIND AI — GATE 1A: POSTGRESQL ATOMIC ORDER & INVENTORY TEST');
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

  // Preflight Step 3: Controller's global Prisma client verification
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
    throw new Error(`[CRITICAL SAFETY VIOLATION] Controller global Prisma connected to "${globalDbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(globalDbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Controller global Prisma connected to port ${globalDbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // Also verify concurrent controller's Prisma client targets exactly medifind_disposable_test
  const concurrentMeta = await concurrentPrisma.$queryRawUnsafe(`
    SELECT 
      current_database() as db_name,
      inet_server_port() as server_port,
      inet_server_addr()::text as server_ip,
      current_user as db_user
  `);

  const concurrentDbInfo = concurrentMeta[0];
  console.log(`✓ Concurrent Controller Prisma Connected to Database: "${concurrentDbInfo.db_name}"`);
  console.log(`✓ Concurrent Controller Prisma Connected Port: ${concurrentDbInfo.server_port}`);

  if (concurrentDbInfo.db_name !== 'medifind_disposable_test') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Concurrent controller Prisma connected to "${concurrentDbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(concurrentDbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Concurrent controller Prisma connected to port ${concurrentDbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // ── Fixture Identifiers ───────────────────────────────────────────────────
  const testPatientId = `usr_pt_${RUN_ID}`;
  const testPharmUserId = `usr_ph_${RUN_ID}`;
  const testPharmacyId = `ph_${RUN_ID}`;

  const testMedAId = `med_a_${RUN_ID}`;
  const testMedBId = `med_b_${RUN_ID}`;

  const testInvAId = `inv_a_${RUN_ID}`;
  const testInvBId = `inv_b_${RUN_ID}`;

  const testOrder1Id = `ord_1_${RUN_ID}`;
  const testOrder2Id = `ord_2_${RUN_ID}`;
  const testOrder3Id = `ord_3_${RUN_ID}`;
  const testOrder4Id = `ord_4_${RUN_ID}`;
  const testOrder5Id = `ord_5_${RUN_ID}`;
  const testOrder6AId = `ord_6a_${RUN_ID}`;
  const testOrder6BId = `ord_6b_${RUN_ID}`;
  const testOrder8Id = `ord_8_${RUN_ID}`;

  const allTestOrderIds = [
    testOrder1Id,
    testOrder2Id,
    testOrder3Id,
    testOrder4Id,
    testOrder5Id,
    testOrder6AId,
    testOrder6BId,
    testOrder8Id
  ];

  const cleanupErrors = [];

  try {
    // ── Setup: Insert Ephemeral Test Fixtures ────────────────────────────────
    console.log('\n─── Setup: Creating Isolated Ephemeral Test Fixtures in PostgreSQL ───');

    // 1. Users
    await prisma.user.create({
      data: {
        id: testPatientId,
        email: `patient_${RUN_ID}@example.com`,
        password: 'hashed_password_for_test',
        name: `Test Patient ${RUN_ID}`,
        role: 'PATIENT'
      }
    });

    await prisma.user.create({
      data: {
        id: testPharmUserId,
        email: `pharmacist_${RUN_ID}@example.com`,
        password: 'hashed_password_for_test',
        name: `Pharmacist Manager ${RUN_ID}`,
        role: 'PHARMACIST'
      }
    });

    // 2. Pharmacy (verified, open, managed by testPharmUserId)
    await prisma.pharmacy.create({
      data: {
        id: testPharmacyId,
        name: `Test Dispensary ${RUN_ID}`,
        licenseNumber: `LIC-${RUN_ID}`,
        address: '100 Medical Square, Alappuzha, Kerala',
        phone: '+91 94470 12345',
        latitude: 9.4981,
        longitude: 76.3388,
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        managerId: testPharmUserId
      }
    });

    // 3. Medicines
    await prisma.medicine.create({
      data: {
        id: testMedAId,
        brandName: `Paracetamol ${RUN_ID}`,
        genericName: 'Paracetamol',
        strength: '650mg',
        dosageForm: 'TABLET',
        category: 'Analgesic',
        manufacturer: 'Alpha Labs',
        isEmergency: false,
        requiresPrescription: false
      }
    });

    await prisma.medicine.create({
      data: {
        id: testMedBId,
        brandName: `Amoxicillin ${RUN_ID}`,
        genericName: 'Amoxicillin',
        strength: '500mg',
        dosageForm: 'CAPSULE',
        category: 'Antibiotic',
        manufacturer: 'Beta Pharma',
        isEmergency: false,
        requiresPrescription: false
      }
    });

    // 4. Initial Inventories
    // Med A: stock 10, status: AVAILABLE
    await prisma.inventory.create({
      data: {
        id: testInvAId,
        pharmacyId: testPharmacyId,
        medicineId: testMedAId,
        stock: 10,
        status: 'AVAILABLE'
      }
    });

    // Med B: stock 5, status: AVAILABLE
    await prisma.inventory.create({
      data: {
        id: testInvBId,
        pharmacyId: testPharmacyId,
        medicineId: testMedBId,
        stock: 5,
        status: 'AVAILABLE'
      }
    });

    // 5. Orders & OrderItems Setup

    // Order 1: Baseline successful confirmation (needs 2 Med A, 3 Med B)
    await prisma.order.create({
      data: {
        id: testOrder1Id,
        orderNumber: `MF-ORD1-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 170.0,
        totalAmount: 172.0,
        verificationPin: '1234',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 2, unitPrice: 25.0, subtotal: 50.0 },
            { medicineId: testMedBId, quantity: 3, unitPrice: 40.0, subtotal: 120.0 }
          ]
        }
      }
    });

    // Order 2: Insufficient stock (requests 10 units of Med B when only 2 remain)
    await prisma.order.create({
      data: {
        id: testOrder2Id,
        orderNumber: `MF-ORD2-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 400.0,
        totalAmount: 402.0,
        verificationPin: '2345',
        items: {
          create: [
            { medicineId: testMedBId, quantity: 10, unitPrice: 40.0, subtotal: 400.0 }
          ]
        }
      }
    });

    // Order 3: Multi-item partial failure (requests 1 Med A [sufficient], 5 Med B [insufficient])
    await prisma.order.create({
      data: {
        id: testOrder3Id,
        orderNumber: `MF-ORD3-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 225.0,
        totalAmount: 227.0,
        verificationPin: '3456',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 1, unitPrice: 25.0, subtotal: 25.0 },
            { medicineId: testMedBId, quantity: 5, unitPrice: 40.0, subtotal: 200.0 }
          ]
        }
      }
    });

    // Order 4: Exact depletion to zero (requests exactly 2 units of Med B)
    await prisma.order.create({
      data: {
        id: testOrder4Id,
        orderNumber: `MF-ORD4-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 80.0,
        totalAmount: 82.0,
        verificationPin: '4567',
        items: {
          create: [
            { medicineId: testMedBId, quantity: 2, unitPrice: 40.0, subtotal: 80.0 }
          ]
        }
      }
    });

    // Order 5: Duplicate confirmation rejection test
    await prisma.order.create({
      data: {
        id: testOrder5Id,
        orderNumber: `MF-ORD5-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 25.0,
        totalAmount: 27.0,
        verificationPin: '5678',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 1, unitPrice: 25.0, subtotal: 25.0 }
          ]
        }
      }
    });

    // Order 6A and 6B: Concurrent competition for last available stock
    await prisma.order.create({
      data: {
        id: testOrder6AId,
        orderNumber: `MF-ORD6A-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 50.0,
        totalAmount: 52.0,
        verificationPin: '6789',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 2, unitPrice: 25.0, subtotal: 50.0 }
          ]
        }
      }
    });

    await prisma.order.create({
      data: {
        id: testOrder6BId,
        orderNumber: `MF-ORD6B-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 50.0,
        totalAmount: 52.0,
        verificationPin: '7890',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 2, unitPrice: 25.0, subtotal: 50.0 }
          ]
        }
      }
    });

    // Order 8: Pending order cancellation invariance
    await prisma.order.create({
      data: {
        id: testOrder8Id,
        orderNumber: `MF-ORD8-${RUN_ID}`,
        userId: testPatientId,
        pharmacyId: testPharmacyId,
        status: 'PENDING',
        orderType: 'RESERVATION',
        medicineSubtotal: 50.0,
        totalAmount: 52.0,
        verificationPin: '8901',
        items: {
          create: [
            { medicineId: testMedAId, quantity: 2, unitPrice: 25.0, subtotal: 50.0 }
          ]
        }
      }
    });

    console.log('✓ Ephemeral test records created successfully');

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: Successful Confirmation & Atomic Decrement
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 1: Successful Order Confirmation & Atomic Decrement ---');
    const req1 = createMockReq({
      params: { id: testOrder1Id },
      body: { status: 'CONFIRMED', comment: 'All items verified in dispensary stock.' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res1 = createMockRes();
    await updateOrderStatus(req1, res1);

    check('Order 1 confirms successfully with HTTP 200 OK', res1.statusCode === 200);
    check('Response payload indicates success: true', res1.body?.success === true);
    check('Response returns order in CONFIRMED status', res1.body?.order?.status === 'CONFIRMED');

    // Verify persisted PostgreSQL state
    const order1Db = await prisma.order.findUnique({ where: { id: testOrder1Id } });
    check('PostgreSQL Order 1 status transitioned to CONFIRMED', order1Db?.status === 'CONFIRMED');

    const invA_1 = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    const invB_1 = await prisma.inventory.findUnique({ where: { id: testInvBId } });
    check('Med A stock decremented by 2 (10 -> 8)', invA_1?.stock === 8);
    check('Med B stock decremented by 3 (5 -> 2)', invB_1?.stock === 2);
    check('Med B inventory status remains AVAILABLE (2 > 0)', invB_1?.status === 'AVAILABLE');

    // Verify OrderStatusHistory
    const history1 = await prisma.orderStatusHistory.findFirst({
      where: { orderId: testOrder1Id, status: 'CONFIRMED' }
    });
    check('OrderStatusHistory recorded CONFIRMED event in PostgreSQL', Boolean(history1));
    check('OrderStatusHistory includes comment', history1?.comment?.includes('verified in dispensary stock.'));

    // Verify Notification to patient
    const notif1 = await prisma.notification.findFirst({
      where: { userId: testPatientId, type: 'ORDER_STATUS', title: { contains: 'Order Confirmed' } }
    });
    check('Notification persisted in PostgreSQL for patient', Boolean(notif1));

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: Insufficient Stock Rejection & Complete Rollback
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 2: Insufficient Stock Rejection & Full Rollback ---');
    // Med B currently has 2 units in stock. Order 2 requests 10 units!
    const req2 = createMockReq({
      params: { id: testOrder2Id },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res2 = createMockRes();
    await updateOrderStatus(req2, res2);

    check('Insufficient stock returns HTTP 400 Bad Request', res2.statusCode === 400);
    check('Error message flags insufficient stock', res2.body?.error && res2.body.error.includes('Insufficient stock'));

    const order2Db = await prisma.order.findUnique({ where: { id: testOrder2Id } });
    check('Order 2 remains PENDING in PostgreSQL (not confirmed)', order2Db?.status === 'PENDING');

    const invB_2 = await prisma.inventory.findUnique({ where: { id: testInvBId } });
    check('Med B stock remains 2 in PostgreSQL (untouched)', invB_2?.stock === 2);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: Multi-Item Partial-Failure Rollback
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 3: Multi-Item Partial-Failure Atomic Rollback ---');
    // Order 3 requests: Med A = 1 (stock is 8, sufficient), Med B = 5 (stock is 2, insufficient)
    const req3 = createMockReq({
      params: { id: testOrder3Id },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res3 = createMockRes();
    await updateOrderStatus(req3, res3);

    check('Multi-item order with insufficient item returns HTTP 400', res3.statusCode === 400);

    const order3Db = await prisma.order.findUnique({ where: { id: testOrder3Id } });
    check('Order 3 remains in PENDING status in PostgreSQL', order3Db?.status === 'PENDING');

    const invA_3 = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    const invB_3 = await prisma.inventory.findUnique({ where: { id: testInvBId } });
    check('Med A stock remained 8 (prior valid item was NOT decremented)', invA_3?.stock === 8);
    check('Med B stock remained 2 (untouched)', invB_3?.stock === 2);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 4: Exact Stock Depletion to Zero (OUT_OF_STOCK Transition)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 4: Exact Stock Depletion (OUT_OF_STOCK Transition) ---');
    // Med B currently has 2 units in stock. Order 4 requests exactly 2 units!
    const req4 = createMockReq({
      params: { id: testOrder4Id },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res4 = createMockRes();
    await updateOrderStatus(req4, res4);

    check('Order 4 confirms with HTTP 200 OK', res4.statusCode === 200);

    const order4Db = await prisma.order.findUnique({ where: { id: testOrder4Id } });
    check('Order 4 is CONFIRMED in PostgreSQL', order4Db?.status === 'CONFIRMED');

    const invB_4 = await prisma.inventory.findUnique({ where: { id: testInvBId } });
    check('Med B stock is exactly 0 in PostgreSQL', invB_4?.stock === 0);
    check('Med B inventory status transitioned to OUT_OF_STOCK in PostgreSQL', invB_4?.status === 'OUT_OF_STOCK');

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 5: Duplicate Confirmation Rejection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 5: Duplicate Confirmation Rejection ---');
    // Order 5: confirm once first
    const req5a = createMockReq({
      params: { id: testOrder5Id },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res5a = createMockRes();
    await updateOrderStatus(req5a, res5a);
    check('Order 5 initial confirmation succeeds (200 OK)', res5a.statusCode === 200);

    const invA_5a = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock decremented by 1 (8 -> 7)', invA_5a?.stock === 7);

    // Re-attempt confirmation on already CONFIRMED order
    const req5b = createMockReq({
      params: { id: testOrder5Id },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res5b = createMockRes();
    await updateOrderStatus(req5b, res5b);

    check('Duplicate confirmation rejected with HTTP 400 Bad Request', res5b.statusCode === 400);
    check('Error specifies invalid status transition from CONFIRMED', res5b.body?.error && res5b.body.error.includes('Invalid transition'));

    const invA_5b = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock remained 7 (no second decrement)', invA_5b?.stock === 7);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 6: Concurrent Race Condition for Final Available Stock
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 6: Concurrent Race Condition for Final Available Stock ---');
    // Reset Med A stock in PostgreSQL directly to 3 units
    await prisma.inventory.update({
      where: { id: testInvAId },
      data: { stock: 3, status: 'AVAILABLE', lastUpdated: new Date() }
    });
    const invA_reset = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock initialized to 3 units for concurrency test', invA_reset?.stock === 3);

    // Order 6A requests 2 units of Med A. Order 6B requests 2 units of Med A. Total required = 4 > 3.
    const req6A = createMockReq({
      params: { id: testOrder6AId },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res6A = createMockRes();

    const req6B = createMockReq({
      params: { id: testOrder6BId },
      body: { status: 'CONFIRMED' },
      user: { id: testPharmUserId, role: 'PHARMACIST', name: `Pharmacist ${RUN_ID}` }
    });
    const res6B = createMockRes();

    // Fire both requests concurrently against real PostgreSQL using separate client connections
    await Promise.all([
      updateOrderStatus(req6A, res6A),
      updateOrderStatusConcurrent(req6B, res6B)
    ]);

    const results = [
      { orderId: testOrder6AId, res: res6A },
      { orderId: testOrder6BId, res: res6B }
    ];

    const successes = results.filter(r => r.res.statusCode === 200);
    const failures = results.filter(r => r.res.statusCode === 409 || r.res.statusCode === 400);

    check('Concurrent race condition: exactly 1 order succeeded (HTTP 200)', successes.length === 1);
    check('Concurrent race condition: exactly 1 order failed (HTTP 409 or 400)', failures.length === 1);

    const winningOrderId = successes[0].orderId;
    const losingOrderId = failures[0].orderId;

    const winningOrderDb = await prisma.order.findUnique({ where: { id: winningOrderId } });
    const losingOrderDb = await prisma.order.findUnique({ where: { id: losingOrderId } });

    check('Winning order status transitioned to CONFIRMED in PostgreSQL', winningOrderDb?.status === 'CONFIRMED');
    check('Losing order remains in PENDING status in PostgreSQL', losingOrderDb?.status === 'PENDING');

    const invA_final = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Final Med A stock in PostgreSQL is exactly 1 (3 - 2 = 1, never negative)', invA_final?.stock === 1);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 7: Confirmed Order Cancellation Restores Stock Exactly Once
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 7: Confirmed Order Cancellation Restores Stock Exactly Once ---');
    // Cancel the winning order (which holds 2 units of Med A)
    const reqCancel7 = createMockReq({
      params: { id: winningOrderId },
      body: { status: 'CANCELLED', comment: 'Patient cancelled confirmed reservation.' },
      user: { id: testPatientId, role: 'PATIENT', name: `Patient ${RUN_ID}` }
    });
    const resCancel7 = createMockRes();
    await updateOrderStatus(reqCancel7, resCancel7);

    check('Confirmed order cancellation returns HTTP 200 OK', resCancel7.statusCode === 200);

    const cancelledOrderDb = await prisma.order.findUnique({ where: { id: winningOrderId } });
    check('Order status transitioned to CANCELLED in PostgreSQL', cancelledOrderDb?.status === 'CANCELLED');

    const invA_restored = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock restored from 1 back to 3 in PostgreSQL (1 + 2 = 3)', invA_restored?.stock === 3);

    // Re-attempt duplicate cancellation on the now CANCELLED order
    const reqCancel7Dup = createMockReq({
      params: { id: winningOrderId },
      body: { status: 'CANCELLED' },
      user: { id: testPatientId, role: 'PATIENT', name: `Patient ${RUN_ID}` }
    });
    const resCancel7Dup = createMockRes();
    await updateOrderStatus(reqCancel7Dup, resCancel7Dup);

    check('Duplicate cancellation on terminal order rejected with HTTP 400', resCancel7Dup.statusCode === 400);

    const invA_dupCancel = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock remained 3 in PostgreSQL (did NOT double-restore)', invA_dupCancel?.stock === 3);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 8: Pending Order Cancellation Invariance
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 8: Pending Order Cancellation Stock Invariance ---');
    // Order 8 is PENDING (requests 2 units of Med A). It never deducted stock.
    // Cancelling Order 8 must NOT increment inventory!
    const reqCancel8 = createMockReq({
      params: { id: testOrder8Id },
      body: { status: 'CANCELLED', comment: 'Patient cancelled before pharmacy confirmation.' },
      user: { id: testPatientId, role: 'PATIENT', name: `Patient ${RUN_ID}` }
    });
    const resCancel8 = createMockRes();
    await updateOrderStatus(reqCancel8, resCancel8);

    check('Pending order cancellation returns HTTP 200 OK', resCancel8.statusCode === 200);

    const order8Db = await prisma.order.findUnique({ where: { id: testOrder8Id } });
    check('Order 8 transitioned to CANCELLED in PostgreSQL', order8Db?.status === 'CANCELLED');

    const invA_afterPendingCancel = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    check('Med A stock strictly preserved at 3 in PostgreSQL (no false stock inflation)', invA_afterPendingCancel?.stock === 3);

  } finally {
    // ── Guaranteed Cleanup in Strict Reverse Dependency Order ────────────────
    console.log('\n─── Cleanup: Removing Ephemeral Test Fixtures from PostgreSQL ───');

    // 1. Delete notifications
    try {
      await prisma.notification.deleteMany({
        where: { userId: { in: [testPatientId, testPharmUserId] } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete notifications: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (notifications): ${err.message}`);
    }

    // 2. Delete order status history
    try {
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: allTestOrderIds } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete orderStatusHistory: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orderStatusHistory): ${err.message}`);
    }

    // 3. Delete order items
    try {
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: allTestOrderIds } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete orderItem: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orderItem): ${err.message}`);
    }

    // 4. Delete orders
    try {
      await prisma.order.deleteMany({
        where: { id: { in: allTestOrderIds } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete orders: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orders): ${err.message}`);
    }

    // 5. Delete inventory items
    try {
      await prisma.inventory.deleteMany({
        where: { id: { in: [testInvAId, testInvBId] } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete inventory: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (inventory): ${err.message}`);
    }

    // 6. Delete medicines
    try {
      await prisma.medicine.deleteMany({
        where: { id: { in: [testMedAId, testMedBId] } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete medicines: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (medicines): ${err.message}`);
    }

    // 7. Delete pharmacy
    try {
      await prisma.pharmacy.deleteMany({
        where: { id: testPharmacyId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete pharmacy: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (pharmacy): ${err.message}`);
    }

    // 8. Delete users
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [testPatientId, testPharmUserId] } }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete users: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (users): ${err.message}`);
    }

    // ── Residual-Artifact Verification ────────────────────────────────────────
    try {
      const remainingNotifications = await prisma.notification.count({
        where: { userId: { in: [testPatientId, testPharmUserId] } }
      });
      const remainingOrders = await prisma.order.count({
        where: { id: { in: allTestOrderIds } }
      });
      const remainingHistory = await prisma.orderStatusHistory.count({
        where: { orderId: { in: allTestOrderIds } }
      });
      const remainingItems = await prisma.orderItem.count({
        where: { orderId: { in: allTestOrderIds } }
      });
      const remainingInventory = await prisma.inventory.count({
        where: { id: { in: [testInvAId, testInvBId] } }
      });
      const remainingMedicines = await prisma.medicine.count({
        where: { id: { in: [testMedAId, testMedBId] } }
      });
      const remainingPharmacies = await prisma.pharmacy.count({
        where: { id: testPharmacyId }
      });
      const remainingUsers = await prisma.user.count({
        where: { id: { in: [testPatientId, testPharmUserId] } }
      });

      console.log(`✓ Residual Artifact Check: Notifications: ${remainingNotifications}, History: ${remainingHistory}, Items: ${remainingItems}, Orders: ${remainingOrders}, Inventory: ${remainingInventory}, Medicines: ${remainingMedicines}, Pharmacies: ${remainingPharmacies}, Users: ${remainingUsers}`);

      if (
        remainingNotifications !== 0 ||
        remainingHistory !== 0 ||
        remainingItems !== 0 ||
        remainingOrders !== 0 ||
        remainingInventory !== 0 ||
        remainingMedicines !== 0 ||
        remainingPharmacies !== 0 ||
        remainingUsers !== 0
      ) {
        throw new Error(
          `[FAIL CLOSED] Residual test records detected after cleanup: notifications=${remainingNotifications}, history=${remainingHistory}, items=${remainingItems}, orders=${remainingOrders}, inventory=${remainingInventory}, medicines=${remainingMedicines}, pharmacies=${remainingPharmacies}, users=${remainingUsers}`
        );
      }
    } catch (err) {
      cleanupErrors.push(`Failed to count remaining test artifacts: ${err.message}`);
      failCount++;
      console.error(`  ⚠️ Cleanup error (verification): ${err.message}`);
    }

    // Disconnect both clients cleanly
    try {
      await prisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Safe test client disconnect error: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (prisma $disconnect): ${err.message}`);
    }

    try {
      await globalPrisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Global controller prisma disconnect error: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (globalPrisma $disconnect): ${err.message}`);
    }

    try {
      await concurrentPrisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Concurrent controller prisma disconnect error: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (concurrentPrisma $disconnect): ${err.message}`);
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
  console.log(`Gate 1A PostgreSQL Integration Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (failCount > 0 || cleanupErrors.length > 0) {
    process.exit(1);
  }
}

// Export for runner / programmatic use
module.exports = {
  runPostgresGate1AIntegrationTest
};

// Direct invocation handler
if (require.main === module) {
  runPostgresGate1AIntegrationTest().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}
