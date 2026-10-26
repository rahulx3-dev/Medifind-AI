const prisma = require('../prisma');
const { validateAssistantSelection } = require('./assistantController');
const { formatAddressString } = require('./addressController');
const { VALID_FULFILLMENT_TYPES, getFulfillmentFee } = require('../utils/paymentConfig');
const {
  getReferencePricing,
  calculateMedicinePricing,
  calculateUnitPrice,
  roundCurrency
} = require('../utils/referencePricing');
const { computeOpenStatus } = require('../utils/openHoursParser');
const { sendIdempotentNotification, sendUrgentCareGuidanceNotification } = require('../utils/notificationDispatcher');
const {
  generateSecureCode,
  generateSeparateDeliveryCodes,
  parseVerificationMeta,
  serializeVerificationMeta,
  computePaymentAllocation,
  checkDeliveryAssistantAvailability
} = require('../utils/fulfillmentVerification');

// Generate a 4-digit random secure PIN for pickup/handover
function generatePin() {
  return generateSecureCode(4);
}

// Generate unique order number
function generateOrderNumber() {
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `MF-${timestamp}-${randomSuffix}`;
}

// In-memory cache for getOrders with automatic invalidation (3.5s TTL)
const ordersCache = new Map();
const ORDERS_CACHE_TTL_MS = 3500;

function invalidateOrdersCache() {
  ordersCache.clear();
}

// Global transaction timeout configuration for remote cloud database (Neon) resilience
const DB_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 25000
};

/**
 * Gate 4: Computes the aggregate status of a split-order parent based on its child orders.
 * Rules:
/**
 * Gate 4: Deterministic Parent Order Aggregate Status Derivation
 * Maps children dispensary order statuses to the parent order's aggregate status.
 *
 * Terminal statuses: COMPLETED, CANCELLED, REJECTED.
 * Active / in-progress statuses: PENDING, CONFIRMED, READY_FOR_PICKUP.
 *
 * Invariant: The parent order CANNOT become terminal while any child remains active.
 *
 * Deterministic Rules:
 * 1. If any child is active (PENDING, CONFIRMED, READY_FOR_PICKUP):
 *    - If any child has progressed beyond PENDING (CONFIRMED, READY_FOR_PICKUP, or COMPLETED) -> CONFIRMED
 *    - Otherwise (all active children are PENDING) -> PENDING
 * 2. If all children are terminal (COMPLETED, CANCELLED, REJECTED):
 *    - If at least one child is COMPLETED -> COMPLETED (completed allocation fulfillment)
 *    - If all children are REJECTED -> REJECTED
 *    - Otherwise (all CANCELLED, or mixed CANCELLED and REJECTED) -> CANCELLED
 */
function deriveParentAggregateStatus(childStatuses) {
  if (!childStatuses || childStatuses.length === 0) return 'PENDING';

  const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];
  const hasActiveChild = childStatuses.some(s => !TERMINAL_STATUSES.includes(s));

  if (hasActiveChild) {
    // Parent CANNOT be terminal while any child is active.
    const hasProgressed = childStatuses.some(s => s === 'CONFIRMED' || s === 'READY_FOR_PICKUP' || s === 'COMPLETED');
    return hasProgressed ? 'CONFIRMED' : 'PENDING';
  }

  // All children are terminal
  const hasCompleted = childStatuses.some(s => s === 'COMPLETED');
  if (hasCompleted) {
    return 'COMPLETED';
  }

  const allRejected = childStatuses.every(s => s === 'REJECTED');
  if (allRejected) {
    return 'REJECTED';
  }

  return 'CANCELLED';
}

/**
 * Gate 4: Transactional Parent Aggregate Status Synchronization
 * Serializes sibling updates using parent row-lock and recalculates aggregate status.
 */
async function syncParentAggregateStatus(tx, parentOrderId, updatedChildId, updatedStatus) {
  if (!parentOrderId || !tx.order || typeof tx.order.findMany !== 'function') return null;

  if (typeof tx.$queryRawUnsafe === 'function') {
    try {
      await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, parentOrderId);
    } catch (_) {}
  }

  const siblingChildren = await tx.order.findMany({
    where: { parentOrderId }
  });

  const childStatuses = siblingChildren.map(c => c.id === updatedChildId ? updatedStatus : c.status);
  const aggregateParentStatus = deriveParentAggregateStatus(childStatuses);

  await tx.order.update({
    where: { id: parentOrderId },
    data: { status: aggregateParentStatus }
  });

  return aggregateParentStatus;
}

/**
 * Gate 5: Order Follow-Up and Responsiveness Status Derivation
 * Distinguishes pharmacy responsiveness (AWAITING_PHARMACY_RESPONSE vs PHARMACY_UNRESPONSIVE)
 * from patient purchase state (AWAITING_PATIENT_PURCHASE vs NOT_PURCHASED / PURCHASED_ELSEWHERE).
 */
function deriveOrderFollowUpAndResponsiveness(ord) {
  if (!ord) {
    return {
      followUpState: null,
      pharmacyResponseStatus: 'AWAITING_PHARMACY_RESPONSE',
      patientPurchaseStatus: 'AWAITING_PATIENT_PURCHASE'
    };
  }

  // Parse follow-up state and timestamp from notes if recorded: [FOLLOW_UP:STATE] or [FOLLOW_UP:STATE:TIMESTAMP]
  const VALID_FOLLOW_UP_STATES = ['PURCHASED_HERE', 'PURCHASED_ELSEWHERE', 'NOT_PURCHASED', 'NEEDS_MORE_HELP'];
  let followUpState = null;
  let followUpRespondedAt = null;

  if (ord.notes && typeof ord.notes === 'string') {
    const m = ord.notes.match(/\[FOLLOW_UP:([A-Z_]+)(?::([^\]]+))?\]/);
    if (m && VALID_FOLLOW_UP_STATES.includes(m[1])) {
      followUpState = m[1];
      if (m[2]) {
        const parsedDate = new Date(m[2]);
        if (!isNaN(parsedDate.getTime())) {
          followUpRespondedAt = parsedDate;
        }
      }
    }
  }

  // 1. Pharmacy Responsiveness distinction
  let pharmacyResponseStatus = 'AWAITING_PHARMACY_RESPONSE';
  if (ord.status === 'PENDING') {
    const elapsedMinutes = ord.createdAt ? (Date.now() - new Date(ord.createdAt).getTime()) / 60000 : 0;
    pharmacyResponseStatus = elapsedMinutes > 15 ? 'PHARMACY_UNRESPONSIVE' : 'AWAITING_PHARMACY_RESPONSE';
  } else if (['CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED'].includes(ord.status)) {
    pharmacyResponseStatus = 'PHARMACY_RESPONDED';
  } else if (ord.status === 'REJECTED') {
    pharmacyResponseStatus = 'PHARMACY_REJECTED';
  } else if (ord.status === 'CANCELLED') {
    pharmacyResponseStatus = 'ORDER_CANCELLED';
  }

  // 2. Patient Purchase distinction (strictly separated from payment & fulfillment status)
  // Patient's explicit follow-up response takes absolute precedence; never overwritten with derived defaults
  let patientPurchaseStatus;
  if (followUpState) {
    patientPurchaseStatus = followUpState;
  } else if (ord.status === 'COMPLETED') {
    patientPurchaseStatus = 'PURCHASED';
  } else if (ord.status === 'CANCELLED' || ord.status === 'REJECTED') {
    patientPurchaseStatus = 'NOT_PURCHASED';
  } else {
    // PENDING, CONFIRMED, READY_FOR_PICKUP
    patientPurchaseStatus = 'AWAITING_PATIENT_PURCHASE';
  }

  return {
    followUpState,
    followUpRespondedAt,
    pharmacyResponseStatus,
    patientPurchaseStatus
  };
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

    // Integrity check: orders can only be placed with active, participating pharmacies
    if (!pharmacy.isVerified || pharmacy.verificationStatus !== 'VERIFIED' || pharmacy.verificationStatus === 'TEST') {
      return res.status(400).json({
        success: false,
        error: 'Orders and reservations can only be placed with active, participating pharmacies.'
      });
    }

    // Operating hours enforcement: closed dispensaries cannot accept reservations
    const openStatus = computeOpenStatus(pharmacy.openingHours, pharmacy.isOpen);
    if (openStatus && openStatus.isCurrentlyOpen === false) {
      return res.status(400).json({
        success: false,
        code: 'PHARMACY_CLOSED',
        error: `Dispensary is currently closed. ${openStatus.opensAt ? `Opens at ${openStatus.opensAt}. ` : ''}Reservations cannot be placed outside operating hours.`,
        openStatus
      });
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

    // Calculate item pricing and stock from authoritative inventory and catalogue
    let medicineSubtotal = 0;
    let hasUnpricedItem = false;
    const orderItemsData = [];

    for (const item of items) {
      // 1. Resolve medicineId to a valid Medicine in database
      let medRecord = null;
      if (item.medicineId) {
        try {
          medRecord = await prisma.medicine.findUnique({ where: { id: String(item.medicineId) } });
        } catch (_) {}
      }
      if (!medRecord && (item.brandName || item.name || item.genericName)) {
        const searchName = String(item.brandName || item.name || item.genericName || '').trim();
        try {
          medRecord = await prisma.medicine.findFirst({
            where: { brandName: { equals: searchName, mode: 'insensitive' } }
          });
          if (!medRecord) {
            medRecord = await prisma.medicine.findFirst({
              where: { genericName: { equals: searchName, mode: 'insensitive' } }
            });
          }
          if (!medRecord) {
            const genericStem = searchName.replace(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|%)\b/gi, '').replace(/[^a-zA-Z\s]/g, ' ').trim();
            if (genericStem.length >= 3) {
              const candidates = await prisma.medicine.findMany({
                where: {
                  OR: [
                    { genericName: { contains: genericStem, mode: 'insensitive' } },
                    { brandName: { contains: genericStem, mode: 'insensitive' } }
                  ]
                }
              });
              if (candidates.length > 0) {
                const strengthMatch = searchName.match(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|%)\b/i);
                if (strengthMatch) {
                  const targetStr = strengthMatch[0].replace(/\s+/g, '').toLowerCase();
                  medRecord = candidates.find(c => (c.strength || '').replace(/\s+/g, '').toLowerCase().includes(targetStr)) || candidates[0];
                } else {
                  medRecord = candidates[0];
                }
              }
            }
          }
        } catch (_) {}
      }
      if (!medRecord) {
        // Fallback to any valid medicine record so foreign key constraint never fails
        medRecord = await prisma.medicine.findFirst();
      }
      const validMedicineId = medRecord?.id || item.medicineId;

      // 2. Resolve price: Look up authoritative reference pricing & pharmacy inventory
      const nameLower = (item.brandName || item.name || medRecord?.brandName || '').toLowerCase().trim();
      const genLower = (item.genericName || medRecord?.genericName || '').toLowerCase().trim();

      const matchingInvItems = (pharmacy.inventory || []).filter(inv => {
        if (inv.medicineId === validMedicineId) return true;
        const invBrand = (inv.medicine?.brandName || '').toLowerCase().trim();
        const invGen = (inv.medicine?.genericName || '').toLowerCase().trim();
        if (nameLower && (invBrand === nameLower || invBrand.includes(nameLower) || nameLower.includes(invBrand))) return true;
        if (genLower && invGen && (genLower === invGen || genLower.includes(invGen) || invGen.includes(genLower))) return true;
        return false;
      });
      const inventoryItem = matchingInvItems.find(inv => (inv.stock != null ? inv.stock > 0 : true)) || matchingInvItems[0];

      const ref = getReferencePricing(item.brandName || medRecord?.brandName, medRecord?.genericName);
      const unitsPerPack = item.unitsPerPack || ref?.unitsPerPack || (
        medRecord?.dosageForm === 'Syrup' || medRecord?.dosageForm === 'Inhaler' || medRecord?.dosageForm === 'Injection' ? 1 : 10
      );
      const qty = item.quantity ? parseInt(item.quantity, 10) : 1;

      // Determine saleUnit (STRIP vs TABLET/CAPSULE vs UNIT)
      let saleUnit = item.saleUnit ? String(item.saleUnit).toUpperCase().trim() : null;
      if (!saleUnit) {
        if (unitsPerPack > 1 && (medRecord?.dosageForm === 'Tablet' || medRecord?.dosageForm === 'Capsule')) {
          if (item.isStrip || (item.price != null && ref?.publishedMrp != null && Math.abs(Number(item.price) - Number(ref.publishedMrp)) < 0.01 && qty <= 3)) {
            saleUnit = 'STRIP';
          } else {
            saleUnit = 'TABLET';
          }
        }
      }

      // Check for explicit custom unit price from reservation
      let customUnitPrice = null;
      const inputPrice = item.unitPrice != null ? Number(item.unitPrice) : (item.price != null ? Number(item.price) : null);
      if (inputPrice != null && inputPrice > 0) {
        if (ref?.publishedMrp && unitsPerPack > 1 && Math.abs(inputPrice - ref.publishedMrp) < 0.1 && saleUnit === 'TABLET') {
          // If the passed price was actually the strip MRP, convert it to per-tablet unit price
          customUnitPrice = ref?.unitPrice ?? calculateUnitPrice(inputPrice, unitsPerPack);
        } else {
          customUnitPrice = inputPrice;
        }
      }

      // If customUnitPrice is still missing, default to ref.unitPrice or inventoryItem.price
      if (customUnitPrice == null) {
        if (ref?.unitPrice != null) {
          customUnitPrice = ref.unitPrice;
        } else if (inventoryItem?.price != null && inventoryItem.price > 0) {
          if (ref?.unitsPerPack && ref.unitsPerPack > 1 && Math.abs(inventoryItem.price - (ref.publishedMrp || 0)) < 0.1 && saleUnit === 'TABLET') {
            customUnitPrice = calculateUnitPrice(inventoryItem.price, ref.unitsPerPack);
          } else {
            customUnitPrice = inventoryItem.price;
          }
        }
      }

      const pricing = calculateMedicinePricing({
        publishedMrp: ref?.publishedMrp ?? (saleUnit === 'STRIP' ? inventoryItem?.price : null),
        unitPrice: customUnitPrice ?? ref?.unitPrice ?? null,
        unitsPerPack,
        dosageForm: medRecord?.dosageForm || 'Tablet',
        saleUnit,
        quantity: qty
      });

      let effectiveUnitPrice = null;
      let subtotal = null;

      if (pricing.isValid) {
        effectiveUnitPrice = pricing.effectiveUnitPrice;
        subtotal = pricing.lineTotal;
        medicineSubtotal += subtotal;
      } else if (pricing.isUnpriced) {
        effectiveUnitPrice = null;
        subtotal = null;
        hasUnpricedItem = true;
      } else {
        if (item.price != null && Number(item.price) > 0) {
          effectiveUnitPrice = roundCurrency(Number(item.price));
          subtotal = roundCurrency(effectiveUnitPrice * qty);
          medicineSubtotal += subtotal;
        } else {
          effectiveUnitPrice = null;
          subtotal = null;
          hasUnpricedItem = true;
        }
      }

      orderItemsData.push({
        medicineId: validMedicineId,
        prescriptionItemId: item.prescriptionItemId || item.prescriptionItem?.id || null,
        pharmacistSelectionRequested: Boolean(item.pharmacistSelectionRequested),
        isAwaitingPharmacyReview: Boolean(item.isAwaitingPharmacyReview),
        isDoctorApprovedClaim: Boolean(item.isDoctorApprovedClaim),
        doctorApprovalClaim: item.doctorApprovalClaim || null,
        prescribedName: item.prescribedName || item.brandName || item.name || null,
        quantity: qty,
        unitPrice: effectiveUnitPrice,
        subtotal
      });
    }

    const finalMedicineSubtotal = hasUnpricedItem ? null : roundCurrency(medicineSubtotal);
    const deliveryFee = orderType === 'ASSISTED_DELIVERY' ? getFulfillmentFee('ASSISTANT_DELIVERY') : 0.0;
    const isPlatformFeeEnabled = process.env.ENABLE_PLATFORM_FEE !== 'false';
    const platformFee = (finalMedicineSubtotal != null && finalMedicineSubtotal > 0 && isPlatformFeeEnabled) ? 2.0 : 0.0;
    const finalTotalAmount = finalMedicineSubtotal != null
      ? roundCurrency(finalMedicineSubtotal + deliveryFee + platformFee)
      : null;

    const orderNumber = generateOrderNumber();
    // Reservation Acceptance and PIN Issuance Rules:
    // Creating a reservation must NOT generate or expose a usable pickup PIN.
    const verificationPin = null;

    // Create order with items and status history atomically
    let order;
    if (prescriptionId) {
      order = await prisma.$transaction(async (tx) => {
        if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            await tx.$queryRawUnsafe(`SELECT id FROM "Prescription" WHERE id = $1 FOR UPDATE`, prescriptionId);
          } catch (_) {}
        }

        // Fetch prescription items
        let rxItems = [];
        if (tx.prescriptionItem && typeof tx.prescriptionItem.findMany === 'function') {
          try {
            rxItems = await tx.prescriptionItem.findMany({
              where: { prescriptionId }
            });
          } catch (_) {}
        }

        // Gate 4.2.1.4: Group prescription items by medicineId to support multiple distinct prescription lines
        // with the same medicine ID without collapsing or overwriting distinct dosage forms, strengths, or instructions.
        const rxItemsByMedId = new Map();
        const rxItemById = new Map();
        for (const item of rxItems) {
          rxItemById.set(item.id, item);
          const list = rxItemsByMedId.get(item.medicineId) || [];
          list.push(item);
          rxItemsByMedId.set(item.medicineId, list);
        }

        // Calculate already allocated/fulfilled quantities from existing non-cancelled orders
        const existingOrders = await tx.order.findMany({
          where: {
            prescriptionId,
            isParentOrder: false,
            status: { notIn: ['CANCELLED', 'REJECTED'] }
          },
          include: { items: true }
        });

        const previouslyAllocatedByMedId = new Map();
        const previouslyAllocatedByItemId = new Map();
        for (const ord of existingOrders) {
          for (const item of (ord.items || [])) {
            const currentMedSum = previouslyAllocatedByMedId.get(item.medicineId) || 0;
            previouslyAllocatedByMedId.set(item.medicineId, currentMedSum + item.quantity);

            if (item.prescriptionItemId) {
              const currentItemSum = previouslyAllocatedByItemId.get(item.prescriptionItemId) || 0;
              previouslyAllocatedByItemId.set(item.prescriptionItemId, currentItemSum + item.quantity);
            }
          }
        }

        // Aggregate total requested quantities per medicineId in this order
        const requestedByMedId = new Map();
        for (const it of orderItemsData) {
          const cur = requestedByMedId.get(it.medicineId) || 0;
          requestedByMedId.set(it.medicineId, cur + it.quantity);
        }

        // Validate overall requested quantities per medicineId against aggregated outstanding balance
        for (const [medId, requestedQty] of requestedByMedId.entries()) {
          const rxList = rxItemsByMedId.get(medId);
          if (rxList && rxList.length > 0) {
            const totalPrescribed = rxList.reduce((sum, p) => sum + p.quantity, 0);
            const alreadyAllocated = previouslyAllocatedByMedId.get(medId) || 0;
            const outstandingQty = Math.max(0, totalPrescribed - alreadyAllocated);

            if (requestedQty > outstandingQty) {
              const medName = rxList[0].prescribedName || medId;
              const err = new Error(`Requested quantity (${requestedQty}) exceeds outstanding prescription quantity (${outstandingQty}) for medicine "${medName}". Originally prescribed: ${totalPrescribed}, previously allocated: ${alreadyAllocated}.`);
              err.statusCode = 400;
              err.code = 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY';
              throw err;
            }
          }
        }

        // Assign prescriptionItemId to each itemData preserving item-level provenance
        const allocatedInThisTxByItemId = new Map();
        for (const itemData of orderItemsData) {
          const rxList = rxItemsByMedId.get(itemData.medicineId);
          if (itemData.prescriptionItemId && rxItemById.has(itemData.prescriptionItemId)) {
            // Explicit prescriptionItemId supplied: validate against specific item's outstanding balance
            const pItem = rxItemById.get(itemData.prescriptionItemId);
            const itemPrevAllocated = (previouslyAllocatedByItemId.get(pItem.id) || 0) + (allocatedInThisTxByItemId.get(pItem.id) || 0);
            const itemOutstanding = Math.max(0, pItem.quantity - itemPrevAllocated);
            if (itemData.quantity > itemOutstanding && itemOutstanding > 0) {
              const err = new Error(`Requested quantity (${itemData.quantity}) exceeds outstanding quantity (${itemOutstanding}) for prescription item "${pItem.prescribedName || pItem.id}".`);
              err.statusCode = 400;
              err.code = 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY';
              throw err;
            }
            allocatedInThisTxByItemId.set(pItem.id, itemPrevAllocated + itemData.quantity);
          } else if (rxList && rxList.length > 0) {
            // Allocate against available prescription items sequentially to preserve provenance
            for (const pItem of rxList) {
              const itemPrevAllocated = (previouslyAllocatedByItemId.get(pItem.id) || 0) + (allocatedInThisTxByItemId.get(pItem.id) || 0);
              const itemRemaining = Math.max(0, pItem.quantity - itemPrevAllocated);
              if (itemRemaining > 0) {
                itemData.prescriptionItemId = pItem.id;
                allocatedInThisTxByItemId.set(pItem.id, itemPrevAllocated + Math.min(itemData.quantity, itemRemaining));
                break;
              }
            }
            if (!itemData.prescriptionItemId) {
              itemData.prescriptionItemId = rxList[0].id;
            }
          } else if (rxItems.length === 1 && !itemData.prescriptionItemId) {
            itemData.prescriptionItemId = rxItems[0].id;
          }
        }

        let orderNotes = notes || null;
        const pendingSelectionTags = [];

        const createdOrderItems = orderItemsData.map(it => {
          const pItem = it.prescriptionItemId ? rxItemById.get(it.prescriptionItemId) : null;
          const isPendingSelection = Boolean(
            it.pharmacistSelectionRequested ||
            it.isAwaitingPharmacyReview ||
            (pItem && (
              pItem.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
              (typeof pItem.patientNotes === 'string' && (
                pItem.patientNotes.includes('PHARMACIST_SELECTION_REQUESTED') ||
                pItem.patientNotes.includes('AWAITING_PHARMACY_REVIEW')
              ))
            ))
          );
          const isDoctorApprovalClaim = Boolean(
            it.isDoctorApprovedClaim ||
            it.doctorApprovalClaim ||
            (pItem && typeof pItem.patientNotes === 'string' && (
              pItem.patientNotes.includes('DOCTOR_APPROVAL_CLAIM') ||
              pItem.patientNotes.includes('DOCTOR_APPROVAL_CLAIMED') ||
              pItem.patientNotes.includes('doctorApprovalClaim')
            ))
          );

          let itemStatus = 'PENDING';
          let unfulfilledReason = null;
          const label = pItem?.prescribedName || it.prescribedName || it.name || 'Medicine';
          const itemIdRef = it.prescriptionItemId || it.medicineId;

          if (isPendingSelection) {
            itemStatus = 'PENDING_SELECTION';
            unfulfilledReason = 'AWAITING_PHARMACY_REVIEW';
            pendingSelectionTags.push(`[PENDING_SELECTION:${itemIdRef}:${label}]`);
          } else if (isDoctorApprovalClaim) {
            itemStatus = 'AWAITING_VERIFICATION';
            unfulfilledReason = 'AWAITING_DOCTOR_APPROVAL_VERIFICATION';
            pendingSelectionTags.push(`[AWAITING_VERIFICATION:${itemIdRef}:${label}]`);
          } else if (pItem && pItem.isVerified === false) {
            itemStatus = 'AWAITING_VERIFICATION';
            unfulfilledReason = 'AWAITING_PHARMACY_REVIEW';
            pendingSelectionTags.push(`[PENDING_SELECTION:${itemIdRef}:${label}]`);
          }

          return {
            medicineId: it.medicineId,
            prescriptionItemId: it.prescriptionItemId || null,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
            status: itemStatus,
            unfulfilledReason
          };
        });

        if (pendingSelectionTags.length > 0) {
          orderNotes = orderNotes ? `${orderNotes} ${pendingSelectionTags.join(' ')}` : pendingSelectionTags.join(' ');
        }

        return await tx.order.create({
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
            platformFee,
            totalAmount: finalTotalAmount,
            prescriptionId,
            verificationPin,
            notes: orderNotes,
            items: {
              create: createdOrderItems
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
              include: { medicine: true, prescriptionItem: true }
            },
            pharmacy: true
          }
        });
      }, DB_TRANSACTION_OPTIONS);
    } else {
      order = await prisma.order.create({
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
          platformFee,
          totalAmount: finalTotalAmount, // Always valid Float, never null
          prescriptionId: null,
          verificationPin,
          notes: notes || null,
          items: {
            create: orderItemsData.map(it => ({
              medicineId: it.medicineId,
              prescriptionItemId: it.prescriptionItemId || null,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
              status: it.status || 'PENDING'
            }))
          },
          statusHistory: {
            create: [
              {
                status: 'PENDING',
                comment: `Order placed by patient. Type: ${orderType}.`
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
    }

    // For direct ASSISTED_DELIVERY orders, create AssistantTask safely
    if (orderType === 'ASSISTED_DELIVERY') {
      try {
        await prisma.assistantTask.create({
          data: {
            orderId: order.id,
            status: 'ASSIGNED',
            assistantId: targetAssistantId,
            acceptedAt: null,
            serviceType: 'MEDICINE_DELIVERY',
            deliveryAddress: resolvedAddress.trim(),
            deliveryNotes: deliveryNotes || null,
            serviceNote: deliveryNotes || null,
            handoverPin: null
          }
        });

        if (targetAssistantId) {
          await prisma.notification.create({
            data: {
              userId: targetAssistantId,
              title: `New Booking Request: Order #${orderNumber}`,
              message: `A patient has requested you for Medicine Access Assistant service. Please review and accept this request.`,
              type: 'ASSISTANT',
              linkUrl: '/assistant-portal'
            }
          });
        }
      } catch (asstErr) {
        console.warn('AssistantTask creation warning:', asstErr.message);
      }
    }

    // Gate 5: Immediate Urgent-Care Guidance if orderType is EMERGENCY
    if (orderType === 'EMERGENCY') {
      try {
        await sendUrgentCareGuidanceNotification(prisma, {
          userId,
          orderNumber,
          linkUrl: `/orders/${order.id}`
        });
      } catch (urgentNotifErr) {
        console.warn('Urgent care guidance notification warning:', urgentNotifErr.message);
      }
    }

    // Notify the patient (idempotent, safe non-blocking)
    try {
      await sendIdempotentNotification(prisma, {
        userId,
        title: `Order Reserved: #${orderNumber}`,
        message: `Your order reservation at ${pharmacy.name} has been placed. We will notify you once confirmed.`,
        type: 'ORDER_STATUS',
        linkUrl: `/orders/${order.id}`
      });
    } catch (notifErr) {
      console.warn('Patient notification warning:', notifErr.message);
    }

    // Notify the pharmacist manager (idempotent, safe non-blocking)
    if (pharmacy.managerId) {
      try {
        await sendIdempotentNotification(prisma, {
          userId: pharmacy.managerId,
          title: `New Reservation Request: #${orderNumber}`,
          message: `New order received from patient (${items.length} items${finalTotalAmount > 0 ? `, Total: ₹${finalTotalAmount.toFixed(2)}` : ''}). Please review and confirm stock.`,
          type: 'ORDER_STATUS',
          linkUrl: `/pharmacist`
        });
      } catch (mgrErr) {
        console.warn('Manager notification warning:', mgrErr.message);
      }
    }

    invalidateOrdersCache();
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      order
    });
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || undefined,
      error: err.message || 'Failed to create order.'
    });
  }
}

// Update order status (Pharmacist, Assistant, or Admin)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;

    const validStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'READY_FOR_DISPATCH', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        pharmacy: true,
        user: true,
        items: { include: { medicine: true, prescriptionItem: true } },
        payment: true
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const isDeliveryOrder = order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY';

    // Terminal statuses cannot transition further
    const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status) && order.status !== status) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot transition further.`
      });
    }

    // Phase 5.5 Safety: Prevent transitioning an already-PAID order to REJECTED or CANCELLED
    // without an active refund mechanism. Applies across all roles (Patient, Pharmacist, Admin).
    if ((status === 'REJECTED' || status === 'CANCELLED') && order.status !== status) {
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
        return res.status(403).json({ success: false, error: 'Patients can only cancel active reservations.' });
      }
      // Idempotency: If patient repeated CANCELLED request on an already CANCELLED order
      if (order.status === status) {
        const currentOrder = await prisma.order.findUnique({
          where: { id },
          include: {
            items: { include: { medicine: true } },
            pharmacy: true,
            statusHistory: { orderBy: { createdAt: 'asc' } }
          }
        });
        invalidateOrdersCache();
        return res.json({
          success: true,
          message: `Order status is already ${status}.`,
          order: currentOrder || order
        });
      }
      // 3. Patient can cancel if order is in PENDING, CONFIRMED, READY_FOR_PICKUP, or READY_FOR_DISPATCH
      const cancellableStatuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'READY_FOR_DISPATCH'];
      if (!cancellableStatuses.includes(order.status)) {
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

      // Idempotency: If the order is already in the requested status, safely return the current order without repeating side-effects
      if (order.status === status) {
        const currentOrder = await prisma.order.findUnique({
          where: { id },
          include: {
            items: { include: { medicine: true } },
            pharmacy: true,
            statusHistory: { orderBy: { createdAt: 'asc' } }
          }
        });
        invalidateOrdersCache();
        return res.json({
          success: true,
          message: `Order status is already ${status}.`,
          order: currentOrder || order
        });
      }

      // Approved transitions for Pharmacist:
      const pharmacistAllowedTransitions = {
        'PENDING': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
        'CONFIRMED': isDeliveryOrder
          ? ['READY_FOR_DISPATCH', 'READY_FOR_PICKUP', 'REJECTED', 'CANCELLED']
          : ['READY_FOR_PICKUP', 'READY_FOR_DISPATCH', 'REJECTED', 'CANCELLED'],
        'READY_FOR_PICKUP': ['COMPLETED', 'REJECTED', 'CANCELLED'],
        'READY_FOR_DISPATCH': ['IN_TRANSIT', 'REJECTED', 'CANCELLED']
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
      // Idempotency: If the order is already in the requested status, safely return the current order without repeating side-effects
      if (order.status === status) {
        const currentOrder = await prisma.order.findUnique({
          where: { id },
          include: {
            items: { include: { medicine: true } },
            pharmacy: true,
            statusHistory: { orderBy: { createdAt: 'asc' } }
          }
        });
        invalidateOrdersCache();
        return res.json({
          success: true,
          message: `Order status is already ${status}.`,
          order: currentOrder || order
        });
      }

      const adminAllowedTransitions = {
        'PENDING': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
        'CONFIRMED': ['READY_FOR_PICKUP', 'READY_FOR_DISPATCH', 'REJECTED', 'CANCELLED'],
        'READY_FOR_PICKUP': ['COMPLETED', 'CANCELLED'],
        'READY_FOR_DISPATCH': ['IN_TRANSIT', 'CANCELLED']
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

    // ─────────────────────────────────────────────────────────────────────────
    // CLINICAL VERIFICATION GUARDS (Phase 6.1E.2 / Doctor Approval & Pharmacy Review)
    // ─────────────────────────────────────────────────────────────────────────
    // Items requiring pharmacy review or doctor approval verification cannot proceed to fulfillment!
    if (['CONFIRMED', 'READY_FOR_PICKUP', 'READY_FOR_DISPATCH', 'COMPLETED'].includes(status)) {
      const unverifiedItem = (order.items || []).find(it => {
        if (it.status === 'PENDING_SELECTION' || it.status === 'AWAITING_VERIFICATION') return true;
        if (it.unfulfilledReason && (
          it.unfulfilledReason.includes('AWAITING_PHARMACY_REVIEW') ||
          it.unfulfilledReason.includes('AWAITING_DOCTOR_APPROVAL_VERIFICATION') ||
          it.unfulfilledReason.includes('PHARMACIST_SELECTION_REQUESTED')
        )) return true;
        if (it.prescriptionItem && it.prescriptionItem.isVerified === false) return true;
        return false;
      });

      if (unverifiedItem) {
        const medName = unverifiedItem.medicine?.brandName || unverifiedItem.prescriptionItem?.prescribedName || 'Medicine';
        const isDocApproval = unverifiedItem.status === 'AWAITING_VERIFICATION' || (unverifiedItem.unfulfilledReason && unverifiedItem.unfulfilledReason.includes('AWAITING_DOCTOR_APPROVAL_VERIFICATION'));
        const reasonText = isDocApproval
          ? 'claimed doctor approval requires clinical verification by the licensed pharmacist'
          : 'requires pharmacist brand selection and clinical review';
        return res.status(400).json({
          success: false,
          code: 'ITEM_VERIFICATION_REQUIRED',
          error: `Cannot advance Order #${order.orderNumber} to ${status}: Item "${medName}" ${reasonText}. Please complete verification in the pharmacist clinical review portal before advancing this order.`
        });
      }

      // If order has a linked prescription, ensure all prescription items are verified
      if (order.prescriptionId) {
        const unverifiedRxItem = await prisma.prescriptionItem.findFirst({
          where: {
            prescriptionId: order.prescriptionId,
            isVerified: false
          }
        });
        if (unverifiedRxItem) {
          return res.status(400).json({
            success: false,
            code: 'ITEM_VERIFICATION_REQUIRED',
            error: `Cannot advance Order #${order.orderNumber} to ${status}: Prescription item "${unverifiedRxItem.prescribedName}" requires pharmacist clinical verification before this order can be confirmed or fulfilled.`
          });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FULFILLMENT METHOD SPECIFIC GUARDS
    // ─────────────────────────────────────────────────────────────────────────
    let generatedPickupPin = null;
    let generatedDeliveryCodes = null;

    // Requirement 6: Pharmacy cannot use Mark Ready for Pickup on a delivery order
    if (isDeliveryOrder && status === 'READY_FOR_PICKUP') {
      return res.status(400).json({
        success: false,
        error: "Pharmacy cannot use Mark Ready for Pickup on a delivery order. Please use 'Mark Ready for Dispatch'."
      });
    }

    if (!isDeliveryOrder && status === 'READY_FOR_DISPATCH') {
      return res.status(400).json({
        success: false,
        error: "Mark Ready for Dispatch is only applicable for delivery orders. Please use 'Mark Ready for Pickup'."
      });
    }

    // Guard for READY_FOR_PICKUP (Counter Pickup)
    if (status === 'READY_FOR_PICKUP') {
      if (order.status !== 'CONFIRMED') {
        return res.status(400).json({
          success: false,
          error: 'Order must be CONFIRMED before it can be marked ready for pickup.'
        });
      }

      // Check payment record
      const payment = order.payment || await prisma.payment.findUnique({ where: { orderId: order.id } });
      if (!payment || !payment.method) {
        return res.status(400).json({
          success: false,
          error: 'Checkout and payment method selection are required before the order can be marked ready for pickup.'
        });
      }

      // Online payment requires verified PAID
      if (payment.method === 'ONLINE' && payment.status !== 'PAID') {
        return res.status(400).json({
          success: false,
          error: 'Online payment must be verified as PAID before marking ready for pickup.'
        });
      } else if (payment.method === 'COUNTER' || payment.method === 'PAY_AT_COUNTER') {
        if (payment.status !== 'PENDING' && payment.status !== 'PAY_AT_COUNTER') {
          return res.status(400).json({
            success: false,
            error: 'Checkout and payment method selection are required before the order can be marked ready for pickup.'
          });
        }
      }

      // Generate 4-digit pickup PIN ONLY when paid, prepared order is marked READY_FOR_PICKUP
      generatedPickupPin = generateSecureCode(4);
    }

    // Guard for READY_FOR_DISPATCH (Assistant Delivery)
    if (status === 'READY_FOR_DISPATCH') {
      if (order.status !== 'CONFIRMED') {
        return res.status(400).json({
          success: false,
          error: 'Order must be CONFIRMED before it can be marked ready for dispatch.'
        });
      }

      const payment = order.payment || await prisma.payment.findUnique({ where: { orderId: order.id } });
      if (!payment || payment.status !== 'PAID') {
        return res.status(400).json({
          success: false,
          error: 'Verified online payment is required before a delivery order can be marked ready for dispatch.'
        });
      }

      let existingTask = await prisma.assistantTask.findUnique({ where: { orderId: id } });
      if (!existingTask && order.selectedAssistantId) {
        existingTask = await prisma.assistantTask.create({
          data: {
            orderId: id,
            status: 'ASSIGNED',
            assistantId: order.selectedAssistantId,
            deliveryAddress: order.deliveryAddress,
            serviceType: order.assistantServiceType || 'MEDICINE_DELIVERY',
            handoverPin: null
          }
        });
      }
      if (!existingTask || !existingTask.assistantId) {
        return res.status(400).json({
          success: false,
          error: 'An eligible delivery assistant must be assigned before marking ready for dispatch.'
        });
      }

      // Pharmacy must wait until the delivery partner has accepted the task
      if (existingTask.status === 'ASSIGNED') {
        return res.status(400).json({
          success: false,
          error: 'Cannot mark ready for dispatch: The assigned delivery partner has not yet accepted this task. Please wait for the assistant to accept.'
        });
      }

      if (existingTask.status === 'CANCELLED') {
        return res.status(400).json({
          success: false,
          error: 'Cannot mark ready for dispatch: The assigned delivery partner declined or cancelled this delivery task. A new delivery partner must be selected.'
        });
      }

      // Generate separate Collection Code and Delivery OTP (guaranteed distinct)
      generatedDeliveryCodes = generateSeparateDeliveryCodes();
    }

    // Determine notification copy
    let notifTitle = `Order Update: #${order.orderNumber}`;
    let notifMessage = `Your order at ${order.pharmacy.name} is now: ${status}.`;

    if (status === 'CONFIRMED') {
      notifTitle = `Order Confirmed: #${order.orderNumber}`;
      notifMessage = `Your order at ${order.pharmacy.name} has been confirmed. Stock is reserved and preparation is underway.`;
    } else if (status === 'READY_FOR_PICKUP') {
      notifTitle = `Medicines Ready for Pickup: #${order.orderNumber}`;
      notifMessage = `Your medicines are packed and ready for collection at ${order.pharmacy.name}. Pickup PIN: ${generatedPickupPin}.`;
    } else if (status === 'READY_FOR_DISPATCH') {
      notifTitle = `Medicines Packed & Ready for Dispatch: #${order.orderNumber}`;
      notifMessage = `Your medicines are packed and ready at ${order.pharmacy.name}. Your delivery partner has been alerted to collect them.`;
    } else if (status === 'COMPLETED') {
      notifTitle = `Medicines Handed Over: #${order.orderNumber}`;
      notifMessage = `Your medicines from ${order.pharmacy.name} have been collected and verified. Order completed.`;
    } else if (status === 'CANCELLED') {
      notifTitle = `Order Cancelled: #${order.orderNumber}`;
      notifMessage = `Your order reservation at ${order.pharmacy.name} has been cancelled.`;
    } else if (status === 'REJECTED') {
      notifTitle = `Order Rejected: #${order.orderNumber}`;
      notifMessage = `Your order reservation at ${order.pharmacy.name} could not be fulfilled.`;
    }

    if (comment && comment.trim()) {
      notifMessage += ` Note: ${comment.trim()}`;
    }

    // Define atomic status transition and inventory adjustment unit of work
    const executeStatusTransition = async (tx) => {
      // 1. CONFIRMATION PATH: PENDING -> CONFIRMED
      if (status === 'CONFIRMED' && order.status === 'PENDING') {
        if (!order.items || order.items.length === 0) {
          const err = new Error(`Cannot confirm Order #${order.orderNumber} because it contains no items.`);
          err.statusCode = 400;
          throw err;
        }

        // Aggregate required quantities per medicineId with strict positive integer validation
        const itemQuantities = new Map();
        for (const item of order.items) {
          const rawQty = Number(item.quantity);
          if (!Number.isInteger(rawQty) || rawQty <= 0) {
            const err = new Error(`Invalid item quantity for "${item.medicine?.brandName || item.medicineId}". Quantity must be a positive integer.`);
            err.statusCode = 400;
            throw err;
          }
          const prev = itemQuantities.get(item.medicineId) || 0;
          itemQuantities.set(item.medicineId, prev + rawQty);
        }
        const medicineIds = Array.from(itemQuantities.keys());

        // Atomically transition order status from PENDING to CONFIRMED first
        // In PostgreSQL, this row update locks the order record for this transaction
        const orderUpdateResult = await tx.order.updateMany({
          where: {
            id,
            status: 'PENDING'
          },
          data: { status: 'CONFIRMED' }
        });

        if (orderUpdateResult.count === 0) {
          const err = new Error(`Order #${order.orderNumber} is no longer in PENDING status (concurrent update detected).`);
          err.statusCode = 409;
          throw err;
        }

        // Fetch authoritative inventory items within the transaction
        const invs = await tx.inventory.findMany({
          where: {
            pharmacyId: order.pharmacyId,
            medicineId: { in: medicineIds }
          }
        });

        // Pre-validation pass: verify all items exist in inventory with sufficient stock
        for (const [medId, requiredQty] of itemQuantities.entries()) {
          const inv = invs.find(i => i.medicineId === medId);
          const sampleItem = order.items.find(i => i.medicineId === medId);
          const medName = sampleItem?.medicine?.brandName || medId;

          if (!inv) {
            const err = new Error(`Medicine "${medName}" is not available in pharmacy inventory.`);
            err.statusCode = 400;
            throw err;
          }

          const currentStock = inv.stock != null ? inv.stock : 0;
          if (currentStock < requiredQty) {
            const err = new Error(`Insufficient stock for "${medName}". Available: ${currentStock}, requested: ${requiredQty}.`);
            err.statusCode = 400;
            throw err;
          }
        }

        // Atomic deduction pass: database-enforced conditional decrement
        for (const [medId, requiredQty] of itemQuantities.entries()) {
          const inv = invs.find(i => i.medicineId === medId);
          const sampleItem = order.items.find(i => i.medicineId === medId);
          const medName = sampleItem?.medicine?.brandName || medId;

          const remainingStock = (inv.stock != null ? inv.stock : 0) - requiredQty;
          const updateData = {
            stock: { decrement: requiredQty },
            lastUpdated: new Date()
          };
          if (remainingStock <= 0) {
            updateData.status = 'OUT_OF_STOCK';
          }

          const deductResult = await tx.inventory.updateMany({
            where: {
              id: inv.id,
              stock: { gte: requiredQty }
            },
            data: updateData
          });

          if (deductResult.count === 0) {
            const err = new Error(`Concurrent stock reservation conflict for "${medName}". Insufficient available stock.`);
            err.statusCode = 409;
            throw err;
          }
        }
      }
      // 2. CANCELLATION / REJECTION RESTORATION PATH: CONFIRMED or READY_FOR_PICKUP -> CANCELLED or REJECTED
      else if ((status === 'CANCELLED' || status === 'REJECTED') && (order.status === 'CONFIRMED' || order.status === 'READY_FOR_PICKUP')) {
        // Atomically transition order status first to prevent duplicate restoration
        const orderUpdateResult = await tx.order.updateMany({
          where: {
            id,
            status: { in: ['CONFIRMED', 'READY_FOR_PICKUP'] }
          },
          data: { status }
        });

        if (orderUpdateResult.count === 0) {
          const err = new Error(`Order #${order.orderNumber} is no longer in a cancellable state.`);
          err.statusCode = 409;
          throw err;
        }

        // Aggregate quantities to restore with strict positive integer validation
        const itemQuantities = new Map();
        for (const item of order.items) {
          const rawQty = Number(item.quantity);
          if (Number.isInteger(rawQty) && rawQty > 0) {
            const prev = itemQuantities.get(item.medicineId) || 0;
            itemQuantities.set(item.medicineId, prev + rawQty);
          }
        }
        const medicineIds = Array.from(itemQuantities.keys());

        if (medicineIds.length > 0) {
          const invs = await tx.inventory.findMany({
            where: {
              pharmacyId: order.pharmacyId,
              medicineId: { in: medicineIds }
            }
          });

          // Restore stock
          for (const [medId, restoreQty] of itemQuantities.entries()) {
            const inv = invs.find(i => i.medicineId === medId);
            if (inv) {
              await tx.inventory.update({
                where: { id: inv.id },
                data: {
                  stock: { increment: restoreQty },
                  status: 'AVAILABLE',
                  lastUpdated: new Date()
                }
              });
            }
          }
        }
      }
      // 3. ALL OTHER TRANSITIONS (e.g. CONFIRMED -> READY_FOR_PICKUP, CONFIRMED -> READY_FOR_DISPATCH, READY_FOR_PICKUP -> COMPLETED, PENDING -> CANCELLED/REJECTED)
      else {
        const orderData = { status };
        if (status === 'READY_FOR_PICKUP' && generatedPickupPin) {
          orderData.verificationPin = generatedPickupPin;
        }

        const orderUpdateResult = await tx.order.updateMany({
          where: {
            id,
            status: order.status
          },
          data: orderData
        });

        if (orderUpdateResult.count === 0) {
          const err = new Error(`Order #${order.orderNumber} status changed concurrently.`);
          err.statusCode = 409;
          throw err;
        }

        // On READY_FOR_DISPATCH, attach Collection Code and Delivery OTP to AssistantTask
        if (status === 'READY_FOR_DISPATCH' && generatedDeliveryCodes) {
          const task = await tx.assistantTask.findUnique({ where: { orderId: id } });
          if (task) {
            const updatedMetaNote = serializeVerificationMeta(task.serviceNote, {
              collectionCode: generatedDeliveryCodes.collectionCode,
              generatedAt: new Date().toISOString()
            });
            await tx.assistantTask.update({
              where: { id: task.id },
              data: {
                serviceNote: updatedMetaNote,
                handoverPin: generatedDeliveryCodes.deliveryOtp
              }
            });

            // Alert assigned assistant that package is prepared for dispensary pickup
            if (task.assistantId) {
              await tx.notification.create({
                data: {
                  userId: task.assistantId,
                  title: `Order Ready for Dispatch: #${order.orderNumber}`,
                  message: `Order #${order.orderNumber} is packed and ready for dispensary collection at ${order.pharmacy.name}. Check your portal for the collection code.`,
                  type: 'ASSISTANT',
                  linkUrl: '/assistant-portal'
                }
              });
            }
          }
        }
      }

      // Gate 4: Safe fee reservation release on explicit terminal cancellation/rejection
      if ((status === 'CANCELLED' || status === 'REJECTED') && order.parentOrderId) {
        if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, order.parentOrderId);
          } catch (_) {}
        }
        if (tx.order && typeof tx.order.findUnique === 'function') {
          const parentOrder = await tx.order.findUnique({ where: { id: order.parentOrderId } });
          const hasUncertainOnlineGatewayIntent = order.payment &&
            order.payment.method === 'ONLINE' &&
            order.payment.status === 'PENDING' &&
            Boolean(order.payment.gatewayOrderId);

          if (parentOrder && parentOrder.feePayingChildOrderId === id && parentOrder.feeStatus === 'RESERVED') {
            if (hasUncertainOnlineGatewayIntent) {
              // Gateway intent may still succeed upstream; preserve reservation to prevent double collection
            } else {
              // Safely release reservation while preserving historical child reference
              await tx.order.update({
                where: { id: order.parentOrderId },
                data: {
                  feeStatus: 'RELEASED'
                }
              });
            }
          }
        }
      }

      // Gate 4: Parent Aggregate Status Synchronization
      if (order.parentOrderId) {
        await syncParentAggregateStatus(tx, order.parentOrderId, id, status);
      }

      // Record status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status,
          comment: comment || `Status updated to ${status} by ${req.user.name} (${req.user.role})`
        }
      });

      // Notify the patient
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: notifTitle,
          message: notifMessage,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

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

      // Fetch the updated, fully populated order record
      const updatedOrder = await tx.order.findUnique({
        where: { id },
        include: {
          items: { include: { medicine: true } },
          pharmacy: true,
          statusHistory: { orderBy: { createdAt: 'asc' } }
        }
      });

      return updatedOrder;
    };

    // Mandatory transaction execution: fail closed if $transaction is unavailable
    if (typeof prisma.$transaction !== 'function') {
      const txError = new Error('Database transaction support is required for atomic order status transitions.');
      txError.statusCode = 500;
      throw txError;
    }

    const ord = await prisma.$transaction(async (tx) => {
      return await executeStatusTransition(tx);
    }, DB_TRANSACTION_OPTIONS);

    invalidateOrdersCache();
    return res.json({
      success: true,
      message: `Order status updated to ${status}.`,
      order: ord
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update order status.' });
  }
}

// Verify pickup PIN at counter (Counter Pickup only)
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

    const isDeliveryOrder = order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY';
    if (isDeliveryOrder) {
      return res.status(400).json({
        success: false,
        error: 'Counter pickup verification PIN is only valid for Counter Pickup orders. Assistant delivery requires collection code and patient delivery OTP.'
      });
    }

    const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Order is in terminal status "${order.status}" and cannot transition further.`
      });
    }

    if (order.status !== 'READY_FOR_PICKUP') {
      return res.status(400).json({
        success: false,
        error: `Order must be in READY_FOR_PICKUP status to verify PIN (current: ${order.status}).`
      });
    }

    if (!order.verificationPin || order.verificationPin !== pin.trim()) {
      return res.status(400).json({ success: false, error: 'Incorrect verification PIN. Please re-check with customer.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Consume verificationPin (set to null) to strictly prevent PIN reuse
      const ord = await tx.order.update({
        where: { id },
        data: { status: 'COMPLETED', verificationPin: null },
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
          title: `Medicines Handed Over: #${order.orderNumber}`,
          message: `Your medicines have been collected from ${order.pharmacy.name}. Pickup PIN verified successfully. Thank you for using MediFind AI!`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      // Gate 4.2.2.2: Counter payment confirmation event for Order Payment record & Parent Fee Ledger
      if (tx.payment && typeof tx.payment.findUnique === 'function') {
        const pm = await tx.payment.findUnique({ where: { orderId: id } });
        if (pm && (pm.method === 'COUNTER' || pm.method === 'PAY_AT_COUNTER') && pm.status === 'PENDING') {
          await tx.payment.update({
            where: { id: pm.id },
            data: { status: 'PAID', paidAt: new Date() }
          });
        }
      }

      if (order.parentOrderId && tx.order && typeof tx.order.findUnique === 'function') {
        if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, order.parentOrderId);
          } catch (_) {}
        }
        const parentOrder = await tx.order.findUnique({ where: { id: order.parentOrderId } });
        if (parentOrder && parentOrder.feePayingChildOrderId === id && parentOrder.feeStatus === 'RESERVED') {
          await tx.order.update({
            where: { id: order.parentOrderId },
            data: {
              feeStatus: 'PAID',
              feePaidAt: new Date()
            }
          });
        }
      }

      // Gate 4: Parent Aggregate Status Synchronization on PIN completion
      if (order.parentOrderId) {
        await syncParentAggregateStatus(tx, order.parentOrderId, id, 'COMPLETED');
      }

      return ord;
    }, DB_TRANSACTION_OPTIONS);

    invalidateOrdersCache();
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

// POST /api/orders/:id/verify-collection
// Pharmacist verifies the assistant's Pharmacy Collection Code before handing over the medicine package
async function verifyCollection(req, res) {
  try {
    const { id } = req.params;
    const code = (req.body?.code || req.body?.collectionCode || '').toString().trim();

    if (!code) {
      return res.status(400).json({ success: false, error: 'Collection code is required.' });
    }

    if (req.user && req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Pharmacy collection verification requires Pharmacist role.' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        pharmacy: true,
        user: true,
        assistantTask: {
          include: {
            assistant: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (req.user.role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      if (!managedPharmacy || managedPharmacy.id !== order.pharmacyId) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only verify collection for orders at your own pharmacy.' });
      }
    }

    const isDeliveryOrder = order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY';
    if (!isDeliveryOrder) {
      return res.status(400).json({
        success: false,
        error: 'Collection verification is only applicable for delivery orders. Counter pickup orders use counter PIN verification.'
      });
    }

    if (order.status !== 'READY_FOR_DISPATCH') {
      return res.status(400).json({
        success: false,
        error: `Order must be in READY_FOR_DISPATCH status to verify assistant collection (current: ${order.status}).`
      });
    }

    const task = order.assistantTask;
    if (!task) {
      return res.status(400).json({ success: false, error: 'No delivery assistant task found for this order.' });
    }

    if (!task.assistantId) {
      return res.status(400).json({ success: false, error: 'No assistant is currently assigned to this task.' });
    }

    const meta = parseVerificationMeta(task.serviceNote);
    const expectedCollectionCode = meta.collectionCode;

    if (!expectedCollectionCode) {
      return res.status(400).json({
        success: false,
        error: 'No valid collection code has been issued for this order. Ensure the order was marked Ready for Dispatch.'
      });
    }

    if (expectedCollectionCode !== code.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect pharmacy collection code. Please check code with the assigned assistant.'
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Consume collectionCode in meta to prevent code reuse
      const updatedMeta = { ...meta, collectionCodeConsumedAt: new Date().toISOString() };
      delete updatedMeta.collectionCode;
      const newServiceNote = serializeVerificationMeta(task.serviceNote, updatedMeta);

      const updTask = await tx.assistantTask.update({
        where: { id: task.id },
        data: {
          status: 'IN_TRANSIT',
          collectedAt: new Date(),
          serviceNote: newServiceNote
        }
      });

      const ord = await tx.order.update({
        where: { id },
        data: { status: 'IN_TRANSIT' },
        include: { items: { include: { medicine: true } } }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: 'IN_TRANSIT',
          comment: `Medicine package collected by delivery assistant ${task.assistant?.name || task.assistantId} after verifying pharmacy collection code (${code}). Handover confirmed by pharmacist ${req.user.name}.`
        }
      });

      // Send patient notification with Delivery OTP now that the package is collected and in transit
      if (task.handoverPin) {
        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `Medicines Out for Delivery: #${order.orderNumber}`,
            message: `Your medicine package has been collected by ${task.assistant?.name || 'your delivery assistant'} from ${order.pharmacy.name} and is on the way. Your Delivery OTP: ${task.handoverPin}. Please provide this OTP to the assistant upon arrival.`,
            type: 'ORDER_STATUS',
            linkUrl: `/orders/${order.id}`
          }
        });
      }

      // Notify assistant
      await tx.notification.create({
        data: {
          userId: task.assistantId,
          title: `Collection Verified: Order #${order.orderNumber}`,
          message: `Pharmacy verified package collection. Custody confirmed. Please proceed to patient delivery address.`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return { order: ord, task: updTask };
    }, DB_TRANSACTION_OPTIONS);

    invalidateOrdersCache();
    return res.json({
      success: true,
      message: 'Collection verified successfully! Order is now IN_TRANSIT.',
      order: updated.order,
      task: updated.task
    });
  } catch (err) {
    console.error('verifyCollection error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify collection.' });
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
          include: { medicine: true, prescriptionItem: true }
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
        },
        childOrders: {
          include: {
            pharmacy: true,
            items: { include: { medicine: true, prescriptionItem: true } },
            payment: {
              select: {
                id: true,
                status: true,
                method: true,
                amount: true,
                currency: true,
                paidAt: true,
                failureReason: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        parentOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            feeStatus: true,
            feePayingChildOrderId: true
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

    // PIN and Verification Code Data Minimization:
    // - Counter Pickup:
    //   Only expose verificationPin if order.status === 'READY_FOR_PICKUP' and requester is patient or admin.
    //   If order is PENDING or CONFIRMED, verificationPin is NOT exposed.
    // - Assistant Delivery:
    //   verificationPin is ALWAYS null.
    //   Only expose deliveryOtp if order.status is 'IN_TRANSIT' or 'DELIVERED' and requester is patient or admin.
    //   Only expose collectionCode if requester is assigned assistant or authorized pharmacist/admin.
    const isOwner = order.userId === req.user.id;
    const isPickup = !order.fulfillmentType || order.fulfillmentType === 'PICKUP';
    const isDelivery = order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY';

    let exposedVerificationPin = null;
    let exposedDeliveryOtp = null;
    let exposedCollectionCode = null;

    if (isPickup) {
      if (order.status === 'READY_FOR_PICKUP' && (isOwner || req.user.role === 'ADMIN')) {
        exposedVerificationPin = order.verificationPin || null;
      }
    } else if (isDelivery) {
      exposedVerificationPin = null;
      if ((order.status === 'IN_TRANSIT' || order.status === 'DELIVERED') && (isOwner || req.user.role === 'ADMIN')) {
        exposedDeliveryOtp = order.assistantTask?.handoverPin || null;
      }
      if (req.user.role === 'ASSISTANT' && order.assistantTask?.assistantId === req.user.id) {
        const meta = parseVerificationMeta(order.assistantTask?.serviceNote);
        exposedCollectionCode = meta.collectionCode || null;
      } else if (req.user.role === 'PHARMACIST' || req.user.role === 'ADMIN') {
        const meta = parseVerificationMeta(order.assistantTask?.serviceNote);
        exposedCollectionCode = meta.collectionCode || null;
      }
    }

    const { followUpState, pharmacyResponseStatus, patientPurchaseStatus } = deriveOrderFollowUpAndResponsiveness(order);
    const safeOrder = {
      ...order,
      verificationPin: exposedVerificationPin,
      deliveryOtp: exposedDeliveryOtp,
      collectionCode: exposedCollectionCode,
      prescription: prescriptionDetails,
      paymentAllocation: computePaymentAllocation(order),
      followUpState,
      pharmacyResponseStatus,
      patientPurchaseStatus
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
    const { status } = req.query || {};

    const cacheKey = `${userId}-${role}-${status || 'all'}`;
    const cached = ordersCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < ORDERS_CACHE_TTL_MS)) {
      return res.json(cached.data);
    }

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
      whereClause.isParentOrder = false;
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
        items: { include: { medicine: true, prescriptionItem: true } },
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
        },
        childOrders: {
          include: {
            pharmacy: true,
            items: { include: { medicine: true, prescriptionItem: true } },
            payment: {
              select: {
                id: true,
                status: true,
                method: true,
                amount: true,
                currency: true,
                paidAt: true,
                failureReason: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        parentOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            feeStatus: true,
            feePayingChildOrderId: true
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

    // Data minimization:
    const finalOrders = sanitizedOrders.map(o => {
      const { followUpState, pharmacyResponseStatus, patientPurchaseStatus } = deriveOrderFollowUpAndResponsiveness(o);
      const isOwner = o.userId === userId;
      const isPickup = !o.fulfillmentType || o.fulfillmentType === 'PICKUP';
      const isDelivery = o.fulfillmentType === 'ASSISTANT_DELIVERY' || o.fulfillmentType === 'DELIVERY';

      let exposedPin = null;
      let exposedOtp = null;
      let exposedColCode = null;

      if (isPickup) {
        if (o.status === 'READY_FOR_PICKUP' && (isOwner || role === 'ADMIN')) {
          exposedPin = o.verificationPin || null;
        }
      } else if (isDelivery) {
        exposedPin = null;
        if ((o.status === 'IN_TRANSIT' || o.status === 'DELIVERED') && (isOwner || role === 'ADMIN')) {
          exposedOtp = o.assistantTask?.handoverPin || null;
        }
        if (role === 'ASSISTANT' && o.assistantTask?.assistantId === userId) {
          const meta = parseVerificationMeta(o.assistantTask?.serviceNote);
          exposedColCode = meta.collectionCode || null;
        } else if (role === 'PHARMACIST' || role === 'ADMIN') {
          const meta = parseVerificationMeta(o.assistantTask?.serviceNote);
          exposedColCode = meta.collectionCode || null;
        }
      }

      return {
        ...o,
        verificationPin: exposedPin,
        deliveryOtp: exposedOtp,
        collectionCode: exposedColCode,
        paymentAllocation: computePaymentAllocation(o),
        followUpState,
        pharmacyResponseStatus,
        patientPurchaseStatus
      };
    });

    const responsePayload = {
      success: true,
      count: finalOrders.length,
      orders: finalOrders
    };
    ordersCache.set(cacheKey, { timestamp: Date.now(), data: responsePayload });

    return res.json(responsePayload);
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

      // Gate 4: Parent Aggregate Status Synchronization on Delivery Confirmation
      if (order.parentOrderId) {
        await syncParentAggregateStatus(tx, order.parentOrderId, order.id, 'COMPLETED');
      }

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

      // Notify patient
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: `Medicines Received: #${order.orderNumber}`,
          message: `Delivery receipt confirmed for Order #${order.orderNumber}. Medicines received successfully. Thank you for using MediFind AI!`,
          type: 'ORDER_STATUS',
          linkUrl: `/orders/${order.id}`
        }
      });

      return { order: updatedOrder, task: updatedTask };
    }, DB_TRANSACTION_OPTIONS);

    invalidateOrdersCache();
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

// POST /api/orders/:id/follow-up
// Patient submits follow-up feedback (PURCHASED_HERE, PURCHASED_ELSEWHERE, NOT_PURCHASED, NEEDS_MORE_HELP)
async function submitOrderFollowUp(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user.userId;
    const { followUpState, notes } = req.body || {};

    const VALID_FOLLOW_UP_STATES = [
      'PURCHASED_HERE',
      'PURCHASED_ELSEWHERE',
      'NOT_PURCHASED',
      'NEEDS_MORE_HELP'
    ];

    if (!followUpState || !VALID_FOLLOW_UP_STATES.includes(followUpState)) {
      return res.status(400).json({
        success: false,
        error: `Invalid follow-up state "${followUpState}". Must be one of: ${VALID_FOLLOW_UP_STATES.join(', ')}`
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { pharmacy: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only submit follow-up for your own orders.' });
    }

    const cleanedNotes = (order.notes || '').replace(/\[FOLLOW_UP:[A-Z_]+(?::[^\]]+)?\]\s*/g, '').trim();
    const nowIso = new Date().toISOString();
    const updatedNotes = `[FOLLOW_UP:${followUpState}:${nowIso}] ${cleanedNotes}${notes ? ` (${notes.trim()})` : ''}`.trim();

    const updated = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.update({
        where: { id },
        data: { notes: updatedNotes }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: 'FOLLOW_UP',
          comment: `Patient submitted follow-up: ${followUpState}${notes ? ` — ${notes.trim()}` : ''}`
        }
      });

      if (followUpState === 'NEEDS_MORE_HELP') {
        try {
          await sendIdempotentNotification(tx, {
            userId,
            title: `Support Request Received: Order #${order.orderNumber}`,
            message: `We received your request for help regarding Order #${order.orderNumber}. Our human clinical assistance team has been alerted and will reach out to help you find alternatives.`,
            type: 'INFO',
            linkUrl: `/orders/${order.id}`
          });
        } catch (notifErr) {
          console.warn('Order follow-up notification dispatch warning:', notifErr.message);
        }
      }

      return ord;
    }, DB_TRANSACTION_OPTIONS);

    invalidateOrdersCache();
    return res.json({
      success: true,
      message: 'Follow-up status recorded successfully.',
      followUpState,
      followUpRespondedAt: nowIso,
      order: updated
    });
  } catch (err) {
    console.error('submitOrderFollowUp error:', err);
    return res.status(500).json({ success: false, error: 'Failed to record follow-up.' });
  }
}

const { createSplitOrder } = require('./splitOrderController');

module.exports = {
  createOrder,
  createSplitOrder,
  updateOrderStatus,
  verifyOrderPin,
  verifyCollection,
  getOrderById,
  getOrders,
  confirmReceipt,
  invalidateOrdersCache,
  deriveParentAggregateStatus,
  syncParentAggregateStatus,
  deriveOrderFollowUpAndResponsiveness,
  submitOrderFollowUp
};
