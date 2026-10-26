/**
 * MediFind AI — OCR Medicine Matcher & Auxiliary Lexicon Search Service
 *
 * Implements two-tier prescription medicine matching:
 * 1. Primary matching against the authoritative 50-medicine catalog (catalog_50.json / DB).
 * 2. Secondary candidate matching against the validated v2 reference lexicon
 *    (indian_medicine_lexicon_v2.json) strictly when primary matching cannot confidently identify a medicine.
 *
 * Safety & Regulatory Guarantees:
 * - Authoritative 50-item catalog records, pricing, inventory, reservations, and orders are strictly preserved.
 * - Ineligible auxiliary records (isEligibleForMatching !== true) are filtered out at load time.
 * - Prohibited / banned formulations (e.g. Cisapride, Valdecoxib, banned Nimesulide combos) are NEVER proposed.
 * - Auxiliary candidates always have matchedMedicineId: null, are marked as unconfirmed suggestions,
 *   and are completely excluded from automatic stock, pricing, reservation, and order operations.
 * - Strength, dosage form, and combination mismatches are handled conservatively with explicit review flags.
 * - Unknown or inferred strengths retain strengthReviewRequired: true and review flag UNKNOWN_OR_INFERRED_STRENGTH.
 * - In-memory caching ensures efficient lookup performance without disk re-reads.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Default dataset paths
const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '../../ocr/catalog_50.json');
const DEFAULT_LEXICON_PATH = path.resolve(__dirname, '../../ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');

// Stop words & pharma noise
const STOP_WORDS = new Set([
  'tab', 'tablet', 'tablets', 'cap', 'capsule', 'capsules', 'inj', 'injection',
  'ip', 'bp', 'usp', 'nf', 'ph', 'oral', 'route', 'topical', 'iv', 'im',
  'od', 'bd', 'tds', 'tid', 'qid', 'sos', 'hs', 'ac', 'pc', 'prn',
  'once', 'twice', 'thrice', 'daily', 'nightly', 'morning', 'evening',
  'before', 'after', 'meals', 'food', 'bedtime', 'days', 'weeks',
  'mg', 'mcg', 'gm', 'ml', 'g', 'mgs', 'dose', 'dosage', 'strength',
  'qty', 'quantity', 'prescribed', 'rx', 'dx', 'nos', 'packet', 'sachet',
  'powder', 'strip', 'strips', 'bottle', 'bottles'
]);

// Known dosage forms for formulation matching
const DOSAGE_FORM_PATTERNS = [
  { form: 'Tablet', regex: /\b(?:tab(?:let)?s?)\b/i },
  { form: 'Capsule', regex: /\b(?:cap(?:sule)?s?)\b/i },
  { form: 'Injection', regex: /\b(?:inj(?:ection)?s?|vial|ampoule)\b/i },
  { form: 'Syrup', regex: /\b(?:syr(?:up)?s?|suspension|elixir)\b/i },
  { form: 'Inhalation', regex: /\b(?:inhaler|inhalation|respule|rotacap)\b/i },
  { form: 'Drops', regex: /\b(?:drops?|eye\s+drops?|ear\s+drops?)\b/i },
  { form: 'Ointment', regex: /\b(?:ointment|oint|cream|gel|emulgel)\b/i },
  { form: 'Lotion', regex: /\b(?:lotion|topical\s+solution)\b/i },
  { form: 'Infusion', regex: /\b(?:infusion|iv\s+infusion)\b/i },
  { form: 'Powder', regex: /\b(?:powder|sachet|granules)\b/i }
];

// In-memory cache singletons
let _catalogCache = null;
let _catalogPathLoaded = null;
let _lexiconCache = null;
let _lexiconPathLoaded = null;
let _lexiconStats = null;

// ─── Levenshtein & Similarity Utilities ─────────────────────────────────────

function levenshtein(a, b) {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  const m = s1.length, n = s2.length;
  const dp = Array.from({ length: n + 1 }, (_, i) => [i]);
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = s1[j - 1] === s2[i - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
    }
  }
  return dp[n][m];
}

function calculateStringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1.0;
  if (a.length <= 2 || b.length <= 2) return a === b ? 1.0 : 0.0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+(?:mg|mcg|gm?|ml|%|g)?$/.test(t));
}

function extractDosageFormFromText(text) {
  if (!text) return null;
  for (const { form, regex } of DOSAGE_FORM_PATTERNS) {
    if (regex.test(text)) return form;
  }
  return null;
}

function normalizeStrength(str) {
  if (!str) return null;
  const m = String(str).match(/(\d+(?:\.\d+)?)\s*(mg|mcg|gm?|ml|%|g)\b/i);
  if (!m) return null;
  const val = m[1];
  let unit = m[2].toLowerCase();
  if (unit === 'gm') unit = 'g';
  return `${val}${unit}`;
}

// ─── Cache Loaders ──────────────────────────────────────────────────────────

/**
 * Loads and caches the authoritative 50-medicine catalog.
 *
 * @param {string} [customPath] - Path to catalog_50.json
 * @returns {Array<object>} Authoritative catalog records
 */
function loadCatalog(customPath = null) {
  const filePath = customPath || DEFAULT_CATALOG_PATH;
  if (_catalogCache && _catalogPathLoaded === filePath) {
    return _catalogCache;
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Authoritative 50-medicine catalogue not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Invalid catalogue format at ${filePath}: expected non-empty array.`);
  }

  _catalogCache = parsed;
  _catalogPathLoaded = filePath;
  return _catalogCache;
}

/**
 * Loads and caches the validated v2 auxiliary Indian medicine reference lexicon.
 * Filters out ineligible records at load time to ensure prohibited or non-verified
 * drugs can never be searched or proposed.
 *
 * @param {string} [customPath] - Path to indian_medicine_lexicon_v2.json
 * @returns {Array<object>} Pre-filtered eligible reference lexicon records
 */
function loadAuxiliaryLexicon(customPath = null) {
  const filePath = customPath || DEFAULT_LEXICON_PATH;
  if (_lexiconCache && _lexiconPathLoaded === filePath) {
    return _lexiconCache;
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Auxiliary reference lexicon not found at: ${filePath}`);
  }

  const startTime = Date.now();
  const raw = fs.readFileSync(filePath, 'utf-8');
  const allRecords = JSON.parse(raw);

  if (!Array.isArray(allRecords)) {
    throw new Error(`Invalid lexicon format at ${filePath}: expected JSON array.`);
  }

  let totalCount = allRecords.length;
  let eligibleRecords = [];
  let ineligibleCount = 0;
  let prohibitedCount = 0;
  let reviewRequiredCount = 0;

  for (const record of allRecords) {
    if (record.isEligibleForMatching === true && record.regulatoryStatus === 'STANDARD_ALLOPATHIC') {
      // Pre-normalize search tokens for high lookup performance
      const brandClean = (record.brandName || '').toLowerCase().trim();
      const genericClean = (record.genericName || '').toLowerCase().trim();
      const tokens = Array.from(new Set([...tokenize(brandClean), ...tokenize(genericClean)]));

      eligibleRecords.push({
        ...record,
        _searchTokens: tokens,
        _brandLower: brandClean,
        _genericLower: genericClean,
        _normalizedStrength: normalizeStrength(record.strength)
      });
    } else {
      ineligibleCount++;
      if (record.regulatoryStatus === 'PROHIBITED') prohibitedCount++;
      if (record.regulatoryStatus === 'REVIEW_REQUIRED') reviewRequiredCount++;
    }
  }

  const durationMs = Date.now() - startTime;
  _lexiconCache = eligibleRecords;
  _lexiconPathLoaded = filePath;
  _lexiconStats = {
    totalRecords: totalCount,
    eligibleRecords: eligibleRecords.length,
    ineligibleFilteredOut: ineligibleCount,
    prohibitedRecords: prohibitedCount,
    reviewRequiredRecords: reviewRequiredCount,
    loadDurationMs: durationMs,
    loadedAt: new Date().toISOString()
  };

  return _lexiconCache;
}

/**
 * Returns diagnostic metadata and caching statistics for the loaded reference lexicon.
 */
function getAuxiliaryLexiconStats() {
  return _lexiconStats || { cached: false, stats: null };
}

/**
 * Explicitly clears in-memory caches (useful for hermetic tests).
 */
function clearMatcherCaches() {
  _catalogCache = null;
  _catalogPathLoaded = null;
  _lexiconCache = null;
  _lexiconPathLoaded = null;
  _lexiconStats = null;
}

// ─── Primary 50-Item Catalogue Matching ──────────────────────────────────────

/**
 * Matches extracted medicine name and strength against the authoritative catalogue.
 * Reuses the validated matching algorithm from ocrEngine.js.
 *
 * @param {string} medicineName - OCR extracted medicine candidate
 * @param {string} strength - Extracted strength string
 * @param {Array<object>} [catalog] - Optional catalogue override
 * @returns {Array<object>} Ranked catalogue candidates
 */
function matchPrimaryCatalog(medicineName, strength = '', catalog = null) {
  const activeCatalog = catalog || loadCatalog();
  const ocrEngine = require('./ocrEngine');
  return ocrEngine.matchMedicineNameAgainstCatalog(medicineName, strength, activeCatalog);
}

// ─── Secondary Auxiliary Lexicon Matching ───────────────────────────────────

/**
 * Searches the validated v2 auxiliary reference lexicon for plausible candidate medicines.
 * Invoked ONLY when primary catalogue matching fails or is inconclusive.
 *
 * Safety Rules:
 * - Ineligible records are never returned (excluded at load time).
 * - Single-ingredient queries are penalized if matched against combination records.
 * - Strength differences penalize the candidate score.
 * - Dosage form differences penalize the candidate score and attach review flags.
 * - Missing or inferred strengths retain strengthReviewRequired: true and review flag.
 * - All returned items have matchedMedicineId: null and isAuxiliarySuggestion: true.
 *
 * @param {string} queryName - Raw or normalized medicine name extracted from prescription
 * @param {object} [options] - Search options
 * @param {string} [options.strength] - Extracted strength (e.g. "500mg")
 * @param {string} [options.dosageForm] - Extracted dosage form (e.g. "Tablet", "Injection")
 * @param {string} [options.rawLine] - Full prescription line text for context extraction
 * @param {number} [options.topK=4] - Max candidates to return (default 4)
 * @param {number} [options.minScore=0.55] - Minimum composite score threshold
 * @param {string} [options.lexiconPath] - Optional custom lexicon path
 * @returns {Array<object>} Ranked auxiliary candidate suggestions
 */
function searchAuxiliaryLexicon(queryName, options = {}) {
  if (!queryName || typeof queryName !== 'string') return [];

  const lexicon = loadAuxiliaryLexicon(options.lexiconPath || null);
  const topK = options.topK || 4;
  const minScore = options.minScore || 0.55;

  const rawLine = options.rawLine || '';
  const detectedStrength = normalizeStrength(options.strength || rawLine);
  const detectedForm = options.dosageForm || extractDosageFormFromText(rawLine) || extractDosageFormFromText(queryName);

  const queryTokens = tokenize(queryName);
  const queryLower = queryName.toLowerCase().trim();
  const queryCollapsed = queryLower.replace(/[^a-z0-9]/g, '');
  const isQueryCombo = queryLower.includes('+') || queryLower.includes('and') || queryLower.includes('/') || /\b(?:dsr|duo|-tz)\b/i.test(queryLower);

  const scoredCandidates = [];

  for (const record of lexicon) {
    // 1. Guard against ineligible records (double check)
    if (record.isEligibleForMatching !== true) {
      continue;
    }

    // 2. Token overlap pre-filter (skip if zero matching tokens and zero substring match)
    const brandLower = record._brandLower;
    const genericLower = record._genericLower;
    const hasSubstring = brandLower.includes(queryLower) || queryLower.includes(brandLower) || genericLower.includes(queryLower);

    let sharedTokens = 0;
    if (!hasSubstring) {
      for (const tok of queryTokens) {
        if (record._searchTokens.includes(tok)) {
          sharedTokens++;
        }
      }
      if (sharedTokens === 0) continue;
    }

    // 3. Brand name similarity (compare base stems without strengths)
    const queryBase = queryLower.replace(/\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%|g)\b/gi, '').trim();
    const queryBaseCollapsed = queryBase.replace(/[^a-z0-9]/g, '');

    const brandBase = brandLower.replace(/\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%|g)\b/gi, '').trim();
    const brandBaseCollapsed = brandBase.replace(/[^a-z0-9]/g, '');

    const brandCollapsed = brandLower.replace(/[^a-z0-9]/g, '');
    let brandSim = Math.max(
      calculateStringSimilarity(queryLower, brandLower),
      queryBase && brandBase ? calculateStringSimilarity(queryBase, brandBase) : 0
    );
    if (brandCollapsed === queryCollapsed && brandCollapsed.length > 2) {
      brandSim = 1.0;
    } else if (brandBaseCollapsed && brandBaseCollapsed === queryBaseCollapsed && brandBaseCollapsed.length > 2) {
      brandSim = 1.0;
    } else if (hasSubstring && (brandLower.startsWith(queryLower) || queryLower.startsWith(brandLower) || (brandBase && brandBase.startsWith(queryBase)))) {
      brandSim = Math.max(brandSim, 0.90);
    }

    // 4. Generic & ingredient similarity
    const genericBase = genericLower.replace(/\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%|g)\b/gi, '').trim();
    let genericSim = Math.max(
      calculateStringSimilarity(queryLower, genericLower),
      queryBase && genericBase ? calculateStringSimilarity(queryBase, genericBase) : 0
    );
    if (genericLower === queryLower || (genericBase && genericBase === queryBase)) {
      genericSim = 1.0;
    } else if (genericLower.includes(queryLower) && queryLower.length >= 4) {
      genericSim = Math.max(genericSim, 0.88);
    }

    // Check individual active ingredients
    let ingredientSim = 0;
    if (Array.isArray(record.activeIngredients)) {
      for (const ing of record.activeIngredients) {
        const ingName = (ing.ingredient || '').toLowerCase();
        if (ingName === queryLower || ingName === queryBase) {
          ingredientSim = Math.max(ingredientSim, 0.95);
        } else if (queryTokens.some(tok => ingName.includes(tok) && tok.length >= 4)) {
          ingredientSim = Math.max(ingredientSim, 0.82);
        }
      }
    }

    let baseScore = Math.max(brandSim, genericSim * 0.92, ingredientSim * 0.90);
    if (baseScore < 0.45) continue;

    // 5. Formulation & Dosage Form Check
    let formDelta = 0;
    let formMismatch = false;
    if (detectedForm && record.dosageForm) {
      const recForm = record.dosageForm.toLowerCase();
      const detForm = detectedForm.toLowerCase();
      if (recForm === detForm) {
        formDelta = 0.05; // Formulation match bonus
      } else {
        formDelta = -0.20; // Formulation mismatch penalty
        formMismatch = true;
      }
    }

    // 6. Strength Comparison
    let strengthDelta = 0;
    let strengthMismatch = false;
    let strengthMatched = false;
    if (detectedStrength && record._normalizedStrength) {
      if (detectedStrength === record._normalizedStrength) {
        strengthDelta = 0.08;
        strengthMatched = true;
      } else {
        strengthDelta = -0.15;
        strengthMismatch = true;
      }
    }

    // 7. Combination Safety Penalty:
    // If prescription query is single-ingredient but candidate is combination, apply strong penalty
    let comboDelta = 0;
    let comboMismatch = false;
    if (!isQueryCombo && record.isCombination) {
      comboDelta = -0.40;
      comboMismatch = true;
    }

    const compositeScore = Math.max(0, Math.min(1.0, baseScore + formDelta + strengthDelta + comboDelta));
    if (compositeScore < minScore) continue;

    // Build safety review flags
    const reviewFlags = [];
    if (record.strengthReviewRequired === true || !record.strengthVerified || !record.strength) {
      reviewFlags.push('UNKNOWN_OR_INFERRED_STRENGTH');
    }
    if (formMismatch) {
      reviewFlags.push('FORMULATION_MISMATCH');
    }
    if (strengthMismatch) {
      reviewFlags.push('STRENGTH_MISMATCH');
    }
    if (comboMismatch) {
      reviewFlags.push('COMBINATION_MISMATCH');
    }

    // Human-readable rationale
    let reason = '';
    if (brandSim >= 0.85) {
      reason = `Close brand match to auxiliary reference lexicon: "${record.brandName}"`;
    } else if (genericSim >= 0.80) {
      reason = `Generic constituent match: "${record.genericName}"`;
    } else if (ingredientSim >= 0.80) {
      reason = `Active ingredient match: "${record.genericName}"`;
    } else {
      reason = `Partial lexical match to auxiliary medicine "${record.brandName}"`;
    }

    if (strengthMatched) {
      reason += ` with verified strength ${record.strength}`;
    } else if (strengthMismatch) {
      reason += ` (strength differs from prescription ${detectedStrength})`;
    }

    scoredCandidates.push({
      lexiconId: record.lexiconId,
      sourceId: record.sourceId,
      brandName: record.brandName,
      genericName: record.genericName,
      activeIngredients: record.activeIngredients || [],
      strength: record.strength,
      strengthVerified: record.strengthVerified === true,
      strengthReviewRequired: record.strengthReviewRequired === true || !record.strengthVerified || !record.strength,
      dosageForm: record.dosageForm,
      manufacturer: record.manufacturer,
      priceInr: record.priceInr || null,
      packSizeLabel: record.packSizeLabel || null,
      matchScore: Number(compositeScore.toFixed(3)),
      matchReason: reason,
      regulatoryStatus: record.regulatoryStatus,
      reviewFlags,
      // Strict inventory and fulfilment boundaries
      matchedMedicineId: null,
      isAuxiliarySuggestion: true,
      requiresConfirmation: true,
      isEligibleForMatching: true,
      inStock: false,
      availabilityStatus: 'UNCONFIRMED_AVAILABILITY',
      availabilityNote: 'Availability cannot be confirmed. Reference lexicon item not present in pharmacy inventory.'
    });
  }

  // Sort descending by match score
  scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);
  return scoredCandidates.slice(0, topK);
}

// ─── Unified Matching Flow with Clear Fallback Policy ───────────────────────

/**
 * Matches a prescription line against the authoritative 50-item catalogue first.
 * Only if primary matching cannot confidently identify a medicine, falls back to
 * searching the auxiliary reference lexicon.
 *
 * Fallback Policy:
 * 1. Primary catalogue matches with high confidence (single match >= 0.85 or decisive winner)
 *    are authoritative. No auxiliary fallback is needed or promoted.
 * 2. If primary catalogue produces NO matches or confidence < 0.75, search the auxiliary lexicon.
 * 3. Auxiliary candidates are ALWAYS marked as unconfirmed suggestions and never alter stock,
 *    pricing, or create reservations.
 *
 * @param {string} rawLine - Raw OCR line or parsed medicine string
 * @param {object} [options] - Matching options
 * @returns {object} Structured matching result with primary and auxiliary candidates
 */
function matchPrescriptionLine(rawLine, options = {}) {
  const ocrEngine = require('./ocrEngine');
  const catalog = options.catalog || loadCatalog(options.catalogPath);

  // Extract candidate name and strength from line
  const parsed = ocrEngine.extractMedicineNameFromRow(rawLine);
  const cleanName = parsed.medicineName || rawLine;
  const cleanStrength = parsed.strength || '';

  // 1. Primary Catalogue Matching (Authoritative)
  const primaryMatches = matchPrimaryCatalog(cleanName, cleanStrength, catalog);

  const topPrimary = primaryMatches.length > 0 ? primaryMatches[0] : null;
  const secondPrimary = primaryMatches.length > 1 ? primaryMatches[1] : null;

  // High confidence if:
  // - Exact brand match (e.g. "Dolo 650", "Pan 40")
  // - OR exact generic catalogue product match (e.g. "Paracetamol 500mg", "Cetirizine 10")
  // When a generic active ingredient is prescribed (e.g. Cefixime 200mg) and catalogue only has
  // proprietary brands (e.g. Taxim-O, Zifi), DO NOT auto-match Taxim-O or Zifi as the prescribed product!
  const isExactBrand = topPrimary && (
    (topPrimary.evidence && topPrimary.evidence.brandSim >= 0.95) ||
    topPrimary.medicine.brandName.toLowerCase() === cleanName.toLowerCase()
  );
  const isGenericProd = topPrimary && (
    topPrimary.medicine.isGenericProduct === true ||
    topPrimary.medicine.isGeneric === true ||
    String(topPrimary.medicine.productType || '').toUpperCase() === 'GENERIC'
  );
  const hasDecisiveLead = !secondPrimary || (topPrimary.confidence - secondPrimary.confidence) >= 0.08;

  // Check if there are competing trade brands in the catalogue for the same generic active compound and strength
  // E.g. Taxim-O 200 vs Zifi 200 for Cefixime 200mg, or Crocin 650 vs Dolo 650 for Paracetamol 650mg
  const competingGenericBrands = primaryMatches.filter(m =>
    m.medicine.id !== topPrimary.medicine.id &&
    m.confidence >= 0.85 &&
    m.evidence && m.evidence.genericSim >= 0.80 &&
    (topPrimary.confidence - m.confidence) < 0.08
  );
  const hasMultipleCompetingBrands = competingGenericBrands.length > 0;

  // Single decisive formulation match:
  // When a generic medicine is prescribed (e.g. "Pantoprazole 40mg") and the catalogue contains
  // a single, unambiguous matching formulation (e.g. "Pan 40") with NO competing brands,
  // it is an authoritative auto-match and does not require pharmacist brand review or doctor approval.
  const isSingleDecisiveFormulation = topPrimary &&
    topPrimary.confidence >= 0.85 &&
    topPrimary.evidence &&
    topPrimary.evidence.genericSim >= 0.85 &&
    !hasMultipleCompetingBrands &&
    hasDecisiveLead;

  const isHighConfidencePrimary = topPrimary && (
    isExactBrand ||
    (isGenericProd && topPrimary.confidence >= 0.85 && hasDecisiveLead) ||
    isSingleDecisiveFormulation
  );

  if (isHighConfidencePrimary) {
    return {
      source: 'PRIMARY_CATALOGUE',
      status: 'AUTO_MATCHED',
      primaryMatch: topPrimary,
      allPrimaryMatches: primaryMatches,
      auxiliaryCandidates: [], // Primary takes strict precedence
      matchedMedicineId: topPrimary.medicine.id,
      matchedMedicineName: topPrimary.medicine.brandName,
      confidence: topPrimary.confidence,
      needsMapping: false,
      isNonCatalogue: false,
      requiresConfirmation: false,
      evidenceSummary: `Authoritative catalogue match: ${topPrimary.medicine.brandName}`
    };
  }

  // If primary matches exist and top is >= 0.70, it is in the authoritative 50-item catalogue (e.g. ambiguous brand options)
  if (topPrimary && topPrimary.confidence >= 0.70) {
    const brandList = primaryMatches.map(c => c.medicine.brandName).slice(0, 3).join(', ');
    const isGenericPrescription = !isExactBrand;
    return {
      source: 'PRIMARY_CATALOGUE',
      status: 'AMBIGUOUS',
      primaryMatch: topPrimary,
      allPrimaryMatches: primaryMatches,
      auxiliaryCandidates: [], // Inside catalogue, no reference fallback
      matchedMedicineId: null,
      matchedMedicineName: topPrimary.medicine.brandName,
      confidence: topPrimary.confidence,
      needsMapping: true,
      isNonCatalogue: false,
      requiresConfirmation: true,
      isGenericPrescription,
      evidenceSummary: isGenericPrescription
        ? `Generic medicine prescribed without exact catalogue-product match. Available formulations in catalogue: ${brandList}. Pharmacy review is recommended.`
        : `Multiple brand formulations available in catalogue (${brandList}). Please confirm preferred brand.`
    };
  }

  // 2. Primary produced NO confident match (< 0.70 or empty) -> Secondary Auxiliary Lexicon Matching
  const isNotCatalogue = primaryMatches.length === 0;
  const auxCandidates = searchAuxiliaryLexicon(cleanName, {
    strength: cleanStrength,
    rawLine,
    topK: options.topK || 4,
    minScore: options.minScore || 0.55,
    lexiconPath: options.lexiconPath
  });

  if (auxCandidates.length > 0) {
    const topAux = auxCandidates[0];
    return {
      source: 'AUXILIARY_LEXICON_SUGGESTION',
      status: isNotCatalogue ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS',
      primaryMatch: topPrimary,
      allPrimaryMatches: primaryMatches,
      auxiliaryCandidates: auxCandidates,
      // Boundary enforcement: auxiliary candidate NEVER links inventory or auto-confirms
      matchedMedicineId: null,
      matchedMedicineName: null,
      suggestedMedicineName: topAux.brandName,
      confidence: topPrimary ? topPrimary.confidence : topAux.matchScore,
      needsMapping: true,
      isNonCatalogue: isNotCatalogue,
      requiresConfirmation: true,
      isAuxiliarySuggestion: true,
      evidenceSummary: isNotCatalogue
        ? `Medicine not found in authoritative 50-item inventory. Suggested from Indian medicine reference lexicon: "${topAux.brandName}" (${topAux.genericName}). Confirmation required.`
        : `Ambiguous catalogue match. Plausible reference lexicon suggestion: "${topAux.brandName}". Confirmation required.`
    };
  }

  // 3. Neither primary nor auxiliary could find a plausible match
  return {
    source: 'NONE',
    status: isNotCatalogue ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS',
    primaryMatch: topPrimary,
    allPrimaryMatches: primaryMatches,
    auxiliaryCandidates: [],
    matchedMedicineId: null,
    matchedMedicineName: null,
    confidence: topPrimary ? topPrimary.confidence : 0.0,
    needsMapping: true,
    isNonCatalogue: isNotCatalogue,
    requiresConfirmation: true,
    evidenceSummary: isNotCatalogue
      ? 'Medicine was not found in the standardized catalogue or reference lexicon.'
      : 'Ambiguous formulation detected. Please verify or map to catalogue.'
  };
}

module.exports = {
  loadCatalog,
  loadAuxiliaryLexicon,
  getAuxiliaryLexiconStats,
  clearMatcherCaches,
  matchPrimaryCatalog,
  searchAuxiliaryLexicon,
  matchPrescriptionLine,
  normalizeStrength,
  extractDosageFormFromText,
  calculateStringSimilarity
};
