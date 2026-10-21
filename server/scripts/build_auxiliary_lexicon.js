/**
 * MediFind AI — Auxiliary Medicine Reference Lexicon Builder (Phase 2C - Corrected Curation)
 *
 * Implements Phase 2C requirements:
 * 1. Deterministic, stratified sampling across A–Z (~2,200 records), eliminating the 'A' bias defect.
 * 2. Guaranteed inclusion of essential common Indian medicines (Crocin, Dolo, Combiflam, Glycomet, Pan, Telma, Voveran, etc.).
 * 3. Corrected strength parsing:
 *    - Strips non-numeric descriptors (Plain, Liposomal, Natural Micronized, NA).
 *    - Preserves descriptors as active ingredient modifiers without treating them as numeric strength.
 *    - Parses unambiguous numeric strength from product name when composition is NA/unspecified.
 *    - Distinguishes verified numeric strength from unknown strength; flags strengthReviewRequired.
 * 4. Expanded dosage form classification: Infusion, Lotion, Topical Solution, Respule, Oral Solution, etc.
 * 5. Cautious regulatory review mechanism citing official CDSCO Gazette notifications (Drugs & Cosmetics Act Sec 26A):
 *    - Cisapride -> PROHIBITED (G.S.R. 82(E) 2011)
 *    - Pediatric Nimesulide & Nimesulide FDCs -> PROHIBITED (G.S.R. 82(E) 2011 / G.S.R. 889(E) 2018)
 *    - Adult conventional Nimesulide -> REVIEW_REQUIRED
 *    - All prohibited / review required records have isEligibleForMatching: false.
 * 6. Generates versioned v2 files without overwriting v1:
 *    - server/ocr/datasets/lexicon/indian_medicine_lexicon_v2.json
 *    - server/ocr/datasets/lexicon/indian_medicine_lexicon_v2.csv
 *    - server/ocr/datasets/lexicon/lexicon_metadata_v2.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SOURCE_CSV_PATH = path.join(__dirname, '../ocr/datasets/source/indian_medicine_data.csv');
const OUTPUT_JSON_PATH = path.join(__dirname, '../ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');
const OUTPUT_CSV_PATH = path.join(__dirname, '../ocr/datasets/lexicon/indian_medicine_lexicon_v2.csv');
const OUTPUT_METADATA_PATH = path.join(__dirname, '../ocr/datasets/lexicon/lexicon_metadata_v2.json');

// Prominent Indian manufacturers for quality representation
const TOP_MANUFACTURERS = new Set([
  'sun pharmaceutical industries ltd',
  'cipla ltd',
  'dr reddy\'s laboratories ltd',
  'zydus healthcare ltd',
  'cadila pharmaceuticals ltd',
  'lupin ltd',
  'torrent pharmaceuticals ltd',
  'alkem laboratories ltd',
  'mankind pharma ltd',
  'abbott',
  'glaxosmithkline pharmaceuticals ltd',
  'glaxosmithkline consumer healthcare',
  'alembic pharmaceuticals ltd',
  'aristo pharmaceuticals pvt ltd',
  'macleods pharmaceuticals pvt ltd',
  'usv ltd',
  'intas pharmaceuticals ltd',
  'micro labs ltd',
  'sanofi india ltd',
  'pfizer ltd',
  'ipca laboratories ltd',
  'fdc ltd',
  'glenmark pharmaceuticals ltd',
  'biocon',
  'hec pharma',
  'ajanta pharma ltd',
  'leford health care ltd',
  'blue cross laboratories ltd',
  'apex laboratories pvt ltd',
  'meyer organics pvt ltd',
  'fourrts india laboratories pvt ltd',
  'systopic laboratories pvt ltd',
  'franco-indian pharmaceuticals pvt ltd',
  'indoco remedies ltd',
  'serum institute of india pvt ltd',
  'wockhardt ltd',
  'troikaa pharmaceuticals ltd',
  'hetero healthcare ltd',
  'emcure pharmaceuticals ltd',
  'novartis india ltd'
]);

// Common essential Indian brands to prioritize in selection
const COMMON_PRIORITY_BRANDS = [
  'crocin', 'dolo', 'combiflam', 'glycomet', 'pan', 'telma', 'voveran',
  'augmentin', 'azithral', 'ascoril', 'allegra', 'avil', 'becosules',
  'calpol', 'ciprogut', 'cetcip', 'ciplox', 'deriphyllin', 'digene',
  'ecosprin', 'flagyl', 'gelusil', 'meftal', 'monocef', 'norflox',
  'omez', 'pantocid', 'rantac', 'shelcal', 'taxim', 'volini', 'zifi', 'zedex'
];

// Expanded dosage form classification patterns (preserves clinical distinctions)
const DOSAGE_FORM_PATTERNS = [
  // 1. Infusion (IV infusions, solution for infusion)
  { form: 'Infusion', regex: /\b(?:infusions?|iv\s+infusion|iv\s+fluid|solution\s+for\s+infusion)\b/i },
  // 2. Respule (Unit-dose inhalation ampoules for nebulization)
  { form: 'Respule', regex: /\b(?:respules?|nebules?|rotacaps?)\b/i },
  // 3. Inhalation solutions / Inhalers
  { form: 'Inhalation', regex: /\b(?:inhalers?|inhalation|respirator\s+solution)\b/i },
  // 4. Tablet
  { form: 'Tablet', regex: /\b(?:tablets?|tab|caplet|dispersible\s+tablet|dt)\b/i },
  // 5. Capsule
  { form: 'Capsule', regex: /\b(?:capsules?|cap)\b/i },
  // 6. Syrup
  { form: 'Syrup', regex: /\b(?:syrups?|syr)\b/i },
  // 7. Oral Suspension
  { form: 'Oral Suspension', regex: /\b(?:oral\s+suspension|suspension|susp)\b/i },
  // 8. Oral Solution
  { form: 'Oral Solution', regex: /\b(?:oral\s+solution)\b/i },
  // 9. Injection
  { form: 'Injection', regex: /\b(?:injections?|inj|solution\s+for\s+injection|penfill|cartridge|prefilled\s+syringe)\b/i },
  // 10. Eye / Ear Drops
  { form: 'Eye Drops', regex: /\b(?:eye\s+drops?|ophthalmic)\b/i },
  { form: 'Ear Drops', regex: /\b(?:ear\s+drops?|otic)\b/i },
  // 11. Nasal Spray
  { form: 'Nasal Spray', regex: /\b(?:nasal\s+spray|nasal\s+drops?)\b/i },
  // 12. Lotion
  { form: 'Lotion', regex: /\b(?:lotions?)\b/i },
  // 13. Topical Solution
  { form: 'Topical Solution', regex: /\b(?:topical\s+solution|solution)\b/i },
  // 14. Topicals: Ointment, Cream, Gel
  { form: 'Ointment', regex: /\b(?:ointments?|oint)\b/i },
  { form: 'Cream', regex: /\b(?:creams?)\b/i },
  { form: 'Gel', regex: /\b(?:gels?)\b/i },
  // 15. Powder / Sachet
  { form: 'Powder', regex: /\b(?:powders?|sachets?|granules?)\b/i },
  // 16. Drops (oral/pediatric)
  { form: 'Drops', regex: /\b(?:drops?)\b/i }
];

function detectDosageForm(name, packLabel) {
  const combined = `${name || ''} ${packLabel || ''}`.toLowerCase();
  for (const { form, regex } of DOSAGE_FORM_PATTERNS) {
    if (regex.test(combined)) {
      return form;
    }
  }
  return 'Other';
}

// Clean brand name by stripping dosage form keywords
function cleanBrandName(rawName) {
  if (!rawName) return '';
  let clean = rawName;
  for (const { regex } of DOSAGE_FORM_PATTERNS) {
    clean = clean.replace(regex, ' ').trim();
  }
  // Strip trailing dashes or symbols
  clean = clean.replace(/[-–—/]\s*$/, '').replace(/\s+/g, ' ').trim();
  return clean || rawName;
}

// CDSCO Section 26A Banned / Restricted Substances Rules
const CDSCO_REGULATORY_RULES = [
  {
    ingredientPattern: /\bcisapride\b/i,
    status: 'PROHIBITED',
    reason: 'Manufacture, sale and distribution prohibited under Ministry of Health and Family Welfare Gazette Notification G.S.R. 82(E) dated 10-02-2011 (cardiac arrhythmias and QT prolongation risk).',
    reference: 'CDSCO Gazette Notification G.S.R. 82(E) (10.02.2011) / Drugs & Cosmetics Act Section 26A',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
    verificationDate: '2026-10-20'
  },
  {
    ingredientPattern: /\bnimesulide\b/i,
    customCheck: (item) => {
      const isPediatric = /\b(?:drops?|pediatric|paediatric|suspension|syrup)\b/i.test(`${item.sourceName} ${item.packSizeLabel || ''}`) ||
                          (/\b(\d+(?:\.\d+)?)\s*mg\b/i.test(item.sourceName) && parseFloat((item.sourceName.match(/\b(\d+(?:\.\d+)?)\s*mg\b/i) || [])[1]) < 50);
      if (isPediatric) {
        return {
          status: 'PROHIBITED',
          reason: 'Nimesulide formulations for human use in children below 12 years of age prohibited under CDSCO Gazette Notification G.S.R. 82(E) dated 10-02-2011 (severe hepatotoxicity risk).',
          reference: 'CDSCO Gazette Notification G.S.R. 82(E) (10.02.2011)',
          sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
          verificationDate: '2026-10-20'
        };
      }
      if (item.isCombination) {
        return {
          status: 'PROHIBITED',
          reason: 'Fixed-dose combination containing Nimesulide prohibited under CDSCO Gazette Notification G.S.R. 889(E) dated 07-09-2018 / Section 26A.',
          reference: 'CDSCO Gazette Notification G.S.R. 889(E) (07.09.2018)',
          sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
          verificationDate: '2026-10-20'
        };
      }
      return {
        status: 'REVIEW_REQUIRED',
        reason: 'Approved for adult use only with mandatory hepatotoxicity warnings; prohibited in children below 12 years. Flagged for review before candidate suggestion.',
        reference: 'CDSCO Safety Advisory & G.S.R. 82(E)',
        sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
        verificationDate: '2026-10-20'
      };
    }
  },
  {
    ingredientPattern: /\brofecoxib\b/i,
    status: 'PROHIBITED',
    reason: 'Prohibited under CDSCO Gazette Notification G.S.R. 810(E) dated 13-12-2004 (cardiovascular thrombotic risk).',
    reference: 'CDSCO Gazette Notification G.S.R. 810(E)',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
    verificationDate: '2026-10-20'
  },
  {
    ingredientPattern: /\bvaldecoxib\b/i,
    status: 'PROHIBITED',
    reason: 'Prohibited under CDSCO Gazette Notification G.S.R. 499(E) dated 28-07-2005 (serious dermatological and cardiovascular risk).',
    reference: 'CDSCO Gazette Notification G.S.R. 499(E)',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
    verificationDate: '2026-10-20'
  },
  {
    ingredientPattern: /\bsibutramine\b/i,
    status: 'PROHIBITED',
    reason: 'Prohibited under CDSCO Gazette Notification G.S.R. 82(E) dated 10-02-2011 (cardiovascular events).',
    reference: 'CDSCO Gazette Notification G.S.R. 82(E)',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
    verificationDate: '2026-10-20'
  },
  {
    ingredientPattern: /\bdextropropoxyphene\b/i,
    status: 'PROHIBITED',
    reason: 'Prohibited under CDSCO Gazette Notification G.S.R. 396(E) dated 23-05-2013 (cardiotoxicity / fatal arrhythmias).',
    reference: 'CDSCO Gazette Notification G.S.R. 396(E)',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Drugs/Banned-Drugs/',
    verificationDate: '2026-10-20'
  }
];

function assessRegulatoryStatus(item) {
  const compText = `${item.genericName} ${item.sourceName}`.toLowerCase();
  for (const rule of CDSCO_REGULATORY_RULES) {
    if (rule.ingredientPattern.test(compText)) {
      if (rule.customCheck) {
        return rule.customCheck(item);
      }
      return {
        status: rule.status,
        reason: rule.reason,
        reference: rule.reference,
        sourceUrl: rule.sourceUrl,
        verificationDate: rule.verificationDate
      };
    }
  }
  return {
    status: 'STANDARD_ALLOPATHIC',
    reason: null,
    reference: 'CDSCO Approved Allopathic List / National Formulary of India',
    sourceUrl: 'https://cdsco.gov.in',
    verificationDate: '2026-10-20'
  };
}

/**
 * Robust composition parser addressing Phase 2B audit findings:
 * - Extracts base ingredient
 * - Separates text descriptors (Plain, Liposomal, Natural Micronized, etc.)
 * - Ignores non-numeric placeholders (NA, N/A, Plain, etc.) as numeric strengths
 * - Extracts unambiguous numeric strength from composition parenthetical or falls back safely to product name
 */
function parseCompositionItem(compStr, rawProductName) {
  if (!compStr || typeof compStr !== 'string') return null;
  const s = compStr.trim();
  if (!s) return null;

  // Extract all parenthetical groups e.g. "Doxorubicin (Liposomal) (20mg)" -> ["Liposomal", "20mg"]
  const parenMatches = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim());

  // Base ingredient is before the first '('
  const firstParenIdx = s.indexOf('(');
  let baseIngredient = (firstParenIdx !== -1 ? s.slice(0, firstParenIdx) : s).replace(/\s+/g, ' ').trim();

  let numericStrength = null;
  let textDescriptors = [];

  const NON_NUMERIC_STRENGTH_PATTERN = /^(na|plain|liposomal|natural micronized|n\/a|not available|none)$/i;
  const NUMERIC_STRENGTH_PATTERN = /^(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|gm|ml|l|iu|ui|%|w\/v|w\/w|v\/v|mEq|mmol)(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|gm|ml|l))?$/i;

  for (const p of parenMatches) {
    if (NUMERIC_STRENGTH_PATTERN.test(p)) {
      numericStrength = p;
    } else if (NON_NUMERIC_STRENGTH_PATTERN.test(p)) {
      if (!/^(na|n\/a|not available|none)$/i.test(p)) {
        textDescriptors.push(p);
      }
    } else {
      // Check if string contains a recognizable numeric strength inside
      const subMatch = p.match(/(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|gm?|ml|%|iu))/i);
      if (subMatch) {
        numericStrength = p;
      } else {
        textDescriptors.push(p);
      }
    }
  }

  // Preserve clinical distinction of descriptor (e.g. Liposomal vs Plain) in ingredient name
  let ingredientName = baseIngredient;
  if (textDescriptors.length > 0) {
    ingredientName = `${baseIngredient} (${textDescriptors.join(', ')})`;
  }

  let strengthSource = 'composition';
  let strengthReviewRequired = false;

  // If no numeric strength found in composition, attempt unambiguous extraction from product name
  if (!numericStrength) {
    if (rawProductName) {
      // Must match a single unambiguous numeric strength with medical unit
      const nameMatches = [...rawProductName.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|gm|iu|%)(?!\w)/gi)];
      if (nameMatches.length === 1) {
        numericStrength = `${nameMatches[0][1]}${nameMatches[0][2]}`;
        strengthSource = 'product_name_inferred';
      } else {
        strengthReviewRequired = true;
      }
    } else {
      strengthReviewRequired = true;
    }
  }

  return {
    rawComposition: s,
    ingredient: ingredientName,
    strength: numericStrength || null,
    strengthSource: numericStrength ? strengthSource : 'none',
    strengthReviewRequired,
    isNumericStrength: !!numericStrength
  };
}

// Basic CSV row parser handling quotes and commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function buildLexiconV2() {
  console.log('=== Building MediFind AI Auxiliary Medicine Reference Lexicon (v2 - Corrected) ===\n');
  console.log(`Reading source file: ${SOURCE_CSV_PATH}`);

  if (!fs.existsSync(SOURCE_CSV_PATH)) {
    throw new Error(`Source file not found at: ${SOURCE_CSV_PATH}`);
  }

  const fileStream = fs.createReadStream(SOURCE_CSV_PATH, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let totalLines = 0;
  let rawRecordCount = 0;
  let discontinuedCount = 0;
  let nonAllopathyCount = 0;
  let missingCompCount = 0;
  let processedCandidates = [];

  for await (const line of rl) {
    totalLines++;
    if (totalLines === 1) continue; // Skip header

    if (!line.trim()) continue;
    rawRecordCount++;

    const cols = parseCSVLine(line);
    const [
      id,
      rawName,
      priceStr,
      isDiscontinued,
      mfgName,
      medType,
      packSizeLabel,
      comp1,
      comp2
    ] = cols;

    // Filter 1: Active check
    if (isDiscontinued && isDiscontinued.trim().toUpperCase() === 'TRUE') {
      discontinuedCount++;
      continue;
    }

    // Filter 2: Allopathic check
    const typeLower = (medType || '').toLowerCase().trim();
    if (typeLower !== 'allopathy') {
      nonAllopathyCount++;
      continue;
    }

    // Filter 3: Valid name and primary composition
    if (!rawName || !comp1) {
      missingCompCount++;
      continue;
    }

    const c1 = parseCompositionItem(comp1, rawName);
    if (!c1 || !c1.ingredient) {
      missingCompCount++;
      continue;
    }

    const c2 = comp2 ? parseCompositionItem(comp2, rawName) : null;

    // Active ingredients list
    const activeIngredients = [c1];
    if (c2 && c2.ingredient) {
      activeIngredients.push(c2);
    }

    const isCombination = activeIngredients.length > 1;
    const genericName = activeIngredients.map(a => a.ingredient).join(' + ');

    // Calculate overall strength string
    let combinedStrength = null;
    let strengthReviewRequired = false;

    if (activeIngredients.some(a => a.strengthReviewRequired || !a.strength)) {
      strengthReviewRequired = true;
      const presentStrengths = activeIngredients.map(a => a.strength || 'unknown');
      combinedStrength = presentStrengths.some(s => s !== 'unknown') ? presentStrengths.join(' + ') : null;
    } else {
      combinedStrength = activeIngredients.map(a => a.strength).join(' + ');
    }

    const dosageForm = detectDosageForm(rawName, packSizeLabel);
    const brandName = cleanBrandName(rawName);

    const mfgLower = (mfgName || '').toLowerCase().trim();
    const isPriorityMfg = TOP_MANUFACTURERS.has(mfgLower);
    const price = parseFloat(priceStr) || null;

    processedCandidates.push({
      sourceId: parseInt(id, 10) || id,
      sourceName: rawName,
      brandName,
      genericName,
      activeIngredients,
      isCombination,
      strength: combinedStrength,
      strengthVerified: !strengthReviewRequired && !!combinedStrength,
      strengthReviewRequired,
      dosageForm,
      manufacturer: mfgName || 'Unknown',
      packSizeLabel: packSizeLabel || null,
      priceInr: price,
      isPriorityMfg
    });
  }

  console.log(`Total raw CSV rows: ${rawRecordCount}`);
  console.log(`Discontinued skipped: ${discontinuedCount}`);
  console.log(`Non-allopathy skipped: ${nonAllopathyCount}`);
  console.log(`Missing composition skipped: ${missingCompCount}`);
  console.log(`Valid active allopathic candidates: ${processedCandidates.length}`);

  // Deduplication by normalized clinical formulation tuple:
  // (brandName + genericName + strength + dosageForm)
  const dedupedMap = new Map();

  for (const cand of processedCandidates) {
    const normBrand = cand.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normGeneric = cand.genericName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normStrength = (cand.strength || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normKey = `${normBrand}|${normGeneric}|${normStrength}|${cand.dosageForm.toLowerCase()}`;

    if (!dedupedMap.has(normKey)) {
      dedupedMap.set(normKey, cand);
    } else {
      const existing = dedupedMap.get(normKey);
      // Tie-breaking:
      // 1. Prefer verified strength over review required
      if (!cand.strengthReviewRequired && existing.strengthReviewRequired) {
        dedupedMap.set(normKey, cand);
      } else if (cand.strengthReviewRequired === existing.strengthReviewRequired) {
        // 2. Prefer priority manufacturer
        if (cand.isPriorityMfg && !existing.isPriorityMfg) {
          dedupedMap.set(normKey, cand);
        } else if (cand.isPriorityMfg === existing.isPriorityMfg) {
          // 3. Deterministic tie-breaker: lowest sourceId
          if (cand.sourceId < existing.sourceId) {
            dedupedMap.set(normKey, cand);
          }
        }
      }
    }
  }

  const allDeduped = Array.from(dedupedMap.values());
  console.log(`Unique distinct formulations after deduplication: ${allDeduped.length}`);

  // -------------------------------------------------------------
  // Deterministic Stratified A–Z Sampling (Fixing Alphabetical Bias)
  // -------------------------------------------------------------
  const buckets = {};
  for (let c = 65; c <= 90; c++) {
    buckets[String.fromCharCode(c)] = [];
  }
  buckets['0-9'] = [];

  for (const item of allDeduped) {
    const firstChar = item.brandName.trim().charAt(0).toUpperCase();
    if (firstChar >= 'A' && firstChar <= 'Z') {
      buckets[firstChar].push(item);
    } else if (firstChar >= '0' && firstChar <= '9') {
      buckets['0-9'].push(item);
    }
  }

  console.log('\n--- Candidate Counts per Starting-Letter Bucket ---');
  Object.keys(buckets).sort().forEach(b => {
    console.log(`Bucket ${b}: ${buckets[b].length} candidates`);
  });

  // Target size: ~2,200 records
  // We allocate 84–85 items per letter A–Z, plus up to 5 items for 0-9
  const letterKeys = Object.keys(buckets).filter(k => k !== '0-9').sort();
  const selectedEntries = [];

  // Helper: check if brand name matches essential Indian brands
  function getBrandPriorityScore(brandName) {
    const bLower = brandName.toLowerCase();
    for (const common of COMMON_PRIORITY_BRANDS) {
      if (bLower.startsWith(common)) {
        return 2; // Top priority
      }
    }
    return 0;
  }

  for (let i = 0; i < letterKeys.length; i++) {
    const letter = letterKeys[i];
    const items = buckets[letter];
    // Allocation: 85 items for first 16 letters, 84 items for remaining 10 letters = 2,200
    const quota = i < 16 ? 85 : 84;

    if (items.length <= quota) {
      selectedEntries.push(...items);
      continue;
    }

    // Sort items within bucket deterministically:
    // Priority:
    // 1. Common priority brands (Crocin, Dolo, etc.)
    // 2. Diversity across dosage forms
    // 3. Verified strength vs review required
    // 4. Priority manufacturer
    // 5. Tie-breaker: brandName ASC, sourceId ASC

    // Partition items by common priority vs others
    const commonPriorityItems = [];
    const regularItems = [];

    for (const it of items) {
      if (getBrandPriorityScore(it.brandName) > 0) {
        commonPriorityItems.push(it);
      } else {
        regularItems.push(it);
      }
    }

    // Sort regular items by dosage form round-robin to ensure diverse forms
    const byDosageForm = {};
    for (const it of regularItems) {
      if (!byDosageForm[it.dosageForm]) byDosageForm[it.dosageForm] = [];
      byDosageForm[it.dosageForm].push(it);
    }

    // Sort each dosage form list: priorityMfg first, verified strength first, then brandName, sourceId
    Object.keys(byDosageForm).forEach(df => {
      byDosageForm[df].sort((a, b) => {
        if (a.isPriorityMfg !== b.isPriorityMfg) return b.isPriorityMfg ? 1 : -1;
        if (a.strengthVerified !== b.strengthVerified) return b.strengthVerified ? 1 : -1;
        const brandCmp = a.brandName.localeCompare(b.brandName);
        if (brandCmp !== 0) return brandCmp;
        return a.sourceId - b.sourceId;
      });
    });

    const bucketSelection = [];

    // First: include all common priority items (e.g. Crocin, Dolo, Combiflam, Pan, Telma, etc.)
    commonPriorityItems.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.sourceId - b.sourceId);
    for (const cp of commonPriorityItems) {
      if (bucketSelection.length < quota) {
        bucketSelection.push(cp);
      }
    }

    // Second: round-robin through distinct dosage forms
    const forms = Object.keys(byDosageForm).sort();
    let formIdx = 0;
    while (bucketSelection.length < quota && forms.some(f => byDosageForm[f].length > 0)) {
      const form = forms[formIdx % forms.length];
      if (byDosageForm[form].length > 0) {
        bucketSelection.push(byDosageForm[form].shift());
      }
      formIdx++;
    }

    selectedEntries.push(...bucketSelection);
  }

  // Add 0-9 bucket items (up to 5 items for numeric brand coverage)
  if (buckets['0-9'] && buckets['0-9'].length > 0) {
    const numItems = buckets['0-9']
      .sort((a, b) => (b.isPriorityMfg ? 1 : 0) - (a.isPriorityMfg ? 1 : 0) || a.sourceId - b.sourceId)
      .slice(0, 5);
    selectedEntries.push(...numItems);
  }

  console.log(`\nTotal stratified entries selected: ${selectedEntries.length}`);

  // Sort overall selection deterministically by brandName ASC, then sourceId ASC
  selectedEntries.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.sourceId - b.sourceId);

  // Apply Regulatory Review Assessment
  let prohibitedCount = 0;
  let reviewRequiredCount = 0;
  let standardCount = 0;

  const formattedLexicon = selectedEntries.map((item, idx) => {
    const reg = assessRegulatoryStatus(item);
    if (reg.status === 'PROHIBITED') prohibitedCount++;
    else if (reg.status === 'REVIEW_REQUIRED') reviewRequiredCount++;
    else standardCount++;

    return {
      lexiconId: `LEX-IND-V2-${String(idx + 1).padStart(5, '0')}`,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      brandName: item.brandName,
      genericName: item.genericName,
      activeIngredients: item.activeIngredients.map(a => ({
        ingredient: a.ingredient,
        strength: a.strength,
        rawComposition: a.rawComposition,
        strengthSource: a.strengthSource,
        strengthReviewRequired: a.strengthReviewRequired
      })),
      isCombination: item.isCombination,
      strength: item.strength,
      strengthVerified: item.strengthVerified,
      strengthReviewRequired: item.strengthReviewRequired,
      dosageForm: item.dosageForm,
      manufacturer: item.manufacturer,
      packSizeLabel: item.packSizeLabel,
      priceInr: item.priceInr,
      regulatoryStatus: reg.status,
      isEligibleForMatching: reg.status === 'STANDARD_ALLOPATHIC',
      regulatoryDetails: {
        status: reg.status,
        reason: reg.reason,
        reference: reg.reference,
        sourceUrl: reg.sourceUrl,
        verificationDate: reg.verificationDate
      }
    };
  });

  console.log('\n--- Regulatory Status Distribution ---');
  console.log(`STANDARD_ALLOPATHIC (Eligible for OCR matching): ${standardCount}`);
  console.log(`PROHIBITED (CDSCO Section 26A / Ineligible): ${prohibitedCount}`);
  console.log(`REVIEW_REQUIRED (Safety restrictions / Ineligible): ${reviewRequiredCount}`);

  // Calculate Starting-Letter Distribution of Final Selection
  const finalLetterDist = {};
  for (const item of formattedLexicon) {
    const ch = item.brandName.charAt(0).toUpperCase();
    const key = (ch >= 'A' && ch <= 'Z') ? ch : '0-9';
    finalLetterDist[key] = (finalLetterDist[key] || 0) + 1;
  }

  console.log('\n--- Final Starting Letter Breakdown (A–Z) ---');
  console.log(finalLetterDist);

  // Calculate Dosage Form Breakdown
  const dosageFormDist = formattedLexicon.reduce((acc, e) => {
    acc[e.dosageForm] = (acc[e.dosageForm] || 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Final Dosage Form Breakdown ---');
  console.log(dosageFormDist);

  // Verify Essential Medicines Presence
  console.log('\n--- Essential Indian Brands Verification ---');
  const requiredBrands = ['crocin', 'dolo', 'combiflam', 'glycomet', 'pan', 'telma', 'voveran'];
  const foundBrands = {};
  for (const req of requiredBrands) {
    const matches = formattedLexicon.filter(e => e.brandName.toLowerCase().startsWith(req));
    foundBrands[req] = matches.map(m => `${m.lexiconId}: ${m.brandName} (${m.dosageForm}) - ${m.genericName}`);
    console.log(`[${req.toUpperCase()}]: ${matches.length} found`);
    matches.forEach(m => console.log(`   * ${m.lexiconId} | ${m.brandName} | ${m.genericName} | ${m.strength} | ${m.dosageForm}`));
  }

  // Write JSON output file
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(formattedLexicon, null, 2), 'utf-8');
  console.log(`\nSaved v2 lexicon JSON to: ${OUTPUT_JSON_PATH}`);

  // Write CSV companion file
  const csvHeaders = [
    'lexiconId',
    'sourceId',
    'brandName',
    'genericName',
    'strength',
    'strengthVerified',
    'strengthReviewRequired',
    'dosageForm',
    'isCombination',
    'manufacturer',
    'priceInr',
    'regulatoryStatus',
    'isEligibleForMatching',
    'packSizeLabel',
    'sourceName'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [csvHeaders.join(',')];
  for (const item of formattedLexicon) {
    csvLines.push([
      escapeCsv(item.lexiconId),
      escapeCsv(item.sourceId),
      escapeCsv(item.brandName),
      escapeCsv(item.genericName),
      escapeCsv(item.strength),
      item.strengthVerified ? 'TRUE' : 'FALSE',
      item.strengthReviewRequired ? 'TRUE' : 'FALSE',
      escapeCsv(item.dosageForm),
      item.isCombination ? 'TRUE' : 'FALSE',
      escapeCsv(item.manufacturer),
      item.priceInr !== null ? item.priceInr : '',
      escapeCsv(item.regulatoryStatus),
      item.isEligibleForMatching ? 'TRUE' : 'FALSE',
      escapeCsv(item.packSizeLabel),
      escapeCsv(item.sourceName)
    ].join(','));
  }
  fs.writeFileSync(OUTPUT_CSV_PATH, csvLines.join('\n'), 'utf-8');
  console.log(`Saved v2 lexicon CSV to: ${OUTPUT_CSV_PATH}`);

  // Write Metadata summary file
  const metadata = {
    datasetName: "MediFind AI Indian Medicine Reference Lexicon (v2 - Corrected)",
    version: "2.0.0",
    releaseDate: "2026-10-20",
    provenance: {
      originalRepository: "https://github.com/junioralive/Indian-Medicine-Dataset",
      author: "JuniorAlive",
      licence: "MIT License",
      licenceUrl: "https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/LICENSE",
      originalFileName: "indian_medicine_data.csv",
      accessDate: "2026-10-20"
    },
    curationChangesV2: {
      alphabeticalSampling: "Stratified deterministic sampling across A-Z buckets (~84-85 records/letter) replacing biased slice(0, 2200).",
      strengthParsing: "Non-numeric descriptors (Plain, Liposomal, Natural Micronized, NA) stripped from numeric strength; preserved as ingredient modifiers; unambiguous strengths parsed from product name when composition is NA.",
      dosageFormExpansion: "Added Infusion, Respule, Inhalation, Lotion, Topical Solution, Oral Solution patterns; preserved source wording; reduced generic Other.",
      regulatoryGovernance: "CDSCO Section 26A notification screening (G.S.R. 82(E), G.S.R. 889(E)) for Cisapride, pediatric/FDC Nimesulide; excluded prohibited from OCR matching suggestions."
    },
    statistics: {
      rawDatasetRows: rawRecordCount,
      discontinuedRowsExcluded: discontinuedCount,
      nonAllopathicRowsExcluded: nonAllopathyCount,
      missingCompositionExcluded: missingCompCount,
      deduplicatedFormulationsTotal: allDeduped.length,
      curatedLexiconEntries: formattedLexicon.length,
      singleIngredientEntries: formattedLexicon.filter(e => !e.isCombination).length,
      combinationDrugEntries: formattedLexicon.filter(e => e.isCombination).length,
      uniqueGenericEntities: new Set(formattedLexicon.map(e => e.genericName.toLowerCase())).size,
      uniqueManufacturers: new Set(formattedLexicon.map(e => e.manufacturer)).size,
      strengthVerifiedCount: formattedLexicon.filter(e => e.strengthVerified).length,
      strengthReviewRequiredCount: formattedLexicon.filter(e => e.strengthReviewRequired).length,
      regulatoryStandardAllopathicCount: standardCount,
      regulatoryProhibitedCount: prohibitedCount,
      regulatoryReviewRequiredCount: reviewRequiredCount,
      eligibleForMatchingCount: formattedLexicon.filter(e => e.isEligibleForMatching).length
    },
    letterDistribution: finalLetterDist,
    dosageFormBreakdown: dosageFormDist,
    commonMedicinesVerification: foundBrands
  };

  fs.writeFileSync(OUTPUT_METADATA_PATH, JSON.stringify(metadata, null, 2), 'utf-8');
  console.log(`Saved v2 metadata to: ${OUTPUT_METADATA_PATH}`);
  console.log('\n=== Lexicon V2 Generation Complete ===');
}

buildLexiconV2().catch(err => {
  console.error('Lexicon builder failed:', err);
  process.exit(1);
});
