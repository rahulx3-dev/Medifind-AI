/**
 * MediFind AI — Payment & Fulfillment Configuration
 * Phase 5.5
 *
 * SECURITY:
 * - RAZORPAY_KEY_SECRET must remain server-side only.
 * - Never expose RAZORPAY_KEY_SECRET to any client response.
 * - Amount is always computed server-side; never trust frontend amount.
 *
 * FEE RULES:
 * - PICKUP:             ₹0 (no delivery fee)
 * - DELIVERY:           configurable via DELIVERY_FEE_INR env var (default ₹50)
 * - ASSISTANT_DELIVERY: Medicine Access Assistant service fee — configurable via ASSISTANT_DELIVERY_FEE_INR env var (default ₹80)
 */

const path = require('path');
const dotenv = require('dotenv');

// Ensure server/.env is loaded deterministically relative to this directory
const serverEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: serverEnvPath });

const PICKUP_FEE = 0;
const DELIVERY_FEE = parseFloat(process.env.DELIVERY_FEE_INR || '50');
const ASSISTANT_DELIVERY_FEE = parseFloat(process.env.ASSISTANT_DELIVERY_FEE_INR || '80');
const ASSISTANT_SERVICE_FEE = ASSISTANT_DELIVERY_FEE; // Phase 6.1L.10: Consistent Assistant service fee
const PLATFORM_FEE = 2.0; // Phase 6.1L.10: Fixed platform fee (₹2)

const VALID_FULFILLMENT_TYPES = ['PICKUP', 'DELIVERY', 'ASSISTANT_DELIVERY'];

/**
 * Safe configuration diagnostic (never exposes secrets).
 * @returns {{ keyIdPresent: boolean, keySecretPresent: boolean, isTestMode: boolean, isConfigured: boolean }}
 */
function getPaymentConfigStatus() {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const keyIdPresent = Boolean(keyId);
  const keySecretPresent = Boolean(keySecret);
  const isTestMode = keyId.startsWith('rzp_test_');
  const isConfigured = keyIdPresent && keySecretPresent;

  return {
    keyIdPresent,
    keySecretPresent,
    isTestMode,
    isConfigured
  };
}

/**
 * Returns the authoritative fee for a given fulfillment type.
 * - PICKUP: always 0 (no delivery charge)
 * - DELIVERY: derived strictly from authoritative environment configuration (DELIVERY_FEE_INR)
 *   when supported by the pharmacy. No generic ₹50 model is assumed.
 * - ASSISTANT_DELIVERY: derived from configured Assistant service fee (ASSISTANT_SERVICE_FEE_INR / ASSISTANT_DELIVERY_FEE_INR)
 *   labeled as "Assistant service fee".
 *
 * @param {string} fulfillmentType
 * @param {string} [assistantServiceType]
 * @returns {number} fee in INR
 */
function getFulfillmentFee(fulfillmentType, assistantServiceType) {
  if (!fulfillmentType) return 0;
  switch (fulfillmentType) {
    case 'PICKUP':
      return PICKUP_FEE;
    case 'DELIVERY': {
      const configuredDeliveryFee = process.env.DELIVERY_FEE_INR
        ? parseFloat(process.env.DELIVERY_FEE_INR)
        : null;
      return (configuredDeliveryFee != null && !isNaN(configuredDeliveryFee)) ? configuredDeliveryFee : 0;
    }
    case 'ASSISTANT_DELIVERY': {
      const configuredAsstFee = parseFloat(
        process.env.ASSISTANT_SERVICE_FEE_INR || process.env.ASSISTANT_DELIVERY_FEE_INR || '80'
      );
      return (!isNaN(configuredAsstFee)) ? configuredAsstFee : 80;
    }
    default:
      throw new Error(`Unknown fulfillmentType: ${fulfillmentType}`);
  }
}

/**
 * Calculates order totals from confirmed OrderItem snapshots.
 * IMPORTANT: Uses snapshot unitPrice (from OrderItem), NOT current inventory price.
 *
 * SAFE UNPRICED MEDICINE HANDLING:
 * If medicine price is unavailable/null, medicineSubtotal is null.
 * Because Razorpay and online payment cannot process unknown medicine totals without fabricating prices,
 * totalAmount is null when medicineSubtotal is null. It is NEVER coerced into ₹0 or fake numbers.
 *
 * @param {Array} items - OrderItem array with { quantity, unitPrice }
 * @param {string} fulfillmentType
 * @param {Object} [options] - Optional flags: { includePlatformFee, platformFee }
 * @returns {{ medicineSubtotal: number|null, fulfillmentFee: number, platformFee: number, totalAmount: number|null, currency: string, requiresCounterPayment: boolean, unpricedItemsCount: number }}
 */
function calculateOrderTotals(items, fulfillmentType, options = {}) {
  const hasItems = Array.isArray(items) && items.length > 0;
  const allItemsPriced = hasItems && items.every(
    item => item.unitPrice != null && !isNaN(item.unitPrice) && Number(item.unitPrice) > 0
  );
  const unpricedItemsCount = hasItems
    ? items.filter(item => item.unitPrice == null || isNaN(item.unitPrice) || Number(item.unitPrice) <= 0).length
    : 0;

  let medicineSubtotal = null;
  let taxAmount = null;
  let baseAmount = null;

  if (allItemsPriced) {
    medicineSubtotal = items.reduce((sum, item) => {
      const lineSub = item.subtotal != null && !isNaN(item.subtotal) && Number(item.subtotal) > 0
        ? Number(item.subtotal)
        : Number(item.unitPrice) * Number(item.quantity || 1);
      return sum + lineSub;
    }, 0);
    medicineSubtotal = Math.round((medicineSubtotal + Number.EPSILON) * 100) / 100;

    // Standard 12% GST breakdown from inclusive retail price
    const taxRate = options.taxRate !== undefined ? Number(options.taxRate) : 0.12;
    if (taxRate > 0) {
      baseAmount = Math.round(((medicineSubtotal / (1 + taxRate)) + Number.EPSILON) * 100) / 100;
      taxAmount = Math.round(((medicineSubtotal - baseAmount) + Number.EPSILON) * 100) / 100;
    } else {
      baseAmount = medicineSubtotal;
      taxAmount = 0.0;
    }
  }

  const fulfillmentFee = getFulfillmentFee(fulfillmentType);

  let platformFee = 0.0;
  if (options.platformFee !== undefined) {
    platformFee = Number(options.platformFee);
  } else if (options.isChildOrder) {
    // Gate 4.2.2.2: Child orders never receive a fee just because ENABLE_PLATFORM_FEE is enabled
    platformFee = 0.0;
  } else if (options.includePlatformFee !== undefined) {
    platformFee = options.includePlatformFee ? PLATFORM_FEE : 0.0;
  } else {
    platformFee = (process.env.ENABLE_PLATFORM_FEE !== 'false') ? PLATFORM_FEE : 0.0;
  }

  // When medicineSubtotal is null, totalAmount is null (never fabricated into ₹0 or fake fee-only total)
  const totalAmount = medicineSubtotal != null
    ? Math.round(((medicineSubtotal + fulfillmentFee + platformFee) + Number.EPSILON) * 100) / 100
    : null;

  return {
    medicineSubtotal,
    taxAmount,
    baseAmount,
    isTaxIncluded: true,
    fulfillmentFee: Math.round((fulfillmentFee + Number.EPSILON) * 100) / 100,
    platformFee: Math.round((platformFee + Number.EPSILON) * 100) / 100,
    totalAmount,
    currency: 'INR',
    requiresCounterPayment: medicineSubtotal === null,
    unpricedItemsCount
  };
}

/**
 * Creates and returns a Razorpay instance.
 * Returns null with an error message if credentials are not configured.
 *
 * @returns {{ razorpay: import('razorpay') | null, configError: string | null }}
 */
function getRazorpayInstance() {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    return {
      razorpay: null,
      configError:
        'Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server environment variables to enable online payments.'
    };
  }

  // Validate these look like Razorpay test keys in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
      console.warn('[PaymentConfig] RAZORPAY_KEY_ID does not look like a valid Razorpay key ID.');
    }
  }

  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  return { razorpay, configError: null };
}

/**
 * Returns the Razorpay public key ID (safe to expose to frontend).
 * Returns null if not configured.
 */
function getRazorpayKeyId() {
  return (process.env.RAZORPAY_KEY_ID || '').trim() || null;
}

module.exports = {
  PICKUP_FEE,
  DELIVERY_FEE,
  ASSISTANT_DELIVERY_FEE,
  ASSISTANT_SERVICE_FEE,
  PLATFORM_FEE,
  VALID_FULFILLMENT_TYPES,
  getPaymentConfigStatus,
  getFulfillmentFee,
  calculateOrderTotals,
  getRazorpayInstance,
  getRazorpayKeyId
};

