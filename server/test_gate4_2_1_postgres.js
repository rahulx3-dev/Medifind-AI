'use strict';

/**
 * MediFind AI — Gate 4.2.1: Split-Order Creation PostgreSQL Integration Test
 *
 * Real PostgreSQL-backed integration test suite executing against the local
 * disposable database (medifind_disposable_test on localhost:5432).
 *
 * STRICT SAFETY ENFORCEMENT:
 * 1. Uses assertSafeTestDatabase() and createSafeTestPrismaClient() strictly bound
 *    to TEST_DATABASE_URL from server/.env.test.local.
 * 2. Preflight verification: Confirms current_database() === 'medifind_disposable_test'
 *    and port === 5432 before any write operation is permitted.
 * 3. Never connects to Neon, production, or staging.
 * 4. Generates unique ephemeral test fixtures tagged with an isolated run ID.
 * 5. Guarantees complete reverse-dependency cleanup in a finally block and verifies
 *    zero test artifacts remain in the database.
 * 6. Tests actual split-order creation logic, multi-pharmacy child distribution,
 *    database-backed idempotency, request hash verification, over-allocation rejection,
 *    inventory non-deduction invariance, and PostgreSQL ACID transaction rollback.
 */

const assert = require('assert');
const { URL } = require('url');
const crypto = require('crypto');
const { createSafeTestPrismaClient, assertSafeTestDatabase } = require('./src/utils/testDatabaseGuard');

// ── Guard Validation & Environment Configuration ──────────────────────────────
// Run the test-database guard first and validate server/.env.test.local
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

// Evict cached modules to guarantee binding to the validated local test URL
try {
  delete require.cache[require.resolve('./src/prisma')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/controllers/splitOrderController')];
} catch (_) {}

// Now safely import modules that instantiate or depend on the global PrismaClient
const { createSplitOrder } = require('./src/controllers/splitOrderController');
const globalPrisma = require('./src/prisma');

// Unique run tag to ensure zero collision with any other tests
const RUN_ID = `sot_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

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

function createMockReq({ body = {}, headers = {}, user = {} }) {
  const normalizedHeaders = { ...headers };
  // splitOrderController expects 'idempotency-key' or body.idempotencyKey
  if (normalizedHeaders['x-idempotency-key'] && !normalizedHeaders['idempotency-key']) {
    normalizedHeaders['idempotency-key'] = normalizedHeaders['x-idempotency-key'];
  }
  const normalizedBody = { ...body };
  if (normalizedHeaders['idempotency-key'] && !normalizedBody.idempotencyKey) {
    normalizedBody.idempotencyKey = normalizedHeaders['idempotency-key'];
  }
  if (normalizedBody.idempotencyKey && !normalizedHeaders['idempotency-key']) {
    normalizedHeaders['idempotency-key'] = normalizedBody.idempotencyKey;
  }
  return {
    body: normalizedBody,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...normalizedHeaders
    },
    user,
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

async function runPostgresSplitOrderIntegrationTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('🛡️  MEDIFIND AI — GATE 4.2.1: POSTGRESQL SPLIT-ORDER CREATION');
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
    throw new Error(`[CRITICAL SAFETY VIOLATION] Controller global Prisma connected to "${globalDbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(globalDbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Controller global Prisma connected to port ${globalDbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // ── Fixture Identifiers ───────────────────────────────────────────────────
  const testPatientId = `usr_pt_${RUN_ID}`;
  const testPharmAUserId = `usr_pha_${RUN_ID}`;
  const testPharmBUserId = `usr_phb_${RUN_ID}`;

  const testPharmacyAId = `ph_a_${RUN_ID}`;
  const testPharmacyBId = `ph_b_${RUN_ID}`;

  const testMed1Id = `med_1_${RUN_ID}`;
  const testMed2Id = `med_2_${RUN_ID}`;

  const testInvAId = `inv_a_${RUN_ID}`;
  const testInvBId = `inv_b_${RUN_ID}`;

  const testPrescriptionId = `rx_${RUN_ID}`;
  const testPItem1Id = `rxi_1_${RUN_ID}`;
  const testPItem2Id = `rxi_2_${RUN_ID}`;

  const testUnverifiedRxId = `rx_unver_${RUN_ID}`;
  const testUnverifiedPItemId = `rxi_unver_${RUN_ID}`;

  const testIdempotencyKey1 = `idem_split_${RUN_ID}`;

  let createdParentOrderId = null;
  const cleanupErrors = [];

  try {
    // ── Setup: Insert Ephemeral Test Fixtures ────────────────────────────────
    console.log('\n─── Setup: Creating Isolated Ephemeral Test Fixtures in PostgreSQL ───');

    // 1. Users
    await prisma.user.create({
      data: {
        id: testPatientId,
        email: `${RUN_ID}_patient@example.com`,
        password: 'hashed_password_for_test',
        name: `Patient ${RUN_ID}`,
        role: 'PATIENT'
      }
    });

    await prisma.user.create({
      data: {
        id: testPharmAUserId,
        email: `${RUN_ID}_pharma@example.com`,
        password: 'hashed_password_for_test',
        name: `Pharmacist A ${RUN_ID}`,
        role: 'PHARMACIST'
      }
    });

    await prisma.user.create({
      data: {
        id: testPharmBUserId,
        email: `${RUN_ID}_pharmb@example.com`,
        password: 'hashed_password_for_test',
        name: `Pharmacist B ${RUN_ID}`,
        role: 'PHARMACIST'
      }
    });

    // 2. Pharmacies
    await prisma.pharmacy.create({
      data: {
        id: testPharmacyAId,
        name: `Pharmacy A ${RUN_ID}`,
        licenseNumber: `LIC-A-${RUN_ID}`,
        address: '100 Medical Enclave A',
        phone: '1111111111',
        isVerified: true,
        verificationStatus: 'VERIFIED',
        isOpen: true,
        deliveryAvailable: true,
        managerId: testPharmAUserId
      }
    });

    await prisma.pharmacy.create({
      data: {
        id: testPharmacyBId,
        name: `Pharmacy B ${RUN_ID}`,
        licenseNumber: `LIC-B-${RUN_ID}`,
        address: '200 Medical Enclave B',
        phone: '2222222222',
        isVerified: true,
        verificationStatus: 'VERIFIED',
        isOpen: true,
        deliveryAvailable: true,
        managerId: testPharmBUserId
      }
    });

    // 3. Medicines (Valid schema fields: brandName, genericName, dosageForm, strength, category, manufacturer)
    await prisma.medicine.create({
      data: {
        id: testMed1Id,
        brandName: `Paracetamol ${RUN_ID}`,
        genericName: 'Paracetamol',
        dosageForm: 'TABLET',
        strength: '650mg',
        category: 'Analgesic',
        manufacturer: 'Alpha Labs',
        isEmergency: false,
        requiresPrescription: false
      }
    });

    await prisma.medicine.create({
      data: {
        id: testMed2Id,
        brandName: `Amoxicillin ${RUN_ID}`,
        genericName: 'Amoxicillin',
        dosageForm: 'CAPSULE',
        strength: '500mg',
        category: 'Antibiotic',
        manufacturer: 'Beta Pharma',
        isEmergency: false,
        requiresPrescription: true
      }
    });

    // 4. Inventory (Pharmacy A carries Med 1; Pharmacy B carries Med 2)
    await prisma.inventory.create({
      data: {
        id: testInvAId,
        pharmacyId: testPharmacyAId,
        medicineId: testMed1Id,
        stock: 50,
        price: 25.0,
        status: 'AVAILABLE'
      }
    });

    await prisma.inventory.create({
      data: {
        id: testInvBId,
        pharmacyId: testPharmacyBId,
        medicineId: testMed2Id,
        stock: 50,
        price: 40.0,
        status: 'AVAILABLE'
      }
    });

    // 5. Prescriptions
    await prisma.prescription.create({
      data: {
        id: testPrescriptionId,
        userId: testPatientId,
        originalFileName: `prescription_${RUN_ID}.jpg`,
        filePath: `uploads/test_${RUN_ID}.jpg`,
        status: 'VERIFIED'
      }
    });

    await prisma.prescriptionItem.create({
      data: {
        id: testPItem1Id,
        prescriptionId: testPrescriptionId,
        medicineId: testMed1Id,
        prescribedName: `Paracetamol ${RUN_ID}`,
        quantity: 10,
        isVerified: true
      }
    });

    await prisma.prescriptionItem.create({
      data: {
        id: testPItem2Id,
        prescriptionId: testPrescriptionId,
        medicineId: testMed2Id,
        prescribedName: `Amoxicillin ${RUN_ID}`,
        quantity: 5,
        isVerified: true
      }
    });

    // Unverified prescription for negative test
    await prisma.prescription.create({
      data: {
        id: testUnverifiedRxId,
        userId: testPatientId,
        originalFileName: `unverified_${RUN_ID}.jpg`,
        filePath: `uploads/unverified_${RUN_ID}.jpg`,
        status: 'PENDING'
      }
    });

    await prisma.prescriptionItem.create({
      data: {
        id: testUnverifiedPItemId,
        prescriptionId: testUnverifiedRxId,
        medicineId: testMed1Id,
        prescribedName: `Paracetamol ${RUN_ID}`,
        quantity: 5,
        isVerified: false
      }
    });

    console.log('✓ Ephemeral test records created successfully');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Multi-Pharmacy Split-Order Creation (Real PostgreSQL)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: Multi-Pharmacy Split-Order Creation on Real PostgreSQL ---');
    const req1 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': testIdempotencyKey1,
        'x-idempotency-key': testIdempotencyKey1
      },
      body: {
        idempotencyKey: testIdempotencyKey1,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 4
          },
          {
            pharmacyId: testPharmacyBId,
            prescriptionItemId: testPItem2Id,
            quantity: 3
          }
        ],
        notes: 'Gate 4.2.1 Real PostgreSQL Test Order'
      }
    });
    const res1 = createMockRes();
    await createSplitOrder(req1, res1);

    check('createSplitOrder returns HTTP 201 Created', res1.statusCode === 201);
    check('Response body indicates success: true', res1.body?.success === true);
    check('Response contains parentOrder object', !!res1.body?.parentOrder);
    check('Response contains exactly 2 childOrders', res1.body?.childOrders?.length === 2);

    createdParentOrderId = res1.body?.parentOrder?.id;

    // Verify persisted state in PostgreSQL
    const parentInDb = await prisma.order.findUnique({
      where: { id: createdParentOrderId },
      include: {
        childOrders: {
          include: { items: true, pharmacy: true }
        }
      }
    });

    check('Parent order is persisted in PostgreSQL', !!parentInDb);
    check('Parent order has isParentOrder: true', parentInDb.isParentOrder === true);
    check('Parent order has parentOrderId: null', parentInDb.parentOrderId === null);
    check('Parent order owns single ₹2.00 platform fee', parentInDb.platformFee === 2.0);
    check('Parent order feeStatus starts as UNALLOCATED', parentInDb.feeStatus === 'UNALLOCATED');
    check('Parent order medicineSubtotal = (4*25) + (3*40) = ₹220.00', parentInDb.medicineSubtotal === 220.0);
    check('Parent order totalAmount = ₹222.00 (₹220 + ₹2)', parentInDb.totalAmount === 222.0);
    check('Parent order references exactly 2 child orders in PostgreSQL', parentInDb.childOrders.length === 2);

    // Verify child orders in PostgreSQL
    const childA = parentInDb.childOrders.find(c => c.pharmacyId === testPharmacyAId);
    const childB = parentInDb.childOrders.find(c => c.pharmacyId === testPharmacyBId);

    check('Child Order A exists in PostgreSQL for Pharmacy A', !!childA);
    check('Child Order A has isParentOrder: false', childA.isParentOrder === false);
    check('Child Order A platformFee is strictly ₹0.00', childA.platformFee === 0.0);
    check('Child Order A medicineSubtotal is ₹100.00', childA.medicineSubtotal === 100.0);
    check('Child Order A has order item referencing testPItem1Id', childA.items[0]?.prescriptionItemId === testPItem1Id);
    check('Child Order A order item records unitPrice ₹25.00', childA.items[0]?.unitPrice === 25.0);

    check('Child Order B exists in PostgreSQL for Pharmacy B', !!childB);
    check('Child Order B has isParentOrder: false', childB.isParentOrder === false);
    check('Child Order B platformFee is strictly ₹0.00', childB.platformFee === 0.0);
    check('Child Order B medicineSubtotal is ₹120.00', childB.medicineSubtotal === 120.0);
    check('Child Order B has order item referencing testPItem2Id', childB.items[0]?.prescriptionItemId === testPItem2Id);
    check('Child Order B order item records unitPrice ₹40.00', childB.items[0]?.unitPrice === 40.0);

    // Verify IdempotencyRecord in PostgreSQL
    const idempotencyInDb = await prisma.idempotencyRecord.findUnique({
      where: {
        userId_action_key: {
          userId: testPatientId,
          action: 'SPLIT_ORDER_CREATION',
          key: testIdempotencyKey1
        }
      }
    });

    check('IdempotencyRecord is persisted in PostgreSQL', !!idempotencyInDb);
    check('IdempotencyRecord points to created parentOrderId', idempotencyInDb.parentOrderId === createdParentOrderId);
    check('IdempotencyRecord has canonical requestHash', !!idempotencyInDb.requestHash && idempotencyInDb.requestHash.length === 64);
    check('IdempotencyRecord has expiresAt set in future', idempotencyInDb.expiresAt > new Date());

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Idempotent Replay with Same Key and Payload
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Idempotent Replay with Same Key and Payload ---');
    const req2 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': testIdempotencyKey1,
        'x-idempotency-key': testIdempotencyKey1
      },
      body: {
        idempotencyKey: testIdempotencyKey1,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 4
          },
          {
            pharmacyId: testPharmacyBId,
            prescriptionItemId: testPItem2Id,
            quantity: 3
          }
        ],
        notes: 'Gate 4.2.1 Real PostgreSQL Test Order'
      }
    });
    const res2 = createMockRes();
    await createSplitOrder(req2, res2);

    check('Idempotent replay returns HTTP 200 or 201', res2.statusCode === 200 || res2.statusCode === 201);
    check('Replay returns isIdempotentReplay: true', res2.body?.isIdempotentReplay === true);
    check('Replay returns identical parentOrder.id', res2.body?.parentOrder?.id === createdParentOrderId);

    // Verify count of parent and child orders in PostgreSQL did not increase
    const totalOrdersInDb = await prisma.order.count({
      where: { userId: testPatientId }
    });
    check('PostgreSQL order count did not increase on duplicate replay (remains 3)', totalOrdersInDb === 3);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Idempotency Key Payload Mismatch (409 Conflict)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Idempotency Key Payload Mismatch Returns HTTP 409 ---');
    const req3 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': testIdempotencyKey1,
        'x-idempotency-key': testIdempotencyKey1
      },
      body: {
        idempotencyKey: testIdempotencyKey1,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 5 // Mismatched quantity!
          },
          {
            pharmacyId: testPharmacyBId,
            prescriptionItemId: testPItem2Id,
            quantity: 3
          }
        ]
      }
    });
    const res3 = createMockRes();
    await createSplitOrder(req3, res3);

    check('Re-using key with different allocations returns HTTP 409', res3.statusCode === 409);
    check('Error code is IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', res3.body?.code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Over-Allocation Exceeding Outstanding Prescription Quantity (400)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 4: Over-Allocation Exceeding Outstanding Quantity Returns HTTP 400 ---');
    // Item 1 had total quantity 10; 4 units were already allocated in Test 1. Outstanding is 6.
    // Allocating 8 units must be rejected!
    const req4 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': `idem_over_${RUN_ID}`,
        'x-idempotency-key': `idem_over_${RUN_ID}`
      },
      body: {
        idempotencyKey: `idem_over_${RUN_ID}`,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 8 // Exceeds outstanding (6)
          }
        ]
      }
    });
    const res4 = createMockRes();
    await createSplitOrder(req4, res4);

    check('Over-allocation attempt returns HTTP 400', res4.statusCode === 400);
    check('Error code is ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY', res4.body?.code === 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Unverified Prescription Rejection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Unverified Prescription Rejection ---');
    const req5 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': `idem_unver_${RUN_ID}`,
        'x-idempotency-key': `idem_unver_${RUN_ID}`
      },
      body: {
        idempotencyKey: `idem_unver_${RUN_ID}`,
        prescriptionId: testUnverifiedRxId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testUnverifiedPItemId,
            quantity: 2
          }
        ]
      }
    });
    const res5 = createMockRes();
    await createSplitOrder(req5, res5);

    check('Unverified prescription returns HTTP 400', res5.statusCode === 400);
    check('Error code is PRESCRIPTION_NOT_VERIFIED', res5.body?.code === 'PRESCRIPTION_NOT_VERIFIED');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: Duplicate Allocation Pair in Same Request Rejected
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: Duplicate Pharmacy-Item Pair in Same Request Rejected ---');
    const req6 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': `idem_duppair_${RUN_ID}`,
        'x-idempotency-key': `idem_duppair_${RUN_ID}`
      },
      body: {
        idempotencyKey: `idem_duppair_${RUN_ID}`,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 1
          },
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: 2
          }
        ]
      }
    });
    const res6 = createMockRes();
    await createSplitOrder(req6, res6);

    check('Duplicate allocation pair returns HTTP 400', res6.statusCode === 400);
    check('Error code is DUPLICATE_ALLOCATION', res6.body?.code === 'DUPLICATE_ALLOCATION');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: Non-positive Quantity Allocation Rejected
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 7: Non-positive Quantity Allocation Rejected ---');
    const req7 = createMockReq({
      user: { id: testPatientId, role: 'PATIENT' },
      headers: {
        'idempotency-key': `idem_negqty_${RUN_ID}`,
        'x-idempotency-key': `idem_negqty_${RUN_ID}`
      },
      body: {
        idempotencyKey: `idem_negqty_${RUN_ID}`,
        prescriptionId: testPrescriptionId,
        allocations: [
          {
            pharmacyId: testPharmacyAId,
            prescriptionItemId: testPItem1Id,
            quantity: -2
          }
        ]
      }
    });
    const res7 = createMockRes();
    await createSplitOrder(req7, res7);

    check('Negative quantity allocation returns HTTP 400', res7.statusCode === 400);
    check('Error code is INVALID_QUANTITY', res7.body?.code === 'INVALID_QUANTITY');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: Inventory Stock Invariance (Gate 1A Protection)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 8: Inventory Stock Preserved (Gate 1A Invariance) ---');
    const invA = await prisma.inventory.findUnique({ where: { id: testInvAId } });
    const invB = await prisma.inventory.findUnique({ where: { id: testInvBId } });

    check('Pharmacy A inventory stock untouched by split-order reservation (remains 50)', invA.stock === 50);
    check('Pharmacy B inventory stock untouched by split-order reservation (remains 50)', invB.stock === 50);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9: Real PostgreSQL ACID Transaction Rollback
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 9: Real PostgreSQL ACID Transaction Rollback Verification ---');
    const rollbackParentId = `ord_rb_${RUN_ID}`;
    let rollbackErrorCaught = false;

    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Insert parent order inside transaction
        await tx.order.create({
          data: {
            id: rollbackParentId,
            orderNumber: `MF-RB-${RUN_ID}`,
            userId: testPatientId,
            pharmacyId: testPharmacyAId,
            status: 'PENDING',
            isParentOrder: true,
            platformFee: 2.0,
            totalAmount: 102.0
          }
        });

        // Step 2: Force transaction abort
        throw new Error('SIMULATED_TRANSACTION_ROLLBACK_VERIFICATION');
      });
    } catch (err) {
      if (err.message === 'SIMULATED_TRANSACTION_ROLLBACK_VERIFICATION') {
        rollbackErrorCaught = true;
      } else {
        throw err;
      }
    }

    check('Transaction aborted cleanly on forced error', rollbackErrorCaught === true);

    const rolledBackParent = await prisma.order.findUnique({
      where: { id: rollbackParentId }
    });
    check('PostgreSQL cleanly rolled back uncommitted order (record does not exist)', rolledBackParent === null);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10: PostgreSQL Compound Unique Constraint Enforcement on IdempotencyRecord
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 10: PostgreSQL Compound Unique Constraint Enforcement ---');
    let p2002Caught = false;
    try {
      await prisma.idempotencyRecord.create({
        data: {
          id: `idm_dup_${RUN_ID}`,
          userId: testPatientId,
          key: testIdempotencyKey1, // Duplicate key with existing record from Test 1
          action: 'SPLIT_ORDER_CREATION',
          requestHash: 'duplicate_hash_test',
          responseStatus: 201,
          responseBody: '{"duplicate":true}'
        }
      });
    } catch (err) {
      if (err.code === 'P2002') {
        p2002Caught = true;
      }
    }

    check('PostgreSQL enforces compound unique constraint on IdempotencyRecord (P2002)', p2002Caught === true);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 11: PrescriptionAuditLog Persisted in PostgreSQL
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 11: PrescriptionAuditLog Persisted in PostgreSQL ---');
    const auditRecord = await prisma.prescriptionAuditLog.findFirst({
      where: {
        prescriptionIdSnapshot: testPrescriptionId,
        action: 'SPLIT_ORDER_CREATED'
      }
    });

    check('PrescriptionAuditLog entry exists in PostgreSQL for split-order creation', !!auditRecord);
    check('Audit log records actorId as testPatientId', auditRecord?.actorId === testPatientId);
    check('Audit log records action as SPLIT_ORDER_CREATED', auditRecord?.action === 'SPLIT_ORDER_CREATED');

  } finally {
    // ── Guaranteed Cleanup in Strict Reverse Dependency Order ────────────────
    console.log('\n─── Cleanup: Removing Ephemeral Test Fixtures from PostgreSQL ───');

    // 1. Delete notifications
    try {
      await prisma.notification.deleteMany({
        where: { userId: testPatientId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete notifications: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (notifications): ${err.message}`);
    }

    // 2. Delete order status history for test orders
    try {
      if (createdParentOrderId) {
        await prisma.orderStatusHistory.deleteMany({
          where: {
            order: {
              OR: [
                { id: createdParentOrderId },
                { parentOrderId: createdParentOrderId }
              ]
            }
          }
        });
      }
    } catch (err) {
      cleanupErrors.push(`Failed to delete orderStatusHistory: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orderStatusHistory): ${err.message}`);
    }

    // 3. Delete order items
    try {
      if (createdParentOrderId) {
        await prisma.orderItem.deleteMany({
          where: {
            order: {
              OR: [
                { id: createdParentOrderId },
                { parentOrderId: createdParentOrderId }
              ]
            }
          }
        });
      }
    } catch (err) {
      cleanupErrors.push(`Failed to delete orderItems: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orderItems): ${err.message}`);
    }

    // 4. Delete idempotency records
    try {
      await prisma.idempotencyRecord.deleteMany({
        where: { userId: testPatientId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete idempotencyRecord: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (idempotencyRecord): ${err.message}`);
    }

    // 5. Delete child orders
    try {
      if (createdParentOrderId) {
        await prisma.order.deleteMany({
          where: { parentOrderId: createdParentOrderId }
        });
      }
    } catch (err) {
      cleanupErrors.push(`Failed to delete child orders: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (child orders): ${err.message}`);
    }

    // 6. Delete parent order
    try {
      if (createdParentOrderId) {
        await prisma.order.deleteMany({
          where: { id: createdParentOrderId }
        });
      }
    } catch (err) {
      cleanupErrors.push(`Failed to delete parent order: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (parent order): ${err.message}`);
    }

    // 7. Delete inventory items
    try {
      await prisma.inventory.deleteMany({
        where: {
          id: { in: [testInvAId, testInvBId] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete inventory: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (inventory): ${err.message}`);
    }

    // 8. Delete audit logs
    try {
      await prisma.prescriptionAuditLog.deleteMany({
        where: {
          OR: [
            { prescriptionIdSnapshot: testPrescriptionId },
            { prescriptionIdSnapshot: testUnverifiedRxId },
            { actorId: testPatientId }
          ]
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete audit logs: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (audit logs): ${err.message}`);
    }

    // 9. Delete prescription items
    try {
      await prisma.prescriptionItem.deleteMany({
        where: {
          id: { in: [testPItem1Id, testPItem2Id, testUnverifiedPItemId] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete prescription items: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (prescription items): ${err.message}`);
    }

    // 10. Delete prescriptions
    try {
      await prisma.prescription.deleteMany({
        where: {
          id: { in: [testPrescriptionId, testUnverifiedRxId] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete prescriptions: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (prescriptions): ${err.message}`);
    }

    // 11. Delete medicines
    try {
      await prisma.medicine.deleteMany({
        where: {
          id: { in: [testMed1Id, testMed2Id] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete medicines: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (medicines): ${err.message}`);
    }

    // 12. Delete pharmacies
    try {
      await prisma.pharmacy.deleteMany({
        where: {
          id: { in: [testPharmacyAId, testPharmacyBId] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete pharmacies: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (pharmacies): ${err.message}`);
    }

    // 13. Delete users
    try {
      await prisma.user.deleteMany({
        where: {
          id: { in: [testPatientId, testPharmAUserId, testPharmBUserId] }
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete users: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (users): ${err.message}`);
    }

    // ── Residual-Artifact Verification ────────────────────────────────────────
    try {
      const remainingNotifications = await prisma.notification.count({
        where: { userId: testPatientId }
      });
      const remainingOrders = await prisma.order.count({
        where: {
          OR: [
            { id: createdParentOrderId || 'none' },
            { parentOrderId: createdParentOrderId || 'none' }
          ]
        }
      });
      const remainingIdempotency = await prisma.idempotencyRecord.count({
        where: { userId: testPatientId }
      });
      const remainingInventory = await prisma.inventory.count({
        where: { id: { in: [testInvAId, testInvBId] } }
      });
      const remainingRxItems = await prisma.prescriptionItem.count({
        where: { id: { in: [testPItem1Id, testPItem2Id, testUnverifiedPItemId] } }
      });
      const remainingPrescriptions = await prisma.prescription.count({
        where: { id: { in: [testPrescriptionId, testUnverifiedRxId] } }
      });
      const remainingMedicines = await prisma.medicine.count({
        where: { id: { in: [testMed1Id, testMed2Id] } }
      });
      const remainingPharmacies = await prisma.pharmacy.count({
        where: { id: { in: [testPharmacyAId, testPharmacyBId] } }
      });
      const remainingUsers = await prisma.user.count({
        where: { id: { in: [testPatientId, testPharmAUserId, testPharmBUserId] } }
      });

      const totalResiduals =
        remainingNotifications +
        remainingOrders +
        remainingIdempotency +
        remainingInventory +
        remainingRxItems +
        remainingPrescriptions +
        remainingMedicines +
        remainingPharmacies +
        remainingUsers;

      console.log(`✓ Cleanup Verification: Orders: ${remainingOrders}, Idem: ${remainingIdempotency}, Inv: ${remainingInventory}, Rx: ${remainingPrescriptions}, Meds: ${remainingMedicines}, Ph: ${remainingPharmacies}, Users: ${remainingUsers}`);

      if (totalResiduals === 0) {
        console.log('✓ Zero test artifacts remain in PostgreSQL database');
      } else {
        const fixtureError = `Residual test records remain in database (Total residual count: ${totalResiduals})`;
        cleanupErrors.push(fixtureError);
        failCount++;
        console.error(`❌ Cleanup verification failed: ${fixtureError}`);
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
  console.log(`Gate 4.2.1 PostgreSQL Integration Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (failCount > 0 || cleanupErrors.length > 0) {
    process.exit(1);
  }
}

// Export for runner / programmatic use
module.exports = {
  runPostgresSplitOrderIntegrationTest
};

// Direct invocation handler
if (require.main === module) {
  runPostgresSplitOrderIntegrationTest().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}
