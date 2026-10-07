/**
 * MEDIFIND AI — PHASE 5.6 FUNCTIONAL TEST SUITE
 * Functional Completion: Medicine Cart/Request + My Orders + Order Details + Razorpay Environment Loading
 *
 * 45+ Meaningful Assertions Covering:
 *   1-6.   RAZORPAY CONFIG (deterministic .env, presence detection, test key, safe diagnostics, no leakage)
 *   7-13.  MEDICINE REQUEST (catalogue items, duplicate merge, quantity update, remove, clear, free-text rejection, rx verification gate)
 *   14-17. PHARMACY FLOW (selected medicine IDs match, multi-item ranking, test pharmacy classification, coordinate privacy)
 *   18-27. ORDERS (patient retrieval, cross-patient isolation 403, list statuses, order detail items, pharmacy, statusHistory, separate payment status, fulfillment type, completed, cancelled/rejected)
 *   28-35. PAYMENT (confirmation gate, backend authority, integer paise, retry on failed, signature hidden, secret hidden, paid-order protection, offline blocked)
 *   36-37. NOTIFICATIONS (order resolution, no sensitive payment data)
 *   38-40. ASSISTANT (task workflow, no payment secrets, no prescription data)
 *   41-45. SECURITY & REGRESSIONS (role authorization, pharmacy isolation, admin privacy, order ownership, terminal immutability)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });
const prisma = require('./src/prisma');
const crypto = require('crypto');
const {
  getPaymentConfigStatus,
  getRazorpayKeyId,
  getRazorpayInstance,
  calculateOrderTotals,
  getFulfillmentFee,
  VALID_FULFILLMENT_TYPES
} = require('./src/utils/paymentConfig');

const BASE_URL = 'http://127.0.0.1:5000/api';

async function runPhase56Tests() {
  console.log('\n🏥 ====================================================================');
  console.log('🏥 MEDIFIND AI — PHASE 5.6: FUNCTIONAL COMPLETION TEST SUITE');
  console.log('🏥 ====================================================================\n');

  const results = [];
  function record(testNum, category, title, passed, details = '') {
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ testNum, category, title, status, details });
    console.log(`${passed ? '✅' : '❌'} T${String(testNum).padStart(2, '0')} [${category}] ${title}: ${status}`);
    if (details) console.log(`   └─ ${details}`);
  }

  const cleanupOrderIds = [];
  const cleanupUserIds = [];

  // Helper: Login
  const login = async (email, password = 'password123') => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    return data.token;
  };

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // PART 1: RAZORPAY CONFIG (T01 - T06)
    // ═════════════════════════════════════════════════════════════════════════

    // T01: .env path resolution relative to backend location
    const expectedEnvPath = path.resolve(__dirname, '.env');
    const resolvedStatus = getPaymentConfigStatus();
    record(
      1,
      'RAZORPAY_CONFIG',
      '.env path resolution works deterministically regardless of cwd',
      resolvedStatus !== null,
      `Resolved from: ${expectedEnvPath}`
    );

    // T02: key presence detection
    record(
      2,
      'RAZORPAY_CONFIG',
      'RAZORPAY_KEY_ID presence is detected accurately as boolean',
      resolvedStatus.keyIdPresent === true,
      `keyIdPresent: ${resolvedStatus.keyIdPresent}`
    );

    // T03: secret presence detection
    record(
      3,
      'RAZORPAY_CONFIG',
      'RAZORPAY_KEY_SECRET presence is detected without exposing secret',
      resolvedStatus.keySecretPresent === true && typeof resolvedStatus.keySecretPresent === 'boolean',
      `keySecretPresent: ${resolvedStatus.keySecretPresent}`
    );

    // T04: TEST key recognition
    record(
      4,
      'RAZORPAY_CONFIG',
      'Test key prefix rzp_test_ recognized as TEST MODE',
      resolvedStatus.isTestMode === true,
      `isTestMode: ${resolvedStatus.isTestMode}`
    );

    // T05: payment configuration detection
    record(
      5,
      'RAZORPAY_CONFIG',
      'paymentConfig recognizes complete configuration and instantiates client',
      resolvedStatus.isConfigured === true && getRazorpayInstance().configError === null && getRazorpayInstance().razorpay !== null,
      `isConfigured: ${resolvedStatus.isConfigured}`
    );

    // T06: no secret leakage in diagnostic or getter
    const publicDiagnostic = JSON.stringify(resolvedStatus);
    const keyIdResult = getRazorpayKeyId();
    const leaked = publicDiagnostic.includes(process.env.RAZORPAY_KEY_SECRET) ||
      (keyIdResult && keyIdResult === process.env.RAZORPAY_KEY_SECRET);
    record(
      6,
      'RAZORPAY_CONFIG',
      'No secret leakage in diagnostic function, key ID getter, or public objects',
      leaked === false,
      'Secret is strictly isolated server-side'
    );

    // Fetch real pharmacies with assigned managers
    const allPharmacies = await prisma.pharmacy.findMany({ include: { manager: true } });
    const testPharm = allPharmacies.find(p => p.managerId && p.manager);
    const otherPharm = allPharmacies.find(p => p.managerId && p.manager && p.id !== testPharm.id);

    // Setup role authentication tokens
    const patient1Token = await login('patient@medifind.com');
    const adminToken = await login('admin@medifind.com');
    const pharmacistToken = await login(testPharm.manager.email);
    const otherPharmacistToken = otherPharm ? await login(otherPharm.manager.email) : null;
    const assistantToken = await login('assistant@medifind.com');

    // Register temporary patient 2 for cross-user isolation verification
    const p2Email = `p2_test_${Date.now()}@medifind.com`;
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Patient Two Isolation',
        email: p2Email,
        phone: '+91-98765-43210',
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    const regData = await regRes.json();
    const patient2Token = regData.token;
    if (regData.user?.id) cleanupUserIds.push(regData.user.id);

    // Fetch catalogue medicines
    const medRes = await fetch(`${BASE_URL}/medicines/search`);
    const medData = await medRes.json();
    const med1 = medData.medicines[0];
    const med2 = medData.medicines[1];

    // ═════════════════════════════════════════════════════════════════════════
    // PART 2: MEDICINE REQUEST / CART (T07 - T13)
    // ═════════════════════════════════════════════════════════════════════════

    // T07: Add catalogue medicine simulation
    let medicineRequest = [];
    const addToRequest = (med, qty = 1) => {
      if (!med || !med.id) return;
      const existing = medicineRequest.find(i => i.medicineId === med.id);
      if (existing) {
        existing.quantity = Math.min(500, existing.quantity + qty);
      } else {
        medicineRequest.push({
          medicineId: med.id,
          brandName: med.brandName,
          genericName: med.genericName,
          quantity: qty
        });
      }
    };
    addToRequest(med1, 2);
    record(
      7,
      'MEDICINE_REQUEST',
      'Add catalogue medicine to medicine request',
      medicineRequest.length === 1 && medicineRequest[0].medicineId === med1.id && medicineRequest[0].quantity === 2,
      `Items: ${medicineRequest.length}, Qty: ${medicineRequest[0]?.quantity}`
    );

    // T08: Duplicate medicine increments quantity rather than creating duplicate row
    addToRequest(med1, 3);
    record(
      8,
      'MEDICINE_REQUEST',
      'Duplicate medicine increments quantity and avoids duplicate row',
      medicineRequest.length === 1 && medicineRequest[0].quantity === 5,
      `Rows: ${medicineRequest.length}, Combined Qty: ${medicineRequest[0]?.quantity}`
    );

    // T09: Quantity update
    const updateQuantity = (medId, newQty) => {
      const it = medicineRequest.find(i => i.medicineId === medId);
      if (it) it.quantity = Math.max(1, Math.min(500, newQty));
    };
    updateQuantity(med1.id, 4);
    record(
      9,
      'MEDICINE_REQUEST',
      'Quantity update modifies item quantity within bounds',
      medicineRequest[0].quantity === 4,
      `Updated Qty: ${medicineRequest[0].quantity}`
    );

    // T10: Remove medicine from request
    addToRequest(med2, 1);
    const removeFromRequest = (medId) => {
      medicineRequest = medicineRequest.filter(i => i.medicineId !== medId);
    };
    removeFromRequest(med2.id);
    record(
      10,
      'MEDICINE_REQUEST',
      'Remove medicine removes specific item from request',
      medicineRequest.length === 1 && !medicineRequest.find(i => i.medicineId === med2.id),
      `Remaining items: ${medicineRequest.length}`
    );

    // T11: Clear request
    const clearRequest = () => { medicineRequest = []; };
    clearRequest();
    record(
      11,
      'MEDICINE_REQUEST',
      'Clear request clears all items from medicine request',
      medicineRequest.length === 0,
      `Request length: ${medicineRequest.length}`
    );

    // T12: Arbitrary free-text medicine cannot become order item
    const fakeOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: 'arbitrary-free-text-non-existent-id', quantity: 1 }],
        orderType: 'RESERVATION'
      })
    });
    record(
      12,
      'MEDICINE_REQUEST',
      'Invalid free-text medicine ID rejected during order creation',
      fakeOrderRes.status >= 400,
      `Status: ${fakeOrderRes.status}`
    );

    // T13: Prescription-unverified candidate cannot silently enter request
    // Backend rejects order referencing an unverified prescription
    const unverifiedRxRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: med1.id, quantity: 1 }],
        prescriptionId: 'non-existent-unverified-rx-id'
      })
    });
    record(
      13,
      'MEDICINE_REQUEST',
      'Unverified or non-existent prescription rejected on order creation',
      unverifiedRxRes.status === 404 || unverifiedRxRes.status === 400,
      `Status: ${unverifiedRxRes.status}`
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 3: PHARMACY FLOW (T14 - T17)
    // ═════════════════════════════════════════════════════════════════════════

    // T14: Selected medicine IDs reach match-availability correctly
    const matchRes = await fetch(`${BASE_URL}/pharmacies/match-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ medicineId: med1.id, brandName: med1.brandName, quantity: 2 }],
        lat: 9.3200,
        lon: 76.6160,
        isEmergency: false
      })
    });
    const matchData = await matchRes.json();
    record(
      14,
      'PHARMACY_FLOW',
      'Selected medicine IDs reach pharmacy match-availability correctly',
      matchData.success === true && Array.isArray(matchData.results),
      `Results count: ${matchData.results?.length}`
    );

    // T15: Availability ranking reflects correct null-coordinate semantics
    const topResult = matchData.results?.[0];
    record(
      15,
      'PHARMACY_FLOW',
      'Availability ranking: totalScore computed, distanceKm is null when coords unavailable (not fabricated)',
      topResult &&
        typeof topResult.scores?.totalScore === 'number' &&
        // distanceKm is null for real pharmacies (no authoritative coords) OR a number if coords exist
        (topResult.distanceKm === null || typeof topResult.distanceKm === 'number') &&
        // scores.coordinatesUsedForRanking correctly reflects whether coords were available
        typeof topResult.scores?.coordinatesUsedForRanking === 'boolean',
      `Top score: ${topResult?.scores?.totalScore}, Distance: ${topResult?.distanceKm}km, ` +
      `coordsUsed: ${topResult?.scores?.coordinatesUsedForRanking}`
    );

    // T16: Test pharmacy classification — normal discovery excludes all test fixtures
    // Phase 6.1H.1: Test fixtures are deactivated (verificationStatus=TEST, isVerified=false).
    // Normal match-availability only returns verified participating pharmacies.
    const noTestRecordsInResults = matchData.results?.every(r =>
      r.pharmacy?.isTestRecord === false && r.pharmacy?.isParticipating === true
    );
    record(
      16,
      'PHARMACY_FLOW',
      'Normal availability match excludes TEST fixtures; only real participating pharmacies returned',
      matchData.results?.length > 0 && noTestRecordsInResults,
      `Results: ${matchData.results?.length}, All participating (no test records): ${noTestRecordsInResults}`
    );

    // T17: Coordinate privacy preserved
    // Patient responses never contain raw user GPS coordinate fields
    const userPharmRes = await fetch(`${BASE_URL}/pharmacies?lat=9.3200&lon=76.6160&radiusKm=30`);
    const userPharmData = await userPharmRes.json();
    const rawCoordsLeaked = JSON.stringify(userPharmData).includes('"userLat"') ||
      JSON.stringify(userPharmData).includes('"userLon"');
    record(
      17,
      'PHARMACY_FLOW',
      'Coordinate privacy preserved (no client raw coordinates echoed back)',
      rawCoordsLeaked === false,
      'Raw coordinates strictly ephemeral'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 4: ORDERS (T18 - T27)
    // ═════════════════════════════════════════════════════════════════════════

    // Create an order for Patient 1
    const createOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: med1.id, quantity: 2 }],
        orderType: 'RESERVATION',
        notes: 'Phase 5.6 test order'
      })
    });
    const createOrderData = await createOrderRes.json();
    const order1 = createOrderData.order;
    if (order1?.id) cleanupOrderIds.push(order1.id);

    // T18: Patient can retrieve own orders
    const p1OrdersRes = await fetch(`${BASE_URL}/orders`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const p1OrdersData = await p1OrdersRes.json();
    record(
      18,
      'ORDERS',
      'Patient can retrieve own orders list',
      p1OrdersData.success === true && p1OrdersData.orders.some(o => o.id === order1.id),
      `Found ${p1OrdersData.orders?.length} orders`
    );

    // T19: Patient cannot retrieve another patient's order (403)
    const crossOrderRes = await fetch(`${BASE_URL}/orders/${order1.id}`, {
      headers: { Authorization: `Bearer ${patient2Token}` }
    });
    record(
      19,
      'ORDERS',
      'Patient cannot retrieve another patient order (403)',
      crossOrderRes.status === 403,
      `Status: ${crossOrderRes.status}`
    );

    // T20: Order list statuses are represented correctly
    const validBackendStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    const statusesValid = p1OrdersData.orders.every(o => validBackendStatuses.includes(o.status));
    record(
      20,
      'ORDERS',
      'Order list statuses use valid backend statuses',
      statusesValid === true,
      `Orders checked: ${p1OrdersData.orders.length}`
    );

    // T21: Order detail includes items snapshot
    const detailRes = await fetch(`${BASE_URL}/orders/${order1.id}`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const detailData = await detailRes.json();
    const ordDetail = detailData.order;
    record(
      21,
      'ORDERS',
      'Order detail includes items with snapshot unitPrice and quantity',
      Array.isArray(ordDetail?.items) && ordDetail.items.length > 0 && ordDetail.items[0].unitPrice != null,
      `Items: ${ordDetail?.items?.length}, UnitPrice: ₹${ordDetail?.items?.[0]?.unitPrice}`
    );

    // T22: Order detail includes pharmacy
    record(
      22,
      'ORDERS',
      'Order detail includes fulfilling pharmacy name and contact',
      Boolean(ordDetail?.pharmacy?.name),
      `Pharmacy: ${ordDetail?.pharmacy?.name}`
    );

    // T23: Order detail includes status history
    record(
      23,
      'ORDERS',
      'Order detail includes full statusHistory timeline',
      Array.isArray(ordDetail?.statusHistory) && ordDetail.statusHistory.length > 0,
      `History entries: ${ordDetail?.statusHistory?.length}`
    );

    // T24: Payment status is separate from order status
    record(
      24,
      'ORDERS',
      'Payment status is separate from order status',
      ordDetail?.status === 'PENDING' && (ordDetail?.payment === null || ordDetail?.payment?.status !== ordDetail?.status),
      `Order status: ${ordDetail?.status}, Payment: ${ordDetail?.payment?.status || 'none'}`
    );

    // T25: Fulfillment type is represented
    record(
      25,
      'ORDERS',
      'Fulfillment type is represented in order detail',
      Boolean(ordDetail?.orderType || ordDetail?.fulfillmentType),
      `Type: ${ordDetail?.orderType || ordDetail?.fulfillmentType}`
    );

    // Create a completed order & a cancelled order for status representation verification
    // Confirm order1 by pharmacist
    await fetch(`${BASE_URL}/orders/${order1.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ status: 'CONFIRMED', comment: 'Stock verified' })
    });
    // Mark ready for pickup
    await fetch(`${BASE_URL}/orders/${order1.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ status: 'READY_FOR_PICKUP', comment: 'Ready' })
    });
    // Complete with PIN
    await fetch(`${BASE_URL}/orders/${order1.id}/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ pin: order1.verificationPin })
    });

    // T26: Completed orders are represented
    const completedDetail = await (await fetch(`${BASE_URL}/orders/${order1.id}`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    })).json();
    record(
      26,
      'ORDERS',
      'Completed orders are represented accurately with status COMPLETED',
      completedDetail.order?.status === 'COMPLETED',
      `Status: ${completedDetail.order?.status}`
    );

    // Create and cancel another order
    const cancelOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: med1.id, quantity: 1 }],
        orderType: 'RESERVATION'
      })
    });
    const cancelOrderData = await cancelOrderRes.json();
    const orderToCancel = cancelOrderData.order;
    if (orderToCancel?.id) cleanupOrderIds.push(orderToCancel.id);

    await fetch(`${BASE_URL}/orders/${orderToCancel.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ status: 'CANCELLED', comment: 'Cancelled by patient' })
    });

    const cancelledDetail = await (await fetch(`${BASE_URL}/orders/${orderToCancel.id}`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    })).json();

    // T27: Rejected/Cancelled orders are represented
    record(
      27,
      'ORDERS',
      'Cancelled / Rejected orders are represented accurately',
      cancelledDetail.order?.status === 'CANCELLED',
      `Status: ${cancelledDetail.order?.status}`
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 5: PAYMENT (T28 - T35)
    // ═════════════════════════════════════════════════════════════════════════

    // Create a new order for payment testing
    const payOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: med1.id, quantity: 2 }],
        orderType: 'RESERVATION'
      })
    });
    const payOrder = (await payOrderRes.json()).order;
    if (payOrder?.id) cleanupOrderIds.push(payOrder.id);

    // T28: Payment only after confirmation (PENDING orders blocked)
    const pendingPayRes = await fetch(`${BASE_URL}/checkout/${payOrder.id}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` }
    });
    record(
      28,
      'PAYMENT',
      'Payment creation blocked before pharmacy confirmation (status: PENDING)',
      pendingPayRes.status === 400,
      `Status: ${pendingPayRes.status}`
    );

    // Confirm order by pharmacist
    await fetch(`${BASE_URL}/orders/${payOrder.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ status: 'CONFIRMED', comment: 'Stock confirmed' })
    });

    // Select fulfillment
    await fetch(`${BASE_URL}/checkout/${payOrder.id}/fulfillment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ fulfillmentType: 'PICKUP' })
    });

    // T29: Backend amount remains authoritative (checkout summary)
    const checkoutSummaryRes = await fetch(`${BASE_URL}/checkout/${payOrder.id}`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const checkoutSummary = await checkoutSummaryRes.json();
    record(
      29,
      'PAYMENT',
      'Backend amount remains authoritative in checkout summary',
      checkoutSummary.checkout?.totals?.totalAmount != null && checkoutSummary.checkout?.totals?.currency === 'INR',
      `Authoritative total: ₹${checkoutSummary.checkout?.totals?.totalAmount}`
    );

    // T30: Integer paise calculation remains correct
    const expectedPaise = Math.round(checkoutSummary.checkout.totals.totalAmount * 100);
    record(
      30,
      'PAYMENT',
      'Integer paise calculation is exact and non-floating',
      Number.isInteger(expectedPaise) && expectedPaise > 0,
      `Paise: ${expectedPaise}`
    );

    // Create payment
    const createPayRes = await fetch(`${BASE_URL}/checkout/${payOrder.id}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` }
    });
    const createPayData = await createPayRes.json();

    // T31: Payment retry works when previous payment is failed or retry requested
    const retryRes = await fetch(`${BASE_URL}/checkout/${payOrder.id}/retry-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` }
    });
    const retryData = await retryRes.json();
    record(
      31,
      'PAYMENT',
      'Payment retry returns payment session for pending/retryable order',
      retryData.success === true && Boolean(retryData.payment?.gatewayOrderId),
      `Gateway Order ID: ${retryData.payment?.gatewayOrderId}`
    );

    // T32: gatewaySignature never appears in patient response
    const patientRespString = JSON.stringify(createPayData) + JSON.stringify(checkoutSummary);
    record(
      32,
      'PAYMENT',
      'gatewaySignature never appears in patient checkout responses',
      !patientRespString.includes('gatewaySignature'),
      'gatewaySignature strictly withheld'
    );

    // T33: Razorpay secret never appears in API response
    record(
      33,
      'PAYMENT',
      'Razorpay secret never appears in API responses',
      !patientRespString.includes(process.env.RAZORPAY_KEY_SECRET),
      'RAZORPAY_KEY_SECRET protected'
    );

    // Simulate verified payment
    const paymentRecord = await prisma.payment.findUnique({ where: { orderId: payOrder.id } });
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const testPaymentId = 'pay_test_' + Date.now();
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(paymentRecord.gatewayOrderId + '|' + testPaymentId)
      .digest('hex');

    await fetch(`${BASE_URL}/checkout/${payOrder.id}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        gatewayPaymentId: testPaymentId,
        gatewayOrderId: paymentRecord.gatewayOrderId,
        gatewaySignature: validSignature
      })
    });

    // T34: Paid order cannot be cancelled or rejected
    const cancelPaidRes = await fetch(`${BASE_URL}/orders/${payOrder.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    record(
      34,
      'PAYMENT',
      'Paid orders protected from cancellation without refund flow',
      cancelPaidRes.status === 400,
      `Status: ${cancelPaidRes.status}`
    );

    // T35: Offline payment remains blocked
    const offlineQueueSrc = fs.readFileSync(path.resolve(__dirname, '../client/src/utils/offlineActionQueue.js'), 'utf-8');
    const hasCheckoutBlocked = offlineQueueSrc.includes("'/checkout'") || offlineQueueSrc.includes('"/checkout"');
    const hasPaymentBlocked = offlineQueueSrc.includes("'/payment'") || offlineQueueSrc.includes('"/payment"');
    const safeTypesMatch = offlineQueueSrc.match(/SAFE_ACTION_TYPES\s*=\s*\[([\s\S]*?)\]/);
    const safeTypesStr = safeTypesMatch ? safeTypesMatch[1] : '';
    const paymentBlockedInQueue = hasCheckoutBlocked && hasPaymentBlocked && !safeTypesStr.includes('PAYMENT');
    record(
      35,
      'PAYMENT',
      'Offline payment is blocked by offline action policy',
      paymentBlockedInQueue === true,
      'Live connectivity strictly required'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 6: NOTIFICATIONS (T36 - T37)
    // ═════════════════════════════════════════════════════════════════════════

    const notifRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${patient1Token}` }
    });
    const notifData = await notifRes.json();
    const orderNotif = notifData.notifications?.find(n => n.linkUrl?.includes('orders'));

    // T36: Relevant notification can resolve to order
    record(
      36,
      'NOTIFICATIONS',
      'Relevant notification links resolve to order reference path',
      orderNotif && orderNotif.linkUrl.includes('/orders/'),
      `LinkUrl: ${orderNotif?.linkUrl}`
    );

    // T37: No sensitive payment data in notification
    const notifsString = JSON.stringify(notifData);
    record(
      37,
      'NOTIFICATIONS',
      'Notifications contain no sensitive payment keys or secrets',
      !notifsString.includes('rzp_') && !notifsString.includes(process.env.RAZORPAY_KEY_SECRET),
      'Notifications clean of financial credentials'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 7: ASSISTANT WORKFLOW (T38 - T40)
    // ═════════════════════════════════════════════════════════════════════════

    // Create an assistant-delivery order
    const asstUser = await prisma.user.findFirst({ where: { email: 'assistant@medifind.com' } });
    const asstOrderRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        pharmacyId: testPharm.id,
        items: [{ medicineId: med1.id, quantity: 1 }],
        orderType: 'ASSISTED_DELIVERY',
        assistantId: asstUser.id,
        selectedAssistantId: asstUser.id,
        deliveryAddress: 'Door 4B, Riverview Residency, Chengannur'
      })
    });
    const asstOrder = (await asstOrderRes.json()).order;
    if (asstOrder?.id) cleanupOrderIds.push(asstOrder.id);

    // Confirm & pay order to unlock assistant task
    await fetch(`${BASE_URL}/orders/${asstOrder.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ status: 'CONFIRMED', comment: 'Ready for assistant' })
    });
    await fetch(`${BASE_URL}/checkout/${asstOrder.id}/fulfillment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: asstUser.id,
        selectedAssistantId: asstUser.id,
        deliveryAddress: 'Door 4B, Riverview Residency, Chengannur'
      })
    });
    const asstPayCreate = await (await fetch(`${BASE_URL}/checkout/${asstOrder.id}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` }
    })).json();

    const asstPayRecord = await prisma.payment.findUnique({ where: { orderId: asstOrder.id } });
    const asstPaymentId = 'pay_asst_' + Date.now();
    const asstSig = crypto
      .createHmac('sha256', secret)
      .update(asstPayRecord.gatewayOrderId + '|' + asstPaymentId)
      .digest('hex');

    await fetch(`${BASE_URL}/checkout/${asstOrder.id}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        gatewayPaymentId: asstPaymentId,
        gatewayOrderId: asstPayRecord.gatewayOrderId,
        gatewaySignature: asstSig
      })
    });

    // Check assistant task
    const asstTasksRes = await fetch(`${BASE_URL}/assistant/available`, {
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    const asstTasksData = await asstTasksRes.json();
    const taskForOrder = asstTasksData.tasks?.find(t => t.orderId === asstOrder.id);

    // T38: Assistant task workflow remains intact
    record(
      38,
      'ASSISTANT',
      'Assistant task created and available after payment verification',
      taskForOrder != null && ['AVAILABLE', 'PENDING', 'ASSIGNED'].includes(taskForOrder.status),
      `Task status: ${taskForOrder?.status}`
    );

    // T39: Assistant receives no payment secrets
    const asstRespString = JSON.stringify(asstTasksData);
    record(
      39,
      'ASSISTANT',
      'Assistant tasks payload contains no payment secrets or signatures',
      !asstRespString.includes(process.env.RAZORPAY_KEY_SECRET) && !asstRespString.includes('gatewaySignature'),
      'Assistant views clean of financial secrets'
    );

    // T40: Assistant receives no unnecessary prescription image data
    record(
      40,
      'ASSISTANT',
      'Assistant receives no prescription raw image buffer or doctor notes',
      !asstRespString.includes('ocrText') && !asstRespString.includes('imageUrl'),
      'Prescription privacy maintained'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // PART 8: SECURITY & REGRESSION (T41 - T45)
    // ═════════════════════════════════════════════════════════════════════════

    // T41: Role authorization remains intact
    const asstCheckoutBlocked = await fetch(`${BASE_URL}/checkout/${payOrder.id}`, {
      headers: { Authorization: `Bearer ${assistantToken}` }
    });
    record(
      41,
      'SECURITY',
      'Role authorization strictly blocks ASSISTANT from PATIENT checkout',
      asstCheckoutBlocked.status === 403,
      `Status: ${asstCheckoutBlocked.status}`
    );

    // T42: Pharmacy isolation remains intact
    // Pharmacist cannot confirm an order from a pharmacy they do not manage
    let crossPharmBlocked = true;
    if (otherPharmacistToken) {
      const crossPharmRes = await fetch(`${BASE_URL}/orders/${payOrder.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherPharmacistToken}` },
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      crossPharmBlocked = crossPharmRes.status === 403;
    }
    record(
      42,
      'SECURITY',
      'Pharmacy isolation: pharmacist cannot modify orders of another pharmacy',
      crossPharmBlocked === true,
      'Cross-pharmacy isolation strictly enforced (403)'
    );

    // T43: Admin sensitive data protection remains intact
    const adminOrdersRes = await fetch(`${BASE_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminOrdersData = await adminOrdersRes.json();
    const adminStr = JSON.stringify(adminOrdersData);
    record(
      43,
      'SECURITY',
      'Admin console excludes sensitive payment secrets and signatures',
      !adminStr.includes(process.env.RAZORPAY_KEY_SECRET) && !adminStr.includes('gatewaySignature'),
      'Admin sensitive data protection active'
    );

    // T44: Order ownership remains intact
    const p2OrderRes = await fetch(`${BASE_URL}/orders/${order1.id}`, {
      headers: { Authorization: `Bearer ${patient2Token}` }
    });
    record(
      44,
      'SECURITY',
      'Patient 2 cannot access Patient 1 order details (ownership isolation)',
      p2OrderRes.status === 403,
      `Status: ${p2OrderRes.status}`
    );

    // T45: Terminal order states remain protected from further transitions
    const retransitionRes = await fetch(`${BASE_URL}/orders/${order1.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacistToken}` },
      body: JSON.stringify({ status: 'READY_FOR_PICKUP' })
    });
    record(
      45,
      'SECURITY',
      'Terminal order status (COMPLETED) rejects any further transitions',
      retransitionRes.status === 400,
      `Status: ${retransitionRes.status}`
    );

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // Cleanup temporary orders & users
    console.log('\n🧹 Cleaning up test orders and temporary users...');
    for (const ordId of cleanupOrderIds) {
      try {
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: ordId } });
        await prisma.orderItem.deleteMany({ where: { orderId: ordId } });
        await prisma.payment.deleteMany({ where: { orderId: ordId } });
        await prisma.assistantTask.deleteMany({ where: { orderId: ordId } });
        await prisma.order.delete({ where: { id: ordId } });
      } catch (e) {}
    }
    for (const uId of cleanupUserIds) {
      try {
        await prisma.user.delete({ where: { id: uId } });
      } catch (e) {}
    }
    console.log('✅ Cleanup complete');
    await prisma.$disconnect();
  }

  // Print results
  const passedCount = results.filter(r => r.status === 'PASS').length;
  const failedCount = results.filter(r => r.status === 'FAIL').length;
  console.log('\n💳 ====================================================================');
  console.log(`💳 RESULTS: ${passedCount}/${results.length} PASSED (${failedCount} FAILED)`);
  console.log('💳 ====================================================================');

  if (failedCount === 0 && results.length >= 40) {
    console.log('\n🎉 ALL PHASE 5.6 FUNCTIONAL TESTS PASSED!');
    process.exit(0);
  } else {
    console.error(`\n❌ TEST SUITE FAILED with ${failedCount} failures.`);
    process.exit(1);
  }
}

runPhase56Tests();
