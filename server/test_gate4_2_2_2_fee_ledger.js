'use strict';

/**
 * MediFind AI — Gate 4.2.2.2: Fee Ledger & Checkout Core Hardening Hermetic Test Suite
 *
 * Verifies all 12 mandatory conditions:
 * 1. Legacy standalone checkout still charges exactly ₹2.
 * 2. Parent aggregate orders cannot enter normal child checkout.
 * 3. Child orders have no fee before a valid reservation.
 * 4. The first eligible child can reserve the ₹2 fee.
 * 5. A second child cannot reserve the fee while another child owns it.
 * 6. A paid parent fee is never charged to another child.
 * 7. Refreshes and retries do not duplicate the fee.
 * 8. Uncertain gateway outcomes do not release the reservation.
 * 9. A safely verified terminal failure can release the reservation if the code proves it is safe.
 * 10. Counter selection alone does not mark the fee as paid.
 * 11. Pharmacist listings exclude parent aggregate orders.
 * 12. Existing single-order checkout/payment regression tests still pass.
 */

const assert = require('assert');
const crypto = require('crypto');

// Mock Razorpay instance
process.env.RAZORPAY_KEY_ID = 'rzp_test_medifind123';
process.env.RAZORPAY_KEY_SECRET = 'secret_test_key_medifind_456';
process.env.ENABLE_PLATFORM_FEE = 'true';

let passCount = 0;
let failCount = 0;

function check(title, condition, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✓ PASS: ${title}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${title} ${details ? '(' + details + ')' : ''}`);
  }
}

// In-Memory Database store for hermetic testing
function createInMemoryDb() {
  const store = {
    users: new Map(),
    pharmacies: new Map(),
    medicines: new Map(),
    inventories: new Map(),
    prescriptions: new Map(),
    prescriptionItems: new Map(),
    orders: new Map(),
    orderItems: new Map(),
    orderStatusHistories: new Map(),
    payments: new Map(),
    assistantTasks: new Map(),
    notifications: new Map(),
    idempotencyRecords: new Map()
  };

  let txQueue = Promise.resolve();
  const db = {
    _store: store,
    user: {
      findUnique: async ({ where }) => store.users.get(where.id) || null
    },
    pharmacy: {
      findUnique: async ({ where }) => {
        if (where.id) return store.pharmacies.get(where.id) || null;
        if (where.managerId) {
          for (const p of store.pharmacies.values()) {
            if (p.managerId === where.managerId) return p;
          }
        }
        return null;
      }
    },
    inventory: {
      findFirst: async ({ where }) => {
        let list = Array.from(store.inventories.values());
        if (where?.pharmacyId) list = list.filter(i => i.pharmacyId === where.pharmacyId);
        if (where?.medicineId) list = list.filter(i => i.medicineId === where.medicineId);
        return list[0] || null;
      },
      findMany: async ({ where }) => {
        let list = Array.from(store.inventories.values());
        if (where?.pharmacyId) list = list.filter(i => i.pharmacyId === where.pharmacyId);
        if (where?.medicineId?.in) list = list.filter(i => where.medicineId.in.includes(i.medicineId));
        return list;
      },
      update: async ({ where, data }) => {
        const inv = store.inventories.get(where.id);
        if (inv) {
          if (data?.stock?.increment) inv.stock = (inv.stock || 0) + data.stock.increment;
          if (data?.stock?.decrement) inv.stock = (inv.stock || 0) - data.stock.decrement;
          return inv;
        }
        return { id: where.id, ...data };
      }
    },
    patientAddress: {
      findUnique: async () => null,
      findFirst: async () => null
    },
    order: {
      findUnique: async ({ where, include }) => {
        const ord = store.orders.get(where.id);
        if (!ord) return null;
        const res = { ...ord };
        if (include?.items) {
          res.items = Array.from(store.orderItems.values())
            .filter(i => i.orderId === ord.id)
            .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) }));
        }
        if (include?.pharmacy) {
          res.pharmacy = store.pharmacies.get(ord.pharmacyId) || null;
        }
        if (include?.payment) {
          res.payment = store.payments.get(ord.id) || null;
        }
        return res;
      },
      findMany: async ({ where }) => {
        let list = Array.from(store.orders.values());
        if (where) {
          if (where.userId) list = list.filter(o => o.userId === where.userId);
          if (where.pharmacyId) list = list.filter(o => o.pharmacyId === where.pharmacyId);
          if (where.isParentOrder !== undefined) list = list.filter(o => o.isParentOrder === where.isParentOrder);
          if (where.status) {
            if (typeof where.status === 'string') {
              list = list.filter(o => o.status === where.status);
            } else if (where.status.notIn) {
              list = list.filter(o => !where.status.notIn.includes(o.status));
            }
          }
        }
        return list.map(ord => {
          const res = { ...ord };
          res.pharmacy = store.pharmacies.get(ord.pharmacyId) || null;
          res.items = Array.from(store.orderItems.values()).filter(i => i.orderId === ord.id);
          res.payment = store.payments.get(ord.id) || null;
          return res;
        });
      },
      create: async ({ data }) => {
        const id = data.id || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
        store.orders.set(id, record);
        return { ...record };
      },
      update: async ({ where, data }) => {
        const existing = store.orders.get(where.id);
        if (!existing) throw new Error(`Order ${where.id} not found`);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.orders.set(where.id, updated);
        return { ...updated };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, ord] of store.orders.entries()) {
          let match = true;
          if (where.id && ord.id !== where.id) match = false;
          if (where.status) {
            if (typeof where.status === 'string') {
              if (ord.status !== where.status) match = false;
            } else if (where.status.in) {
              if (!where.status.in.includes(ord.status)) match = false;
            }
          }
          if (match) {
            store.orders.set(id, { ...ord, ...data, updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      }
    },
    payment: {
      findUnique: async ({ where }) => {
        if (where.orderId) return store.payments.get(where.orderId) || null;
        if (where.id) {
          for (const p of store.payments.values()) {
            if (p.id === where.id) return p;
          }
        }
        return null;
      },
      upsert: async ({ where, create, update }) => {
        const existing = store.payments.get(where.orderId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          store.payments.set(where.orderId, updated);
          return { ...updated };
        } else {
          const id = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const created = { id, createdAt: new Date(), updatedAt: new Date(), ...create };
          store.payments.set(where.orderId, created);
          return { ...created };
        }
      },
      update: async ({ where, data }) => {
        let key = where.orderId;
        if (!key && where.id) {
          for (const [k, p] of store.payments.entries()) {
            if (p.id === where.id) { key = k; break; }
          }
        }
        const existing = store.payments.get(key);
        if (!existing) throw new Error('Payment not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.payments.set(key, updated);
        return { ...updated };
      }
    },
    orderStatusHistory: {
      create: async ({ data }) => {
        const id = `osh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        store.orderStatusHistories.set(id, { id, createdAt: new Date(), ...data });
        return { id, ...data };
      }
    },
    notification: {
      create: async ({ data }) => {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        store.notifications.set(id, { id, createdAt: new Date(), ...data });
        return { id, ...data };
      }
    },
    assistantTask: {
      findUnique: async ({ where }) => store.assistantTasks.get(where.orderId) || null,
      create: async ({ data }) => {
        const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        store.assistantTasks.set(data.orderId, { id, ...data });
        return { id, ...data };
      },
      update: async ({ where, data }) => {
        let key = where.orderId;
        if (!key && where.id) {
          for (const [k, t] of store.assistantTasks.entries()) {
            if (t.id === where.id) { key = k; break; }
          }
        }
        const existing = store.assistantTasks.get(key);
        if (!existing) throw new Error('Task not found');
        const updated = { ...existing, ...data };
        store.assistantTasks.set(key, updated);
        return updated;
      }
    },
    $transaction: async (fn) => {
      const prev = txQueue;
      let resolver;
      txQueue = new Promise(resolve => { resolver = resolve; });
      await prev;
      try {
        return await fn(db);
      } finally {
        resolver();
      }
    },
    $queryRawUnsafe: async () => []
  };

  return db;
}

// Helpers for mock HTTP
function createMockReq(params = {}, body = {}, user = { id: 'patient-1', role: 'PATIENT' }, query = {}) {
  return { params, body, user, query };
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

async function runFeeLedgerSuite() {
  console.log('\n================================================================');
  console.log('MediFind AI — Gate 4.2.2.2: Fee Ledger & Checkout Core Tests');
  console.log('================================================================\n');

  const testDb = createInMemoryDb();

  // Seed baseline data
  testDb._store.users.set('patient-1', { id: 'patient-1', name: 'John Doe', role: 'PATIENT' });
  testDb._store.users.set('pharmacist-1', { id: 'pharmacist-1', name: 'Jane Pharmacist', role: 'PHARMACIST' });
  testDb._store.pharmacies.set('ph-1', { id: 'ph-1', name: 'Apollo Pharmacy', managerId: 'pharmacist-1', deliveryAvailable: true, isVerified: true, verificationStatus: 'VERIFIED' });
  testDb._store.pharmacies.set('ph-2', { id: 'ph-2', name: 'Care Pharmacy', managerId: 'pharmacist-2', deliveryAvailable: true, isVerified: true, verificationStatus: 'VERIFIED' });
  testDb._store.medicines.set('med-1', { id: 'med-1', brandName: 'Dolo 650' });
  testDb._store.medicines.set('med-2', { id: 'med-2', brandName: 'Azithral 500' });
  testDb._store.inventories.set('inv-1', { id: 'inv-1', pharmacyId: 'ph-1', medicineId: 'med-1', stock: 100 });
  testDb._store.inventories.set('inv-2', { id: 'inv-2', pharmacyId: 'ph-2', medicineId: 'med-2', stock: 100 });

  // Patch prisma in checkoutController and orderController
  const checkoutController = require('./src/controllers/checkoutController');
  const orderController = require('./src/controllers/orderController');
  const paymentConfig = require('./src/utils/paymentConfig');

  // Hermetic mock for Razorpay order creation (prevents real network calls to api.razorpay.com)
  paymentConfig.getRazorpayInstance = () => ({
    razorpay: {
      orders: {
        create: async ({ amount, currency, receipt, notes }) => ({
          id: `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          amount,
          currency,
          receipt,
          notes,
          status: 'created'
        })
      }
    },
    configError: null
  });

  // We temporarily substitute global prisma methods for our hermetic test instances
  const realPrisma = require('./src/prisma');
  for (const model of ['order', 'payment', 'orderStatusHistory', 'notification', 'assistantTask', 'pharmacy', 'user', 'inventory']) {
    realPrisma[model] = testDb[model];
  }
  realPrisma.$transaction = testDb.$transaction;
  realPrisma.$queryRawUnsafe = testDb.$queryRawUnsafe;

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Legacy Standalone Checkout Still Charges Exactly ₹2.00
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Test 1: Legacy Standalone Checkout Platform Fee ---');
  const standaloneOrder = await testDb.order.create({
    data: {
      id: 'ord-standalone-1',
      orderNumber: 'MF-STD-001',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: null,
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 2.0,
      totalAmount: 102.0
    }
  });
  testDb._store.orderItems.set('item-std-1', {
    id: 'item-std-1',
    orderId: 'ord-standalone-1',
    medicineId: 'med-1',
    quantity: 2,
    unitPrice: 50.0,
    subtotal: 100.0
  });

  const req1 = createMockReq({ orderId: 'ord-standalone-1' });
  const res1 = createMockRes();
  await checkoutController.getCheckoutSummary(req1, res1);

  check('Legacy standalone checkout succeeds with 200', res1.statusCode === 200);
  check('Legacy standalone order platformFee is exactly ₹2.00', res1.body?.checkout?.totals?.platformFee === 2.0);
  check('Legacy standalone order totalAmount includes ₹2.00 fee', res1.body?.checkout?.totals?.totalAmount === 102.0);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Parent Aggregate Orders Cannot Enter Normal Child Checkout
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 2: Parent Aggregate Order Checkout Prohibited ---');
  const parentOrder = await testDb.order.create({
    data: {
      id: 'ord-parent-1',
      orderNumber: 'MF-PAR-001',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: true,
      parentOrderId: null,
      status: 'PENDING',
      medicineSubtotal: 300.0,
      platformFee: 2.0,
      totalAmount: 302.0,
      feeStatus: 'UNALLOCATED',
      feePayingChildOrderId: null
    }
  });

  const req2Summary = createMockReq({ orderId: 'ord-parent-1' });
  const res2Summary = createMockRes();
  await checkoutController.getCheckoutSummary(req2Summary, res2Summary);
  check('Parent aggregate getCheckoutSummary is rejected with 400', res2Summary.statusCode === 400);
  check('Rejection code is PARENT_ORDER_CHECKOUT_PROHIBITED', res2Summary.body?.code === 'PARENT_ORDER_CHECKOUT_PROHIBITED');

  const req2Fulfill = createMockReq({ orderId: 'ord-parent-1' }, { fulfillmentType: 'PICKUP' });
  const res2Fulfill = createMockRes();
  await checkoutController.selectFulfillment(req2Fulfill, res2Fulfill);
  check('Parent aggregate selectFulfillment is rejected with 400', res2Fulfill.statusCode === 400);

  const req2CreatePay = createMockReq({ orderId: 'ord-parent-1' });
  const res2CreatePay = createMockRes();
  await checkoutController.createPayment(req2CreatePay, res2CreatePay);
  check('Parent aggregate createPayment is rejected with 400', res2CreatePay.statusCode === 400);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Child Orders Have No Fee Before a Valid Reservation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 3: Child Orders Have Zero Fee Before Valid Reservation ---');
  const childA = await testDb.order.create({
    data: {
      id: 'ord-child-A',
      orderNumber: 'MF-PAR-001-A',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: 'ord-parent-1',
      status: 'CONFIRMED',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 100.0,
      verificationPin: '1111'
    }
  });
  testDb._store.orderItems.set('item-cA-1', {
    id: 'item-cA-1',
    orderId: 'ord-child-A',
    medicineId: 'med-1',
    quantity: 2,
    unitPrice: 50.0,
    subtotal: 100.0
  });

  const childB = await testDb.order.create({
    data: {
      id: 'ord-child-B',
      orderNumber: 'MF-PAR-001-B',
      userId: 'patient-1',
      pharmacyId: 'ph-2',
      isParentOrder: false,
      parentOrderId: 'ord-parent-1',
      status: 'CONFIRMED',
      medicineSubtotal: 200.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 200.0,
      verificationPin: '2222'
    }
  });
  testDb._store.orderItems.set('item-cB-1', {
    id: 'item-cB-1',
    orderId: 'ord-child-B',
    medicineId: 'med-2',
    quantity: 4,
    unitPrice: 50.0,
    subtotal: 200.0
  });

  const req3A = createMockReq({ orderId: 'ord-child-A' });
  const res3A = createMockRes();
  await checkoutController.getCheckoutSummary(req3A, res3A);
  check('Child A summary has platformFee = 0.00 before reservation', res3A.body?.checkout?.totals?.platformFee === 0.0);
  check('Child A total equals medicine subtotal (₹100)', res3A.body?.checkout?.totals?.totalAmount === 100.0);

  const req3B = createMockReq({ orderId: 'ord-child-B' });
  const res3B = createMockRes();
  await checkoutController.getCheckoutSummary(req3B, res3B);
  check('Child B summary has platformFee = 0.00 before reservation', res3B.body?.checkout?.totals?.platformFee === 0.0);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. The First Eligible Child Can Reserve the ₹2 Fee
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 4: First Eligible Child Reserves Fee ---');
  // Child A selects fulfillment PICKUP
  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-child-A' }, { fulfillmentType: 'PICKUP' }), createMockRes());

  // Child A creates online payment
  const res4Pay = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-A' }), res4Pay);

  check('Child A createPayment succeeds with 200', res4Pay.statusCode === 200);
  check('Child A payment amount includes ₹2.00 fee (₹102)', res4Pay.body?.payment?.amount === 102.0);

  const updatedParentAfterA = await testDb.order.findUnique({ where: { id: 'ord-parent-1' } });
  check('Parent feeStatus is now RESERVED', updatedParentAfterA.feeStatus === 'RESERVED');
  check('Parent feePayingChildOrderId is ord-child-A', updatedParentAfterA.feePayingChildOrderId === 'ord-child-A');

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. A Second Child Cannot Reserve Fee While Another Child Owns It
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 5: Second Child Blocked from Reserving Fee ---');
  // Child B selects fulfillment PICKUP
  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-child-B' }, { fulfillmentType: 'PICKUP' }), createMockRes());

  const res5PayB = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-B' }), res5PayB);

  check('Child B createPayment succeeds with 200', res5PayB.statusCode === 200);
  check('Child B payment amount does NOT include ₹2 fee (remains ₹200.0)', res5PayB.body?.payment?.amount === 200.0);

  const parentStillA = await testDb.order.findUnique({ where: { id: 'ord-parent-1' } });
  check('Parent feePayingChildOrderId remains ord-child-A', parentStillA.feePayingChildOrderId === 'ord-child-A');

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. A Paid Parent Fee is Never Charged to Another Child
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 6: Paid Fee Never Charged to Other Children ---');
  // Mock verifying Child A's payment as PAID
  const rzpOrderIdA = res4Pay.body?.payment?.gatewayOrderId || 'rzp_order_mock_A';
  const rzpPaymentIdA = 'pay_mock_12345';
  const signatureA = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${rzpOrderIdA}|${rzpPaymentIdA}`)
    .digest('hex');

  const res6Verify = createMockRes();
  await checkoutController.verifyPayment(
    createMockReq(
      { orderId: 'ord-child-A' },
      { razorpay_order_id: rzpOrderIdA, razorpay_payment_id: rzpPaymentIdA, razorpay_signature: signatureA }
    ),
    res6Verify
  );

  check('Child A payment verification succeeds with 200', res6Verify.statusCode === 200);

  const parentAfterPaid = await testDb.order.findUnique({ where: { id: 'ord-parent-1' } });
  check('Parent feeStatus transitioned to PAID', parentAfterPaid.feeStatus === 'PAID');
  check('Parent feePaidAt timestamp is recorded', Boolean(parentAfterPaid.feePaidAt));

  // Child B checkout summary after Parent fee is PAID
  const res6SummaryB = createMockRes();
  await checkoutController.getCheckoutSummary(createMockReq({ orderId: 'ord-child-B' }), res6SummaryB);
  check('Child B summary strictly shows platformFee = 0.00 after parent fee is PAID', res6SummaryB.body?.checkout?.totals?.platformFee === 0.0);
  check('Child B totalAmount strictly remains ₹200.00', res6SummaryB.body?.checkout?.totals?.totalAmount === 200.0);

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Refreshes and Retries Do Not Duplicate the Fee
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 7: Refreshes & Retries Invariance ---');
  // Child A already paid; calling verifyPayment again is idempotent
  const res7Replay = createMockRes();
  await checkoutController.verifyPayment(
    createMockReq(
      { orderId: 'ord-child-A' },
      { razorpay_order_id: rzpOrderIdA, razorpay_payment_id: rzpPaymentIdA, razorpay_signature: signatureA }
    ),
    res7Replay
  );
  check('Duplicate verification returns alreadyPaid: true', res7Replay.body?.alreadyPaid === true);

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Uncertain Gateway Outcomes Do Not Release the Reservation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 8: Uncertain Gateway Outcome Preserves Reservation ---');
  // Create Parent 2 and Child 2A, Child 2B
  await testDb.order.create({
    data: {
      id: 'ord-parent-2',
      orderNumber: 'MF-PAR-002',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: true,
      parentOrderId: null,
      status: 'PENDING',
      feeStatus: 'UNALLOCATED',
      feePayingChildOrderId: null
    }
  });
  await testDb.order.create({
    data: {
      id: 'ord-child-2A',
      orderNumber: 'MF-PAR-002-A',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: 'ord-parent-2',
      status: 'CONFIRMED',
      medicineSubtotal: 80.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 80.0
    }
  });
  testDb._store.orderItems.set('item-2A', { id: 'item-2A', orderId: 'ord-child-2A', medicineId: 'med-1', quantity: 1, unitPrice: 80.0, subtotal: 80.0 });

  await testDb.order.create({
    data: {
      id: 'ord-child-2B',
      orderNumber: 'MF-PAR-002-B',
      userId: 'patient-1',
      pharmacyId: 'ph-2',
      isParentOrder: false,
      parentOrderId: 'ord-parent-2',
      status: 'CONFIRMED',
      medicineSubtotal: 120.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 120.0
    }
  });
  testDb._store.orderItems.set('item-2B', { id: 'item-2B', orderId: 'ord-child-2B', medicineId: 'med-2', quantity: 1, unitPrice: 120.0, subtotal: 120.0 });

  // Child 2A creates payment (fee reserved on 2A)
  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-child-2A' }, { fulfillmentType: 'PICKUP' }), createMockRes());
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-2A' }), createMockRes());

  const p2 = await testDb.order.findUnique({ where: { id: 'ord-parent-2' } });
  check('Parent 2 feeStatus is RESERVED by Child 2A', p2.feeStatus === 'RESERVED' && p2.feePayingChildOrderId === 'ord-child-2A');

  // Gateway outcome is uncertain: Child 2A is PENDING on Razorpay. Patient navigates away.
  // Child 2B tries to create payment:
  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-child-2B' }, { fulfillmentType: 'PICKUP' }), createMockRes());
  const res8B = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-2B' }), res8B);

  check('Child 2B cannot steal reservation while Child 2A is uncertain (Child 2B fee = 0)', res8B.body?.payment?.amount === 120.0);
  const p2Unchanged = await testDb.order.findUnique({ where: { id: 'ord-parent-2' } });
  check('Parent 2 reservation is preserved for Child 2A', p2Unchanged.feePayingChildOrderId === 'ord-child-2A');

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Cancellation While Razorpay Intent is Pending (Preserves Reservation)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9: Cancellation While Razorpay Intent is Pending ---');
  // Patient cancels Child 2A while online gateway payment is PENDING with gatewayOrderId
  const res9Cancel = createMockRes();
  await orderController.updateOrderStatus(
    createMockReq({ id: 'ord-child-2A' }, { status: 'CANCELLED', comment: 'Patient cancelled 2A' }),
    res9Cancel
  );
  check('Child 2A cancellation succeeds with 200', res9Cancel.statusCode === 200);

  const p2StillReserved = await testDb.order.findUnique({ where: { id: 'ord-parent-2' } });
  check('Parent 2 fee reservation is PRESERVED (feeStatus remains RESERVED)', p2StillReserved.feeStatus === 'RESERVED');
  check('Parent 2 feePayingChildOrderId remains ord-child-2A while gateway outcome is uncertain', p2StillReserved.feePayingChildOrderId === 'ord-child-2A');

  // Child 2B cannot steal reservation while Child 2A intent may still succeed upstream
  testDb._store.payments.delete('ord-child-2B');
  const res9BBlocked = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-2B' }), res9BBlocked);
  check('Child 2B cannot claim fee while Child 2A gateway intent is uncertain (fee = ₹0)', res9BBlocked.body?.payment?.amount === 120.0);

  // ─────────────────────────────────────────────────────────────────────────────
  // 9b. Delayed Successful Payment After Local Cancellation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9b: Delayed Successful Payment After Local Cancellation ---');
  const rzpOrderId2A = (await testDb.payment.findUnique({ where: { orderId: 'ord-child-2A' } }))?.gatewayOrderId;
  const rzpPaymentId2A = 'pay_delayed_2A_999';
  const sigDelayed2A = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${rzpOrderId2A}|${rzpPaymentId2A}`)
    .digest('hex');

  const resDelayedVerify = createMockRes();
  await checkoutController.verifyPayment(
    createMockReq(
      { orderId: 'ord-child-2A' },
      { razorpay_order_id: rzpOrderId2A, razorpay_payment_id: rzpPaymentId2A, razorpay_signature: sigDelayed2A }
    ),
    resDelayedVerify
  );

  check('Delayed payment for CANCELLED order is rejected with 409', resDelayedVerify.statusCode === 409);
  check('Response code is ORDER_TERMINAL_REFUND_REQUIRED', resDelayedVerify.body?.code === 'ORDER_TERMINAL_REFUND_REQUIRED');
  check('Response includes refundRequired: true', resDelayedVerify.body?.refundRequired === true);
  const payment2A = await testDb.payment.findUnique({ where: { orderId: 'ord-child-2A' } });
  check('Payment record preserves gateway payment evidence', payment2A.gatewayPaymentId === rzpPaymentId2A);
  check('Payment record failureReason flags administrative refund', payment2A.failureReason?.includes('Administrative refund required'));
  const ord2AAfter = await testDb.order.findUnique({ where: { id: 'ord-child-2A' } });
  check('Cancelled order status remains CANCELLED (not marked CONFIRMED or COMPLETED)', ord2AAfter.status === 'CANCELLED');

  // ─────────────────────────────────────────────────────────────────────────────
  // 9c. Pending Payment Retry Without Overwriting Valid Gateway Intent
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9c: Pending Payment Retry Without Overwriting Valid Gateway Intent ---');
  await testDb.order.create({
    data: {
      id: 'ord-retry-test',
      orderNumber: 'MF-RETRY-001',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: null,
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 2.0,
      totalAmount: 102.0
    }
  });
  testDb._store.orderItems.set('item-retry-1', { id: 'item-retry-1', orderId: 'ord-retry-test', medicineId: 'med-1', quantity: 2, unitPrice: 50.0, subtotal: 100.0 });
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-retry-test' }), createMockRes());
  const initialPendingPayment = await testDb.payment.findUnique({ where: { orderId: 'ord-retry-test' } });
  const initialGatewayOrderId = initialPendingPayment.gatewayOrderId;

  // Retry while PENDING
  const resRetryPending = createMockRes();
  await checkoutController.retryPayment(createMockReq({ orderId: 'ord-retry-test' }), resRetryPending);
  check('Retry on PENDING payment succeeds with 200', resRetryPending.statusCode === 200);
  check('Retry returns intent reused message', resRetryPending.body?.message?.includes('intent reused'));
  check('Retry preserves identical gatewayOrderId', resRetryPending.body?.payment?.gatewayOrderId === initialGatewayOrderId);

  // ─────────────────────────────────────────────────────────────────────────────
  // 9d. Confirmed Terminal Gateway Failure Followed by Safe Fee Reassignment
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9d: Confirmed Terminal Gateway Failure & Safe Fee Reassignment ---');
  await testDb.order.create({
    data: {
      id: 'ord-parent-fail',
      orderNumber: 'MF-PAR-FAIL',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: true,
      parentOrderId: null,
      status: 'PENDING',
      feeStatus: 'UNALLOCATED',
      feePayingChildOrderId: null
    }
  });
  await testDb.order.create({
    data: {
      id: 'ord-child-fail-A',
      orderNumber: 'MF-PAR-FAIL-A',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: 'ord-parent-fail',
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 60.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 60.0
    }
  });
  testDb._store.orderItems.set('item-fail-A', { id: 'item-fail-A', orderId: 'ord-child-fail-A', medicineId: 'med-1', quantity: 1, unitPrice: 60.0, subtotal: 60.0 });

  await testDb.order.create({
    data: {
      id: 'ord-child-fail-B',
      orderNumber: 'MF-PAR-FAIL-B',
      userId: 'patient-1',
      pharmacyId: 'ph-2',
      isParentOrder: false,
      parentOrderId: 'ord-parent-fail',
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 90.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 90.0
    }
  });
  testDb._store.orderItems.set('item-fail-B', { id: 'item-fail-B', orderId: 'ord-child-fail-B', medicineId: 'med-2', quantity: 1, unitPrice: 90.0, subtotal: 90.0 });

  // Child fail-A reserves fee
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-fail-A' }), createMockRes());
  // Gateway confirms terminal failure
  await testDb.payment.update({
    where: { orderId: 'ord-child-fail-A' },
    data: { status: 'FAILED', failureReason: 'Payment explicitly failed or cancelled by user at gateway' }
  });

  // Cancel child fail-A (now safe because gateway failure is terminal)
  const resCancelFailed = createMockRes();
  await orderController.updateOrderStatus(
    createMockReq({ id: 'ord-child-fail-A' }, { status: 'CANCELLED', comment: 'Terminal gateway failure confirmed' }),
    resCancelFailed
  );
  check('Cancellation of child with terminal failed payment succeeds with 200', resCancelFailed.statusCode === 200);

  const parentFailAfter = await testDb.order.findUnique({ where: { id: 'ord-parent-fail' } });
  check('Parent feeStatus safely transitioned to RELEASED', parentFailAfter.feeStatus === 'RELEASED');
  check('Parent feePayingChildOrderId preserved for historical audit', parentFailAfter.feePayingChildOrderId === 'ord-child-fail-A');

  // Child fail-B can now safely claim the released fee
  const resClaimB = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-child-fail-B' }), resClaimB);
  check('Child fail-B successfully claims fee (amount = ₹92.00)', resClaimB.body?.payment?.amount === 92.0);
  const parentFailReassigned = await testDb.order.findUnique({ where: { id: 'ord-parent-fail' } });
  check('Parent feeStatus is now RESERVED by Child fail-B', parentFailReassigned.feeStatus === 'RESERVED' && parentFailReassigned.feePayingChildOrderId === 'ord-child-fail-B');

  // ─────────────────────────────────────────────────────────────────────────────
  // 9e. Child A and Child B Concurrent Reservation Serialization [Hermetic Mock]
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9e: Concurrent Fee Reservation Serialization [Hermetic Mock] ---');
  // Note: True PostgreSQL concurrency is guarded via `SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`.
  // Here we verify serialized execution guarantees: under the row lock, the second transaction sees the first's reservation.
  await testDb.order.create({
    data: {
      id: 'ord-parent-conc',
      orderNumber: 'MF-PAR-CONC',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: true,
      parentOrderId: null,
      status: 'PENDING',
      feeStatus: 'UNALLOCATED',
      feePayingChildOrderId: null
    }
  });
  await testDb.order.create({
    data: {
      id: 'ord-child-conc-A',
      orderNumber: 'MF-PAR-CONC-A',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: 'ord-parent-conc',
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 100.0
    }
  });
  testDb._store.orderItems.set('item-conc-A', { id: 'item-conc-A', orderId: 'ord-child-conc-A', medicineId: 'med-1', quantity: 1, unitPrice: 100.0, subtotal: 100.0 });
  await testDb.order.create({
    data: {
      id: 'ord-child-conc-B',
      orderNumber: 'MF-PAR-CONC-B',
      userId: 'patient-1',
      pharmacyId: 'ph-2',
      isParentOrder: false,
      parentOrderId: 'ord-parent-conc',
      status: 'CONFIRMED',
      fulfillmentType: 'PICKUP',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 100.0
    }
  });
  testDb._store.orderItems.set('item-conc-B', { id: 'item-conc-B', orderId: 'ord-child-conc-B', medicineId: 'med-2', quantity: 1, unitPrice: 100.0, subtotal: 100.0 });

  const resConcA = createMockRes();
  const resConcB = createMockRes();
  await Promise.all([
    checkoutController.createPayment(createMockReq({ orderId: 'ord-child-conc-A' }), resConcA),
    checkoutController.createPayment(createMockReq({ orderId: 'ord-child-conc-B' }), resConcB)
  ]);

  const amounts = [resConcA.body?.payment?.amount, resConcB.body?.payment?.amount];
  check('Concurrent reservation results in exactly one child paying ₹102.0 and the other ₹100.0',
    amounts.includes(102.0) && amounts.includes(100.0)
  );
  const parentConc = await testDb.order.findUnique({ where: { id: 'ord-parent-conc' } });
  check('Parent feeStatus is RESERVED with single owner', parentConc.feeStatus === 'RESERVED');

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Counter Selection Alone Does Not Mark Fee as Paid
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 10: Counter Selection Preserves RESERVED State ---');
  await testDb.order.create({
    data: {
      id: 'ord-parent-3',
      orderNumber: 'MF-PAR-003',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: true,
      parentOrderId: null,
      status: 'PENDING',
      feeStatus: 'UNALLOCATED',
      feePayingChildOrderId: null
    }
  });
  await testDb.order.create({
    data: {
      id: 'ord-child-3A',
      orderNumber: 'MF-PAR-003-A',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: 'ord-parent-3',
      status: 'CONFIRMED',
      medicineSubtotal: 50.0,
      deliveryFee: 0.0,
      platformFee: 0.0,
      totalAmount: 50.0,
      verificationPin: '3333'
    }
  });
  testDb._store.orderItems.set('item-3A', { id: 'item-3A', orderId: 'ord-child-3A', medicineId: 'med-1', quantity: 1, unitPrice: 50.0, subtotal: 50.0 });

  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-child-3A' }, { fulfillmentType: 'PICKUP' }), createMockRes());

  // Patient selects Pay at Counter
  const res10Counter = createMockRes();
  await checkoutController.selectPayment(createMockReq({ orderId: 'ord-child-3A' }, { paymentMethod: 'COUNTER' }), res10Counter);

  check('Counter selection succeeds with 200', res10Counter.statusCode === 200);
  check('Counter payment record amount includes ₹2 fee (₹52.00)', res10Counter.body?.payment?.amount === 52.0);

  const p3Counter = await testDb.order.findUnique({ where: { id: 'ord-parent-3' } });
  check('Counter selection keeps feeStatus as RESERVED (not PAID)', p3Counter.feeStatus === 'RESERVED');
  check('Child payment status is PENDING (not yet paid at counter)', res10Counter.body?.payment?.status === 'PENDING');

  // Verify counter PIN handover event marks fee PAID
  const res10Pin = createMockRes();
  await orderController.verifyOrderPin(
    createMockReq({ id: 'ord-child-3A' }, { pin: '3333' }, { id: 'pharmacist-1', name: 'Pharmacist', role: 'PHARMACIST' }),
    res10Pin
  );
  check('Counter pickup PIN verification succeeds with 200', res10Pin.statusCode === 200);

  const p3AfterPickup = await testDb.order.findUnique({ where: { id: 'ord-parent-3' } });
  check('Counter pickup verification confirms feeStatus as PAID', p3AfterPickup.feeStatus === 'PAID');
  check('Counter payment record transitioned to PAID', (await testDb.payment.findUnique({ where: { orderId: 'ord-child-3A' } }))?.status === 'PAID');

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Pharmacist Listings Exclude Parent Aggregate Orders
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 11: Pharmacist Listing Isolation ---');
  // Pharmacist 1 manages ph-1. There are parent orders with pharmacyId: 'ph-1' in store!
  const res11Pharm = createMockRes();
  await orderController.getOrders(
    createMockReq({}, {}, { id: 'pharmacist-1', role: 'PHARMACIST' }),
    res11Pharm
  );

  check('getOrders for pharmacist succeeds with 200', res11Pharm.statusCode === 200);
  const pharmOrders = res11Pharm.body?.orders || [];
  const hasParentInListing = pharmOrders.some(o => o.isParentOrder === true);
  check('Pharmacist listing contains zero parent aggregate orders (isParentOrder === true)', !hasParentInListing);
  const hasChildInListing = pharmOrders.some(o => o.id === 'ord-child-A' || o.id === 'ord-standalone-1');
  check('Pharmacist listing preserves legitimate pharmacy fulfillment orders', hasChildInListing);

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Existing Single-Order Checkout/Payment Regression Still Works
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 12: Single-Order Regression Compatibility ---');
  const stdOrder2 = await testDb.order.create({
    data: {
      id: 'ord-std-2',
      orderNumber: 'MF-STD-002',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: null,
      status: 'CONFIRMED',
      medicineSubtotal: 150.0,
      deliveryFee: 0.0,
      platformFee: 2.0,
      totalAmount: 152.0
    }
  });
  testDb._store.orderItems.set('item-std-2', { id: 'item-std-2', orderId: 'ord-std-2', medicineId: 'med-1', quantity: 3, unitPrice: 50.0, subtotal: 150.0 });

  await checkoutController.selectFulfillment(createMockReq({ orderId: 'ord-std-2' }, { fulfillmentType: 'PICKUP' }), createMockRes());
  const res12Pay = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: 'ord-std-2' }), res12Pay);

  check('Single order payment creation succeeds with 200', res12Pay.statusCode === 200);
  check('Single order amount includes ₹2.00 fee (₹152.00)', res12Pay.body?.payment?.amount === 152.0);

  // Verify signature
  const rzpStdOrderId = res12Pay.body?.payment?.gatewayOrderId || 'rzp_std_order';
  const rzpStdPaymentId = 'pay_std_999';
  const stdSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${rzpStdOrderId}|${rzpStdPaymentId}`)
    .digest('hex');

  const res12Verify = createMockRes();
  await checkoutController.verifyPayment(
    createMockReq(
      { orderId: 'ord-std-2' },
      { razorpay_order_id: rzpStdOrderId, razorpay_payment_id: rzpStdPaymentId, razorpay_signature: stdSig }
    ),
    res12Verify
  );
  check('Single order payment verification succeeds with 200', res12Verify.statusCode === 200);
  check('Single order payment status is marked PAID', res12Verify.body?.payment?.status === 'PAID');

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. Cancellation/Rejection Inventory and Order-Status Regressions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 13: Cancellation/Rejection Inventory and Order-Status Regressions ---');
  // Stock restoration test
  const initialStock = (await testDb.inventory.findFirst({ where: { pharmacyId: 'ph-1', medicineId: 'med-1' } })).stock;
  await testDb.order.create({
    data: {
      id: 'ord-inv-regress',
      orderNumber: 'MF-INV-001',
      userId: 'patient-1',
      pharmacyId: 'ph-1',
      isParentOrder: false,
      parentOrderId: null,
      status: 'CONFIRMED',
      medicineSubtotal: 100.0,
      deliveryFee: 0.0,
      platformFee: 2.0,
      totalAmount: 102.0
    }
  });
  testDb._store.orderItems.set('item-inv-1', { id: 'item-inv-1', orderId: 'ord-inv-regress', medicineId: 'med-1', quantity: 5, unitPrice: 20.0, subtotal: 100.0 });
  await testDb.assistantTask.create({
    data: { orderId: 'ord-inv-regress', status: 'ASSIGNED', assistantId: null }
  });

  const res13Cancel = createMockRes();
  await orderController.updateOrderStatus(
    createMockReq({ id: 'ord-inv-regress' }, { status: 'CANCELLED', comment: 'Inventory regression test' }),
    res13Cancel
  );
  check('Cancellation of CONFIRMED order succeeds with 200', res13Cancel.statusCode === 200);
  const stockAfterCancel = (await testDb.inventory.findFirst({ where: { pharmacyId: 'ph-1', medicineId: 'med-1' } })).stock;
  check('Inventory stock incremented by restored item quantity (+5)', stockAfterCancel === initialStock + 5);
  const taskAfterCancel = await testDb.assistantTask.findUnique({ where: { orderId: 'ord-inv-regress' } });
  check('Associated assistant task status transitioned to CANCELLED', taskAfterCancel?.status === 'CANCELLED');

  // Rejection of already-PAID order is prohibited without prior refund
  const res13PaidReject = createMockRes();
  await orderController.updateOrderStatus(
    createMockReq({ id: 'ord-child-A' }, { status: 'CANCELLED', comment: 'Attempt cancel paid order' }),
    res13PaidReject
  );
  check('Cancellation of already-PAID order is rejected with 400', res13PaidReject.statusCode === 400);
  check('Rejection error indicates refund requirement before cancellation', res13PaidReject.body?.error?.includes('already been paid'));

  console.log('\n================================================================');
  console.log(`Gate 4.2.2.2 Test Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runFeeLedgerSuite().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
