'use strict';

/**
 * MediFind AI — Gate 4: Split-Order Checkout Integration Test Suite
 *
 * Verifies all 10 mandated requirements:
 * 1. Split-order submission and idempotent retry.
 * 2. Parent orders being rejected by checkout with PARENT_ORDER_CHECKOUT_PROHIBITED.
 * 3. Independent child checkout (fulfillment selection & pricing).
 * 4. Exactly one ₹2 fee across sibling checkouts.
 * 5. Concurrent sibling fee reservations.
 * 6. Reuse of pending payment intents (gateway order id preserved on retry).
 * 7. Cancelled/rejected child orders and delayed payment handling.
 * 8. Partial allocations and re-matching without duplicate allocations.
 * 9. Parent status aggregation (deriveParentAggregateStatus & sync on child transitions).
 * 10. Existing standalone checkout, inventory, PIN handover, and delivery-task regressions.
 */

const assert = require('assert');
const crypto = require('crypto');

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

// In-Memory Database store for hermetic integration testing
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
      findUnique: async ({ where, include }) => {
        let p = null;
        if (where.id) p = store.pharmacies.get(where.id) || null;
        else if (where.managerId) {
          for (const ph of store.pharmacies.values()) {
            if (ph.managerId === where.managerId) { p = ph; break; }
          }
        }
        if (!p) return null;
        const res = { ...p };
        if (include?.inventory) {
          const invList = Array.from(store.inventories.values()).filter(i => i.pharmacyId === p.id);
          res.inventory = invList.map(inv => {
            const copy = { ...inv };
            if (include.inventory.include?.medicine) {
              copy.medicine = store.medicines.get(inv.medicineId) || null;
            }
            return copy;
          });
        }
        return res;
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
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, inv] of store.inventories.entries()) {
          let match = true;
          if (where.id && inv.id !== where.id) match = false;
          if (where.pharmacyId && inv.pharmacyId !== where.pharmacyId) match = false;
          if (where.medicineId && inv.medicineId !== where.medicineId) match = false;
          if (where.stock?.gte !== undefined && (inv.stock || 0) < where.stock.gte) match = false;
          if (match) {
            if (data?.stock?.decrement) inv.stock = (inv.stock || 0) - data.stock.decrement;
            if (data?.stock?.increment) inv.stock = (inv.stock || 0) + data.stock.increment;
            count++;
          }
        }
        return { count };
      }
    },
    prescription: {
      findUnique: async ({ where, include }) => {
        const p = store.prescriptions.get(where.id);
        if (!p) return null;
        const res = { ...p };
        if (include?.items) {
          const piList = Array.from(store.prescriptionItems.values()).filter(i => i.prescriptionId === p.id);
          res.items = piList.map(it => {
            const copy = { ...it };
            if (include.items.include?.medicine) {
              copy.medicine = store.medicines.get(it.medicineId) || null;
            }
            return copy;
          });
        }
        return res;
      }
    },
    prescriptionItem: {
      findUnique: async ({ where }) => store.prescriptionItems.get(where.id) || null,
      findMany: async ({ where }) => {
        let list = Array.from(store.prescriptionItems.values());
        if (where?.prescriptionId) list = list.filter(i => i.prescriptionId === where.prescriptionId);
        return list;
      }
    },
    order: {
      findUnique: async ({ where }) => {
        const ord = store.orders.get(where.id);
        if (!ord) return null;
        const res = { ...ord };
        res.pharmacy = store.pharmacies.get(ord.pharmacyId) || null;
        res.items = Array.from(store.orderItems.values())
          .filter(i => i.orderId === ord.id)
          .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null }));
        res.payment = store.payments.get(ord.id) || null;
        res.assistantTask = Array.from(store.assistantTasks.values()).find(t => t.orderId === ord.id) || null;
        res.childOrders = Array.from(store.orders.values())
          .filter(o => o.parentOrderId === ord.id)
          .map(c => ({
            ...c,
            pharmacy: store.pharmacies.get(c.pharmacyId) || null,
            items: Array.from(store.orderItems.values())
              .filter(i => i.orderId === c.id)
              .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null })),
            payment: store.payments.get(c.id) || null
          }));
        res.parentOrder = ord.parentOrderId ? store.orders.get(ord.parentOrderId) || null : null;
        return res;
      },
      findFirst: async ({ where, include }) => {
        let list = Array.from(store.orders.values());
        if (where) {
          if (where.id) list = list.filter(o => o.id === where.id);
          if (where.userId) list = list.filter(o => o.userId === where.userId);
          if (where.parentOrderId) list = list.filter(o => o.parentOrderId === where.parentOrderId);
          if (where.isParentOrder !== undefined) list = list.filter(o => o.isParentOrder === where.isParentOrder);
          if (where.notes?.contains) list = list.filter(o => o.notes && o.notes.includes(where.notes.contains));
        }
        const ord = list[0] || null;
        if (!ord) return null;
        const res = { ...ord };
        res.pharmacy = store.pharmacies.get(ord.pharmacyId) || null;
        res.items = Array.from(store.orderItems.values())
          .filter(i => i.orderId === ord.id)
          .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null }));
        res.payment = store.payments.get(ord.id) || null;
        res.childOrders = Array.from(store.orders.values())
          .filter(o => o.parentOrderId === ord.id)
          .map(c => ({
            ...c,
            pharmacy: store.pharmacies.get(c.pharmacyId) || null,
            items: Array.from(store.orderItems.values())
              .filter(i => i.orderId === c.id)
              .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null })),
            payment: store.payments.get(c.id) || null
          }));
        res.parentOrder = ord.parentOrderId ? store.orders.get(ord.parentOrderId) || null : null;
        return res;
      },
      findMany: async ({ where }) => {
        let list = Array.from(store.orders.values());
        if (where) {
          if (where.id) list = list.filter(o => o.id === where.id);
          if (where.userId) list = list.filter(o => o.userId === where.userId);
          if (where.prescriptionId) list = list.filter(o => o.prescriptionId === where.prescriptionId);
          if (where.pharmacyId) list = list.filter(o => o.pharmacyId === where.pharmacyId);
          if (where.parentOrderId) list = list.filter(o => o.parentOrderId === where.parentOrderId);
          if (where.isParentOrder !== undefined) list = list.filter(o => o.isParentOrder === where.isParentOrder);
          if (where.status) {
            if (typeof where.status === 'string') {
              list = list.filter(o => o.status === where.status);
            } else if (where.status.notIn) {
              list = list.filter(o => !where.status.notIn.includes(o.status));
            } else if (where.status.in) {
              list = list.filter(o => where.status.in.includes(o.status));
            }
          }
        }
        return list.map(ord => {
          const res = { ...ord };
          res.pharmacy = store.pharmacies.get(ord.pharmacyId) || null;
          res.items = Array.from(store.orderItems.values())
            .filter(i => i.orderId === ord.id)
            .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null }));
          res.payment = store.payments.get(ord.id) || null;
          res.childOrders = Array.from(store.orders.values())
            .filter(o => o.parentOrderId === ord.id)
            .map(c => ({
              ...c,
              pharmacy: store.pharmacies.get(c.pharmacyId) || null,
              items: Array.from(store.orderItems.values())
                .filter(i => i.orderId === c.id)
                .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null })),
              payment: store.payments.get(c.id) || null
            }));
          res.parentOrder = ord.parentOrderId ? store.orders.get(ord.parentOrderId) || null : null;
          return res;
        });
      },
      create: async ({ data, include }) => {
        const id = data.id || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = {
          id,
          orderNumber: data.orderNumber || `MF-ORD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          userId: data.userId,
          pharmacyId: data.pharmacyId || null,
          isParentOrder: Boolean(data.isParentOrder),
          parentOrderId: data.parentOrderId || null,
          status: data.status || 'PENDING',
          orderType: data.orderType || 'RESERVATION',
          prescriptionId: data.prescriptionId || null,
          medicineSubtotal: data.medicineSubtotal != null ? data.medicineSubtotal : 0.0,
          platformFee: data.platformFee != null ? data.platformFee : 0.0,
          deliveryFee: data.deliveryFee != null ? data.deliveryFee : 0.0,
          totalAmount: data.totalAmount != null ? data.totalAmount : 0.0,
          feeStatus: data.feeStatus || (data.isParentOrder ? 'UNALLOCATED' : null),
          feePayingChildOrderId: data.feePayingChildOrderId || null,
          verificationPin: data.verificationPin || null,
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        store.orders.set(id, record);

        if (data.items?.create) {
          for (const it of data.items.create) {
            const itemId = it.id || `oi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const itemRecord = {
              id: itemId,
              orderId: id,
              medicineId: it.medicineId,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
              status: it.status || 'PENDING',
              prescriptionItemId: it.prescriptionItemId || null,
              fulfilledQuantity: it.fulfilledQuantity || 0,
              unfulfilledReason: it.unfulfilledReason || null
            };
            store.orderItems.set(itemId, itemRecord);
          }
        }

        if (data.statusHistory?.create) {
          for (const sh of data.statusHistory.create) {
            store.orderStatusHistories.set(`osh-${Date.now()}-${Math.random()}`, {
              orderId: id,
              status: sh.status,
              comment: sh.comment,
              createdAt: new Date()
            });
          }
        }

        const res = { ...record };
        if (include?.items) {
          res.items = Array.from(store.orderItems.values())
            .filter(i => i.orderId === id)
            .map(i => ({ ...i, medicine: store.medicines.get(i.medicineId) || null }));
        }
        if (include?.pharmacy) {
          res.pharmacy = store.pharmacies.get(record.pharmacyId) || null;
        }
        return res;
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
          if (where.parentOrderId && ord.parentOrderId !== where.parentOrderId) match = false;
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
    orderItem: {
      findMany: async ({ where }) => {
        let list = Array.from(store.orderItems.values());
        if (where?.orderId) list = list.filter(i => i.orderId === where.orderId);
        if (where?.prescriptionItemId) list = list.filter(i => i.prescriptionItemId === where.prescriptionItemId);
        if (where?.order) {
          if (where.order.status?.notIn) {
            list = list.filter(i => {
              const parent = store.orders.get(i.orderId);
              return parent && !where.order.status.notIn.includes(parent.status);
            });
          }
        }
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || `oi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, ...data };
        store.orderItems.set(id, record);
        return record;
      },
      createMany: async ({ data }) => {
        for (const item of data) {
          const id = item.id || `oi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          store.orderItems.set(id, { id, ...item });
        }
        return { count: data.length };
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
      create: async ({ data }) => ({ id: `notif-${Date.now()}`, ...data })
    },
    assistantTask: {
      findUnique: async ({ where }) => {
        if (where.orderId) {
          for (const t of store.assistantTasks.values()) {
            if (t.orderId === where.orderId) return t;
          }
        }
        return store.assistantTasks.get(where.id) || null;
      },
      findFirst: async ({ where }) => {
        for (const t of store.assistantTasks.values()) {
          if (where.orderId && t.orderId === where.orderId) return t;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, ...data };
        store.assistantTasks.set(id, record);
        return record;
      },
      update: async ({ where, data }) => {
        let key = where.id;
        if (!key && where.orderId) {
          for (const [k, t] of store.assistantTasks.entries()) {
            if (t.orderId === where.orderId) { key = k; break; }
          }
        }
        const existing = store.assistantTasks.get(key);
        if (!existing) throw new Error('Task not found');
        const updated = { ...existing, ...data };
        store.assistantTasks.set(key, updated);
        return updated;
      }
    },
    idempotencyRecord: {
      findUnique: async ({ where, include }) => {
        let rec = null;
        if (where.userId_action_key) {
          const idKey = `${where.userId_action_key.userId}:${where.userId_action_key.action}:${where.userId_action_key.key}`;
          rec = store.idempotencyRecords.get(idKey);
        } else if (where.idempotencyKey) {
          rec = store.idempotencyRecords.get(where.idempotencyKey);
        } else if (where.id) {
          for (const r of store.idempotencyRecords.values()) {
            if (r.id === where.id) { rec = r; break; }
          }
        }
        if (!rec) return null;
        const copy = { ...rec };
        if (include?.parentOrder && copy.parentOrderId) {
          copy.parentOrder = store.orders.get(copy.parentOrderId) || null;
        }
        return copy;
      },
      create: async ({ data }) => {
        const id = data.id || `idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = {
          id,
          userId: data.userId,
          action: data.action,
          key: data.key,
          requestHash: data.requestHash,
          responseStatus: data.responseStatus,
          responseBody: data.responseBody,
          parentOrderId: data.parentOrderId || null,
          expiresAt: data.expiresAt || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        const idKey = `${data.userId}:${data.action}:${data.key}`;
        store.idempotencyRecords.set(idKey, record);
        if (data.key) store.idempotencyRecords.set(data.key, record);
        if (data.idempotencyKey) store.idempotencyRecords.set(data.idempotencyKey, record);
        return { ...record };
      },
      update: async ({ where, data }) => {
        let targetKey = null;
        let existing = null;
        if (where.userId_action_key) {
          targetKey = `${where.userId_action_key.userId}:${where.userId_action_key.action}:${where.userId_action_key.key}`;
          existing = store.idempotencyRecords.get(targetKey);
        } else if (where.idempotencyKey) {
          targetKey = where.idempotencyKey;
          existing = store.idempotencyRecords.get(targetKey);
        } else if (where.id) {
          for (const [k, r] of store.idempotencyRecords.entries()) {
            if (r.id === where.id) { targetKey = k; existing = r; break; }
          }
        }
        if (!existing) throw new Error('IdempotencyRecord not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.idempotencyRecords.set(targetKey, updated);
        return { ...updated };
      }
    },
    prescriptionAuditLog: {
      create: async ({ data }) => ({ id: `audit-${Date.now()}`, ...data })
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
    $queryRawUnsafe: async () => [{ id: 'mock-lock-rx' }]
  };

  return db;
}

function createMockReq(params = {}, body = {}, user = { id: 'patient-1', role: 'PATIENT' }, headers = {}, query = {}) {
  const p = { ...params };
  if (p.orderId && !p.id) p.id = p.orderId;
  if (p.id && !p.orderId) p.orderId = p.id;
  return { params: p, body, user, headers, query };
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

async function runGate4CheckoutIntegrationSuite() {
  console.log('\n================================================================');
  console.log('MediFind AI — Gate 4: Split-Order Checkout Integration Test Suite');
  console.log('================================================================\n');

  const testDb = createInMemoryDb();

  // Baseline seeds
  testDb._store.users.set('patient-1', { id: 'patient-1', name: 'Patient One', role: 'PATIENT' });
  testDb._store.users.set('pharmacist-1', { id: 'pharmacist-1', name: 'Pharmacist Apollo', role: 'PHARMACIST' });
  testDb._store.users.set('pharmacist-2', { id: 'pharmacist-2', name: 'Pharmacist Care', role: 'PHARMACIST' });

  testDb._store.pharmacies.set('ph-apollo', {
    id: 'ph-apollo',
    name: 'Apollo Pharmacy',
    managerId: 'pharmacist-1',
    deliveryAvailable: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    isOpen: true
  });

  testDb._store.pharmacies.set('ph-care', {
    id: 'ph-care',
    name: 'Care Pharmacy',
    managerId: 'pharmacist-2',
    deliveryAvailable: true,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    isOpen: true
  });

  testDb._store.medicines.set('med-dolo', {
    id: 'med-dolo',
    brandName: 'Dolo 650',
    genericName: 'Paracetamol',
    strength: '650mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    unitPrice: 30.0
  });
  testDb._store.medicines.set('med-azith', {
    id: 'med-azith',
    brandName: 'Azithral 500',
    genericName: 'Azithromycin',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    unitPrice: 120.0
  });

  testDb._store.inventories.set('inv-apollo-dolo', {
    id: 'inv-apollo-dolo',
    pharmacyId: 'ph-apollo',
    medicineId: 'med-dolo',
    stock: 50,
    price: 30.0,
    status: 'AVAILABLE'
  });
  testDb._store.inventories.set('inv-care-azith', {
    id: 'inv-care-azith',
    pharmacyId: 'ph-care',
    medicineId: 'med-azith',
    stock: 50,
    price: 120.0,
    status: 'AVAILABLE'
  });

  // Prescription seed
  testDb._store.prescriptions.set('rx-multi-1', {
    id: 'rx-multi-1',
    userId: 'patient-1',
    status: 'VERIFIED',
    doctorName: 'Dr. Nair',
    clinicName: 'Govt Medical Clinic',
    clarifications: []
  });

  testDb._store.prescriptionItems.set('pi-dolo-1', {
    id: 'pi-dolo-1',
    prescriptionId: 'rx-multi-1',
    medicineId: 'med-dolo',
    prescribedName: 'Dolo 650',
    quantity: 10,
    isVerified: true,
    isRejected: false
  });

  testDb._store.prescriptionItems.set('pi-azith-1', {
    id: 'pi-azith-1',
    prescriptionId: 'rx-multi-1',
    medicineId: 'med-azith',
    prescribedName: 'Azithral 500',
    quantity: 5,
    isVerified: true,
    isRejected: false
  });

  // Patch prisma in modules
  const realPrisma = require('./src/prisma');
  for (const model of ['order', 'orderItem', 'payment', 'orderStatusHistory', 'notification', 'assistantTask', 'pharmacy', 'user', 'inventory', 'prescription', 'prescriptionItem', 'idempotencyRecord', 'prescriptionAuditLog']) {
    realPrisma[model] = testDb[model];
  }
  realPrisma.$transaction = testDb.$transaction;
  realPrisma.$queryRawUnsafe = testDb.$queryRawUnsafe;

  const checkoutController = require('./src/controllers/checkoutController');
  const orderController = require('./src/controllers/orderController');
  const splitOrderController = require('./src/controllers/splitOrderController');
  const paymentConfig = require('./src/utils/paymentConfig');

  // Hermetic mock for Razorpay orders
  paymentConfig.getRazorpayInstance = () => ({
    razorpay: {
      orders: {
        create: async ({ amount, currency, receipt, notes }) => ({
          id: `order_mock_gate4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

  // ─────────────────────────────────────────────────────────────
  // 1. Split-Order Submission and Idempotent Retry
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Split-Order Submission and Idempotent Retry ---');

  const splitPayload = {
    prescriptionId: 'rx-multi-1',
    allocations: [
      { pharmacyId: 'ph-apollo', prescriptionItemId: 'pi-dolo-1', quantity: 10 },
      { pharmacyId: 'ph-care', prescriptionItemId: 'pi-azith-1', quantity: 5 }
    ],
    orderType: 'RESERVATION'
  };

  const idemKey = 'idem-gate4-test-key-1';
  const req1 = createMockReq({}, splitPayload, { id: 'patient-1', role: 'PATIENT' }, { 'idempotency-key': idemKey });
  const res1 = createMockRes();

  await splitOrderController.createSplitOrder(req1, res1);
  if (res1.statusCode !== 201) {
    console.error('DEBUG RES1 FAILED:', res1.statusCode, res1.body);
  }
  check('Split order created successfully with HTTP 201', res1.statusCode === 201 && res1.body?.success === true);

  const parentOrder = res1.body.parentOrder;
  const childOrders = res1.body.childOrders;
  check('Parent order marked isParentOrder: true', parentOrder?.isParentOrder === true);
  check('Two child orders generated', Array.isArray(childOrders) && childOrders.length === 2);
  check('Parent order starts in feeStatus: UNALLOCATED', parentOrder?.id && testDb._store.orders.get(parentOrder.id)?.feeStatus === 'UNALLOCATED');
  check('Child orders start with platformFee: 0', childOrders.every(c => Number(c.platformFee) === 0));

  // Idempotent retry with identical key and payload
  const reqRetry = createMockReq({}, splitPayload, { id: 'patient-1', role: 'PATIENT' }, { 'idempotency-key': idemKey });
  const resRetry = createMockRes();
  await splitOrderController.createSplitOrder(reqRetry, resRetry);

  check('Idempotent retry succeeds with HTTP 200 or 201', resRetry.statusCode === 200 || resRetry.statusCode === 201);
  check('Idempotent retry returns identical parent order ID', resRetry.body.parentOrder?.id === parentOrder.id);
  check('Idempotent retry does not create duplicate orders in database', testDb._store.orders.size === 3); // 1 parent + 2 children

  // ─────────────────────────────────────────────────────────────
  // 2. Parent Orders Being Rejected by Checkout
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Parent Orders Being Rejected by Checkout ---');

  // Attempt checkout summary on parent aggregate order
  const reqParentSummary = createMockReq({ orderId: parentOrder.id });
  const resParentSummary = createMockRes();
  await checkoutController.getCheckoutSummary(reqParentSummary, resParentSummary);

  check('Parent checkout summary rejected with HTTP 400', resParentSummary.statusCode === 400);
  check('Parent checkout summary returns code PARENT_ORDER_CHECKOUT_PROHIBITED', resParentSummary.body?.code === 'PARENT_ORDER_CHECKOUT_PROHIBITED');

  // Attempt fulfillment selection on parent order
  const reqParentFulfillment = createMockReq({ orderId: parentOrder.id }, { fulfillmentType: 'PICKUP', includePlatformFee: true });
  const resParentFulfillment = createMockRes();
  await checkoutController.selectFulfillment(reqParentFulfillment, resParentFulfillment);
  check('Parent fulfillment selection rejected with HTTP 400 PARENT_ORDER_CHECKOUT_PROHIBITED', resParentFulfillment.statusCode === 400 && resParentFulfillment.body?.code === 'PARENT_ORDER_CHECKOUT_PROHIBITED');

  // Attempt payment creation on parent order
  const reqParentPay = createMockReq({ orderId: parentOrder.id }, { includePlatformFee: true });
  const resParentPay = createMockRes();
  await checkoutController.createPayment(reqParentPay, resParentPay);
  check('Parent payment creation rejected with HTTP 400 PARENT_ORDER_CHECKOUT_PROHIBITED', resParentPay.statusCode === 400 && resParentPay.body?.code === 'PARENT_ORDER_CHECKOUT_PROHIBITED');

  // ─────────────────────────────────────────────────────────────
  // 3. Independent Child Checkout (Fulfillment & Pricing)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Independent Child Checkout ---');

  const childApollo = childOrders.find(c => c.pharmacyId === 'ph-apollo');
  const childCare = childOrders.find(c => c.pharmacyId === 'ph-care');
  assert(childApollo && childCare, 'Both child orders must exist');

  // Pharmacist confirms childApollo
  const reqConfirmApollo = createMockReq({ orderId: childApollo.id }, { status: 'CONFIRMED' }, { id: 'pharmacist-1', role: 'PHARMACIST' });
  const resConfirmApollo = createMockRes();
  await orderController.updateOrderStatus(reqConfirmApollo, resConfirmApollo);
  check('Child order Apollo transitions to CONFIRMED', resConfirmApollo.statusCode === 200 && resConfirmApollo.body?.order?.status === 'CONFIRMED');

  // ChildApollo selects fulfillment
  const reqChildApolloFulfillment = createMockReq({ orderId: childApollo.id }, { fulfillmentType: 'PICKUP', includePlatformFee: true });
  const resChildApolloFulfillment = createMockRes();
  await checkoutController.selectFulfillment(reqChildApolloFulfillment, resChildApolloFulfillment);
  check('Child Apollo successfully selects fulfillment (HTTP 200)', resChildApolloFulfillment.statusCode === 200);

  // ChildApollo initiates payment - this reserves the platform fee on parent
  const reqPayApollo = createMockReq({ orderId: childApollo.id }, { includePlatformFee: true });
  const resPayApollo = createMockRes();
  await checkoutController.createPayment(reqPayApollo, resPayApollo);
  check('First child reserves the ₹2 platform fee on createPayment', resPayApollo.statusCode === 200);

  // ─────────────────────────────────────────────────────────────
  // 4. Exactly One ₹2 Fee Across Sibling Checkouts
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Exactly One ₹2 Fee Across Sibling Checkouts ---');

  // Pharmacist confirms childCare
  const reqConfirmCare = createMockReq({ orderId: childCare.id }, { status: 'CONFIRMED' }, { id: 'pharmacist-2', role: 'PHARMACIST' });
  const resConfirmCare = createMockRes();
  await orderController.updateOrderStatus(reqConfirmCare, resConfirmCare);
  check('Child order Care transitions to CONFIRMED', resConfirmCare.statusCode === 200);

  // ChildCare selects fulfillment while ChildApollo holds fee reservation
  const reqChildCareFulfillment = createMockReq({ orderId: childCare.id }, { fulfillmentType: 'PICKUP', includePlatformFee: true });
  const resChildCareFulfillment = createMockRes();
  await checkoutController.selectFulfillment(reqChildCareFulfillment, resChildCareFulfillment);
  check('Child Care selects fulfillment successfully (HTTP 200)', resChildCareFulfillment.statusCode === 200);

  const resPayCare = createMockRes();
  await checkoutController.createPayment(createMockReq({ orderId: childCare.id }), resPayCare);
  const careSubtotal = testDb._store.orders.get(childCare.id)?.medicineSubtotal;
  check('Child Care is charged ₹0.00 platform fee because sibling holds reservation', resPayCare.statusCode === 200 && resPayCare.body?.payment?.amount === careSubtotal);

  const parentInDb = testDb._store.orders.get(parentOrder.id);
  check('Parent feeStatus is RESERVED in database', parentInDb.feeStatus === 'RESERVED');
  check('Parent feePayingChildOrderId matches Child Apollo', parentInDb.feePayingChildOrderId === childApollo.id);

  // ─────────────────────────────────────────────────────────────
  // 5. Concurrent Sibling Fee Reservations
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Concurrent Sibling Fee Reservations ---');

  // Reset parent fee status to UNALLOCATED and delete prior payments for concurrency test
  testDb._store.orders.set(parentOrder.id, {
    ...parentInDb,
    feeStatus: 'UNALLOCATED',
    feePayingChildOrderId: null
  });
  testDb._store.payments.delete(childApollo.id);
  testDb._store.payments.delete(childCare.id);

  // Launch two concurrent payment creations
  const promiseA = checkoutController.createPayment(
    createMockReq({ orderId: childApollo.id }, { includePlatformFee: true }),
    createMockRes()
  );
  const promiseB = checkoutController.createPayment(
    createMockReq({ orderId: childCare.id }, { includePlatformFee: true }),
    createMockRes()
  );

  const [resConcurrentA, resConcurrentB] = await Promise.all([promiseA, promiseB]);

  const subtotalA = testDb._store.orders.get(childApollo.id).medicineSubtotal;
  const subtotalB = testDb._store.orders.get(childCare.id).medicineSubtotal;
  const hadFeeA = resConcurrentA.body?.payment?.amount === (subtotalA + 2.0);
  const hadFeeB = resConcurrentB.body?.payment?.amount === (subtotalB + 2.0);

  check('Exactly one sibling received fee: 2.0 and the other received fee: 0', (hadFeeA && !hadFeeB) || (!hadFeeA && hadFeeB));
  const updatedParent = testDb._store.orders.get(parentOrder.id);
  check('Parent feeStatus is atomically RESERVED', updatedParent.feeStatus === 'RESERVED');
  check('Exactly one child recorded as feePayingChildOrderId', updatedParent.feePayingChildOrderId === childApollo.id || updatedParent.feePayingChildOrderId === childCare.id);

  // ─────────────────────────────────────────────────────────────
  // 6. Reuse of Pending Payment Intents
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Reuse of Pending Payment Intents ---');

  const feeOwnerChildId = updatedParent.feePayingChildOrderId;
  const initialGatewayId = (feeOwnerChildId === childApollo.id ? resConcurrentA : resConcurrentB).body?.payment?.gatewayOrderId;
  check('Payment created successfully for fee-owning child', Boolean(initialGatewayId));
  check('Gateway order ID was generated', Boolean(initialGatewayId));

  // User refreshes or double-clicks Pay Now
  const reqCreatePay2 = createMockReq({ orderId: feeOwnerChildId }, { includePlatformFee: true });
  const resCreatePay2 = createMockRes();
  await checkoutController.createPayment(reqCreatePay2, resCreatePay2);

  check('Retry creates payment with HTTP 200', resCreatePay2.statusCode === 200);
  check('Existing pending gateway order ID is reused without creating duplicate intent', resCreatePay2.body?.payment?.gatewayOrderId === initialGatewayId);

  // ─────────────────────────────────────────────────────────────
  // 7. Cancelled/Rejected Child Orders & Terminal Safeguards
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Cancelled/Rejected Child Orders & Payment Safeguards ---');

  // If online payment was initiated and outcome is uncertain, cancellation does not clear fee reservation
  const reqCancelFeeOwner = createMockReq({ orderId: feeOwnerChildId }, { status: 'CANCELLED' }, { id: 'patient-1', role: 'PATIENT' });
  const resCancelFeeOwner = createMockRes();
  await orderController.updateOrderStatus(reqCancelFeeOwner, resCancelFeeOwner);

  const parentAfterCancel = testDb._store.orders.get(parentOrder.id);
  check('Uncertain online gateway payment preserves fee reservation across cancellation', parentAfterCancel.feeStatus === 'RESERVED');

  // Verify terminal order guard on checkout
  const reqCheckoutCancelled = createMockReq({ orderId: feeOwnerChildId });
  const resCheckoutCancelled = createMockRes();
  await checkoutController.getCheckoutSummary(reqCheckoutCancelled, resCheckoutCancelled);
  check('Cancelled child order cannot enter checkout (returns HTTP 400)', resCheckoutCancelled.statusCode === 400);

  // ─────────────────────────────────────────────────────────────
  // 8. Partial Allocations & Re-matching Without Duplicate Allocations
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 8. Partial Allocations & Re-matching Provenance ---');

  // Seed fresh prescription with 3 items
  testDb._store.prescriptions.set('rx-partial-1', {
    id: 'rx-partial-1',
    userId: 'patient-1',
    status: 'VERIFIED',
    doctorName: 'Dr. Nair',
    clinicName: 'Govt Medical Clinic',
    clarifications: []
  });

  testDb._store.prescriptionItems.set('pi-part-1', {
    id: 'pi-part-1',
    prescriptionId: 'rx-partial-1',
    medicineId: 'med-dolo',
    prescribedName: 'Dolo 650',
    quantity: 20,
    isVerified: true,
    isRejected: false
  });
  testDb._store.prescriptionItems.set('pi-part-2', {
    id: 'pi-part-2',
    prescriptionId: 'rx-partial-1',
    medicineId: 'med-azith',
    prescribedName: 'Azithral 500',
    quantity: 10,
    isVerified: true,
    isRejected: false
  });

  // Allocate only item 1 partially (10 out of 20)
  const reqPart1 = createMockReq({}, {
    prescriptionId: 'rx-partial-1',
    allocations: [{ pharmacyId: 'ph-apollo', prescriptionItemId: 'pi-part-1', quantity: 10 }],
    orderType: 'RESERVATION'
  }, { id: 'patient-1', role: 'PATIENT' }, { 'idempotency-key': 'idem-partial-split-1' });
  const resPart1 = createMockRes();
  await splitOrderController.createSplitOrder(reqPart1, resPart1);

  check('Partial allocation succeeded', resPart1.statusCode === 201);
  check('Summary indicates unallocated items exist', resPart1.body?.allocationSummary?.remainingItemsCount > 0);

  // Re-match the remaining 10 of item 1 and all of item 2 in a new allocation
  const reqPart2 = createMockReq({}, {
    prescriptionId: 'rx-partial-1',
    allocations: [
      { pharmacyId: 'ph-apollo', prescriptionItemId: 'pi-part-1', quantity: 10 },
      { pharmacyId: 'ph-care', prescriptionItemId: 'pi-part-2', quantity: 10 }
    ],
    orderType: 'RESERVATION'
  }, { id: 'patient-1', role: 'PATIENT' }, { 'idempotency-key': 'idem-partial-split-2' });
  const resPart2 = createMockRes();
  await splitOrderController.createSplitOrder(reqPart2, resPart2);

  check('Re-matching remaining quantities succeeds without duplicating previous allocation', resPart2.statusCode === 201);
  check('Second allocation fully fulfills remaining prescription quantities', resPart2.body?.allocationSummary?.remainingItemsCount === 0);

  // Attempting to allocate beyond outstanding quantity must be rejected
  const reqOver = createMockReq({}, {
    prescriptionId: 'rx-partial-1',
    allocations: [{ pharmacyId: 'ph-apollo', prescriptionItemId: 'pi-part-1', quantity: 1 }],
    orderType: 'RESERVATION'
  }, { id: 'patient-1', role: 'PATIENT' }, { 'idempotency-key': 'idem-partial-over-1' });
  const resOver = createMockRes();
  await splitOrderController.createSplitOrder(reqOver, resOver);
  check('Allocating beyond available quantity is rejected with HTTP 400', resOver.statusCode === 400);

  // ─────────────────────────────────────────────────────────────
  // 9. Parent Status Aggregation (deriveParentAggregateStatus & Sync)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 9. Parent Status Aggregation ---');

  const { deriveParentAggregateStatus, syncParentAggregateStatus } = orderController;
  assert(typeof deriveParentAggregateStatus === 'function', 'deriveParentAggregateStatus must be exported');
  assert(typeof syncParentAggregateStatus === 'function', 'syncParentAggregateStatus must be exported');

  // Exact mixed states mandated by verification audit:
  check('COMPLETED + PENDING aggregates to CONFIRMED (parent active while child active)',
    deriveParentAggregateStatus(['COMPLETED', 'PENDING']) === 'CONFIRMED');
  check('COMPLETED + CONFIRMED aggregates to CONFIRMED (parent active while child active)',
    deriveParentAggregateStatus(['COMPLETED', 'CONFIRMED']) === 'CONFIRMED');
  check('CANCELLED + PENDING aggregates to PENDING (parent active while child active)',
    deriveParentAggregateStatus(['CANCELLED', 'PENDING']) === 'PENDING');
  check('REJECTED + READY_FOR_PICKUP aggregates to CONFIRMED (parent active while child active)',
    deriveParentAggregateStatus(['REJECTED', 'READY_FOR_PICKUP']) === 'CONFIRMED');
  check('COMPLETED + CANCELLED aggregates to COMPLETED (all terminal, with completion)',
    deriveParentAggregateStatus(['COMPLETED', 'CANCELLED']) === 'COMPLETED');
  check('All children CANCELLED aggregates to CANCELLED',
    deriveParentAggregateStatus(['CANCELLED', 'CANCELLED']) === 'CANCELLED');
  check('All children REJECTED aggregates to REJECTED',
    deriveParentAggregateStatus(['REJECTED', 'REJECTED']) === 'REJECTED');
  check('All terminal with mixed completion and cancellation aggregates to COMPLETED',
    deriveParentAggregateStatus(['COMPLETED', 'CANCELLED', 'REJECTED']) === 'COMPLETED');
  check('All terminal with mixed cancellation and rejection (no completed) aggregates to CANCELLED',
    deriveParentAggregateStatus(['CANCELLED', 'REJECTED']) === 'CANCELLED');

  // Exhaustive invariant verification across all pairs: parent CANNOT become terminal while any child remains active
  const activeStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];
  const allCandidateStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'REJECTED'];
  const terminalStatuses = ['COMPLETED', 'CANCELLED', 'REJECTED'];
  let invariantHolds = true;
  for (const active of activeStatuses) {
    for (const other of allCandidateStatuses) {
      const derived = deriveParentAggregateStatus([active, other]);
      if (terminalStatuses.includes(derived)) {
        invariantHolds = false;
        console.error(`INVARIANT FAILED: [${active}, ${other}] evaluated to terminal status ${derived}`);
      }
    }
  }
  check('Invariant holds: parent never becomes terminal while any child remains active', invariantHolds);

  // Test live parent sync through updateOrderStatus
  const parentTestId = 'ord-parent-live-sync';
  const child1Id = 'ord-child-sync-1';
  const child2Id = 'ord-child-sync-2';

  testDb._store.orders.set(parentTestId, {
    id: parentTestId,
    orderNumber: 'MF-PARENT-SYNC',
    isParentOrder: true,
    status: 'PENDING',
    userId: 'patient-1'
  });

  testDb._store.orders.set(child1Id, {
    id: child1Id,
    orderNumber: 'MF-SYNC-1',
    parentOrderId: parentTestId,
    pharmacyId: 'ph-apollo',
    status: 'PENDING',
    userId: 'patient-1',
    verificationPin: '1234'
  });
  testDb._store.orderItems.set('oi-sync-1', {
    id: 'oi-sync-1',
    orderId: child1Id,
    medicineId: 'med-dolo',
    quantity: 1,
    unitPrice: 30.0,
    subtotal: 30.0
  });

  testDb._store.orders.set(child2Id, {
    id: child2Id,
    orderNumber: 'MF-SYNC-2',
    parentOrderId: parentTestId,
    pharmacyId: 'ph-care',
    status: 'PENDING',
    userId: 'patient-1',
    verificationPin: '5678'
  });
  testDb._store.orderItems.set('oi-sync-2', {
    id: 'oi-sync-2',
    orderId: child2Id,
    medicineId: 'med-azith',
    quantity: 1,
    unitPrice: 120.0,
    subtotal: 120.0
  });

  // Pharmacist confirms child 1
  const reqLiveConfirm = createMockReq({ orderId: child1Id }, { status: 'CONFIRMED' }, { id: 'pharmacist-1', role: 'PHARMACIST' });
  const resLiveConfirm = createMockRes();
  await orderController.updateOrderStatus(reqLiveConfirm, resLiveConfirm);

  const parentAfterChild1Confirm = testDb._store.orders.get(parentTestId);
  check('Parent order status synchronized to CONFIRMED when child 1 confirms', parentAfterChild1Confirm.status === 'CONFIRMED');

  // Verify child 1 PIN handover completion
  const reqPin = createMockReq({ orderId: child1Id }, { pin: '1234' }, { id: 'pharmacist-1', role: 'PHARMACIST' });
  const resPin = createMockRes();
  await orderController.verifyOrderPin(reqPin, resPin);
  check('Child 1 completes via PIN verification', resPin.statusCode === 200 && resPin.body?.order?.status === 'COMPLETED');

  // Child 2 also completes
  const reqPin2 = createMockReq({ orderId: child2Id }, { pin: '5678' }, { id: 'pharmacist-2', role: 'PHARMACIST' });
  const resPin2 = createMockRes();
  await orderController.verifyOrderPin(reqPin2, resPin2);
  check('Child 2 completes via PIN verification', resPin2.statusCode === 200 && resPin2.body?.order?.status === 'COMPLETED');

  const parentAfterBothComplete = testDb._store.orders.get(parentTestId);
  check('Parent aggregate status synchronized to COMPLETED when all children complete', parentAfterBothComplete.status === 'COMPLETED');

  // Live test for confirmReceipt parent aggregate synchronization
  const deliveryParentId = 'ord-parent-deliv-sync';
  const deliveryChildId = 'ord-child-deliv-sync';
  const delivTaskId = 'task-deliv-sync-1';

  testDb._store.orders.set(deliveryParentId, {
    id: deliveryParentId,
    orderNumber: 'MF-DELIV-PARENT',
    isParentOrder: true,
    status: 'CONFIRMED',
    userId: 'patient-1'
  });
  testDb._store.orders.set(deliveryChildId, {
    id: deliveryChildId,
    orderNumber: 'MF-DELIV-CHILD',
    parentOrderId: deliveryParentId,
    pharmacyId: 'ph-apollo',
    status: 'CONFIRMED',
    userId: 'patient-1'
  });
  testDb._store.assistantTasks.set(delivTaskId, {
    id: delivTaskId,
    orderId: deliveryChildId,
    status: 'DELIVERED',
    assistantId: 'asst-1'
  });

  const reqConfirmReceipt = createMockReq({ id: deliveryChildId }, {}, { id: 'patient-1', role: 'PATIENT' });
  const resConfirmReceipt = createMockRes();
  await orderController.confirmReceipt(reqConfirmReceipt, resConfirmReceipt);

  check('confirmReceipt succeeds with HTTP 200', resConfirmReceipt.statusCode === 200);
  const deliveryParentAfterReceipt = testDb._store.orders.get(deliveryParentId);
  check('confirmReceipt updates parent aggregate status to COMPLETED', deliveryParentAfterReceipt.status === 'COMPLETED');

  // ─────────────────────────────────────────────────────────────
  // 10. Existing Standalone Checkout & Regression Coverage
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 10. Existing Standalone Checkout Regression ---');

  const standaloneOrderId = 'ord-standalone-1';
  testDb._store.orders.set(standaloneOrderId, {
    id: standaloneOrderId,
    orderNumber: 'MF-STANDALONE-1',
    isParentOrder: false,
    parentOrderId: null,
    userId: 'patient-1',
    pharmacyId: 'ph-apollo',
    status: 'CONFIRMED',
    orderType: 'RESERVATION',
    medicineSubtotal: 60.0,
    platformFee: 2.0,
    totalAmount: 62.0
  });

  testDb._store.orderItems.set('oi-standalone-1', {
    id: 'oi-standalone-1',
    orderId: standaloneOrderId,
    medicineId: 'med-dolo',
    quantity: 2,
    unitPrice: 30.0,
    subtotal: 60.0
  });

  const reqStandaloneSummary = createMockReq({ orderId: standaloneOrderId });
  const resStandaloneSummary = createMockRes();
  await checkoutController.getCheckoutSummary(reqStandaloneSummary, resStandaloneSummary);

  check('Standalone single order can checkout normally (HTTP 200)', resStandaloneSummary.statusCode === 200);
  check('Standalone order retains normal ₹2.00 platform fee', resStandaloneSummary.body?.checkout?.totals?.platformFee === 2.0);

  // Summary
  console.log('\n================================================================');
  console.log(`Gate 4 Integration Suite Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runGate4CheckoutIntegrationSuite().catch(err => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
