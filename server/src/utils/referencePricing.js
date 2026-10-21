/**
 * MediFind AI — Authoritative Medicine Reference Pricing Utility
 *
 * Provides lookup and verification against the 50-medicine academic reference catalogue
 * (server/src/data/medicineReferencePricing.json).
 *
 * RULES:
 * - Prices reflect published Indian MRPs divided by pack size to produce exact unit price.
 * - For tablets/capsules: unitPrice is per tablet/capsule.
 * - For syrups: unitPrice is per bottle.
 * - For inhalers: unitPrice is per inhaler.
 * - For injections: unitPrice is per vial/ampoule.
 * - Unverified or unavailable products (e.g. Epinephrine Auto-Injector) return unitPrice: null.
 * - These prices are public reference prices for academic demonstration, not pharmacy-confirmed
 *   prices for Max Care Pharmacy or Karuna Medicals.
 */

const path = require('path');
const fs = require('fs');

const PRICING_DATA_PATH = path.join(__dirname, '..', 'data', 'medicineReferencePricing.json');

let cachedPricing = null;

function loadReferencePricing() {
  if (!cachedPricing) {
    try {
      const raw = fs.readFileSync(PRICING_DATA_PATH, 'utf8');
      cachedPricing = JSON.parse(raw);
    } catch (err) {
      console.error('[ReferencePricing] Failed to load medicineReferencePricing.json:', err.message);
      cachedPricing = [];
    }
  }
  return cachedPricing;
}

/**
 * Normalizes medicine name for matching
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up reference pricing record for a given brand name or generic name.
 * @param {string} brandName
 * @param {string} [genericName]
 * @returns {Object|null} Reference pricing object or null
 */
function getReferencePricing(brandName, genericName) {
  const catalogue = loadReferencePricing();
  if (!catalogue || catalogue.length === 0) return null;

  const targetBrandNorm = normalizeName(brandName);
  const targetGenericNorm = normalizeName(genericName);

  // 1. Exact or normalized brandName match
  let match = catalogue.find(item => {
    const itemBrandNorm = normalizeName(item.brandName);
    return itemBrandNorm === targetBrandNorm;
  });

  if (match) return match;

  // 2. Partial brandName match (e.g. "Dolo 650 Tablet" -> "Dolo 650")
  match = catalogue.find(item => {
    const itemBrandNorm = normalizeName(item.brandName);
    return targetBrandNorm.includes(itemBrandNorm) || itemBrandNorm.includes(targetBrandNorm);
  });

  if (match) return match;

  // 3. Fallback to genericName match if provided
  if (genericName) {
    match = catalogue.find(item => {
      const itemGenNorm = normalizeName(item.genericName);
      return itemGenNorm === targetGenericNorm || targetGenericNorm.includes(itemGenNorm);
    });
  }

  return match || null;
}

/**
 * Returns all 50 reference pricing records.
 */
function getAllReferencePricing() {
  return loadReferencePricing();
}

/**
 * Rounds a number to exactly 2 decimal places using currency rounding
 * to avoid floating-point accumulation errors (e.g. 10.51 * 3 = 31.53, not 31.530000000000005).
 * @param {number|null} val
 * @returns {number|null}
 */
function roundCurrency(val) {
  if (val == null || isNaN(val)) return null;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates per-tablet or per-unit price from pack price and units per pack.
 * Validates pack size and flags missing or invalid pack sizes safely.
 * @param {number|null} packPrice
 * @param {number|null} unitsPerPack
 * @returns {number|null}
 */
function calculateUnitPrice(packPrice, unitsPerPack) {
  if (packPrice == null || isNaN(packPrice) || Number(packPrice) <= 0) return null;
  if (unitsPerPack == null || isNaN(unitsPerPack) || Number(unitsPerPack) <= 0) {
    return roundCurrency(Number(packPrice));
  }
  return roundCurrency(Number(packPrice) / Number(unitsPerPack));
}

/**
 * Determines valid supported sale units based on dosage form and pack size.
 * Tablets and capsules in multi-unit packs can be sold as full STRIP or individual TABLET/CAPSULE.
 * Non-breakable formulations (syrups, inhalers, injections) can only be sold as complete units (BOTTLE/INHALER/VIAL).
 * @param {string} dosageForm
 * @param {number} unitsPerPack
 * @returns {string[]}
 */
function getSupportedSaleUnits(dosageForm = '', unitsPerPack = 1) {
  const formLower = (dosageForm || '').toLowerCase();
  const units = Number(unitsPerPack) || 1;

  if (formLower.includes('tablet')) {
    return units > 1 ? ['STRIP', 'TABLET'] : ['TABLET'];
  }
  if (formLower.includes('capsule')) {
    return units > 1 ? ['STRIP', 'CAPSULE'] : ['CAPSULE'];
  }
  if (formLower.includes('syrup')) {
    return ['BOTTLE'];
  }
  if (formLower.includes('inhaler')) {
    return ['INHALER'];
  }
  if (formLower.includes('injection')) {
    return ['VIAL'];
  }
  return units > 1 ? ['STRIP', 'UNIT'] : ['UNIT'];
}

/**
 * Authoritative single-source-of-truth pricing and quantity calculator.
 *
 * Rules:
 * - Never multiplies the strip price by the tablet count when calculating the price of a single tablet.
 * - If 10-tablet strip of Taxim-O 200 costs ₹105.10:
 *     - 1 tablet = ₹10.51
 *     - 3 tablets = ₹31.53
 *     - 10 tablets = ₹105.10
 *     - 1 strip = ₹105.10
 *     - 2 strips = ₹210.20
 * - Non-breakable medicines (syrup, inhaler, injection) only support whole-pack units.
 * - Missing or invalid pack-size data is safely flagged without guessing.
 * - Floating-point currency errors are prevented via roundCurrency.
 *
 * @param {Object} params
 * @param {number|null} params.publishedMrp - The pack/strip MRP (e.g. 105.10)
 * @param {number|null} [params.unitPrice] - The per-tablet/unit price (e.g. 10.51)
 * @param {number|null} params.unitsPerPack - Units per pack (e.g. 10)
 * @param {string} [params.dosageForm] - e.g. 'Tablet', 'Syrup'
 * @param {string} [params.saleUnit] - 'STRIP' | 'PACK' | 'TABLET' | 'CAPSULE' | 'UNIT' | 'BOTTLE' | 'INHALER' | 'VIAL'
 * @param {number} [params.quantity] - Selected quantity of the specified saleUnit (default 1)
 * @param {number} [params.taxRate] - Optional tax rate (default 0.12 for GST 12% included in MRP)
 * @returns {Object}
 */
function calculateMedicinePricing({
  publishedMrp,
  unitPrice,
  unitsPerPack,
  dosageForm = 'Tablet',
  saleUnit = null,
  quantity = 1,
  taxRate = 0.12
}) {
  const qty = parseInt(quantity, 10) || 1;
  const numUnitsPerPack = Number(unitsPerPack);

  // 1. Validate pack size
  if (unitsPerPack == null || isNaN(numUnitsPerPack) || numUnitsPerPack <= 0) {
    return {
      isValid: false,
      error: 'MISSING_OR_INVALID_PACK_SIZE',
      message: 'Pack size data is missing or invalid; unit price cannot be safely determined.',
      publishedMrp: publishedMrp != null ? roundCurrency(publishedMrp) : null,
      unitPrice: null,
      unitsPerPack: null,
      saleUnit: null,
      quantity: qty,
      lineTotal: null,
      subtotal: null,
      taxAmount: null,
      requiresCounterPayment: true
    };
  }

  // 2. Resolve pack MRP and per-unit price
  const mrp = publishedMrp != null && !isNaN(publishedMrp) && Number(publishedMrp) > 0
    ? roundCurrency(Number(publishedMrp))
    : null;

  let resolvedUnitPrice = unitPrice != null && !isNaN(unitPrice) && Number(unitPrice) > 0
    ? roundCurrency(Number(unitPrice))
    : null;

  if (resolvedUnitPrice == null && mrp != null) {
    resolvedUnitPrice = calculateUnitPrice(mrp, numUnitsPerPack);
  } else if (mrp == null && resolvedUnitPrice != null) {
    // If pack MRP is missing but unit price is provided
    mrp = roundCurrency(resolvedUnitPrice * numUnitsPerPack);
  }

  // 3. Handle unpriced medicines (e.g. Epinephrine Auto-Injector)
  if (mrp == null && resolvedUnitPrice == null) {
    return {
      isValid: false,
      isUnpriced: true,
      error: 'UNPRICED_MEDICINE',
      message: 'Medicine price is not established; requires counter payment at dispensary.',
      publishedMrp: null,
      unitPrice: null,
      effectiveUnitPrice: null,
      unitsPerPack: numUnitsPerPack,
      saleUnit: saleUnit || 'UNIT',
      quantity: qty,
      lineTotal: null,
      subtotal: null,
      taxAmount: null,
      requiresCounterPayment: true
    };
  }

  // 4. Resolve allowed sale units and configured rules
  const supportedSaleUnits = getSupportedSaleUnits(dosageForm, numUnitsPerPack);
  const allowIndividualUnit = numUnitsPerPack > 1 && (
    (dosageForm || '').toLowerCase().includes('tablet') ||
    (dosageForm || '').toLowerCase().includes('capsule')
  );

  let effectiveSaleUnit = (saleUnit || '').toUpperCase().trim();

  // If sale unit is not specified, resolve intuitively:
  if (!effectiveSaleUnit) {
    if (!allowIndividualUnit) {
      effectiveSaleUnit = supportedSaleUnits[0]; // BOTTLE, INHALER, VIAL, UNIT
    } else {
      // For multi-tablet packs: if quantity < unitsPerPack, default to TABLET/CAPSULE; if multiple, STRIP
      if (qty < numUnitsPerPack) {
        effectiveSaleUnit = (dosageForm || '').toLowerCase().includes('capsule') ? 'CAPSULE' : 'TABLET';
      } else {
        effectiveSaleUnit = 'STRIP';
      }
    }
  }

  // Validate sale unit against pharmacy/product support
  const isStripOrPack = effectiveSaleUnit === 'STRIP' || effectiveSaleUnit === 'PACK';
  const isIndividualUnit = effectiveSaleUnit === 'TABLET' || effectiveSaleUnit === 'CAPSULE' || effectiveSaleUnit === 'UNIT';

  if (isIndividualUnit && !allowIndividualUnit) {
    // Attempted to buy individual ml from a syrup bottle or sprays from an inhaler: coerce to whole unit
    effectiveSaleUnit = supportedSaleUnits[0];
  }

  // 5. Calculate line total strictly according to selected sale unit
  let effectiveUnitPrice = null;
  let lineTotal = null;
  let totalTabletsOrUnits = null;

  if (effectiveSaleUnit === 'STRIP' || effectiveSaleUnit === 'PACK') {
    effectiveUnitPrice = mrp; // price per strip
    lineTotal = roundCurrency(mrp * qty);
    totalTabletsOrUnits = qty * numUnitsPerPack;
  } else {
    // Individual unit (TABLET / CAPSULE / UNIT)
    effectiveUnitPrice = resolvedUnitPrice; // price per tablet
    lineTotal = roundCurrency(resolvedUnitPrice * qty);
    totalTabletsOrUnits = qty;
  }

  // 6. Calculate tax breakdown (MRP is GST inclusive in India)
  const rate = Number(taxRate) > 0 ? Number(taxRate) : 0;
  const baseSubtotal = rate > 0
    ? roundCurrency(lineTotal / (1 + rate))
    : lineTotal;
  const taxAmount = rate > 0
    ? roundCurrency(lineTotal - baseSubtotal)
    : 0.0;

  return {
    isValid: true,
    publishedMrp: mrp,
    unitPrice: resolvedUnitPrice,
    unitsPerPack: numUnitsPerPack,
    dosageForm,
    supportedSaleUnits,
    allowIndividualUnit,
    saleUnit: effectiveSaleUnit,
    quantity: qty,
    effectiveUnitPrice,
    lineTotal,
    subtotal: baseSubtotal,
    taxAmount,
    totalTabletsOrUnits,
    requiresCounterPayment: false
  };
}

/**
 * Calculates tax breakdown from an inclusive total amount.
 * @param {number} totalAmount
 * @param {number} [taxRate=0.12]
 * @returns {{ baseAmount: number, taxAmount: number, totalAmount: number }}
 */
function calculateTaxBreakdown(totalAmount, taxRate = 0.12) {
  if (totalAmount == null || isNaN(totalAmount)) {
    return { baseAmount: 0, taxAmount: 0, totalAmount: 0 };
  }
  const total = roundCurrency(Number(totalAmount));
  const rate = Number(taxRate) > 0 ? Number(taxRate) : 0;
  const baseAmount = rate > 0 ? roundCurrency(total / (1 + rate)) : total;
  const taxAmount = roundCurrency(total - baseAmount);
  return { baseAmount, taxAmount, totalAmount: total };
}

module.exports = {
  loadReferencePricing,
  getReferencePricing,
  getAllReferencePricing,
  PRICING_DATA_PATH,
  normalizeName,
  roundCurrency,
  calculateUnitPrice,
  getSupportedSaleUnits,
  calculateMedicinePricing,
  calculateTaxBreakdown
};

