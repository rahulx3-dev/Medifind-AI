import { referencePricingData } from '../data/medicineReferencePricing.js';

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up verified reference pricing and pack details for a medicine
 * @param {string} brandName
 * @param {string} [genericName]
 * @returns {object|null}
 */
export function getVerifiedMedicineDetails(brandName, genericName) {
  if (!brandName && !genericName) return null;
  const brandNorm = normalizeName(brandName);
  const genNorm = normalizeName(genericName);

  // 1. Exact match on brandName
  let match = referencePricingData.find(item => normalizeName(item.brandName) === brandNorm);
  if (match) return match;

  // 2. Partial match on brandName
  match = referencePricingData.find(item => {
    const itemNorm = normalizeName(item.brandName);
    return brandNorm.includes(itemNorm) || itemNorm.includes(brandNorm);
  });
  if (match) return match;

  // 3. Match on genericName
  if (genNorm) {
    match = referencePricingData.find(item => {
      const itemGenNorm = normalizeName(item.genericName);
      return itemGenNorm === genNorm || genNorm.includes(itemGenNorm);
    });
    if (match) return match;
  }

  return null;
}

/**
 * Rounds a number to exactly 2 decimal places using currency rounding
 * to avoid floating-point accumulation errors.
 */
export function roundCurrency(val) {
  if (val == null || isNaN(val)) return null;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates per-tablet or per-unit price from pack price and units per pack.
 */
export function calculateUnitPrice(packPrice, unitsPerPack) {
  if (packPrice == null || isNaN(packPrice) || Number(packPrice) <= 0) return null;
  if (unitsPerPack == null || isNaN(unitsPerPack) || Number(unitsPerPack) <= 0) {
    return roundCurrency(Number(packPrice));
  }
  return roundCurrency(Number(packPrice) / Number(unitsPerPack));
}

/**
 * Determines valid supported sale units based on dosage form and pack size.
 */
export function getSupportedSaleUnits(dosageForm = '', unitsPerPack = 1) {
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
 * Authoritative client-side medicine pricing and quantity calculation helper.
 */
export function calculateMedicinePricing({
  publishedMrp,
  unitPrice,
  unitsPerPack,
  dosageForm = 'Tablet',
  saleUnit = null,
  quantity = 1,
  taxRate = 0.12
}) {
  const qty = parseInt(quantity, 10) || 1;
  const numUnitsPerPack = Number(unitsPerPack) || 1;

  if (unitsPerPack == null || isNaN(numUnitsPerPack) || numUnitsPerPack <= 0) {
    return {
      isValid: false,
      error: 'MISSING_OR_INVALID_PACK_SIZE',
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

  let mrp = publishedMrp != null && !isNaN(publishedMrp) && Number(publishedMrp) > 0
    ? roundCurrency(Number(publishedMrp))
    : null;

  let resolvedUnitPrice = unitPrice != null && !isNaN(unitPrice) && Number(unitPrice) > 0
    ? roundCurrency(Number(unitPrice))
    : null;

  if (resolvedUnitPrice == null && mrp != null) {
    resolvedUnitPrice = calculateUnitPrice(mrp, numUnitsPerPack);
  } else if (mrp == null && resolvedUnitPrice != null) {
    mrp = roundCurrency(resolvedUnitPrice * numUnitsPerPack);
  }

  if (mrp == null && resolvedUnitPrice == null) {
    return {
      isValid: false,
      isUnpriced: true,
      error: 'UNPRICED_MEDICINE',
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

  const supportedSaleUnits = getSupportedSaleUnits(dosageForm, numUnitsPerPack);
  const allowIndividualUnit = numUnitsPerPack > 1 && (
    (dosageForm || '').toLowerCase().includes('tablet') ||
    (dosageForm || '').toLowerCase().includes('capsule')
  );

  let effectiveSaleUnit = (saleUnit || '').toUpperCase().trim();
  if (!effectiveSaleUnit) {
    if (!allowIndividualUnit) {
      effectiveSaleUnit = supportedSaleUnits[0];
    } else {
      effectiveSaleUnit = qty < numUnitsPerPack ? ((dosageForm || '').toLowerCase().includes('capsule') ? 'CAPSULE' : 'TABLET') : 'STRIP';
    }
  }

  const isIndividualUnit = effectiveSaleUnit === 'TABLET' || effectiveSaleUnit === 'CAPSULE' || effectiveSaleUnit === 'UNIT';
  if (isIndividualUnit && !allowIndividualUnit) {
    effectiveSaleUnit = supportedSaleUnits[0];
  }

  let effectiveUnitPrice = null;
  let lineTotal = null;
  let totalTabletsOrUnits = null;

  if (effectiveSaleUnit === 'STRIP' || effectiveSaleUnit === 'PACK') {
    effectiveUnitPrice = mrp;
    lineTotal = roundCurrency(mrp * qty);
    totalTabletsOrUnits = qty * numUnitsPerPack;
  } else {
    effectiveUnitPrice = resolvedUnitPrice;
    lineTotal = roundCurrency(resolvedUnitPrice * qty);
    totalTabletsOrUnits = qty;
  }

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
 * Calculates tax breakdown from inclusive total.
 */
export function calculateTaxBreakdown(totalAmount, taxRate = 0.12) {
  if (totalAmount == null || isNaN(totalAmount)) {
    return { baseAmount: 0, taxAmount: 0, totalAmount: 0 };
  }
  const total = roundCurrency(Number(totalAmount));
  const rate = Number(taxRate) > 0 ? Number(taxRate) : 0;
  const baseAmount = rate > 0 ? roundCurrency(total / (1 + rate)) : total;
  const taxAmount = roundCurrency(total - baseAmount);
  return { baseAmount, taxAmount, totalAmount: total };
}

/**
 * Get verified price display string or numeric value
 */
export function getVerifiedPrice(med) {
  if (med?.publishedMrp != null) return roundCurrency(med.publishedMrp);
  if (med?.price != null) return roundCurrency(med.price);
  const details = getVerifiedMedicineDetails(med?.brandName, med?.genericName);
  if (details?.publishedMrp != null) return roundCurrency(details.publishedMrp);
  if (details?.unitPrice != null) return roundCurrency(details.unitPrice);
  return null;
}

/**
 * Get verified per-tablet / per-unit price
 */
export function getVerifiedUnitPrice(med) {
  if (med?.unitPrice != null) return roundCurrency(med.unitPrice);
  const details = getVerifiedMedicineDetails(med?.brandName, med?.genericName);
  if (details?.unitPrice != null) return roundCurrency(details.unitPrice);
  if (details?.publishedMrp != null && details?.unitsPerPack) {
    return calculateUnitPrice(details.publishedMrp, details.unitsPerPack);
  }
  return null;
}

/**
 * Get verified pack size or quantity info
 */
export function getVerifiedPackSize(med) {
  const details = getVerifiedMedicineDetails(med?.brandName, med?.genericName);
  if (details?.packSize) return details.packSize;
  if (med?.packSize) return med.packSize;
  if (med?.dosageForm && med?.strength) {
    return `${med.dosageForm} • ${med.strength}`;
  }
  return med?.dosageForm || 'Standard Pack';
}

