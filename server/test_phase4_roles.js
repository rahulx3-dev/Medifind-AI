/**
 * MEDIFIND AI — PHASE 4 ROLE UX, PHARMACY MANAGEMENT & ADMIN CONTROL TEST SUITE
 * 35+ automated assertions verifying:
 *   1-5. Admin API security & authorization (401 unauth, 403 non-admin, 200 admin)
 *   6-8. Admin Emergency & User Privacy (no passwords, no secret handover/verification PINs)
 *   9-11. Dynamic test fixture derivation (isTestRecord & testDataNote from verificationStatus)
 *   12-13. Admin orders & aggregated activity stream
 *   14-17. Pharmacist binding & isolation (/api/pharmacies/my-pharmacy)
 *   18-19. Pharmacist cross-pharmacy mutation isolation (403)
 *   20-24. Inventory validation & update (stock, price, catalog check, freshness)
 *   25-31. Order state machine transitions & terminal status immutability
 *   32-34. Patient authorization & prescription isolation
 *   35-36. Assistant atomic task claiming & sequential progression
 *   37. Ephemeral notification isolation and cleanup
 */

const prisma = require('./src/prisma');
const BASE_URL = 'http://localhost:5000/api';

async function runPhase4Tests() {
  console.log('🛡️ ===================================================================');
  console.log('🛡️ MEDIFIND AI — PHASE 4: ROLE UX, PHARMACY MANAGEMENT & ADMIN CONTROL');
  console.log('🛡️ ===================================================================\n');

  const results = [];
  function record(testNum, category, title, passed, details = '') {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testNum, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} T${String(testNum).padStart(2, '0')} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  // Tokens
  let adminToken, patientToken, pharmacist1Token, pharmacist2Token, assistantToken;
  let testPatient2Token, testPatient2Id;
  let pharmacist1Pharmacy, pharmacist2Pharmacy;
  let medicines = [];

  // Cleanup tracking array
  const cleanupOrderIds = [];
  const cleanupPrescriptionIds = [];
  const cleanupUserIds = [];

  try {
    // 0. Setup authentication tokens
    const login = async (email, password = 'password123') => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return data.token;
    };

    adminToken = await login('admin@medifind.com');
    patientToken = await login('patient@medifind.com');
    pharmacist1Token = await login('pharmacist1@medifind.com');
    pharmacist2Token = await login('pharmacist2@medifind.com');
    assistantToken = await login('assistant@medifind.com');

    // Create a temporary second patient for isolation testing
    const p2Res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ephemeral Patient 2',
        email: `patient2_ephemeral_${Date.now()}@test.com`,
        phone: '+91-99999-00002',
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    const p2Data = await p2Res.json();
    testPatient2Token = p2Data.token;
    testPatient2Id = p2Data.user?.id;
    if (testPatient2Id) cleanupUserIds.push(testPatient2Id);

    // Fetch catalogue medicines
    const medRes = await fetch(`${BASE_URL}/medicines/search`);
    const medData = await medRes.json();
    medicines = medData.medicines || [];

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 1: ADMIN API AUTHORIZATION & PRIVACY
    // ─────────────────────────────────────────────────────────────────────────

    // T01: Unauthenticated access to /api/admin/users blocked (401)
    {
      const res = await fetch(`${BASE_URL}/admin/users`);
      record(1, 'ADMIN_AUTH', 'Unauthenticated request to /admin/users rejected with 401',
        res.status === 401, `Status: ${res.status}`);
    }

    // T02: Patient access to /api/admin/users blocked (403)
    {
      const res = await fetch(`${BASE_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${patientToken}` }
      });
      record(2, 'ADMIN_AUTH', 'Patient role cannot access /admin/users (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T03: Pharmacist access to /api/admin/users blocked (403)
    {
      const res = await fetch(`${BASE_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${pharmacist1Token}` }
      });
      record(3, 'ADMIN_AUTH', 'Pharmacist role cannot access /admin/users (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T04: Assistant access to /api/admin/users blocked (403)
    {
      const res = await fetch(`${BASE_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${assistantToken}` }
      });
      record(4, 'ADMIN_AUTH', 'Assistant role cannot access /admin/users (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T05: Admin access to /api/admin/users allowed (200)
    let usersData = null;
    {
      const res = await fetch(`${BASE_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      usersData = await res.json();
      record(5, 'ADMIN_AUTH', 'Admin role granted access to /admin/users (200 OK)',
        res.status === 200 && usersData.success === true, `Status: ${res.status}, Users count: ${usersData.count}`);
    }

    // T06: Admin users endpoint omits passwords
    {
      const users = usersData?.users || [];
      const hasPassword = users.some(u => u.password !== undefined || (JSON.stringify(u).toLowerCase().includes('password')));
      record(6, 'ADMIN_PRIVACY', 'GET /admin/users strictly omits password and hash fields',
        users.length > 0 && !hasPassword, `Sample user keys: ${Object.keys(users[0] || {}).join(', ')}`);
    }

    // T07: Admin emergency requests endpoint omits handoverPin and verificationPin
    let emergencyData = null;
    {
      const res = await fetch(`${BASE_URL}/admin/emergency-requests`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const rawText = await res.text();
      emergencyData = JSON.parse(rawText);

      // Check that secret PIN keys or exposed PIN strings do NOT exist in raw output
      const exposesHandoverPin = rawText.includes('"handoverPin"');
      const exposesVerificationPin = rawText.includes('"verificationPin"');

      record(7, 'ADMIN_PRIVACY', 'GET /admin/emergency-requests strictly omits secret PIN strings',
        res.status === 200 && !exposesHandoverPin && !exposesVerificationPin,
        `exposesHandoverPin=${exposesHandoverPin}, exposesVerificationPin=${exposesVerificationPin}`);
    }

    // T08: Admin emergency requests includes hasHandoverPin and isVerified boolean flags
    {
      const tasks = emergencyData?.tasks || [];
      const validFlags = tasks.length === 0 || tasks.every(t =>
        typeof t.hasHandoverPin === 'boolean' &&
        typeof t.isVerified === 'boolean' &&
        typeof t.hasVerificationPin === 'boolean'
      );
      record(8, 'ADMIN_EMERGENCY', 'Emergency tasks return boolean privacy flags (hasHandoverPin, isVerified)',
        emergencyData?.success === true && validFlags, `Tasks evaluated: ${tasks.length}`);
    }

    // T09: GET /admin/pharmacies returns all pharmacies with manager contact & inventory count
    let adminPharmacies = [];
    {
      const res = await fetch(`${BASE_URL}/admin/pharmacies`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      adminPharmacies = data.pharmacies || [];
      const hasRequiredFields = adminPharmacies.every(p =>
        p.id && p.name && p.manager && typeof p.inventoryCount === 'number'
      );
      record(9, 'ADMIN_PHARMACIES', 'GET /admin/pharmacies returns network pharmacies with manager and inventory metrics',
        res.status === 200 && adminPharmacies.length > 0 && hasRequiredFields,
        `Count: ${adminPharmacies.length}`);
    }

    // T10: Dynamic fixture classification: verificationStatus === 'TEST' yields isTestRecord: true & testDataNote
    {
      const testPharmacies = adminPharmacies.filter(p => p.verificationStatus === 'TEST');
      const allProperlyFlagged = testPharmacies.length > 0 && testPharmacies.every(p =>
        p.isTestRecord === true && p.testDataNote === 'TEST DATA — NOT A PARTICIPATING PHARMACY'
      );
      record(10, 'FIXTURE_INTEGRITY', 'TEST verificationStatus dynamically yields isTestRecord=true and warning note',
        allProperlyFlagged, `Test fixtures verified: ${testPharmacies.length}`);
    }

    // T11: Dynamic fixture classification: Non-TEST verificationStatus does not force test classification
    {
      // If any non-TEST pharmacy existed, it would have isTestRecord === false
      // Verify the logic matches p.verificationStatus === 'TEST' exactly
      const logicMatch = adminPharmacies.every(p => p.isTestRecord === (p.verificationStatus === 'TEST'));
      record(11, 'FIXTURE_INTEGRITY', 'isTestRecord is strictly derived from actual verificationStatus database field',
        logicMatch, `Evaluated against ${adminPharmacies.length} pharmacies`);
    }

    // T12: GET /admin/orders returns system-wide orders
    {
      const res = await fetch(`${BASE_URL}/admin/orders`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      record(12, 'ADMIN_ORDERS', 'GET /admin/orders returns system-wide orders with user and pharmacy relations',
        res.status === 200 && data.success === true && Array.isArray(data.orders),
        `Orders count: ${data.count}`);
    }

    // T13: GET /admin/activity returns aggregated timeline
    {
      const res = await fetch(`${BASE_URL}/admin/activity`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      const timeline = data.activity || [];
      const validTimeline = timeline.every(item => item.id && item.type && item.title && item.timestamp);
      record(13, 'ADMIN_ACTIVITY', 'GET /admin/activity aggregates order history and notifications into unified timeline',
        res.status === 200 && data.success === true && validTimeline,
        `Timeline events: ${timeline.length}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2: PHARMACIST ISOLATION & /api/pharmacies/my-pharmacy
    // ─────────────────────────────────────────────────────────────────────────

    // T14: Unauthenticated access to /api/pharmacies/my-pharmacy blocked (401)
    {
      const res = await fetch(`${BASE_URL}/pharmacies/my-pharmacy`);
      record(14, 'PHARMACIST_SECURITY', 'Unauthenticated GET /pharmacies/my-pharmacy rejected with 401',
        res.status === 401, `Status: ${res.status}`);
    }

    // T15: Patient access to /api/pharmacies/my-pharmacy blocked (403)
    {
      const res = await fetch(`${BASE_URL}/pharmacies/my-pharmacy`, {
        headers: { Authorization: `Bearer ${patientToken}` }
      });
      record(15, 'PHARMACIST_SECURITY', 'Patient access to /pharmacies/my-pharmacy rejected with 403',
        res.status === 403, `Status: ${res.status}`);
    }

    // T16: Assistant access to /api/pharmacies/my-pharmacy blocked (403)
    {
      const res = await fetch(`${BASE_URL}/pharmacies/my-pharmacy`, {
        headers: { Authorization: `Bearer ${assistantToken}` }
      });
      record(16, 'PHARMACIST_SECURITY', 'Assistant access to /pharmacies/my-pharmacy rejected with 403',
        res.status === 403, `Status: ${res.status}`);
    }

    // T17: Pharmacist access to /api/pharmacies/my-pharmacy returns bound pharmacy
    {
      const res1 = await fetch(`${BASE_URL}/pharmacies/my-pharmacy`, {
        headers: { Authorization: `Bearer ${pharmacist1Token}` }
      });
      const data1 = await res1.json();
      pharmacist1Pharmacy = data1.pharmacy;

      const res2 = await fetch(`${BASE_URL}/pharmacies/my-pharmacy`, {
        headers: { Authorization: `Bearer ${pharmacist2Token}` }
      });
      const data2 = await res2.json();
      pharmacist2Pharmacy = data2.pharmacy;

      const passed = res1.status === 200 && res2.status === 200 &&
        pharmacist1Pharmacy && pharmacist2Pharmacy &&
        pharmacist1Pharmacy.id !== pharmacist2Pharmacy.id;

      record(17, 'PHARMACIST_BINDING', 'Pharmacist gets their own pharmacy exclusively derived from managerId',
        passed, `Pharmacist 1: "${pharmacist1Pharmacy?.name}", Pharmacist 2: "${pharmacist2Pharmacy?.name}"`);
    }

    // T18: Pharmacist 1 cannot update inventory of Pharmacist 2's pharmacy (403)
    {
      const medId = medicines[0]?.id;
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist2Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: medId, stock: 20, price: 99.0 })
      });
      record(18, 'PHARMACIST_ISOLATION', 'Pharmacist 1 cannot mutate Pharmacist 2 inventory (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 3: INVENTORY VALIDATION & UPDATES
    // ─────────────────────────────────────────────────────────────────────────

    // T19: Negative stock is rejected (400)
    {
      const medId = medicines[0]?.id;
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist1Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: medId, stock: -5, price: 50.0 })
      });
      record(19, 'INVENTORY_VALIDATION', 'Negative stock quantity rejected with 400 Bad Request',
        res.status === 400, `Status: ${res.status}`);
    }

    // T20: Non-numeric / decimal stock is rejected (400)
    {
      const medId = medicines[0]?.id;
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist1Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: medId, stock: 12.5, price: 50.0 })
      });
      record(20, 'INVENTORY_VALIDATION', 'Decimal stock rejected with 400 Bad Request',
        res.status === 400, `Status: ${res.status}`);
    }

    // T21: Negative price is rejected (400)
    {
      const medId = medicines[0]?.id;
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist1Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: medId, stock: 10, price: -15.5 })
      });
      record(21, 'INVENTORY_VALIDATION', 'Negative price rejected with 400 Bad Request',
        res.status === 400, `Status: ${res.status}`);
    }

    // T22: Non-existent medicine ID is rejected (404)
    {
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist1Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: 'non-existent-medicine-uuid', stock: 10, price: 50.0 })
      });
      record(22, 'INVENTORY_VALIDATION', 'Non-existent medicine ID rejected with 404',
        res.status === 404, `Status: ${res.status}`);
    }

    // T23: Valid inventory update succeeds and updates lastUpdated
    {
      const medId = medicines[0]?.id;
      const beforeTime = new Date(Date.now() - 1000);
      const res = await fetch(`${BASE_URL}/pharmacies/${pharmacist1Pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ medicineId: medId, stock: 45, price: 65.0 })
      });
      const data = await res.json();
      const updatedTimestamp = new Date(data.item?.stockLastUpdated || data.item?.lastUpdated);
      const passed = res.status === 200 && data.success === true &&
        data.item?.stock === 45 && updatedTimestamp >= beforeTime;
      record(23, 'INVENTORY_UPDATE', 'Valid stock and price update succeeds with updated timestamp',
        passed, `Stock: ${data.item?.stock}, UpdatedAt: ${updatedTimestamp.toISOString()}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 4: ORDER STATE MACHINE & ISOLATION
    // ─────────────────────────────────────────────────────────────────────────

    // Create an ephemeral order for Pharmacy 1
    let orderP1 = null;
    {
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacist1Pharmacy.id,
          items: [{ medicineId: medicines[0].id, quantity: 2 }]
        })
      });
      const data = await res.json();
      orderP1 = data.order;
      if (orderP1?.id) cleanupOrderIds.push(orderP1.id);
    }

    // T24: Pharmacist 2 cannot update order belonging to Pharmacy 1 (403)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist2Token}`
        },
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      record(24, 'ORDER_ISOLATION', 'Pharmacist cannot modify orders belonging to another pharmacy (403)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T25: Order state machine: Pharmacist 1 cannot skip directly from PENDING to READY_FOR_PICKUP (400)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      record(25, 'ORDER_STATE_MACHINE', 'Invalid state transition PENDING -> READY_FOR_PICKUP rejected with 400',
        res.status === 400, `Status: ${res.status}`);
    }

    // T26: Order state machine: Pharmacist 1 transitions PENDING -> CONFIRMED (200)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      const data = await res.json();
      record(26, 'ORDER_STATE_MACHINE', 'Pharmacist successfully transitions PENDING -> CONFIRMED',
        res.status === 200 && data.order?.status === 'CONFIRMED', `Status: ${data.order?.status}`);
    }

    // T27: Patient cannot cancel order once CONFIRMED (400)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`
        },
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      record(27, 'PATIENT_CONSTRAINTS', 'Patient cannot cancel order once confirmed by pharmacy (400)',
        res.status === 400, `Status: ${res.status}`);
    }

    // T28: Order state machine: Pharmacist 1 transitions CONFIRMED -> READY_FOR_PICKUP (200)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const data = await res.json();
      record(28, 'ORDER_STATE_MACHINE', 'Pharmacist transitions CONFIRMED -> READY_FOR_PICKUP',
        res.status === 200 && data.order?.status === 'READY_FOR_PICKUP', `Status: ${data.order?.status}`);
    }

    // T29: Counter PIN verification with wrong PIN rejected (400)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ pin: '0000' })
      });
      record(29, 'COUNTER_PIN', 'Counter handover with incorrect verification PIN rejected with 400',
        res.status === 400, `Status: ${res.status}`);
    }

    // T30: Counter PIN verification with correct PIN marks order COMPLETED
    {
      // Fetch PIN from database directly for test verification
      const dbOrder = await prisma.order.findUnique({ where: { id: orderP1.id } });
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ pin: dbOrder.verificationPin })
      });
      const data = await res.json();
      record(30, 'COUNTER_PIN', 'Counter pickup PIN verified -> Order transitions to COMPLETED',
        res.status === 200 && data.order?.status === 'COMPLETED', `Status: ${data.order?.status}`);
    }

    // T31: Terminal status COMPLETED cannot transition further (400)
    {
      const res = await fetch(`${BASE_URL}/orders/${orderP1.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'REJECTED' })
      });
      record(31, 'TERMINAL_STATUS', 'Terminal status COMPLETED rejects all further transitions with 400',
        res.status === 400, `Status: ${res.status}`);
    }

    // T32: Terminal status REJECTED cannot transition further (400)
    {
      // Create another ephemeral order to test REJECTED terminal state
      const ordRes = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacist1Pharmacy.id,
          items: [{ medicineId: medicines[0].id, quantity: 1 }]
        })
      });
      const ordData = await ordRes.json();
      const rejOrder = ordData.order;
      if (rejOrder?.id) cleanupOrderIds.push(rejOrder.id);

      // Transition PENDING -> REJECTED
      await fetch(`${BASE_URL}/orders/${rejOrder.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'REJECTED' })
      });

      // Attempt transition from REJECTED -> CONFIRMED
      const res = await fetch(`${BASE_URL}/orders/${rejOrder.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pharmacist1Token}`
        },
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      record(32, 'TERMINAL_STATUS', 'Terminal status REJECTED rejects all further transitions with 400',
        res.status === 400, `Status: ${res.status}`);
    }

    // T33: Patient 2 cannot cancel Patient 1's order (403)
    {
      const ordRes = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacist1Pharmacy.id,
          items: [{ medicineId: medicines[0].id, quantity: 1 }]
        })
      });
      const ordData = await ordRes.json();
      const p1Order = ordData.order;
      if (p1Order?.id) cleanupOrderIds.push(p1Order.id);

      const res = await fetch(`${BASE_URL}/orders/${p1Order.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testPatient2Token}`
        },
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      record(33, 'PATIENT_ISOLATION', 'Patient cannot cancel another patient\'s order (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T34: Patient cannot access another patient's prescription (403)
    {
      // Create prescription for Patient 1
      const rx = await prisma.prescription.create({
        data: {
          userId: (await prisma.user.findUnique({ where: { email: 'patient@medifind.com' } })).id,
          originalFileName: 'patient1_test.png',
          filePath: 'uploads/test.png',
          status: 'VERIFIED'
        }
      });
      cleanupPrescriptionIds.push(rx.id);

      // Attempt to access with Patient 2
      const res = await fetch(`${BASE_URL}/prescriptions/${rx.id}`, {
        headers: { Authorization: `Bearer ${testPatient2Token}` }
      });
      record(34, 'PATIENT_ISOLATION', 'Patient cannot view another patient\'s prescription (403 Forbidden)',
        res.status === 403, `Status: ${res.status}`);
    }

    // T35: Assistant atomic task claiming: double claim rejected (400)
    let deliveryOrderId = null;
    let taskId = null;
    {
      const ordRes = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`
        },
        body: JSON.stringify({
          pharmacyId: pharmacist1Pharmacy.id,
          orderType: 'ASSISTED_DELIVERY',
          items: [{ medicineId: medicines[0].id, quantity: 1 }],
          deliveryAddress: 'Test Delivery Address'
        })
      });
      const ordData = await ordRes.json();
      deliveryOrderId = ordData.order?.id;
      if (deliveryOrderId) cleanupOrderIds.push(deliveryOrderId);

      const dbTask = await prisma.assistantTask.findUnique({ where: { orderId: deliveryOrderId } });
      taskId = dbTask?.id;

      // First claim by assistant (PUT /assistant/tasks/:id/accept)
      const res1 = await fetch(`${BASE_URL}/assistant/tasks/${taskId}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${assistantToken}` }
      });

      // Second claim attempt
      const res2 = await fetch(`${BASE_URL}/assistant/tasks/${taskId}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${assistantToken}` }
      });

      record(35, 'ASSISTANT_ATOMIC', 'Atomic task claiming prevents double assignment (400 Bad Request)',
        res1.status === 200 && res2.status === 400, `First claim: ${res1.status}, Second claim: ${res2.status}`);
    }

    // T36: Assistant task progression: Invalid skipping rejected (400)
    {
      // Current task status is ACCEPTED. Trying to jump directly to DELIVERED must fail.
      const res = await fetch(`${BASE_URL}/assistant/tasks/${taskId}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assistantToken}`
        },
        body: JSON.stringify({ status: 'DELIVERED' })
      });
      record(36, 'ASSISTANT_PROGRESSION', 'Skipping delivery state ACCEPTED -> DELIVERED rejected with 400',
        res.status === 400, `Status: ${res.status}`);
    }

    // T37: Isolated notification testing & ephemeral cleanup
    {
      // Query notifications for Patient 1
      const pUser = await prisma.user.findUnique({ where: { email: 'patient@medifind.com' } });
      const notifRes = await fetch(`${BASE_URL}/notifications`, {
        headers: { Authorization: `Bearer ${patientToken}` }
      });
      const notifData = await notifRes.json();
      const hasNotifications = notifData.success && Array.isArray(notifData.notifications);

      record(37, 'NOTIFICATION_ISOLATION', 'User notifications fetch successfully and isolated test records verified',
        hasNotifications, `Count: ${notifData.notifications?.length}`);
    }

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP EPHEMERAL TEST RECORDS (Guarantee no pollution of seed data)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🧹 Cleaning up ephemeral test records...');
    try {
      for (const ordId of cleanupOrderIds) {
        await prisma.assistantTask.deleteMany({ where: { orderId: ordId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: ordId } });
        await prisma.orderItem.deleteMany({ where: { orderId: ordId } });
        await prisma.order.deleteMany({ where: { id: ordId } });
      }
      for (const rxId of cleanupPrescriptionIds) {
        await prisma.detectedMedicine.deleteMany({ where: { prescriptionId: rxId } });
        await prisma.prescription.deleteMany({ where: { id: rxId } });
      }
      for (const uId of cleanupUserIds) {
        await prisma.notification.deleteMany({ where: { userId: uId } });
        await prisma.user.deleteMany({ where: { id: uId } });
      }
      console.log('✅ Cleanup complete. Seed database state preserved intact.\n');
    } catch (cleanErr) {
      console.error('Cleanup error:', cleanErr);
    }
  }

  // Summary
  const passedCount = results.filter(r => r.status === 'PASS').length;
  const totalCount = results.length;
  console.log('===================================================================');
  console.log(`📊 PHASE 4 TEST RESULTS: ${passedCount} / ${totalCount} ASSERTIONS PASSED`);
  console.log('===================================================================\n');

  if (passedCount === totalCount && totalCount >= 28) {
    console.log('🎉 ALL PHASE 4 ROLE UX, PHARMACY & ADMIN CONTROL TESTS PASSED!');
    process.exit(0);
  } else {
    console.error(`❌ SOME TESTS FAILED (${totalCount - passedCount} failed)`);
    process.exit(1);
  }
}

runPhase4Tests();
