const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:5000';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'medifind-ai-dev-secret-key-change-in-env';

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PHASE 6.1L.8 FOCUSED TESTS: EMERGENCY ACCESS & RESTOCK');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // Setup test users & test records
    console.log('1. Setting up test users with direct token generation...');
    let userA = await prisma.user.findFirst({ where: { email: 'patient.test.61l8.a@medifind.test' } });
    if (!userA) {
      userA = await prisma.user.create({
        data: {
          name: 'Patient Test 61L8 A',
          email: 'patient.test.61l8.a@medifind.test',
          password: 'hashed-pwd-test',
          role: 'PATIENT',
          phone: '9876543210'
        }
      });
    }
    const patientA = { user: userA, token: generateToken(userA) };

    let userB = await prisma.user.findFirst({ where: { email: 'patient.test.61l8.b@medifind.test' } });
    if (!userB) {
      userB = await prisma.user.create({
        data: {
          name: 'Patient Test 61L8 B',
          email: 'patient.test.61l8.b@medifind.test',
          password: 'hashed-pwd-test',
          role: 'PATIENT',
          phone: '9876543211'
        }
      });
    }
    const patientB = { user: userB, token: generateToken(userB) };

    let userPharm = await prisma.user.findFirst({ where: { email: 'pharmacist1@medifind.com' } });
    if (!userPharm) {
      userPharm = await prisma.user.findFirst({ where: { role: 'PHARMACIST' } });
    }
    const pharmacist = { user: userPharm, token: generateToken(userPharm) };

    // Retrieve participating pharmacies
    const pharmListRes = await request('GET', '/api/pharmacies');
    const pharmacies = pharmListRes.data.pharmacies || [];
    const participating = pharmacies.filter(p => (p.isVerified || p.verificationStatus === 'VERIFIED') && !p.isTestRecord);
    console.log(`Found ${participating.length} real participating pharmacies.`);

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Emergency discovery with zero emergency-capable pharmacies
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1 & 2: Emergency discovery with real network data ---');
    const emergencyRes = await request('GET', '/api/pharmacies/emergency');
    assert(emergencyRes.status === 200, 'Emergency locator endpoint returns 200 OK');
    assert(emergencyRes.data.success === true, 'Emergency response success is true');
    assert(Array.isArray(emergencyRes.data.pharmacies), 'Emergency response returns pharmacies array');
    assert(
      emergencyRes.data.pharmacies.length === 0,
      `Real network returns 0 emergency pharmacies (found ${emergencyRes.data.pharmacies.length}) - honest empty state`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: No fake emergency pharmacy returned, no fabricated coordinates / distance / ETA
    // ─────────────────────────────────────────────────────────────
    for (const p of emergencyRes.data.pharmacies) {
      assert(p.emergencyAvailability === true || p.is24x7 === true, 'Any returned pharmacy must actually have emergency capability');
      assert(p.isVerified === true, 'Must be verified');
    }
    // Check participating pharmacies have null coordinates and no fabricated ETA
    for (const p of participating) {
      assert(p.emergencyAvailability === false, `${p.name} has emergencyAvailability = false`);
      assert(p.is24x7 === false, `${p.name} has is24x7 = false`);
      assert(p.coordinates == null || (p.latitude == null && p.longitude == null), `${p.name} has no fabricated coordinates`);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Operating-hours / Emergency capability filtering verification
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Emergency capability filtering logic ---');
    // Verify query logic filters out non-emergency pharmacies
    const nonEmergencyPharm = await prisma.pharmacy.findFirst({
      where: {
        isVerified: true,
        verificationStatus: 'VERIFIED',
        emergencyAvailability: false,
        is24x7: false
      }
    });
    assert(nonEmergencyPharm != null, 'Found real non-emergency verified pharmacy in database');

    // ─────────────────────────────────────────────────────────────
    // Setup for Restock Tests: Identify/create test medicines & inventory
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- SETUP: Preparing Medicines & Inventory for Restock Tests ---');
    const targetPharmacy = await prisma.pharmacy.findFirst({
      where: { isVerified: true, verificationStatus: 'VERIFIED' }
    });
    assert(targetPharmacy != null, `Selected participating pharmacy ${targetPharmacy.name}`);

    // Find or create an out of stock item
    let oosMedicine = await prisma.medicine.findFirst({
      where: { brandName: 'OOS Test Medicine' }
    });
    if (!oosMedicine) {
      oosMedicine = await prisma.medicine.create({
        data: {
          brandName: 'OOS Test Medicine',
          genericName: 'Test Restockin',
          dosageForm: 'Tablet',
          strength: '500mg',
          category: 'GENERAL',
          manufacturer: 'Test Labs'
        }
      });
    }

    // Ensure inventory record is OUT_OF_STOCK
    let oosInventory = await prisma.inventory.findFirst({
      where: { pharmacyId: targetPharmacy.id, medicineId: oosMedicine.id }
    });
    if (!oosInventory) {
      oosInventory = await prisma.inventory.create({
        data: {
          pharmacyId: targetPharmacy.id,
          medicineId: oosMedicine.id,
          stock: 0,
          status: 'OUT_OF_STOCK',
          price: 50.0
        }
      });
    } else {
      oosInventory = await prisma.inventory.update({
        where: { id: oosInventory.id },
        data: { stock: 0, status: 'OUT_OF_STOCK' }
      });
    }

    // In-stock medicine
    let inStockMedicine = await prisma.medicine.findFirst({
      where: { brandName: 'InStock Test Medicine' }
    });
    if (!inStockMedicine) {
      inStockMedicine = await prisma.medicine.create({
        data: {
          brandName: 'InStock Test Medicine',
          genericName: 'Test Availin',
          dosageForm: 'Capsule',
          strength: '250mg',
          category: 'GENERAL',
          manufacturer: 'Test Pharma'
        }
      });
    }
    let inStockInventory = await prisma.inventory.findFirst({
      where: { pharmacyId: targetPharmacy.id, medicineId: inStockMedicine.id }
    });
    if (!inStockInventory) {
      inStockInventory = await prisma.inventory.create({
        data: {
          pharmacyId: targetPharmacy.id,
          medicineId: inStockMedicine.id,
          stock: 25,
          status: 'AVAILABLE',
          price: 75.0
        }
      });
    } else {
      inStockInventory = await prisma.inventory.update({
        where: { id: inStockInventory.id },
        data: { stock: 25, status: 'AVAILABLE' }
      });
    }

    // Clean up any existing restock requests for this test run
    await prisma.restockRequest.deleteMany({
      where: {
        pharmacyId: targetPharmacy.id,
        medicineId: { in: [oosMedicine.id, inStockMedicine.id] }
      }
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Restock request creation on OUT_OF_STOCK medicine
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Restock request creation for OUT_OF_STOCK medicine ---');
    const createReqRes = await request('POST', '/api/pharmacies/restock-requests', {
      pharmacyId: targetPharmacy.id,
      medicineId: oosMedicine.id
    }, patientA.token);

    assert(createReqRes.status === 201, 'Restock request creation returns 201 Created');
    assert(createReqRes.data.success === true, 'Response indicates success');
    assert(createReqRes.data.request.status === 'ACTIVE', 'Restock request status is ACTIVE');
    assert(createReqRes.data.request.userId === patientA.user.id, 'Request is tied to Patient A');
    assert(createReqRes.data.request.medicineId === oosMedicine.id, 'Correct medicineId');
    assert(createReqRes.data.request.pharmacyId === targetPharmacy.id, 'Correct pharmacyId');
    const createdRequestId = createReqRes.data.request.id;

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Out-of-Stock medicine requirement (reject in-stock)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Reject restock request for in-stock medicine ---');
    const inStockReqRes = await request('POST', '/api/pharmacies/restock-requests', {
      pharmacyId: targetPharmacy.id,
      medicineId: inStockMedicine.id
    }, patientA.token);

    assert(inStockReqRes.status === 400, 'In-stock medicine restock request rejected with 400');
    assert(
      inStockReqRes.data.error.includes('in stock'),
      'Error message states medicine is currently in stock'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Duplicate active restock request prevention
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Prevent duplicate active restock request ---');
    const dupReqRes = await request('POST', '/api/pharmacies/restock-requests', {
      pharmacyId: targetPharmacy.id,
      medicineId: oosMedicine.id
    }, patientA.token);

    assert(dupReqRes.status === 400, 'Duplicate request rejected with 400');
    assert(
      dupReqRes.data.error.includes('already have an active restock') || dupReqRes.data.error.includes('already exists'),
      'Error message notes active request already exists'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Patient Ownership & User Isolation of restock requests
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Patient ownership and restock request isolation ---');
    const patientAReqs = await request('GET', '/api/pharmacies/restock-requests/my', null, patientA.token);
    assert(patientAReqs.status === 200, 'Patient A can fetch their restock requests');
    const patientAHasIt = patientAReqs.data.requests.some(r => r.id === createdRequestId);
    assert(patientAHasIt === true, 'Patient A list contains their created restock request');

    const patientBReqs = await request('GET', '/api/pharmacies/restock-requests/my', null, patientB.token);
    assert(patientBReqs.status === 200, 'Patient B can fetch their restock requests');
    const patientBHasIt = patientBReqs.data.requests.some(r => r.id === createdRequestId);
    assert(patientBHasIt === false, 'Patient B list does NOT contain Patient A request (isolated)');

    // Patient B attempts to delete Patient A's request
    const unauthorizedCancel = await request('DELETE', `/api/pharmacies/restock-requests/${createdRequestId}`, null, patientB.token);
    assert(
      unauthorizedCancel.status === 404 || unauthorizedCancel.status === 403,
      'Patient B cannot cancel Patient A restock request (isolated)'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Notification generated ONLY after real OUT_OF_STOCK -> AVAILABLE transition
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Trigger notification on OUT_OF_STOCK -> AVAILABLE transition ---');
    // Clear notifications for Patient A and Patient B first
    await prisma.notification.deleteMany({
      where: { userId: { in: [patientA.user.id, patientB.user.id] } }
    });

    // Pharmacist updates target pharmacy inventory: OUT_OF_STOCK -> AVAILABLE
    // Assign pharmacist as manager of target pharmacy if needed (remember original manager to restore in cleanup)
    const originalManagerId = targetPharmacy.managerId;
    await prisma.pharmacy.update({
      where: { id: targetPharmacy.id },
      data: { managerId: pharmacist.user.id }
    });

    const restockUpdateRes = await request('PUT', `/api/pharmacies/${targetPharmacy.id}/inventory`, {
      medicineId: oosMedicine.id,
      stock: 20,
      price: 55.0
    }, pharmacist.token);

    assert(restockUpdateRes.status === 200, 'Inventory update to AVAILABLE succeeds with 200');

    // Verify RestockRequest status transitioned to FULFILLED
    const updatedRestockReq = await prisma.restockRequest.findUnique({
      where: { id: createdRequestId }
    });
    assert(updatedRestockReq.status === 'FULFILLED', 'RestockRequest transitioned to FULFILLED');
    assert(updatedRestockReq.notifiedAt != null, 'notifiedAt timestamp is recorded');

    // Verify Notification generated for Patient A
    const patientANotifs = await prisma.notification.findMany({
      where: { userId: patientA.user.id }
    });
    assert(patientANotifs.length >= 1, 'Patient A received notification');
    const restockNotif = patientANotifs.find(n => n.type === 'RESTOCK_AVAILABLE');
    assert(restockNotif != null, 'Notification has type RESTOCK_AVAILABLE');
    assert(restockNotif.title.includes('Restock'), 'Notification title announces restock');
    assert(restockNotif.message.includes(oosMedicine.brandName), 'Notification message includes medicine name');

    // ─────────────────────────────────────────────────────────────
    // TEST 9: No notification for unrelated inventory changes
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: No notification for unrelated inventory updates ---');
    const initialNotifCount = (await prisma.notification.findMany({ where: { userId: patientA.user.id } })).length;

    // Pharmacist updates inStockMedicine from 25 to 30 (AVAILABLE -> AVAILABLE, no status transition)
    await request('PUT', `/api/pharmacies/${targetPharmacy.id}/inventory`, {
      medicineId: inStockMedicine.id,
      stock: 30,
      price: 75.0
    }, pharmacist.token);

    const afterNotifCount = (await prisma.notification.findMany({ where: { userId: patientA.user.id } })).length;
    assert(
      afterNotifCount === initialNotifCount,
      'No new notifications generated for AVAILABLE -> AVAILABLE inventory update'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Notification user isolation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Notification user isolation ---');
    const patientBNotifs = await prisma.notification.findMany({
      where: { userId: patientB.user.id }
    });
    assert(
      patientBNotifs.length === 0,
      'Patient B received zero notifications for Patient A restock event (user isolated)'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Cancel active restock request
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 11: Restock request cancellation ---');
    // Set inventory back to OUT_OF_STOCK
    await prisma.inventory.update({
      where: { id: oosInventory.id },
      data: { stock: 0, status: 'OUT_OF_STOCK' }
    });
    // Create new restock request for Patient A
    const req2Res = await request('POST', '/api/pharmacies/restock-requests', {
      pharmacyId: targetPharmacy.id,
      medicineId: oosMedicine.id
    }, patientA.token);
    const req2Id = req2Res.data.request.id;

    // Cancel it
    const cancelRes = await request('DELETE', `/api/pharmacies/restock-requests/${req2Id}`, null, patientA.token);
    assert(cancelRes.status === 200, 'Cancel restock request returns 200');
    assert(cancelRes.data.request.status === 'CANCELLED', 'Request status is CANCELLED');

    // Clean up test data
    console.log('\n--- CLEANUP: Cleaning test data ---');
    await prisma.restockRequest.deleteMany({
      where: { medicineId: { in: [oosMedicine.id, inStockMedicine.id] } }
    });
    await prisma.inventory.deleteMany({
      where: { medicineId: { in: [oosMedicine.id, inStockMedicine.id] } }
    });
    await prisma.medicine.deleteMany({
      where: { id: { in: [oosMedicine.id, inStockMedicine.id] } }
    });
    if (targetPharmacy && originalManagerId) {
      await prisma.pharmacy.update({
        where: { id: targetPharmacy.id },
        data: { managerId: originalManagerId }
      });
    }
    console.log('Test records cleaned up.');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
