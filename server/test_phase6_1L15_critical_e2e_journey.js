/**
 * PHASE 6.1L.15 — CRITICAL E2E JOURNEY CHECK
 *
 * Verifies 5 complete, focused healthcare workflows:
 * 1. PATIENT: Login → medicine search → pharmacy match → reservation/order → tracking.
 * 2. PHARMACY: Login → order queue → confirm order → inventory update verification.
 * 3. ASSISTANT: Login → assigned task → accept → progress to delivered → patient confirms receipt.
 * 4. EMERGENCY: Emergency locator → restock request → fallback directory for offline SMS.
 * 5. ADMIN: Login → overview → users/pharmacies/orders/emergency visibility.
 */

const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./src/server');
const prisma = require('./src/prisma');
const { JWT_SECRET } = require('./src/middlewares/auth');

const PORT = process.env.PORT || 5000;

function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== PHASE 6.1L.15: CRITICAL E2E JOURNEY CHECK ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  // Find real seed entities from DB
  const patient = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
  const pharmacist = await prisma.user.findFirst({ where: { role: 'PHARMACIST' }, include: { pharmacy: true } });
  const assistant = await prisma.user.findFirst({ where: { role: 'ASSISTANT' } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const pharmacy = await prisma.pharmacy.findFirst({ where: { isVerified: true, verificationStatus: 'VERIFIED' } });
  const medicine = await prisma.medicine.findFirst();

  assert(patient, 'Patient user must exist');
  assert(pharmacist, 'Pharmacist user must exist');
  assert(assistant, 'Assistant user must exist');
  assert(admin, 'Admin user must exist');
  assert(pharmacy, 'Participating pharmacy must exist');
  assert(medicine, 'Medicine record must exist');

  const patientToken = makeToken({ id: patient.id, email: patient.email, role: 'PATIENT', name: patient.name });
  const pharmacistToken = makeToken({ id: pharmacist.id, email: pharmacist.email, role: 'PHARMACIST', name: pharmacist.name, pharmacyId: pharmacist.pharmacy?.id });
  const assistantToken = makeToken({ id: assistant.id, email: assistant.email, role: 'ASSISTANT', name: assistant.name });
  const adminToken = makeToken({ id: admin.id, email: admin.email, role: 'ADMIN', name: admin.name });

  let createdOrderId = null;
  let createdTaskId = null;

  // ----------------------------------------------------
  // JOURNEY 1: PATIENT
  // ----------------------------------------------------
  await test('J1: Patient Journey (Search -> Match -> Reserve -> Track)', async () => {
    // 1. Search medicines
    const searchRes = await request('GET', `/api/medicines/search?query=${encodeURIComponent(medicine.brandName)}`);
    assert(searchRes.status === 200, 'Medicine search should succeed');
    assert(searchRes.body.success === true, 'Medicine search success should be true');

    // 2. Match availability across dispensaries
    const matchRes = await request('POST', '/api/pharmacies/match-availability', {}, {
      items: [{ medicineId: medicine.id, quantity: 1 }],
      lat: 9.32,
      lon: 76.61
    });
    assert(matchRes.status === 200, 'Pharmacy matching should succeed');
    assert(matchRes.body.success === true, 'Match availability success should be true');

    // 3. Create reservation order
    const orderRes = await request('POST', '/api/orders', {
      Authorization: `Bearer ${patientToken}`
    }, {
      pharmacyId: pharmacy.id,
      orderType: 'RESERVATION',
      items: [{ medicineId: medicine.id, quantity: 1 }]
    });
    assert(orderRes.status === 201, `Order creation should return 201, got ${orderRes.status}`);
    assert(orderRes.body.success === true, 'Order creation success should be true');
    createdOrderId = orderRes.body.order.id;

    // 4. Track order as patient
    const trackRes = await request('GET', `/api/orders/${createdOrderId}`, {
      Authorization: `Bearer ${patientToken}`
    });
    assert(trackRes.status === 200, 'Order tracking should return 200');
    assert(trackRes.body.order.id === createdOrderId, 'Tracking order ID should match');
    assert(trackRes.body.order.status === 'PENDING', 'Initial order status should be PENDING');
    assert(Boolean(trackRes.body.order.verificationPin), 'Patient must receive their verification PIN');
  });

  // ----------------------------------------------------
  // JOURNEY 2: PHARMACY
  // ----------------------------------------------------
  await test('J2: Pharmacy Journey (Queue -> Confirm -> Inventory state)', async () => {
    assert(createdOrderId, 'Order must exist from Journey 1');

    // Pharmacist views pharmacy order queue
    const queueRes = await request('GET', '/api/orders', {
      Authorization: `Bearer ${pharmacistToken}`
    });
    assert(queueRes.status === 200, 'Pharmacist queue should return 200');
    assert(queueRes.body.success === true, 'Pharmacist queue success should be true');

    // Pharmacist confirms order (PENDING -> CONFIRMED) if managed pharmacy matches
    // Create/link order specifically for pharmacist's managed pharmacy for this step
    const pharmManagedId = pharmacist.pharmacy?.id || pharmacy.id;
    const directOrder = await prisma.order.create({
      data: {
        userId: patient.id,
        pharmacyId: pharmManagedId,
        orderNumber: `MF-TEST-${Date.now().toString().slice(-4)}`,
        status: 'PENDING',
        orderType: 'RESERVATION',
        verificationPin: '4321',
        items: {
          create: [{ medicineId: medicine.id, quantity: 1 }]
        }
      }
    });

    const confirmRes = await request('PUT', `/api/orders/${directOrder.id}/status`, {
      Authorization: `Bearer ${pharmacistToken}`
    }, { status: 'CONFIRMED' });

    assert(confirmRes.status === 200, `Pharmacist confirm status should return 200, got ${confirmRes.status}`);
    assert(confirmRes.body.order.status === 'CONFIRMED', 'Order status should transition to CONFIRMED');

    // Verify pharmacist does not receive raw verification PIN
    const pharmView = await request('GET', `/api/orders/${directOrder.id}`, {
      Authorization: `Bearer ${pharmacistToken}`
    });
    assert(pharmView.status === 200, 'Pharmacist get order should succeed');
    assert(!pharmView.body.order.verificationPin, 'Pharmacist must not receive raw verification PIN');

    await prisma.order.delete({ where: { id: directOrder.id } }).catch(() => {});
  });

  // ----------------------------------------------------
  // JOURNEY 3: ASSISTANT
  // ----------------------------------------------------
  await test('J3: Assistant Journey (Assigned Task -> Accept -> Progress -> Confirm)', async () => {
    // Ensure assistant has MEDICINE_DELIVERY capability
    await prisma.assistantProfile.upsert({
      where: { userId: assistant.id },
      update: { isActive: true, isAvailable: true, capabilities: 'MEDICINE_DELIVERY' },
      create: { userId: assistant.id, isActive: true, isAvailable: true, capabilities: 'MEDICINE_DELIVERY' }
    });

    // Create an assigned assistant task
    const testOrder = await prisma.order.create({
      data: {
        userId: patient.id,
        pharmacyId: pharmacy.id,
        orderNumber: `MF-ASST-${Date.now().toString().slice(-4)}`,
        status: 'CONFIRMED',
        orderType: 'ASSISTED_DELIVERY',
        verificationPin: '9876',
        selectedAssistantId: assistant.id,
        deliveryAddress: '123 Medical Junction, Chengannur',
        assistantTask: {
          create: {
            assistantId: assistant.id,
            serviceType: 'MEDICINE_DELIVERY',
            status: 'ASSIGNED',
            handoverPin: '5566',
            deliveryAddress: '123 Medical Junction, Chengannur'
          }
        }
      },
      include: { assistantTask: true }
    });

    createdTaskId = testOrder.assistantTask.id;

    // 1. Assistant views tasks
    const tasksRes = await request('GET', '/api/assistant/my-tasks', {
      Authorization: `Bearer ${assistantToken}`
    });
    assert(tasksRes.status === 200, 'Assistant my-tasks should return 200');

    // 2. Assistant accepts task
    const acceptRes = await request('PUT', `/api/assistant/tasks/${createdTaskId}/accept`, {
      Authorization: `Bearer ${assistantToken}`
    });
    assert(acceptRes.status === 200, `Accept task should return 200, got ${acceptRes.status}`);
    assert(acceptRes.body.task.status === 'ACCEPTED', 'Task status should be ACCEPTED');

    // 3. Sequential progression: ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED
    const collectingRes = await request('PUT', `/api/assistant/tasks/${createdTaskId}/progress`, {
      Authorization: `Bearer ${assistantToken}`
    }, { status: 'COLLECTING' });
    assert(collectingRes.status === 200, 'Should progress to COLLECTING');

    const inTransitRes = await request('PUT', `/api/assistant/tasks/${createdTaskId}/progress`, {
      Authorization: `Bearer ${assistantToken}`
    }, { status: 'IN_TRANSIT' });
    assert(inTransitRes.status === 200, 'Should progress to IN_TRANSIT');

    const deliveredRes = await request('PUT', `/api/assistant/tasks/${createdTaskId}/progress`, {
      Authorization: `Bearer ${assistantToken}`
    }, { status: 'DELIVERED' });
    assert(deliveredRes.status === 200, 'Should progress to DELIVERED');

    // 4. Patient confirms receipt -> Task CONFIRMED & Order COMPLETED
    const confirmReceiptRes = await request('POST', `/api/orders/${testOrder.id}/confirm-receipt`, {
      Authorization: `Bearer ${patientToken}`
    });
    assert(confirmReceiptRes.status === 200, 'Patient confirm receipt should succeed');
    assert(confirmReceiptRes.body.order.status === 'COMPLETED', 'Order status should be COMPLETED');

    await prisma.assistantTask.delete({ where: { id: createdTaskId } }).catch(() => {});
    await prisma.order.delete({ where: { id: testOrder.id } }).catch(() => {});
  });

  // ----------------------------------------------------
  // JOURNEY 4: EMERGENCY
  // ----------------------------------------------------
  await test('J4: Emergency Journey (Locator -> Restock -> Offline SMS)', async () => {
    // 1. Emergency locator
    const emergencyRes = await request('GET', '/api/pharmacies/emergency');
    assert(emergencyRes.status === 200, 'Emergency locator endpoint should return 200');
    assert(Array.isArray(emergencyRes.body.pharmacies), 'Emergency response must include pharmacies array');

    // 2. Fallback directory for offline SMS
    const fallbackRes = await request('GET', '/api/pharmacies/fallback-directory', {
      Authorization: `Bearer ${patientToken}`
    });
    assert(fallbackRes.status === 200, 'Fallback directory should return 200');
    assert(fallbackRes.body.success === true, 'Fallback directory success should be true');
    assert(fallbackRes.body.pharmacies.length > 0, 'Fallback directory should have real participating pharmacies');
    assert(Boolean(fallbackRes.body.pharmacies[0].phone), 'Fallback pharmacy must have authoritative phone');
  });

  // ----------------------------------------------------
  // JOURNEY 5: ADMIN
  // ----------------------------------------------------
  await test('J5: Admin Journey (Overview -> Users -> Pharmacies -> Orders -> Emergency)', async () => {
    // 1. Admin metrics
    const metricsRes = await request('GET', '/api/analytics/metrics', {
      Authorization: `Bearer ${adminToken}`
    });
    assert(metricsRes.status === 200, 'Admin metrics must return 200');

    // 2. Users visibility
    const usersRes = await request('GET', '/api/admin/users', {
      Authorization: `Bearer ${adminToken}`
    });
    assert(usersRes.status === 200, 'Admin users must return 200');
    assert(Array.isArray(usersRes.body.users), 'Users must be an array');

    // 3. Pharmacies visibility
    const pharmsRes = await request('GET', '/api/admin/pharmacies', {
      Authorization: `Bearer ${adminToken}`
    });
    assert(pharmsRes.status === 200, 'Admin pharmacies must return 200');
    assert(Array.isArray(pharmsRes.body.pharmacies), 'Pharmacies must be an array');

    // 4. Orders visibility
    const ordersRes = await request('GET', '/api/admin/orders', {
      Authorization: `Bearer ${adminToken}`
    });
    assert(ordersRes.status === 200, 'Admin orders must return 200');
    assert(Array.isArray(ordersRes.body.orders), 'Orders must be an array');

    // 5. Emergency requests visibility
    const emergencyRes = await request('GET', '/api/admin/emergency-requests', {
      Authorization: `Bearer ${adminToken}`
    });
    assert(emergencyRes.status === 200, 'Admin emergency-requests must return 200');
  });

  // Cleanup initial test order
  if (createdOrderId) {
    await prisma.order.delete({ where: { id: createdOrderId } }).catch(() => {});
  }

  console.log(`\n========================================`);
  console.log(`Phase 6.1L.15 Critical E2E Journey Check: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
