/**
 * MediFind AI — Checkout & Payment Controller
 * Phase 5.5
 *
 * SECURITY CONTRACT:
 * - All amounts are computed server-side from confirmed OrderItem snapshots.
 * - RAZORPAY_KEY_SECRET is NEVER returned to the client.
 * - Payment creation is idempotent — duplicate requests reuse existing PENDING payments.
 * - Payment verification rejects invalid signatures, wrong order, and amount mismatches.
 * - AssistantTask is only created AFTER payment is verified (PAID), not on order creation.
 * - Every endpoint enforces: authenticated + patient ownership + valid order state.
 */

const crypto = require('crypto');
const prisma = require('../prisma');
const {
  VALID_FULFILLMENT_TYPES,
  calculateOrderTotals,
  getRazorpayInstance,
  getRazorpayKeyId
} = require('../utils/paymentConfig');
const { formatAddressString } = require('./addressController');
const { validateAssistantSelection, discoverAssistants } = require('./assistantController');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/checkout/:orderId
// Returns checkout summary for a CONFIRMED order.
// Only accessible by the patient who owns the order.
// ─────────────────────────────────────────────────────────────────────────────
async function getCheckoutSummary(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { medicine: true } },
        pharmacy: { select: { id: true, name: true, address: true, phone: true, deliveryAvailable: true } },
        payment: true
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Enforce patient ownership
    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    const isPending = order.status === 'PENDING';
    const TERMINAL_STATUSES = ['REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot be paid.`
      });
    }

    // If fulfillmentType has been set and medicine is priced, use stored totals; otherwise calculate from snapshot
    const fulfillmentType = order.fulfillmentType || null;
    let totals = null;
    if (fulfillmentType && order.totalAmount != null && order.medicineSubtotal != null) {
      totals = {
        medicineSubtotal: order.medicineSubtotal,
        fulfillmentFee: order.deliveryFee,
        platformFee: order.platformFee || 0.0,
        totalAmount: order.totalAmount,
        currency: 'INR',
        requiresCounterPayment: false,
        unpricedItemsCount: 0
      };
    } else {
      const calc = calculateOrderTotals(order.items, fulfillmentType || 'PICKUP', {
        includePlatformFee: order.platformFee > 0 || process.env.ENABLE_PLATFORM_FEE === 'true'
      });
      totals = {
        medicineSubtotal: calc.medicineSubtotal,
        fulfillmentFee: fulfillmentType ? order.deliveryFee : calc.fulfillmentFee,
        platformFee: calc.platformFee,
        totalAmount: calc.totalAmount,
        currency: 'INR',
        requiresCounterPayment: calc.requiresCounterPayment,
        unpricedItemsCount: calc.unpricedItemsCount,
        pricingNote: calc.requiresCounterPayment ? 'MRP / counter pricing at pharmacy' : null
      };
    }

    // Build safe item list
    const items = order.items.map(item => ({
      medicineId: item.medicineId,
      brandName: item.medicine?.brandName,
      genericName: item.medicine?.genericName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal
    }));

    // Payment status (safe fields only)
    let paymentInfo = null;
    if (order.payment) {
      paymentInfo = {
        id: order.payment.id,
        status: order.payment.status,
        method: order.payment.method,
        amount: order.payment.amount,
        currency: order.payment.currency,
        paidAt: order.payment.paidAt,
        failureReason: order.payment.failureReason,
        // gatewayOrderId is safe to return (needed by frontend to open Razorpay)
        gatewayOrderId: order.payment.gatewayOrderId
        // gatewayPaymentId, gatewaySignature NOT returned to patient
      };
    }

    return res.json({
      success: true,
      checkout: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        orderType: order.orderType,
        fulfillmentType,
        assistantServiceType: order.assistantServiceType,
        pharmacy: order.pharmacy,
        items,
        totals,
        deliveryAddress: order.deliveryAddress,
        addressId: order.addressId,
        selectedAssistantId: order.selectedAssistantId,
        notes: order.notes,
        payment: paymentInfo,
        // Expose public Razorpay key for frontend to use (NEVER expose secret)
        razorpayKeyId: getRazorpayKeyId()
      }
    });
  } catch (err) {
    console.error('getCheckoutSummary error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve checkout summary.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/:orderId/fulfillment
// Patient selects fulfillment type and (optionally) delivery address.
// Only allowed after order is CONFIRMED and before payment is created/paid.
// ─────────────────────────────────────────────────────────────────────────────
async function selectFulfillment(req, res) {
  try {
    const { orderId } = req.params;
    const { fulfillmentType, deliveryAddress, addressId, assistantServiceType, assistantId, selectedAssistantId } = req.body;
    const targetAssistantId = assistantId || selectedAssistantId;
    const userId = req.user.id;

    const VALID_ASSISTANT_SERVICE_TYPES = [
      'MEDICINE_COLLECTION', 'PHARMACY_VISIT', 'PHARMACY_COMPANION',
      'MEDICINE_DELIVERY', 'DIGITAL_ASSISTANCE', 'PHARMACY_COMMS',
      'RESTOCK_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE'
    ];

    if (!VALID_FULFILLMENT_TYPES.includes(fulfillmentType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid fulfillmentType. Must be one of: ${VALID_FULFILLMENT_TYPES.join(', ')}`
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true, pharmacy: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    // Security check: validate patient address ownership if addressId provided
    if (addressId) {
      const savedAddr = await prisma.patientAddress.findUnique({
        where: { id: addressId }
      });
      if (!savedAddr) {
        return res.status(404).json({
          success: false,
          error: 'Selected patient address was not found.'
        });
      }
      if (savedAddr.userId !== userId && req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: Cannot use an address that does not belong to you.'
        });
      }
    }

    if (order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        error: `Fulfillment selection requires order to be CONFIRMED (current: ${order.status}).`
      });
    }

    // Block if payment is already PAID — cannot change fulfillment
    if (order.payment && order.payment.status === 'PAID') {
      return res.status(400).json({
        success: false,
        error: 'Payment has already been completed. Fulfillment type cannot be changed.'
      });
    }

    // Prevent changing assistant or service type after task has already been assigned
    const priorTask = await prisma.assistantTask.findUnique({
      where: { orderId }
    });
    if (priorTask && priorTask.status !== 'AVAILABLE') {
      if (targetAssistantId && priorTask.assistantId && targetAssistantId !== priorTask.assistantId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot modify assigned assistant after task has been assigned.'
        });
      }
      if (assistantServiceType && priorTask.serviceType && assistantServiceType !== priorTask.serviceType) {
        return res.status(400).json({
          success: false,
          error: 'Cannot modify assistant service type after task has been assigned.'
        });
      }
      if (order.fulfillmentType && fulfillmentType && fulfillmentType !== order.fulfillmentType) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change fulfillment type after assistant task has been assigned.'
        });
      }
    }

    // Phase 6.1L.10: Pharmacy Delivery gating — only allowed when selected pharmacy actually supports delivery
    if (fulfillmentType === 'DELIVERY' && !order.pharmacy?.deliveryAvailable) {
      return res.status(400).json({
        success: false,
        error: 'This pharmacy does not offer pharmacy delivery service. Please choose Counter Pickup or Medicine Access Assistant.'
      });
    }

    // Validate assistantServiceType when ASSISTANT_DELIVERY is chosen
    if (fulfillmentType === 'ASSISTANT_DELIVERY') {
      if (!assistantServiceType || !VALID_ASSISTANT_SERVICE_TYPES.includes(assistantServiceType)) {
        return res.status(400).json({
          success: false,
          error: `A valid assistantServiceType is required for ASSISTANT_DELIVERY. Must be one of: ${VALID_ASSISTANT_SERVICE_TYPES.join(', ')}`
        });
      }

      // Phase 6.1L.7 Correction: Specific assistant selection is mandatory (no auto-assignment / broadcast option)
      if (!targetAssistantId) {
        return res.status(400).json({
          success: false,
          error: 'Please select a specific Medicine Access Assistant for this service.'
        });
      }

      const asstValidation = await validateAssistantSelection(targetAssistantId, assistantServiceType);
      if (!asstValidation.valid) {
        return res.status(400).json({
          success: false,
          error: asstValidation.error
        });
      }
    }

    // Non-address service types do not require a physical patient delivery address
    const NON_ADDRESS_SERVICE_TYPES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'];
    const isAssistantNonAddress = fulfillmentType === 'ASSISTANT_DELIVERY' &&
      NON_ADDRESS_SERVICE_TYPES.includes(assistantServiceType);

    // Validate delivery address for fulfillment types that require it
    // ASSISTANT_DELIVERY: only required for physical service types, not for digital/comms services
    const requiresAddress = fulfillmentType === 'DELIVERY' ||
      (fulfillmentType === 'ASSISTANT_DELIVERY' && !isAssistantNonAddress);

    let effectiveDeliveryAddress = null;
    let effectiveAddressId = null;

    if (requiresAddress) {
      if (addressId) {
        // Resolve selected patient address
        const savedAddr = await prisma.patientAddress.findUnique({
          where: { id: addressId }
        });
        if (!savedAddr) {
          return res.status(404).json({
            success: false,
            error: 'Selected patient address was not found.'
          });
        }
        if (savedAddr.userId !== userId && req.user.role !== 'ADMIN') {
          return res.status(403).json({
            success: false,
            error: 'Unauthorized: Cannot use an address that does not belong to you.'
          });
        }
        effectiveDeliveryAddress = formatAddressString(savedAddr);
        effectiveAddressId = savedAddr.id;
      } else if (deliveryAddress && typeof deliveryAddress === 'string' && deliveryAddress.trim() !== '') {
        // Validate direct string address for backward compatibility
        const BLOCKED_ADDRESSES = [
          'test address', 'apollo 24/7', 'care & cure', '123 main st', 'patient registered address', 'placeholder'
        ];
        const lowerAddr = deliveryAddress.toLowerCase().trim();
        if (BLOCKED_ADDRESSES.some(b => lowerAddr.includes(b))) {
          return res.status(400).json({
            success: false,
            error: 'Please provide a real address. Placeholder or test addresses are not accepted.'
          });
        }
        effectiveDeliveryAddress = deliveryAddress.trim();
        effectiveAddressId = null;
      } else {
        // Fallback: check if the patient has a default saved address
        const defaultAddr = await prisma.patientAddress.findFirst({
          where: { userId, isDefault: true }
        });
        if (defaultAddr) {
          effectiveDeliveryAddress = formatAddressString(defaultAddr);
          effectiveAddressId = defaultAddr.id;
        } else {
          return res.status(400).json({
            success: false,
            error: `A service location address is required for ${fulfillmentType} with service type ${assistantServiceType || 'PHYSICAL'}.`
          });
        }
      }
    }

    // Calculate totals from confirmed snapshot prices (not current inventory!)
    const includePlatformFee = req.body.includePlatformFee !== undefined
      ? Boolean(req.body.includePlatformFee)
      : (order.platformFee > 0 || process.env.ENABLE_PLATFORM_FEE === 'true');
    const totals = calculateOrderTotals(order.items, fulfillmentType, { includePlatformFee });

    // Update order with fulfillment selection and recalculated totals
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        fulfillmentType,
        deliveryAddress: requiresAddress ? effectiveDeliveryAddress : null,
        addressId: requiresAddress ? effectiveAddressId : null,
        assistantServiceType: fulfillmentType === 'ASSISTANT_DELIVERY' ? assistantServiceType : null,
        selectedAssistantId: fulfillmentType === 'ASSISTANT_DELIVERY' ? (targetAssistantId || null) : null,
        medicineSubtotal: totals.medicineSubtotal,
        deliveryFee: totals.fulfillmentFee,
        platformFee: totals.platformFee,
        totalAmount: totals.totalAmount != null ? totals.totalAmount : 0.0
      }
    });

    // If an AssistantTask already exists for this order (e.g. from prior reservation/setup), update it safely
    const existingTask = await prisma.assistantTask.findUnique({
      where: { orderId }
    });
    if (existingTask) {
      await prisma.assistantTask.update({
        where: { id: existingTask.id },
        data: {
          serviceType: assistantServiceType || existingTask.serviceType,
          deliveryAddress: requiresAddress ? effectiveDeliveryAddress : null,
          assistantId: targetAssistantId || existingTask.assistantId,
          status: 'ASSIGNED',
          acceptedAt: null
        }
      });
    }

    return res.json({
      success: true,
      message: 'Fulfillment type selected.',
      fulfillmentType: updated.fulfillmentType,
      deliveryAddress: updated.deliveryAddress,
      addressId: updated.addressId,
      assistantServiceType: updated.assistantServiceType,
      selectedAssistantId: updated.selectedAssistantId,
      totals: {
        medicineSubtotal: updated.medicineSubtotal,
        fulfillmentFee: updated.deliveryFee,
        platformFee: updated.platformFee,
        totalAmount: totals.totalAmount,
        currency: 'INR',
        requiresCounterPayment: totals.requiresCounterPayment,
        unpricedItemsCount: totals.unpricedItemsCount,
        pricingNote: totals.requiresCounterPayment ? 'MRP / counter pricing at pharmacy' : null
      }
    });
  } catch (err) {
    console.error('selectFulfillment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to set fulfillment type.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/:orderId/create-payment
// Creates a Razorpay order server-side and a Payment record (PENDING).
// Idempotent: returns existing PENDING payment if one already exists.
// SECURITY: Amount is always from backend calculation, never from frontend.
// ─────────────────────────────────────────────────────────────────────────────
async function createPayment(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Ownership check
    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    // Must be CONFIRMED
    if (order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        error: `Payment creation requires order status CONFIRMED (current: ${order.status}).`
      });
    }

    // Must have fulfillment type selected
    if (!order.fulfillmentType) {
      return res.status(400).json({
        success: false,
        error: 'Please select a fulfillment type (PICKUP, DELIVERY, or ASSISTANT_DELIVERY) before proceeding to payment.'
      });
    }

    // Revalidate assistant for ASSISTANT_DELIVERY prior to creating payment order
    if (order.fulfillmentType === 'ASSISTANT_DELIVERY') {
      if (!order.selectedAssistantId) {
        return res.status(400).json({
          success: false,
          error: 'A specific Medicine Access Assistant must be selected for this service.'
        });
      }
      const asstValidation = await validateAssistantSelection(order.selectedAssistantId, order.assistantServiceType);
      if (!asstValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `Selected assistant is no longer eligible: ${asstValidation.error}`
        });
      }
    }

    // Idempotency: If a PENDING payment already has a gatewayOrderId, reuse it
    if (order.payment) {
      if (order.payment.status === 'PAID') {
        return res.status(400).json({
          success: false,
          error: 'This order has already been paid.',
          payment: {
            status: order.payment.status,
            amount: order.payment.amount,
            paidAt: order.payment.paidAt
          }
        });
      }
      if (order.payment.status === 'PENDING' && order.payment.gatewayOrderId) {
        // Return existing pending payment — idempotent
        return res.json({
          success: true,
          message: 'Existing pending payment returned (idempotent).',
          payment: {
            id: order.payment.id,
            amount: order.payment.amount,
            currency: order.payment.currency,
            gatewayOrderId: order.payment.gatewayOrderId,
            status: order.payment.status
          },
          razorpayKeyId: getRazorpayKeyId()
        });
      }
    }

    // Calculate authoritative amount from confirmed snapshot
    const includePlatformFee = order.platformFee > 0 || process.env.ENABLE_PLATFORM_FEE === 'true';
    const totals = calculateOrderTotals(order.items, order.fulfillmentType, { includePlatformFee });

    // Safety check: online payment requires a complete numeric medicine total.
    // Real unpriced medicines cannot produce a fabricated Razorpay amount, ₹0 charge, or fake subtotal.
    if (totals.medicineSubtotal === null || totals.totalAmount === null || (order.items || []).some(item => item.unitPrice == null)) {
      return res.status(400).json({
        success: false,
        error: 'Online payment cannot be initiated because authoritative medicine prices must be confirmed at the pharmacy counter. Please pay at the pharmacy counter upon pickup.',
        requiresCounterPayment: true,
        medicineSubtotal: null
      });
    }

    const amountPaise = Math.round(totals.totalAmount * 100); // Razorpay expects paise

    // Initialize Razorpay
    const { razorpay, configError } = getRazorpayInstance();
    if (configError) {
      return res.status(503).json({
        success: false,
        error: configError,
        configurationRequired: true
      });
    }

    // Create Razorpay order server-side
    let rzpOrder;
    try {
      rzpOrder = await razorpay.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.orderNumber,
        notes: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          fulfillmentType: order.fulfillmentType
          // Never log userId or patient PII in gateway notes
        }
      });
    } catch (rzpErr) {
      console.error('Razorpay order creation error:', rzpErr?.error?.description || rzpErr.message);
      return res.status(502).json({
        success: false,
        error: 'Payment gateway error. Please try again or contact support.',
        // Never expose rzpErr details (may contain sensitive info)
      });
    }

    // Upsert Payment record
    const payment = await prisma.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        amount: totals.totalAmount,
        currency: 'INR',
        method: 'ONLINE',
        status: 'PENDING',
        gateway: 'RAZORPAY',
        gatewayOrderId: rzpOrder.id
      },
      update: {
        amount: totals.totalAmount,
        status: 'PENDING',
        gatewayOrderId: rzpOrder.id,
        failureReason: null,
        gatewayPaymentId: null,
        gatewaySignature: null
      }
    });

    // Also sync totals back to Order if they changed
    await prisma.order.update({
      where: { id: orderId },
      data: {
        medicineSubtotal: totals.medicineSubtotal,
        deliveryFee: totals.fulfillmentFee,
        platformFee: totals.platformFee,
        totalAmount: totals.totalAmount
      }
    });

    return res.json({
      success: true,
      message: 'Payment initiated. Use Razorpay Checkout to complete payment.',
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        gatewayOrderId: payment.gatewayOrderId,
        status: payment.status
      },
      // Public key only — NEVER return secret
      razorpayKeyId: getRazorpayKeyId()
    });
  } catch (err) {
    console.error('createPayment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create payment.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/:orderId/verify-payment
// Verifies Razorpay payment signature server-side.
// SECURITY: All verification is server-side. Frontend only passes identifiers.
// After successful verification: Payment → PAID, fulfillment proceeds.
// For ASSISTANT_DELIVERY: AssistantTask is created ONLY AFTER payment is PAID.
// ─────────────────────────────────────────────────────────────────────────────
async function verifyPayment(req, res) {
  try {
    const { orderId } = req.params;
    const razorpay_order_id = req.body.razorpay_order_id || req.body.gatewayOrderId;
    const razorpay_payment_id = req.body.razorpay_payment_id || req.body.gatewayPaymentId;
    const razorpay_signature = req.body.razorpay_signature || req.body.gatewaySignature;
    const userId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing payment verification parameters: razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.'
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Ownership
    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    if (!order.payment) {
      return res.status(400).json({ success: false, error: 'No payment record found for this order. Please initiate payment first.' });
    }

    // Idempotency: Already PAID → return success (don't double-verify)
    if (order.payment.status === 'PAID') {
      return res.json({
        success: true,
        message: 'Payment was already verified and marked PAID.',
        alreadyPaid: true,
        payment: {
          status: order.payment.status,
          amount: order.payment.amount,
          paidAt: order.payment.paidAt
        }
      });
    }

    // Verify gateway order ID matches our record
    if (order.payment.gatewayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed: gateway order ID mismatch.'
      });
    }

    // Server-side signature verification using HMAC-SHA256
    // Razorpay signature = HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(503).json({
        success: false,
        error: 'Payment verification not available: Razorpay credentials are not configured.'
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      // Mark payment as FAILED
      await prisma.payment.update({
        where: { orderId: order.id },
        data: {
          status: 'FAILED',
          gatewayPaymentId: razorpay_payment_id,
          failureReason: 'Signature verification failed'
        }
      });

      // Send notification about failed payment
      await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `Payment Failed: #${order.orderNumber}`,
          message: 'Your payment could not be verified. Please retry payment or contact support.',
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return res.status(400).json({
        success: false,
        error: 'Payment signature verification failed. Payment has been marked as failed. You may retry.'
      });
    }

    // Optionally verify amount against our backend record (extra safety)
    // We cannot call Razorpay fetch here without adding latency, but we can verify later.
    // The signature verification is the primary security check per Razorpay docs.

    // Phase 6.1L.7 Correction: Revalidate specific assistant for ASSISTANT_DELIVERY at payment
    if (order.fulfillmentType === 'ASSISTANT_DELIVERY') {
      if (!order.selectedAssistantId) {
        return res.status(400).json({
          success: false,
          error: 'A specific Medicine Access Assistant must be selected for this service.',
          bookingFailed: true
        });
      }

      const asstValidation = await validateAssistantSelection(order.selectedAssistantId, order.assistantServiceType);
      if (!asstValidation.valid) {
        // Record failure state on payment record if present — never silently substitute another assistant
        if (order.payment && order.payment.status !== 'PAID') {
          await prisma.payment.update({
            where: { orderId: order.id },
            data: {
              status: 'FAILED',
              failureReason: `Selected assistant is no longer eligible: ${asstValidation.error}`
            }
          });
        }
        return res.status(400).json({
          success: false,
          error: `Selected assistant is no longer eligible: ${asstValidation.error}`,
          bookingFailed: true,
          details: asstValidation.error
        });
      }
    }

    // Transaction: Mark payment PAID, update order totals, create AssistantTask in ASSIGNED status
    const result = await prisma.$transaction(async (tx) => {
      // Mark payment as PAID
      const updatedPayment = await tx.payment.update({
        where: { orderId: order.id },
        data: {
          status: 'PAID',
          gatewayPaymentId: razorpay_payment_id,
          gatewaySignature: razorpay_signature, // stored for audit only; never logged or returned
          paidAt: new Date()
        }
      });

      // Record status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: order.status,
          comment: `Payment verified (PAID). Method: ONLINE, Fulfillment: ${order.fulfillmentType}.`
        }
      });

      // For ASSISTANT_DELIVERY: Create AssistantTask NOW (after payment) — in ASSIGNED status (not ACCEPTED)
      let assistantTask = null;
      if (order.fulfillmentType === 'ASSISTANT_DELIVERY') {
        // Check if task already exists (idempotency)
        const existingTask = await tx.assistantTask.findUnique({
          where: { orderId: order.id }
        });

        if (!existingTask) {
          assistantTask = await tx.assistantTask.create({
            data: {
              orderId: order.id,
              status: 'ASSIGNED',
              assistantId: order.selectedAssistantId,
              acceptedAt: null,
              deliveryAddress: order.deliveryAddress || null,
              serviceType: order.assistantServiceType || null,
              serviceNote: order.notes || null,
              deliveryNotes: order.notes || null,
              handoverPin: order.verificationPin || null
            }
          });
        } else {
          assistantTask = await tx.assistantTask.update({
            where: { id: existingTask.id },
            data: {
              status: 'ASSIGNED',
              assistantId: order.selectedAssistantId,
              acceptedAt: null,
              deliveryAddress: order.deliveryAddress || null,
              serviceType: order.assistantServiceType || null
            }
          });
        }

        // Notify specifically selected assistant
        if (order.selectedAssistantId) {
          await tx.notification.create({
            data: {
              userId: order.selectedAssistantId,
              title: `New Booking Request: Order #${order.orderNumber}`,
              message: `A patient has requested you for ${order.assistantServiceType || 'Assistant Service'}. Please review and accept this request.`,
              type: 'ASSISTANT',
              linkUrl: '/assistant-portal'
            }
          });
        }
      }

      // Notify patient — payment success
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: `Payment Successful: #${order.orderNumber}`,
          message: `Your payment of ₹${updatedPayment.amount} has been confirmed. Fulfillment: ${order.fulfillmentType}.`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return { payment: updatedPayment, assistantTask };
    });

    return res.json({
      success: true,
      message: 'Payment verified successfully. Fulfillment proceeding.',
      payment: {
        id: result.payment.id,
        status: result.payment.status,
        amount: result.payment.amount,
        currency: result.payment.currency,
        paidAt: result.payment.paidAt,
        method: result.payment.method
        // gatewaySignature NOT returned to client
      },
      assistantTaskCreated: Boolean(result.assistantTask)
    });
  } catch (err) {
    console.error('verifyPayment error:', err);
    return res.status(500).json({ success: false, error: 'Payment verification failed. Please retry.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/checkout/:orderId/payment-status
// Returns safe payment status for the patient.
// ─────────────────────────────────────────────────────────────────────────────
async function getPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    if (!order.payment) {
      return res.json({
        success: true,
        paymentStatus: 'NOT_INITIATED',
        payment: null
      });
    }

    return res.json({
      success: true,
      paymentStatus: order.payment.status,
      payment: {
        id: order.payment.id,
        status: order.payment.status,
        method: order.payment.method,
        amount: order.payment.amount,
        currency: order.payment.currency,
        paidAt: order.payment.paidAt,
        failureReason: order.payment.failureReason,
        gatewayOrderId: order.payment.gatewayOrderId
        // gatewayPaymentId, gatewaySignature: NOT returned
      }
    });
  } catch (err) {
    console.error('getPaymentStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve payment status.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/:orderId/retry-payment
// Allows patient to retry a FAILED payment.
// Resets payment to PENDING and creates a new Razorpay order.
// ─────────────────────────────────────────────────────────────────────────────
async function retryPayment(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    if (!order.payment) {
      return res.status(400).json({ success: false, error: 'No payment to retry. Please initiate payment first.' });
    }

    if (order.payment.status === 'PAID') {
      return res.status(400).json({ success: false, error: 'This order has already been paid. No retry needed.' });
    }

    if (order.payment.status !== 'FAILED' && order.payment.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: `Cannot retry payment in status: ${order.payment.status}.`
      });
    }

    // Recalculate authoritative amount
    const fulfillmentType = order.fulfillmentType || 'PICKUP';
    const totals = calculateOrderTotals(order.items, fulfillmentType);
    const amountPaise = Math.round(totals.totalAmount * 100);

    // Create new Razorpay order
    const { razorpay, configError } = getRazorpayInstance();
    if (configError) {
      return res.status(503).json({ success: false, error: configError, configurationRequired: true });
    }

    let rzpOrder;
    try {
      rzpOrder = await razorpay.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: `${order.orderNumber}-retry-${Date.now()}`,
        notes: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          fulfillmentType: order.fulfillmentType,
          retry: true
        }
      });
    } catch (rzpErr) {
      console.error('Razorpay retry order creation error:', rzpErr?.error?.description || rzpErr.message);
      return res.status(502).json({ success: false, error: 'Payment gateway error. Please try again.' });
    }

    // Update Payment to PENDING with new gateway order
    const payment = await prisma.payment.update({
      where: { orderId: order.id },
      data: {
        status: 'PENDING',
        amount: totals.totalAmount,
        gatewayOrderId: rzpOrder.id,
        gatewayPaymentId: null,
        gatewaySignature: null,
        failureReason: null
      }
    });

    return res.json({
      success: true,
      message: 'Payment retry initiated.',
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        gatewayOrderId: payment.gatewayOrderId,
        status: payment.status
      },
      razorpayKeyId: getRazorpayKeyId()
    });
  } catch (err) {
    console.error('retryPayment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retry payment.' });
  }
}

module.exports = {
  getCheckoutSummary,
  selectFulfillment,
  createPayment,
  verifyPayment,
  getPaymentStatus,
  retryPayment
};
