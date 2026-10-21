/**
 * Phase 6.1L.4 — Assistant Task Lifecycle Test Suite
 * Tests:
 * 1. Canonical 8 service types definition and validation.
 * 2. Rejection of invalid serviceType.
 * 3. Strict sequential state machine: AVAILABLE -> ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED -> CONFIRMED.
 * 4. Invalid out-of-order transitions rejected.
 * 5. Full lifecycle execution across all 8 service types.
 * 6. Service-specific completion wording:
 *    - Only MEDICINE_DELIVERY uses explicit delivery/drop-off wording.
 *    - Non-delivery services do NOT show "medicine delivered" or "drop-off" language.
 *    - MEDICINE_COLLECTION uses collection/handover language.
 * 7. Preservation of PIN / handover verification flow.
 * 8. Assistant clinical-data isolation (prescriptionId, prescription, diagnostics stripped).
 * 9. Frontend source verification in AssistantPortal.jsx and OrderTracking.jsx.
 */

const prisma = require('./src/prisma');
const path = require('path');
const fs = require('fs');
const assistantController = require('./src/controllers/assistantController');

let pass = 0;
let fail = 0;

function check(label, value) {
  if (value) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

const CANONICAL_8_SERVICES = [
  'MEDICINE_COLLECTION',
  'PHARMACY_VISIT',
  'PHARMACY_COMPANION',
  'MEDICINE_DELIVERY',
  'DIGITAL_ASSISTANCE',
  'PHARMACY_COMMS',
  'RESTOCK_ASSISTANCE',
  'PRESCRIPTION_ASSISTANCE'
];

async function run() {
  console.log('\n=== Phase 6.1L.4 Assistant Task Lifecycle Test Suite ===\n');

  try {
    // -------------------------------------------------------------
    // 1. Canonical 8 Service Types & Config
    // -------------------------------------------------------------
    console.log('--- 1. Canonical 8 Service Types & Validation ---');
    check('assistantController exports VALID_ASSISTANT_SERVICE_TYPES',
      Array.isArray(assistantController.VALID_ASSISTANT_SERVICE_TYPES));

    check('VALID_ASSISTANT_SERVICE_TYPES contains exactly 8 canonical services',
      assistantController.VALID_ASSISTANT_SERVICE_TYPES.length === 8 &&
      CANONICAL_8_SERVICES.every(s => assistantController.VALID_ASSISTANT_SERVICE_TYPES.includes(s)));

    // -------------------------------------------------------------
    // 2. Service Progress Details & Wording Isolation
    // -------------------------------------------------------------
    console.log('\n--- 2. Service Progress Details & Non-Delivery Isolation ---');
    const deliveryCollecting = assistantController.getServiceProgressDetails('MEDICINE_DELIVERY', 'COLLECTING', 'Apollo', 'Rahul');
    const deliveryInTransit = assistantController.getServiceProgressDetails('MEDICINE_DELIVERY', 'IN_TRANSIT', 'Apollo', 'Rahul');
    const deliveryDelivered = assistantController.getServiceProgressDetails('MEDICINE_DELIVERY', 'DELIVERED', 'Apollo', 'Rahul');
    const deliveryConfirmed = assistantController.getServiceProgressDetails('MEDICINE_DELIVERY', 'CONFIRMED', 'Apollo', 'Rahul');

    check('MEDICINE_DELIVERY uses in transit wording',
      deliveryInTransit.historyComment.includes('In transit to patient delivery address') &&
      deliveryInTransit.notifTitle.includes('Medicines In Transit'));

    check('MEDICINE_DELIVERY uses delivery confirmed wording',
      deliveryConfirmed.historyComment.includes('Package successfully delivered') &&
      deliveryConfirmed.notifTitle.includes('Medicine Delivery Confirmed'));

    // Test non-delivery services: strictly no "medicine delivered", "drop-off", or "delivery address"
    const nonDeliveryServices = [
      'DIGITAL_ASSISTANCE',
      'PRESCRIPTION_ASSISTANCE',
      'PHARMACY_COMMS',
      'PHARMACY_VISIT',
      'PHARMACY_COMPANION',
      'RESTOCK_ASSISTANCE'
    ];

    for (const service of nonDeliveryServices) {
      for (const st of ['COLLECTING', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED']) {
        const details = assistantController.getServiceProgressDetails(service, st, 'Apollo', 'Rahul');
        const text = `${details.historyComment} ${details.notifTitle} ${details.notifMsg}`.toLowerCase();

        const hasForbiddenDeliveryWording =
          text.includes('medicine delivered') ||
          text.includes('drop-off') ||
          text.includes('delivery address') ||
          text.includes('package delivered');

        check(`Non-delivery ${service} in ${st} has no delivery/drop-off wording`,
          !hasForbiddenDeliveryWording);
      }
    }

    // Test MEDICINE_COLLECTION uses collection wording, not drop-off
    const colCollecting = assistantController.getServiceProgressDetails('MEDICINE_COLLECTION', 'COLLECTING', 'Apollo', 'Rahul');
    const colInTransit = assistantController.getServiceProgressDetails('MEDICINE_COLLECTION', 'IN_TRANSIT', 'Apollo', 'Rahul');
    const colConfirmed = assistantController.getServiceProgressDetails('MEDICINE_COLLECTION', 'CONFIRMED', 'Apollo', 'Rahul');

    check('MEDICINE_COLLECTION uses collection wording',
      colCollecting.notifTitle.includes('Medicine Collection Underway') &&
      colInTransit.notifTitle.includes('Medicine Ready for Handover') &&
      colConfirmed.notifTitle.includes('Medicine Collection Confirmed'));

    // -------------------------------------------------------------
    // 3. Clinical-Data Isolation Helper
    // -------------------------------------------------------------
    console.log('\n--- 3. Assistant Clinical-Data Isolation ---');
    const mockTask = {
      id: 'task-123',
      handoverPin: '4821',
      serviceType: 'DIGITAL_ASSISTANCE',
      order: {
        id: 'ord-123',
        prescriptionId: 'presc-999-clinical-secret',
        verificationPin: '4821',
        prescription: { image: 'rx.jpg', doctor: 'Dr. John' },
        detectedMedicines: [{ id: 'dm-1', name: 'Atorvastatin' }],
        pharmacy: { name: 'Apollo Pharmacy' }
      }
    };

    const sanitizedTask = assistantController.sanitizeTaskForAssistant(mockTask, { includeHandoverPin: false });
    check('sanitizeTaskForAssistant strips handoverPin by default',
      sanitizedTask.handoverPin === undefined);
    check('sanitizeTaskForAssistant strips prescriptionId',
      sanitizedTask.order.prescriptionId === undefined);
    check('sanitizeTaskForAssistant strips prescription relation',
      sanitizedTask.order.prescription === undefined);
    check('sanitizeTaskForAssistant strips detectedMedicines',
      sanitizedTask.order.detectedMedicines === undefined);
    check('sanitizeTaskForAssistant strips order verificationPin',
      sanitizedTask.order.verificationPin === undefined);
    check('sanitizeTaskForAssistant preserves non-clinical order details',
      sanitizedTask.order.pharmacy.name === 'Apollo Pharmacy' && sanitizedTask.id === 'task-123');

    // -------------------------------------------------------------
    // 4. Functional DB Lifecycle Tests with All 8 Service Types
    // -------------------------------------------------------------
    console.log('\n--- 4. Functional End-to-End Lifecycle across 8 Service Types ---');

    // Find or create test entities
    let assistantUser = await prisma.user.findFirst({ where: { role: 'ASSISTANT' } });
    if (!assistantUser) {
      assistantUser = await prisma.user.create({
        data: {
          name: 'Phase 61L4 Assistant',
          email: `assistant_p61l4_${Date.now()}@medifind.test`,
          passwordHash: 'dummyhash',
          role: 'ASSISTANT',
          phone: '+919998887766'
        }
      });
    }

    let patientUser = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
    if (!patientUser) {
      patientUser = await prisma.user.create({
        data: {
          name: 'Phase 61L4 Patient',
          email: `patient_p61l4_${Date.now()}@medifind.test`,
          passwordHash: 'dummyhash',
          role: 'PATIENT',
          phone: '+919876543210'
        }
      });
    }

    let pharmacy = await prisma.pharmacy.findFirst({ where: { isVerified: true, verificationStatus: 'VERIFIED' } });
    if (!pharmacy) {
      pharmacy = await prisma.pharmacy.create({
        data: {
          name: 'Apollo Verified Lifecycle Pharmacy',
          address: 'Main St, Chengannur',
          city: 'Chengannur',
          isVerified: true,
          verificationStatus: 'VERIFIED',
          phone: '+914792451122'
        }
      });
    }

    // Ensure test assistant possesses full capabilities for testing all 8 canonical services
    await prisma.assistantProfile.upsert({
      where: { userId: assistantUser.id },
      update: {
        capabilities: CANONICAL_8_SERVICES.join(','),
        isActive: true,
        isAvailable: true,
        assistantType: 'DELIVERY_ASSISTANT'
      },
      create: {
        userId: assistantUser.id,
        capabilities: CANONICAL_8_SERVICES.join(','),
        isActive: true,
        isAvailable: true,
        assistantType: 'DELIVERY_ASSISTANT',
        onboardingCompleted: true
      }
    });

    // Helper to simulate request/response
    function createMockRes() {
      return {
        statusCode: 200,
        data: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.data = d; return this; }
      };
    }

    // Test A: Invalid serviceType rejection
    console.log('Testing invalid serviceType rejection...');
    const testInvalidOrder = await prisma.order.create({
      data: {
        orderNumber: `MF-TEST-INV-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'INVALID_SERVICE_TYPE',
        verificationPin: '9999'
      }
    });

    const invalidTask = await prisma.assistantTask.create({
      data: {
        orderId: testInvalidOrder.id,
        status: 'AVAILABLE',
        serviceType: 'INVALID_SERVICE_TYPE',
        handoverPin: '9999'
      }
    });

    const mockReqAcceptInvalid = {
      params: { id: invalidTask.id },
      user: assistantUser
    };
    const mockResAcceptInvalid = createMockRes();
    await assistantController.acceptTask(mockReqAcceptInvalid, mockResAcceptInvalid);

    check('acceptTask rejects invalid serviceType with 400',
      mockResAcceptInvalid.statusCode === 400 &&
      mockResAcceptInvalid.data.error.includes('Invalid serviceType'));

    // Test B: Sequential State Machine & Lifecycle for all 8 canonical types
    for (const serviceType of CANONICAL_8_SERVICES) {
      const pin = `${Math.floor(1000 + Math.random() * 9000)}`;
      const order = await prisma.order.create({
        data: {
          orderNumber: `MF-61L4-${serviceType.slice(0, 4)}-${Date.now()}`,
          userId: patientUser.id,
          pharmacyId: pharmacy.id,
          status: 'CONFIRMED',
          fulfillmentType: 'ASSISTANT_DELIVERY',
          assistantServiceType: serviceType,
          verificationPin: pin,
          prescriptionId: 'secret-presc-id-to-isolate'
        }
      });

      const task = await prisma.assistantTask.create({
        data: {
          orderId: order.id,
          status: 'AVAILABLE',
          serviceType: serviceType,
          handoverPin: pin
        }
      });

      // Step 1: AVAILABLE -> ACCEPTED
      const reqAccept = { params: { id: task.id }, user: assistantUser };
      const resAccept = createMockRes();
      await assistantController.acceptTask(reqAccept, resAccept);

      check(`[${serviceType}] acceptTask transitions to ACCEPTED`,
        resAccept.statusCode === 200 && resAccept.data.task.status === 'ACCEPTED');

      check(`[${serviceType}] acceptTask response strips prescriptionId (clinical isolation)`,
        resAccept.data.task.order.prescriptionId === undefined);

      check(`[${serviceType}] acceptTask response strips handoverPin`,
        resAccept.data.task.handoverPin === undefined);

      // Step 2: Invalid transition attempt (ACCEPTED -> DELIVERED, skipping COLLECTING)
      const reqSkip = {
        params: { id: task.id },
        body: { status: 'DELIVERED' },
        user: assistantUser
      };
      const resSkip = createMockRes();
      await assistantController.progressTaskStatus(reqSkip, resSkip);

      check(`[${serviceType}] Out-of-order transition (ACCEPTED -> DELIVERED) rejected with 400`,
        resSkip.statusCode === 400 && resSkip.data.error.includes('Invalid transition'));

      // Step 3: ACCEPTED -> COLLECTING
      const reqCol = {
        params: { id: task.id },
        body: { status: 'COLLECTING' },
        user: assistantUser
      };
      const resCol = createMockRes();
      await assistantController.progressTaskStatus(reqCol, resCol);

      check(`[${serviceType}] Progress to COLLECTING succeeds`,
        resCol.statusCode === 200 && resCol.data.task.status === 'COLLECTING');

      // Step 4: COLLECTING -> IN_TRANSIT
      const reqTransit = {
        params: { id: task.id },
        body: { status: 'IN_TRANSIT' },
        user: assistantUser
      };
      const resTransit = createMockRes();
      await assistantController.progressTaskStatus(reqTransit, resTransit);

      check(`[${serviceType}] Progress to IN_TRANSIT succeeds`,
        resTransit.statusCode === 200 && resTransit.data.task.status === 'IN_TRANSIT');

      // Step 5: IN_TRANSIT -> DELIVERED
      const reqDelivered = {
        params: { id: task.id },
        body: { status: 'DELIVERED' },
        user: assistantUser
      };
      const resDelivered = createMockRes();
      await assistantController.progressTaskStatus(reqDelivered, resDelivered);

      check(`[${serviceType}] Progress to DELIVERED succeeds`,
        resDelivered.statusCode === 200 && resDelivered.data.task.status === 'DELIVERED');

      // Step 6: DELIVERED -> CONFIRMED with wrong PIN
      const reqWrongPin = {
        params: { id: task.id },
        body: { status: 'CONFIRMED', handoverPin: '0000' },
        user: assistantUser
      };
      const resWrongPin = createMockRes();
      await assistantController.progressTaskStatus(reqWrongPin, resWrongPin);

      check(`[${serviceType}] CONFIRMED with wrong PIN rejected with 400`,
        resWrongPin.statusCode === 400 && resWrongPin.data.error.includes('Invalid recipient handover PIN'));

      // Step 7: DELIVERED -> CONFIRMED with correct PIN
      const reqCorrectPin = {
        params: { id: task.id },
        body: { status: 'CONFIRMED', handoverPin: pin },
        user: assistantUser
      };
      const resCorrectPin = createMockRes();
      await assistantController.progressTaskStatus(reqCorrectPin, resCorrectPin);

      check(`[${serviceType}] CONFIRMED with correct PIN succeeds`,
        resCorrectPin.statusCode === 200 && resCorrectPin.data.task.status === 'CONFIRMED');

      // Verify parent order is COMPLETED
      const finalOrder = await prisma.order.findUnique({ where: { id: order.id } });
      check(`[${serviceType}] Parent order updated to COMPLETED on task confirmation`,
        finalOrder.status === 'COMPLETED');
    }

    // -------------------------------------------------------------
    // 5. Frontend Consistency Source Checks
    // -------------------------------------------------------------
    console.log('\n--- 5. Frontend Consistency Source Verification ---');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');
    const trackingSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/OrderTracking.jsx'), 'utf-8');

    check('AssistantPortal contains getAssistantStepLabels helper',
      portalSrc.includes('function getAssistantStepLabels'));

    check('AssistantPortal uses service-aware Step B destination label',
      portalSrc.includes("isDelivery ? 'Step B: Patient Destination' : isCollection ? 'Step B: Handover Point' : 'Step B: Patient Contact'"));

    check('AssistantPortal uses service-aware verify button text',
      portalSrc.includes("task.serviceType === 'MEDICINE_DELIVERY'") &&
      portalSrc.includes("Verify PIN & Confirm Delivery Handover") &&
      portalSrc.includes("Verify PIN & Complete Service Handover"));

    check('AssistantPortal does not show No Completed Deliveries Yet in archive empty state',
      !portalSrc.includes('title="No Completed Deliveries Yet"'));

    check('OrderTracking 6-step timeline adapts to service types',
      trackingSrc.includes('const sType = detailOrder?.assistantServiceType || detailOrder?.assistantTask?.serviceType') &&
      trackingSrc.includes('Pickup at pharmacy') &&
      trackingSrc.includes('Assistance in progress'));

    check('OrderTracking does not use Clinical agent assigned',
      !trackingSrc.includes('Clinical agent assigned'));

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n========================================`);
    console.log(`Phase 6.1L.4 Tests Completed: ${pass} passed, ${fail} failed.`);
    console.log(`========================================\n`);

    if (fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error in test_phase6_1L4_task_lifecycle:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
