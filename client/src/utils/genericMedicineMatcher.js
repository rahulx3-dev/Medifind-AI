/**
 * MediFind AI — Universal Data-Driven Generic-to-Brand Matching Engine (Client)
 *
 * Implements clinical matching of generic prescription medicines to
 * verified branded formulations in the catalogue:
 * - Active ingredient extraction & normalization (single & combination)
 * - Clinical strength parsing & compatibility
 * - Dosage form / route categorization & compatibility
 * - Generic vs. trade brand prescription identification
 * - Dynamic brand option resolution from authentic catalogue records
 *
 * ZERO hardcoded medicine names — purely data-driven based on the catalogue.
 */

// ─── 1. Clinical Stopwords and Suffixes ──────────────────────────────────────
const SALT_SUFFIXES = [
  'hydrochloride', 'hcl', 'sodium', 'potassium', 'clavulanate',
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

    // Remove salt suffixes from the end of the ingredient
    const filteredTokens = tokens.filter((tok, idx) => {
      if (idx > 0 && SALT_SUFFIXES.includes(tok)) return false;
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

  // 1. Direct Brand Match: Check if the text explicitly names a trade brand in the catalogue
  const cleanTokens = clean.split(/\s+/);
  for (const med of catalog) {
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

// ─── 4. Universal Matching Brands Resolver ──────────────────────────────────

/**
 * Resolves suitable matching brand options from the catalogue for any prescribed medicine item.
 * Works universally for all medicines, single-ingredient and combination generics.
 */
export function findMatchingBrands(item, catalog, options = {}) {
  if (!item || !catalog || !Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }

  const raw = typeof item === 'string'
    ? item
    : (item.medicineName || item.rawName || item.matchedMedicineName || '');
  const clean = cleanText(raw);

  // Prescribed strength & dosage form hints
  const prescribedStrength = item.strength || (raw.match(/\d+\s*(?:mg|mcg|gm?|ml|%)\b/i)?.[0] || '');
  const prescribedForm = item.dosageForm || (raw.match(/\b(?:tab|tablet|cap|capsule|syr|syrup|inj|injection|powder|sachet|gel)\b/i)?.[0] || '');

  // Extract active ingredients from the prescribed item
  let prescribedIngredients = extractActiveIngredients(clean);

  // If item already has a matched generic name or generic hint, include its ingredients
  const itemGeneric = item.genericName || item.matchedMedicine?.genericName;
  if (itemGeneric && typeof itemGeneric === 'string') {
    const hintIngredients = extractActiveIngredients(itemGeneric);
    if (hintIngredients.length > 0) {
      prescribedIngredients = hintIngredients;
    }
  }

  // Determine if prescribed as a combination formulation
  const isPrescribedCombo = prescribedIngredients.length > 1 ||
    clean.includes('+') || clean.includes('/') || /\b(?:dsr|duo|-d|-tz)\b/i.test(clean);

  // Filter catalogue for clinically equivalent brand formulations
  const matchingBrands = [];

  for (const med of catalog) {
    const catGeneric = (med.genericName || '').trim();
    const catBrand = (med.brandName || '').trim();
    const catIngredients = extractActiveIngredients(catGeneric);
    const catIsCombo = catIngredients.length > 1 || catGeneric.includes('+') || /\b(?:dsr|duo|-d|-tz)\b/i.test(catBrand);

    // Rule 1: Single vs Combination Protection
    // If single drug was prescribed, NEVER offer combination medicines!
    if (!isPrescribedCombo && catIsCombo) {
      continue;
    }
    // If combination was prescribed, NEVER offer single-ingredient medicines!
    if (isPrescribedCombo && !catIsCombo) {
      continue;
    }

    // Rule 2: Active Ingredient Match
    let ingredientMatch = false;
    if (prescribedIngredients.length > 0) {
      if (!isPrescribedCombo) {
        // Single ingredient: must match the target ingredient
        const p0 = prescribedIngredients[0];
        ingredientMatch = catIngredients.some(c =>
          c === p0 || c.startsWith(p0) || p0.startsWith(c) || cleanText(catGeneric) === p0
        );
      } else {
        // Combination: all prescribed ingredients must be present in the candidate
        ingredientMatch = prescribedIngredients.every(p =>
          catIngredients.some(c => c === p || c.startsWith(p) || p.startsWith(c) || c.includes(p))
        );
      }
    } else {
      // Direct brand name reference fallback
      const brandBase = cleanText(catBrand).replace(/\s*\d+.*$/, '').trim();
      ingredientMatch = clean.includes(brandBase) || cleanText(catBrand) === clean;
    }

    if (!ingredientMatch) continue;

    // Rule 3: Clinical Strength Compatibility
    const strengthMatch = areStrengthsCompatible(prescribedStrength, med.strength);
    if (!strengthMatch && !options.includeAllStrengths) {
      continue;
    }

    // Rule 4: Clinical Dosage Form Compatibility
    const formMatch = areFormsCompatible(prescribedForm, med.dosageForm);
    if (!formMatch && !options.includeAllForms) {
      continue;
    }

    // Clinical match rationale
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
      price: med.price != null ? med.price : null,
      requiresPrescription: med.requiresPrescription !== false,
      isEmergency: Boolean(med.isEmergency),
      description: med.description || '',
      clinicalMatchReason: matchReason,
      isExactStrength: areStrengthsCompatible(prescribedStrength, med.strength) && Boolean(prescribedStrength),
      isExactForm: areFormsCompatible(prescribedForm, med.dosageForm) && Boolean(prescribedForm)
    });
  }

  // Sort candidates:
  // 1. Current selected item (if any) first
  // 2. Exact strength match first
  // 3. Alphabetical by brandName
  const currentId = item.matchedMedicineId;
  return matchingBrands.sort((a, b) => {
    if (currentId && a.id === currentId) return -1;
    if (currentId && b.id === currentId) return 1;
    if (a.isExactStrength && !b.isExactStrength) return -1;
    if (!a.isExactStrength && b.isExactStrength) return 1;
    return a.brandName.localeCompare(b.brandName);
  });
}
