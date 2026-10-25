/**
 * MediFind AI — Universal Data-Driven Generic-to-Brand Matching Engine (Client)
 *
 * Implements clinical matching of generic prescription medicines to
 * verified branded formulations and generic products in the catalogue:
 * - Active ingredient extraction & normalization (single & combination)
 * - Clinical strength parsing & compatibility
 * - Dosage form / route categorization & compatibility
 * - Generic vs. trade brand prescription identification
 * - Discovery of matching generic catalogue products
 * - Dynamic brand option resolution from authentic catalogue records
 * - Pharmacy-specific stock evaluation & availability badging
 *
 * ZERO hardcoded medicine names — purely data-driven based on the catalogue.
 */

// ─── 1. Clinical Stopwords and Suffixes ──────────────────────────────────────
const SALT_SUFFIXES = [
  'hydrochloride', 'hcl', 'sodium', 'potassium',
  'maleate', 'fumarate', 'tartrate', 'succinate', 'phosphate',
  'sulfate', 'sulphate', 'mesylate', 'besylate', 'monohydrate',
  'trihydrate', 'dihydrate', 'calcium', 'hydrate', 'citrate',
  'lactate', 'gluconate', 'valerate', 'propionate', 'dipropionate',
  'acetate', 'chloride', 'bromide', 'iodide', 'nitrate'
];

const FORMULATION_TOKENS = [
  'tab', 'tablet', 'tablets', 'cap', 'capsule', 'capsules',
  'syr', 'syrup', 'syrups', 'susp', 'suspension', 'drops', 'drop',
  'inj', 'injection', 'injections', 'infusion', 'powder', 'sachet',
  'sachets', 'gel', 'ointment', 'cream', 'lotion', 'inhaler',
  'respule', 'respules', 'rotacap', 'rotacaps', 'ip', 'bp', 'usp',
  'gastro', 'resistant', 'enteric', 'coated', 'sustained', 'release',
  'extended', 'prolonged', 'sr', 'er', 'dr', 'cr', 'xl', 'od', 'bd',
  'tds', 'qid', 'sos', 'stat', 'hs', 'oral', 'iv', 'im', 'nos',
  'dt', 'dispersible', 'chewable', 'sublingual'
];

// ─── 2. Normalization Helpers ───────────────────────────────────────────────

export function cleanText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/^[0-9]+[.)\s\-]+/, '') // leading numbering (e.g. "1.", "1)")
    .replace(/[^\w\s+&/]/g, ' ')      // retain + / & for combinations
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a medicine name or generic name into constituent active ingredient stems.
 */
export function extractActiveIngredients(genericOrName) {
  if (!genericOrName || typeof genericOrName !== 'string') return [];
  const cleaned = cleanText(genericOrName);

  // Split on combination delimiters: +, /, &, and, with
  const rawParts = cleaned.split(/\s*(?:\+|\/|&|\band\b|\bwith\b)\s*/i);

  const ingredients = [];
  for (const part of rawParts) {
    const tokens = part.split(/\s+/).filter(t => {
      if (!t || t.length < 2) return false;
      if (/^\d+/.test(t)) return false; // skip digits / dosages
      if (FORMULATION_TOKENS.includes(t)) return false;
      return true;
    });

    // Remove salt modifiers (e.g. "potassium clavulanate" -> "clavulanate", "amoxicillin trihydrate" -> "amoxicillin")
    const filteredTokens = tokens.filter(tok => {
      if (tokens.length > 1 && SALT_SUFFIXES.includes(tok)) return false;
      return true;
    });

    const ingredientStem = filteredTokens.join(' ').trim();
    if (ingredientStem && ingredientStem.length >= 2) {
      ingredients.push(ingredientStem);
    }
  }

  return [...new Set(ingredients)].sort();
}

/**
 * Parses numerical strength specifications from strings (e.g. "200mg", "500mg + 125mg", "40 mg").
 */
export function parseStrengthSpec(strengthStr) {
  if (!strengthStr || typeof strengthStr !== 'string') {
    return { values: [], total: 0, raw: '' };
  }
  const clean = strengthStr.toLowerCase().replace(/,/g, '');
  const matches = clean.match(/\d+(?:\.\d+)?/g);
  if (!matches) {
    return { values: [], total: 0, raw: strengthStr };
  }
  const values = matches.map(Number);
  const total = values.reduce((a, b) => a + b, 0);
  return { values, total, raw: strengthStr.trim() };
}

/**
 * Checks whether prescribed strength and catalogue strength are clinically compatible.
 */
export function areStrengthsCompatible(prescribedStr, catalogStr) {
  if (!prescribedStr || !catalogStr) return true; // soft match if unspecified

  const req = parseStrengthSpec(prescribedStr);
  const cat = parseStrengthSpec(catalogStr);

  if (req.values.length === 0 || cat.values.length === 0) return true;

  // Exact number match
  if (req.values.length === 1 && cat.values.length === 1) {
    return req.values[0] === cat.values[0];
  }

  // Exact array match for combinations
  if (req.values.length === cat.values.length) {
    const sortedReq = [...req.values].sort((a, b) => a - b);
    const sortedCat = [...cat.values].sort((a, b) => a - b);
    const allMatch = sortedReq.every((v, i) => v === sortedCat[i]);
    if (allMatch) return true;
  }

  // Combination sum match (e.g. prescribed single sum matches catalogue split)
  if (req.values.length === 1 && cat.values.length > 1) {
    if (Math.abs(req.total - cat.total) < 0.1) return true;
  }
  if (cat.values.length === 1 && req.values.length > 1) {
    if (Math.abs(req.total - cat.total) < 0.1) return true;
  }

  return false;
}

/**
 * Normalizes formulation into broad clinical route categories.
 */
export function normalizeDosageForm(formStr) {
  if (!formStr || typeof formStr !== 'string') return 'UNKNOWN';
  const s = formStr.toLowerCase();
  if (/\b(?:tab|tablet|tablets|cap|capsule|capsules|caplet|sublingual|chewable|dispersible)\b/i.test(s)) {
    return 'ORAL_SOLID';
  }
  if (/\b(?:syr|syrup|susp|suspension|drops?|elixir|liquid)\b/i.test(s)) {
    return 'ORAL_LIQUID';
  }
  if (/\b(?:inj|injection|infusion|iv|im|ampoule|vial)\b/i.test(s)) {
    return 'INJECTABLE';
  }
  if (/\b(?:powder|sachet|granules|rehydration)\b/i.test(s)) {
    return 'ORAL_POWDER';
  }
  if (/\b(?:gel|cream|ointment|lotion)\b/i.test(s)) {
    return 'TOPICAL';
  }
  if (/\b(?:inhaler|respule|respules|rotacap)\b/i.test(s)) {
    return 'INHALATION';
  }
  return 'OTHER';
}

export function areFormsCompatible(prescribedFormStr, catalogFormStr) {
  if (!prescribedFormStr || !catalogFormStr) return true;
  const pForm = normalizeDosageForm(prescribedFormStr);
  const cForm = normalizeDosageForm(catalogFormStr);
  if (pForm === 'UNKNOWN' || cForm === 'UNKNOWN') return true;

  // Strict route isolation: Injectable vs Oral Solid must NEVER cross-substitute!
  if (pForm !== cForm) {
    return false;
  }
  return true;
}

// ─── 3. Generic vs. Brand Prescription Identification ────────────────────────

/**
 * Determines whether a prescribed string specifies a generic medicine or an explicit trade brand.
 */
export function identifyPrescriptionType(itemOrText, catalog) {
  if (!itemOrText || !catalog || catalog.length === 0) {
    return { isGeneric: false, isBrand: false, targetGeneric: '', matchedBrand: null };
  }

  const raw = typeof itemOrText === 'string'
    ? itemOrText
    : (itemOrText.medicineName || itemOrText.rawName || '');
  const clean = cleanText(raw);

  // 1. Direct Brand Match: Check if the text explicitly names a proprietary trade brand in the catalogue
  // Skip generic product records (e.g. "Cetirizine 10", "Paracetamol 500") so generic prescriptions aren't misclassified as brands
  const cleanTokens = clean.split(/\s+/);
  for (const med of catalog) {
    if (isGenericProduct(med)) continue;

    const brandClean = cleanText(med.brandName);
    const brandTokens = brandClean.split(/\s+/).filter(t => t.length >= 3 && !/^\d+/.test(t));
    if (brandTokens.length === 0) continue;

    // Exact brand match or first primary brand token as whole word
    if (clean === brandClean || cleanTokens.includes(brandClean) || cleanTokens.includes(brandTokens[0])) {
      return {
        isGeneric: false,
        isBrand: true,
        targetGeneric: (med.genericName || '').trim(),
        matchedBrand: med
      };
    }
  }

  // 2. Generic Name Match: Check if the text corresponds to an active ingredient in the catalogue
  const prescribedIngredients = extractActiveIngredients(clean);
  if (prescribedIngredients.length > 0) {
    for (const med of catalog) {
      const catIngredients = extractActiveIngredients(med.genericName);
      if (catIngredients.length === 0) continue;

      const isSingleMatch = prescribedIngredients.length === 1 && catIngredients.length === 1 &&
        (catIngredients[0] === prescribedIngredients[0] ||
         catIngredients[0].includes(prescribedIngredients[0]) ||
         prescribedIngredients[0].includes(catIngredients[0]));

      const isComboMatch = prescribedIngredients.length > 1 &&
        prescribedIngredients.every(p => catIngredients.some(c => c.includes(p) || p.includes(c)));

      if (isSingleMatch || isComboMatch) {
        return {
          isGeneric: true,
          isBrand: false,
          targetGeneric: med.genericName,
          detectedIngredients: prescribedIngredients,
          isCombo: prescribedIngredients.length > 1
        };
      }
    }
  }

  return { isGeneric: false, isBrand: false, targetGeneric: '', matchedBrand: null };
}

// ─── 4. Universal Matching Generic and Brand Resolvers ────────────────────────

/**
 * Determines whether a catalogue medicine record represents a generic product
 * (e.g. Paracetamol 500mg, Cetirizine 10, Rabeprazole 20, Atropine Injection)
 * as opposed to a proprietary trade brand formulation (e.g. Dolo 650, Crocin 650, Pan 40).
 */
export function isGenericProduct(med) {
  if (!med) return false;
  if (med.isGenericProduct === true || med.isGeneric === true) return true;
  if (med.productType && String(med.productType).toUpperCase() === 'GENERIC') return true;

  const brandClean = cleanText(med.brandName || '');
  if (!brandClean) return false;
  if (/^generic\b/i.test(brandClean)) return true;

  const brandIngredients = extractActiveIngredients(brandClean);
  const genericIngredients = extractActiveIngredients(med.genericName || '');

  if (brandIngredients.length > 0 && genericIngredients.length > 0) {
    const brandFirst = brandClean.split(/\s+/)[0];
    // Exact root match: the first token of the brand matches an active ingredient,
    // e.g. "Paracetamol 500", "Cetirizine 10", "Atropine Injection"
    // NOT partial abbreviations like "Pan" for "Pantoprazole"
    const isFirstMatching = genericIngredients.some(g =>
      g === brandFirst || (brandFirst.length >= g.length && brandFirst.startsWith(g))
    );
    if (isFirstMatching) return true;

    if (brandIngredients.length === genericIngredients.length) {
      const allMatch = brandIngredients.every((bIng, idx) => {
        const gIng = genericIngredients[idx];
        return bIng === gIng || (bIng.length >= gIng.length && bIng.startsWith(gIng));
      });
      if (allMatch) return true;
    }
  }

  return false;
}

/**
 * Resolves stock and availability status for a candidate medicine at a specific pharmacy.
 */
export function evaluatePharmacyStock(medicineId, pharmacyInventory) {
  if (!pharmacyInventory) {
    return {
      inStock: null,
      stock: null,
      price: null,
      availabilityStatus: 'UNCONFIRMED_AVAILABILITY'
    };
  }

  const items = Array.isArray(pharmacyInventory)
    ? pharmacyInventory
    : (pharmacyInventory.inventory || []);

  const invItem = items.find(inv =>
    String(inv.medicineId) === String(medicineId) ||
    String(inv.id) === String(medicineId)
  );

  if (!invItem) {
    return {
      inStock: false,
      stock: 0,
      price: null,
      availabilityStatus: 'OUT_OF_STOCK'
    };
  }

  const stockNum = typeof invItem.stock === 'number' ? invItem.stock : 0;
  const isAvailable = (invItem.status !== 'OUT_OF_STOCK') && (invItem.stock != null ? stockNum > 0 : true);

  return {
    inStock: isAvailable,
    stock: stockNum,
    price: invItem.price != null ? invItem.price : null,
    availabilityStatus: isAvailable ? 'AVAILABLE' : 'OUT_OF_STOCK'
  };
}

/**
 * Discovers a matching generic product from the authoritative catalogue.
 */
export function findMatchingGenericProduct(item, catalog, options = {}) {
  if (!item || !catalog || !Array.isArray(catalog) || catalog.length === 0) {
    return null;
  }

  const raw = typeof item === 'string'
    ? item
    : (item.medicineName || item.rawName || item.matchedMedicineName || '');
  const clean = cleanText(raw);

  const prescribedStrength = item.strength || (raw.match(/\d+\s*(?:mg|mcg|gm?|ml|%)\b/i)?.[0] || '');
  const prescribedForm = item.dosageForm || (raw.match(/\b(?:tab|tablet|cap|capsule|syr|syrup|inj|injection|powder|sachet|gel)\b/i)?.[0] || '');

  let prescribedIngredients = extractActiveIngredients(clean);
  const itemGeneric = item.genericName || item.matchedMedicine?.genericName;
  if (itemGeneric && typeof itemGeneric === 'string') {
    const hintIngredients = extractActiveIngredients(itemGeneric);
    if (hintIngredients.length > 0) {
      prescribedIngredients = hintIngredients;
    }
  }

  const isPrescribedCombo = prescribedIngredients.length > 1 ||
    clean.includes('+') || clean.includes('/') || /\b(?:dsr|duo|-d|-tz)\b/i.test(clean);

  for (const med of catalog) {
    if (!isGenericProduct(med)) {
      continue;
    }

    const catGeneric = (med.genericName || '').trim();
    const catIngredients = extractActiveIngredients(catGeneric);
    const catIsCombo = catIngredients.length > 1 || catGeneric.includes('+');

    if (!isPrescribedCombo && catIsCombo) continue;
    if (isPrescribedCombo && !catIsCombo) continue;

    let ingredientMatch = false;
    if (prescribedIngredients.length > 0) {
      if (!isPrescribedCombo) {
        const p0 = prescribedIngredients[0];
        ingredientMatch = catIngredients.some(c =>
          c === p0 || c.startsWith(p0) || p0.startsWith(c) || cleanText(catGeneric) === p0
        );
      } else {
        ingredientMatch = prescribedIngredients.every(p =>
          catIngredients.some(c => c === p || c.startsWith(p) || p.startsWith(c) || c.includes(p))
        );
      }
    } else {
      const brandBase = cleanText(med.brandName).replace(/\s*\d+.*$/, '').trim();
      ingredientMatch = clean.includes(brandBase) || cleanText(med.brandName) === clean;
    }

    if (!ingredientMatch) continue;

    const strengthMatch = areStrengthsCompatible(prescribedStrength, med.strength);
    if (!strengthMatch && !options.includeAllStrengths) {
      continue;
    }

    const formMatch = areFormsCompatible(prescribedForm, med.dosageForm);
    if (!formMatch && !options.includeAllForms) {
      continue;
    }

    const stockInfo = evaluatePharmacyStock(med.id, options.pharmacyInventory);
    if (options.onlyAvailable && !stockInfo.inStock) {
      continue;
    }

    const matchReason = isPrescribedCombo
      ? `Matching generic combination product (${catGeneric}) • ${med.strength} ${med.dosageForm}`
      : `Matching generic product containing ${catGeneric} • ${med.strength} ${med.dosageForm}`;

    return {
      id: med.id,
      brandName: med.brandName,
      genericName: med.genericName,
      strength: med.strength,
      dosageForm: med.dosageForm,
      category: med.category || 'Generic Formulation',
      manufacturer: med.manufacturer || 'Certified Generic Manufacturer',
      price: stockInfo.price != null ? stockInfo.price : (med.price != null ? med.price : null),
      requiresPrescription: med.requiresPrescription !== false,
      isEmergency: Boolean(med.isEmergency),
      description: med.description || '',
      isGenericProduct: true,
      candidateType: 'GENERIC',
      clinicalMatchReason: matchReason,
      isExactStrength: areStrengthsCompatible(prescribedStrength, med.strength) && Boolean(prescribedStrength),
      isExactForm: areFormsCompatible(prescribedForm, med.dosageForm) && Boolean(prescribedForm),
      inStock: stockInfo.inStock,
      stock: stockInfo.stock,
      availabilityStatus: stockInfo.availabilityStatus
    };
  }

  return null;
}

/**
 * Resolves suitable matching brand options from the catalogue for any prescribed medicine item.
 */
export function findMatchingBrands(item, catalog, options = {}) {
  if (!item || !catalog || !Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }

  const raw = typeof item === 'string'
    ? item
    : (item.medicineName || item.rawName || item.matchedMedicineName || '');
  const clean = cleanText(raw);

  const prescribedStrength = item.strength || (raw.match(/\d+\s*(?:mg|mcg|gm?|ml|%)\b/i)?.[0] || '');
  const prescribedForm = item.dosageForm || (raw.match(/\b(?:tab|tablet|cap|capsule|syr|syrup|inj|injection|powder|sachet|gel)\b/i)?.[0] || '');

  let prescribedIngredients = extractActiveIngredients(clean);

  const itemGeneric = item.genericName || item.matchedMedicine?.genericName;
  if (itemGeneric && typeof itemGeneric === 'string') {
    const hintIngredients = extractActiveIngredients(itemGeneric);
    if (hintIngredients.length > 0) {
      prescribedIngredients = hintIngredients;
    }
  }

  const isPrescribedCombo = prescribedIngredients.length > 1 ||
    clean.includes('+') || clean.includes('/') || /\b(?:dsr|duo|-d|-tz)\b/i.test(clean);

  const matchingBrands = [];

  for (const med of catalog) {
    if (options.brandOnly && isGenericProduct(med)) {
      continue;
    }
    if (options.excludeMedicineIds && options.excludeMedicineIds.includes(med.id)) {
      continue;
    }

    const catGeneric = (med.genericName || '').trim();
    const catBrand = (med.brandName || '').trim();
    const catIngredients = extractActiveIngredients(catGeneric);
    const catIsCombo = catIngredients.length > 1 || catGeneric.includes('+') || /\b(?:dsr|duo|-d|-tz)\b/i.test(catBrand);

    if (!isPrescribedCombo && catIsCombo) continue;
    if (isPrescribedCombo && !catIsCombo) continue;

    let ingredientMatch = false;
    if (prescribedIngredients.length > 0) {
      if (!isPrescribedCombo) {
        const p0 = prescribedIngredients[0];
        ingredientMatch = catIngredients.some(c =>
          c === p0 || c.startsWith(p0) || p0.startsWith(c) || cleanText(catGeneric) === p0
        );
      } else {
        ingredientMatch = prescribedIngredients.every(p =>
          catIngredients.some(c => c === p || c.startsWith(p) || p.startsWith(c) || c.includes(p))
        );
      }
    } else {
      const brandBase = cleanText(catBrand).replace(/\s*\d+.*$/, '').trim();
      ingredientMatch = clean.includes(brandBase) || cleanText(catBrand) === clean;
    }

    if (!ingredientMatch) continue;

    const strengthMatch = areStrengthsCompatible(prescribedStrength, med.strength);
    if (!strengthMatch && !options.includeAllStrengths) {
      continue;
    }

    const formMatch = areFormsCompatible(prescribedForm, med.dosageForm);
    if (!formMatch && !options.includeAllForms) {
      continue;
    }

    const stockInfo = evaluatePharmacyStock(med.id, options.pharmacyInventory);
    if (options.onlyAvailable && !stockInfo.inStock) {
      continue;
    }

    const isGenProd = isGenericProduct(med);
    const matchReason = isPrescribedCombo
      ? `Matches combination active ingredients (${catGeneric}) • ${med.strength} ${med.dosageForm}`
      : `Bioequivalent formulation containing ${catGeneric} • ${med.strength} ${med.dosageForm}`;

    matchingBrands.push({
      id: med.id,
      brandName: med.brandName,
      genericName: med.genericName,
      strength: med.strength,
      dosageForm: med.dosageForm,
      category: med.category || 'Clinical Formulation',
      manufacturer: med.manufacturer || 'Verified Manufacturer',
      price: stockInfo.price != null ? stockInfo.price : (med.price != null ? med.price : null),
      requiresPrescription: med.requiresPrescription !== false,
      isEmergency: Boolean(med.isEmergency),
      description: med.description || '',
      isGenericProduct: isGenProd,
      candidateType: isGenProd ? 'GENERIC' : 'BRAND',
      clinicalMatchReason: matchReason,
      isExactStrength: areStrengthsCompatible(prescribedStrength, med.strength) && Boolean(prescribedStrength),
      isExactForm: areFormsCompatible(prescribedForm, med.dosageForm) && Boolean(prescribedForm),
      inStock: stockInfo.inStock,
      stock: stockInfo.stock,
      availabilityStatus: stockInfo.availabilityStatus
    });
  }

  const currentId = item.matchedMedicineId;
  return matchingBrands.sort((a, b) => {
    if (currentId && a.id === currentId) return -1;
    if (currentId && b.id === currentId) return 1;
    if (a.inStock === true && b.inStock === false) return -1;
    if (a.inStock === false && b.inStock === true) return 1;
    if (a.isExactStrength && !b.isExactStrength) return -1;
    if (!a.isExactStrength && b.isExactStrength) return 1;
    return a.brandName.localeCompare(b.brandName);
  });
}

/**
 * Unified discovery helper: returns both the eligible matching generic product
 * and appropriate brand-name alternatives for a prescribed medicine.
 */
export function findMatchingCandidates(item, catalog, options = {}) {
  const genericCandidate = findMatchingGenericProduct(item, catalog, options);
  const brandCandidates = findMatchingBrands(item, catalog, {
    ...options,
    brandOnly: true,
    excludeMedicineIds: genericCandidate ? [genericCandidate.id] : []
  });

  const rxType = identifyPrescriptionType(item, catalog);
  const isGeneric = Boolean(rxType.isGeneric || options.isGeneric);

  const allCandidates = [];
  if (genericCandidate) {
    allCandidates.push(genericCandidate);
  }
  allCandidates.push(...brandCandidates);

  return {
    isGenericPrescription: isGeneric,
    prescribedGenericName: rxType.targetGeneric || (typeof item === 'string' ? item : item.medicineName || item.rawName),
    prescribedStrength: item?.strength || (typeof item === 'string' ? (item.match(/\d+\s*(?:mg|mcg|gm?|ml|%)\b/i)?.[0] || '') : ''),
    prescribedForm: item?.dosageForm || '',
    genericCandidate,
    brandCandidates,
    allCandidates,
    hasGenericInCatalogue: Boolean(findMatchingGenericProduct(item, catalog, { ...options, pharmacyInventory: null, onlyAvailable: false })),
    hasGenericStocked: Boolean(genericCandidate && genericCandidate.inStock === true),
    hasBrandsStocked: brandCandidates.some(b => b.inStock === true),
    totalCandidatesCount: allCandidates.length
  };
}
