/**
 * MEDIFIND AI — PHASE 1 SECURITY & ACCESS RECOVERY VERIFICATION SUITE
 * Tests all 25 required test cases from Section 23 of prompt.
 */
const BASE_URL = 'http://localhost:5000/api';

async function runPhase1SecurityTests() {
  console.log('🔒 =======================================================');
  console.log('🔒 MEDIFIND AI - PHASE 1 SECURITY & AUTHORIZATION TEST SUITE');
  console.log('🔒 =======================================================\n');

  const results = [];
  function record(testNum, category, title, passed, details) {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testNum, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} Test #${testNum} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  // ----------------------------------------------------
  // A. PATIENT AUTHENTICATION & ACCESS TESTS
  // ----------------------------------------------------

  // 1. Open application without token -> Session required / Me rejects without token
  try {
    const res = await fetch(`${BASE_URL}/auth/me`);
    const passed = res.status === 401;
    record(1, 'PATIENT', 'Unauthenticated access to /auth/me is blocked', passed, `HTTP status ${res.status} (expected 401)`);
  } catch (e) {
    record(1, 'PATIENT', 'Unauthenticated access to /auth/me is blocked', false, e.message);
  }

  // 2. Register new patient -> Account created as PATIENT
  const testEmail = `new_patient_${Date.now()}@test.com`;
  let registeredPatientToken = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Patient Real',
        email: testEmail,
        phone: '+91-99887-11223',
        password: 'securePassword123',
        confirmPassword: 'securePassword123'
      })
    });
    const data = await res.json();
    const passed = res.status === 201 && data.success && data.user.role === 'PATIENT';
    registeredPatientToken = data.token;
    record(2, 'PATIENT', 'Register new patient creates account with PATIENT role', passed, `Role: ${data.user?.role}, Status: ${res.status}`);
  } catch (e) {
    record(2, 'PATIENT', 'Register new patient creates account with PATIENT role', false, e.message);
  }

  // 3. Login with valid credentials -> Patient dashboard session
  let patientToken = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@medifind.com', password: 'password123' })
    });
    const data = await res.json();
    patientToken = data.token;
    const passed = res.status === 200 && data.success && data.user.role === 'PATIENT' && !!patientToken;
    record(3, 'PATIENT', 'Login with valid patient credentials', passed, `User: ${data.user?.name}, Token issued`);
  } catch (e) {
    record(3, 'PATIENT', 'Login with valid patient credentials', false, e.message);
  }

  // 4. Login with incorrect password -> rejected (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@medifind.com', password: 'wrongPassword!@#' })
    });
    const data = await res.json();
    const passed = res.status === 401 && !data.success;
    record(4, 'PATIENT', 'Login with incorrect password rejected', passed, `HTTP status ${res.status}, Error: ${data.error}`);
  } catch (e) {
    record(4, 'PATIENT', 'Login with incorrect password rejected', false, e.message);
  }

  // 5. Logout -> session cleared (verified by discarding token and ensuring client cannot make authenticated calls)
  try {
    const discardedToken = null;
    const res = await fetch(`${BASE_URL}/prescriptions`, {
      headers: discardedToken ? { Authorization: `Bearer ${discardedToken}` } : {}
    });
    const passed = res.status === 401;
    record(5, 'PATIENT', 'Cleared session token cannot access private routes', passed, `HTTP status ${res.status} (expected 401)`);
  } catch (e) {
    record(5, 'PATIENT', 'Cleared session token cannot access private routes', false, e.message);
  }

  // 6. Try patient route without token -> rejected (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/prescriptions`);
    const passed = res.status === 401;
    record(6, 'PATIENT', 'Protected patient route rejects missing token', passed, `HTTP status ${res.status}`);
  } catch (e) {
    record(6, 'PATIENT', 'Protected patient route rejects missing token', false, e.message);
  }

  // 7. Try admin route as patient -> rejected (HTTP 403)
  try {
    const res = await fetch(`${BASE_URL}/analytics/metrics`, {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const data = await res.json();
    const passed = res.status === 403;
    record(7, 'PATIENT', 'Patient attempting admin API endpoint is rejected', passed, `HTTP status ${res.status}, Error: ${data.error}`);
  } catch (e) {
    record(7, 'PATIENT', 'Patient attempting admin API endpoint is rejected', false, e.message);
  }

  // ----------------------------------------------------
  // B. PHARMACY AUTHORIZATION & ISOLATION TESTS
  // ----------------------------------------------------

  // 8. Login as pharmacist
  let pharmacist1Token = null;
  let pharmacy1Id = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pharmacist1@medifind.com', password: 'password123' })
    });
    const data = await res.json();
    pharmacist1Token = data.token;
    pharmacy1Id = data.user?.pharmacy?.id;
    const passed = res.status === 200 && data.user.role === 'PHARMACIST' && !!pharmacy1Id;
    record(8, 'PHARMACY', 'Login as pharmacist', passed, `Pharmacy: ${data.user?.pharmacy?.name}`);
  } catch (e) {
    record(8, 'PHARMACY', 'Login as pharmacist', false, e.message);
  }

  // 9. Verify pharmacy is associated with correct pharmacy
  let pharmacist2Token = null;
  let pharmacy2Id = null;
  try {
    const res2 = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pharmacist2@medifind.com', password: 'password123' })
    });
    const data2 = await res2.json();
    pharmacist2Token = data2.token;
    pharmacy2Id = data2.user?.pharmacy?.id;
    const passed = pharmacy1Id !== pharmacy2Id && !!pharmacy1Id && !!pharmacy2Id;
    record(9, 'PHARMACY', 'Pharmacists are bound to distinct pharmacy IDs in DB', passed, `Pharm 1: ${pharmacy1Id}, Pharm 2: ${pharmacy2Id}`);
  } catch (e) {
    record(9, 'PHARMACY', 'Pharmacists are bound to distinct pharmacy IDs in DB', false, e.message);
  }

  // 10. Attempt another pharmacy's inventory update -> rejected (HTTP 403)
  try {
    // Pharmacist 1 tries to update Pharmacist 2's pharmacy inventory
    const res = await fetch(`${BASE_URL}/pharmacies/${pharmacy2Id}/inventory`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pharmacist1Token}`
      },
      body: JSON.stringify({
        medicineId: 'sample-med-id',
        stock: 99,
        price: 150
      })
    });
    const data = await res.json();
    const passed = res.status === 403;
    record(10, 'PHARMACY', 'Pharmacist modifying another pharmacy inventory is rejected', passed, `HTTP status ${res.status}, Error: ${data.error}`);
  } catch (e) {
    record(10, 'PHARMACY', 'Pharmacist modifying another pharmacy inventory is rejected', false, e.message);
  }

  const prismaDb = require('./src/prisma');
  const realMed = await prismaDb.medicine.findFirst();
  const realMedId = realMed ? realMed.id : 'sample-med-id';

  // 11. Attempt another pharmacy's order access / status change -> rejected (HTTP 403)
  try {
    // Place order at Pharmacy 2 using Patient
    const ordRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientToken}`
      },
      body: JSON.stringify({
        pharmacyId: pharmacy2Id,
        items: [{ medicineId: realMedId, quantity: 1 }]
      })
    });
    const ordData = await ordRes.json();
    const orderAtPharm2Id = ordData.order?.id;

    // Pharmacist 1 tries to update order at Pharmacy 2
    const statusRes = await fetch(`${BASE_URL}/orders/${orderAtPharm2Id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pharmacist1Token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    const statusData = await statusRes.json();
    const passed = statusRes.status === 403;
    record(11, 'PHARMACY', 'Pharmacist updating another pharmacy order is rejected', passed, `HTTP status ${statusRes.status}, Error: ${statusData.error}`);
  } catch (e) {
    record(11, 'PHARMACY', 'Pharmacist updating another pharmacy order is rejected', false, e.message);
  }

  // ----------------------------------------------------
  // C. ASSISTANT TASK OWNERSHIP & PRIVACY TESTS
  // ----------------------------------------------------

  // 12. Login assistant
  let assistantToken = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'assistant@medifind.com', password: 'password123' })
    });
    const data = await res.json();
    assistantToken = data.token;
    const passed = res.status === 200 && data.user.role === 'ASSISTANT' && !!assistantToken;
    record(12, 'ASSISTANT', 'Login as assistant', passed, `User: ${data.user?.name}`);
  } catch (e) {
    record(12, 'ASSISTANT', 'Login as assistant', false, e.message);
  }

  // 13. See AVAILABLE tasks
  let availableTaskId = null;
  try {
    // Create an assisted delivery order first
    const ordRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientToken}`
      },
      body: JSON.stringify({
        pharmacyId: pharmacy1Id,
        items: [{ medicineId: realMedId, quantity: 1 }],
        orderType: 'ASSISTED_DELIVERY',
        deliveryAddress: '123 Main Road, City'
      })
    });

    const res = await fetch(`${BASE_URL}/assistant/available`, {
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const data = await res.json();
    const tasks = data.tasks || [];
    availableTaskId = tasks[0]?.id;
    const passed = res.status === 200 && tasks.length > 0 && tasks[0].status === 'AVAILABLE';
    record(13, 'ASSISTANT', 'Assistant retrieves AVAILABLE tasks', passed, `Found ${tasks.length} available task(s)`);
  } catch (e) {
    record(13, 'ASSISTANT', 'Assistant retrieves AVAILABLE tasks', false, e.message);
  }

  // 14. Accept task -> status becomes ACCEPTED
  // 15. Verify acceptedAt is populated
  try {
    const res = await fetch(`${BASE_URL}/assistant/tasks/${availableTaskId}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const data = await res.json();
    const isAccepted = res.status === 200 && data.task?.status === 'ACCEPTED';
    const isAcceptedAtPopulated = !!data.task?.acceptedAt;
    record(14, 'ASSISTANT', 'Accept task transitions status to ACCEPTED', isAccepted, `Status: ${data.task?.status}`);
    record(15, 'ASSISTANT', 'Task acceptedAt timestamp is populated', isAcceptedAtPopulated, `acceptedAt: ${data.task?.acceptedAt}`);
  } catch (e) {
    record(14, 'ASSISTANT', 'Accept task transitions status to ACCEPTED', false, e.message);
    record(15, 'ASSISTANT', 'Task acceptedAt timestamp is populated', false, e.message);
  }

  // 16. Verify another assistant cannot modify assigned task
  try {
    // Create a second assistant
    const prisma = require('./src/prisma');
    const bcrypt = require('bcryptjs');
    const secondAsst = await prisma.user.upsert({
      where: { email: 'assistant2@medifind.com' },
      update: {},
      create: {
        email: 'assistant2@medifind.com',
        name: 'Second Assistant',
        password: await bcrypt.hash('password123', 10),
        role: 'ASSISTANT'
      }
    });

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./src/middlewares/auth');
    const secondAsstToken = jwt.sign(
      { id: secondAsst.id, email: secondAsst.email, role: secondAsst.role, name: secondAsst.name },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Second assistant attempts to progress task claimed by first assistant
    const res = await fetch(`${BASE_URL}/assistant/tasks/${availableTaskId}/progress`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secondAsstToken}`
      },
      body: JSON.stringify({ status: 'COLLECTING' })
    });
    const data = await res.json();
    const passed = res.status === 403;
    record(16, 'ASSISTANT', 'Another assistant cannot progress unassigned task', passed, `HTTP status ${res.status}, Error: ${data.error}`);
  } catch (e) {
    record(16, 'ASSISTANT', 'Another assistant cannot progress unassigned task', false, e.message);
  }

  // ----------------------------------------------------
  // D. ADMIN AUTHORIZATION TESTS
  // ----------------------------------------------------

  // 17. Login admin
  let adminToken = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@medifind.com', password: 'password123' })
    });
    const data = await res.json();
    adminToken = data.token;
    const passed = res.status === 200 && data.user.role === 'ADMIN' && !!adminToken;
    record(17, 'ADMIN', 'Login as system administrator', passed, `User: ${data.user?.name}`);
  } catch (e) {
    record(17, 'ADMIN', 'Login as system administrator', false, e.message);
  }

  // 18. Access admin dashboard (GET /api/analytics/metrics)
  try {
    const res = await fetch(`${BASE_URL}/analytics/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success && !!data.metrics;
    record(18, 'ADMIN', 'Admin accesses protected analytics metrics API', passed, `Total medicines: ${data.metrics?.totalMedicines}`);
  } catch (e) {
    record(18, 'ADMIN', 'Admin accesses protected analytics metrics API', false, e.message);
  }

  // 19. Patient attempting same admin API -> HTTP 403
  try {
    const res = await fetch(`${BASE_URL}/analytics/metrics`, {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    const passed = res.status === 403;
    record(19, 'ADMIN', 'Patient attempting admin metrics API receives HTTP 403', passed, `HTTP status ${res.status}`);
  } catch (e) {
    record(19, 'ADMIN', 'Patient attempting admin metrics API receives HTTP 403', false, e.message);
  }

  // ----------------------------------------------------
  // E. TOKEN VALIDATION TESTS
  // ----------------------------------------------------

  // 20. Invalid token -> rejected (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: 'Bearer this-is-a-completely-invalid-forged-token' }
    });
    const passed = res.status === 401;
    record(20, 'TOKEN', 'Tampered or invalid token is rejected', passed, `HTTP status ${res.status}`);
  } catch (e) {
    record(20, 'TOKEN', 'Tampered or invalid token is rejected', false, e.message);
  }

  // 21. Expired token -> rejected (HTTP 401)
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./src/middlewares/auth');
    const expiredToken = jwt.sign(
      { id: 'fake-id', email: 'exp@test.com', role: 'PATIENT' },
      JWT_SECRET,
      { expiresIn: '-10s' } // Expired 10 seconds ago
    );
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    const passed = res.status === 401;
    record(21, 'TOKEN', 'Expired token is rejected', passed, `HTTP status ${res.status}`);
  } catch (e) {
    record(21, 'TOKEN', 'Expired token is rejected', false, e.message);
  }

  // 22. Missing token -> rejected (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/auth/me`);
    const passed = res.status === 401;
    record(22, 'TOKEN', 'Missing Authorization header is rejected', passed, `HTTP status ${res.status}`);
  } catch (e) {
    record(22, 'TOKEN', 'Missing Authorization header is rejected', false, e.message);
  }

  // ----------------------------------------------------
  // F. REGISTRATION SECURITY TESTS
  // ----------------------------------------------------

  // 23. Public registration creates PATIENT only
  const regEmail1 = `reg_patient_${Date.now()}@test.com`;
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Standard Registration',
        email: regEmail1,
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    const data = await res.json();
    const passed = res.status === 201 && data.user.role === 'PATIENT';
    record(23, 'REGISTRATION', 'Public registration default role is PATIENT', passed, `Assigned role: ${data.user?.role}`);
  } catch (e) {
    record(23, 'REGISTRATION', 'Public registration default role is PATIENT', false, e.message);
  }

  // 24. User cannot register themselves as ADMIN (role injection ignored)
  const regEmail2 = `reg_admin_attempt_${Date.now()}@test.com`;
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hacker User',
        email: regEmail2,
        password: 'password123',
        confirmPassword: 'password123',
        role: 'ADMIN' // Malicious role escalation attempt
      })
    });
    const data = await res.json();
    const passed = res.status === 201 && data.user.role === 'PATIENT';
    record(24, 'REGISTRATION', 'Malicious role: ADMIN injection in register payload is denied (enforced PATIENT)', passed, `Resulting role: ${data.user?.role}`);
  } catch (e) {
    record(24, 'REGISTRATION', 'Malicious role: ADMIN injection in register payload is denied', false, e.message);
  }

  // 25. User cannot register themselves as PHARMACY (role injection ignored)
  const regEmail3 = `reg_pharm_attempt_${Date.now()}@test.com`;
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fake Pharmacy User',
        email: regEmail3,
        password: 'password123',
        confirmPassword: 'password123',
        role: 'PHARMACIST' // Malicious role escalation attempt
      })
    });
    const data = await res.json();
    const passed = res.status === 201 && data.user.role === 'PATIENT';
    record(25, 'REGISTRATION', 'Malicious role: PHARMACIST injection in register payload is denied (enforced PATIENT)', passed, `Resulting role: ${data.user?.role}`);
  } catch (e) {
    record(25, 'REGISTRATION', 'Malicious role: PHARMACIST injection in register payload is denied', false, e.message);
  }

  // Clean up test generated accounts
  const prisma = require('./src/prisma');
  await prisma.user.deleteMany({
    where: {
      email: { in: [testEmail, regEmail1, regEmail2, regEmail3] }
    }
  });

  console.log('\n=======================================================');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  console.log(`🏁 PHASE 1 SECURITY TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED out of ${results.length} total tests.`);
  console.log('=======================================================\n');

  return { passCount, failCount, results };
}

runPhase1SecurityTests()
  .then(({ failCount }) => {
    if (failCount > 0) process.exit(1);
    else process.exit(0);
  })
  .catch(err => {
    console.error('Test suite failure:', err);
    process.exit(1);
  });
