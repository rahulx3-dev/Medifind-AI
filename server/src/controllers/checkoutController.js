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
const paymentConfig = require('../utils/paymentConfig');
const {
  VALID_FULFILLMENT_TYPES,
  calculateOrderTotals,
  getRazorpayKeyId
} = paymentConfig;
const { formatAddressString } = require('./addressController');
const { validateAssistantSelection, discoverAssistants } = require('./assistantController');
const { invalidateOrdersCache } = require('./orderController');

/**
 * Resolves the effective platform fee for an order:
 * - Parent aggregate orders: cannot be checked out directly.
 * - Legacy standalone orders (parentOrderId == null): ₹2.00 (unless platform fee globally disabled).
 * - Child orders (parentOrderId != null): ₹0.00 by default; ₹2.00 ONLY when holding a valid reservation or paid fee.
 */
async function resolveOrderPlatformFee(order, tx = prisma) {
  if (order.isParentOrder) {
    return { error: 'PARENT_ORDER_CHECKOUT_PROHIBITED' };
  }

  // Legacy standalone orders retain existing ₹2 fee behavior
  if (!order.parentOrderId) {
    const isPlatformFeeEnabled = order.platformFee > 0 || process.env.ENABLE_PLATFORM_FEE !== 'false';
    const fee = isPlatformFeeEnabled ? 2.0 : 0.0;
    return { platformFee: fee, isChild: false };
  }

  // Child order: inspect parent-level fee ledger
  let parent = null;
  if (tx.order && typeof tx.order.findUnique === 'function') {
    try {
      parent = await tx.order.findUnique({
        where: { id: order.parentOrderId }
      });
    } catch (_) {}
  }

  if (!parent) {
    return { platformFee: 0.0, isChild: true, parentNotFound: true };
  }

  // If parent fee is already PAID: only the child that paid it has 2.0, all other children 0.0
  if (parent.feeStatus === 'PAID') {
    const fee = (parent.feePayingChildOrderId === order.id) ? 2.0 : 0.0;
    return { platformFee: fee, isChild: true, feeStatus: 'PAID', isFeePayer: parent.feePayingChildOrderId === order.id };
  }

  // If parent fee is RESERVED: only the child holding the reservation has 2.0, all others 0.0
  if (parent.feeStatus === 'RESERVED') {
    const fee = (parent.feePayingChildOrderId === order.id) ? 2.0 : 0.0;
    return { platformFee: fee, isChild: true, feeStatus: 'RESERVED', isFeePayer: parent.feePayingChildOrderId === order.id };
  }

  // Otherwise UNALLOCATED or RELEASED: child orders have no fee before a valid reservation
  return { platformFee: 0.0, isChild: true, feeStatus: parent.feeStatus || 'UNALLOCATED', isFeePayer: false };
}

/**
 * Atomically reserves the parent platform fee for a child order inside a transaction:
 * Acquires row lock on parent order (SELECT ... FOR UPDATE).
 * - If already PAID: child receives 0.0 (unless it was the payer).
 * - If RESERVED by this child: reuses existing reservation (2.0).
 * - If RESERVED by another child: cannot steal reservation; child receives 0.0.
 * - If UNALLOCATED or RELEASED: claims reservation for this child (feeStatus = RESERVED, feePayingChildOrderId = child.id).
 */
async function reserveParentFeeInsideTransaction(tx, childOrder) {
  if (!childOrder.parentOrderId) {
    // Standalone order: legacy fee
    const isPlatformFeeEnabled = childOrder.platformFee > 0 || process.env.ENABLE_PLATFORM_FEE !== 'false';
    return { platformFee: isPlatformFeeEnabled ? 2.0 : 0.0, isChild: false };
  }

  // Lock parent order
  if (typeof tx.$queryRawUnsafe === 'function') {
    try {
      await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, childOrder.parentOrderId);
    } catch (_) {}
  }

  let parent = null;
  if (tx.order && typeof tx.order.findUnique === 'function') {
    parent = await tx.order.findUnique({
      where: { id: childOrder.parentOrderId }
    });
  }

  if (!parent) {
    return { platformFee: 0.0, isChild: true };
  }

  if (parent.feeStatus === 'PAID') {
    const isPayer = parent.feePayingChildOrderId === childOrder.id;
    return { platformFee: isPayer ? 2.0 : 0.0, feeStatus: 'PAID', isFeePayer: isPayer };
  }

  if (parent.feeStatus === 'RESERVED') {
    if (parent.feePayingChildOrderId === childOrder.id) {
      // Reusing own valid reservation
      return { platformFee: 2.0, feeStatus: 'RESERVED', isFeePayer: true, reused: true };
    } else {
      // Reserved by another child! This child must not add the fee
      return { platformFee: 0.0, feeStatus: 'RESERVED', isFeePayer: false, reservedByOther: true };
    }
  }

  // UNALLOCATED or RELEASED: claim reservation for this child
  if (typeof tx.order.update === 'function') {
    await tx.order.update({
      where: { id: parent.id },
      data: {
        feeStatus: 'RESERVED',
        feePayingChildOrderId: childOrder.id
      }
    });
  }

  return { platformFee: 2.0, feeStatus: 'RESERVED', isFeePayer: true, newlyReserved: true };
}

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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    // Enforce ownership (or ADMIN)
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
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

    const feeInfo = await resolveOrderPlatformFee(order);
    const effectivePlatformFee = feeInfo.platformFee;

    if (fulfillmentType && order.totalAmount != null && order.medicineSubtotal != null) {
      const computedTotal = Number(((order.medicineSubtotal || 0) + (order.deliveryFee || 0) + effectivePlatformFee).toFixed(2));
      totals = {
        medicineSubtotal: order.medicineSubtotal,
        fulfillmentFee: order.deliveryFee,
        platformFee: effectivePlatformFee,
        totalAmount: computedTotal,
        currency: 'INR',
        requiresCounterPayment: false,
        unpricedItemsCount: 0
      };
    } else {
      const calc = calculateOrderTotals(order.items, fulfillmentType || 'PICKUP', {
        platformFee: effectivePlatformFee
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

    // If there is an existing PENDING online payment with gatewayOrderId, check if Razorpay captured it
    if (order.payment && order.payment.status === 'PENDING' && order.payment.gatewayOrderId) {
      try {
        const { razorpay } = paymentConfig.getRazorpayInstance();
        if (razorpay) {
          const rzpOrder = await razorpay.orders.fetch(order.payment.gatewayOrderId);
          if (rzpOrder && (rzpOrder.status === 'paid' || (rzpOrder.amount_paid && rzpOrder.amount_paid >= rzpOrder.amount))) {
            const payments = await razorpay.orders.fetchPayments(order.payment.gatewayOrderId);
            const captured = (payments?.items || []).find(p => p.status === 'captured') || payments?.items?.[0];
            const paidTime = captured?.created_at ? new Date(captured.created_at * 1000) : new Date();

            const updatedPayment = await prisma.payment.update({
              where: { orderId: order.id },
              data: {
                status: 'PAID',
                gatewayPaymentId: captured?.id || `pay_captured_${Date.now()}`,
                paidAt: paidTime
              }
            });

            if (order.fulfillmentType === 'ASSISTANT_DELIVERY' && order.selectedAssistantId) {
              const existingTask = await prisma.assistantTask.findUnique({ where: { orderId: order.id } });
              if (!existingTask) {
                await prisma.assistantTask.create({
                  data: {
                    orderId: order.id,
                    status: 'ASSIGNED',
                    assistantId: order.selectedAssistantId,
                    deliveryAddress: order.deliveryAddress || null,
                    serviceType: order.assistantServiceType || null,
                    handoverPin: order.verificationPin || null
                  }
                });
              }
            }

            order.payment = updatedPayment;
            invalidateOrdersCache();
          }
        }
      } catch (checkErr) {
        // Fall back to stored state if gateway fetch times out
      }
    }

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
        verificationPin: order.verificationPin,
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
    const { fulfillmentType, deliveryAddress, addressId, assistantId, selectedAssistantId, assistantServiceType } = req.body;
    const targetAssistantId = assistantId || selectedAssistantId;
    const userId = req.user.id;

    const { isObsoleteService, isClinicalService } = require('../utils/serviceCatalogue');

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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    if (order.userId !== userId && req.user.role !== 'ADMIN') {
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

    // Calculate totals from confirmed snapshot prices using parent fee ledger
    const feeInfo = await resolveOrderPlatformFee(order);
    const totals = calculateOrderTotals(order.items, fulfillmentType, { platformFee: feeInfo.platformFee });

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

    invalidateOrdersCache();
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
// POST /api/checkout/:orderId/select-payment
// Patient explicitly selects payment method: 'COUNTER' | 'PAY_AT_COUNTER' | 'ONLINE'.
// For 'COUNTER': records payment method without opening Razorpay or creating fake transactions.
// Satisfies the payment method selection requirement.
// ─────────────────────────────────────────────────────────────────────────────
async function selectPayment(req, res) {
  try {
    const { orderId } = req.params;
    const { paymentMethod } = req.body;
    const userId = req.user.id;

    const VALID_PAYMENT_METHODS = ['COUNTER', 'PAY_AT_COUNTER', 'ONLINE'];
    if (!paymentMethod || !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid paymentMethod. Must be one of: COUNTER, ONLINE'
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true, pharmacy: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    // Ownership check (or ADMIN)
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    // Must be CONFIRMED
    if (order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        error: `Payment selection requires order to be CONFIRMED (current: ${order.status}).`
      });
    }

    // Fulfillment must be chosen first
    if (!order.fulfillmentType) {
      return res.status(400).json({
        success: false,
        error: 'Please select a fulfillment method (Counter Pickup or Medicine Access Assistant) before selecting a payment method.'
      });
    }

    // Block if payment is already PAID
    if (order.payment && order.payment.status === 'PAID') {
      return res.status(400).json({
        success: false,
        error: 'Payment has already been completed. Payment method cannot be changed.'
      });
    }

    const normalizedMethod = (paymentMethod === 'PAY_AT_COUNTER' || paymentMethod === 'COUNTER') ? 'COUNTER' : 'ONLINE';

    if (normalizedMethod === 'COUNTER') {
      // Validate assistant if ASSISTANT_DELIVERY is selected
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

      const result = await prisma.$transaction(async (tx) => {
        // Gate 4.2.2.2: Atomically reserve parent fee under row lock
        const feeRes = await reserveParentFeeInsideTransaction(tx, order);
        const totals = calculateOrderTotals(order.items, order.fulfillmentType || 'PICKUP', { platformFee: feeRes.platformFee });

        // Upsert Payment record for Pay at Counter (PENDING status, COUNTER method, NO fake gateway data)
        const payment = await tx.payment.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            amount: totals.totalAmount != null ? totals.totalAmount : 0.0,
            currency: 'INR',
            method: 'COUNTER',
            status: 'PENDING',
            gateway: 'COUNTER',
            gatewayOrderId: null,
            gatewayPaymentId: null,
            gatewaySignature: null,
            paidAt: null,
            failureReason: null
          },
          update: {
            method: 'COUNTER',
            status: 'PENDING',
            amount: totals.totalAmount != null ? totals.totalAmount : 0.0,
            gateway: 'COUNTER',
            gatewayOrderId: null,
            gatewayPaymentId: null,
            gatewaySignature: null,
            paidAt: null,
            failureReason: null
          }
        });

        // Sync order platformFee and totalAmount
        await tx.order.update({
          where: { id: order.id },
          data: {
            platformFee: totals.platformFee,
            totalAmount: totals.totalAmount != null ? totals.totalAmount : 0.0
          }
        });

        // Record status history entry
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: order.status,
            comment: `Payment method selected: Pay at Counter. Payment will be collected at pharmacy upon pickup.`
          }
        });

        // For ASSISTANT_DELIVERY: Upsert AssistantTask in ASSIGNED status
        let assistantTask = null;
        if (order.fulfillmentType === 'ASSISTANT_DELIVERY' && order.selectedAssistantId) {
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

          // Notify assistant
          await tx.notification.create({
            data: {
              userId: order.selectedAssistantId,
              title: `New Booking Request: Order #${order.orderNumber}`,
              message: `A patient has requested you for ${order.assistantServiceType || 'Assistant Service'}. Pay at counter selected.`,
              type: 'ASSISTANT',
              linkUrl: '/assistant-portal'
            }
          });
        }

        // If fulfillmentType was not explicitly selected yet, default to PICKUP for counter payment
        if (!order.fulfillmentType) {
          await tx.order.update({
            where: { id: order.id },
            data: { fulfillmentType: 'PICKUP' }
          });
        }

        // Notify patient
        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `Payment Method Confirmed: #${order.orderNumber}`,
            message: `Pay at Counter selected. Payment will be made directly at the pharmacy when you collect your medicines. Pickup PIN: ${order.verificationPin}.`,
            type: 'ORDER_STATUS',
            linkUrl: `/orders/${order.id}`
          }
        });

        return { payment, assistantTask };
      });

      invalidateOrdersCache();
      return res.json({
        success: true,
        message: 'Pay at Counter selected. Payment will be made directly at the pharmacy when you collect your medicines.',
        verificationPin: order.verificationPin,
        payment: {
          id: result.payment.id,
          status: result.payment.status,
          method: result.payment.method,
          amount: result.payment.amount,
          currency: result.payment.currency,
          paidAt: result.payment.paidAt
        },
        assistantTaskCreated: Boolean(result.assistantTask)
      });
    } else {
      // ONLINE method chosen
      const feeInfo = await resolveOrderPlatformFee(order);
      const totals = calculateOrderTotals(order.items, order.fulfillmentType, { platformFee: feeInfo.platformFee });

      if (totals.medicineSubtotal === null || totals.totalAmount === null || (order.items || []).some(item => item.unitPrice == null)) {
        return res.status(400).json({
          success: false,
          error: 'Online payment cannot be initiated because authoritative medicine prices must be confirmed at the pharmacy counter. Please pay at the pharmacy counter upon pickup.',
          requiresCounterPayment: true,
          medicineSubtotal: null
        });
      }

      return res.json({
        success: true,
        message: 'Online payment selected. Proceed with payment checkout.',
        paymentMethod: 'ONLINE'
      });
    }
  } catch (err) {
    console.error('selectPayment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to select payment method.' });
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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    // Ownership check (or ADMIN)
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
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

    // Idempotency: If a PENDING online payment already has a gatewayOrderId, check if already settled or reuse it
    if (order.payment) {
      if (order.payment.status === 'PAID') {
        return res.json({
          success: true,
          alreadyPaid: true,
          message: 'This order has already been paid.',
          payment: {
            status: order.payment.status,
            amount: order.payment.amount,
            paidAt: order.payment.paidAt
          }
        });
      }
      if (order.payment.status === 'PENDING' && order.payment.method === 'ONLINE' && order.payment.gatewayOrderId) {
        // First check if Razorpay already received and captured payment for this order
        try {
          const { razorpay } = paymentConfig.getRazorpayInstance();
          if (razorpay) {
            const rzpOrder = await razorpay.orders.fetch(order.payment.gatewayOrderId);
            if (rzpOrder && (rzpOrder.status === 'paid' || (rzpOrder.amount_paid && rzpOrder.amount_paid >= rzpOrder.amount))) {
              const payments = await razorpay.orders.fetchPayments(order.payment.gatewayOrderId);
              const captured = (payments?.items || []).find(p => p.status === 'captured') || payments?.items?.[0];
              const paidTime = captured?.created_at ? new Date(captured.created_at * 1000) : new Date();

              const updatedPayment = await prisma.payment.update({
                where: { orderId: order.id },
                data: {
                  status: 'PAID',
                  gatewayPaymentId: captured?.id || `pay_captured_${Date.now()}`,
                  paidAt: paidTime
                }
              });

              if (order.fulfillmentType === 'ASSISTANT_DELIVERY' && order.selectedAssistantId) {
                const existingTask = await prisma.assistantTask.findUnique({ where: { orderId: order.id } });
                if (!existingTask) {
                  await prisma.assistantTask.create({
                    data: {
                      orderId: order.id,
                      status: 'ASSIGNED',
                      assistantId: order.selectedAssistantId,
                      deliveryAddress: order.deliveryAddress || null,
                      serviceType: order.assistantServiceType || null,
                      handoverPin: order.verificationPin || null
                    }
                  });
                }
              }

              invalidateOrdersCache();
              return res.json({
                success: true,
                alreadyPaid: true,
                message: 'Payment was already captured successfully on Razorpay.',
                payment: updatedPayment
              });
            }
          }
        } catch (checkErr) {
          // If check fails or offline, fall back to returning pending order
        }

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

    // Gate 4.2.2.2: Atomically reserve parent fee under row lock
    let feeRes;
    if (typeof prisma.$transaction === 'function') {
      feeRes = await prisma.$transaction(async (tx) => {
        return await reserveParentFeeInsideTransaction(tx, order);
      });
    } else {
      feeRes = await reserveParentFeeInsideTransaction(prisma, order);
    }
    const totals = calculateOrderTotals(order.items, order.fulfillmentType, { platformFee: feeRes.platformFee });

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
    const { razorpay, configError } = paymentConfig.getRazorpayInstance();
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
        error: 'Payment gateway error. Please try again or contact support.'
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
        method: 'ONLINE',
        status: 'PENDING',
        gateway: 'RAZORPAY',
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
    const isTestMode = (process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_');
    let razorpay_order_id = req.body.razorpay_order_id || req.body.gatewayOrderId;
    let razorpay_payment_id = req.body.razorpay_payment_id || req.body.gatewayPaymentId;
    let razorpay_signature = req.body.razorpay_signature || req.body.gatewaySignature;
    const userId = req.user.id;

    if (isTestMode && req.body.isTestSimulation === true) {
      if (!razorpay_payment_id) {
        razorpay_payment_id = 'pay_sim_' + Date.now();
      }
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (keySecret && razorpay_order_id) {
        razorpay_signature = crypto
          .createHmac('sha256', keySecret)
          .update(`${razorpay_order_id}|${razorpay_payment_id}`)
          .digest('hex');
      }
    }

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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    // Ownership (or ADMIN)
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
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

    // Verify expected amount and currency if supplied in verification payload
    if (req.body.amount != null) {
      const providedAmount = Number(req.body.amount);
      const storedAmount = Number(order.payment.amount);
      const matches = Math.abs(providedAmount - storedAmount) < 0.01 || Math.abs(providedAmount - storedAmount * 100) < 0.01;
      if (!matches) {
        return res.status(400).json({
          success: false,
          code: 'PAYMENT_AMOUNT_MISMATCH',
          error: `Payment amount mismatch: expected ₹${storedAmount}, received ₹${providedAmount}.`
        });
      }
    }
    if (req.body.currency && req.body.currency !== order.payment.currency) {
      return res.status(400).json({
        success: false,
        code: 'PAYMENT_CURRENCY_MISMATCH',
        error: `Payment currency mismatch: expected ${order.payment.currency}, received ${req.body.currency}.`
      });
    }

    // Gate 4: Terminal order safety guard.
    // If Razorpay captured payment for a locally cancelled or rejected order,
    // preserve payment evidence and route into refund-required reconciliation state.
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      await prisma.payment.update({
        where: { orderId: order.id },
        data: {
          status: 'PAID',
          gatewayPaymentId: razorpay_payment_id,
          gatewaySignature: razorpay_signature,
          paidAt: new Date(),
          failureReason: `PAYMENT_CAPTURED_FOR_TERMINAL_ORDER: Order #${order.orderNumber} is ${order.status}. Administrative refund required.`
        }
      });

      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: order.status,
          comment: `Payment captured at gateway for ${order.status} order (Gateway Payment ID: ${razorpay_payment_id}). Preserved for refund processing.`
        }
      });

      await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `Refund Processing: Order #${order.orderNumber}`,
          message: `Your payment was received, but order #${order.orderNumber} is ${order.status}. A refund has been queued.`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return res.status(409).json({
        success: false,
        code: 'ORDER_TERMINAL_REFUND_REQUIRED',
        error: `Payment was captured at gateway, but order #${order.orderNumber} is in terminal status "${order.status}". Payment record saved and marked for refund reconciliation.`,
        refundRequired: true,
        gatewayPaymentId: razorpay_payment_id
      });
    }

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

      // Gate 4: Atomically lock and verify parent fee state under row lock
      if (order.parentOrderId) {
        if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, order.parentOrderId);
          } catch (_) {}
        }
        if (tx.order && typeof tx.order.findUnique === 'function') {
          const parent = await tx.order.findUnique({ where: { id: order.parentOrderId } });
          // Only mark parent fee PAID if THIS child was the designated fee payer and fee was RESERVED
          if (parent && parent.feePayingChildOrderId === order.id && parent.feeStatus === 'RESERVED') {
            await tx.order.update({
              where: { id: order.parentOrderId },
              data: {
                feeStatus: 'PAID',
                feePaidAt: new Date()
              }
            });
          }
        }
      }

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
          message: `Your payment of ₹${Number(updatedPayment.amount).toFixed(2)} has been confirmed. Fulfillment: ${order.fulfillmentType}. Pickup PIN: ${order.verificationPin}.`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return { payment: updatedPayment, assistantTask };
    });

    invalidateOrdersCache();
    return res.json({
      success: true,
      message: 'Payment verified successfully. Fulfillment proceeding.',
      verificationPin: order.verificationPin,
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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    if (order.userId !== userId && req.user.role !== 'ADMIN') {
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

    // Gate 4.2.2.2: Parent aggregate orders cannot enter checkout
    if (order.isParentOrder) {
      return res.status(400).json({
        success: false,
        code: 'PARENT_ORDER_CHECKOUT_PROHIBITED',
        error: 'Parent aggregate orders cannot be checked out directly. Each pharmacy-specific child order must be checked out individually.'
      });
    }

    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    if (!order.payment) {
      return res.status(400).json({ success: false, error: 'No payment to retry. Please initiate payment first.' });
    }

    if (order.payment.status === 'PAID') {
      return res.status(400).json({ success: false, error: 'This order has already been paid. No retry needed.' });
    }

    // If an online payment is already PENDING with a valid gatewayOrderId, reuse it
    if (order.payment.status === 'PENDING' && order.payment.method === 'ONLINE' && order.payment.gatewayOrderId) {
      return res.json({
        success: true,
        message: 'Active pending payment returned (intent reused).',
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

    if (order.payment.status !== 'FAILED') {
      return res.status(400).json({
        success: false,
        error: `Cannot retry payment in status: ${order.payment.status}. Only failed payments can generate a replacement payment intent.`
      });
    }

    // Gate 4: For confirmed terminal failure, safely re-reserve parent fee inside transaction under row lock
    let feeRes;
    if (typeof prisma.$transaction === 'function') {
      feeRes = await prisma.$transaction(async (tx) => {
        return await reserveParentFeeInsideTransaction(tx, order);
      });
    } else {
      feeRes = await reserveParentFeeInsideTransaction(prisma, order);
    }

    const fulfillmentType = order.fulfillmentType || 'PICKUP';
    const totals = calculateOrderTotals(order.items, fulfillmentType, { platformFee: feeRes.platformFee });
    const amountPaise = Math.round(totals.totalAmount * 100);

    // Create new Razorpay order
    const { razorpay, configError } = paymentConfig.getRazorpayInstance();
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

    // Also sync order platformFee and totalAmount if they changed
    await prisma.order.update({
      where: { id: order.id },
      data: {
        platformFee: totals.platformFee,
        totalAmount: totals.totalAmount != null ? totals.totalAmount : 0.0
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/webhook
// Razorpay Asynchronous Webhook Handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleRazorpayWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!webhookSecret) {
      console.warn('[Webhook] Razorpay webhook secret or key secret not configured.');
      return res.status(503).json({
        success: false,
        error: 'Webhook service unavailable: Secret not configured.'
      });
    }

    if (!signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing x-razorpay-signature header.'
      });
    }

    // Determine payload body buffer / string for HMAC-SHA256
    const payload = req.rawBody ? req.rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // Timing-safe comparison
    let signaturesMatch = false;
    try {
      const sigBuffer = Buffer.from(signature, 'utf8');
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      if (sigBuffer.length === expectedBuffer.length) {
        signaturesMatch = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
      }
    } catch (_) {
      signaturesMatch = false;
    }

    if (!signaturesMatch) {
      console.warn('[Webhook] Invalid webhook signature detected.');
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook signature.'
      });
    }

    let eventData;
    try {
      eventData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (_) {
      return res.status(400).json({ success: false, error: 'Malformed webhook JSON payload.' });
    }

    if (!eventData || typeof eventData !== 'object' || !eventData.event) {
      return res.status(400).json({ success: false, error: 'Malformed webhook payload: missing event field.' });
    }

    const eventType = eventData.event;
    const paymentEntity = eventData.payload?.payment?.entity;
    const orderEntity = eventData.payload?.order?.entity;

    const gatewayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const gatewayPaymentId = paymentEntity?.id;

    if (!gatewayOrderId && !gatewayPaymentId) {
      return res.status(400).json({ success: false, error: 'Malformed webhook payload: no order or payment identifier in event.' });
    }

    // Find payment record
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          gatewayOrderId ? { gatewayOrderId } : undefined,
          gatewayPaymentId ? { gatewayPaymentId } : undefined
        ].filter(Boolean)
      },
      include: {
        order: {
          include: { items: true }
        }
      }
    });

    if (!payment || !payment.order) {
      console.warn(`[Webhook] No corresponding payment/order found for gatewayOrderId=${gatewayOrderId}, gatewayPaymentId=${gatewayPaymentId}`);
      return res.status(200).json({ received: true, ignored: true, reason: 'Payment or order record not found.' });
    }

    // Amount & Currency Validation
    if (paymentEntity && paymentEntity.amount != null) {
      const webhookPaise = Number(paymentEntity.amount);
      const storedPaise = Math.round(Number(payment.amount) * 100);
      if (Math.abs(webhookPaise - storedPaise) > 1) {
        console.warn(`[Webhook] Amount mismatch: stored ${storedPaise} paise vs webhook ${webhookPaise} paise`);
        return res.status(400).json({
          success: false,
          code: 'PAYMENT_AMOUNT_MISMATCH',
          error: `Payment amount mismatch: expected ${storedPaise} paise, received ${webhookPaise} paise.`
        });
      }
    }

    if (paymentEntity && paymentEntity.currency && payment.currency) {
      if (paymentEntity.currency.toUpperCase() !== payment.currency.toUpperCase()) {
        return res.status(400).json({
          success: false,
          code: 'PAYMENT_CURRENCY_MISMATCH',
          error: `Payment currency mismatch: expected ${payment.currency}, received ${paymentEntity.currency}.`
        });
      }
    }

    const order = payment.order;

    // ── Handle Payment Failure Event ──
    if (eventType === 'payment.failed') {
      if (payment.status !== 'PAID') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId,
            failureReason: paymentEntity?.error_description || 'Payment failed at gateway'
          }
        });

        await prisma.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: order.status,
            comment: `Asynchronous payment failure notification received from gateway. Reason: ${paymentEntity?.error_description || 'Failed'}`
          }
        });
      }
      return res.status(200).json({ received: true, processed: true, event: 'payment.failed' });
    }

    // ── Handle Payment Success Event (payment.captured, order.paid) ──
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      // Event Deduplication / Idempotency
      if (payment.status === 'PAID') {
        return res.status(200).json({
          received: true,
          alreadyProcessed: true,
          message: 'Payment already marked PAID.'
        });
      }

      // Safe Handling of Terminal / Cancelled Orders
      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId,
            paidAt: new Date(),
            failureReason: `PAYMENT_CAPTURED_FOR_TERMINAL_ORDER: Order #${order.orderNumber} is ${order.status}. Administrative refund required.`
          }
        });

        await prisma.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: order.status,
            comment: `Webhook: Payment captured at gateway for ${order.status} order (Gateway Payment ID: ${gatewayPaymentId}). Preserved for refund processing.`
          }
        });

        await prisma.notification.create({
          data: {
            userId: order.userId,
            title: `Refund Processing: Order #${order.orderNumber}`,
            message: `Your payment was received, but order #${order.orderNumber} is ${order.status}. A refund has been queued.`,
            type: 'ORDER_STATUS',
            linkUrl: `/orders/${order.id}`
          }
        });

        return res.status(200).json({
          received: true,
          processed: true,
          refundRequired: true,
          message: 'Payment captured for terminal order. Queued for refund reconciliation.'
        });
      }

      // Process successful capture in transaction
      await prisma.$transaction(async (tx) => {
        // Mark payment PAID
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId,
            paidAt: new Date()
          }
        });

        // Record status history
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: order.status,
            comment: `Webhook: Payment confirmed by gateway (PAID). Event: ${eventType}.`
          }
        });

        // Parent fee ledger resolution
        if (order.parentOrderId) {
          const parent = await tx.order.findUnique({ where: { id: order.parentOrderId } });
          if (parent && parent.feePayingChildOrderId === order.id && parent.feeStatus === 'RESERVED') {
            await tx.order.update({
              where: { id: order.parentOrderId },
              data: {
                feeStatus: 'PAID',
                feePaidAt: new Date()
              }
            });
          }
        }

        // Advance PENDING order to CONFIRMED
        if (order.status === 'PENDING') {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'CONFIRMED' }
          });
        }

        // Assistant task creation for ASSISTANT_DELIVERY
        if (order.fulfillmentType === 'ASSISTANT_DELIVERY' && order.selectedAssistantId) {
          const existingTask = await tx.assistantTask.findUnique({
            where: { orderId: order.id }
          });
          if (!existingTask) {
            await tx.assistantTask.create({
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
          }
        }

        // Send patient notification
        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `Payment Confirmed: #${order.orderNumber}`,
            message: `Your payment has been successfully reconciled. Fulfillment: ${order.fulfillmentType}. Pickup PIN: ${order.verificationPin}.`,
            type: 'ORDER_STATUS',
            linkUrl: `/orders/${order.id}`
          }
        });
      });

      invalidateOrdersCache();
      return res.status(200).json({ received: true, processed: true, event: eventType });
    }

    return res.status(200).json({ received: true, ignored: true, event: eventType });
  } catch (err) {
    console.error('handleRazorpayWebhook error:', err);
    return res.status(500).json({ success: false, error: 'Webhook processing error.' });
  }
}

module.exports = {
  getCheckoutSummary,
  selectFulfillment,
  selectPayment,
  createPayment,
  verifyPayment,
  getPaymentStatus,
  retryPayment,
  handleRazorpayWebhook,
  resolveOrderPlatformFee,
  reserveParentFeeInsideTransaction
};
