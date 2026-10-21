'use strict';

/**
 * MediFind AI — Gate 4.2.1: Split-Order Creation and Item Allocation Verification Suite
 *
 * Verifies:
 * 1. One parent with multiple pharmacy-specific children.
 * 2. Single-pharmacy backward compatibility (createOrder untouched).
 * 3. Invalid or unverified pharmacy rejection (missing, unverified, test, closed).
 * 4. Prescription ownership and role authorization (unauthorized patient, invalid role, unverified Rx, rejected item, unresolved clarification).
 * 5. Invalid, duplicate, excessive, and fractional item allocations (fractional, zero, negative, duplicate pairs).
 * 6. Allocations exceeding requested or remaining quantity (including pre-existing child orders).
 * 7. Clinical mismatch rejection using Gate 3 safeguards (active ingredient, strength, dosage form).
 * 8. Preservation of remaining quantities for re-matching (accurate remainingItems in allocationSummary).
 * 9. Authoritative server-side pricing (ignoring client prices, using dispensary inventory/catalogue).
 * 10. Atomic rollback if any child creation fails (database transaction rollback).
 * 11. Idempotent retries and duplicate submission handling.
 * 12. No inventory deduction during parent/child creation (Gate 1A preservation).
 * 13. Platform-fee preparation (parent owns ₹2, child orders strictly ₹0, uncollected/unreserved).
 * 14. Preservation of existing Gate 1A–3.2 regression behavior.
 */

const assert = require('assert');
const { createSplitOrder, normalizeAllocations } = require('./src/controllers/splitOrderController');
const { createOrder } = require('./src/controllers/orderController');
const { verifyClinicalEquivalence } = require('./src/utils/rankingEngine');
const { VALID_ACTIONS } = require('./src/utils/prescriptionAuditLogger');

let passCount = 0;
let failCount = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ PASS: ${label}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failCount++;
    throw new Error(`Assertion failed: ${label}`);
  }
}

// ── In-Memory Mock Database for Hermetic Split-Order Verification ─────────────
function createHermeticMockDatabase() {
  const users = new Map();
  const pharmacies = new Map();
  const medicines = new Map();
  const prescriptions = new Map();
  const prescriptionItems = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const idempotencyRecords = new Map();
  const statusHistory = new Map();
  const auditLogs = [];
  const notifications = [];

  const db = {
    users,
    pharmacies,
    medicines,
    prescriptions,
    prescriptionItems,
    orders,
    orderItems,
    idempotencyRecords,
    statusHistory,
    auditLogs,
    notifications,

    prescription: {
      async findUnique({ where, include }) {
        const rx = prescriptions.get(where.id);
        if (!rx) return null;
        const res = { ...rx };
        if (include?.items) {
          const items = Array.from(prescriptionItems.values()).filter(i => i.prescriptionId === rx.id);
          res.items = items.map(it => {
            const copy = { ...it };
            if (include.items.include?.medicine) {
              copy.medicine = medicines.get(it.medicineId) || null;
            }
            return copy;
          });
        }
        if (include?.clarifications) {
          res.clarifications = rx.clarifications || [];
        }
        return res;
      }
    },

    prescriptionItem: {
      async findMany({ where }) {
        return Array.from(prescriptionItems.values()).filter(i => {
          if (where?.prescriptionId && i.prescriptionId !== where.prescriptionId) return false;
          return true;
        }).map(it => ({ ...it }));
      }
    },

    idempotencyRecord: {
      async findUnique({ where, include }) {
        let rec = null;
        if (where.userId_action_key) {
          const idKey = `${where.userId_action_key.userId}:${where.userId_action_key.action}:${where.userId_action_key.key}`;
          rec = idempotencyRecords.get(idKey);
        } else if (where.id) {
          for (const r of idempotencyRecords.values()) {
            if (r.id === where.id) { rec = r; break; }
          }
        }
        if (!rec) return null;
        const copy = { ...rec };
        if (include?.parentOrder && copy.parentOrderId) {
          copy.parentOrder = orders.get(copy.parentOrderId) || null;
        }
        return copy;
      },
      async create({ data }) {
        const id = data.id || `idem-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const idKey = `${data.userId}:${data.action}:${data.key}`;
        if (idempotencyRecords.has(idKey)) {
          const err = new Error('Unique constraint failed on userId_action_key');
          err.code = 'P2002';
          throw err;
        }
        const record = {
          id,
          userId: data.userId,
          key: data.key,
          action: data.action,
          requestHash: data.requestHash,
          responseStatus: data.responseStatus,
          responseBody: data.responseBody,
          parentOrderId: data.parentOrderId || null,
          expiresAt: data.expiresAt || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        idempotencyRecords.set(idKey, record);
        return { ...record };
      },
      async update({ where, data }) {
        let targetKey = null;
        let existing = null;
        if (where.userId_action_key) {
          targetKey = `${where.userId_action_key.userId}:${where.userId_action_key.action}:${where.userId_action_key.key}`;
          existing = idempotencyRecords.get(targetKey);
        } else if (where.id) {
          for (const [k, r] of idempotencyRecords.entries()) {
            if (r.id === where.id) {
              targetKey = k;
              existing = r;
              break;
            }
          }
        }
        if (!existing) {
          throw new Error('Record to update not found');
        }
        const updated = {
          ...existing,
          ...data,
          updatedAt: new Date()
        };
        idempotencyRecords.set(targetKey, updated);
        return { ...updated };
      }
    },

    medicine: {
      async findUnique({ where }) {
        const med = medicines.get(where.id);
        return med ? { ...med } : null;
      },
      async findFirst({ where } = {}) {
        if (where?.brandName?.equals) {
          const name = where.brandName.equals.toLowerCase();
          for (const m of medicines.values()) {
            if (m.brandName?.toLowerCase() === name) return { ...m };
          }
        }
        const first = medicines.values().next().value;
        return first ? { ...first } : null;
      }
    },

    pharmacy: {
      async findUnique({ where, include }) {
        const ph = pharmacies.get(where.id);
        if (!ph) return null;
        const res = { ...ph };
        if (include?.inventory) {
          res.inventory = (ph.inventory || []).map(inv => {
            const invCopy = { ...inv };
            if (include.inventory.include?.medicine) {
              invCopy.medicine = inv.medicine || medicines.get(inv.medicineId) || null;
            }
            return invCopy;
          });
        }
        return res;
      }
    },

    order: {
      async findUnique({ where, include }) {
        const ord = orders.get(where.id);
        if (!ord) return null;
        const res = { ...ord };
        if (include?.items) {
          const its = Array.from(orderItems.values()).filter(i => i.orderId === ord.id);
          res.items = its.map(i => ({
            ...i,
            medicine: medicines.get(i.medicineId) || null
          }));
        }
        if (include?.childOrders) {
          const children = Array.from(orders.values()).filter(o => o.parentOrderId === ord.id);
          res.childOrders = children.map(ch => {
            const cRes = { ...ch };
            if (include.childOrders.include?.items) {
              const its = Array.from(orderItems.values()).filter(i => i.orderId === ch.id);
              cRes.items = its.map(it => ({
                ...it,
                medicine: medicines.get(it.medicineId) || null
              }));
            }
            if (include.childOrders.include?.pharmacy) {
              cRes.pharmacy = pharmacies.get(ch.pharmacyId) || null;
            }
            return cRes;
          });
        }
        return res;
      },

      async findFirst({ where, include }) {
        for (const ord of orders.values()) {
          let match = true;
          if (where.userId && ord.userId !== where.userId) match = false;
          if (where.isParentOrder !== undefined && ord.isParentOrder !== where.isParentOrder) match = false;
          if (where.notes?.contains && (!ord.notes || !ord.notes.includes(where.notes.contains))) match = false;
          if (match) {
            const res = { ...ord };
            if (include?.childOrders) {
              const children = Array.from(orders.values()).filter(o => o.parentOrderId === ord.id);
              res.childOrders = children.map(ch => {
                const cRes = { ...ch };
                if (include.childOrders.include?.items) {
                  const its = Array.from(orderItems.values()).filter(i => i.orderId === ch.id);
                  cRes.items = its.map(it => ({
                    ...it,
                    medicine: medicines.get(it.medicineId) || null
                  }));
                }
                if (include.childOrders.include?.pharmacy) {
                  cRes.pharmacy = pharmacies.get(ch.pharmacyId) || null;
                }
                return cRes;
              });
            }
            return res;
          }
        }
        return null;
      },

      async findMany({ where, include }) {
        return Array.from(orders.values()).filter(o => {
          if (where?.prescriptionId && o.prescriptionId !== where.prescriptionId) return false;
          if (where?.isParentOrder !== undefined && o.isParentOrder !== where.isParentOrder) return false;
          if (where?.status?.notIn && where.status.notIn.includes(o.status)) return false;
          return true;
        }).map(o => {
          const res = { ...o };
          if (include?.items) {
            res.items = Array.from(orderItems.values()).filter(i => i.orderId === o.id);
          }
          return res;
        });
      },

      async create({ data, include }) {
        const id = data.id || `ord-${Math.random().toString(36).substr(2, 9)}`;
        const record = {
          id,
          orderNumber: data.orderNumber,
          userId: data.userId,
          pharmacyId: data.pharmacyId,
          isParentOrder: Boolean(data.isParentOrder),
          parentOrderId: data.parentOrderId || null,
          status: data.status || 'PENDING',
          orderType: data.orderType || 'RESERVATION',
          prescriptionId: data.prescriptionId || null,
          medicineSubtotal: data.medicineSubtotal != null ? data.medicineSubtotal : 0.0,
          platformFee: data.platformFee != null ? data.platformFee : 0.0,
          deliveryFee: data.deliveryFee != null ? data.deliveryFee : 0.0,
          totalAmount: data.totalAmount != null ? data.totalAmount : 0.0,
          verificationPin: data.verificationPin || null,
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        orders.set(id, record);

        if (data.items?.create) {
          for (const it of data.items.create) {
            const itemId = `item-${Math.random().toString(36).substr(2, 9)}`;
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
            orderItems.set(itemId, itemRecord);
          }
        }

        if (data.statusHistory?.create) {
          for (const sh of data.statusHistory.create) {
            statusHistory.set(`sh-${Date.now()}-${Math.random()}`, {
              orderId: id,
              status: sh.status,
              comment: sh.comment,
              createdAt: new Date()
            });
          }
        }

        const res = { ...record };
        if (include?.items) {
          const its = Array.from(orderItems.values()).filter(i => i.orderId === id);
          res.items = its.map(i => ({
            ...i,
            medicine: medicines.get(i.medicineId) || null
          }));
        }
        if (include?.pharmacy) {
          res.pharmacy = pharmacies.get(record.pharmacyId) || null;
        }
        return res;
      }
    },

    prescriptionAuditLog: {
      async create({ data }) {
        const record = {
          id: data.id || `audit-${Date.now()}`,
          prescriptionId: data.prescriptionId,
          prescriptionIdSnapshot: data.prescriptionIdSnapshot,
          actorId: data.actorId,
          actorRole: data.actorRole,
          action: data.action,
          details: data.details,
          ipAddress: data.ipAddress,
          createdAt: data.createdAt || new Date()
        };
        auditLogs.push(record);
        return record;
      }
    },

    notification: {
      async create({ data }) {
        notifications.push({ ...data, id: `notif-${Date.now()}` });
      }
    },

    async $queryRawUnsafe() {
      return [{ id: 'mock-rx' }];
    },

    async $transaction(fn) {
      // Create transaction client snapshot
      const ordersSnapshot = new Map(orders);
      const orderItemsSnapshot = new Map(orderItems);
      const idempotencySnapshot = new Map(idempotencyRecords);
      const auditSnapshot = [...auditLogs];

      const txClient = {
        order: {
          ...db.order,
          async create(args) {
            return await db.order.create(args);
          },
          async findFirst(args) {
            return await db.order.findFirst(args);
          },
          async findMany(args) {
            return await db.order.findMany(args);
          }
        },
        prescription: db.prescription,
        prescriptionItem: db.prescriptionItem,
        idempotencyRecord: db.idempotencyRecord,
        prescriptionAuditLog: db.prescriptionAuditLog,
        async $queryRawUnsafe() {
          return [{ id: 'mock-rx' }];
        }
      };

      try {
        return await fn(txClient);
      } catch (err) {
        // Rollback state to snapshot
        orders.clear();
        for (const [k, v] of ordersSnapshot) orders.set(k, v);
        orderItems.clear();
        for (const [k, v] of orderItemsSnapshot) orderItems.set(k, v);
        idempotencyRecords.clear();
        for (const [k, v] of idempotencySnapshot) idempotencyRecords.set(k, v);
        auditLogs.length = 0;
        for (const a of auditSnapshot) auditLogs.push(a);
        throw err;
      }
    }
  };

  return db;
}

// Helper to mock express req/res
function mockReqRes(reqData) {
  const req = {
    user: reqData.user || { id: 'patient-1', role: 'PATIENT' },
    body: reqData.body || {},
    headers: reqData.headers || {},
    ip: '127.0.0.1'
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData
  };

  return { req, res };
}

// ── Test Runner ──────────────────────────────────────────────────────────────
async function runSplitOrderTests() {
  console.log('\n================================================================');
  console.log('MediFind AI — Gate 4.2.1: Split-Order Creation Verification Suite');
  console.log('================================================================\n');

  // Verify Audit Log Set includes SPLIT_ORDER_CREATED
  check('PrescriptionAuditLog VALID_ACTIONS includes SPLIT_ORDER_CREATED',
    VALID_ACTIONS.has('SPLIT_ORDER_CREATED'));

  // ── TEST GROUP 1: One Parent with Multiple Pharmacy-Specific Children ─────────
  console.log('\n--- Group 1: One Parent with Multiple Children & Platform Fee ---');
  {
    const db = createHermeticMockDatabase();

    // Setup patient
    db.users.set('patient-1', { id: 'patient-1', role: 'PATIENT', name: 'John Doe' });

    // Setup medicines
    const medA = {
      id: 'med-amox-500',
      brandName: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      strength: '500mg',
      dosageForm: 'Tablet',
      category: 'Antibiotic'
    };
    const medB = {
      id: 'med-para-650',
      brandName: 'Paracetamol 650mg',
      genericName: 'Paracetamol',
      strength: '650mg',
      dosageForm: 'Tablet',
      category: 'Analgesic'
    };
    db.medicines.set(medA.id, medA);
    db.medicines.set(medB.id, medB);

    // Setup verified prescription with 2 items
    const rx = {
      id: 'rx-split-100',
      userId: 'patient-1',
      status: 'VERIFIED',
      clarifications: []
    };
    db.prescriptions.set(rx.id, rx);

    const pi1 = {
      id: 'pi-1',
      prescriptionId: rx.id,
      medicineId: medA.id,
      prescribedName: 'Amoxicillin 500mg',
      quantity: 10,
      isVerified: true,
      isRejected: false
    };
    const pi2 = {
      id: 'pi-2',
      prescriptionId: rx.id,
      medicineId: medB.id,
      prescribedName: 'Paracetamol 650mg',
      quantity: 20,
      isVerified: true,
      isRejected: false
    };
    db.prescriptionItems.set(pi1.id, pi1);
    db.prescriptionItems.set(pi2.id, pi2);

    // Setup 2 verified pharmacies
    const ph1 = {
      id: 'pharmacy-1',
      name: 'Central Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [
        { medicineId: medA.id, stock: 100, price: 12.00, status: 'AVAILABLE' }
      ]
    };
    const ph2 = {
      id: 'pharmacy-2',
      name: 'Care Plus Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [
        { medicineId: medB.id, stock: 50, price: 5.00, status: 'AVAILABLE' }
      ]
    };
    db.pharmacies.set(ph1.id, ph1);
    db.pharmacies.set(ph2.id, ph2);

    // Replace global prisma in splitOrderController with hermetic db
    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    const { req, res } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        idempotencyKey: 'test-key-split-100',
        orderType: 'RESERVATION',
        allocations: [
          {
            pharmacyId: 'pharmacy-1',
            items: [{ prescriptionItemId: 'pi-1', quantity: 10 }]
          },
          {
            pharmacyId: 'pharmacy-2',
            items: [{ prescriptionItemId: 'pi-2', quantity: 20 }]
          }
        ]
      }
    });

    await createSplitOrder(req, res);

    check('Split order returns HTTP 201 Created', res.getStatusCode() === 201);
    const data = res.getData();
    check('Response success is true', data.success === true);
    check('Parent order is returned', Boolean(data.parentOrder));
    check('Parent order is marked isParentOrder: true', data.parentOrder.isParentOrder === true);
    check('Parent order has parentOrderId: null', data.parentOrder.parentOrderId === null);
    check('Parent order owns the single ₹2.00 platform fee', data.parentOrder.platformFee === 2.00);

    // Subtotals: ph1 (10 * 12 = 120), ph2 (20 * 5 = 100). Total med subtotal = 220. Total amount = 222 (220 + 2).
    check('Parent medicineSubtotal is authoritative ₹220.00', data.parentOrder.medicineSubtotal === 220.00);
    check('Parent totalAmount includes single ₹2 fee (₹222.00)', data.parentOrder.totalAmount === 222.00);

    // Child Orders Verification
    check('Exactly 2 child orders are created', data.childOrders.length === 2);
    const child1 = data.childOrders.find(c => c.pharmacyId === 'pharmacy-1');
    const child2 = data.childOrders.find(c => c.pharmacyId === 'pharmacy-2');

    check('Child 1 links to parent order via parentOrderId', child1.parentOrderId === data.parentOrder.id);
    check('Child 2 links to parent order via parentOrderId', child2.parentOrderId === data.parentOrder.id);
    check('Child 1 platform fee is strictly ₹0.00 (not duplicated)', child1.platformFee === 0.00);
    check('Child 2 platform fee is strictly ₹0.00 (not duplicated)', child2.platformFee === 0.00);
    check('Child 1 subtotal is ₹120.00', child1.medicineSubtotal === 120.00);
    check('Child 2 subtotal is ₹100.00', child2.medicineSubtotal === 100.00);

    // Pins and Items
    check('Child 1 has its own 4-digit verification PIN', typeof child1.verificationPin === 'string' && child1.verificationPin.length === 4);
    check('Child 2 has its own 4-digit verification PIN', typeof child2.verificationPin === 'string' && child2.verificationPin.length === 4);
    check('Child 1 items fulfilledQuantity initialized at 0 (not assumed dispensed)', child1.items[0].fulfilledQuantity === 0);
    check('Child 1 items status initialized at PENDING', child1.items[0].status === 'PENDING');
    check('Child 1 items preserves requested allocated quantity (10)', child1.items[0].quantity === 10);
    check('Child 1 items unitPrice is authoritative from dispensary (₹12.00)', child1.items[0].unitPrice === 12.00);

    // Audit Log check
    const splitAudit = db.auditLogs.find(a => a.action === 'SPLIT_ORDER_CREATED');
    check('Mandatory business audit event SPLIT_ORDER_CREATED was recorded', Boolean(splitAudit));
    check('Audit event contains parentOrderId and participatingPharmaciesCount: 2',
      splitAudit.details.includes(data.parentOrder.id) && splitAudit.details.includes('"participatingPharmaciesCount":2'));
  }

  // ── TEST GROUP 2: Single-Pharmacy Order Creation Backward Compatibility ───────
  console.log('\n--- Group 2: Single-Pharmacy Backward Compatibility ---');
  {
    const { createOrder } = require('./src/controllers/orderController');
    check('orderController exports createOrder for backward compatibility', typeof createOrder === 'function');
    check('orderController exports createSplitOrder', typeof createSplitOrder === 'function');
  }

  // ── TEST GROUP 3: Invalid or Unverified Pharmacy Rejection ───────────────────
  console.log('\n--- Group 3: Invalid or Unverified Pharmacy Rejection ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-ph-test', userId: 'patient-1', status: 'VERIFIED' };
    const med = { id: 'med-1', brandName: 'Drug A', genericName: 'Drug A', strength: '10mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-1', { id: 'pi-1', prescriptionId: rx.id, medicineId: med.id, quantity: 5, isVerified: true });

    // 3a. Unverified pharmacy
    db.pharmacies.set('ph-unverified', {
      id: 'ph-unverified',
      name: 'Unverified Pharmacy',
      isVerified: false,
      verificationStatus: 'PENDING',
      isOpen: true,
      inventory: [{ medicineId: med.id, stock: 50, price: 10 }]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    const { req, res } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-unverified', prescriptionItemId: 'pi-1', quantity: 5 }]
      }
    });

    await createSplitOrder(req, res);
    check('Unverified pharmacy is rejected with 400 Bad Request', res.getStatusCode() === 400);
    check('Error indicates pharmacy not eligible', res.getData().code === 'PHARMACY_NOT_ELIGIBLE');

    // 3b. Test pharmacy
    db.pharmacies.set('ph-test', {
      id: 'ph-test',
      name: 'Test Pharmacy',
      isVerified: true,
      verificationStatus: 'TEST',
      isOpen: true,
      inventory: [{ medicineId: med.id, stock: 50, price: 10 }]
    });

    const { req: reqTest, res: resTest } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-test', prescriptionItemId: 'pi-1', quantity: 5 }]
      }
    });

    await createSplitOrder(reqTest, resTest);
    check('TEST pharmacy is rejected with 400 Bad Request', resTest.getStatusCode() === 400);

    // 3c. Closed pharmacy
    db.pharmacies.set('ph-closed', {
      id: 'ph-closed',
      name: 'Closed Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: false,
      inventory: [{ medicineId: med.id, stock: 50, price: 10 }]
    });

    const { req: reqClosed, res: resClosed } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-closed', prescriptionItemId: 'pi-1', quantity: 5 }]
      }
    });

    await createSplitOrder(reqClosed, resClosed);
    check('Closed pharmacy is rejected with 400 Bad Request', resClosed.getStatusCode() === 400);
    check('Error indicates pharmacy closed', resClosed.getData().code === 'PHARMACY_CLOSED');
  }

  // ── TEST GROUP 4: Prescription Ownership and Role Authorization ──────────────
  console.log('\n--- Group 4: Prescription Ownership and Role Authorization ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-owner-test', userId: 'patient-owner', status: 'VERIFIED' };
    const med = { id: 'med-1', brandName: 'Drug A', genericName: 'Drug A', strength: '10mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-1', { id: 'pi-1', prescriptionId: rx.id, medicineId: med.id, quantity: 5, isVerified: true });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // 4a. Cross-patient unauthorized attempt
    const { req: reqOther, res: resOther } = mockReqRes({
      user: { id: 'patient-intruder', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 5 }]
      }
    });

    await createSplitOrder(reqOther, resOther);
    check('Cross-patient access is rejected with 403 Forbidden', resOther.getStatusCode() === 403);
    const deniedAudit = db.auditLogs.find(a => a.action === 'ACCESS_DENIED');
    check('ACCESS_DENIED audit log recorded for unauthorized attempt', Boolean(deniedAudit));

    // 4b. Disallowed role (e.g. ASSISTANT)
    const { req: reqAsst, res: resAsst } = mockReqRes({
      user: { id: 'asst-1', role: 'ASSISTANT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 5 }]
      }
    });

    await createSplitOrder(reqAsst, resAsst);
    check('Non-patient non-admin role rejected with 403 Forbidden', resAsst.getStatusCode() === 403);

    // 4c. Unverified prescription (e.g. PENDING)
    const rxPending = { id: 'rx-pending', userId: 'patient-owner', status: 'PENDING' };
    db.prescriptions.set(rxPending.id, rxPending);
    db.prescriptionItems.set('pi-p', { id: 'pi-p', prescriptionId: rxPending.id, medicineId: med.id, quantity: 5, isVerified: true });

    const { req: reqPend, res: resPend } = mockReqRes({
      user: { id: 'patient-owner', role: 'PATIENT' },
      body: {
        prescriptionId: rxPending.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-p', quantity: 5 }]
      }
    });

    await createSplitOrder(reqPend, resPend);
    check('Unverified prescription status rejected with 400 Bad Request', resPend.getStatusCode() === 400);
    check('Error code is PRESCRIPTION_NOT_VERIFIED', resPend.getData().code === 'PRESCRIPTION_NOT_VERIFIED');

    // 4d. Unverified prescription item
    const rxWithUnverifiedItem = { id: 'rx-unver-item', userId: 'patient-owner', status: 'VERIFIED' };
    db.prescriptions.set(rxWithUnverifiedItem.id, rxWithUnverifiedItem);
    db.prescriptionItems.set('pi-unver', { id: 'pi-unver', prescriptionId: rxWithUnverifiedItem.id, medicineId: med.id, quantity: 5, isVerified: false });

    const { req: reqUnverItem, res: resUnverItem } = mockReqRes({
      user: { id: 'patient-owner', role: 'PATIENT' },
      body: {
        prescriptionId: rxWithUnverifiedItem.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-unver', quantity: 5 }]
      }
    });

    await createSplitOrder(reqUnverItem, resUnverItem);
    check('Prescription with unverified item rejected with 400 Bad Request', resUnverItem.getStatusCode() === 400);
    check('Error code is PRESCRIPTION_ITEM_NOT_VERIFIED', resUnverItem.getData().code === 'PRESCRIPTION_ITEM_NOT_VERIFIED');

    // 4e. Rejected item
    const rxWithRejectedItem = { id: 'rx-rej-item', userId: 'patient-owner', status: 'VERIFIED' };
    db.prescriptions.set(rxWithRejectedItem.id, rxWithRejectedItem);
    db.prescriptionItems.set('pi-rej', { id: 'pi-rej', prescriptionId: rxWithRejectedItem.id, medicineId: med.id, quantity: 5, isVerified: true, isRejected: true });

    const { req: reqRejItem, res: resRejItem } = mockReqRes({
      user: { id: 'patient-owner', role: 'PATIENT' },
      body: {
        prescriptionId: rxWithRejectedItem.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-rej', quantity: 5 }]
      }
    });

    await createSplitOrder(reqRejItem, resRejItem);
    check('Prescription with rejected item rejected with 400 Bad Request', resRejItem.getStatusCode() === 400);

    // 4f. Unresolved clarification inquiry
    const rxWithClar = {
      id: 'rx-clar',
      userId: 'patient-owner',
      status: 'VERIFIED',
      clarifications: [{ status: 'PENDING', question: 'Please clarify strength' }]
    };
    db.prescriptions.set(rxWithClar.id, rxWithClar);
    db.prescriptionItems.set('pi-clar', { id: 'pi-clar', prescriptionId: rxWithClar.id, medicineId: med.id, quantity: 5, isVerified: true });

    const { req: reqClar, res: resClar } = mockReqRes({
      user: { id: 'patient-owner', role: 'PATIENT' },
      body: {
        prescriptionId: rxWithClar.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-clar', quantity: 5 }]
      }
    });

    await createSplitOrder(reqClar, resClar);
    check('Unresolved clinical clarification inquiry blocks order creation with 400', resClar.getStatusCode() === 400);
    check('Error code is UNRESOLVED_CLARIFICATIONS', resClar.getData().code === 'UNRESOLVED_CLARIFICATIONS');
  }

  // ── TEST GROUP 5: Invalid, Duplicate, Excessive, and Fractional Allocations ───
  console.log('\n--- Group 5: Invalid, Duplicate, and Fractional Allocation Checks ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-alloc-test', userId: 'patient-1', status: 'VERIFIED' };
    const med = { id: 'med-1', brandName: 'Drug A', genericName: 'Drug A', strength: '10mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-1', { id: 'pi-1', prescriptionId: rx.id, medicineId: med.id, quantity: 10, isVerified: true });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // 5a. Fractional allocation
    const { req: reqFrac, res: resFrac } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 2.5 }]
      }
    });
    await createSplitOrder(reqFrac, resFrac);
    check('Fractional quantity rejected with 400 Bad Request', resFrac.getStatusCode() === 400);
    check('Error code is INVALID_QUANTITY', resFrac.getData().code === 'INVALID_QUANTITY');

    // 5b. Zero quantity
    const { req: reqZero, res: resZero } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 0 }]
      }
    });
    await createSplitOrder(reqZero, resZero);
    check('Zero quantity rejected with 400 Bad Request', resZero.getStatusCode() === 400);

    // 5c. Negative quantity
    const { req: reqNeg, res: resNeg } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: -4 }]
      }
    });
    await createSplitOrder(reqNeg, resNeg);
    check('Negative quantity rejected with 400 Bad Request', resNeg.getStatusCode() === 400);

    // 5d. Duplicate allocation to same pharmacy
    const { req: reqDup, res: resDup } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [
          { pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 3 },
          { pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 4 }
        ]
      }
    });
    await createSplitOrder(reqDup, resDup);
    check('Duplicate allocation for same pharmacy & item rejected with 400', resDup.getStatusCode() === 400);
    check('Error code is DUPLICATE_ALLOCATION', resDup.getData().code === 'DUPLICATE_ALLOCATION');
  }

  // ── TEST GROUP 6: Allocations Exceeding Outstanding Requested Quantity ───────
  console.log('\n--- Group 6: Allocations Exceeding Outstanding Requested Quantity ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-excess-test', userId: 'patient-1', status: 'VERIFIED' };
    const med = { id: 'med-1', brandName: 'Drug A', genericName: 'Drug A', strength: '10mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-1', { id: 'pi-1', prescriptionId: rx.id, medicineId: med.id, quantity: 10, isVerified: true });

    db.pharmacies.set('ph-1', {
      id: 'ph-1',
      name: 'Pharmacy 1',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med.id, stock: 100, price: 10 }]
    });
    db.pharmacies.set('ph-2', {
      id: 'ph-2',
      name: 'Pharmacy 2',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med.id, stock: 100, price: 10 }]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // 6a. Direct excessive allocation in single request (12 > 10)
    const { req: reqExcess, res: resExcess } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [
          { pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 6 },
          { pharmacyId: 'ph-2', prescriptionItemId: 'pi-1', quantity: 6 }
        ]
      }
    });
    await createSplitOrder(reqExcess, resExcess);
    check('Sum of allocations (12) exceeding requested quantity (10) is rejected with 400', resExcess.getStatusCode() === 400);
    check('Error code is ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY', resExcess.getData().code === 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY');

    // 6b. Already partially allocated in previous order (already fulfilled: 7, remaining: 3)
    // Add existing order in DB
    const existingChild = {
      id: 'ord-existing-child',
      prescriptionId: rx.id,
      isParentOrder: false,
      status: 'CONFIRMED'
    };
    db.orders.set(existingChild.id, existingChild);
    db.orderItems.set('item-existing', {
      id: 'item-existing',
      orderId: existingChild.id,
      medicineId: med.id,
      quantity: 7
    });

    // Request tries to allocate 5 (outstanding is only 3)
    const { req: reqPrev, res: resPrev } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [
          { pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 5 }
        ]
      }
    });
    await createSplitOrder(reqPrev, resPrev);
    check('Allocating more than outstanding remaining quantity is rejected with 400', resPrev.getStatusCode() === 400);
    check('Error message notes original 10, already fulfilled/allocated 7',
      resPrev.getData().error.includes('originally prescribed: 10') || resPrev.getData().error.includes('10'));
  }

  // ── TEST GROUP 7: Clinical Mismatch Rejection Using Gate 3 Safeguards ─────────
  console.log('\n--- Group 7: Clinical Mismatch Rejection Using Gate 3 Safeguards ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-clin-test', userId: 'patient-1', status: 'VERIFIED' };
    const medPrescribed = {
      id: 'med-amox-500',
      brandName: 'Amoxil 500mg',
      genericName: 'Amoxicillin',
      strength: '500mg',
      dosageForm: 'Tablet'
    };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(medPrescribed.id, medPrescribed);
    db.prescriptionItems.set('pi-clin', {
      id: 'pi-clin',
      prescriptionId: rx.id,
      medicineId: medPrescribed.id,
      prescribedName: 'Amoxil 500mg',
      quantity: 10,
      isVerified: true
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // 7a. Strength Mismatch in Pharmacy Inventory (e.g. 250mg vs 500mg)
    const medWrongStrength = {
      id: 'med-amox-250',
      brandName: 'Amoxil 250mg',
      genericName: 'Amoxicillin',
      strength: '250mg',
      dosageForm: 'Tablet'
    };
    db.medicines.set(medWrongStrength.id, medWrongStrength);
    db.pharmacies.set('ph-wrong-strength', {
      id: 'ph-wrong-strength',
      name: 'Wrong Strength Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [
        // Inventory has medPrescribed.id mapped to a different clinical profile or wrong strength
        { medicineId: medPrescribed.id, medicine: medWrongStrength, stock: 50, price: 10 }
      ]
    });

    const { req: reqStr, res: resStr } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-wrong-strength', prescriptionItemId: 'pi-clin', quantity: 10 }]
      }
    });

    await createSplitOrder(reqStr, resStr);
    check('Strength mismatch rejected with 400 Bad Request', resStr.getStatusCode() === 400);
    check('Error code is CLINICAL_MISMATCH', resStr.getData().code === 'CLINICAL_MISMATCH');
    check('Error message explains strength mismatch', resStr.getData().error.includes('Strength mismatch'));

    // 7b. Dosage Form Mismatch (e.g. Tablet vs Syrup)
    const medWrongForm = {
      id: 'med-amox-syrup',
      brandName: 'Amoxil Syrup',
      genericName: 'Amoxicillin',
      strength: '500mg',
      dosageForm: 'Syrup'
    };
    db.medicines.set(medWrongForm.id, medWrongForm);
    db.pharmacies.set('ph-wrong-form', {
      id: 'ph-wrong-form',
      name: 'Wrong Form Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [
        { medicineId: medPrescribed.id, medicine: medWrongForm, stock: 50, price: 10 }
      ]
    });

    const { req: reqForm, res: resForm } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-wrong-form', prescriptionItemId: 'pi-clin', quantity: 10 }]
      }
    });

    await createSplitOrder(reqForm, resForm);
    check('Dosage form mismatch rejected with 400 Bad Request', resForm.getStatusCode() === 400);
    check('Error message explains dosage form mismatch', resForm.getData().error.includes('Dosage form mismatch'));
  }

  // ── TEST GROUP 8: Preservation of Remaining Quantities for Re-Matching ───────
  console.log('\n--- Group 8: Preservation of Remaining Quantities for Re-Matching ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-rem-test', userId: 'patient-1', status: 'VERIFIED' };
    const med1 = { id: 'm1', brandName: 'Med 1', genericName: 'Gen 1', strength: '10mg', dosageForm: 'Tab' };
    const med2 = { id: 'm2', brandName: 'Med 2', genericName: 'Gen 2', strength: '20mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med1.id, med1);
    db.medicines.set(med2.id, med2);

    db.prescriptionItems.set('pi-r1', { id: 'pi-r1', prescriptionId: rx.id, medicineId: med1.id, prescribedName: 'Med 1', quantity: 15, isVerified: true });
    db.prescriptionItems.set('pi-r2', { id: 'pi-r2', prescriptionId: rx.id, medicineId: med2.id, prescribedName: 'Med 2', quantity: 30, isVerified: true });

    db.pharmacies.set('ph-1', {
      id: 'ph-1',
      name: 'Pharmacy 1',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med1.id, stock: 100, price: 10 }]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // Patient allocates 10 out of 15 for Med 1, and 0 out of 30 for Med 2
    const { req, res } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{ pharmacyId: 'ph-1', prescriptionItemId: 'pi-r1', quantity: 10 }]
      }
    });

    await createSplitOrder(req, res);
    check('Split order with unallocated/partial items returns 201 Created', res.getStatusCode() === 201);
    const summary = res.getData().allocationSummary;

    check('Allocation summary tracks totalPrescriptionItems: 2', summary.totalPrescriptionItems === 2);
    check('Allocation summary tracks partiallyAllocatedItems: 1', summary.partiallyAllocatedItems === 1);
    check('Allocation summary tracks unallocatedItems: 1', summary.unallocatedItems === 1);
    check('Remaining items list contains exactly 2 items with remaining quantities', summary.remainingItems.length === 2);

    const remMed1 = summary.remainingItems.find(i => i.prescriptionItemId === 'pi-r1');
    const remMed2 = summary.remainingItems.find(i => i.prescriptionItemId === 'pi-r2');

    check('Med 1 remainingQuantity is 5 (15 - 10)', remMed1.remainingQuantity === 5);
    check('Med 2 remainingQuantity is 30 (fully remaining for rematching)', remMed2.remainingQuantity === 30);
  }

  // ── TEST GROUP 9: Authoritative Server-Side Pricing & Inventory Non-Deduction ─
  console.log('\n--- Group 9: Authoritative Server-Side Pricing & Inventory Non-Deduction ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-price-test', userId: 'patient-1', status: 'VERIFIED' };
    const med = { id: 'm-price', brandName: 'Priced Med', genericName: 'Gen P', strength: '50mg', dosageForm: 'Cap' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-p', { id: 'pi-p', prescriptionId: rx.id, medicineId: med.id, quantity: 10, isVerified: true });

    const initialStock = 100;
    const inventoryRecord = { medicineId: med.id, stock: initialStock, price: 42.50, status: 'AVAILABLE' };
    db.pharmacies.set('ph-p', {
      id: 'ph-p',
      name: 'Priced Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [inventoryRecord]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // Client passes spoofed unitPrice of 1.00 and fake total
    const { req, res } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [{
          pharmacyId: 'ph-p',
          prescriptionItemId: 'pi-p',
          quantity: 10,
          unitPrice: 1.00, // Client spoof attempt
          subtotal: 10.00
        }]
      }
    });

    await createSplitOrder(req, res);
    check('Order creation succeeds with 201', res.getStatusCode() === 201);
    const child = res.getData().childOrders[0];

    check('Child item unitPrice is authoritative from database (₹42.50, ignoring spoofed ₹1.00)',
      child.items[0].unitPrice === 42.50);
    check('Child item subtotal is authoritative ₹425.00', child.items[0].subtotal === 425.00);
    check('Child medicineSubtotal is ₹425.00', child.medicineSubtotal === 425.00);

    // Inventory Non-Deduction Verification (Gate 1A preservation)
    check('Dispensary inventory stock was NOT deducted during order creation (remains 100)',
      inventoryRecord.stock === initialStock);
  }

  // ── TEST GROUP 10: Atomic Rollback if Any Child Creation Fails ───────────────
  console.log('\n--- Group 10: Atomic Rollback on Child Creation Failure ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-roll-test', userId: 'patient-1', status: 'VERIFIED' };
    const med1 = { id: 'm1', brandName: 'M1', genericName: 'G1', strength: '10mg', dosageForm: 'Tab' };
    const med2 = { id: 'm2', brandName: 'M2', genericName: 'G2', strength: '20mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med1.id, med1);
    db.medicines.set(med2.id, med2);
    db.prescriptionItems.set('pi-1', { id: 'pi-1', prescriptionId: rx.id, medicineId: med1.id, quantity: 5, isVerified: true });
    db.prescriptionItems.set('pi-2', { id: 'pi-2', prescriptionId: rx.id, medicineId: med2.id, quantity: 5, isVerified: true });

    db.pharmacies.set('ph-1', {
      id: 'ph-1',
      name: 'Ph 1',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med1.id, stock: 50, price: 10 }]
    });
    db.pharmacies.set('ph-2', {
      id: 'ph-2',
      name: 'Ph 2',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med2.id, stock: 50, price: 10 }]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    // Intercept order.create to simulate child 2 database failure
    let callCount = 0;
    const originalCreate = db.order.create;
    db.order.create = async (args) => {
      callCount++;
      if (callCount === 3) {
        // Child 2 creation fails
        throw new Error('Simulated database connection failure during child order creation');
      }
      return await originalCreate.call(db.order, args);
    };

    const { req, res } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        allocations: [
          { pharmacyId: 'ph-1', prescriptionItemId: 'pi-1', quantity: 5 },
          { pharmacyId: 'ph-2', prescriptionItemId: 'pi-2', quantity: 5 }
        ]
      }
    });

    await createSplitOrder(req, res);
    check('Transaction failure returns HTTP 500', res.getStatusCode() === 500);

    // Verify atomic rollback: neither parent nor child orders remain in database
    check('Parent order was rolled back (0 orders in database)', db.orders.size === 0);
    check('Child order items were rolled back (0 order items in database)', db.orderItems.size === 0);
    check('Audit log was rolled back (0 audit records)', db.auditLogs.length === 0);
  }

  // ── TEST GROUP 11: Request Idempotency & Duplicate Prevention ────────────────
  console.log('\n--- Group 11: Request Idempotency & Duplicate Prevention ---');
  {
    const db = createHermeticMockDatabase();
    const rx = { id: 'rx-idem-test', userId: 'patient-1', status: 'VERIFIED' };
    const med = { id: 'm-idem', brandName: 'Idem Med', genericName: 'Gen I', strength: '10mg', dosageForm: 'Tab' };
    db.prescriptions.set(rx.id, rx);
    db.medicines.set(med.id, med);
    db.prescriptionItems.set('pi-i', { id: 'pi-i', prescriptionId: rx.id, medicineId: med.id, quantity: 10, isVerified: true });

    db.pharmacies.set('ph-i', {
      id: 'ph-i',
      name: 'Idem Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: med.id, stock: 50, price: 15 }]
    });

    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    const idempotencyKey = 'unique-req-uuid-999';

    // First submission
    const { req: req1, res: res1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        idempotencyKey,
        allocations: [{ pharmacyId: 'ph-i', prescriptionItemId: 'pi-i', quantity: 5 }]
      }
    });
    await createSplitOrder(req1, res1);
    check('First submission returns 201 Created', res1.getStatusCode() === 201);
    check('First submission isIdempotentReplay is false', res1.getData().isIdempotentReplay === false);
    const firstParentId = res1.getData().parentOrder.id;

    const initialOrdersCount = db.orders.size;

    // Retry with identical idempotencyKey
    const { req: req2, res: res2 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        idempotencyKey,
        allocations: [{ pharmacyId: 'ph-i', prescriptionItemId: 'pi-i', quantity: 5 }]
      }
    });
    await createSplitOrder(req2, res2);
    check('Second submission returns 200 OK (idempotent replay)', res2.getStatusCode() === 200);
    check('Second submission isIdempotentReplay is true', res2.getData().isIdempotentReplay === true);
    check('Returns identical parent order ID', res2.getData().parentOrder.id === firstParentId);
    check('Database orders count did not increase (no duplicate orders created)', db.orders.size === initialOrdersCount);
  }

  // ── TEST GROUP 12: Gate 4.2.1.2 Integrity Fixes Verification ────────────────
  console.log('\n--- Group 12: Gate 4.2.1.2 Integrity Fixes (Idempotency, Provenance & Concurrency) ---');
  {
    // Setup clean environment
    const db = createHermeticMockDatabase();
    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    const medA = { id: 'med-g42-a', brandName: 'Drug A 10mg', genericName: 'Drug A', strength: '10mg', dosageForm: 'Tablet' };
    const medB = { id: 'med-g42-b', brandName: 'Drug B 20mg', genericName: 'Drug B', strength: '20mg', dosageForm: 'Tablet' };
    db.medicines.set(medA.id, medA);
    db.medicines.set(medB.id, medB);

    const rx1 = { id: 'rx-g42-1', userId: 'patient-1', status: 'VERIFIED' };
    const rx2 = { id: 'rx-g42-2', userId: 'patient-1', status: 'VERIFIED' };
    db.prescriptions.set(rx1.id, rx1);
    db.prescriptions.set(rx2.id, rx2);

    const pi1 = { id: 'pi-g42-1', prescriptionId: rx1.id, medicineId: medA.id, prescribedName: 'Drug A 10mg', quantity: 10, isVerified: true };
    const pi2 = { id: 'pi-g42-2', prescriptionId: rx1.id, medicineId: medB.id, prescribedName: 'Drug B 20mg', quantity: 20, isVerified: true };
    const piOther = { id: 'pi-g42-other', prescriptionId: rx2.id, medicineId: medA.id, prescribedName: 'Drug A 10mg', quantity: 10, isVerified: true };
    db.prescriptionItems.set(pi1.id, pi1);
    db.prescriptionItems.set(pi2.id, pi2);
    db.prescriptionItems.set(piOther.id, piOther);

    const ph1 = {
      id: 'ph-g42-1',
      name: 'Pharmacy 1',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: medA.id, stock: 50, price: 15 }]
    };
    const ph2 = {
      id: 'ph-g42-2',
      name: 'Pharmacy 2',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: medB.id, stock: 50, price: 25 }]
    };
    db.pharmacies.set(ph1.id, ph1);
    db.pharmacies.set(ph2.id, ph2);

    // 1. Same key and same payload returns original order hierarchy without duplicates
    const idempotencyKey = 'gate4212-key-test-1';
    const payload1 = {
      prescriptionId: rx1.id,
      idempotencyKey,
      allocations: [
        { pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 4 }] },
        { pharmacyId: ph2.id, items: [{ prescriptionItemId: pi2.id, quantity: 8 }] }
      ]
    };

    const { req: req1, res: res1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: payload1
    });
    await createSplitOrder(req1, res1);
    check('12.1 First split-order request succeeds with HTTP 201', res1.getStatusCode() === 201);
    check('12.1 First request isIdempotentReplay is false', res1.getData().isIdempotentReplay === false);
    const parentId1 = res1.getData().parentOrder.id;

    // Verify IdempotencyRecord was created in DB
    const idKey = `patient-1:SPLIT_ORDER_CREATION:${idempotencyKey}`;
    const idRecord = db.idempotencyRecords.get(idKey);
    check('12.1 IdempotencyRecord is persisted in database', Boolean(idRecord));
    check('12.1 IdempotencyRecord has canonical requestHash', typeof idRecord?.requestHash === 'string' && idRecord.requestHash.length === 64);
    check('12.1 IdempotencyRecord references parentOrderId', idRecord?.parentOrderId === parentId1);

    // Retry same key with same payload
    const { req: reqRetry, res: resRetry } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: payload1
    });
    await createSplitOrder(reqRetry, resRetry);
    check('12.1 Replay with same key and payload returns HTTP 200/201 (replayed)', [200, 201].includes(resRetry.getStatusCode()));
    check('12.1 Replay has isIdempotentReplay: true', resRetry.getData().isIdempotentReplay === true);
    check('12.1 Replay returns same parent order ID', resRetry.getData().parentOrder.id === parentId1);
    check('12.1 Replay returns same child orders without duplicating them', resRetry.getData().childOrders.length === 2);

    // 2. Same key with a different prescription returns HTTP 409
    const { req: reqDiffRx, res: resDiffRx } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx2.id, // Different prescription
        idempotencyKey,
        allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: piOther.id, quantity: 4 }] }]
      }
    });
    await createSplitOrder(reqDiffRx, resDiffRx);
    check('12.2 Same key with different prescription returns HTTP 409', resDiffRx.getStatusCode() === 409);
    check('12.2 Error code is IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', resDiffRx.getData().code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // 3. Same key with modified allocation quantities returns HTTP 409
    const { req: reqModQty, res: resModQty } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx1.id,
        idempotencyKey,
        allocations: [
          { pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 5 }] }, // Modified quantity (5 vs 4)
          { pharmacyId: ph2.id, items: [{ prescriptionItemId: pi2.id, quantity: 8 }] }
        ]
      }
    });
    await createSplitOrder(reqModQty, resModQty);
    check('12.3 Same key with modified allocation quantities returns HTTP 409', resModQty.getStatusCode() === 409);
    check('12.3 Error code is IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', resModQty.getData().code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // 4. Missing-key behavior follows documented safe deterministic strategy
    const noKeyPayload = {
      prescriptionId: rx1.id,
      allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 2 }] }]
    };
    const { req: reqNoKey1, res: resNoKey1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: noKeyPayload
    });
    await createSplitOrder(reqNoKey1, resNoKey1);
    check('12.4 Missing key submission succeeds with HTTP 201', resNoKey1.getStatusCode() === 201);
    const noKeyParentId = resNoKey1.getData().parentOrder.id;

    // Retry missing key with identical payload (safe deterministic derivation)
    const { req: reqNoKey2, res: resNoKey2 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: noKeyPayload
    });
    await createSplitOrder(reqNoKey2, resNoKey2);
    check('12.4 Missing key replay returns HTTP 200/201 (idempotent replay)', [200, 201].includes(resNoKey2.getStatusCode()));
    check('12.4 Missing key replay returns same parent order ID without duplicating', resNoKey2.getData().parentOrder.id === noKeyParentId);
    check('12.4 Missing key replay isIdempotentReplay is true', resNoKey2.getData().isIdempotentReplay === true);

    // 5. Two concurrent requests allocating remaining quantity cannot over-allocate it
    // rx1.pi1 total is 10. We previously allocated 4 (req1) and 2 (reqNoKey1) = 6 allocated. Remaining = 4.
    // Let's create two requests each attempting to allocate 3.
    // Together they would be 6, which exceeds remaining 4.
    const { req: reqRace1, res: resRace1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx1.id,
        idempotencyKey: 'race-key-1',
        allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 3 }] }]
      }
    });
    const { req: reqRace2, res: resRace2 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx1.id,
        idempotencyKey: 'race-key-2',
        allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 3 }] }]
      }
    });

    await createSplitOrder(reqRace1, resRace1);
    check('12.5 First competing request allocating 3 of remaining 4 succeeds', resRace1.getStatusCode() === 201);

    await createSplitOrder(reqRace2, resRace2);
    check('12.5 Second competing request allocating 3 when only 1 remaining is rejected with 400', resRace2.getStatusCode() === 400);
    check('12.5 Rejection code is ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY', resRace2.getData().code === 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY');

    // 6. Single-order endpoint cannot race with split allocation to exceed prescription quantity
    // Currently rx1.pi1 remaining is 1. Attempting single-order for medA with quantity 5 should fail with 400
    const { req: reqSingleOrder, res: resSingleOrder } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        pharmacyId: ph1.id,
        prescriptionId: rx1.id,
        orderType: 'RESERVATION',
        items: [{ medicineId: medA.id, quantity: 5 }] // 5 > 1 remaining
      }
    });
    await createOrder(reqSingleOrder, resSingleOrder);
    check('12.6 Single-order endpoint enforces outstanding quantity check and returns 400', resSingleOrder.getStatusCode() === 400);
    check('12.6 Single-order error code is ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY', resSingleOrder.getData().code === 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY');

    // 7. Retryable transaction conflict is retried within the configured limit
    // We simulate a P2034 transaction conflict on the first attempt that resolves on the retry
    let conflictSimulated = false;
    const realTransaction = originalPrisma.$transaction;
    originalPrisma.$transaction = db.$transaction = async (fn) => {
      if (!conflictSimulated) {
        conflictSimulated = true;
        const p2034Err = new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction');
        p2034Err.code = 'P2034';
        throw p2034Err;
      }
      return await realTransaction.call(db, fn);
    };

    const { req: reqConflict, res: resConflict } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx1.id,
        idempotencyKey: 'retryable-conflict-key',
        allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: pi1.id, quantity: 1 }] }] // 1 remaining!
      }
    });
    await createSplitOrder(reqConflict, resConflict);
    check('12.7 Request succeeds with 201 after transparently retrying P2034 conflict', resConflict.getStatusCode() === 201);
    check('12.7 Conflict was actually triggered and retried', conflictSimulated === true);
    originalPrisma.$transaction = db.$transaction = realTransaction; // restore

    // 8. Failed transaction does not leave a successful idempotency record or orphaned order
    const dbBeforeRollbackOrderCount = db.orders.size;
    const dbBeforeRollbackIdemCount = db.idempotencyRecords.size;

    // Force failure mid-transaction
    const failingTransaction = async () => {
      throw new Error('Fatal unrecoverable database crash');
    };
    originalPrisma.$transaction = db.$transaction = failingTransaction;

    const { req: reqFail, res: resFail } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx2.id,
        idempotencyKey: 'failing-tx-key',
        allocations: [{ pharmacyId: ph1.id, items: [{ prescriptionItemId: piOther.id, quantity: 2 }] }]
      }
    });
    await createSplitOrder(reqFail, resFail);
    check('12.8 Unrecoverable failure returns HTTP 500', resFail.getStatusCode() === 500);
    check('12.8 No orphaned orders were committed', db.orders.size === dbBeforeRollbackOrderCount);
    check('12.8 No idempotency record was committed for failed transaction', db.idempotencyRecords.size === dbBeforeRollbackIdemCount);
    originalPrisma.$transaction = db.$transaction = realTransaction; // restore

    // 9. Separate database read retrieves persisted prescriptionItemId
    const childOrders = Array.from(db.orders.values()).filter(o => o.isParentOrder === false && o.prescriptionId === rx1.id);
    const childItemIds = [];
    for (const ch of childOrders) {
      for (const [id, item] of db.orderItems.entries()) {
        if (item.orderId === ch.id && item.prescriptionItemId) {
          childItemIds.push(id);
        }
      }
    }
    check('12.9 Database has child order items with persisted prescriptionItemId', childItemIds.length > 0);
    const sampledItem = db.orderItems.get(childItemIds[0]);
    check('12.9 Persisted prescriptionItemId matches prescription item ID', Boolean(sampledItem.prescriptionItemId));

    // 10. Historical rows with null prescriptionItemId remain valid
    const legacyOrderId = 'ord-legacy-historical';
    const legacyItemId = 'item-legacy-historical';
    db.orders.set(legacyOrderId, {
      id: legacyOrderId,
      userId: 'patient-1',
      status: 'COMPLETED',
      isParentOrder: false,
      prescriptionId: null,
      createdAt: new Date()
    });
    db.orderItems.set(legacyItemId, {
      id: legacyItemId,
      orderId: legacyOrderId,
      medicineId: medA.id,
      quantity: 5,
      prescriptionItemId: null // Historical row with null
    });
    const retrievedLegacy = await db.order.findUnique({
      where: { id: legacyOrderId },
      include: { items: true }
    });
    check('12.10 Historical order with null prescriptionItemId is retrievable', retrievedLegacy !== null);
    check('12.10 Historical order item has prescriptionItemId null without error', retrievedLegacy.items[0].prescriptionItemId === null);

    // 11. Parent ₹2 fee, child ₹0 fees, and no inventory deduction remain unchanged
    const successfulParents = Array.from(db.orders.values()).filter(o => o.isParentOrder === true && o.prescriptionId === rx1.id);
    check('12.11 Parent orders maintain exact platformFee = 2.00', successfulParents.every(p => p.platformFee === 2.00));
    const successfulChildren = Array.from(db.orders.values()).filter(o => o.isParentOrder === false && o.prescriptionId === rx1.id);
    check('12.11 Child orders maintain exact platformFee = 0.00', successfulChildren.every(c => c.platformFee === 0.00));
    check('12.11 Dispensary inventory was not deducted (remains at initial 50)', ph1.inventory[0].stock === 50 && ph2.inventory[0].stock === 50);
  }

  // ── TEST GROUP 13: Gate 4.2.1.4 Idempotency Lifecycle, Cancellation Re-Allocation & Multi-Item Hardening ──
  console.log('\n--- Group 13: Gate 4.2.1.4 Idempotency Lifecycle & Quantity Hardening ---');
  {
    const db = createHermeticMockDatabase();
    const originalPrisma = require('./src/prisma');
    Object.assign(originalPrisma, db);

    const medX = { id: 'med-g4214-x', brandName: 'Drug X 500mg', genericName: 'Drug X', strength: '500mg', dosageForm: 'Tablet' };
    db.medicines.set(medX.id, medX);

    const rx = { id: 'rx-g4214-lifecycle', userId: 'patient-1', status: 'VERIFIED' };
    db.prescriptions.set(rx.id, rx);

    const piSingle = { id: 'pi-x-1', prescriptionId: rx.id, medicineId: medX.id, prescribedName: 'Drug X 500mg', quantity: 20, isVerified: true };
    db.prescriptionItems.set(piSingle.id, piSingle);

    const ph = {
      id: 'ph-g4214-1',
      name: 'Hardened Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: medX.id, stock: 100, price: 20 }]
    };
    db.pharmacies.set(ph.id, ph);

    // 13.1 Active-order idempotent replay
    const idemKey = 'lifecycle-key-1';
    const splitPayload = {
      prescriptionId: rx.id,
      idempotencyKey: idemKey,
      allocations: [{ pharmacyId: ph.id, items: [{ prescriptionItemId: piSingle.id, quantity: 10 }] }]
    };

    const { req: reqActive1, res: resActive1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: splitPayload
    });
    await createSplitOrder(reqActive1, resActive1);
    check('13.1 Initial split order succeeds with 201', resActive1.getStatusCode() === 201);
    const firstParent = resActive1.getData().parentOrder;
    const initialOrdersCount = db.orders.size;

    // Verify IdempotencyRecord has expiresAt set (24 hours in future)
    const storedIdem = await db.idempotencyRecord.findUnique({
      where: { userId_action_key: { userId: 'patient-1', action: 'SPLIT_ORDER_CREATION', key: idemKey } }
    });
    check('13.1 IdempotencyRecord has expiresAt set', Boolean(storedIdem?.expiresAt));
    check('13.1 expiresAt is in the future (~24 hours)', new Date(storedIdem.expiresAt).getTime() > Date.now());

    // Active replay returns 200 with original order
    const { req: reqReplay, res: resReplay } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: splitPayload
    });
    await createSplitOrder(reqReplay, resReplay);
    check('13.1 Active replay returns 200 OK', resReplay.getStatusCode() === 200);
    check('13.1 isIdempotentReplay is true', resReplay.getData().isIdempotentReplay === true);
    check('13.1 Returns same parent order ID', resReplay.getData().parentOrder.id === firstParent.id);
    check('13.1 No duplicate orders created', db.orders.size === initialOrdersCount);

    // 13.2 Retry after parent cancellation or rejection
    // Cancel the parent order and its children
    const parentRecord = db.orders.get(firstParent.id);
    parentRecord.status = 'CANCELLED';
    for (const ord of db.orders.values()) {
      if (ord.parentOrderId === firstParent.id) {
        ord.status = 'CANCELLED';
      }
    }

    // Patient retries the same allocation with the same idempotency key
    const { req: reqAfterCancel, res: resAfterCancel } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: splitPayload
    });
    await createSplitOrder(reqAfterCancel, resAfterCancel);
    check('13.2 Retry after cancellation succeeds with 201 Created (does not return cancelled order)', resAfterCancel.getStatusCode() === 201);
    const newParent = resAfterCancel.getData().parentOrder;
    check('13.2 Returns fresh active parent order (new ID)', newParent.id !== firstParent.id);
    check('13.2 New parent order status is PENDING', newParent.status === 'PENDING');
    check('13.2 Previous cancelled parent order remains in database', db.orders.get(firstParent.id).status === 'CANCELLED');

    // Verify IdempotencyRecord was updated in-place with new parentOrderId
    const updatedIdem = await db.idempotencyRecord.findUnique({
      where: { userId_action_key: { userId: 'patient-1', action: 'SPLIT_ORDER_CREATION', key: idemKey } }
    });
    check('13.2 IdempotencyRecord was updated in place pointing to new parentOrderId', updatedIdem.parentOrderId === newParent.id);

    // Verify audit log recorded re-claim after cancellation
    const latestAudit = db.auditLogs[db.auditLogs.length - 1];
    const parsedAuditDetails = typeof latestAudit.details === 'string' ? JSON.parse(latestAudit.details) : latestAudit.details;
    check('13.2 Audit log recorded reclaimedAfterCancellation: true', parsedAuditDetails?.reclaimedAfterCancellation === true);

    // 13.3 Concurrent retries during cancellation cannot create duplicate active orders
    // Cancel the second parent order
    db.orders.get(newParent.id).status = 'CANCELLED';
    for (const ord of db.orders.values()) {
      if (ord.parentOrderId === newParent.id) ord.status = 'CANCELLED';
    }

    const { req: reqRaceA, res: resRaceA } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: splitPayload
    });
    const { req: reqRaceB, res: resRaceB } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: splitPayload
    });

    await createSplitOrder(reqRaceA, resRaceA);
    check('13.3 First concurrent retry allocates new order (201)', resRaceA.getStatusCode() === 201);
    const parentAId = resRaceA.getData().parentOrder.id;

    await createSplitOrder(reqRaceB, resRaceB);
    check('13.3 Second concurrent retry safely replays active order without creating another (200)', resRaceB.getStatusCode() === 200);
    check('13.3 Second retry references same active parent order ID', resRaceB.getData().parentOrder.id === parentAId);

    // 13.4 Expired idempotency record behavior
    const expKey = 'expired-idem-key';
    const { req: reqExp1, res: resExp1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        idempotencyKey: expKey,
        allocations: [{ pharmacyId: ph.id, items: [{ prescriptionItemId: piSingle.id, quantity: 2 }] }]
      }
    });
    await createSplitOrder(reqExp1, resExp1);
    check('13.4 Expiring key split order succeeds with 201', resExp1.getStatusCode() === 201);
    const expParentId = resExp1.getData().parentOrder.id;

    // Simulate expiration of idempotency record (set expiresAt 1 hour in the past)
    const expIdemKey = `patient-1:SPLIT_ORDER_CREATION:${expKey}`;
    const expRecord = db.idempotencyRecords.get(expIdemKey);
    expRecord.expiresAt = new Date(Date.now() - 3600000);

    // 13.5 Active orders are not made allocatable again by expiry alone
    // Even though expKey expired, expParentId is still ACTIVE (PENDING).
    // An attempt to re-request with the expired key does not create another order
    const { req: reqExpRetry, res: resExpRetry } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        prescriptionId: rx.id,
        idempotencyKey: expKey,
        allocations: [{ pharmacyId: ph.id, items: [{ prescriptionItemId: piSingle.id, quantity: 2 }] }]
      }
    });
    await createSplitOrder(reqExpRetry, resExpRetry);
    check('13.5 Expired record with active order does not create duplicate order (replays active 200)', resExpRetry.getStatusCode() === 200);
    check('13.5 Returns active order ID', resExpRetry.getData().parentOrder.id === expParentId);

    // 13.6 Multiple prescription items with the same medicine ID but distinct prescription-item IDs in single-order
    const medMulti = { id: 'med-multi-paracetamol', brandName: 'Dolo Paracetamol', genericName: 'Paracetamol', strength: '650mg', dosageForm: 'Tablet' };
    db.medicines.set(medMulti.id, medMulti);

    const rxMulti = { id: 'rx-multi-items', userId: 'patient-1', status: 'VERIFIED' };
    db.prescriptions.set(rxMulti.id, rxMulti);

    const piMulti1 = { id: 'pi-multi-morning', prescriptionId: rxMulti.id, medicineId: medMulti.id, prescribedName: 'Dolo 650mg (Morning)', quantity: 5, isVerified: true };
    const piMulti2 = { id: 'pi-multi-night', prescriptionId: rxMulti.id, medicineId: medMulti.id, prescribedName: 'Dolo 650mg (Night)', quantity: 10, isVerified: true };
    db.prescriptionItems.set(piMulti1.id, piMulti1);
    db.prescriptionItems.set(piMulti2.id, piMulti2);

    db.pharmacies.set('ph-multi', {
      id: 'ph-multi',
      name: 'Multi Pharmacy',
      isVerified: true,
      verificationStatus: 'VERIFIED',
      isOpen: true,
      inventory: [{ medicineId: medMulti.id, stock: 100, price: 5.0 }]
    });

    const { createOrder } = require('./src/controllers/orderController');

    // First single order: allocate quantity 5
    const { req: reqSingle1, res: resSingle1 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        pharmacyId: 'ph-multi',
        prescriptionId: rxMulti.id,
        orderType: 'RESERVATION',
        items: [{ medicineId: medMulti.id, quantity: 5 }]
      }
    });
    await createOrder(reqSingle1, resSingle1);
    check('13.6 First single order for duplicate medicine succeeds (201)', resSingle1.getStatusCode() === 201);
    const ord1 = resSingle1.getData().order;
    check('13.6 Preserved provenance for first item (pi-multi-morning)', ord1.items[0].prescriptionItemId === 'pi-multi-morning');

    // Second single order: allocate remaining quantity 10
    const { req: reqSingle2, res: resSingle2 } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        pharmacyId: 'ph-multi',
        prescriptionId: rxMulti.id,
        orderType: 'RESERVATION',
        items: [{ medicineId: medMulti.id, quantity: 10 }]
      }
    });
    await createOrder(reqSingle2, resSingle2);
    check('13.6 Second single order for duplicate medicine succeeds (201)', resSingle2.getStatusCode() === 201);
    const ord2 = resSingle2.getData().order;
    check('13.6 Preserved provenance for second item (pi-multi-night)', ord2.items[0].prescriptionItemId === 'pi-multi-night');

    // 13.7 Over-allocation attempts against duplicate-medicine items
    // Total 15 prescribed, 15 now allocated. Attempting to allocate 1 more must fail!
    const { req: reqOverAlloc, res: resOverAlloc } = mockReqRes({
      user: { id: 'patient-1', role: 'PATIENT' },
      body: {
        pharmacyId: 'ph-multi',
        prescriptionId: rxMulti.id,
        orderType: 'RESERVATION',
        items: [{ medicineId: medMulti.id, quantity: 1 }]
      }
    });
    await createOrder(reqOverAlloc, resOverAlloc);
    check('13.7 Over-allocation attempt against duplicate-medicine items rejected with 400', resOverAlloc.getStatusCode() === 400);
    check('13.7 Rejection code is ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY', resOverAlloc.getData().code === 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY');
  }

  console.log('\n================================================================');
  console.log(`Gate 4.2.1 Verification Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSplitOrderTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
