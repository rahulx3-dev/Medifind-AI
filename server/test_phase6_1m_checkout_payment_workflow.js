/**
 * MediFind AI — Test Phase 6.1M
 * Checkout, Fulfillment, Payment, and Ready-For-Pickup Prerequisite Workflow
 *
 * Verifies all 10 mandatory edge cases:
 * TEST 1: Pharmacy confirms -> patient does not enter checkout -> pharmacist tries READY_FOR_PICKUP -> FAIL (400)
 * TEST 2: Pharmacy confirms -> Counter Pickup -> no payment method -> pharmacist tries READY_FOR_PICKUP -> FAIL (400)
 * TEST 3: Pharmacy confirms -> Counter Pickup -> Pay at Counter -> pharmacist marks READY_FOR_PICKUP -> SUCCESS (200)
 * TEST 4: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay cancelled (PENDING) -> READY_FOR_PICKUP FAILS (400)
 * TEST 5: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay payment fails (FAILED) -> READY_FOR_PICKUP FAILS (400)
 * TEST 6: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay succeeds (PAID) -> READY_FOR_PICKUP SUCCEEDS (200)
 * TEST 7: Pharmacy confirms -> Medicine Access Assistant -> Pay at Counter -> validation passes -> proceed in assistant lifecycle
 * TEST 8: Direct API call to READY_FOR_PICKUP without payment-method selection -> REJECTED (400)
 * TEST 9: Attempt to spoof frontend state / payment completion -> REJECTED (400)
 * TEST 10: Pay at Counter must never create a Razorpay payment record claiming money was paid online -> PASS
 */

const crypto = require('crypto');
const prisma = require('./src/prisma');
const BASE_URL = 'http://localhost:5000/api';

async function run() {
  console.log('\n🔒 ====================================================================');
  console.log('🔒  MEDIFIND AI — TEST PHASE 6.1M: CHECKOUT / PAYMENT / READY-FOR-PICKUP');
  console.log('🔒 ====================================================================\n');

  const results = [];
  function record(num, title, passed, details) {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ num, title, status, details: details || '' });
    console.log((passed ? '✅' : '❌') + ` TEST ${String(num).padStart(2, '0')}: ${title} -> ${status}`);
    if (details) console.log('   └─ ' + details);
  }

  const cleanupOrderIds = [];

  const login = async (email, password) => {
    const r = await fetch(BASE_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: password || 'password123' })
    });
    const d = await r.json();
    return d.token;
  };

  try {
    const patientToken = await login('patient@medifind.com');
    const pharmacistToken = await login('pharmacist1@medifind.com');
    const assistantToken = await login('assistant@medifind.com');
    const adminToken = await login('admin@medifind.com');

    // Retrieve test pharmacy and medicine
    const pharmsRes = await fetch(BASE_URL + '/pharmacies', { headers: { Authorization: `Bearer ${patientToken}` } });
    const pharmsData = await pharmsRes.json();
    const testPharmacy = pharmsData.pharmacies?.find(p => p.verificationStatus === 'TEST' && p.name.includes('Chengannur')) || pharmsData.pharmacies?.[0];

    const medsRes = await fetch(BASE_URL + '/medicines/search', { headers: { Authorization: `Bearer ${patientToken}` } });
    const medsData = await medsRes.json();
    const testMedicine = medsData.medicines?.[0];

    // Assistant user for assistant test
    const asstUser = await prisma.user.findFirst({ where: { email: 'assistant@medifind.com' } });
    if (asstUser) {
      await prisma.assistantProfile.upsert({
        where: { userId: asstUser.id },
        create: { userId: asstUser.id, isActive: true, isAvailable: true, capabilities: 'MEDICINE_DELIVERY,MEDICINE_COLLECTION' },
        update: { isActive: true, isAvailable: true, capabilities: 'MEDICINE_DELIVERY,MEDICINE_COLLECTION' }
      });
    }

    // Helper: Create an order and have pharmacist confirm it
    async function createAndConfirmOrder() {
      const createRes = await fetch(BASE_URL + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({
          pharmacyId: testPharmacy.id,
          items: [{ medicineId: testMedicine.id, quantity: 1 }]
        })
      });
      const createData = await createRes.json();
      const orderId = createData.order?.id;
      if (orderId) cleanupOrderIds.push(orderId);

      const confirmRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      const confirmData = await confirmRes.json();
      return { orderId, order: confirmData.order };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Pharmacy confirms -> patient does not enter checkout -> pharmacist tries READY_FOR_PICKUP
    // EXPECTED: FAIL (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = readyRes.status === 400 && readyData.success === false && readyData.error.includes('Checkout and payment method selection are required');
      record(1, 'Pharmacy confirms -> no checkout -> READY_FOR_PICKUP rejected (400)', passed, `Status: ${readyRes.status}, Error: ${readyData.error}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Pharmacy confirms -> patient selects Counter Pickup -> patient has NOT selected payment method -> pharmacist tries READY_FOR_PICKUP
    // EXPECTED: FAIL (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      // Patient selects Counter Pickup
      const fulRes = await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });
      const fulData = await fulRes.json();

      // Pharmacist tries READY_FOR_PICKUP before payment method is selected
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = fulData.success && readyRes.status === 400 && readyData.success === false && readyData.error.includes('Checkout and payment method selection are required');
      record(2, 'Counter Pickup selected without payment method -> READY_FOR_PICKUP rejected (400)', passed, `Status: ${readyRes.status}, Error: ${readyData.error}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Pharmacy confirms -> Counter Pickup -> Pay at Counter -> pharmacist marks READY_FOR_PICKUP
    // EXPECTED: SUCCESS (200)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      // 1. Select fulfillment: PICKUP
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      // 2. Select payment: COUNTER
      const payRes = await fetch(`${BASE_URL}/checkout/${orderId}/select-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ paymentMethod: 'COUNTER' })
      });
      const payData = await payRes.json();

      // 3. Verify payment in DB is COUNTER and PENDING
      const dbPay = await prisma.payment.findUnique({ where: { orderId } });
      const payOk = dbPay && dbPay.method === 'COUNTER' && dbPay.status === 'PENDING' && dbPay.paidAt === null;

      // 4. Pharmacist marks READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = payRes.status === 200 && payOk && readyRes.status === 200 && readyData.order?.status === 'READY_FOR_PICKUP';
      record(3, 'Counter Pickup + Pay at Counter -> READY_FOR_PICKUP succeeds (200)', passed, `PayMethod: ${dbPay?.method}, OrderStatus: ${readyData.order?.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay cancelled (payment stays PENDING)
    // EXPECTED: READY_FOR_PICKUP MUST FAIL (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      // Patient initiates online payment (creates Razorpay order)
      const payCreateRes = await fetch(`${BASE_URL}/checkout/${orderId}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` }
      });
      const payCreateData = await payCreateRes.json();

      // User cancels Razorpay modal (no verify-payment called)
      // Pharmacist tries READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = payCreateData.success && readyRes.status === 400 && readyData.success === false;
      record(4, 'Online payment initiated but cancelled (unverified) -> READY_FOR_PICKUP rejected (400)', passed, `Status: ${readyRes.status}, Error: ${readyData.error}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay payment fails (FAILED)
    // EXPECTED: READY_FOR_PICKUP MUST FAIL (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      const payCreateRes = await fetch(`${BASE_URL}/checkout/${orderId}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` }
      });
      const payCreateData = await payCreateRes.json();
      const gatewayOrderId = payCreateData.payment?.gatewayOrderId;

      // Simulate payment failure by sending invalid signature to verify-payment
      const verifyRes = await fetch(`${BASE_URL}/checkout/${orderId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({
          razorpay_order_id: gatewayOrderId,
          razorpay_payment_id: 'pay_failed_test_123',
          razorpay_signature: 'invalid_forged_signature_0000'
        })
      });
      const verifyData = await verifyRes.json();

      // Check payment status is FAILED
      const dbPay = await prisma.payment.findUnique({ where: { orderId } });
      const isFailed = dbPay && dbPay.status === 'FAILED';

      // Pharmacist tries READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = verifyRes.status === 400 && isFailed && readyRes.status === 400 && readyData.success === false;
      record(5, 'Online payment failed -> READY_FOR_PICKUP rejected (400)', passed, `PayStatus: ${dbPay?.status}, ReadyStatus: ${readyRes.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Pharmacy confirms -> Counter Pickup -> Pay Online -> Razorpay succeeds & verified -> READY_FOR_PICKUP SUCCEEDS (200)
    // EXPECTED: SUCCESS (200)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      const payCreateRes = await fetch(`${BASE_URL}/checkout/${orderId}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` }
      });
      const payCreateData = await payCreateRes.json();
      const gatewayOrderId = payCreateData.payment?.gatewayOrderId;

      // Compute authentic HMAC-SHA256 signature using test secret
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const testPaymentId = `pay_test_${Date.now()}`;
      const validSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${gatewayOrderId}|${testPaymentId}`)
        .digest('hex');

      const verifyRes = await fetch(`${BASE_URL}/checkout/${orderId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({
          razorpay_order_id: gatewayOrderId,
          razorpay_payment_id: testPaymentId,
          razorpay_signature: validSignature
        })
      });
      const verifyData = await verifyRes.json();

      // Check payment status is PAID
      const dbPay = await prisma.payment.findUnique({ where: { orderId } });
      const isPaid = dbPay && dbPay.status === 'PAID';

      // Pharmacist marks READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = verifyRes.status === 200 && isPaid && readyRes.status === 200 && readyData.order?.status === 'READY_FOR_PICKUP';
      record(6, 'Online payment verified PAID -> READY_FOR_PICKUP succeeds (200)', passed, `PayStatus: ${dbPay?.status}, ReadyStatus: ${readyData.order?.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Pharmacy confirms -> Medicine Access Assistant -> Pay at Counter -> required validation passes -> proceed
    // EXPECTED: SUCCESS (200)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      // Patient selects Assistant fulfillment with valid assistant
      const fulRes = await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({
          fulfillmentType: 'ASSISTANT_DELIVERY',
          assistantServiceType: 'MEDICINE_DELIVERY',
          selectedAssistantId: asstUser.id,
          deliveryAddress: 'House 4B, Near KSRTC Stand, Chengannur, Kerala - 689121'
        })
      });
      const fulData = await fulRes.json();

      // Patient selects Pay at Counter
      const payRes = await fetch(`${BASE_URL}/checkout/${orderId}/select-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ paymentMethod: 'COUNTER' })
      });
      const payData = await payRes.json();

      // Pharmacist marks READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();

      // Check AssistantTask was created in ASSIGNED status
      const asstTask = await prisma.assistantTask.findUnique({ where: { orderId } });
      const taskOk = asstTask && asstTask.status === 'ASSIGNED' && asstTask.assistantId === asstUser.id;

      const passed = fulRes.status === 200 && payRes.status === 200 && readyRes.status === 200 && readyData.order?.status === 'READY_FOR_PICKUP' && taskOk;
      record(7, 'Medicine Access Assistant + Pay at Counter -> AssistantTask ASSIGNED & READY_FOR_PICKUP (200)', passed, `TaskStatus: ${asstTask?.status}, OrderStatus: ${readyData.order?.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Attempt direct API call to READY_FOR_PICKUP without payment-method selection
    // EXPECTED: SERVER REJECTS IT (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      // Direct call by admin attempting bypass without checkout
      const adminBypassRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const adminBypassData = await adminBypassRes.json();
      const passed = adminBypassRes.status === 400 && adminBypassData.success === false && adminBypassData.error.includes('Checkout and payment method selection are required');
      record(8, 'Direct API bypass attempt to READY_FOR_PICKUP -> Server strictly rejects with 400', passed, `Status: ${adminBypassRes.status}, Error: ${adminBypassData.error}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Attempt to spoof frontend state / payment completion
    // EXPECTED: SERVER REJECTS IT (400)
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      // Client selects fulfillment
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      // Attacker attempts to spoof verification with fake payment IDs
      const spoofVerifyRes = await fetch(`${BASE_URL}/checkout/${orderId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({
          razorpay_order_id: 'order_fake_spoof_999',
          razorpay_payment_id: 'pay_fake_spoof_999',
          razorpay_signature: 'fake_signature_abc'
        })
      });
      const spoofVerifyData = await spoofVerifyRes.json();

      // Pharmacist tries READY_FOR_PICKUP
      const readyRes = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
      });
      const readyData = await readyRes.json();
      const passed = spoofVerifyRes.status === 400 && readyRes.status === 400;
      record(9, 'Spoofed payment verification -> Rejected and order cannot become READY_FOR_PICKUP', passed, `SpoofVerify: ${spoofVerifyRes.status}, ReadyStatus: ${readyRes.status}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Pay at Counter must never create a Razorpay payment record claiming money was paid online
    // EXPECTED: No fake online payment
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { orderId } = await createAndConfirmOrder();
      await fetch(`${BASE_URL}/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ fulfillmentType: 'PICKUP' })
      });

      await fetch(`${BASE_URL}/checkout/${orderId}/select-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
        body: JSON.stringify({ paymentMethod: 'COUNTER' })
      });

      const payment = await prisma.payment.findUnique({ where: { orderId } });
      const noFakeOnline = payment &&
        payment.method === 'COUNTER' &&
        payment.status === 'PENDING' &&
        payment.gateway === 'COUNTER' &&
        payment.gatewayOrderId === null &&
        payment.gatewayPaymentId === null &&
        payment.gatewaySignature === null &&
        payment.paidAt === null;

      record(10, 'Pay at Counter has method=COUNTER, status=PENDING, paidAt=null, no fake Razorpay data', Boolean(noFakeOnline), `Method: ${payment?.method}, Status: ${payment?.status}, Gateway: ${payment?.gateway}, PaidAt: ${payment?.paidAt}`);
    }

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // Cleanup created test orders
    if (cleanupOrderIds.length > 0) {
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
      await prisma.assistantTask.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
    }
  }

  console.log('\n📊 ====================================================================');
  console.log('📊  TEST SUMMARY');
  console.log('📊 ====================================================================');
  const allPassed = results.length === 10 && results.every(r => r.status === 'PASS');
  console.log(`Total tests: ${results.length} | Passed: ${results.filter(r => r.status === 'PASS').length} | Failed: ${results.filter(r => r.status === 'FAIL').length}`);
  console.log(`Final Result: ${allPassed ? 'ALL 10 MANDATORY TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}\n`);
}

run();
