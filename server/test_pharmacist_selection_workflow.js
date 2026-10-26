/**
 * Automated Test Suite: Pharmacist Medicine-Selection Request Workflow End-to-End
 *
 * Verifies all 9 core requirements:
 * 1. Patient submits pharmacist-selection request for a specific generic medicine.
 * 2. Selected brand clears and pending state persists across refresh / getPrescriptionById.
 * 3. Correct assigned pharmacy sees the exact medicine, request, and PENDING_SELECTION item status.
 * 4. Clinical Prescription Verification identifies pending items and metadata.
 * 5. Pharmacist selection saves correctly and clears pending state only after success.
 * 6. Failed requests remain pending and return appropriate error.
 * 7. Unauthorized pharmacies cannot access or modify the request (403 Forbidden).
 * 8. Combination medicine compatibility is enforced (Pantocid DSR requires pantoprazole + domperidone; Pan 40 alone is rejected).
 * 9. Existing reservation and order workflows remain functional.
 */

const prisma = require('./src/prisma');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./src/middlewares/auth');
const app = null;

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000';

function request() {
  function createReq(method, path) {
    const headers = {};
    let bodyData = null;
    return {
      set(k, v) {
        headers[k] = v;
        return this;
      },
      send(data) {
        bodyData = data;
        return this;
      },
      then(resolve, reject) {
        const url = `${BASE_URL}${path}`;
        const options = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        };
        if (bodyData && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          options.body = JSON.stringify(bodyData);
        }
        return fetch(url, options)
          .then(async (res) => {
            let jsonBody = null;
            try {
              jsonBody = await res.json();
            } catch (err) {
              jsonBody = null;
            }
            return {
              status: res.status,
              body: jsonBody
            };
          })
          .then(resolve, reject);
      }
    };
  }

  return {
    get: (p) => createReq('GET', p),
    post: (p) => createReq('POST', p),
    put: (p) => createReq('PUT', p),
    delete: (p) => createReq('DELETE', p),
    patch: (p) => createReq('PATCH', p)
  };
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, userId: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function runTests() {
  console.log('=== Starting Test Suite: Pharmacist Medicine-Selection Request Workflow ===\n');

  let patientUser, pharmacistUser, otherPharmacistUser;
  let pharmacyA, pharmacyB;
  let singleMed, comboMed;
  let prescription;
  let testOrder;

  try {
    // 0. Setup test users and pharmacies
    patientUser = await prisma.user.upsert({
      where: { email: 'test_patient_flow@medifind.local' },
      update: {},
      create: {
        name: 'Workflow Test Patient',
        email: 'test_patient_flow@medifind.local',
        password: 'hash_test_patient_123',
        phone: '+919999900001',
        role: 'PATIENT'
      }
    });

    pharmacistUser = await prisma.user.upsert({
      where: { email: 'test_pharmacist_a@medifind.local' },
      update: {},
      create: {
        name: 'Attending Pharmacist A',
        email: 'test_pharmacist_a@medifind.local',
        password: 'hash_test_pharm_a_123',
        phone: '+919999900002',
        role: 'PHARMACIST'
      }
    });

    otherPharmacistUser = await prisma.user.upsert({
      where: { email: 'test_pharmacist_b@medifind.local' },
      update: {},
      create: {
        name: 'Unauthorized Pharmacist B',
        email: 'test_pharmacist_b@medifind.local',
        password: 'hash_test_pharm_b_123',
        phone: '+919999900003',
        role: 'PHARMACIST'
      }
    });

    pharmacyA = await prisma.pharmacy.upsert({
      where: { managerId: pharmacistUser.id },
      update: { verificationStatus: 'VERIFIED', isVerified: true },
      create: {
        name: 'MediFind Kerala Central Pharmacy',
        licenseNumber: 'KL-ALPY-TEST-001',
        address: '100 Beach Road, Alappuzha, Kerala',
        phone: '+919846011111',
        latitude: 9.4981,
        longitude: 76.3388,
        managerId: pharmacistUser.id,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        openingHours: '8:00 AM - 10:00 PM'
      }
    });

    pharmacyB = await prisma.pharmacy.upsert({
      where: { managerId: otherPharmacistUser.id },
      update: { verificationStatus: 'VERIFIED', isVerified: true },
      create: {
        name: 'Competitor Dispensary B',
        licenseNumber: 'KL-KCHI-TEST-002',
        address: '200 Main St, Kochi, Kerala',
        phone: '+919846022222',
        latitude: 9.9312,
        longitude: 76.2673,
        managerId: otherPharmacistUser.id,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        openingHours: '8:00 AM - 10:00 PM'
      }
    });

    async function upsertMedicine(data) {
      const existing = await prisma.medicine.findFirst({
        where: { brandName: data.brandName }
      });
      if (existing) {
        return prisma.medicine.update({
          where: { id: existing.id },
          data
        });
      }
      return prisma.medicine.create({ data });
    }

    singleMed = await upsertMedicine({
      brandName: 'Pan 40 Tablet',
      genericName: 'Pantoprazole',
      strength: '40mg',
      dosageForm: 'Tablet',
      category: 'Antacid',
      manufacturer: 'Alkem Laboratories'
    });

    comboMed = await upsertMedicine({
      brandName: 'Pantocid DSR Capsule',
      genericName: 'Pantoprazole + Domperidone',
      strength: '40mg + 30mg',
      dosageForm: 'Capsule',
      category: 'Antacid / Antiemetic',
      manufacturer: 'Sun Pharma'
    });

    await prisma.inventory.upsert({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: pharmacyA.id,
          medicineId: comboMed.id
        }
      },
      update: { stock: 100, price: 180.00 },
      create: {
        pharmacyId: pharmacyA.id,
        medicineId: comboMed.id,
        stock: 100,
        price: 180.00
      }
    });

    const patientToken = makeToken(patientUser);
    const pharmacistToken = makeToken(pharmacistUser);
    const otherPharmacistToken = makeToken(otherPharmacistUser);

    // Create prescription with 2 detected medicines
    prescription = await prisma.prescription.create({
      data: {
        userId: patientUser.id,
        filePath: 'uploads/prescriptions/rx_test.jpg',
        status: 'OCR_COMPLETED',
        originalFileName: 'rx_test_combination_safety.jpg',
        ocrRawText: 'Rx: Pantocid DSR (Pantoprazole + Domperidone) 1 cap daily x 10 days\nCefixime 200mg 1 tab bid x 5 days',
        detectedMedicines: {
          create: [
            {
              rawName: 'Pantoprazole + Domperidone',
              dosage: '40mg + 30mg',
              quantity: 10,
              extractedQuantity: 10,
              confidence: 0.95,
              matchedMedicineId: comboMed.id,
              matchedMedicineName: comboMed.brandName
            },
            {
              rawName: 'Cefixime 200mg',
              dosage: '200mg',
              quantity: 10,
              extractedQuantity: 10,
              confidence: 0.90,
              matchedMedicineId: singleMed.id,
              matchedMedicineName: singleMed.brandName
            }
          ]
        }
      },
      include: { detectedMedicines: true }
    });

    const comboItem = prescription.detectedMedicines.find(m => m.rawName.includes('Pantoprazole'));
    console.log('✓ Seeded prescription and test users successfully.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 1: Patient submits pharmacist-selection request
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: Patient submits pharmacist-selection request ---');
    const resReq = await request(app)
      .post(`/api/prescriptions/${prescription.id}/request-pharmacist-selection`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        itemId: comboItem.id,
        rawName: comboItem.rawName,
        genericCompound: 'Pantoprazole + Domperidone',
        dosage: '40mg + 30mg',
        dosageForm: 'Capsule',
        quantity: 10,
        cancel: false
      });

    if (resReq.status !== 200 || !resReq.body.success) {
      throw new Error(`Test 1 Failed: Expected 200, got ${resReq.status}: ${JSON.stringify(resReq.body)}`);
    }
    console.log('✓ Patient pharmacist-selection request submitted successfully (200 OK).');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 2: Selected brand clears and pending state persists across refresh
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Selected brand clears and pending state persists across refresh ---');
    const resGetRx = await request(app)
      .get(`/api/prescriptions/${prescription.id}`)
      .set('Authorization', `Bearer ${patientToken}`);

    if (resGetRx.status !== 200 || !resGetRx.body.prescription) {
      throw new Error(`Test 2 Failed: Could not get prescription details.`);
    }

    const refreshedCombo = resGetRx.body.prescription.detectedMedicines.find(m => m.id === comboItem.id);
    if (!refreshedCombo) throw new Error('Test 2 Failed: combo item not found in refreshed prescription');
    if (refreshedCombo.matchedMedicineId !== null) {
      throw new Error(`Test 2 Failed: matchedMedicineId should be cleared to null, got ${refreshedCombo.matchedMedicineId}`);
    }
    if (refreshedCombo.pharmacistSelectionRequested !== true) {
      throw new Error('Test 2 Failed: pharmacistSelectionRequested should be true');
    }
    console.log('✓ Brand choice was cleared and pending state persisted after refresh.');

    // Verify patient verification proceeds cleanly with pharmacistSelectionRequested
    const resVerify = await request(app)
      .put(`/api/prescriptions/${prescription.id}/verify`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        items: [
          {
            id: comboItem.id,
            rawName: comboItem.rawName,
            matchedMedicineId: null,
            quantity: 10,
            dosage: '40mg + 30mg',
            pharmacistSelectionRequested: true
          },
          {
            id: prescription.detectedMedicines[1].id,
            rawName: 'Cefixime 200mg',
            matchedMedicineId: singleMed.id,
            quantity: 10,
            dosage: '200mg',
            selectionOption: 'DOCTOR_APPROVAL',
            doctorApproval: {
              doctorName: 'Dr. Joseph',
              clinicOrHospital: 'City General Hospital'
            },
            pharmacistSelectionRequested: false
          }
        ]
      });

    if (resVerify.status !== 200 || !resVerify.body.success) {
      throw new Error(`Patient verification failed: ${resVerify.status} ${JSON.stringify(resVerify.body)}`);
    }
    console.log('✓ Prescription verified with pharmacist selection request preserved.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 3 & 4: Assigned pharmacy sees the exact medicine and pending item
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Assigned pharmacy sees exact medicine awaiting selection ---');
    // Place order with pharmacyA
    const rxItems = await prisma.prescriptionItem.findMany({ where: { prescriptionId: prescription.id } });
    const pendingRxItem = rxItems.find(i => i.patientNotes === 'PHARMACIST_SELECTION_REQUESTED');
    if (!pendingRxItem) throw new Error('PrescriptionItem was not saved with PHARMACIST_SELECTION_REQUESTED notes');

    const resOrder = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        pharmacyId: pharmacyA.id,
        prescriptionId: prescription.id,
        orderType: 'RESERVATION',
        items: [
          {
            medicineId: pendingRxItem.medicineId,
            prescriptionItemId: pendingRxItem.id,
            quantity: 10,
            pharmacistSelectionRequested: true
          }
        ]
      });

    if (resOrder.status !== 201 || !resOrder.body.success) {
      throw new Error(`Order creation failed: ${resOrder.status} ${JSON.stringify(resOrder.body)}`);
    }
    testOrder = resOrder.body.order;

    // Pharmacist A fetches orders
    const resPharmOrders = await request(app)
      .get(`/api/orders/${testOrder.id}`)
      .set('Authorization', `Bearer ${pharmacistToken}`);

    if (resPharmOrders.status !== 200 || !resPharmOrders.body.order) {
      throw new Error(`Pharmacist A could not fetch order: ${resPharmOrders.status}`);
    }

    const fetchedOrder = resPharmOrders.body.order;
    const pendingOrderItem = fetchedOrder.items.find(i => i.status === 'PENDING_SELECTION' || i.unfulfilledReason === 'PHARMACIST_SELECTION_REQUESTED');
    if (!pendingOrderItem) {
      throw new Error('Test 3 Failed: Order item was not marked with PENDING_SELECTION');
    }
    if (!fetchedOrder.notes || !fetchedOrder.notes.includes('[PENDING_SELECTION:')) {
      throw new Error('Test 3 Failed: Order notes missing [PENDING_SELECTION: tag');
    }
    console.log('✓ Pharmacy A sees exact order item marked with PENDING_SELECTION and notes tag.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 7: Unauthorized pharmacies cannot access the request
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 7: Unauthorized pharmacy access restriction ---');
    const resOtherPharm = await request(app)
      .put(`/api/prescriptions/${prescription.id}/items/${pendingRxItem.id}/pharmacist-verify`)
      .set('Authorization', `Bearer ${otherPharmacistToken}`)
      .send({
        medicineId: comboMed.id,
        prescribedName: comboMed.brandName,
        quantity: 10
      });

    if (resOtherPharm.status !== 403) {
      throw new Error(`Test 7 Failed: Expected 403 Forbidden for unauthorized pharmacy, got ${resOtherPharm.status}`);
    }
    console.log('✓ Unauthorized pharmacy received 403 Forbidden as required.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 8: Combination medicine compatibility is enforced
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 8: Enforce combination medicine compatibility (Pantocid DSR vs Pan 40) ---');
    // Attempt to verify Pantocid DSR (pantoprazole + domperidone) with Pan 40 (pantoprazole alone)
    const resIncompat = await request(app)
      .put(`/api/prescriptions/${prescription.id}/items/${pendingRxItem.id}/pharmacist-verify`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({
        medicineId: singleMed.id, // Pan 40 Tablet (lacks domperidone!)
        prescribedName: singleMed.brandName,
        quantity: 10
      });

    if (resIncompat.status !== 400 || resIncompat.body.success) {
      throw new Error(`Test 8 Failed: Expected 400 Incompatible combination, got ${resIncompat.status}: ${JSON.stringify(resIncompat.body)}`);
    }
    console.log(`✓ Combination safety enforced: Incompatible drug rejected (${resIncompat.body.error})`);

    // ───────────────────────────────────────────────────────────────────────────
    // Test 6: Incompatible/failed requests remain pending
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: Failed requests remain pending and show error ---');
    const checkStillPending = await prisma.prescriptionItem.findUnique({
      where: { id: pendingRxItem.id }
    });
    if (checkStillPending.isVerified || checkStillPending.patientNotes !== 'PHARMACIST_SELECTION_REQUESTED') {
      throw new Error('Test 6 Failed: Incompatible submission prematurely cleared pending state!');
    }
    console.log('✓ Item remained pending after failed verification attempt.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 5: Pharmacist selection saves correctly and clears pending state on success
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Pharmacist selection saves correctly and clears pending state ---');
    const resSuccessVerify = await request(app)
      .put(`/api/prescriptions/${prescription.id}/items/${pendingRxItem.id}/pharmacist-verify`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({
        medicineId: comboMed.id, // Pantocid DSR Capsule (contains pantoprazole + domperidone)
        prescribedName: comboMed.brandName,
        quantity: 10,
        dosage: comboMed.strength
      });

    if (resSuccessVerify.status !== 200 || !resSuccessVerify.body.success) {
      throw new Error(`Test 5 Failed: Expected 200 success, got ${resSuccessVerify.status}: ${JSON.stringify(resSuccessVerify.body)}`);
    }

    const verifiedRxItem = await prisma.prescriptionItem.findUnique({
      where: { id: pendingRxItem.id }
    });
    if (!verifiedRxItem.isVerified || verifiedRxItem.patientNotes !== null) {
      throw new Error('Test 5 Failed: PrescriptionItem was not marked verified or patientNotes not cleared');
    }

    // Check linked OrderItem
    const updatedOrderItem = await prisma.orderItem.findFirst({
      where: { prescriptionItemId: pendingRxItem.id }
    });
    if (!updatedOrderItem || updatedOrderItem.status === 'PENDING_SELECTION') {
      throw new Error('Test 5 Failed: OrderItem status was not transitioned from PENDING_SELECTION');
    }

    // Check Order.notes tag was removed
    const updatedOrder = await prisma.order.findUnique({ where: { id: testOrder.id } });
    if (updatedOrder.notes && updatedOrder.notes.includes(`[PENDING_SELECTION:${pendingRxItem.id}:`)) {
      throw new Error('Test 5 Failed: Order notes still contains pending selection tag');
    }
    console.log('✓ Pharmacist verified compatible brand, cleared pending state, and synchronized OrderItem status.');

    // ───────────────────────────────────────────────────────────────────────────
    // Test 9: Existing reservation and order workflows remain functional
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 9: Existing order fulfillment workflow regression check ---');
    const resConfirm = await request(app)
      .put(`/api/orders/${testOrder.id}/status`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ status: 'CONFIRMED' });

    if (resConfirm.status !== 200 || !resConfirm.body?.success) {
      throw new Error(`Test 9 Failed: Could not update order status to CONFIRMED: ${resConfirm.status} ${JSON.stringify(resConfirm.body)}`);
    }
    console.log('✓ Order lifecycle progressed to CONFIRMED without regression.');

    console.log('\n=============================================================');
    console.log('🎉 ALL 9 AUTOMATED WORKFLOW TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================================\n');
  } finally {
    // Cleanup test records
    try {
      if (pharmacyA?.id) {
        await prisma.inventory.deleteMany({ where: { pharmacyId: pharmacyA.id } });
      }
      if (testOrder?.id) {
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: testOrder.id } });
        await prisma.orderItem.deleteMany({ where: { orderId: testOrder.id } });
        await prisma.order.deleteMany({ where: { id: testOrder.id } });
      }
      if (prescription?.id) {
        await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: prescription.id } });
        await prisma.detectedMedicine.deleteMany({ where: { prescriptionId: prescription.id } });
        await prisma.prescription.deleteMany({ where: { id: prescription.id } });
      }
      if (patientUser?.id) {
        await prisma.notification.deleteMany({ where: { userId: patientUser.id } });
        await prisma.user.deleteMany({ where: { id: patientUser.id } });
      }
      if (pharmacistUser?.id) {
        await prisma.notification.deleteMany({ where: { userId: pharmacistUser.id } });
      }
      if (otherPharmacistUser?.id) {
        await prisma.notification.deleteMany({ where: { userId: otherPharmacistUser.id } });
      }
      if (singleMed?.id || comboMed?.id) {
        const medIds = [singleMed?.id, comboMed?.id].filter(Boolean);
        await prisma.inventory.deleteMany({ where: { medicineId: { in: medIds } } });
        await prisma.medicine.deleteMany({ where: { id: { in: medIds } } });
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
    await prisma.$disconnect();
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ TEST SUITE FAILED:\n', err);
    process.exit(1);
  });
