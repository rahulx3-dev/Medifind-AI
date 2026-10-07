/**
 * Test Suite: Phase 6.1L.11 — Medicine Access Assistant Booking & Fulfillment Integrity
 *
 * Comprehensive audit & verification covering:
 * 1. Specific assistant selection (Order.selectedAssistantId, AssistantTask.assistantId)
 * 2. No silent substitution at booking or payment time
 * 3. Capability gating for canonical services
 * 4. Empty-capability assistant cannot receive or accept tasks
 * 5. Initial task state is ASSIGNED
 * 6. acceptedAt is null initially
 * 7. Explicit acceptance required (cannot auto-accept)
 * 8. Strict linear state machine (ASSIGNED -> ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED -> CONFIRMED)
 * 9. Only assigned assistant can accept (competitor/unrelated assistant gets 403)
 * 10. Concurrency & double-accept safety (simultaneous accept: only one succeeds)
 * 11. Service-specific workflow language for non-delivery services
 * 12. Non-clinical safety boundary preserved
 * 13. Address privacy before assignment (unassigned task strips patient address)
 * 14. Address access after assignment (physical services get address; non-address services strip it)
 * 15. Unrelated assistant cannot access task address or order details
 * 16. Prescription & medical-data isolation (prescriptionId, OCR, detectedMedicines, PINs stripped)
 * 17. Selected assistant & service consistency (cannot change assistant/service after assignment)
 * 18. Cannot change assistant ID after payment
 * 19. Handover PIN verification on DELIVERED -> CONFIRMED (cannot confirm with wrong/missing PIN)
 * 20. Patient confirmation integrity (patient-only confirm-receipt; assistant cannot self-confirm without PIN)
 * 21. Notification isolation (only assigned assistant and ordering patient receive notifications)
 * 22. Cross-user task isolation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('./src/prisma');
const assistantController = require('./src/controllers/assistantController');
const checkoutController = require('./src/controllers/checkoutController');
const orderController = require('./src/controllers/orderController');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
}

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

async function run() {
  console.log('\n=== Phase 6.1L.11 — Assistant Booking & Fulfillment Integrity Test Suite ===\n');

  try {
    // -------------------------------------------------------------
    // Setup Test Entities
    // -------------------------------------------------------------
    const patientUser = await prisma.user.create({
      data: {
        name: 'Patient Sunita',
        email: `sunita_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT',
        phone: '+919876544001'
      }
    });

    const patientAddress = await prisma.patientAddress.create({
      data: {
        userId: patientUser.id,
        recipientName: 'Patient Sunita',
        addressLine1: 'Flat 4B, Hilltop Residency',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121',
        isDefault: true
      }
    });

    // Assistant A: Active + Available, supports MEDICINE_DELIVERY & PHARMACY_VISIT
    const asstUserA = await prisma.user.create({
      data: {
        name: 'Assistant Ramesh',
        email: `ramesh_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876544002'
      }
    });
    const profileA = await prisma.assistantProfile.create({
      data: {
        userId: asstUserA.id,
        bio: 'Verified Medicine Access Assistant.',
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT'
      }
    });

    // Assistant B: Active + Available, supports DIGITAL_ASSISTANCE only
    const asstUserB = await prisma.user.create({
      data: {
        name: 'Assistant Deepa',
        email: `deepa_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876544003'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstUserB.id,
        bio: 'Digital support volunteer.',
        isActive: true,
        isAvailable: true,
        capabilities: 'DIGITAL_ASSISTANCE'
      }
    });

    // Assistant C: Has EMPTY capabilities (should not receive or accept tasks)
    const asstUserC = await prisma.user.create({
      data: {
        name: 'Assistant Empty',
        email: `empty_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876544004'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstUserC.id,
        bio: 'New assistant with no configured capabilities.',
        isActive: true,
        isAvailable: true,
        capabilities: ''
      }
    });

    // Assistant D: Unrelated Assistant (for cross-user isolation testing)
    const asstUserD = await prisma.user.create({
      data: {
        name: 'Assistant Vivek',
        email: `vivek_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876544005'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstUserD.id,
        bio: 'Unrelated assistant.',
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY'
      }
    });

    // Real Participating Pharmacy
    const pharmacy = await prisma.pharmacy.findFirst({
      where: { isVerified: true, verificationStatus: 'VERIFIED' },
      include: { inventory: { include: { medicine: true } } }
    });
    if (!pharmacy) throw new Error('No verified participating pharmacy in DB');

    const invItem = pharmacy.inventory[0];
    if (!invItem) throw new Error('No inventory item found');

    // -------------------------------------------------------------
    // T1: Specific Assistant Selection Required
    // -------------------------------------------------------------
    console.log('\n--- Section 1: Specific Assistant Selection & Silent Substitution Prevention ---');

    // Create base confirmed order for testing checkout
    const order1 = await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}-1`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        verificationPin: '4321',
        medicineSubtotal: 100.0,
        totalAmount: 100.0,
        items: {
          create: [{
            medicineId: invItem.medicineId,
            quantity: 1,
            unitPrice: 100.0,
            subtotal: 100.0
          }]
        }
      }
    });

    const resNoAsst = createMockRes();
    await checkoutController.selectFulfillment({
      params: { orderId: order1.id },
      user: patientUser,
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        addressId: patientAddress.id
        // omitting assistantId
      }
    }, resNoAsst);
    check('T1. Omitting specific assistant for ASSISTANT_DELIVERY rejected with 400',
      resNoAsst.statusCode === 400 && resNoAsst.data?.error?.includes('select a specific Medicine Access Assistant'));

    // -------------------------------------------------------------
    // T2: Capability Gating on Assistant Selection
    // -------------------------------------------------------------
    const resWrongCap = createMockRes();
    await checkoutController.selectFulfillment({
      params: { orderId: order1.id },
      user: patientUser,
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: asstUserB.id, // Only supports DIGITAL_ASSISTANCE
        addressId: patientAddress.id
      }
    }, resWrongCap);
    check('T2. Selecting assistant without required capability rejected with 400',
      resWrongCap.statusCode === 400 && resWrongCap.data?.error?.includes('does not possess the supported capability'));

    // -------------------------------------------------------------
    // T3: Assistant with Empty Capabilities Rejected
    // -------------------------------------------------------------
    const resEmptyCap = createMockRes();
    await checkoutController.selectFulfillment({
      params: { orderId: order1.id },
      user: patientUser,
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: asstUserC.id, // Has empty capabilities
        addressId: patientAddress.id
      }
    }, resEmptyCap);
    check('T3. Selecting assistant with empty capabilities rejected with 400',
      resEmptyCap.statusCode === 400 && resEmptyCap.data?.error?.includes('no registered service capabilities'));

    const resEmptyDiscover = createMockRes();
    await assistantController.getAvailableTasks({
      user: asstUserC
    }, resEmptyDiscover);
    check('T4. Empty-capability assistant receives 0 available tasks',
      resEmptyDiscover.statusCode === 200 && resEmptyDiscover.data?.count === 0 && resEmptyDiscover.data?.assistantStatus?.message?.includes('no active capabilities'));

    // -------------------------------------------------------------
    // T5: Successful Specific Assistant Selection
    // -------------------------------------------------------------
    const resValidSelect = createMockRes();
    await checkoutController.selectFulfillment({
      params: { orderId: order1.id },
      user: patientUser,
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: asstUserA.id,
        addressId: patientAddress.id
      }
    }, resValidSelect);
    check('T5. Valid specific assistant selection succeeds',
      resValidSelect.statusCode === 200 && resValidSelect.data?.selectedAssistantId === asstUserA.id);

    // Verify order.selectedAssistantId is preserved
    const updatedOrder1 = await prisma.order.findUnique({ where: { id: order1.id } });
    check('T6. Order.selectedAssistantId is strictly preserved',
      updatedOrder1.selectedAssistantId === asstUserA.id);

    // -------------------------------------------------------------
    // T7: No Silent Substitution at Payment Time
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Revalidation & No Silent Substitution at Payment ---');

    // Simulate Assistant A temporarily becoming unavailable
    await prisma.assistantProfile.update({
      where: { userId: asstUserA.id },
      data: { isAvailable: false }
    });

    const resPayUnavailable = createMockRes();
    await checkoutController.createPayment({
      params: { orderId: order1.id },
      user: patientUser
    }, resPayUnavailable);
    check('T7. Ineligible assistant at payment creation rejected cleanly with 400 (no silent substitution)',
      resPayUnavailable.statusCode === 400 && resPayUnavailable.data?.error?.includes('unavailable'));

    // Restore Assistant A availability
    await prisma.assistantProfile.update({
      where: { userId: asstUserA.id },
      data: { isAvailable: true }
    });

    // -------------------------------------------------------------
    // T8: Task State Machine Initial State (ASSIGNED, acceptedAt: null)
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Task State Machine & Linear Transitions ---');

    // Simulate payment completion via verifyPayment
    const razorpay_order_id = `order_test_${Date.now()}`;
    const razorpay_payment_id = `pay_test_${Date.now()}`;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'test_secret';
    const razorpay_signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    await prisma.payment.upsert({
      where: { orderId: order1.id },
      create: {
        orderId: order1.id,
        amount: 150.0,
        currency: 'INR',
        method: 'ONLINE',
        status: 'PENDING',
        gatewayOrderId: razorpay_order_id
      },
      update: {
        gatewayOrderId: razorpay_order_id,
        status: 'PENDING'
      }
    });

    const resVerifyPay = createMockRes();
    await checkoutController.verifyPayment({
      params: { orderId: order1.id },
      user: patientUser,
      body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
    }, resVerifyPay);

    const task1 = await prisma.assistantTask.findUnique({ where: { orderId: order1.id } });
    check('T8. Created task is in ASSIGNED status (not auto-accepted)',
      task1 && task1.status === 'ASSIGNED');
    check('T9. Task acceptedAt is null initially upon assignment',
      task1 && task1.acceptedAt === null);
    check('T10. Task assistantId matches selected assistant (Order ↔ Task consistency)',
      task1 && task1.assistantId === asstUserA.id);

    // -------------------------------------------------------------
    // T11: Invalid Transitions From ASSIGNED
    // -------------------------------------------------------------
    const resSkipCollect = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'COLLECTING' }
    }, resSkipCollect);
    check('T11. ASSIGNED task cannot skip directly to COLLECTING (rejected with 400)',
      resSkipCollect.statusCode === 400);

    // -------------------------------------------------------------
    // T12: Only Assigned Assistant Can Accept
    // -------------------------------------------------------------
    const resOtherAccept = createMockRes();
    await assistantController.acceptTask({
      params: { id: task1.id },
      user: asstUserD // Vivek (unrelated assistant)
    }, resOtherAccept);
    check('T12. Unrelated assistant cannot accept assigned task (rejected with 403)',
      resOtherAccept.statusCode === 403);

    // -------------------------------------------------------------
    // T13: Concurrency / Double Acceptance Protection
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Concurrency & Double Acceptance ---');

    // Run two simultaneous acceptance requests by Assistant A
    const [resAccept1, resAccept2] = await Promise.all([
      (async () => {
        const res = createMockRes();
        await assistantController.acceptTask({ params: { id: task1.id }, user: asstUserA }, res);
        return res;
      })(),
      (async () => {
        const res = createMockRes();
        await assistantController.acceptTask({ params: { id: task1.id }, user: asstUserA }, res);
        return res;
      })()
    ]);

    const oneSucceeded = (resAccept1.statusCode === 200 && resAccept2.statusCode === 400) ||
                         (resAccept1.statusCode === 400 && resAccept2.statusCode === 200);
    check('T13. Concurrent accept: exactly one succeeds, duplicate rejected (no double accept)',
      oneSucceeded);

    const taskAfterAccept = await prisma.assistantTask.findUnique({ where: { id: task1.id } });
    check('T14. Task status transitioned to ACCEPTED with server-generated acceptedAt',
      taskAfterAccept.status === 'ACCEPTED' && taskAfterAccept.acceptedAt !== null);

    // -------------------------------------------------------------
    // T15: Strict Linear Transitions Enforced
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Strict Sequential State Flow & Terminal Locking ---');

    // Try skipping from ACCEPTED -> DELIVERED (invalid)
    const resSkipDeliv = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'DELIVERED' }
    }, resSkipDeliv);
    check('T15. ACCEPTED cannot skip directly to DELIVERED (rejected with 400)',
      resSkipDeliv.statusCode === 400);

    // Transition ACCEPTED -> COLLECTING
    const resCollect = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'COLLECTING' }
    }, resCollect);
    check('T16. ACCEPTED -> COLLECTING transition succeeds',
      resCollect.statusCode === 200 && resCollect.data?.task?.status === 'COLLECTING');

    // Invalid backward transition: COLLECTING -> ACCEPTED
    const resBackward = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'ACCEPTED' }
    }, resBackward);
    check('T17. Backward transition COLLECTING -> ACCEPTED rejected with 400',
      resBackward.statusCode === 400);

    // Transition COLLECTING -> IN_TRANSIT
    const resInTransit = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'IN_TRANSIT' }
    }, resInTransit);
    check('T18. COLLECTING -> IN_TRANSIT transition succeeds',
      resInTransit.statusCode === 200 && resInTransit.data?.task?.status === 'IN_TRANSIT');

    // Transition IN_TRANSIT -> DELIVERED
    const resDelivered = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'DELIVERED' }
    }, resDelivered);
    check('T19. IN_TRANSIT -> DELIVERED transition succeeds',
      resDelivered.statusCode === 200 && resDelivered.data?.task?.status === 'DELIVERED');

    // -------------------------------------------------------------
    // T20: Handover & Completion Integrity
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Handover Integrity & Patient Confirmation ---');

    // Assistant cannot confirm with wrong PIN
    const resWrongPin = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'CONFIRMED', handoverPin: '9999' }
    }, resWrongPin);
    check('T20. DELIVERED -> CONFIRMED with incorrect PIN rejected with 400',
      resWrongPin.statusCode === 400 && resWrongPin.data?.error?.includes('Invalid recipient handover PIN'));

    // Assistant cannot confirm without PIN
    const resNoPin = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'CONFIRMED' }
    }, resNoPin);
    check('T21. DELIVERED -> CONFIRMED without PIN rejected with 400',
      resNoPin.statusCode === 400 && resNoPin.data?.error?.includes('Invalid recipient handover PIN'));

    // Assistant role CANNOT call patient confirm-receipt endpoint (patient confirmation cannot be forged by assistant)
    const resAsstForge = createMockRes();
    await orderController.confirmReceipt({
      params: { id: order1.id },
      user: asstUserA
    }, resAsstForge);
    check('T22. Assistant cannot call patient confirm-receipt (rejected with 403)',
      resAsstForge.statusCode === 403 && resAsstForge.data?.error?.includes('Only the ordering patient'));

    // Patient confirms receipt directly
    const resPatientConfirm = createMockRes();
    await orderController.confirmReceipt({
      params: { id: order1.id },
      user: patientUser
    }, resPatientConfirm);
    check('T23. Patient confirms receipt directly -> Task CONFIRMED & Order COMPLETED',
      resPatientConfirm.statusCode === 200 &&
      resPatientConfirm.data?.task?.status === 'CONFIRMED' &&
      resPatientConfirm.data?.order?.status === 'COMPLETED');

    // Terminal CONFIRMED cannot be modified
    const resTerminalMod = createMockRes();
    await assistantController.progressTaskStatus({
      params: { id: task1.id },
      user: asstUserA,
      body: { status: 'DELIVERED' }
    }, resTerminalMod);
    check('T24. Terminal CONFIRMED task cannot be modified (rejected with 400)',
      resTerminalMod.statusCode === 400);

    // -------------------------------------------------------------
    // T25: Order Consistency & Immutability After Assignment
    // -------------------------------------------------------------
    console.log('\n--- Section 7: Order ↔ Task Consistency & Immutability ---');

    // Create a new CONFIRMED order with an assigned task to test assistant change prevention
    const orderAssigned = await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}-LOCK`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        selectedAssistantId: asstUserA.id,
        verificationPin: '8888',
        medicineSubtotal: 100.0,
        totalAmount: 100.0,
        items: {
          create: [{
            medicineId: invItem.medicineId,
            quantity: 1,
            unitPrice: 100.0,
            subtotal: 100.0
          }]
        }
      }
    });

    await prisma.assistantTask.create({
      data: {
        orderId: orderAssigned.id,
        status: 'ASSIGNED',
        assistantId: asstUserA.id,
        serviceType: 'MEDICINE_DELIVERY',
        handoverPin: '8888'
      }
    });

    // Attempt to modify assigned assistant
    const resChangeAsst = createMockRes();
    await checkoutController.selectFulfillment({
      params: { orderId: orderAssigned.id },
      user: patientUser,
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: asstUserD.id,
        addressId: patientAddress.id
      }
    }, resChangeAsst);
    check('T25. Modifying assistant after task assignment rejected with 400',
      resChangeAsst.statusCode === 400 && resChangeAsst.data?.error?.includes('Cannot modify assigned assistant after task has been assigned'));

    // -------------------------------------------------------------
    // T26: Address & Clinical Data Privacy Isolation
    // -------------------------------------------------------------
    console.log('\n--- Section 8: Address & Medical Data Privacy Isolation ---');

    // Unassigned task does NOT expose delivery address
    const unassignedRaw = {
      id: 'task_unassigned',
      serviceType: 'MEDICINE_DELIVERY',
      status: 'AVAILABLE',
      deliveryAddress: 'Flat 4B, Hilltop Residency, Chengannur',
      order: {
        deliveryAddress: 'Flat 4B, Hilltop Residency, Chengannur',
        prescriptionId: 'rx_secret_123',
        verificationPin: '4321',
        detectedMedicines: 'Amoxicillin 500mg'
      }
    };
    const sanitizedUnassigned = assistantController.sanitizeTaskForAssistant(unassignedRaw, { isAssigned: false });
    check('T26. Unassigned task payload completely strips deliveryAddress',
      sanitizedUnassigned.deliveryAddress === undefined &&
      sanitizedUnassigned.order?.deliveryAddress === undefined);

    // Medical data is strictly stripped for assistants
    check('T27. Assistant task payload strips prescriptionId, verificationPin, and detectedMedicines',
      sanitizedUnassigned.order?.prescriptionId === undefined &&
      sanitizedUnassigned.order?.verificationPin === undefined &&
      sanitizedUnassigned.order?.detectedMedicines === undefined);

    // Non-address service (DIGITAL_ASSISTANCE) strips delivery address even after assignment
    const digitalAssignedRaw = {
      id: 'task_digital',
      serviceType: 'DIGITAL_ASSISTANCE',
      status: 'ASSIGNED',
      assistantId: asstUserB.id,
      deliveryAddress: 'Flat 4B, Hilltop Residency, Chengannur',
      order: {
        deliveryAddress: 'Flat 4B, Hilltop Residency, Chengannur'
      }
    };
    const sanitizedDigital = assistantController.sanitizeTaskForAssistant(digitalAssignedRaw, { isAssigned: true });
    check('T28. Non-address service (DIGITAL_ASSISTANCE) strips deliveryAddress even when assigned',
      sanitizedDigital.deliveryAddress === undefined &&
      sanitizedDigital.order?.deliveryAddress === undefined);

    // Unrelated assistant cannot view order details via getOrderById
    const resUnrelatedOrder = createMockRes();
    await orderController.getOrderById({
      params: { id: order1.id },
      user: asstUserD // unrelated assistant
    }, resUnrelatedOrder);
    check('T29. Unrelated assistant cannot access another assistant\'s order details (403 Forbidden)',
      resUnrelatedOrder.statusCode === 403);

    // -------------------------------------------------------------
    // T30: Service-Specific Workflow Language
    // -------------------------------------------------------------
    console.log('\n--- Section 9: Service-Specific Workflow & Non-Clinical Boundary ---');

    const digitalProgress = assistantController.getServiceProgressDetails('DIGITAL_ASSISTANCE', 'IN_TRANSIT', 'Max Care', 'Deepa');
    check('T30. DIGITAL_ASSISTANCE uses non-delivery workflow language ("Service In Progress")',
      digitalProgress.notifTitle.includes('Service In Progress') &&
      !digitalProgress.historyComment.toLowerCase().includes('en route') &&
      !digitalProgress.historyComment.toLowerCase().includes('transit to patient'));

    const commsProgress = assistantController.getServiceProgressDetails('PHARMACY_COMMS', 'COLLECTING', 'Max Care', 'Deepa');
    check('T31. PHARMACY_COMMS uses non-clinical assistance language ("Service Assistance Started")',
      commsProgress.notifTitle.includes('Service Assistance Started'));

    // -------------------------------------------------------------
    // T32: Notification Isolation
    // -------------------------------------------------------------
    console.log('\n--- Section 10: Notification Isolation ---');

    // Retrieve notifications for Assistant A, Patient Sunita, and Unrelated Assistant D
    const notifsAsstA = await prisma.notification.findMany({ where: { userId: asstUserA.id } });
    const notifsPatient = await prisma.notification.findMany({ where: { userId: patientUser.id } });
    const notifsUnrelated = await prisma.notification.findMany({ where: { userId: asstUserD.id } });

    check('T32. Assigned assistant receives booking and completion notifications',
      notifsAsstA.length > 0 && notifsAsstA.some(n => n.title.includes('Booking') || n.title.includes('Confirmed')));
    check('T33. Patient receives progress notifications',
      notifsPatient.length > 0);
    check('T34. Unrelated assistant receives ZERO notifications from this order',
      notifsUnrelated.length === 0);

  } catch (err) {
    console.error('Test runner exception:', err);
    fail++;
  } finally {
    console.log(`\n=================================================`);
    console.log(`Test Results: ${pass} passed, ${fail} failed out of ${pass + fail} total checks.`);
    console.log(`=================================================\n`);
    if (fail > 0) process.exit(1);
  }
}

run();
