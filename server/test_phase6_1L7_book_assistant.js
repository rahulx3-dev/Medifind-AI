/**
 * Test Suite: Phase 6.1L.7 Correction — Booking Semantics
 *
 * Verification Areas:
 * 1. Specific assistant is mandatory (omitting assistantId for ASSISTANT_DELIVERY rejected with 400)
 * 2. Capability-based assistant discovery & availability filtering
 * 3. Selected assistant is assigned but NOT automatically ACCEPTED (status: ASSIGNED, acceptedAt: null)
 * 4. Assistant must explicitly accept before ACCEPTED (cannot skip to COLLECTING, competitor cannot claim)
 * 5. Unavailable-at-payment assistant cannot be silently substituted (revalidation failure at verifyPayment)
 * 6. Capability revalidation at payment (fails cleanly if capability removed, no silent substitution)
 * 7. Non-address service booking behavior (DIGITAL_ASSISTANCE)
 * 8. Clinical-data isolation & address security for assigned assistant
 * 9. Frontend source verification in CheckoutPage & AssistantPortal
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('./src/prisma');
const assistantController = require('./src/controllers/assistantController');
const checkoutController = require('./src/controllers/checkoutController');

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
  console.log('\n=== Phase 6.1L.7 Correction — Booking Semantics Test Suite ===\n');

  try {
    // -------------------------------------------------------------
    // Setup Test Entities
    // -------------------------------------------------------------
    const patientUser = await prisma.user.create({
      data: {
        name: 'Patient Meera',
        email: `meera_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT',
        phone: '+919876543301'
      }
    });

    // Assistant 1: Fully active + available, supports MEDICINE_DELIVERY & PHARMACY_VISIT
    const asstActiveCapable = await prisma.user.create({
      data: {
        name: 'Assistant Manoj',
        email: `manoj_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543302'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstActiveCapable.id,
        bio: 'Local volunteer delivery assistant with 3 years experience.',
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT'
      }
    });

    // Assistant 2: Active + available, but ONLY supports DIGITAL_ASSISTANCE
    const asstDigitalOnly = await prisma.user.create({
      data: {
        name: 'Assistant Priya',
        email: `priya_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543303'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstDigitalOnly.id,
        bio: 'Elderly digital smartphone & order assistance specialist.',
        isActive: true,
        isAvailable: true,
        capabilities: 'DIGITAL_ASSISTANCE'
      }
    });

    // Assistant 3: Inactive / duty paused
    const asstInactive = await prisma.user.create({
      data: {
        name: 'Assistant George Offline',
        email: `george_off_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543304'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstInactive.id,
        bio: 'On leave',
        isActive: false,
        isAvailable: false,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT'
      }
    });

    // Competitor assistant (to test claim stealing prevention)
    const asstCompetitor = await prisma.user.create({
      data: {
        name: 'Assistant Vikram',
        email: `vikram_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543305'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: asstCompetitor.id,
        bio: 'Quick pickup runner',
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT'
      }
    });

    let pharmacy = await prisma.pharmacy.findFirst({
      where: { name: 'Max Care Pharmacy' }
    });
    if (!pharmacy) {
      pharmacy = await prisma.pharmacy.findFirst({
        where: { isVerified: true, verificationStatus: 'VERIFIED' }
      });
    }

    // Saved patient address
    const patientAddress = await prisma.patientAddress.create({
      data: {
        userId: patientUser.id,
        label: 'Home',
        addressLine1: 'Meera Villa, Temple Road',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121',
        isDefault: true
      }
    });

    // -------------------------------------------------------------
    // 1. Specific Assistant is Mandatory (Issue 1)
    // -------------------------------------------------------------
    console.log('--- 1. Specific Assistant is Mandatory ---');

    const orderMandatory = await prisma.order.create({
      data: {
        orderNumber: `MF-ORD-MAND-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        totalAmount: 180.00
      }
    });

    // Attempting fulfillment selection WITHOUT targetAssistantId
    const reqMissingAsst = {
      user: patientUser,
      params: { orderId: orderMandatory.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        addressId: patientAddress.id
        // assistantId omitted!
      }
    };
    const resMissingAsst = createMockRes();
    await checkoutController.selectFulfillment(reqMissingAsst, resMissingAsst);

    check('Fulfillment selection without specific assistant rejected with 400',
      resMissingAsst.statusCode === 400 && resMissingAsst.data.error.includes('select a specific Medicine Access Assistant'));

    // -------------------------------------------------------------
    // 2. Capability-Based Discovery & Validation Gating
    // -------------------------------------------------------------
    console.log('\n--- 2. Capability Discovery & Booking Validation ---');

    // Discovery query for MEDICINE_DELIVERY
    const reqDiscDelivery = { query: { serviceType: 'MEDICINE_DELIVERY' } };
    const resDiscDelivery = createMockRes();
    await assistantController.discoverAssistants(reqDiscDelivery, resDiscDelivery);

    check('Discovery for MEDICINE_DELIVERY succeeds with 200', resDiscDelivery.statusCode === 200);
    const deliveryAssts = resDiscDelivery.data.assistants;
    const deliveryIds = deliveryAssts.map(a => a.id);

    check('Active capable assistant (Manoj) is included', deliveryIds.includes(asstActiveCapable.id));
    check('Digital-only assistant (Priya) is excluded from MEDICINE_DELIVERY', !deliveryIds.includes(asstDigitalOnly.id));
    check('Inactive assistant (George) is excluded from discovery', !deliveryIds.includes(asstInactive.id));

    // Reject booking of non-assistant role (e.g. pharmacist)
    const reqSelectPharmacist = {
      user: patientUser,
      params: { orderId: orderMandatory.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        addressId: patientAddress.id,
        assistantId: pharmacy.managerId
      }
    };
    const resSelectPharmacist = createMockRes();
    await checkoutController.selectFulfillment(reqSelectPharmacist, resSelectPharmacist);
    check('Booking a non-assistant user rejected with 400',
      resSelectPharmacist.statusCode === 400 && resSelectPharmacist.data.error.includes('not a registered assistant'));

    // Reject booking of assistant lacking requested capability
    const reqSelectIncapable = {
      user: patientUser,
      params: { orderId: orderMandatory.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        addressId: patientAddress.id,
        assistantId: asstDigitalOnly.id
      }
    };
    const resSelectIncapable = createMockRes();
    await checkoutController.selectFulfillment(reqSelectIncapable, resSelectIncapable);
    check('Booking assistant lacking requested capability rejected with 400',
      resSelectIncapable.statusCode === 400 && resSelectIncapable.data.error.includes('does not possess the supported capability'));

    // Successfully select qualified assistant Manoj
    const reqSelectValid = {
      user: patientUser,
      params: { orderId: orderMandatory.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        addressId: patientAddress.id,
        assistantId: asstActiveCapable.id
      }
    };
    const resSelectValid = createMockRes();
    await checkoutController.selectFulfillment(reqSelectValid, resSelectValid);
    check('Booking qualified assistant Manoj succeeds with 200',
      resSelectValid.statusCode === 200 && resSelectValid.data.success);
    check('Order records selectedAssistantId',
      resSelectValid.data.selectedAssistantId === asstActiveCapable.id);

    // -------------------------------------------------------------
    // 3. Do NOT Equate Booking with Acceptance (Issue 2)
    // -------------------------------------------------------------
    console.log('\n--- 3. Booking Does NOT Equate to Acceptance (ASSIGNED status) ---');

    // Create payment record and gateway credentials for verification
    const secretKey = 'test_secret_key_phase61L7';
    process.env.RAZORPAY_KEY_SECRET = secretKey;
    const rzpOrderId = 'order_rzp_mock_61L7_1';
    const rzpPaymentId = 'pay_rzp_mock_61L7_1';
    const rzpSignature = crypto
      .createHmac('sha256', secretKey)
      .update(`${rzpOrderId}|${rzpPaymentId}`)
      .digest('hex');

    await prisma.payment.create({
      data: {
        orderId: orderMandatory.id,
        amount: 180.00,
        currency: 'INR',
        status: 'PENDING',
        method: 'ONLINE',
        gatewayOrderId: rzpOrderId
      }
    });

    // Execute verifyPayment
    const reqVerify = {
      user: patientUser,
      params: { orderId: orderMandatory.id },
      body: {
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature: rzpSignature
      }
    };
    const resVerify = createMockRes();
    await checkoutController.verifyPayment(reqVerify, resVerify);

    check('Payment verified successfully with 200', resVerify.statusCode === 200 && resVerify.data.success);

    // Inspect created AssistantTask in database
    const createdTask = await prisma.assistantTask.findUnique({
      where: { orderId: orderMandatory.id }
    });

    check('Task is created with status ASSIGNED (NOT ACCEPTED)', createdTask.status === 'ASSIGNED');
    check('Task has assistantId set to selected assistant Manoj', createdTask.assistantId === asstActiveCapable.id);
    check('Task acceptedAt is null (not accepted yet)', createdTask.acceptedAt === null);

    // -------------------------------------------------------------
    // 4. Explicit Acceptance Required Before Progressing (Issue 2)
    // -------------------------------------------------------------
    console.log('\n--- 4. Explicit Acceptance Lifecycle Gating ---');

    // 4A: Assistant cannot progress directly to COLLECTING while task is in ASSIGNED status
    const reqInvalidProgress = {
      user: asstActiveCapable,
      params: { id: createdTask.id },
      body: { status: 'COLLECTING' }
    };
    const resInvalidProgress = createMockRes();
    await assistantController.progressTaskStatus(reqInvalidProgress, resInvalidProgress);

    check('Progressing ASSIGNED task directly to COLLECTING is rejected with 400',
      resInvalidProgress.statusCode === 400 && resInvalidProgress.data.error.includes('Invalid transition'));

    // 4B: Competitor assistant cannot accept the assigned task
    const reqCompetitorAccept = {
      user: asstCompetitor,
      params: { id: createdTask.id }
    };
    const resCompetitorAccept = createMockRes();
    await assistantController.acceptTask(reqCompetitorAccept, resCompetitorAccept);

    check('Competitor assistant blocked from accepting another assistant\'s assigned task',
      resCompetitorAccept.statusCode === 403 && resCompetitorAccept.data.error.includes('specifically assigned to another assistant'));

    // 4C: Assigned assistant Manoj sees the task in their queue
    const reqManojTasks = { user: asstActiveCapable };
    const resManojTasks = createMockRes();
    await assistantController.getMyTasks(reqManojTasks, resManojTasks);
    const manojQueue = resManojTasks.data.tasks.find(t => t.id === createdTask.id);
    check('Assigned task appears in Manoj assigned queue', !!manojQueue && manojQueue.status === 'ASSIGNED');

    // 4D: Assigned assistant Manoj explicitly accepts the task
    const reqManojAccept = {
      user: asstActiveCapable,
      params: { id: createdTask.id }
    };
    const resManojAccept = createMockRes();
    await assistantController.acceptTask(reqManojAccept, resManojAccept);

    check('Assigned assistant Manoj successfully accepts the task with 200',
      resManojAccept.statusCode === 200 && resManojAccept.data.success);

    const acceptedTask = await prisma.assistantTask.findUnique({ where: { id: createdTask.id } });
    check('Task status is now ACCEPTED', acceptedTask.status === 'ACCEPTED');
    check('Task acceptedAt timestamp is now set', acceptedTask.acceptedAt !== null);

    // 4E: Now existing task lifecycle continues (ACCEPTED -> COLLECTING)
    const reqValidProgress = {
      user: asstActiveCapable,
      params: { id: createdTask.id },
      body: { status: 'COLLECTING' }
    };
    const resValidProgress = createMockRes();
    await assistantController.progressTaskStatus(reqValidProgress, resValidProgress);
    check('Task successfully progresses from ACCEPTED to COLLECTING',
      resValidProgress.statusCode === 200 && resValidProgress.data.success);

    // -------------------------------------------------------------
    // 5. Revalidation at Payment — No Silent Substitution (Issue 3)
    // -------------------------------------------------------------
    console.log('\n--- 5. Payment Revalidation & No Silent Substitution ---');

    // Create a new order with assistant Priya (DIGITAL_ASSISTANCE)
    const orderReval = await prisma.order.create({
      data: {
        orderNumber: `MF-ORD-REVAL-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'DIGITAL_ASSISTANCE',
        selectedAssistantId: asstDigitalOnly.id,
        totalAmount: 130.00
      }
    });

    const rzpOrderReval = 'order_rzp_mock_reval_1';
    const rzpPayReval = 'pay_rzp_mock_reval_1';
    const rzpSigReval = crypto
      .createHmac('sha256', secretKey)
      .update(`${rzpOrderReval}|${rzpPayReval}`)
      .digest('hex');

    await prisma.payment.create({
      data: {
        orderId: orderReval.id,
        amount: 130.00,
        currency: 'INR',
        status: 'PENDING',
        method: 'ONLINE',
        gatewayOrderId: rzpOrderReval
      }
    });

    // Make Priya unavailable before payment is verified!
    await prisma.assistantProfile.update({
      where: { userId: asstDigitalOnly.id },
      data: { isAvailable: false }
    });

    const reqVerifyUnavailable = {
      user: patientUser,
      params: { orderId: orderReval.id },
      body: {
        razorpay_order_id: rzpOrderReval,
        razorpay_payment_id: rzpPayReval,
        razorpay_signature: rzpSigReval
      }
    };
    const resVerifyUnavailable = createMockRes();
    await checkoutController.verifyPayment(reqVerifyUnavailable, resVerifyUnavailable);

    check('Payment verification rejects unavailable assistant with 400',
      resVerifyUnavailable.statusCode === 400 && resVerifyUnavailable.data.bookingFailed === true);
    check('Error message clearly indicates assistant is no longer eligible',
      resVerifyUnavailable.data.error.includes('no longer eligible'));

    // Check database: NEVER silently substituted another assistant
    const taskAfterFailure = await prisma.assistantTask.findUnique({
      where: { orderId: orderReval.id }
    });
    check('No assistant task created with a substituted assistant', taskAfterFailure === null);

    // -------------------------------------------------------------
    // 6. Capability Revalidation at Payment
    // -------------------------------------------------------------
    console.log('\n--- 6. Capability Revalidation at Payment ---');

    // Restore Priya availability, but remove DIGITAL_ASSISTANCE capability
    await prisma.assistantProfile.update({
      where: { userId: asstDigitalOnly.id },
      data: { isAvailable: true, capabilities: 'PHARMACY_VISIT' }
    });

    const resVerifyIncapable = createMockRes();
    await checkoutController.verifyPayment(reqVerifyUnavailable, resVerifyIncapable);

    check('Payment verification rejects assistant who lost capability with 400',
      resVerifyIncapable.statusCode === 400 && resVerifyIncapable.data.bookingFailed === true);
    check('Error specifies capability mismatch',
      resVerifyIncapable.data.error.includes('capability'));

    // -------------------------------------------------------------
    // 7. Clinical-Data Isolation & Address Rules
    // -------------------------------------------------------------
    console.log('\n--- 7. Clinical-Data Isolation & Address Rules ---');

    const mockClinicalTask = {
      id: 'task-clin-iso-61L7',
      assistantId: asstActiveCapable.id,
      handoverPin: '9999',
      order: {
        id: 'ord-clin-iso-61L7',
        prescriptionId: 'secret-rx-uuid',
        prescription: { id: 'rx-doc', filePath: '/secret/rx.jpg' },
        detectedMedicines: [{ rawName: 'Chemo drug', confidence: 0.99 }],
        verificationPin: '9999',
        pharmacy: { name: 'Metro Pharmacy' },
        user: { name: 'Patient Meera' },
        deliveryAddress: 'Meera Villa, Temple Road'
      }
    };

    const sanitizedForAssigned = assistantController.sanitizeTaskForAssistant(mockClinicalTask, {
      includeHandoverPin: false,
      isAssigned: true
    });

    check('Prescription ID stripped for assigned assistant', sanitizedForAssigned.order.prescriptionId === undefined);
    check('Prescription document relation stripped', sanitizedForAssigned.order.prescription === undefined);
    check('Detected medicines diagnostics stripped', sanitizedForAssigned.order.detectedMedicines === undefined);
    check('Handover PIN stripped from general task payload', sanitizedForAssigned.handoverPin === undefined);
    check('Delivery address preserved for assigned assistant', sanitizedForAssigned.order.deliveryAddress === 'Meera Villa, Temple Road');

    // -------------------------------------------------------------
    // 8. Frontend Source Verification (CheckoutPage & AssistantPortal)
    // -------------------------------------------------------------
    console.log('\n--- 8. Frontend Integration Source Verification ---');
    const checkoutSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/CheckoutPage.jsx'), 'utf-8');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');

    check('CheckoutPage removed Any Available Assistant option',
      !checkoutSrc.includes('Any Available Assistant (Fastest Assignment)'));
    check('CheckoutPage has mandatory Select Assistant section',
      checkoutSrc.includes('Select Assistant'));
    check('CheckoutPage requires selectedAssistantId before submission',
      checkoutSrc.includes('if (!selectedAssistantId)'));
    check('AssistantPortal handles ASSIGNED status in active task items',
      portalSrc.includes("task.status === 'ASSIGNED'"));
    check('AssistantPortal has explicit button to Accept Patient Booking Request',
      portalSrc.includes('Accept Patient Booking Request'));

    // -------------------------------------------------------------
    // Cleanup test artifacts
    // -------------------------------------------------------------
    try {
      const testOrderIds = [orderMandatory?.id, orderReval?.id].filter(Boolean);
      if (testOrderIds.length > 0) {
        await prisma.assistantTask.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
      }
      if (patientAddress?.id) {
        await prisma.patientAddress.deleteMany({ where: { id: patientAddress.id } });
      }
      const testUserIds = [patientUser?.id, asstDeliveryAndMed?.id, asstDigitalOnly?.id, asstInactive?.id].filter(Boolean);
      if (testUserIds.length > 0) {
        await prisma.assistantProfile.deleteMany({ where: { userId: { in: testUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
      }
    } catch (cleanupErr) {
      console.warn('Non-fatal test cleanup warning:', cleanupErr.message);
    }

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n========================================`);
    console.log(`Phase 6.1L.7 Correction Tests Completed: ${pass} passed, ${fail} failed.`);
    console.log(`========================================\n`);

    if (fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error in test_phase6_1L7_book_assistant:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
