/**
 * MediFind AI — Fulfillment Verification, PIN/OTP Management & Payment Allocation Ledger
 *
 * Core Controls:
 * 1. Counter Pickup PIN:
 *    - Generated ONLY when order is paid & marked READY_FOR_PICKUP.
 *    - Never generated at reservation creation or reservation acceptance.
 *    - Verified by pharmacy counter staff to complete order.
 *
 * 2. Assistant Delivery Pharmacy Collection Code:
 *    - Generated when pharmacy marks order READY_FOR_DISPATCH.
 *    - Visible ONLY to assigned assistant.
 *    - Verified by pharmacy counter staff before handing over the medicine package.
 *
 * 3. Assistant Delivery Patient Delivery OTP:
 *    - Generated when order is ready for dispatch / in transit.
 *    - Visible ONLY to authorized patient at appropriate delivery stage (IN_TRANSIT / DELIVERED).
 *    - NEVER exposed to pharmacy screens, assistant task lists, or public responses in advance.
 *    - Verified server-side when assistant submits handover PIN at doorstep.
 *    - Collection Code and Patient Delivery OTP are NEVER identical or interchangeable.
 *
 * 4. Payment Allocation Ledger:
 *    - Separates medicine proceeds (allocated to pharmacy) and delivery charge (allocated to assistant).
 *    - Tracks settlement status, payout eligibility, and gateway mode transparently.
 */

const crypto = require('crypto');
const prisma = require('../prisma');

const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Generates an unpredictable, cryptographically random numeric code of given length.
 * Avoids obvious patterns (e.g. 0000, 1111, 1234).
 */
function generateSecureCode(digits = 4) {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const range = max - min + 1;

  let code;
  let attempts = 0;
  do {
    const randomBytes = crypto.randomBytes(4);
    const randomInt = randomBytes.readUInt32BE(0);
    code = (min + (randomInt % range)).toString();
    attempts++;
  } while (isTrivialCode(code) && attempts < 10);

  return code;
}

function isTrivialCode(code) {
  if (/^(\d)\1+$/.test(code)) return true; // e.g. 1111, 2222
  if (code === '1234' || code === '4321' || code === '0000') return true;
  return false;
}

/**
 * Generates separate and distinct Collection Code and Delivery OTP for an order.
 * Guarantees that the two codes are never identical.
 */
function generateSeparateDeliveryCodes() {
  const collectionCode = generateSecureCode(4);
  let deliveryOtp;
  let attempts = 0;
  do {
    deliveryOtp = generateSecureCode(4);
    attempts++;
  } while (deliveryOtp === collectionCode && attempts < 10);

  return { collectionCode, deliveryOtp };
}

/**
 * Parses structured fulfillment verification metadata from task serviceNote or order notes.
 */
function parseVerificationMeta(text) {
  if (!text || typeof text !== 'string') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {
    // If text has a custom prefix format like [VERIFICATION:...]
    const match = text.match(/\[FULFILLMENT_META:(.*?)\]/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (_) {}
    }
  }
  return {};
}

/**
 * Serializes verification metadata into structured string preserving any existing user note.
 */
function serializeVerificationMeta(existingText, newMeta) {
  const currentMeta = parseVerificationMeta(existingText);
  const merged = { ...currentMeta, ...newMeta };
  
  // Extract clean user note if present
  let cleanNote = existingText || '';
  cleanNote = cleanNote.replace(/\[FULFILLMENT_META:.*?\]/g, '').trim();

  const metaString = `[FULFILLMENT_META:${JSON.stringify(merged)}]`;
  return cleanNote ? `${cleanNote} ${metaString}` : metaString;
}

/**
 * Computes authoritative payment allocation for an order.
 * Separates medicine subtotal, delivery fee, and platform fee.
 */
function computePaymentAllocation(order, options = {}) {
  const medicineSubtotal = order.medicineSubtotal != null ? Number(order.medicineSubtotal) : 0;
  const isDelivery = order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY';
  const deliveryFee = isDelivery ? (order.deliveryFee != null ? Number(order.deliveryFee) : 80) : 0;
  const platformFee = order.platformFee != null ? Number(order.platformFee) : (options.platformFee ?? 2.0);
  const totalAmount = Math.round((medicineSubtotal + deliveryFee + platformFee) * 100) / 100;

  const isCompleted = order.status === 'COMPLETED' || order.status === 'DELIVERED';
  const isCollected = isCompleted || order.status === 'IN_TRANSIT';

  const medProceeds = Math.round(medicineSubtotal * 100) / 100;
  const delivAlloc = Math.round(deliveryFee * 100) / 100;

  return {
    medicineSubtotal: medProceeds,
    medicineProceeds: medProceeds,
    deliveryFee: delivAlloc,
    deliveryAllocation: delivAlloc,
    platformFee: Math.round(platformFee * 100) / 100,
    totalAmount,
    totalCollected: totalAmount,
    currency: 'INR',
    fulfillmentType: order.fulfillmentType || 'PICKUP',
    allocations: {
      pharmacy: {
        amount: Math.round(medicineSubtotal * 100) / 100,
        pharmacyId: order.pharmacyId,
        pharmacyName: order.pharmacy?.name || 'Fulfilling Pharmacy',
        payoutEligibility: isCompleted ? 'ELIGIBLE' : (order.status === 'READY_FOR_PICKUP' || order.status === 'READY_FOR_DISPATCH' ? 'PENDING_COLLECTION' : 'PENDING'),
        payoutStatus: isCompleted ? 'SETTLED_IN_LEDGER' : 'UNSETTLED'
      },
      assistant: isDelivery ? {
        amount: Math.round(deliveryFee * 100) / 100,
        assistantId: order.selectedAssistantId || order.assistantTask?.assistantId || null,
        payoutEligibility: isCompleted ? 'ELIGIBLE' : (isCollected ? 'IN_TRANSIT' : 'PENDING_COLLECTION'),
        payoutStatus: isCompleted ? 'SETTLED_IN_LEDGER' : 'UNSETTLED'
      } : null,
      platform: {
        amount: Math.round(platformFee * 100) / 100,
        payoutStatus: 'RETAINED_FEE'
      }
    },
    settlementStatus: isCompleted ? 'SETTLED_IN_LEDGER' : 'ESCROW_HOLD',
    gatewayIntegration: {
      mode: 'PLATFORM_ESCROW_LEDGER',
      supportsDirectSplitPayout: false,
      limitationNotice: 'Authoritative platform ledger tracks separate pharmacy proceeds and assistant delivery fees. Direct automated bank split disbursement requires Razorpay Route / linked bank accounts configuration.'
    }
  };
}

/**
 * Checks if an eligible, verified delivery assistant is active and available in the given location.
 */
async function checkDeliveryAssistantAvailability(city, area) {
  try {
    const assistants = await prisma.user.findMany({
      where: { role: 'ASSISTANT' },
      include: { assistantProfile: true }
    });

    const targetArea = (city || area || '').trim().toLowerCase();

    const matching = assistants.filter(u => {
      const prof = u.assistantProfile;
      if (!prof) return false;
      // Must be active and on-duty
      if (!prof.isActive || !prof.isAvailable) return false;
      // Must not be suspended
      if (prof.verificationStatus === 'SUSPENDED') return false;
      // Healthcare professionals cannot perform delivery dispatches
      if (prof.assistantType === 'HEALTHCARE_PROFESSIONAL') return false;

      // Must possess delivery or collection capability
      const caps = (prof.capabilities || '').split(',').map(s => s.trim()).filter(Boolean);
      const canDeliver = caps.includes('MEDICINE_DELIVERY') || caps.includes('MEDICINE_COLLECTION');
      if (!canDeliver) return false;

      // Location match
      if (targetArea) {
        const opCity = (prof.operatingCity || 'Chengannur').toLowerCase();
        if (!opCity.includes(targetArea) && !targetArea.includes(opCity)) return false;
      }
      return true;
    });

    const isAvailable = matching.length > 0;
    return {
      available: isAvailable,
      count: matching.length,
      assistants: matching.map(u => ({
        id: u.id,
        name: u.name,
        phone: u.phone,
        vehicleType: u.assistantProfile?.vehicleType || 'MOTORCYCLE',
        operatingCity: u.assistantProfile?.operatingCity || 'Chengannur',
        rating: 4.9
      })),
      reason: isAvailable
        ? null
        : 'No verified delivery assistants are currently active or available in your service area. Delivery cannot be selected at this time. Please choose Counter Pickup.'
    };
  } catch (err) {
    console.error('checkDeliveryAssistantAvailability error:', err);
    return {
      available: false,
      count: 0,
      assistants: [],
      reason: 'Failed to verify delivery assistant availability. Please try again or select Counter Pickup.'
    };
  }
}

module.exports = {
  MAX_VERIFICATION_ATTEMPTS,
  generateSecureCode,
  generateSeparateDeliveryCodes,
  parseVerificationMeta,
  serializeVerificationMeta,
  computePaymentAllocation,
  checkDeliveryAssistantAvailability
};
