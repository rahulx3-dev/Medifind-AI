const prisma = require('../prisma');
const { validateAssistantSelection } = require('./assistantController');
const { formatAddressString } = require('./addressController');
const { getFulfillmentFee } = require('../utils/paymentConfig');

// Generate a 4-digit random secure PIN for pickup/handover
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Generate unique order number
function generateOrderNumber() {
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `MF-${timestamp}-${randomSuffix}`;
}

// Create a new reservation or delivery order
async function createOrder(req, res) {
  try {
    const userId = req.user.id || req.user.userId;
    const {
      pharmacyId,
      items, // [{ medicineId, quantity }]
      orderType = 'RESERVATION', // RESERVATION, ASSISTED_DELIVERY, EMERGENCY
      notes,
      prescriptionId,
      deliveryAddress,
      deliveryNotes,
      addressId,
      assistantId,
      selectedAssistantId
    } = req.body;

    const targetAssistantId = assistantId || selectedAssistantId;

    if (!pharmacyId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Pharmacy and at least one item are required.' });
    }

    let resolvedAddress = deliveryAddress;
    if (orderType === 'ASSISTED_DELIVERY') {
      if (addressId) {
        const savedAddr = await prisma.patientAddress.findUnique({ where: { id: addressId } });
        if (!savedAddr || (savedAddr.userId !== userId && req.user.role !== 'ADMIN')) {
          return res.status(400).json({ success: false, error: 'Invalid or unauthorized delivery address selected.' });
        }
        resolvedAddress = formatAddressString(savedAddr);
      } else if (!resolvedAddress || typeof resolvedAddress !== 'string' || resolvedAddress.trim() === '') {
        return res.status(400).json({ success: false, error: 'Delivery address is required for assisted delivery.' });
      }
      const BLOCKED_ADDRESSES = ['test address', 'apollo 24/7', 'care & cure', '123 main st'];
      const lowerAddr = resolvedAddress.toLowerCase().trim();
      if (BLOCKED_ADDRESSES.some(b => lowerAddr === b)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a real delivery address. Placeholder or test addresses are not accepted.'
        });
      }

      if (!targetAssistantId) {
        return res.status(400).json({
          success: false,
          error: 'A specific Medicine Access Assistant must be selected for assisted delivery.'
        });
      }
      const asstVal = await validateAssistantSelection(targetAssistantId, 'MEDICINE_DELIVERY');
      if (!asstVal.valid) {
        return res.status(400).json({ success: false, error: asstVal.error });
      }
    }

    // Verify pharmacy exists and is open
    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      include: { inventory: true }
    });

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    // Safety check: if prescriptionId is provided, verify it exists, belongs to patient, and is VERIFIED
    if (prescriptionId) {
      const rx = await prisma.prescription.findUnique({
        where: { id: prescriptionId }
      });
      if (!rx) {
        return res.status(404).json({ success: false, error: 'Prescription not found.' });
      }
      if (rx.userId !== userId && req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, error: 'Unauthorized: Prescription belongs to another patient.' });
      }
      if (rx.status !== 'VERIFIED') {
        return res.status(400).json({
          success: false,
          error: `Prescription has not been verified yet (current status: ${rx.status}). Please verify detected medicines before placing an order.`
        });
      }
    }

    // Gate pharmacy delivery: only available when the selected pharmacy actually supports delivery
    if (orderType === 'DELIVERY' && !pharmacy.deliveryAvailable) {
      return res.status(400).json({
        success: false,
        error: 'This pharmacy does not offer pharmacy delivery service. Please select Counter Pickup or Medicine Access Assistant.'
      });
    }

    // Calculate item pricing and stock from authoritative inventory (never fabricated fallback prices)
    let medicineSubtotal = 0;
    let allItemsPriced = true;
    const orderItemsData = [];

    for (const item of items) {
      const inventoryItem = pharmacy.inventory.find(inv => inv.medicineId === item.medicineId);
      const hasAuthoritativePrice = Boolean(inventoryItem && inventoryItem.price != null && Number(inventoryItem.price) > 0);
      const unitPrice = hasAuthoritativePrice ? Number(inventoryItem.price.toFixed(2)) : null;
      const qty = item.quantity ? parseInt(item.quantity, 10) : 1;

      let subtotal = null;
      if (unitPrice != null) {
        subtotal = Number((unitPrice * qty).toFixed(2));
        medicineSubtotal += subtotal;
      } else {
        allItemsPriced = false;
      }

      orderItemsData.push({
        medicineId: item.medicineId,
        quantity: qty,
        unitPrice,
        subtotal
      });
    }

    const finalMedicineSubtotal = (allItemsPriced && orderItemsData.length > 0)
      ? Number(medicineSubtotal.toFixed(2))
      : null;
    const deliveryFee = orderType === 'ASSISTED_DELIVERY' ? getFulfillmentFee('ASSISTANT_DELIVERY') : 0.0;
    const finalTotalAmount = Number(((finalMedicineSubtotal != null ? finalMedicineSubtotal : 0.0) + deliveryFee).toFixed(2));

    const orderNumber = generateOrderNumber();
    const verificationPin = generatePin();

    // Create order with items and status history inside a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId,
          pharmacyId,
          status: 'PENDING',
          orderType,
          deliveryAddress: orderType === 'ASSISTED_DELIVERY' ? resolvedAddress.trim() : null,
          addressId: addressId || null,
          selectedAssistantId: targetAssistantId || null,
          medicineSubtotal: finalMedicineSubtotal,
          deliveryFee,
          platformFee: 0.0,
          totalAmount: finalTotalAmount,
          prescriptionId: prescriptionId || null,
          verificationPin,
          notes: notes || null,
          items: {
            create: orderItemsData
          },
          statusHistory: {
            create: [
              {
                status: 'PENDING',
                comment: `Order placed by patient. Type: ${orderType}. Verification PIN generated.`
              }
            ]
          }
        },
        include: {
          items: {
            include: { medicine: true }
          },
          pharmacy: true
        }
      });

      // For direct ASSISTED_DELIVERY orders (Phase 4/5 compatibility), create AssistantTask.
      // For standard RESERVATION orders progressing through Phase 5.5 checkout,
      // AssistantTask is created AFTER payment verification in checkoutController.js.
      if (orderType === 'ASSISTED_DELIVERY') {
        await tx.assistantTask.create({
          data: {
            orderId: newOrder.id,
            status: 'ASSIGNED',
            assistantId: targetAssistantId,
            acceptedAt: null,
            serviceType: 'MEDICINE_DELIVERY',
            deliveryAddress: resolvedAddress.trim(),
            deliveryNotes: deliveryNotes || null,
            serviceNote: deliveryNotes || null,
            handoverPin: verificationPin
          }
        });

        // Notify specifically selected assistant
        if (targetAssistantId) {
          await tx.notification.create({
            data: {
              userId: targetAssistantId,
              title: `New Booking Request: Order #${orderNumber}`,
              message: `A patient has requested you for Medicine Access Assistant service. Please review and accept this request.`,
              type: 'ASSISTANT',
              linkUrl: '/assistant-portal'
            }
          });
        }
      }

      // Notify the patient
      await tx.notification.create({
        data: {
          userId,
          title: `Reservation Submitted: #${orderNumber}`,
          message: `Your reservation request at ${pharmacy.name} has been placed. Verification PIN: ${verificationPin}.`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${newOrder.id}`
        }
      });

      // Notify the pharmacist manager
      if (pharmacy.managerId) {
        await tx.notification.create({
          data: {
            userId: pharmacy.managerId,
            title: `New Reservation Request: #${orderNumber}`,
            message: `New order received from patient (${items.length} items${finalTotalAmount > 0 ? `, Total: ₹${finalTotalAmount.toFixed(2)}` : ''}). Please review and confirm stock.`,
            type: 'ORDER_STATUS',
            linkUrl: `/pharmacist`
          }
        });
      }

      return newOrder;
    });

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      order
    });
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create order.' });
  }
}

// Update order status (Pharmacist, Assistant, or Admin)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;

    const validStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { pharmacy: true, user: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Terminal statuses cannot transition further
    const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot transition further.`
      });
    }

    // Phase 5.5 Safety: Prevent transitioning an already-PAID order to REJECTED or CANCELLED
    // without an active refund mechanism. Applies across all roles (Patient, Pharmacist, Admin).
    if (status === 'REJECTED' || status === 'CANCELLED') {
      const existingPayment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      if (existingPayment && existingPayment.status === 'PAID') {
        return res.status(400).json({
          success: false,
          error: `Cannot ${status.toLowerCase()} an order that has already been paid. Contact the system administrator to initiate a refund process before rejecting or cancelling.`
        });
      }
    }

    // Role-specific authorization checks
    if (req.user.role === 'PATIENT') {
      // 1. Patient can only cancel their OWN order
      if (order.userId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You cannot modify another patient\'s order.' });
      }
      // 2. Patient can ONLY set status to CANCELLED
      if (status !== 'CANCELLED') {
        return res.status(403).json({ success: false, error: 'Patients can only cancel pending reservations.' });
      }
      // 3. Patient can only cancel if order is still PENDING
      if (order.status !== 'PENDING') {
        return res.status(400).json({ success: false, error: `Cannot cancel order in ${order.status} state. Contact the pharmacy.` });
      }
    } else if (req.user.role === 'PHARMACIST') {
      // Pharmacist must manage the pharmacy fulfilling this order
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      if (!managedPharmacy || managedPharmacy.id !== order.pharmacyId) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only manage orders for your own pharmacy.' });
      }

      // Approved transitions for Pharmacist:
      // PENDING -> CONFIRMED, REJECTED
      // CONFIRMED -> READY_FOR_PICKUP, REJECTED
      // READY_FOR_PICKUP -> COMPLETED
      const pharmacistAllowedTransitions = {
        'PENDING': ['CONFIRMED', 'REJECTED'],
        'CONFIRMED': ['READY_FOR_PICKUP', 'REJECTED'],
        'READY_FOR_PICKUP': ['COMPLETED']
      };

      const allowedTransitions = pharmacistAllowedTransitions[order.status] || [];
      if (!allowedTransitions.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid transition. Order in "${order.status}" state cannot transition to "${status}". Allowed: ${allowedTransitions.join(', ') || 'None'}.`
        });
      }
    } else if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({ success: false, error: 'Assistants must update delivery status via assistant task operations.' });
    } else if (req.user.role === 'ADMIN') {
      const adminAllowedTransitions = {
        'PENDING': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
        'CONFIRMED': ['READY_FOR_PICKUP', 'REJECTED', 'CANCELLED'],
        'READY_FOR_PICKUP': ['COMPLETED', 'CANCELLED']
      };
      const allowedTransitions = adminAllowedTransitions[order.status] || [];
      if (!allowedTransitions.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid transition. Order in "${order.status}" state cannot transition to "${status}". Allowed: ${allowedTransitions.join(', ') || 'None'}.`
        });
      }
    } else {
      return res.status(403).json({ success: false, error: 'Unauthorized role.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.update({
        where: { id },
        data: { status },
        include: {
          items: { include: { medicine: true } },
          pharmacy: true,
          statusHistory: { orderBy: { createdAt: 'asc' } }
        }
      });

      // Append history record
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status,
          comment: comment || `Status updated to ${status} by ${req.user.name} (${req.user.role})`
        }
      });

      // If status is CONFIRMED and was previously PENDING, decrement stock
      if (status === 'CONFIRMED' && order.status === 'PENDING') {
        for (const item of order.items) {
          await tx.inventory.updateMany({
            where: {
              pharmacyId: order.pharmacyId,
              medicineId: item.medicineId,
              stock: { gte: item.quantity }
            },
            data: {
              stock: { decrement: item.quantity }
            }
          });
        }
      }

      // If status is CANCELLED or REJECTED and was previously CONFIRMED or READY_FOR_PICKUP, restore decremented stock
      if ((status === 'CANCELLED' || status === 'REJECTED') && (order.status === 'CONFIRMED' || order.status === 'READY_FOR_PICKUP')) {
        for (const item of order.items) {
          await tx.inventory.updateMany({
            where: {
              pharmacyId: order.pharmacyId,
              medicineId: item.medicineId
            },
            data: {
              stock: { increment: item.quantity }
            }
          });
        }
      }

      // If status is CANCELLED or REJECTED, cancel any active/assigned assistantTask
      if (status === 'CANCELLED' || status === 'REJECTED') {
        const existingTask = await tx.assistantTask.findUnique({ where: { orderId: id } });
        if (existingTask && existingTask.status !== 'CONFIRMED' && existingTask.status !== 'CANCELLED') {
          await tx.assistantTask.update({
            where: { id: existingTask.id },
            data: { status: 'CANCELLED' }
          });
          if (existingTask.assistantId) {
            await tx.notification.create({
              data: {
                userId: existingTask.assistantId,
                title: `Task Cancelled: Order #${order.orderNumber}`,
                message: `The order associated with your task has been ${status.toLowerCase()}. The task is now cancelled.`,
                type: 'ASSISTANT',
                linkUrl: '/assistant-portal'
              }
            });
          }
        }
      }

      // Notify the patient
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: `Order Update: #${order.orderNumber}`,
          message: `Your reservation at ${order.pharmacy.name} is now: ${status}. ${comment || ''}`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return ord;
    });

    return res.json({
      success: true,
      message: `Order status updated to ${status}.`,
      order: updated
    });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update order status.' });
  }
}

// Verify pickup PIN at counter
async function verifyOrderPin(req, res) {
  try {
    const { id } = req.params;
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({ success: false, error: 'Verification PIN is required.' });
    }

    // Role check: Only PHARMACIST or ADMIN can verify counter pickup PIN
    if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Counter pickup verification requires Pharmacist role.' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { pharmacy: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Object-level check: Pharmacist can only verify PIN for their own pharmacy
    if (req.user.role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      if (!managedPharmacy || managedPharmacy.id !== order.pharmacyId) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only verify PINs for orders at your own pharmacy.' });
      }
    }

    const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot transition further.`
      });
    }

    if (order.verificationPin !== pin.trim()) {
      return res.status(400).json({ success: false, error: 'Incorrect verification PIN. Please re-check with customer.' });
    }

    // Complete order
    const updated = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.update({
        where: { id },
        data: { status: 'COMPLETED' },
        include: { items: { include: { medicine: true } } }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: 'COMPLETED',
          comment: `Counter pickup verified with correct PIN (${pin}) by ${req.user.name}. Handover complete.`
        }
      });

      await tx.notification.create({
        data: {
          userId: order.userId,
          title: `Prescription Handed Over: #${order.orderNumber}`,
          message: `Thank you for using MediFind AI! Your medicines have been collected from ${order.pharmacy.name}.`,
          type: 'ORDER_STATUS'
        }
      });

      return ord;
    });

    return res.json({
      success: true,
      message: 'PIN verified successfully! Order marked COMPLETED.',
      order: updated
    });
  } catch (err) {
    console.error('verifyOrderPin error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify PIN.' });
  }
}

// Get single order with items and full status history
async function getOrderById(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        pharmacy: true,
        user: {
          select: { id: true, name: true, email: true, phone: true }
        },
        items: {
          include: { medicine: true }
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' }
        },
        assistantTask: {
          include: {
            assistant: {
              select: { id: true, name: true, phone: true }
            }
          }
        },
        payment: {
          select: {
            id: true,
            status: true,
            method: true,
            amount: true,
            currency: true,
            gateway: true,
            gatewayOrderId: true,
            paidAt: true,
            failureReason: true,
            createdAt: true
            // gatewayPaymentId, gatewaySignature: excluded from all role-based gets
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Role-specific ownership checks
    let isAuthorized = false;

    if (req.user.role === 'ADMIN') {
      isAuthorized = true;
    } else if (req.user.role === 'PATIENT') {
      isAuthorized = order.userId === req.user.id;
    } else if (req.user.role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      isAuthorized = managedPharmacy && managedPharmacy.id === order.pharmacyId;
    } else if (req.user.role === 'ASSISTANT') {
      isAuthorized = order.assistantTask && order.assistantTask.assistantId === req.user.id;
    }

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Unauthorized to view this order.' });
    }

    // Role-specific prescription details: Assistant must NEVER receive prescription or clinical details
    let prescriptionDetails = null;
    if (order.prescriptionId && req.user.role !== 'ASSISTANT') {
      const rx = await prisma.prescription.findUnique({
        where: { id: order.prescriptionId },
        select: {
          id: true,
          originalFileName: true,
          status: true,
          screeningStatus: true,
          screeningResult: true,
          createdAt: true
        }
      });
      if (rx) {
        let parsedScreening = null;
        if (rx.screeningResult) {
          try {
            parsedScreening = JSON.parse(rx.screeningResult);
          } catch (_) {}
        }
        prescriptionDetails = {
          id: rx.id,
          originalFileName: rx.originalFileName,
          status: rx.status,
          screeningStatus: rx.screeningStatus,
          screening: parsedScreening,
          createdAt: rx.createdAt
        };
      }
    }

    // PIN data minimization: Only the owning patient receives their own verificationPin.
    // Pharmacist, Assistant, and Admin never receive the raw PIN from GET endpoints.
    const safeOrder = {
      ...order,
      verificationPin: req.user.role === 'PATIENT' ? order.verificationPin : undefined,
      prescription: prescriptionDetails
    };

    // If requester is ASSISTANT, remove prescriptionId, PIN, and sensitive medical data
    if (req.user.role === 'ASSISTANT') {
      delete safeOrder.prescriptionId;
      delete safeOrder.prescription;
      delete safeOrder.verificationPin;
      delete safeOrder.detectedMedicines;
      if (safeOrder.assistantTask) {
        delete safeOrder.assistantTask.handoverPin;
      }
      const NON_ADDRESS_SERVICES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'];
      const svcType = safeOrder.assistantServiceType || safeOrder.assistantTask?.serviceType;
      if (NON_ADDRESS_SERVICES.includes(svcType)) {
        delete safeOrder.deliveryAddress;
        delete safeOrder.addressId;
        if (safeOrder.assistantTask) {
          delete safeOrder.assistantTask.deliveryAddress;
        }
      }
    }

    return res.json({ success: true, order: safeOrder });
  } catch (err) {
    console.error('getOrderById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch order.' });
  }
}

// Get user orders or pharmacy orders
async function getOrders(req, res) {
  try {
    const { role, id: userId } = req.user;
    const { status } = req.query;

    const whereClause = {};
    if (status) whereClause.status = status;

    if (role === 'PATIENT') {
      whereClause.userId = userId;
      whereClause.pharmacy = {
        isVerified: true,
        verificationStatus: 'VERIFIED'
      };
    } else if (role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: userId }
      });
      if (!managedPharmacy) {
        return res.status(403).json({ success: false, error: 'Unauthorized: No pharmacy associated with your account.' });
      }
      whereClause.pharmacyId = managedPharmacy.id;
    } else if (role === 'ASSISTANT') {
      // Assistant only sees orders associated with their assigned tasks
      whereClause.assistantTask = { assistantId: userId };
    } else if (role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized role.' });
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        pharmacy: true,
        user: { select: { id: true, name: true, phone: true } },
        items: { include: { medicine: true } },
        assistantTask: true,
        // Phase 5.5: Safe payment status for list views
        payment: {
          select: {
            id: true,
            status: true,
            method: true,
            amount: true,
            currency: true,
            paidAt: true,
            failureReason: true
            // gatewayPaymentId, gatewaySignature: excluded
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    let prescriptionMap = {};
    if (role !== 'ASSISTANT') {
      const rxIds = [...new Set(orders.map(o => o.prescriptionId).filter(Boolean))];
      if (rxIds.length > 0) {
        const rxs = await prisma.prescription.findMany({
          where: { id: { in: rxIds } },
          select: {
            id: true,
            originalFileName: true,
            status: true,
            screeningStatus: true,
            screeningResult: true
          }
        });
        prescriptionMap = Object.fromEntries(rxs.map(r => [r.id, r]));
      }
    }

    const sanitizedOrders = role === 'ASSISTANT'
      ? orders.map(o => {
          const copy = { ...o };
          delete copy.prescriptionId;
          delete copy.prescription;
          return copy;
        })
      : orders.map(o => ({
          ...o,
          prescription: o.prescriptionId ? (prescriptionMap[o.prescriptionId] || null) : null
        }));

    // PIN data minimization: only the owning PATIENT receives their verificationPin.
    const finalOrders = sanitizedOrders.map(o => ({
      ...o,
      verificationPin: role === 'PATIENT' ? o.verificationPin : undefined
    }));

    return res.json({
      success: true,
      count: finalOrders.length,
      orders: finalOrders
    });
  } catch (err) {
    console.error('getOrders error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch orders.' });
  }
}

// POST /api/orders/:id/confirm-receipt
// Patient confirms receipt of assistant delivery or assistance service
async function confirmReceipt(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Must be patient or admin
    if (req.user.role !== 'PATIENT' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only the ordering patient can confirm receipt.'
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { assistantTask: true, pharmacy: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: This order does not belong to you.' });
    }

    const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot transition further.`
      });
    }

    if (!order.assistantTask) {
      return res.status(400).json({ success: false, error: 'No assistant task associated with this order.' });
    }

    // Task must be in DELIVERED status to be confirmed by patient
    if (order.assistantTask.status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        error: `Cannot confirm receipt. Current assistant task status is "${order.assistantTask.status}". Expected: DELIVERED.`
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.assistantTask.update({
        where: { id: order.assistantTask.id },
        data: {
          status: 'CONFIRMED',
          deliveredAt: order.assistantTask.deliveredAt || new Date()
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED' }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: 'COMPLETED',
          comment: 'Patient confirmed receipt of service. Handover complete.'
        }
      });

      // Notify assigned assistant
      if (order.assistantTask.assistantId) {
        await tx.notification.create({
          data: {
            userId: order.assistantTask.assistantId,
            title: 'Service Receipt Confirmed',
            message: `Patient has confirmed receipt of service for Order #${order.orderNumber}. Task is completed.`,
            type: 'ASSISTANT',
            linkUrl: '/assistant-portal'
          }
        });
      }

      return { order: updatedOrder, task: updatedTask };
    });

    return res.json({
      success: true,
      message: 'Receipt confirmed successfully. Order completed.',
      order: result.order,
      task: result.task
    });
  } catch (err) {
    console.error('confirmReceipt error:', err);
    return res.status(500).json({ success: false, error: 'Failed to confirm receipt.' });
  }
}

module.exports = {
  createOrder,
  updateOrderStatus,
  verifyOrderPin,
  getOrderById,
  getOrders,
  confirmReceipt
};
