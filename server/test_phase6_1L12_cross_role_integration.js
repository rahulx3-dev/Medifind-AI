/**
 * PHASE 6.1L.12 — CROSS-ROLE INTEGRATION & AUTHORIZATION AUDIT TEST SUITE
 *
 * Verifies cross-role integration across Patient, Pharmacy, Assistant, and Admin:
 * 1. Patient -> Pharmacy integration & inventory immutability
 * 2. Patient -> Assistant task isolation & IDOR prevention
 * 3. Pharmacy -> Order authorization & inventory restoration on cancel
 * 4. Assistant -> Order status synchronization & terminal state immutability
 * 5. Admin isolation & data minimization (PIN sanitization, role guards)
 * 6. Role authorization & cross-user access control across all critical endpoints
 * 7. Status transition consistency across Order, AssistantTask, Payment, and Inventory
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'medifind-super-secret-key-change-in-production-2025';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${testName}${details ? ` -> ${details}` : ''}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
    failed++;
  }
}

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('====================================================================');
  console.log('🧪 STARTING PHASE 6.1L.12 CROSS-ROLE INTEGRATION AUDIT TESTS');
  console.log('====================================================================\n');

  try {
    // ── Setup Users & Roles ──────────────────────────────────────────────────
    // Patient 1 & Patient 2
    const patient1 = await prisma.user.upsert({
      where: { email: 'patient1_61L12@test.com' },
      update: {},
      create: {
        email: 'patient1_61L12@test.com',
        name: 'Patient One 61L12',
        password: 'hash',
        role: 'PATIENT'
      }
    });

    const patient2 = await prisma.user.upsert({
      where: { email: 'patient2_61L12@test.com' },
      update: {},
      create: {
        email: 'patient2_61L12@test.com',
        name: 'Patient Two 61L12',
        password: 'hash',
        role: 'PATIENT'
      }
    });

    // Pharmacist 1 (Max Care) & Pharmacist 2 (Karuna)
    const maxCare = await prisma.pharmacy.findFirst({
      where: { name: { contains: 'Max Care' } }
    });
    const karuna = await prisma.pharmacy.findFirst({
      where: { name: { contains: 'Karuna' } }
    });

    if (!maxCare || !karuna) {
      throw new Error('Real pharmacies (Max Care / Karuna) not found in DB!');
    }

    const pharmacist1 = await prisma.user.findUnique({
      where: { id: maxCare.managerId }
    });
    const pharmacist2 = await prisma.user.findUnique({
      where: { id: karuna.managerId }
    });

    // Assistant 1 & Assistant 2
    const assistant1 = await prisma.user.upsert({
      where: { email: 'assistant1_61L12@test.com' },
      update: { role: 'ASSISTANT' },
      create: {
        email: 'assistant1_61L12@test.com',
        name: 'Assistant One 61L12',
        password: 'hash',
        role: 'ASSISTANT'
      }
    });

    await prisma.assistantProfile.upsert({
      where: { userId: assistant1.id },
      update: {
        isActive: true,
        isAvailable: true,
        capabilities: JSON.stringify(['MEDICINE_DELIVERY', 'DIGITAL_ASSISTANCE', 'MEDICINE_COLLECTION'])
      },
      create: {
        userId: assistant1.id,
        isActive: true,
        isAvailable: true,
        capabilities: JSON.stringify(['MEDICINE_DELIVERY', 'DIGITAL_ASSISTANCE', 'MEDICINE_COLLECTION'])
      }
    });

    const assistant2 = await prisma.user.upsert({
      where: { email: 'assistant2_61L12@test.com' },
      update: { role: 'ASSISTANT' },
      create: {
        email: 'assistant2_61L12@test.com',
        name: 'Assistant Two 61L12',
        password: 'hash',
        role: 'ASSISTANT'
      }
    });

    await prisma.assistantProfile.upsert({
      where: { userId: assistant2.id },
      update: {
        isActive: true,
        isAvailable: true,
        capabilities: JSON.stringify(['MEDICINE_DELIVERY'])
      },
      create: {
        userId: assistant2.id,
        isActive: true,
        isAvailable: true,
        capabilities: JSON.stringify(['MEDICINE_DELIVERY'])
      }
    });

    // Admin user
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin_61L12@test.com' },
      update: { role: 'ADMIN' },
      create: {
        email: 'admin_61L12@test.com',
        name: 'System Admin 61L12',
        password: 'hash',
        role: 'ADMIN'
      }
    });

    const tokenPatient1 = makeToken(patient1);
    const tokenPatient2 = makeToken(patient2);
    const tokenPharmacist1 = makeToken(pharmacist1);
    const tokenPharmacist2 = makeToken(pharmacist2);
    const tokenAssistant1 = makeToken(assistant1);
    const tokenAssistant2 = makeToken(assistant2);
    const tokenAdmin = makeToken(adminUser);

    // Pick an existing catalogue medicine in Max Care
    const inventoryItem = await prisma.inventory.findFirst({
      where: { pharmacyId: maxCare.id, stock: { gte: 5 } },
      include: { medicine: true }
    });

    if (!inventoryItem) {
      throw new Error('No available inventory found in Max Care Pharmacy!');
    }
    const testMedicineId = inventoryItem.medicineId;

    // ── SECTION 1: PATIENT -> PHARMACY INTEGRATION ────────────────────────────
    console.log('\n--- Section 1: Patient -> Pharmacy Integration ---');

    // T01: Patient creates valid reservation at Max Care
    let orderRes;
    try {
      orderRes = await axios.post(
        `${BASE_URL}/orders`,
        {
          pharmacyId: maxCare.id,
          orderType: 'RESERVATION',
          items: [{ medicineId: testMedicineId, quantity: 2 }]
        },
        { headers: { Authorization: `Bearer ${tokenPatient1}` } }
      );
      assert(orderRes.status === 201 && orderRes.data.order.status === 'PENDING', 'T01 [PATIENT->PHARMACY] Patient places reservation in PENDING state');
    } catch (err) {
      assert(false, 'T01 [PATIENT->PHARMACY] Failed to create reservation', err.response?.data?.error || err.message);
    }
    const order1Id = orderRes?.data?.order?.id;

    // T02: Client/Patient cannot modify inventory via PUT /api/pharmacies/:id/inventory (HTTP 403)
    try {
      await axios.put(
        `${BASE_URL}/pharmacies/${maxCare.id}/inventory`,
        { medicineId: testMedicineId, stock: 999 },
        { headers: { Authorization: `Bearer ${tokenPatient1}` } }
      );
      assert(false, 'T02 [SECURITY] Patient was able to modify pharmacy inventory');
    } catch (err) {
      assert(err.response?.status === 403, 'T02 [SECURITY] Patient modifying inventory is rejected with HTTP 403');
    }

    // T03: Pharmacist 2 (Karuna) cannot view or manage Patient 1 order at Max Care (HTTP 403)
    try {
      await axios.get(`${BASE_URL}/orders/${order1Id}`, {
        headers: { Authorization: `Bearer ${tokenPharmacist2}` }
      });
      assert(false, 'T03 [ISOLATION] Pharmacist 2 was able to view Max Care order');
    } catch (err) {
      assert(err.response?.status === 403, 'T03 [ISOLATION] Pharmacist 2 denied access to Max Care order with HTTP 403');
    }

    // T04: Pharmacist 1 (Max Care) can view order at Max Care
    try {
      const p1ViewRes = await axios.get(`${BASE_URL}/orders/${order1Id}`, {
        headers: { Authorization: `Bearer ${tokenPharmacist1}` }
      });
      assert(p1ViewRes.status === 200 && p1ViewRes.data.order.id === order1Id, 'T04 [AUTHORIZATION] Pharmacist 1 can view order at own pharmacy');
    } catch (err) {
      assert(false, 'T04 [AUTHORIZATION] Pharmacist 1 failed to view own pharmacy order', err.response?.data?.error);
    }

    // ── SECTION 2: PATIENT -> ASSISTANT INTEGRATION ───────────────────────────
    console.log('\n--- Section 2: Patient -> Assistant Task Isolation & IDOR ---');

    // T05: Patient creates an ASSISTED_DELIVERY order assigned to Assistant 1
    let assistedOrderRes;
    try {
      assistedOrderRes = await axios.post(
        `${BASE_URL}/orders`,
        {
          pharmacyId: maxCare.id,
          orderType: 'ASSISTED_DELIVERY',
          items: [{ medicineId: testMedicineId, quantity: 1 }],
          deliveryAddress: 'House 42, Chengannur, Kerala',
          selectedAssistantId: assistant1.id
        },
        { headers: { Authorization: `Bearer ${tokenPatient1}` } }
      );
      assert(assistedOrderRes.status === 201 && assistedOrderRes.data.order.selectedAssistantId === assistant1.id, 'T05 [PATIENT->ASSISTANT] Direct booking created with selectedAssistantId preserved');
    } catch (err) {
      assert(false, 'T05 [PATIENT->ASSISTANT] Failed to create assisted order', err.response?.data?.error || err.message);
    }
    const order2Id = assistedOrderRes?.data?.order?.id;

    const task2 = await prisma.assistantTask.findUnique({
      where: { orderId: order2Id }
    });

    // T06: Patient 2 cannot access Patient 1 order or assistant task (HTTP 403)
    try {
      await axios.get(`${BASE_URL}/orders/${order2Id}`, {
        headers: { Authorization: `Bearer ${tokenPatient2}` }
      });
      assert(false, 'T06 [IDOR] Patient 2 accessed Patient 1 order');
    } catch (err) {
      assert(err.response?.status === 403, 'T06 [IDOR] Cross-patient order access rejected with HTTP 403');
    }

    // T07: Assistant 2 cannot access Assistant 1 task via /api/assistant/my-tasks
    try {
      const myTasksRes = await axios.get(`${BASE_URL}/assistant/my-tasks`, {
        headers: { Authorization: `Bearer ${tokenAssistant2}` }
      });
      const hasTask = myTasksRes.data.tasks.some(t => t.id === task2.id);
      assert(!hasTask, 'T07 [TASK_ISOLATION] Assistant 2 my-tasks excludes Assistant 1 task');
    } catch (err) {
      assert(false, 'T07 [TASK_ISOLATION] Failed to fetch Assistant 2 tasks', err.response?.data?.error);
    }

    // T08: Assistant 2 cannot accept Assistant 1 assigned task (HTTP 403)
    try {
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/accept`,
        {},
        { headers: { Authorization: `Bearer ${tokenAssistant2}` } }
      );
      assert(false, 'T08 [SECURITY] Assistant 2 accepted Assistant 1 task');
    } catch (err) {
      assert(err.response?.status === 403, 'T08 [SECURITY] Unassigned Assistant 2 rejected from accepting task with HTTP 403');
    }

    // ── SECTION 3: PHARMACY -> ORDER INTEGRATION & INVENTORY RESTORATION ─────
    console.log('\n--- Section 3: Pharmacy -> Order Integration & Stock Consistency ---');

    // Get current stock before confirmation
    const stockBefore = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId: maxCare.id, medicineId: testMedicineId } }
    });

    // T09: Pharmacist 1 confirms reservation -> Order status becomes CONFIRMED and stock decrements
    try {
      const confRes = await axios.put(
        `${BASE_URL}/orders/${order1Id}/status`,
        { status: 'CONFIRMED' },
        { headers: { Authorization: `Bearer ${tokenPharmacist1}` } }
      );
      assert(confRes.status === 200 && confRes.data.order.status === 'CONFIRMED', 'T09 [WORKFLOW] Pharmacist confirms order (PENDING -> CONFIRMED)');
    } catch (err) {
      assert(false, 'T09 [WORKFLOW] Pharmacist confirmation failed', err.response?.data?.error);
    }

    const stockAfterConfirm = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId: maxCare.id, medicineId: testMedicineId } }
    });
    assert(stockAfterConfirm.stock === stockBefore.stock - 2, 'T10 [INVENTORY] Stock decremented by 2 upon CONFIRMED transition');

    // T11: Pharmacist 2 cannot reject or modify Max Care order (HTTP 403)
    try {
      await axios.put(
        `${BASE_URL}/orders/${order1Id}/status`,
        { status: 'REJECTED' },
        { headers: { Authorization: `Bearer ${tokenPharmacist2}` } }
      );
      assert(false, 'T11 [AUTHORIZATION] Pharmacist 2 modified Max Care order');
    } catch (err) {
      assert(err.response?.status === 403, 'T11 [AUTHORIZATION] Pharmacist 2 denied status update with HTTP 403');
    }

    // T12: Pharmacist 1 rejects previously CONFIRMED order -> Stock is restored
    try {
      const rejRes = await axios.put(
        `${BASE_URL}/orders/${order1Id}/status`,
        { status: 'REJECTED', comment: 'Stock adjustment' },
        { headers: { Authorization: `Bearer ${tokenPharmacist1}` } }
      );
      assert(rejRes.status === 200 && rejRes.data.order.status === 'REJECTED', 'T12 [WORKFLOW] Pharmacist rejects order');
    } catch (err) {
      assert(false, 'T12 [WORKFLOW] Pharmacist rejection failed', err.response?.data?.error);
    }

    const stockAfterReject = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId: maxCare.id, medicineId: testMedicineId } }
    });
    assert(stockAfterReject.stock === stockBefore.stock, 'T13 [INVENTORY] Decremented stock is fully restored upon REJECTED transition');

    // T14: Rejected order cannot be fulfilled or moved to READY_FOR_PICKUP (HTTP 400)
    try {
      await axios.put(
        `${BASE_URL}/orders/${order1Id}/status`,
        { status: 'READY_FOR_PICKUP' },
        { headers: { Authorization: `Bearer ${tokenPharmacist1}` } }
      );
      assert(false, 'T14 [TERMINAL] Terminal REJECTED order allowed transition');
    } catch (err) {
      assert(err.response?.status === 400, 'T14 [TERMINAL] Transition on terminal REJECTED order rejected with HTTP 400');
    }

    // ── SECTION 4: ASSISTANT -> ORDER INTEGRATION ────────────────────────────
    console.log('\n--- Section 4: Assistant -> Order Status Synchronization ---');

    // T15: Assigned Assistant 1 accepts task -> task becomes ACCEPTED
    try {
      const acceptRes = await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/accept`,
        {},
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(acceptRes.status === 200 && acceptRes.data.task.status === 'ACCEPTED', 'T15 [ASSISTANT->ORDER] Assigned Assistant 1 successfully accepts task');
    } catch (err) {
      assert(false, 'T15 [ASSISTANT->ORDER] Assistant 1 failed to accept task', err.response?.data?.error);
    }

    // T16: Assistant progresses task sequentially: ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED
    try {
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/progress`,
        { status: 'COLLECTING' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/progress`,
        { status: 'IN_TRANSIT' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      const delivRes = await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/progress`,
        { status: 'DELIVERED' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(delivRes.status === 200 && delivRes.data.task.status === 'DELIVERED', 'T16 [PROGRESSION] Task sequentially progressed to DELIVERED');
    } catch (err) {
      assert(false, 'T16 [PROGRESSION] Sequential task progression failed', err.response?.data?.error);
    }

    // T17: Assistant cannot self-confirm delivery without handover PIN or patient confirmReceipt (HTTP 400)
    try {
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/progress`,
        { status: 'CONFIRMED', handoverPin: '0000' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(false, 'T17 [COMPLETION] Assistant confirmed without correct PIN');
    } catch (err) {
      assert(err.response?.status === 400, 'T17 [COMPLETION] Invalid handover PIN rejected with HTTP 400');
    }

    // T18: Patient confirms receipt via POST /api/orders/:id/confirm-receipt
    try {
      const confReceiptRes = await axios.post(
        `${BASE_URL}/orders/${order2Id}/confirm-receipt`,
        {},
        { headers: { Authorization: `Bearer ${tokenPatient1}` } }
      );
      assert(confReceiptRes.status === 200 && confReceiptRes.data.order.status === 'COMPLETED' && confReceiptRes.data.task.status === 'CONFIRMED', 'T18 [COMPLETION] Patient confirms receipt: Task -> CONFIRMED, Order -> COMPLETED');
    } catch (err) {
      assert(false, 'T18 [COMPLETION] Patient confirm-receipt failed', err.response?.data?.error);
    }

    // T19: Completed/Confirmed task cannot be progressed or reopened (HTTP 400)
    try {
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task2.id}/progress`,
        { status: 'COLLECTING' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(false, 'T19 [TERMINAL] Confirmed task reopened');
    } catch (err) {
      assert(err.response?.status === 400, 'T19 [TERMINAL] Progressing terminal CONFIRMED task rejected with HTTP 400');
    }

    // ── SECTION 5: CANCELLED/REJECTED ORDER ↔ ASSISTANT TASK LOCKING ─────────
    console.log('\n--- Section 5: Cancelled Order ↔ Assistant Task Cancellation ---');

    // Create a new order with assistant task, then cancel the order
    const order3Res = await axios.post(
      `${BASE_URL}/orders`,
      {
        pharmacyId: maxCare.id,
        orderType: 'ASSISTED_DELIVERY',
        items: [{ medicineId: testMedicineId, quantity: 1 }],
        deliveryAddress: 'House 99, Chengannur, Kerala',
        selectedAssistantId: assistant1.id
      },
      { headers: { Authorization: `Bearer ${tokenPatient1}` } }
    );
    const order3Id = order3Res.data.order.id;
    const task3 = await prisma.assistantTask.findUnique({ where: { orderId: order3Id } });

    // Patient cancels order while PENDING
    await axios.put(
      `${BASE_URL}/orders/${order3Id}/status`,
      { status: 'CANCELLED' },
      { headers: { Authorization: `Bearer ${tokenPatient1}` } }
    );

    const task3AfterCancel = await prisma.assistantTask.findUnique({ where: { id: task3.id } });
    assert(task3AfterCancel.status === 'CANCELLED', 'T20 [STATUS_LOCK] Assistant task automatically set to CANCELLED when order cancelled');

    // T21: Assistant cannot accept a task whose order is CANCELLED (HTTP 400)
    try {
      await axios.put(
        `${BASE_URL}/assistant/tasks/${task3.id}/accept`,
        {},
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(false, 'T21 [STATUS_LOCK] Assistant accepted task for cancelled order');
    } catch (err) {
      assert(err.response?.status === 400, 'T21 [STATUS_LOCK] Accepting task for cancelled order rejected with HTTP 400');
    }

    // ── SECTION 6: ADMIN ISOLATION & DATA MINIMIZATION ───────────────────────
    console.log('\n--- Section 6: Admin Isolation & Data Minimization ---');

    // T22: Non-admin (Patient) accessing GET /api/admin/orders is denied (HTTP 403)
    try {
      await axios.get(`${BASE_URL}/admin/orders`, {
        headers: { Authorization: `Bearer ${tokenPatient1}` }
      });
      assert(false, 'T22 [ADMIN_GUARD] Patient accessed admin endpoint');
    } catch (err) {
      assert(err.response?.status === 403, 'T22 [ADMIN_GUARD] Non-admin rejected from /api/admin/orders with HTTP 403');
    }

    // T23: Unauthenticated request to /api/admin/orders returns HTTP 401
    try {
      await axios.get(`${BASE_URL}/admin/orders`);
      assert(false, 'T23 [ADMIN_GUARD] Unauthenticated request accessed admin endpoint');
    } catch (err) {
      assert(err.response?.status === 401, 'T23 [ADMIN_GUARD] Unauthenticated request rejected with HTTP 401');
    }

    // T24: Admin GET /api/admin/orders succeeds with PIN data minimization (no verificationPin)
    try {
      const adminOrdersRes = await axios.get(`${BASE_URL}/admin/orders`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      assert(adminOrdersRes.status === 200, 'T24 [ADMIN_ACCESS] Admin successfully retrieves orders list');
      const hasRawPin = adminOrdersRes.data.orders.some(o => o.verificationPin !== undefined);
      assert(!hasRawPin, 'T25 [ADMIN_PRIVACY] Admin orders endpoint omits raw verificationPin');
    } catch (err) {
      assert(false, 'T24 [ADMIN_ACCESS] Admin failed to retrieve orders', err.response?.data?.error);
    }

    // T26: Admin GET /api/admin/emergency-requests omits secret handoverPin & verificationPin
    try {
      const adminEmergRes = await axios.get(`${BASE_URL}/admin/emergency-requests`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      assert(adminEmergRes.status === 200, 'T26 [ADMIN_EMERGENCY] Admin emergency-requests endpoint responds HTTP 200');
      const leaksHandoverPin = adminEmergRes.data.tasks.some(t => t.handoverPin !== undefined);
      assert(!leaksHandoverPin, 'T27 [ADMIN_PRIVACY] Emergency requests endpoint strictly omits handoverPin');
    } catch (err) {
      assert(false, 'T26 [ADMIN_EMERGENCY] Failed to retrieve emergency requests', err.response?.data?.error);
    }

    // ── SECTION 7: ROLE AUTHORIZATION AUDIT ACROSS CRITICAL ENDPOINTS ────────
    console.log('\n--- Section 7: Comprehensive Role Authorization Matrix ---');

    // T28: Assistant role cannot verify pickup PIN at counter (HTTP 403)
    try {
      await axios.post(
        `${BASE_URL}/orders/${order2Id}/verify-pin`,
        { pin: '1234' },
        { headers: { Authorization: `Bearer ${tokenAssistant1}` } }
      );
      assert(false, 'T28 [ROLE_GUARD] Assistant verified counter pickup PIN');
    } catch (err) {
      assert(err.response?.status === 403, 'T28 [ROLE_GUARD] Assistant blocked from verifying counter pickup PIN with HTTP 403');
    }

    // T29: Assistant role cannot access prescription endpoints (HTTP 403)
    // Create a prescription for patient 1
    const testRx = await prisma.prescription.create({
      data: {
        userId: patient1.id,
        filePath: 'test/sample.png',
        originalFileName: 'sample.png',
        status: 'VERIFIED',
        ocrRawText: 'Paracetamol 500mg'
      }
    });

    try {
      await axios.get(`${BASE_URL}/prescriptions/${testRx.id}`, {
        headers: { Authorization: `Bearer ${tokenAssistant1}` }
      });
      assert(false, 'T29 [CLINICAL_ISOLATION] Assistant accessed prescription details');
    } catch (err) {
      assert(err.response?.status === 403, 'T29 [CLINICAL_ISOLATION] Assistant blocked from viewing prescription with HTTP 403');
    }

    // T30: Patient cannot access assistant portal endpoints (HTTP 403)
    try {
      await axios.get(`${BASE_URL}/assistant/available`, {
        headers: { Authorization: `Bearer ${tokenPatient1}` }
      });
      assert(false, 'T30 [ROLE_GUARD] Patient accessed assistant available tasks');
    } catch (err) {
      assert(err.response?.status === 403, 'T30 [ROLE_GUARD] Patient blocked from /api/assistant/available with HTTP 403');
    }

    // Clean up temporary test prescription
    await prisma.prescription.delete({ where: { id: testRx.id } });

    console.log('\n====================================================================');
    console.log(`📊 PHASE 6.1L.12 RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
    console.log('====================================================================');

    if (failed === 0) {
      console.log('\n🎉 ALL PHASE 6.1L.12 CROSS-ROLE INTEGRATION TESTS PASSED WITH ZERO FAILURES!\n');
      process.exit(0);
    } else {
      console.error(`\n❌ ${failed} TEST(S) FAILED IN PHASE 6.1L.12!\n`);
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal test execution error:', globalErr);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
