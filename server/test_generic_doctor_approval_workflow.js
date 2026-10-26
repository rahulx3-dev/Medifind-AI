/**
 * MediFind AI — Comprehensive Test Suite for Generic Medicine Selection & Doctor Verification Workflow
 * 
 * Validates all 12 core test cases required by the specification:
 * 1. Generic medicine detected, with no exact catalogue-product match (e.g. Cefixime 200 mg).
 * 2. Patient chooses Ask Pharmacy to Review (Option A).
 * 3. Patient states doctor approved a particular brand (Option B) with valid details.
 * 4. Patient claims approval but supporting evidence is missing (HTTP 400 DOCTOR_APPROVAL_EVIDENCE_REQUIRED).
 * 5. Prescription specifies brand different from selected brand (HTTP 400 BRAND_DISCREPANCY_APPROVAL_REQUIRED).
 * 6. Pharmacist requests prescriber clarification.
 * 7. Required approval is recorded and verified (outcome: 'APPROVED').
 * 8. Pharmacist rejects proposed brand (outcome: 'REJECTED').
 * 9. Exact prescribed product is available in catalogue (normal verification).
 * 10. Selected product becomes unavailable before fulfilment (blocks confirmation).
 * 11. Backend API attempts to bypass verification (HTTP 400 GENERIC_SELECTION_RESTRICTED).
 * 12. Existing pickup and delivery orders still work.
 */

'use strict';

const assert = require('assert');
const prisma = require('./src/prisma');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./src/middlewares/auth');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000';

function makeToken(user) {
  return jwt.sign(
    { id: user.id, userId: user.id, email: user.email, role: user.role, name: user.name, pharmacyId: user.pharmacyId },
    JWT_SECRET || 'medifind-ai-super-secret-key-2026-academic',
    { expiresIn: '2h' }
  );
}

async function apiRequest(method, endpoint, body = null, token = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  return { status: res.status, body: data };
}

async function runTestSuite() {
  console.log('\n========================================================================');
  console.log('🧪 MEDIFIND AI: GENERIC MEDICINE SELECTION & DOCTOR VERIFICATION TEST');
  console.log('========================================================================\n');

  let patientUser, pharmacistUser, otherPharmacistUser;
  let pharmacyA;
  let brandTaximO, brandZifi, exactBrandAugmentin;
  let patientToken, pharmacistToken;

  // ── Setup Users, Pharmacy (24x7 to avoid closed hour issues), and Medicines ──
  console.log('Setting up test fixtures...');
  patientUser = await prisma.user.upsert({
    where: { email: 'test_generic_patient@medifind.local' },
    update: {},
    create: {
      name: 'Generic Workflow Patient',
      email: 'test_generic_patient@medifind.local',
      password: 'hash_test_patient_123',
      phone: '+919999900010',
      role: 'PATIENT'
    }
  });

  pharmacistUser = await prisma.user.upsert({
    where: { email: 'test_generic_pharmacist@medifind.local' },
    update: {},
    create: {
      name: 'Clinical Pharmacist Lead',
      email: 'test_generic_pharmacist@medifind.local',
      password: 'hash_test_pharm_123',
      phone: '+919999900011',
      role: 'PHARMACIST'
    }
  });

  pharmacyA = await prisma.pharmacy.upsert({
    where: { managerId: pharmacistUser.id },
    update: {
      verificationStatus: 'VERIFIED',
      isVerified: true,
      openingHours: '24 Hours',
      is24x7: true
    },
    create: {
      name: 'MediFind Kerala Hub Pharmacy (24x7)',
      licenseNumber: 'KL-GENERIC-TEST-001',
      address: '24 Healthcare Ave, Kochi, Kerala',
      phone: '+919846099999',
      latitude: 9.9312,
      longitude: 76.2673,
      managerId: pharmacistUser.id,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      openingHours: '24 Hours',
      is24x7: true
    }
  });

  pharmacistUser.pharmacyId = pharmacyA.id;

  async function upsertMed(data) {
    const existing = await prisma.medicine.findFirst({
      where: { brandName: data.brandName }
    });
    if (existing) {
      return prisma.medicine.update({ where: { id: existing.id }, data });
    }
    return prisma.medicine.create({ data });
  }

  brandTaximO = await upsertMed({
    brandName: 'Taxim-O 200',
    genericName: 'Cefixime',
    strength: '200mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'Alkem Laboratories'
  });

  brandZifi = await upsertMed({
    brandName: 'Zifi 200',
    genericName: 'Cefixime',
    strength: '200mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'FDC Ltd'
  });

  exactBrandAugmentin = await upsertMed({
    brandName: 'Augmentin 625 Duo Tablet',
    genericName: 'Amoxicillin + Clavulanic Acid',
    strength: '625mg',
    dosageForm: 'Tablet',
    category: 'Antibiotic',
    manufacturer: 'GSK'
  });

  // Seed Inventory
  await prisma.inventory.upsert({
    where: { pharmacyId_medicineId: { pharmacyId: pharmacyA.id, medicineId: brandTaximO.id } },
    update: { stock: 50, price: 110.00 },
    create: { pharmacyId: pharmacyA.id, medicineId: brandTaximO.id, stock: 50, price: 110.00 }
  });

  await prisma.inventory.upsert({
    where: { pharmacyId_medicineId: { pharmacyId: pharmacyA.id, medicineId: brandZifi.id } },
    update: { stock: 40, price: 105.00 },
    create: { pharmacyId: pharmacyA.id, medicineId: brandZifi.id, stock: 40, price: 105.00 }
  });

  await prisma.inventory.upsert({
    where: { pharmacyId_medicineId: { pharmacyId: pharmacyA.id, medicineId: exactBrandAugmentin.id } },
    update: { stock: 30, price: 200.00 },
    create: { pharmacyId: pharmacyA.id, medicineId: exactBrandAugmentin.id, stock: 30, price: 200.00 }
  });

  patientToken = makeToken(patientUser);
  pharmacistToken = makeToken(pharmacistUser);

  console.log('✓ Setup complete. Patient & Pharmacist authenticated.\n');

  let passedCases = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 1: Generic medicine detected, with no exact catalogue match
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 1: Generic medicine detected, no exact catalogue match ---');
  const ocrMatcher = require('./src/utils/ocrMatcher');
  const matchResult = ocrMatcher.matchPrescriptionLine(
    'Tab Cefixime 200 mg 1 BD x 5 days',
    [brandTaximO, brandZifi, exactBrandAugmentin]
  );
  assert.strictEqual(matchResult.isGenericPrescription, true, 'Should detect generic prescription');
  assert.strictEqual(matchResult.status, 'AMBIGUOUS', 'Generic prescribed should NOT auto-match proprietary brand as primary');
  assert.strictEqual(matchResult.matchedMedicineId, null, 'Should not force an automatic brand selection');
  console.log('✓ PASS: Prescribed generic Cefixime does not auto-assign proprietary brand Taxim-O/Zifi.\n');
  passedCases++;

  // Create a base prescription for testing patient selection choices
  const prescriptionA = await prisma.prescription.create({
    data: {
      userId: patientUser.id,
      filePath: 'uploads/prescriptions/rx_generic_flow_a.jpg',
      originalFileName: 'rx_generic_flow_a.jpg',
      status: 'OCR_COMPLETED',
      ocrRawText: 'Rx:\n1. Tab Cefixime 200mg - 1 BD x 5 days (Qty: 10)\n',
      detectedMedicines: {
        create: [
          {
            rawName: 'Tab Cefixime 200mg',
            extractedQuantity: 10,
            quantity: 10,
            dosage: '200mg',
            frequency: '1 BD',
            duration: '5 days',
            isConfirmed: false
          }
        ]
      }
    },
    include: { detectedMedicines: true }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 2: Patient chooses Ask Pharmacy to Review (Option A)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 2: Patient chooses Ask Pharmacy to Review (Option A) ---');
  const resOptionA = await apiRequest('PUT', `/api/prescriptions/${prescriptionA.id}/verify`, {
    items: [
      {
        id: prescriptionA.detectedMedicines[0].id,
        rawName: 'Tab Cefixime 200mg',
        matchedMedicineId: null,
        quantity: 10,
        dosage: '200mg',
        selectionOption: 'ASK_PHARMACY',
        pharmacistSelectionRequested: true
      }
    ]
  }, patientToken);

  assert.strictEqual(resOptionA.status, 200, 'Option A verification should succeed');
  const rxItemsA = await prisma.prescriptionItem.findMany({ where: { prescriptionId: prescriptionA.id } });
  assert.strictEqual(rxItemsA.length, 1);
  assert.strictEqual(rxItemsA[0].isVerified, false, 'Item must remain unverified awaiting pharmacist review');
  assert.ok(
    rxItemsA[0].patientNotes === 'PHARMACIST_SELECTION_REQUESTED' || rxItemsA[0].patientNotes?.includes('AWAITING_PHARMACY_REVIEW'),
    'Item notes must reflect pharmacy review request'
  );

  // Create order with Option A item
  const resOrderA = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionA.id,
    orderType: 'RESERVATION',
    fulfillmentType: 'STORE_PICKUP',
    items: [
      {
        medicineId: brandTaximO.id,
        prescriptionItemId: rxItemsA[0].id,
        quantity: 10,
        pharmacistSelectionRequested: true
      }
    ]
  }, patientToken);

  assert.strictEqual(resOrderA.status, 201, 'Order with Option A item should be created');
  const orderItemA = resOrderA.body.order.items[0];
  assert.strictEqual(orderItemA.status, 'PENDING_SELECTION', 'Order item status must be PENDING_SELECTION');
  assert.ok(
    orderItemA.unfulfilledReason === 'AWAITING_PHARMACY_REVIEW' || orderItemA.unfulfilledReason === 'PHARMACIST_SELECTION_REQUESTED',
    'Unfulfilled reason must specify pharmacy review'
  );
  console.log('✓ PASS: Option A preserved details and submitted as awaiting pharmacy review (PENDING_SELECTION).\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 3: Patient states doctor approved a particular brand (Option B)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 3: Patient chooses Option B with valid doctor approval details ---');
  const prescriptionB = await prisma.prescription.create({
    data: {
      userId: patientUser.id,
      filePath: 'uploads/prescriptions/rx_generic_flow_b.jpg',
      originalFileName: 'rx_generic_flow_b.jpg',
      status: 'OCR_COMPLETED',
      ocrRawText: 'Rx:\n1. Tab Cefixime 200mg - 1 BD x 5 days (Qty: 10)\n',
      detectedMedicines: {
        create: [
          {
            rawName: 'Tab Cefixime 200mg',
            extractedQuantity: 10,
            quantity: 10,
            dosage: '200mg',
            frequency: '1 BD',
            duration: '5 days',
            isConfirmed: false
          }
        ]
      }
    },
    include: { detectedMedicines: true }
  });

  const resOptionB = await apiRequest('PUT', `/api/prescriptions/${prescriptionB.id}/verify`, {
    items: [
      {
        id: prescriptionB.detectedMedicines[0].id,
        rawName: 'Tab Cefixime 200mg',
        matchedMedicineId: brandTaximO.id,
        quantity: 10,
        dosage: '200mg',
        selectionOption: 'DOCTOR_APPROVAL',
        doctorApproval: {
          doctorName: 'Dr. Joseph Kurian',
          clinicOrHospital: 'City Multi-Specialty Clinic, Ernakulam',
          notes: 'Doctor verbally approved Taxim-O on phone follow-up',
          contactReference: 'Rx Ref #8841 / 24-Oct-2026'
        },
        pharmacistSelectionRequested: false
      }
    ]
  }, patientToken);

  assert.strictEqual(resOptionB.status, 200, 'Option B verification with valid details should succeed');
  const rxItemsB = await prisma.prescriptionItem.findMany({ where: { prescriptionId: prescriptionB.id } });
  assert.strictEqual(rxItemsB.length, 1);
  assert.strictEqual(rxItemsB[0].isVerified, false, 'Doctor approved claim must remain unverified until checked');
  assert.ok(rxItemsB[0].patientNotes.includes('DOCTOR_APPROVAL_CLAIM'), 'Patient notes must serialize approval claim');
  assert.ok(rxItemsB[0].patientNotes.includes('Dr. Joseph Kurian'), 'Doctor name must be preserved in patient notes');

  // Create order with Option B item
  const resOrderB = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionB.id,
    orderType: 'RESERVATION',
    fulfillmentType: 'STORE_PICKUP',
    items: [
      {
        medicineId: brandTaximO.id,
        prescriptionItemId: rxItemsB[0].id,
        quantity: 10,
        pharmacistSelectionRequested: false
      }
    ]
  }, patientToken);

  assert.strictEqual(resOrderB.status, 201, 'Order with Option B item should be created');
  const orderItemB = resOrderB.body.order.items[0];
  assert.strictEqual(orderItemB.status, 'AWAITING_VERIFICATION', 'Order item status must be AWAITING_VERIFICATION');
  assert.strictEqual(orderItemB.unfulfilledReason, 'AWAITING_DOCTOR_APPROVAL_VERIFICATION');
  console.log('✓ PASS: Option B recorded doctor approval claim and marked item AWAITING_VERIFICATION.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 4: Patient claims approval but supporting evidence is missing
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 4: Patient claims approval but supporting evidence is missing ---');
  const resMissingEvidence = await apiRequest('PUT', `/api/prescriptions/${prescriptionB.id}/verify`, {
    items: [
      {
        id: prescriptionB.detectedMedicines[0].id,
        rawName: 'Tab Cefixime 200mg',
        matchedMedicineId: brandTaximO.id,
        quantity: 10,
        dosage: '200mg',
        selectionOption: 'DOCTOR_APPROVAL',
        doctorApproval: {
          doctorName: '', // Missing required doctor name
          clinicOrHospital: ''
        },
        pharmacistSelectionRequested: false
      }
    ]
  }, patientToken);

  assert.strictEqual(resMissingEvidence.status, 400, 'Must return HTTP 400 when doctor approval details are missing');
  assert.strictEqual(resMissingEvidence.body.code, 'DOCTOR_APPROVAL_EVIDENCE_REQUIRED');
  console.log('✓ PASS: Rejected with HTTP 400 and DOCTOR_APPROVAL_EVIDENCE_REQUIRED.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 5: Prescription specifies brand different from selected brand
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 5: Prescription specifies brand different from selected brand ---');
  // Attempt to verify brandTaximO (Taxim-O) when prescribed name was specifically "Zifi 200" without clinical rationale
  const resBrandDiscrepancy = await apiRequest(
    'PUT',
    `/api/prescriptions/${prescriptionB.id}/items/${rxItemsB[0].id}/pharmacist-verify`,
    {
      medicineId: brandTaximO.id,
      prescribedName: 'Zifi 200 Tablet', // Explicitly different brand
      quantity: 10,
      dosage: '200mg',
      clinicalNotes: '', // No clinical notes or authorization provided
      prescriberApprovalVerified: false
    },
    pharmacistToken
  );

  assert.strictEqual(resBrandDiscrepancy.status, 400, 'Should reject brand discrepancy without authorization');
  assert.strictEqual(resBrandDiscrepancy.body.code, 'BRAND_DISCREPANCY_APPROVAL_REQUIRED');
  console.log('✓ PASS: Brand discrepancy without justification blocked with BRAND_DISCREPANCY_APPROVAL_REQUIRED.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 6: Pharmacist requests prescriber clarification
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 6: Pharmacist requests prescriber clarification ---');
  const resClarification = await apiRequest('POST', `/api/prescriptions/${prescriptionB.id}/clarifications`, {
    type: 'PRESCRIBER_VERIFICATION',
    message: 'Need prescriber confirmation for brand substitution of Cefixime 200mg to Taxim-O 200.',
    orderId: resOrderB.body.order.id
  }, pharmacistToken);

  if (resClarification.status !== 200 && resClarification.status !== 201) {
    console.error('Clarification error response:', resClarification.status, resClarification.body);
  }

  // Clarification route response check
  assert.ok(resClarification.status === 200 || resClarification.status === 201, 'Clarification request should be logged');
  console.log('✓ PASS: Clarification requested and audit logged.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 7: Required approval is recorded and verified (outcome: APPROVED)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 7: Required approval is recorded and verified ---');
  const resPrescriberApproval = await apiRequest(
    'POST',
    `/api/prescriptions/${prescriptionB.id}/items/${rxItemsB[0].id}/prescriber-approval`,
    {
      verifiedWithDoctor: 'Dr. Joseph Kurian',
      verificationMethod: 'PHONE_CONSULT',
      clinicalNotes: 'Spoke directly with Dr. Kurian; approved Taxim-O 200mg as bioequivalent substitute.',
      outcome: 'APPROVED',
      prescriberContact: '+91-98460-12345'
    },
    pharmacistToken
  );

  if (resPrescriberApproval.status !== 200) {
    console.error('Test 7 Prescriber Approval error:', resPrescriberApproval.status, resPrescriberApproval.body);
  }

  assert.strictEqual(resPrescriberApproval.status, 200, 'Prescriber approval recording should succeed');
  assert.strictEqual(resPrescriberApproval.body.success, true);
  assert.strictEqual(resPrescriberApproval.body.item.isVerified, true, 'Item must become clinically verified');

  // Verify order item was synced from AWAITING_VERIFICATION to PENDING
  const updatedOrderB = await prisma.order.findUnique({
    where: { id: resOrderB.body.order.id },
    include: { items: true }
  });
  const updatedItemB = updatedOrderB.items[0];
  assert.strictEqual(updatedItemB.status, 'PENDING', 'Synced order item should now be PENDING');
  assert.strictEqual(updatedItemB.unfulfilledReason, null, 'Unfulfilled reason cleared upon clinical verification');
  console.log('✓ PASS: Prescriber approval recorded, item verified, and order item transitioned to PENDING.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 8: Pharmacist rejects proposed brand (outcome: REJECTED)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 8: Pharmacist rejects proposed brand with clinical reason ---');
  // Create another prescription to test rejection
  const prescriptionReject = await prisma.prescription.create({
    data: {
      userId: patientUser.id,
      filePath: 'uploads/prescriptions/rx_reject.jpg',
      originalFileName: 'rx_reject.jpg',
      status: 'OCR_COMPLETED',
      ocrRawText: 'Rx:\n1. Tab Cefixime 200mg\n',
      detectedMedicines: {
        create: [
          {
            rawName: 'Tab Cefixime 200mg',
            extractedQuantity: 10,
            quantity: 10,
            dosage: '200mg',
            isConfirmed: false
          }
        ]
      }
    },
    include: { detectedMedicines: true }
  });

  await apiRequest('PUT', `/api/prescriptions/${prescriptionReject.id}/verify`, {
    items: [
      {
        id: prescriptionReject.detectedMedicines[0].id,
        rawName: 'Tab Cefixime 200mg',
        matchedMedicineId: brandZifi.id,
        quantity: 10,
        dosage: '200mg',
        selectionOption: 'DOCTOR_APPROVAL',
        doctorApproval: {
          doctorName: 'Dr. Unknown',
          clinicOrHospital: 'Unknown Clinic'
        },
        pharmacistSelectionRequested: false
      }
    ]
  }, patientToken);

  const rxItemsReject = await prisma.prescriptionItem.findMany({ where: { prescriptionId: prescriptionReject.id } });
  
  // Create order for prescriptionReject so pharmacy has active order to review
  const resOrderReject = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionReject.id,
    orderType: 'RESERVATION',
    fulfillmentType: 'STORE_PICKUP',
    items: [
      {
        medicineId: brandZifi.id,
        prescriptionItemId: rxItemsReject[0].id,
        quantity: 10,
        isDoctorApprovedClaim: true
      }
    ]
  }, patientToken);

  assert.strictEqual(resOrderReject.status, 201, 'Order for prescription rejection test created');

  const resReject = await apiRequest(
    'PUT',
    `/api/prescriptions/${prescriptionReject.id}/items/${rxItemsReject[0].id}/reject`,
    {
      reason: 'Prescribing doctor could not be confirmed and refused brand substitution.'
    },
    pharmacistToken
  );

  assert.strictEqual(resReject.status, 200, 'Rejection should succeed');
  assert.strictEqual(resReject.body.success, true);

  // Verify linked order item was marked REJECTED
  const updatedOrderReject = await prisma.order.findUnique({
    where: { id: resOrderReject.body.order.id },
    include: { items: true }
  });
  assert.strictEqual(updatedOrderReject.items[0].status, 'REJECTED', 'Linked OrderItem must be marked REJECTED');
  console.log('✓ PASS: Proposed brand rejected and linked OrderItem marked REJECTED.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 9: Exact prescribed product is available in catalogue
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 9: Exact prescribed product available in catalogue ---');
  const matchExact = ocrMatcher.matchPrescriptionLine(
    'Augmentin 625 Duo Tablet 1 tab BD x 5 days',
    [brandTaximO, brandZifi, exactBrandAugmentin]
  );
  assert.ok(
    matchExact.matchedMedicineId === exactBrandAugmentin.id || matchExact.matchedMedicineId === 'cat-011',
    'Should match exact catalogue medicine'
  );

  const prescriptionExact = await prisma.prescription.create({
    data: {
      userId: patientUser.id,
      filePath: 'uploads/prescriptions/rx_exact.jpg',
      originalFileName: 'rx_exact.jpg',
      status: 'OCR_COMPLETED',
      ocrRawText: 'Rx:\n1. Augmentin 625 Duo Tablet\n',
      detectedMedicines: {
        create: [
          {
            rawName: 'Augmentin 625 Duo Tablet',
            extractedQuantity: 10,
            quantity: 10,
            dosage: '625mg',
            isConfirmed: true
          }
        ]
      }
    },
    include: { detectedMedicines: true }
  });

  const resVerifyExact = await apiRequest('PUT', `/api/prescriptions/${prescriptionExact.id}/verify`, {
    items: [
      {
        id: prescriptionExact.detectedMedicines[0].id,
        rawName: 'Augmentin 625 Duo Tablet',
        matchedMedicineId: exactBrandAugmentin.id,
        quantity: 10,
        dosage: '625mg'
      }
    ]
  }, patientToken);

  assert.strictEqual(resVerifyExact.status, 200, 'Exact catalogue product should verify normally');
  const rxItemsExact = await prisma.prescriptionItem.findMany({ where: { prescriptionId: prescriptionExact.id } });
  assert.strictEqual(rxItemsExact[0].isVerified, true, 'Exact product should be verified');
  console.log('✓ PASS: Exact prescribed product verified normally without forced review.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 10: Selected product becomes unavailable before fulfilment
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 10: Product unavailable blocks confirmation / fulfilment ---');
  // Create an order with an item
  const resOrderUnavail = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionExact.id,
    orderType: 'RESERVATION',
    fulfillmentType: 'STORE_PICKUP',
    items: [
      {
        medicineId: exactBrandAugmentin.id,
        prescriptionItemId: rxItemsExact[0].id,
        quantity: 10
      }
    ]
  }, patientToken);

  const orderUnavailId = resOrderUnavail.body.order.id;

  // Mark item unavailable
  const resMarkUnavail = await apiRequest(
    'PUT',
    `/api/prescriptions/${prescriptionExact.id}/items/${rxItemsExact[0].id}/unavailable`,
    {
      reason: 'Batch recalled by manufacturer; stock depleted.'
    },
    pharmacistToken
  );

  assert.strictEqual(resMarkUnavail.status, 200, 'Mark unavailable endpoint should succeed');

  // Attempt to confirm order with unavailable item -> must be blocked
  const resConfirmBlocked = await apiRequest(
    'PUT',
    `/api/orders/${orderUnavailId}/status`,
    { status: 'CONFIRMED' },
    pharmacistToken
  );

  if (resConfirmBlocked.status !== 400) {
    console.error('Test 10 confirm blocked response:', resConfirmBlocked.status, resConfirmBlocked.body);
  }

  assert.strictEqual(resConfirmBlocked.status, 400, 'Transition to CONFIRMED must be blocked when item is unavailable/unverified');
  console.log('✓ PASS: Unavailable product status correctly blocks order confirmation.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 11: Backend API attempts to bypass verification
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 11: Backend API attempts to bypass verification ---');
  const prescriptionBypass = await prisma.prescription.create({
    data: {
      userId: patientUser.id,
      filePath: 'uploads/prescriptions/rx_bypass.jpg',
      originalFileName: 'rx_bypass.jpg',
      status: 'OCR_COMPLETED',
      ocrRawText: 'Rx:\n1. Tab Cefixime 200mg\n',
      detectedMedicines: {
        create: [
          {
            rawName: 'Tab Cefixime 200mg',
            extractedQuantity: 10,
            quantity: 10,
            dosage: '200mg',
            isConfirmed: false
          }
        ]
      }
    },
    include: { detectedMedicines: true }
  });

  // Client directly selects Taxim-O 200 without doctor approval and without pharmacy review
  const resBypassAttempt = await apiRequest('PUT', `/api/prescriptions/${prescriptionBypass.id}/verify`, {
    items: [
      {
        id: prescriptionBypass.detectedMedicines[0].id,
        rawName: 'Tab Cefixime 200mg',
        matchedMedicineId: brandTaximO.id, // Proprietary brand
        quantity: 10,
        dosage: '200mg',
        pharmacistSelectionRequested: false // No Option A
        // No doctorApproval provided (No Option B)
      }
    ]
  }, patientToken);

  assert.strictEqual(resBypassAttempt.status, 400, 'Must return HTTP 400 when attempting to bypass generic verification');
  assert.strictEqual(resBypassAttempt.body.code, 'GENERIC_SELECTION_RESTRICTED');
  console.log('✓ PASS: Direct brand selection for generic blocked with HTTP 400 GENERIC_SELECTION_RESTRICTED.\n');
  passedCases++;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE 12: Existing pickup and delivery orders still work
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST CASE 12: Existing pickup and delivery orders still work ---');
  // Order A: Pickup order
  const resPickupOrder = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionExact.id,
    orderType: 'RESERVATION',
    fulfillmentType: 'STORE_PICKUP',
    items: [
      {
        medicineId: brandTaximO.id,
        quantity: 2
      }
    ]
  }, patientToken);
  assert.strictEqual(resPickupOrder.status, 201, 'Standard store pickup order should succeed');
  assert.strictEqual(resPickupOrder.body.order.orderType, 'RESERVATION');

  // Order B: Delivery order with address
  const resDeliveryOrder = await apiRequest('POST', '/api/orders', {
    pharmacyId: pharmacyA.id,
    prescriptionId: prescriptionExact.id,
    orderType: 'RESERVATION',
    deliveryAddress: 'Flat 4B, Emerald Residency, Kochi',
    items: [
      {
        medicineId: brandZifi.id,
        quantity: 2
      }
    ]
  }, patientToken);
  assert.strictEqual(resDeliveryOrder.status, 201, 'Standard delivery order should succeed');
  assert.strictEqual(resDeliveryOrder.body.order.orderType, 'RESERVATION');
  console.log('✓ PASS: Standard pickup and delivery order workflows function properly.\n');
  passedCases++;

  console.log('========================================================================');
  console.log(`🎉 ALL ${passedCases} OF 12 TEST CASES PASSED SUCCESSFULLY!`);
  console.log('========================================================================\n');
}

runTestSuite()
  .catch(err => {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
