/**
 * Phase 6.1L.14 — Security & Privacy Final Spot Check Test Suite
 *
 * Validates:
 * 1. Protected endpoints reject unauthenticated requests (HTTP 401)
 * 2. Admin endpoints reject non-admin users with HTTP 403
 * 3. Cross-patient address access blocked (HTTP 403/404)
 * 4. Prescription image access blocked for assistants (HTTP 403)
 * 5. Verification PIN and Handover PIN minimization (excluded from unauthorized payloads)
 * 6. User listing strictly omits passwords and password hashes
 * 7. Pharmacist cannot modify inventory of unmanaged pharmacy (HTTP 403)
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
  console.log('=== PHASE 6.1L.14: SECURITY & PRIVACY FINAL SPOT CHECK ===\n');
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

  const patient1Id = 'sec-patient-1';
  const patient2Id = 'sec-patient-2';
  const pharmacist1Id = 'sec-pharmacist-1';
  const assistant1Id = 'sec-assistant-1';

  const patient1Token = makeToken({ id: patient1Id, email: 'p1@sec.test', role: 'PATIENT', name: 'Patient 1' });
  const patient2Token = makeToken({ id: patient2Id, email: 'p2@sec.test', role: 'PATIENT', name: 'Patient 2' });
  const pharmacist1Token = makeToken({ id: pharmacist1Id, email: 'ph1@sec.test', role: 'PHARMACIST', name: 'Pharmacist 1' });
  const assistant1Token = makeToken({ id: assistant1Id, email: 'as1@sec.test', role: 'ASSISTANT', name: 'Assistant 1' });

  // 1. Unauthenticated rejection (401)
  await test('T1: Protected endpoints reject unauthenticated requests with HTTP 401', async () => {
    const endpoints = [
      '/api/orders',
      '/api/addresses',
      '/api/notifications',
      '/api/admin/users',
      '/api/assistant/my-tasks'
    ];
    for (const ep of endpoints) {
      const res = await request('GET', ep);
      assert(res.status === 401, `Endpoint ${ep} should return 401 unauthenticated, got ${res.status}`);
      assert(res.body.success === false, `Endpoint ${ep} should return success: false`);
    }
  });

  // 2. Admin endpoints reject non-admin users with HTTP 403
  await test('T2: Admin endpoints reject non-admin users with HTTP 403', async () => {
    const resPatient = await request('GET', '/api/admin/users', {
      Authorization: `Bearer ${patient1Token}`
    });
    assert(resPatient.status === 403, `Admin users endpoint should return 403 for patient, got ${resPatient.status}`);

    const resAssistant = await request('GET', '/api/admin/orders', {
      Authorization: `Bearer ${assistant1Token}`
    });
    assert(resAssistant.status === 403, `Admin orders endpoint should return 403 for assistant, got ${resAssistant.status}`);
  });

  // 3. Address isolation: Foreign patient cannot access address
  await test('T3: Cross-patient address access is blocked with HTTP 403 or 404', async () => {
    const anyAddress = await prisma.patientAddress.findFirst();
    if (anyAddress) {
      const foreignToken = makeToken({ id: 'unrelated-user-uuid', role: 'PATIENT', email: 'foreign@test.com' });
      const res = await request('GET', `/api/addresses/${anyAddress.id}`, {
        Authorization: `Bearer ${foreignToken}`
      });
      assert(res.status === 403 || res.status === 404, `Accessing foreign address must return 403 or 404, got ${res.status}`);
    }
  });

  // 4. Prescription image isolation: Assistant blocked with HTTP 403
  await test('T4: Prescription images strictly blocked for assistant role (HTTP 403)', async () => {
    const anyRx = await prisma.prescription.findFirst();
    if (anyRx) {
      const res = await request('GET', `/api/prescriptions/${anyRx.id}/image`, {
        Authorization: `Bearer ${assistant1Token}`
      });
      assert(res.status === 403, `Assistant accessing prescription image must return 403, got ${res.status}`);
    }
  });

  // 5. Verification PIN & Handover PIN sanitization
  await test('T5: PIN data minimization: verificationPin and handoverPin excluded from unauthorized payloads', async () => {
    const sampleOrder = await prisma.order.findFirst({
      include: { assistantTask: true }
    });
    if (sampleOrder) {
      const res = await request('GET', `/api/orders/${sampleOrder.id}`, {
        Authorization: `Bearer ${assistant1Token}`
      });
      if (res.status === 200) {
        assert(!res.body.order.verificationPin, 'verificationPin must never be exposed to assistant');
        assert(!res.body.order.prescriptionId, 'prescriptionId must be stripped for assistant');
        if (res.body.order.assistantTask) {
          assert(!res.body.order.assistantTask.handoverPin, 'handoverPin must never be exposed in task payload');
        }
      }
    }
  });

  // 6. User listing omits passwords and hashes
  await test('T6: Sensitive fields (password, hash) are never returned in user listings', async () => {
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (adminUser) {
      const adminToken = makeToken({ id: adminUser.id, role: 'ADMIN', email: adminUser.email, name: adminUser.name });
      const res = await request('GET', '/api/admin/users', {
        Authorization: `Bearer ${adminToken}`
      });
      assert(res.status === 200, 'Admin users must respond 200');
      for (const u of res.body.users) {
        assert(u.password === undefined, `User ${u.id} must omit password`);
        assert(u.passwordHash === undefined, `User ${u.id} must omit passwordHash`);
      }
    }
  });

  // 7. Pharmacist cannot modify inventory of unmanaged pharmacy
  await test('T7: Pharmacist cannot update inventory for unmanaged pharmacy (HTTP 403)', async () => {
    const anyPharmacy = await prisma.pharmacy.findFirst();
    if (anyPharmacy) {
      const res = await request('PUT', `/api/pharmacies/${anyPharmacy.id}/inventory`, {
        Authorization: `Bearer ${pharmacist1Token}`
      }, { medicineId: 'some-med', stock: 10 });
      assert(res.status === 403, `Foreign pharmacist updating inventory must return 403, got ${res.status}`);
    }
  });

  console.log(`\n========================================`);
  console.log(`Phase 6.1L.14 Security Spot Check: ${passed} Passed, ${failed} Failed`);
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
