'use strict';

/**
 * MediFind AI — Gate 4.2.2.2: Fee Ledger & Checkout PostgreSQL Integration Test
 *
 * Real PostgreSQL-backed integration test suite executing against the local
 * disposable database (medifind_disposable_test on localhost:5432).
 *
 * STRICT SAFETY ENFORCEMENT:
 * 1. Uses createSafeTestPrismaClient() strictly bound to TEST_DATABASE_URL (.env.test.local).
 * 2. Preflight verification: Confirms current_database() === 'medifind_disposable_test'
 *    and port === 5432 before any write operation is permitted.
 * 3. Never connects to Neon, production, or staging.
 * 4. Generates unique ephemeral test fixtures tagged with a distinct run ID.
 * 5. Uses a robust try...finally cleanup handler respecting foreign-key hierarchy.
 * 6. Exercises real PostgreSQL row locking, ACID transaction rollback, foreign keys,
 *    and unique constraint violations alongside the actual checkoutController functions.
 */

const assert = require('assert');
const { URL } = require('url');
const { createSafeTestPrismaClient, assertSafeTestDatabase } = require('./src/utils/testDatabaseGuard');

// ── Guard Validation & Environment Configuration (Must run BEFORE any Prisma-using module is imported) ──
// Run the existing test-database guard first and validate server/.env.test.local
const initialGuard = assertSafeTestDatabase();
if (!initialGuard.isSafe) {
  throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${initialGuard.error}`);
}

const parsedInitialUrl = new URL(initialGuard.resolvedUrl);
const allowedHosts = new Set(['localhost', '127.0.0.1']);
if (parsedInitialUrl.pathname !== '/medifind_disposable_test' || !allowedHosts.has(parsedInitialUrl.hostname) || Number(parsedInitialUrl.port || 5432) !== 5432) {
  throw new Error(`[FAIL CLOSED] Target database must be strictly medifind_disposable_test on localhost:5432. Received: ${initialGuard.maskedHost}`);
}

// Configure DATABASE_URL, DATABASE_URL_UNPOOLED, and relevant Prisma connection variables
// from the validated local test URL before importing checkoutController or any module that creates a global PrismaClient.
process.env.DATABASE_URL = initialGuard.resolvedUrl;
process.env.DATABASE_URL_UNPOOLED = initialGuard.resolvedUrl;
process.env.DIRECT_URL = initialGuard.resolvedUrl;
process.env.TEST_DATABASE_URL = initialGuard.resolvedUrl;
process.env.ENABLE_PLATFORM_FEE = 'true';

// Evict any previously cached prisma or checkoutController instances to guarantee fresh binding to the validated local test URL
try {
  delete require.cache[require.resolve('./src/prisma')];
} catch (err) {
  // Module not yet loaded or cached; expected on fresh start
}
try {
  delete require.cache[require.resolve('./src/controllers/checkoutController')];
} catch (err) {
  // Module not yet loaded or cached; expected on fresh start
}

// Now safely import modules that instantiate or depend on the global PrismaClient
const {
  resolveOrderPlatformFee,
  reserveParentFeeInsideTransaction,
  getCheckoutSummary
} = require('./src/controllers/checkoutController');
const globalPrisma = require('./src/prisma');

// Unique run tag to ensure zero collision with any other tests
const RUN_ID = `flt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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

function createMockReq(params = {}, user = {}) {
  return { params, user };
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

async function runPostgresFeeLedgerIntegrationTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('🛡️  MEDIFIND AI — GATE 4.2.2.2: POSTGRESQL FEE LEDGER INTEGRATION');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // ── Preflight Step 1: Guard Validation ──────────────────────────────────────
  console.log('─── Preflight 1: Offline Database Guard Validation ───');
  const guard = assertSafeTestDatabase();
  if (!guard.isSafe) {
    throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${guard.error}`);
  }
  console.log(`✓ Safety Guard Accepted: ${guard.identityType} (${guard.maskedHost})`);

  // Ensure process environment points to validated local test database
  process.env.DATABASE_URL = guard.resolvedUrl;
  process.env.DATABASE_URL_UNPOOLED = guard.resolvedUrl;
  process.env.DIRECT_URL = guard.resolvedUrl;
  process.env.TEST_DATABASE_URL = guard.resolvedUrl;
  process.env.ENABLE_PLATFORM_FEE = 'true';

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
  const testUserId = `usr_${RUN_ID}`;
  const testPharmacistId = `usr_pharm_${RUN_ID}`;
  const testPharmacyId = `ph_${RUN_ID}`;
  const testMedicineId = `med_${RUN_ID}`;
  const testParentOrderId = `ord_parent_${RUN_ID}`;
  const testChildOrder1Id = `ord_child1_${RUN_ID}`;
  const testChildOrder2Id = `ord_child2_${RUN_ID}`;
  const testOrderItemId = `item_${RUN_ID}`;

  const cleanupErrors = [];

  try {
    // ── Setup: Insert Ephemeral Test Fixtures ────────────────────────────────
    console.log('\n─── Setup: Creating Isolated Ephemeral Test Fixtures in PostgreSQL ───');

    await prisma.user.create({
      data: {
        id: testUserId,
        email: `${RUN_ID}_patient@example.com`,
        password: 'hashed_password_for_test',
        name: `Test Patient ${RUN_ID}`,
        role: 'PATIENT'
      }
    });

    await prisma.user.create({
      data: {
        id: testPharmacistId,
        email: `${RUN_ID}_pharm@example.com`,
        password: 'hashed_password_for_test',
        name: `Test Pharmacist ${RUN_ID}`,
        role: 'PHARMACIST'
      }
    });

    await prisma.pharmacy.create({
      data: {
        id: testPharmacyId,
        name: `Pharmacy ${RUN_ID}`,
        licenseNumber: `LIC-${RUN_ID}`,
        address: '123 Test Road',
        phone: '9999999999',
        isVerified: true,
        verificationStatus: 'TEST',
        isOpen: true,
        deliveryAvailable: true,
        managerId: testPharmacistId
      }
    });

    await prisma.medicine.create({
      data: {
        id: testMedicineId,
        brandName: `Medicine ${RUN_ID}`,
        genericName: 'Paracetamol',
        dosageForm: 'TABLET',
        strength: '650mg',
        category: 'Analgesic',
        manufacturer: 'Test Labs',
        isEmergency: false,
        requiresPrescription: false
      }
    });

    // Parent order (aggregate split order)
    await prisma.order.create({
      data: {
        id: testParentOrderId,
        orderNumber: `MF-PAR-${RUN_ID}`,
        userId: testUserId,
        pharmacyId: testPharmacyId,
        isParentOrder: true,
        parentOrderId: null,
        status: 'PENDING',
        fulfillmentType: 'PICKUP',
        medicineSubtotal: 300.0,
        deliveryFee: 0.0,
        platformFee: 2.0,
        totalAmount: 302.0,
        feeStatus: 'UNALLOCATED',
        feePayingChildOrderId: null
      }
    });

    // Child order 1
    await prisma.order.create({
      data: {
        id: testChildOrder1Id,
        orderNumber: `MF-CH1-${RUN_ID}`,
        userId: testUserId,
        pharmacyId: testPharmacyId,
        isParentOrder: false,
        parentOrderId: testParentOrderId,
        status: 'CONFIRMED',
        fulfillmentType: 'PICKUP',
        medicineSubtotal: 100.0,
        deliveryFee: 0.0,
        platformFee: 0.0,
        totalAmount: 100.0
      }
    });

    // Child order 2
    await prisma.order.create({
      data: {
        id: testChildOrder2Id,
        orderNumber: `MF-CH2-${RUN_ID}`,
        userId: testUserId,
        pharmacyId: testPharmacyId,
        isParentOrder: false,
        parentOrderId: testParentOrderId,
        status: 'CONFIRMED',
        fulfillmentType: 'PICKUP',
        medicineSubtotal: 200.0,
        deliveryFee: 0.0,
        platformFee: 0.0,
        totalAmount: 200.0
      }
    });

    // Order item on child 1
    await prisma.orderItem.create({
      data: {
        id: testOrderItemId,
        orderId: testChildOrder1Id,
        medicineId: testMedicineId,
        quantity: 2,
        fulfilledQuantity: 2,
        status: 'CONFIRMED',
        unitPrice: 50.0,
        subtotal: 100.0
      }
    });

    console.log('✓ Ephemeral test records created successfully');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Initial Fee Resolution on Split Orders
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: Initial Platform Fee Resolution on Real PostgreSQL ---');
    const parentDbOrder = await prisma.order.findUnique({ where: { id: testParentOrderId } });
    const childDbOrder1 = await prisma.order.findUnique({ where: { id: testChildOrder1Id } });

    const parentResolution = await resolveOrderPlatformFee(parentDbOrder, prisma);
    check('Parent aggregate order direct checkout is rejected', parentResolution.error === 'PARENT_ORDER_CHECKOUT_PROHIBITED');

    const child1Resolution = await resolveOrderPlatformFee(childDbOrder1, prisma);
    check('Child order has 0.00 platform fee before reservation', child1Resolution.platformFee === 0.0);
    check('Child order feeStatus matches parent UNALLOCATED state', child1Resolution.feeStatus === 'UNALLOCATED');
    check('Child order isFeePayer is false initially', child1Resolution.isFeePayer === false);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Atomic Fee Reservation (First Eligible Child)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Atomic Fee Reservation via reserveParentFeeInsideTransaction ---');
    const reservationResult = await prisma.$transaction(async (tx) => {
      return await reserveParentFeeInsideTransaction(tx, childDbOrder1);
    });

    check('Reservation returns newlyReserved: true', reservationResult.newlyReserved === true);
    check('Reservation assigns exactly ₹2.00 platform fee to first child', reservationResult.platformFee === 2.0);
    check('Reservation designates first child as fee payer', reservationResult.isFeePayer === true);
    check('Reservation status is RESERVED', reservationResult.feeStatus === 'RESERVED');

    // Verify persisted PostgreSQL state
    const parentAfterRes = await prisma.order.findUnique({ where: { id: testParentOrderId } });
    check('Parent order feeStatus persisted as RESERVED in PostgreSQL', parentAfterRes.feeStatus === 'RESERVED');
    check('Parent feePayingChildOrderId persisted as child 1 ID in PostgreSQL', parentAfterRes.feePayingChildOrderId === testChildOrder1Id);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Duplicate / Idempotent Reservation Retry by Same Child
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Idempotent Reservation Retry by Same Child ---');
    const retryResult = await prisma.$transaction(async (tx) => {
      return await reserveParentFeeInsideTransaction(tx, childDbOrder1);
    });

    check('Duplicate reservation returns reused: true', retryResult.reused === true);
    check('Platform fee remains ₹2.00 on duplicate retry', retryResult.platformFee === 2.0);
    check('feePayingChildOrderId remains child 1', retryResult.isFeePayer === true);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Second Child Blocked from Reserving Held Fee
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 4: Second Child Blocked from Reserving Fee ---');
    const childDbOrder2 = await prisma.order.findUnique({ where: { id: testChildOrder2Id } });

    const child2Result = await prisma.$transaction(async (tx) => {
      return await reserveParentFeeInsideTransaction(tx, childDbOrder2);
    });

    check('Child 2 is blocked with reservedByOther: true', child2Result.reservedByOther === true);
    check('Child 2 receives exactly ₹0.00 platform fee', child2Result.platformFee === 0.0);
    check('Child 2 isFeePayer is false', child2Result.isFeePayer === false);

    // Confirm parent order in PostgreSQL is still owned by Child 1
    const parentStillChild1 = await prisma.order.findUnique({ where: { id: testParentOrderId } });
    check('Parent fee owner remains Child 1 in PostgreSQL', parentStillChild1.feePayingChildOrderId === testChildOrder1Id);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Real PostgreSQL Transaction Rollback on Forced Failure
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Real PostgreSQL ACID Transaction Rollback Verification ---');
    // Reset parent order back to UNALLOCATED
    await prisma.order.update({
      where: { id: testParentOrderId },
      data: { feeStatus: 'UNALLOCATED', feePayingChildOrderId: null }
    });

    let transactionAborted = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Reserve fee in transaction
        await reserveParentFeeInsideTransaction(tx, childDbOrder1);

        // Step 2: Force transaction abort
        throw new Error('SIMULATED_TRANSACTION_FAILURE_ROLLBACK_TEST');
      });
    } catch (err) {
      if (err.message === 'SIMULATED_TRANSACTION_FAILURE_ROLLBACK_TEST') {
        transactionAborted = true;
      } else {
        throw err;
      }
    }

    check('Transaction aborted cleanly on forced error', transactionAborted === true);

    // Verify database state: PostgreSQL rolled back the feeStatus and feePayingChildOrderId updates
    const rolledBackParent = await prisma.order.findUnique({ where: { id: testParentOrderId } });
    check('PostgreSQL rolled back feeStatus to UNALLOCATED', rolledBackParent.feeStatus === 'UNALLOCATED');
    check('PostgreSQL rolled back feePayingChildOrderId to null', rolledBackParent.feePayingChildOrderId === null);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: Real PostgreSQL Foreign Key Enforcement (ON DELETE RESTRICT)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: PostgreSQL Foreign Key & Constraint Verification ---');

    // Attempt inserting child order with non-existent parent ID
    let fkViolationCaught = false;
    try {
      await prisma.order.create({
        data: {
          id: `ord_invalid_${RUN_ID}`,
          orderNumber: `MF-INV-${RUN_ID}`,
          userId: testUserId,
          pharmacyId: testPharmacyId,
          parentOrderId: 'non-existent-parent-order-uuid',
          status: 'PENDING'
        }
      });
    } catch (err) {
      // Prisma code P2003 corresponds to foreign key constraint violation
      if (err.code === 'P2003' || (err.message && err.message.includes('foreign key constraint'))) {
        fkViolationCaught = true;
      }
    }
    check('PostgreSQL rejects invalid parentOrderId foreign key (P2003)', fkViolationCaught === true);

    // Attempt deleting parent order while child orders reference it (ON DELETE RESTRICT)
    let restrictViolationCaught = false;
    try {
      await prisma.order.delete({ where: { id: testParentOrderId } });
    } catch (err) {
      if (err.code === 'P2003' || (err.message && err.message.includes('foreign key constraint'))) {
        restrictViolationCaught = true;
      }
    }
    check('PostgreSQL enforces ON DELETE RESTRICT on parent order with children', restrictViolationCaught === true);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: Real PostgreSQL Unique Constraint on IdempotencyRecord
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 7: PostgreSQL Unique Constraint on IdempotencyRecord ---');
    const idemKey = `idem_${RUN_ID}`;
    await prisma.idempotencyRecord.create({
      data: {
        id: `idm_1_${RUN_ID}`,
        userId: testUserId,
        key: idemKey,
        action: 'SPLIT_ORDER_CREATION',
        requestHash: 'hash_abc123',
        responseStatus: 201,
        responseBody: '{"created":true}',
        parentOrderId: testParentOrderId
      }
    });

    let duplicateIdemCaught = false;
    try {
      await prisma.idempotencyRecord.create({
        data: {
          id: `idm_2_${RUN_ID}`,
          userId: testUserId,
          key: idemKey,
          action: 'SPLIT_ORDER_CREATION', // Duplicate (userId, action, key) compound unique key
          requestHash: 'hash_xyz789',
          responseStatus: 201,
          responseBody: '{"created":false}'
        }
      });
    } catch (err) {
      // Prisma code P2002 corresponds to unique constraint violation
      if (err.code === 'P2002') {
        duplicateIdemCaught = true;
      }
    }
    check('PostgreSQL enforces compound unique constraint on IdempotencyRecord (P2002)', duplicateIdemCaught === true);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: Fee Payment State Transition (PAID State Enforcement)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 8: Parent Fee Transition to PAID ---');
    await prisma.order.update({
      where: { id: testParentOrderId },
      data: {
        feeStatus: 'PAID',
        feePayingChildOrderId: testChildOrder1Id,
        feePaidAt: new Date()
      }
    });

    const child1PaidResolution = await resolveOrderPlatformFee(childDbOrder1, prisma);
    check('Payer child resolves platformFee = 2.0 when parent feeStatus is PAID', child1PaidResolution.platformFee === 2.0);
    check('Payer child isFeePayer is true', child1PaidResolution.isFeePayer === true);

    const child2PaidResolution = await resolveOrderPlatformFee(childDbOrder2, prisma);
    check('Non-payer child resolves platformFee = 0.0 when parent feeStatus is PAID', child2PaidResolution.platformFee === 0.0);
    check('Non-payer child isFeePayer is false', child2PaidResolution.isFeePayer === false);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9: Real Controller Integration (getCheckoutSummary against PostgreSQL)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 9: Actual Controller getCheckoutSummary Integration ---');
    const reqChild1 = createMockReq({ orderId: testChildOrder1Id }, { id: testUserId });
    const resChild1 = createMockRes();
    await getCheckoutSummary(reqChild1, resChild1);

    check('getCheckoutSummary returns 200 for Child 1', resChild1.statusCode === 200);
    check('getCheckoutSummary reflects ₹2.00 fee for fee-paying child', resChild1.body?.checkout?.totals?.platformFee === 2.0);
    check('getCheckoutSummary calculates totalAmount including ₹2.00 (₹102.00)', resChild1.body?.checkout?.totals?.totalAmount === 102.0);

    const reqChild2 = createMockReq({ orderId: testChildOrder2Id }, { id: testUserId });
    const resChild2 = createMockRes();
    await getCheckoutSummary(reqChild2, resChild2);

    check('getCheckoutSummary returns 200 for Child 2', resChild2.statusCode === 200);
    check('getCheckoutSummary reflects ₹0.00 fee for non-paying child', resChild2.body?.checkout?.totals?.platformFee === 0.0);
    check('getCheckoutSummary totalAmount strictly equals medicineSubtotal (₹200.00)', resChild2.body?.checkout?.totals?.totalAmount === 200.0);

  } finally {
    // ── Guaranteed Cleanup in Reverse Dependency Order ───────────────────────
    console.log('\n─── Cleanup: Removing Ephemeral Test Fixtures from PostgreSQL ───');

    try {
      await prisma.orderItem.deleteMany({
        where: { id: testOrderItemId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete orderItem (${testOrderItemId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (orderItem): ${err.message}`);
    }

    try {
      await prisma.idempotencyRecord.deleteMany({
        where: { userId: testUserId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete idempotencyRecord for user (${testUserId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (idempotencyRecord): ${err.message}`);
    }

    try {
      // Delete child orders first
      await prisma.order.deleteMany({
        where: { parentOrderId: testParentOrderId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete child orders for parent (${testParentOrderId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (child orders): ${err.message}`);
    }

    try {
      // Delete parent order
      await prisma.order.deleteMany({
        where: { id: testParentOrderId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete parent order (${testParentOrderId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (parent order): ${err.message}`);
    }

    try {
      await prisma.medicine.deleteMany({
        where: { id: testMedicineId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete medicine (${testMedicineId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (medicine): ${err.message}`);
    }

    try {
      await prisma.pharmacy.deleteMany({
        where: { id: testPharmacyId }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete pharmacy (${testPharmacyId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (pharmacy): ${err.message}`);
    }

    try {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { id: testUserId },
            { id: testPharmacistId }
          ]
        }
      });
    } catch (err) {
      cleanupErrors.push(`Failed to delete users (${testUserId}, ${testPharmacistId}): ${err.message}`);
      console.error(`  ⚠️ Cleanup error (user): ${err.message}`);
    }

    // Verify zero test artifacts remain in database
    try {
      const remainingOrderItems = await prisma.orderItem.count({
        where: { id: testOrderItemId }
      });

      const remainingIdempotency = await prisma.idempotencyRecord.count({
        where: { userId: testUserId }
      });

      const remainingOrders = await prisma.order.count({
        where: {
          OR: [
            { id: testParentOrderId },
            { id: testChildOrder1Id },
            { id: testChildOrder2Id }
          ]
        }
      });

      const remainingMedicines = await prisma.medicine.count({
        where: { id: testMedicineId }
      });

      const remainingPharmacies = await prisma.pharmacy.count({
        where: { id: testPharmacyId }
      });

      const remainingUsers = await prisma.user.count({
        where: {
          OR: [
            { id: testUserId },
            { id: testPharmacistId }
          ]
        }
      });

      const totalResiduals = remainingOrderItems + remainingIdempotency + remainingOrders + remainingMedicines + remainingPharmacies + remainingUsers;
      console.log(`✓ Cleanup Verification: Items: ${remainingOrderItems}, Idempotency: ${remainingIdempotency}, Orders: ${remainingOrders}, Medicines: ${remainingMedicines}, Pharmacies: ${remainingPharmacies}, Users: ${remainingUsers}`);
      if (totalResiduals === 0) {
        console.log('✓ Zero test artifacts remain in PostgreSQL database');
      } else {
        const fixtureError = `Residual test records remain in database (Items: ${remainingOrderItems}, Idem: ${remainingIdempotency}, Orders: ${remainingOrders}, Medicines: ${remainingMedicines}, Pharmacies: ${remainingPharmacies}, Users: ${remainingUsers})`;
        cleanupErrors.push(fixtureError);
        failCount++;
        console.error(`❌ Cleanup verification failed: ${fixtureError}`);
      }
    } catch (err) {
      cleanupErrors.push(`Failed to count remaining test artifacts: ${err.message}`);
      failCount++;
      console.error(`  ⚠️ Cleanup error (verification): ${err.message}`);
    }

    // Disconnect both safe test client and global controller client
    try {
      await prisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Safe test prisma disconnect error: ${err.message}`);
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
  console.log(`Gate 4.2.2.2 PostgreSQL Integration Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (failCount > 0 || cleanupErrors.length > 0) {
    process.exit(1);
  }
}

// Export for runner / programmatic use
module.exports = {
  runPostgresFeeLedgerIntegrationTest
};

// Direct invocation handler
if (require.main === module) {
  runPostgresFeeLedgerIntegrationTest().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}
