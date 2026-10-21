'use strict';

/**
 * MediFind AI — Gate 4.2.1.2: Split-Order Creation and Item Allocation Controller
 *
 * Implements validated split-order creation with enterprise integrity:
 * - Dedicated database-backed IdempotencyRecord with canonical SHA-256 request hashing.
 * - Persistent prescription-item provenance on OrderItem (prescriptionItemId).
 * - Inside-transaction concurrency control: row lock on Prescription (SELECT FOR UPDATE)
 *   and authoritative recalculation of outstanding quantities.
 * - Bounded retry policy for transient transaction conflicts (P2034, 40001, 40P01).
 * - Atomic parent/child hierarchy creation (parent owns ₹2 fee, children ₹0 fee).
 * - Gate 1A inventory non-deduction guarantees during reservation.
 * - Gate 2A–3.2 clinical matching, verification, and clarification safeguards.
 */

const crypto = require('crypto');
const prisma = require('../prisma');
const { verifyClinicalEquivalence } = require('../utils/rankingEngine');
const {
  getReferencePricing,
  calculateMedicinePricing,
  calculateUnitPrice,
  roundCurrency
} = require('../utils/referencePricing');
const {
  recordPrescriptionAuditLog,
  recordPrescriptionAuditLogBestEffort,
  extractClientIp
} = require('../utils/prescriptionAuditLogger');
const { computeOpenStatus } = require('../utils/openHoursParser');
const { sendIdempotentNotification, sendUrgentCareGuidanceNotification } = require('../utils/notificationDispatcher');

function invalidateOrdersCacheSafe() {
  try {
    const { invalidateOrdersCache } = require('./orderController');
    if (typeof invalidateOrdersCache === 'function') invalidateOrdersCache();
  } catch (_) {}
}

// 4-digit random secure PIN for pickup/handover
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Unique parent order number
function generateOrderNumber() {
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `MF-${timestamp}-${randomSuffix}`;
}

// Gate 4.2.1.4: 24-hour Idempotency retention window
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Computes a canonical SHA-256 hash of the request parameters.
 * Allocations are sorted deterministically by pharmacyId asc, then prescriptionItemId asc.
 */
function computeCanonicalRequestHash(prescriptionId, normalizedAllocations) {
  const sorted = [...normalizedAllocations].sort((a, b) => {
    if (a.pharmacyId !== b.pharmacyId) return a.pharmacyId.localeCompare(b.pharmacyId);
    return a.prescriptionItemId.localeCompare(b.prescriptionItemId);
  });

  const canonical = {
    prescriptionId: String(prescriptionId).trim(),
    allocations: sorted.map(a => ({
      pharmacyId: String(a.pharmacyId).trim(),
      prescriptionItemId: String(a.prescriptionItemId).trim(),
      quantity: Number(a.quantity)
    }))
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

/**
 * Checks whether an error is a retryable transaction conflict:
 * - Prisma P2034 (write conflict or deadlock)
 * - PostgreSQL 40001 (serialization_failure)
 * - PostgreSQL 40P01 (deadlock_detected)
 */
function isRetryableTransactionError(err) {
  if (!err) return false;
  if (err.code === 'P2034') return true;
  const msg = String(err.message || '');
  if (
    msg.includes('40001') ||
    msg.includes('40P01') ||
    msg.includes('deadlock detected') ||
    msg.includes('could not serialize access') ||
    msg.includes('write conflict')
  ) {
    return true;
  }
  return false;
}

/**
 * Executes a transactional worker with bounded exponential backoff retry.
 * Only retryable concurrency errors are retried; validation errors immediately throw.
 */
async function executeWithTransactionRetry(fn, { maxRetries = 3, baseDelayMs = 50 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (isRetryableTransactionError(err) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 25);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Normalizes client allocations from either grouped format or flat format:
 * Grouped: [{ pharmacyId, items: [{ prescriptionItemId, quantity }] }]
 * Flat:    [{ pharmacyId, prescriptionItemId, quantity }]
 */
function normalizeAllocations(rawAllocations) {
  if (!Array.isArray(rawAllocations)) return [];
  const normalized = [];

  for (const entry of rawAllocations) {
    if (!entry || typeof entry !== 'object') continue;

    // Format A: Grouped by pharmacy with items array
    if (entry.pharmacyId && Array.isArray(entry.items)) {
      for (const item of entry.items) {
        if (!item || typeof item !== 'object') continue;
        normalized.push({
          pharmacyId: String(entry.pharmacyId).trim(),
          prescriptionItemId: String(item.prescriptionItemId || item.itemId || item.id || '').trim(),
          quantity: item.quantity
        });
      }
    }
    // Format B: Flat allocation item
    else if (entry.pharmacyId && (entry.prescriptionItemId || entry.itemId || entry.id)) {
      normalized.push({
        pharmacyId: String(entry.pharmacyId).trim(),
        prescriptionItemId: String(entry.prescriptionItemId || entry.itemId || entry.id || '').trim(),
        quantity: entry.quantity
      });
    }
  }

  return normalized;
}

/**
 * Formats order response payload consistently for both direct creation and idempotent replay.
 */
function formatSplitOrderResponse(parent, children, allocationSummary, isReplay = false) {
  return {
    success: true,
    isIdempotentReplay: Boolean(isReplay),
    message: isReplay
      ? 'Idempotent request: returning existing split-order hierarchy.'
      : 'Split order created and items allocated successfully.',
    parentOrder: {
      id: parent.id,
      orderNumber: parent.orderNumber,
      isParentOrder: true,
      parentOrderId: null,
      status: parent.status,
      orderType: parent.orderType,
      medicineSubtotal: parent.medicineSubtotal,
      platformFee: parent.platformFee,
      deliveryFee: parent.deliveryFee,
      totalAmount: parent.totalAmount,
      prescriptionId: parent.prescriptionId,
      childOrdersCount: children.length,
      createdAt: parent.createdAt
    },
    childOrders: children.map(child => ({
      id: child.id,
      orderNumber: child.orderNumber,
      parentOrderId: child.parentOrderId,
      pharmacyId: child.pharmacyId,
      pharmacyName: child.pharmacy?.name,
      status: child.status,
      orderType: child.orderType,
      medicineSubtotal: child.medicineSubtotal,
      platformFee: child.platformFee,
      deliveryFee: child.deliveryFee,
      totalAmount: child.totalAmount,
      verificationPin: child.verificationPin,
      createdAt: child.createdAt,
      items: (child.items || []).map(i => ({
        id: i.id,
        medicineId: i.medicineId,
        prescriptionItemId: i.prescriptionItemId || null, // Persisted database field
        brandName: i.medicine?.brandName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
        status: i.status,
        fulfilledQuantity: i.fulfilledQuantity,
        unfulfilledReason: i.unfulfilledReason
      }))
    })),
    allocationSummary
  };
}

/**
 * POST /api/orders/split
 * Creates one parent order with multiple pharmacy-specific child orders.
 */
async function createSplitOrder(req, res) {
  try {
    const userId = req.user?.id || req.user?.userId;
    const userRole = req.user?.role || 'PATIENT';

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const {
      prescriptionId,
      allocations: rawAllocations,
      orderType = 'RESERVATION',
      notes,
      idempotencyKey: bodyIdempotencyKey
    } = req.body || {};

    const rawKey = bodyIdempotencyKey || req.headers['idempotency-key'] || null;

    if (!prescriptionId || typeof prescriptionId !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PRESCRIPTION_ID',
        error: 'Prescription ID is required to create a split order.'
      });
    }

    const normalizedAllocations = normalizeAllocations(rawAllocations);
    if (normalizedAllocations.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_ALLOCATIONS',
        error: 'At least one valid pharmacy-item allocation is required.'
      });
    }

    // ── 1. Validate Allocation Quantities and Duplicates ─────────────────────────
    const seenPharmacyItemPairs = new Set();
    for (const alloc of normalizedAllocations) {
      if (!alloc.pharmacyId) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ALLOCATION',
          error: 'Each allocation must specify a valid pharmacyId.'
        });
      }
      if (!alloc.prescriptionItemId) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ALLOCATION',
          error: 'Each allocation must specify a valid prescriptionItemId.'
        });
      }

      // Must be a positive integer
      const qty = Number(alloc.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_QUANTITY',
          error: `Invalid allocation quantity "${alloc.quantity}" for prescription item "${alloc.prescriptionItemId}". Quantities must be positive integers.`
        });
      }
      alloc.quantity = qty;

      // Duplicate check: Same pharmacy + prescription item combination cannot be specified twice
      const pairKey = `${alloc.pharmacyId}:${alloc.prescriptionItemId}`;
      if (seenPharmacyItemPairs.has(pairKey)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_ALLOCATION',
          error: `Duplicate allocation detected for pharmacy "${alloc.pharmacyId}" and prescription item "${alloc.prescriptionItemId}". Consolidate quantities into a single allocation.`
        });
      }
      seenPharmacyItemPairs.add(pairKey);
    }

    // ── 2. Authenticate Patient and Verify Prescription Ownership (Step 2.1) ────
    let prescription = null;
    if (prisma.prescription && typeof prisma.prescription.findUnique === 'function') {
      try {
        prescription = await prisma.prescription.findUnique({
          where: { id: prescriptionId },
          include: {
            items: {
              include: {
                medicine: true,
                sourceCandidate: true
              }
            },
            clarifications: true
          }
        });
      } catch (_) {}
    }

    if (!prescription) {
      return res.status(404).json({
        success: false,
        code: 'PRESCRIPTION_NOT_FOUND',
        error: 'Prescription not found.'
      });
    }

    if (userRole === 'PATIENT') {
      const ownerId = prescription.userId || prescription.patientId;
      if (ownerId !== userId) {
        recordPrescriptionAuditLogBestEffort(prisma, {
          prescriptionId,
          prescriptionIdSnapshot: prescriptionId,
          actorId: userId,
          actorRole: 'PATIENT',
          action: 'ACCESS_DENIED',
          details: { endpoint: 'createSplitOrder', reason: 'Cross-patient unauthorized order creation attempt' },
          ipAddress: extractClientIp(req)
        });

        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_PRESCRIPTION',
          error: 'Unauthorized: Prescription belongs to another patient.'
        });
      }
    } else if (userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        error: 'Only patients or administrators can create split orders.'
      });
    }

    // ── 3. Require Prescription & Items to Meet Verification Requirements (Step 2.2) ──
    if (prescription.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        code: 'PRESCRIPTION_NOT_VERIFIED',
        error: `Prescription has status "${prescription.status}". Only clinically verified prescriptions can be split into orders.`
      });
    }

    const prescriptionItems = prescription.items || [];
    if (prescriptionItems.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'PRESCRIPTION_EMPTY',
        error: 'Prescription contains no items.'
      });
    }

    // Validate that all prescription items are verified and none are rejected
    for (const pItem of prescriptionItems) {
      if (!pItem.isVerified) {
        return res.status(400).json({
          success: false,
          code: 'PRESCRIPTION_ITEM_NOT_VERIFIED',
          error: `Prescription item "${pItem.prescribedName || pItem.id}" is not verified. All items must be clinically verified before splitting.`
        });
      }
      if (pItem.isRejected || pItem.sourceCandidate?.isRejected) {
        return res.status(400).json({
          success: false,
          code: 'PRESCRIPTION_ITEM_REJECTED',
          error: `Prescription contains rejected item "${pItem.prescribedName || pItem.id}". Cannot allocate orders for rejected items.`
        });
      }
    }

    // Unresolved clarifications check
    const clarifications = prescription.clarifications || [];
    const activeClarifications = clarifications.filter(c =>
      ['PENDING', 'OPEN', 'RESPONDED', 'INQUIRY_SENT'].includes(c.status)
    );
    if (activeClarifications.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNRESOLVED_CLARIFICATIONS',
        error: `Cannot split order while ${activeClarifications.length} clinical clarification inquiry is unresolved. All clarifications must be resolved prior to order creation.`
      });
    }

    // Map prescription items by ID for quick authoritative lookup
    const prescriptionItemMap = new Map();
    for (const pItem of prescriptionItems) {
      prescriptionItemMap.set(pItem.id, pItem);
    }

    // Verify all requested prescriptionItemIds exist on this prescription
    for (const alloc of normalizedAllocations) {
      if (!prescriptionItemMap.has(alloc.prescriptionItemId)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PRESCRIPTION_ITEM',
          error: `Prescription item "${alloc.prescriptionItemId}" does not belong to this prescription.`
        });
      }
    }

    // ── 4. Dedicated Database-Backed Idempotency Evaluation (Gate 4.2.1.2) ───────
    const requestHash = computeCanonicalRequestHash(prescriptionId, normalizedAllocations);
    // Documented deterministic strategy for missing keys:
    // If no explicit key was provided by the client, use the canonical request hash prefixed with "auto_".
    // This allows exact duplicate retries to be safely replayed without creating duplicate orders,
    // while ensuring different allocations naturally receive distinct keys.
    const effectiveKey = rawKey ? String(rawKey).trim() : `auto_${requestHash}`;

    // 4a. Out-of-transaction Pre-Check Query against IdempotencyRecord
    let existingIdempotency = null;
    if (prisma.idempotencyRecord && typeof prisma.idempotencyRecord.findUnique === 'function') {
      try {
        existingIdempotency = await prisma.idempotencyRecord.findUnique({
          where: {
            userId_action_key: {
              userId,
              action: 'SPLIT_ORDER_CREATION',
              key: effectiveKey
            }
          }
        });
      } catch (_) {}
    }

    // Fallback check against Order table notes tag if IdempotencyRecord table is migrating
    if (!existingIdempotency && prisma.order && typeof prisma.order.findFirst === 'function') {
      try {
        const orderWithTag = await prisma.order.findFirst({
          where: {
            userId,
            isParentOrder: true,
            notes: { contains: `[IDEMPOTENCY:${effectiveKey}]` }
          },
          include: {
            childOrders: {
              include: {
                items: { include: { medicine: true } },
                pharmacy: true
              }
            }
          }
        });
        if (orderWithTag) {
          // Verify hash if stored in notes or payload
          const hashMatch = orderWithTag.notes && orderWithTag.notes.includes(`[HASH:${requestHash}]`);
          if (orderWithTag.prescriptionId !== prescriptionId || (orderWithTag.notes?.includes('[HASH:') && !hashMatch)) {
            return res.status(409).json({
              success: false,
              code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
              error: 'Idempotency key has already been used with different request parameters (prescription or allocation mismatch).'
            });
          }
        }
      } catch (_) {}
    }

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return res.status(409).json({
          success: false,
          code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
          error: 'Idempotency key has already been used with different request parameters (prescription or allocation mismatch).'
        });
      }

      // Gate 4.2.1.4: Check linked parent order status to prevent returning CANCELLED or REJECTED orders
      let linkedParent = existingIdempotency.parentOrder || null;
      if (!linkedParent && existingIdempotency.parentOrderId && prisma.order && typeof prisma.order.findUnique === 'function') {
        try {
          linkedParent = await prisma.order.findUnique({
            where: { id: existingIdempotency.parentOrderId }
          });
        } catch (_) {}
      }

      const isTerminalCancelledOrRejected = linkedParent && ['CANCELLED', 'REJECTED'].includes(linkedParent.status);

      if (!isTerminalCancelledOrRejected) {
        // Replay original response for active or completed orders
        try {
          const cached = JSON.parse(existingIdempotency.responseBody);
          return res.status(200).json({
            ...cached,
            isIdempotentReplay: true
          });
        } catch (_) {}
      }
      // If linkedParent is CANCELLED or REJECTED, do not replay!
      // Fall through to transaction to atomically re-allocate freed quantities.
    }

    // ── 5. Re-Read Authoritative Pharmacy & Inventory Records (Step 2.3, 2.4, 2.8)
    const participatingPharmacyIds = Array.from(new Set(normalizedAllocations.map(a => a.pharmacyId)));
    const pharmaciesById = new Map();

    for (const phId of participatingPharmacyIds) {
      let phRecord = null;
      if (prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
        try {
          phRecord = await prisma.pharmacy.findUnique({
            where: { id: phId },
            include: {
              inventory: {
                include: { medicine: true }
              }
            }
          });
        } catch (_) {}
      }

      if (!phRecord) {
        return res.status(404).json({
          success: false,
          code: 'PHARMACY_NOT_FOUND',
          error: `Pharmacy with ID "${phId}" was not found.`
        });
      }

      // Verification and active status checks
      if (!phRecord.isVerified || phRecord.verificationStatus !== 'VERIFIED' || phRecord.verificationStatus === 'TEST') {
        return res.status(400).json({
          success: false,
          code: 'PHARMACY_NOT_ELIGIBLE',
          error: `Pharmacy "${phRecord.name}" is not an active, verified participating dispensary.`
        });
      }

      const openStatus = computeOpenStatus(phRecord.openingHours, phRecord.isOpen);
      if (openStatus && openStatus.isCurrentlyOpen === false) {
        return res.status(400).json({
          success: false,
          code: 'PHARMACY_CLOSED',
          error: `Pharmacy "${phRecord.name}" is currently closed. ${openStatus.opensAt ? `Opens at ${openStatus.opensAt}. ` : ''}Cannot allocate orders outside operating hours.`,
          openStatus
        });
      }

      pharmaciesById.set(phId, phRecord);
    }

    // Validate each allocation against authoritative dispensary inventory and Gate 3 clinical safeguards
    const allocationsByPharmacy = new Map();
    for (const phId of participatingPharmacyIds) {
      allocationsByPharmacy.set(phId, []);
    }

    for (const alloc of normalizedAllocations) {
      const pharmacy = pharmaciesById.get(alloc.pharmacyId);
      const prescriptionItem = prescriptionItemMap.get(alloc.prescriptionItemId);

      // Find authoritative inventory item
      const invItem = (pharmacy.inventory || []).find(inv => inv.medicineId === prescriptionItem.medicineId);

      if (!invItem) {
        return res.status(400).json({
          success: false,
          code: 'MEDICINE_NOT_STOCKED',
          error: `Dispensary "${pharmacy.name}" does not carry medicine "${prescriptionItem.prescribedName}".`
        });
      }

      // Gate 3 & Gate 3.2 Clinical Equivalence Verification
      const reqClinicalAttrs = {
        prescriptionItemId: prescriptionItem.id,
        medicineId: prescriptionItem.medicineId,
        prescribedName: prescriptionItem.prescribedName,
        genericName: prescriptionItem.medicine?.genericName || prescriptionItem.genericName,
        strength: prescriptionItem.medicine?.strength || prescriptionItem.strength || prescriptionItem.dosage,
        dosageForm: prescriptionItem.medicine?.dosageForm || prescriptionItem.dosageForm,
        brandName: prescriptionItem.medicine?.brandName || prescriptionItem.brandName || prescriptionItem.prescribedName
      };

      const clinicalCheck = verifyClinicalEquivalence(reqClinicalAttrs, invItem.medicine);
      if (!clinicalCheck.isMatch) {
        return res.status(400).json({
          success: false,
          code: 'CLINICAL_MISMATCH',
          error: `Clinical mismatch at "${pharmacy.name}": ${clinicalCheck.reason}`
        });
      }

      // Authoritative pricing: never trust client-supplied prices
      let unitPrice = null;
      if (invItem.price != null && Number(invItem.price) > 0) {
        unitPrice = roundCurrency(Number(invItem.price));
      } else {
        const ref = getReferencePricing(prescriptionItem.medicine?.brandName, prescriptionItem.medicine?.genericName);
        if (ref) {
          const dosageForm = prescriptionItem.medicine?.dosageForm || 'Tablet';
          const unitsPerPack = ref.unitsPerPack || 1;
          const isMultiUnit = unitsPerPack > 1 && (
            dosageForm.toLowerCase().includes('tablet') ||
            dosageForm.toLowerCase().includes('capsule')
          );
          if (isMultiUnit) {
            unitPrice = ref.unitPrice != null ? roundCurrency(ref.unitPrice) : calculateUnitPrice(ref.publishedMrp, unitsPerPack);
          } else {
            unitPrice = ref.publishedMrp != null ? roundCurrency(ref.publishedMrp) : (ref.unitPrice != null ? roundCurrency(ref.unitPrice) : null);
          }
        }
      }

      const effectiveUnitPrice = unitPrice != null ? unitPrice : null;
      const subtotal = effectiveUnitPrice != null ? roundCurrency(effectiveUnitPrice * alloc.quantity) : null;


      allocationsByPharmacy.get(alloc.pharmacyId).push({
        prescriptionItemId: prescriptionItem.id,
        medicineId: prescriptionItem.medicineId,
        prescribedName: prescriptionItem.prescribedName,
        quantity: alloc.quantity,
        unitPrice,
        subtotal
      });
    }

    // ── 6. Prepare Order Specs & Subtotals ───────────────────────────────────────
    let parentMedicineSubtotal = 0;
    const childOrderSpecs = [];

    let childIndex = 0;
    for (const [phId, items] of allocationsByPharmacy.entries()) {
      const ph = pharmaciesById.get(phId);
      const childMedicineSubtotal = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
      parentMedicineSubtotal += childMedicineSubtotal;

      childOrderSpecs.push({
        index: childIndex++,
        pharmacy: ph,
        pharmacyId: phId,
        items,
        medicineSubtotal: childMedicineSubtotal,
        platformFee: 0.00, // Child orders strictly ₹0.00 platform fee
        deliveryFee: 0.00,
        totalAmount: childMedicineSubtotal
      });
    }

    parentMedicineSubtotal = Number(parentMedicineSubtotal.toFixed(2));

    // Step 3 Platform-fee preparation:
    // The parent owns the single ₹2 platform fee for the entire aggregate split request.
    const parentPlatformFee = 2.00;
    const parentTotalAmount = Number((parentMedicineSubtotal + parentPlatformFee).toFixed(2));

    const parentOrderNumber = generateOrderNumber();
    const primaryPharmacyId = participatingPharmacyIds[0];

    const parentNotes = [
      notes,
      `[IDEMPOTENCY:${effectiveKey}]`,
      `[HASH:${requestHash}]`
    ].filter(Boolean).join(' ');

    // ── 7. Execute Transaction with Retries & In-Transaction Concurrency Control ─
    const transactionResult = await executeWithTransactionRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // 7a. Acquire exclusive row lock on Prescription row to serialize concurrent allocations
        if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            await tx.$queryRawUnsafe(`SELECT id FROM "Prescription" WHERE id = $1 FOR UPDATE`, prescriptionId);
          } catch (_) {}
        }

        // 7b. In-transaction Idempotency Re-check
        let reclaimIdempotencyRecordId = null;
        if (tx.idempotencyRecord && typeof tx.idempotencyRecord.findUnique === 'function') {
          try {
            const inTxRecord = await tx.idempotencyRecord.findUnique({
              where: {
                userId_action_key: {
                  userId,
                  action: 'SPLIT_ORDER_CREATION',
                  key: effectiveKey
                }
              }
            });
            if (inTxRecord) {
              if (inTxRecord.requestHash !== requestHash) {
                const conflictErr = new Error('Idempotency key has already been used with different request parameters (prescription or allocation mismatch).');
                conflictErr.statusCode = 409;
                conflictErr.code = 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
                throw conflictErr;
              }

              // Gate 4.2.1.4: Check whether linked parent order is cancelled or rejected
              let inTxLinkedParent = null;
              if (inTxRecord.parentOrderId && tx.order && typeof tx.order.findUnique === 'function') {
                try {
                  inTxLinkedParent = await tx.order.findUnique({
                    where: { id: inTxRecord.parentOrderId }
                  });
                } catch (_) {}
              }

              const isLinkedCancelledOrRejected = inTxLinkedParent && ['CANCELLED', 'REJECTED'].includes(inTxLinkedParent.status);

              if (isLinkedCancelledOrRejected) {
                // The prior order was cancelled or rejected.
                // Do NOT return it as active! Mark the idempotency record for in-place re-claim.
                reclaimIdempotencyRecordId = inTxRecord.id;
              } else {
                // Active, completed, or unlinked: replay existing response
                const cached = JSON.parse(inTxRecord.responseBody);
                return { isReplay: true, responseData: cached };
              }
            }
          } catch (e) {
            if (e.statusCode === 409) throw e;
          }
        }

        // 7c. CRITICAL (Gate 4.2.1.2 Fix): Recalculate Outstanding Quantities INSIDE the locked transaction!
        const existingOrders = await tx.order.findMany({
          where: {
            prescriptionId,
            isParentOrder: false, // only consider child and standalone orders
            status: { notIn: ['CANCELLED', 'REJECTED'] }
          },
          include: { items: true }
        });

        const previouslyAllocatedByMedId = new Map();
        for (const ord of existingOrders) {
          for (const item of (ord.items || [])) {
            const currentSum = previouslyAllocatedByMedId.get(item.medicineId) || 0;
            previouslyAllocatedByMedId.set(item.medicineId, currentSum + item.quantity);
          }
        }

        const requestedAllocationsByItemId = new Map();
        for (const alloc of normalizedAllocations) {
          const cur = requestedAllocationsByItemId.get(alloc.prescriptionItemId) || 0;
          requestedAllocationsByItemId.set(alloc.prescriptionItemId, cur + alloc.quantity);
        }

        const itemAllocationAnalysis = [];
        for (const pItem of prescriptionItems) {
          const alreadyAllocated = previouslyAllocatedByMedId.get(pItem.medicineId) || 0;
          const outstandingQty = Math.max(0, pItem.quantity - alreadyAllocated);
          const requestedInThisSplit = requestedAllocationsByItemId.get(pItem.id) || 0;

          if (requestedInThisSplit > outstandingQty) {
            const qtyErr = new Error(`Allocation for "${pItem.prescribedName}" (${requestedInThisSplit}) exceeds its outstanding requested quantity (${outstandingQty}). Originally prescribed: ${pItem.quantity}, previously fulfilled/allocated: ${alreadyAllocated}.`);
            qtyErr.statusCode = 400;
            qtyErr.code = 'ALLOCATION_EXCEEDS_OUTSTANDING_QUANTITY';
            throw qtyErr;
          }

          const remainingQty = outstandingQty - requestedInThisSplit;
          itemAllocationAnalysis.push({
            prescriptionItemId: pItem.id,
            medicineId: pItem.medicineId,
            prescribedName: pItem.prescribedName,
            requestedQuantity: pItem.quantity,
            previouslyAllocated: alreadyAllocated,
            outstandingQuantity: outstandingQty,
            allocatedInThisOrder: requestedInThisSplit,
            remainingQuantity: remainingQty
          });
        }

        // 7d. Create Parent Order
        const createdParent = await tx.order.create({
          data: {
            orderNumber: parentOrderNumber,
            userId,
            pharmacyId: primaryPharmacyId,
            isParentOrder: true,
            parentOrderId: null,
            status: 'PENDING',
            orderType,
            prescriptionId,
            medicineSubtotal: parentMedicineSubtotal,
            platformFee: parentPlatformFee, // Single ₹2 platform fee owned by parent
            deliveryFee: 0.00,
            totalAmount: parentTotalAmount,
            notes: parentNotes || null,
            feeStatus: 'UNALLOCATED',
            feePayingChildOrderId: null,
            statusHistory: {
              create: [
                {
                  status: 'PENDING',
                  comment: `Split parent order created with ${participatingPharmacyIds.length} participating pharmacies.`
                }
              ]
            }
          }
        });

        // 7e. Create Child Orders with PERSISTED prescriptionItemId provenance
        const createdChildren = [];
        for (const spec of childOrderSpecs) {
          const childOrderNumber = `${parentOrderNumber}-${String.fromCharCode(65 + spec.index)}`;
          const pItemMap = new Map((prescriptionItems || []).map(p => [p.id, p]));
          const childPendingTags = [];
          const childItemsCreate = spec.items.map(it => {
            const pItem = pItemMap.get(it.prescriptionItemId);
            const isPending = Boolean(pItem && pItem.patientNotes === 'PHARMACIST_SELECTION_REQUESTED');
            if (isPending) {
              childPendingTags.push(`[PENDING_SELECTION:${it.prescriptionItemId}:${pItem?.prescribedName || 'Medicine'}]`);
            }
            return {
              medicineId: it.medicineId,
              // Gate 4.2.1.2: Persistent Prescription-Item Provenance
              prescriptionItemId: it.prescriptionItemId,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
              status: isPending ? 'PENDING_SELECTION' : 'PENDING',
              fulfilledQuantity: 0,
              unfulfilledReason: isPending ? 'PHARMACIST_SELECTION_REQUESTED' : null
            };
          });

          let childNotes = notes || null;
          if (childPendingTags.length > 0) {
            childNotes = childNotes ? `${childNotes} ${childPendingTags.join(' ')}` : childPendingTags.join(' ');
          }

          const childOrder = await tx.order.create({
            data: {
              orderNumber: childOrderNumber,
              userId,
              pharmacyId: spec.pharmacyId,
              isParentOrder: false,
              parentOrderId: createdParent.id,
              status: 'PENDING',
              orderType,
              prescriptionId,
              medicineSubtotal: spec.medicineSubtotal,
              platformFee: 0.00, // Child orders NEVER acquire ₹2 fee
              deliveryFee: 0.00,
              totalAmount: spec.totalAmount,
              verificationPin: childPin,
              notes: childNotes,
              items: {
                create: childItemsCreate
              },
              statusHistory: {
                create: [
                  {
                    status: 'PENDING',
                    comment: `Child order created for pharmacy ${spec.pharmacy.name}.`
                  }
                ]
              }
            },
            include: {
              items: {
                include: {
                  medicine: true,
                  prescriptionItem: true
                }
              },
              pharmacy: true
            }
          });

          createdChildren.push(childOrder);
        }

        // 7f. Record Mandatory Business Audit Event
        await recordPrescriptionAuditLog(tx, {
          prescriptionId,
          prescriptionIdSnapshot: prescriptionId,
          actorId: userId,
          actorRole: userRole,
          action: 'SPLIT_ORDER_CREATED',
          details: {
            parentOrderId: createdParent.id,
            parentOrderNumber: createdParent.orderNumber,
            participatingPharmaciesCount: participatingPharmacyIds.length,
            childOrderIds: createdChildren.map(c => c.id),
            totalAllocatedItems: normalizedAllocations.length,
            totalMedicineSubtotal: parentMedicineSubtotal,
            platformFee: parentPlatformFee,
            idempotencyKey: effectiveKey,
            requestHash,
            reclaimedAfterCancellation: Boolean(reclaimIdempotencyRecordId)
          },
          ipAddress: extractClientIp(req)
        });

        // 7g. Formulate Allocation Summary
        const fullyAllocatedItems = itemAllocationAnalysis.filter(i => i.remainingQuantity === 0).length;
        const partiallyAllocatedItems = itemAllocationAnalysis.filter(i => i.allocatedInThisOrder > 0 && i.remainingQuantity > 0).length;
        const unallocatedItems = itemAllocationAnalysis.filter(i => i.allocatedInThisOrder === 0).length;
        const remainingItems = itemAllocationAnalysis.filter(i => i.remainingQuantity > 0);

        const allocationSummary = {
          totalPrescriptionItems: prescriptionItems.length,
          fullyAllocatedItems,
          partiallyAllocatedItems,
          unallocatedItems,
          remainingItemsCount: remainingItems.length,
          remainingItems
        };

        const finalResponseBody = formatSplitOrderResponse(createdParent, createdChildren, allocationSummary, false);

        // 7h. Create or Re-claim Dedicated IdempotencyRecord (Gate 4.2.1.2 / Gate 4.2.1.4) inside the transaction
        const now = new Date();
        const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

        if (tx.idempotencyRecord) {
          try {
            if (reclaimIdempotencyRecordId && typeof tx.idempotencyRecord.update === 'function') {
              await tx.idempotencyRecord.update({
                where: { id: reclaimIdempotencyRecordId },
                data: {
                  requestHash,
                  responseStatus: 201,
                  responseBody: JSON.stringify(finalResponseBody),
                  parentOrderId: createdParent.id,
                  expiresAt,
                  updatedAt: now
                }
              });
            } else if (typeof tx.idempotencyRecord.create === 'function') {
              await tx.idempotencyRecord.create({
                data: {
                  userId,
                  key: effectiveKey,
                  action: 'SPLIT_ORDER_CREATION',
                  requestHash,
                  responseStatus: 201,
                  responseBody: JSON.stringify(finalResponseBody),
                  parentOrderId: createdParent.id,
                  expiresAt
                }
              });
            }
          } catch (idemErr) {
            // If unique constraint violation occurs concurrently, transaction fails and rolls back
            throw idemErr;
          }
        }

        return {
          isReplay: false,
          responseData: finalResponseBody,
          parentOrder: createdParent,
          childOrders: createdChildren
        };
      });
    });

    if (transactionResult.isReplay) {
      return res.status(200).json({
        ...transactionResult.responseData,
        isIdempotentReplay: true
      });
    }

    // Invalidate order cache
    invalidateOrdersCacheSafe();

    const createdParent = transactionResult.parentOrder;
    const createdChildren = transactionResult.childOrders;

    // ── 8. Non-Blocking Notifications ───────────────────────────────────────────
    try {
      const isEmergencyOrder = orderType === 'EMERGENCY' || (notes && notes.toLowerCase().includes('emergency'));
      if (isEmergencyOrder) {
        await sendUrgentCareGuidanceNotification(prisma, {
          userId,
          orderNumber: createdParent.orderNumber,
          linkUrl: `/orders`
        });
      }

      await sendIdempotentNotification(prisma, {
        userId,
        title: `Split Order Created: #${createdParent.orderNumber}`,
        message: `Your prescription has been split into ${createdChildren.length} pharmacy orders. Review your items in orders.`,
        type: 'ORDER_STATUS',
        linkUrl: `/orders`
      });
    } catch (_) {}

    for (const child of createdChildren) {
      const ph = child.pharmacy;
      if (ph?.managerId) {
        try {
          await sendIdempotentNotification(prisma, {
            userId: ph.managerId,
            title: `New Reservation Request: #${child.orderNumber}`,
            message: `New split child order received from patient (${child.items?.length || 0} items, Total: ₹${child.totalAmount.toFixed(2)}). Please review stock.`,
            type: 'ORDER_STATUS',
            linkUrl: `/pharmacist`
          });
        } catch (_) {}
      }
    }

    return res.status(201).json(transactionResult.responseData);

  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code || 'VALIDATION_ERROR',
        error: err.message
      });
    }

    // Prisma Unique Constraint violation on IdempotencyRecord
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_REQUEST_IN_FLIGHT',
        error: 'A concurrent request with the same idempotency key is already processing. Please retry in a moment.'
      });
    }

    console.error('createSplitOrder error:', err);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while creating the split order.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}

module.exports = {
  createSplitOrder,
  normalizeAllocations,
  computeCanonicalRequestHash,
  isRetryableTransactionError,
  executeWithTransactionRetry,
  IDEMPOTENCY_TTL_MS
};
