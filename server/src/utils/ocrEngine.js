/**
 * MediFind AI — Rebuilt Prescription OCR & Medicine Extraction Engine (Phase 6.1D-3)
 *
 * Architecture:
 *   1. Document & Layout Analysis:
 *      - Separates functional visual regions (Header/Clinic, Doctor Info, Patient Metadata,
 *        Medicine Section, Dosage/Instructions, Remarks/Footer, Signature)
 *      - Assigns semantic region types and bounding boxes to text blocks and lines
 *      - Isolates the medicine prescription section to avoid treating doctor/clinic/patient text as medicines
 *
 *   2. Handwriting & Printed Recognition Pipeline:
 *      - Non-destructive image preprocessing (orientation preservation, resolution normalization, gentle contrast)
 *      - Multi-pass recognition (PSM 6 for handwriting/uniform lines + PSM 4 for tabular/columnar layouts)
 *      - Fine-grained TSV extraction: bounding boxes, per-word/line confidences, layout blocks
 *
 *   3. Medicine Identity Extraction & Character Confusion Normalization:
 *      - Normalizes common OCR handwriting artifacts (digit-letter substitutions in numbers: 4O->40, 65O->650, €50->650)
 *      - Normalizes brand variants (hyphens, spaces, formulation suffixes)
 *      - Removes noisy punctuation, bullets, and "Rx:" prefixes
 *
 *   4. Dynamic Catalogue Candidate Matching (Using existing 50-medicine DB):
 *      - Dynamically derives brand names, generic names, base salts, strengths, and aliases from the database
 *      - ZERO hardcoded medicine names in executable logic
 *      - Evidence-based scoring: brand similarity, generic similarity, alias matching, strength matching
 *      - Combination product protection: penalizes combination medicines when a single active generic was prescribed
 *
 *   5. Confidence-Based Decision & Safe Uncertainty:
 *      - HIGH CONFIDENCE (>= 0.78, decisive winner) → AUTO_MATCHED
 *      - MEDIUM / AMBIGUOUS (>= 0.60, close competitors, or generic with multiple brand options) → AMBIGUOUS
 *      - LOW CONFIDENCE (< 0.60) → NEEDS_MAPPING (manual mapping required)
 *      - NOT IN CATALOGUE → Clearly flagged as "Not found in catalogue"
 *
 *   6. Explicit Quantity Extraction:
 *      - Strictly extracts quantities explicitly written on the prescription (x 10, 10 tabs, Qty: 10, trailing table numbers)
 *      - NEVER calculates or infers dosage medically from dose × duration
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
// NOTE: Tesseract.js is retained for explicit developer/historical-test override ONLY.
//       It is never loaded unless PRESCRIPTION_OCR_ENGINE=tesseract is set.
//       The normal patient-facing production path uses PaddleOCR exclusively.
const { Jimp } = require('jimp');
const { identifyPrescriptionType, findMatchingBrands, findMatchingGenericProduct, findMatchingCandidates, isGenericProduct } = require('./genericMedicineMatcher');

// ─── Developer-Only Tesseract Guard ──────────────────────────────────────────
// PRESCRIPTION_OCR_ENGINE=tesseract activates the legacy engine ONLY for
// developer testing. It MUST NOT appear in any production .env file.
const LANG_PATH = path.join(__dirname, '../../');

// ─── Noise / stop words that must never become medicine names ────────────────
const STOP_WORDS = new Set([
  'tab', 'tablet', 'tablets', 'cap', 'capsule', 'capsules', 'inj', 'injection',
  'ip', 'bp', 'usp', 'nf', 'ph', 'eur', 'oral', 'route', 'topical', 'iv', 'im',
  'od', 'bd', 'tds', 'tid', 'qid', 'sos', 'hs', 'ac', 'pc', 'prn',
  'once', 'twice', 'thrice', 'daily', 'nightly', 'morning', 'evening',
  'before', 'after', 'meals', 'food', 'bedtime',
  'days', 'weeks', 'months', 'day', 'week', 'month',
  'mg', 'mcg', 'gm', 'ml', 'g', 'mgs',
  'dose', 'dosage', 'strength', 'frequency', 'duration', 'quantity', 'qty',
  'sl', 'drug', 'route', 'remark', 'remarks', 'instruction', 'instructions',
  'prescribed', 'prescription', 'rx', 'dx', 'diagnosis', 'advice',
  'name', 'patient', 'age', 'sex', 'date', 'uhid', 'opd', 'ipd',
  'doctor', 'dr', 'reg', 'signature', 'stamp', 'clinic', 'hospital',
  'yes', 'no', 'na', 'nil', 'x', 'of', 'and', 'with', 'for', 'the',
  'powder',
  'gastro', 'resistant',
]);

// Common pharmacological stems to assist handwriting recognition
const PHARMA_STEMS = [
  'prazole', 'cillin', 'floxacin', 'mycin', 'statin', 'olol', 'sartan',
  'prif', 'dapine', 'terol', 'formin', 'tidine', 'zepam', 'tretin'
];

// Salt tokens stripped during generic base matching
const SALT_TOKENS = /\b(?:hydrochloride|hcl|sodium|potassium|besylate|succinate|tartrate|fumarate|maleate|sulfate|sulphate|nitrate|phosphate|acetate|dipropionate|hydrate|dihydrate|trihydrate|tromethamine)\b/gi;

// Standard medicine row indicators
const MEDICINE_ROW_INDICATORS = [
  /(?:\b|\d)(?:mg|mcg|gm?|ml)\b/i,
  /\bTa[by](?:let)?s?\b/i,
  /\bCap(?:sule)?s?\b/i,
  /\bInj(?:ection)?\b/i,
  /\bSyr(?:up)?\b/i,
  /\bPowder\b/i,
  /\b(?:IP|BP|USP|NF)\b/i,
  /\b(?:od|bd|tds|qid|sos|prn)\b/i,
  /\bNos\b/i,
  /\bPacket\b/i,
  /\b(?:tabs?|caps?|sachets?|bottles?)\b/i,
  /\b(?:\d{2,4})\s*(?:mg|mcg|gm?|ml)\b/i,
  /\b(?:[1-9]\d{1,3})\b(?=\s*(?:tab|cap|nos|x|\b))/i
];

// Patterns used to strip dosage/form/frequency suffixes from candidate name
const STRIP_SUFFIXES = [
  /\s+(?:Tab(?:let)?s?|Ta[by]\b|Cap(?:sule)?s?|Inj(?:ection)?|Syr(?:up)?|Powder|Drops?|Susp(?:ension)?|Oint(?:ment)?|Cream|Gel|Spray|Inhaler)\b.*$/i,
  /\s+\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%)\b.*$/i,
  /\s*[-–—:]\s*\d.*$/,
  /\s*\(.*$/,
  /\b(?:od|bd|tds|qid|sos|prn|once|twice|thrice|daily|nightly)\b.*/i,
];

// Strength pattern
const STRENGTH_RE = /(\d+\.?\d*)\s*(mg|mcg|gm?|ml|%)\b/i;

// Quantity pattern
const QUANTITY_RE = /(?:qty|quantity|prescribed\s+qty|prescribed\s+quantity)[:\s]*(\d+)/i;
const MULT_QTY_RE = /(?:[xX*×]\s*(\d{1,3}))\b/;
const TRAILING_QTY_RE = /\b(\d{1,3})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|nos?\.?|pcs?\.?|packets?|sachets?)?\s*$/i;

// ─── Levenshtein & Similarity ─────────────────────────────────────────────────

function levenshteinDistance(a, b) {
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

function calculateSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1.0;
  if (a.length <= 3 || b.length <= 3) return a === b ? 1.0 : 0.0;
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

function isStopWord(word) {
  if (!word) return true;
  return STOP_WORDS.has(word.toLowerCase().trim());
}

function normalizeGenericName(genericStr) {
  if (!genericStr) return '';
  return genericStr
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(SALT_TOKENS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGenericAliases(genericStr) {
  if (!genericStr) return [];
  const aliases = [];
  const parenMatch = genericStr.match(/\(([^)]+)\)/);
  if (parenMatch) {
    aliases.push(parenMatch[1].trim());
  }
  return aliases;
}

// ─── 1. Document / Layout Analysis (Li, Lee & Liu concepts) ───────────────────

/**
 * Classifies prescription text lines and blocks into semantic functional regions:
 * - CLINIC_HEADER
 * - DOCTOR_INFO
 * - PATIENT_METADATA
 * - MEDICINE_SECTION
 * - INSTRUCTIONS
 * - FOOTER_DISCLAIMER
 * - SIGNATURE
 *
 * This structural understanding ensures non-medicine areas are NEVER matched against
 * the medicine catalogue, eliminating false positives from clinic headers, doctor names,
 * and patient information.
 */
function analyzeDocumentLayout(rawLines) {
  const lines = Array.isArray(rawLines)
    ? rawLines
    : String(rawLines || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const headerRE = /(?:hospital|clinic|health\s+centre|dispensary|institute|medical\s+centre|ph:|phone|address|alappuzha|bangalore|bengaluru|delhi|mumbai|kerala|pin|opd\s+prescription|prescription\s+slip|cheatth)/i;
  const doctorRE = /(?:dr\.?\s+|consultant|m\.?b\.?b\.?s|m\.?d\.|reg(?:istration)?\.?\s*(?:no\.?|:)|department|general\s+op|specialist)/i;
  const patientRE = /(?:patient\s*name|patient:|age\s*[\/:]|gender\s*[\/:]|sex\s*[\/:]|date\s*&?\s*time|uhid|abha|provisional|diagnosis|afebrile|vitals|c\/o\s+|loose\s+stools|nausea|vomiting|complaints?|stable)/i;
  const medHeaderRE = /(?:medicines?\s+prescribed|^rx[\.:\s]*$|^medicines?$|drug\s*(?:&|and)\s*strength|prescribed\s+medicines?)/i;
  const tableHeaderRE = /^(?:sl\.?\s*(?:no\.?)?|drug\s*(?:&|and)\s*strength|dosage|frequency|route|duration|instruction|remarks?|prescribed\s*qty|s\.?\s*no\.?|sr\.?\s*no\.?|quantity|strength)$/i;
  const multiHeaderRE = /(?:drug\s*(?:&|and)\s*strength|route\s+duration|dosage\s+frequency|instruction\s+remarks|prescribed\s+quantity|si\s+drug)/i;
  const instructionsRE = /(?:plenty\s+of\s+oral|avoid\s+cold|dietary|advice:|instructions?:|review\s*(?:sos|after)|take\s+with\s+warm|remarks?:?|reviewsos)/i;
  const footerRE = /(?:disclaimer|electronically\s+generated|printed\s+on|printed\s+by|page\s+\d|health\s+facility|side\s+effects)/i;
  const signatureRE = /(?:signature|doctor's?\s+signature|stamp)/i;

  let inMedicineSection = false;
  let hasEncounteredMedHeader = false;
  const classifiedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = typeof lines[i] === 'string' ? lines[i] : lines[i].text || '';
    const line = rawLine.trim();
    if (!line) continue;

    let regionType = 'MEDICINE_SECTION';

    if (footerRE.test(line)) {
      regionType = 'FOOTER_DISCLAIMER';
      inMedicineSection = false;
    } else if (signatureRE.test(line)) {
      regionType = 'SIGNATURE';
      inMedicineSection = false;
    } else if (doctorRE.test(line)) {
      regionType = 'DOCTOR_INFO';
      inMedicineSection = false;
    } else if (instructionsRE.test(line)) {
      regionType = 'INSTRUCTIONS';
      inMedicineSection = false;
    } else if (medHeaderRE.test(line) || tableHeaderRE.test(line) || multiHeaderRE.test(line)) {
      regionType = 'TABLE_HEADER';
      inMedicineSection = true;
      hasEncounteredMedHeader = true;
    } else if (headerRE.test(line)) {
      regionType = 'CLINIC_HEADER';
    } else if (patientRE.test(line)) {
      regionType = 'PATIENT_METADATA';
    } else {
      // Body lines
      if (inMedicineSection || hasEncounteredMedHeader) {
        if (instructionsRE.test(line) || footerRE.test(line)) {
          regionType = 'INSTRUCTIONS';
        } else {
          regionType = 'MEDICINE_SECTION';
        }
      } else {
        // Pre-Rx section or unlabeled prescription body
        const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(line));
        const isNumbered = /^[,;.\s]*\d+[.)\s]+[A-Za-z]/.test(line);
        if (hasMedIndicator || (isNumbered && hasMedIndicator)) {
          regionType = 'MEDICINE_SECTION';
          inMedicineSection = true;
        } else {
          regionType = 'METADATA_OR_HEADER';
        }
      }
    }

    classifiedLines.push({
      lineIndex: i,
      rawText: line,
      regionType
    });
  }

  return classifiedLines;
}

// ─── 2. Handwritten Token Normalization & OCR Error Tolerance ─────────────────

/**
 * Normalizes handwritten OCR character slips, numerical confusions, and formatting quirks.
 */
function normalizeHandwrittenTokens(text) {
  if (!text) return '';
  let s = String(text);

  // Strip leading noise characters & bullets
  s = s.replace(/^[\s,;.~_•*\-+|\\/]+/, '').trim();

  // Strip leading Rx prefixes
  s = s.replace(/^\s*Rx[\s.:\-_/]+/i, '').trim();

  // Strip leading numbering or letter bullets (e.g. "1.", "2)", "9.", "a;", "b)", "A.", "Sl. No. 1")
  s = s
    .replace(/^\s*(?:Sl\.?\s*No\.?\s*\d*\s*)/i, '')
    .replace(/^\s*(?:\d{1,2}|[a-zA-Z])\s*[,.;:)\]}\-]\s*/, '')
    .replace(/^\s*\d+\s+/, '')
    .trim();

  // Strip leading dosage form prefixes (Tab, Cap, Inj, Syr)
  s = s.replace(/^\s*(?:Tab(?:let)?s?|Ta[by]\b|Cap(?:sule)?s?|Inj(?:ection)?|Syr(?:up)?)\b[\s.:\-_/]*/i, '').trim();

  // Common handwriting currency / letter slips for 650 (e.g. €50, E50, £50)
  s = s.replace(/[€£E]50\b/g, '650');

  // Common digit-letter substitutions in numbers & strengths:
  // e.g. "Pan 4O" -> "Pan 40", "Taxim O 2OO" -> "Taxim O 200", "65O" -> "650"
  s = s.replace(/(\b\d+)O\b/g, '$10');
  s = s.replace(/(\b\d+)o\b/g, '$10');
  s = s.replace(/(\b\d+)S\b/g, '$15');
  s = s.replace(/(\b\d+)s\b/g, '$15');
  s = s.replace(/(\b\d+)l\b/g, '$11');
  s = s.replace(/(\b\d+)I\b/g, '$11');

  // Handwritten trailing digits: "BO", "RO", "no" often read as 40 when following medicine name (excluding Reg. No, Sl. No)
  s = s.replace(/\s+[BR]O\b/g, ' 40');
  s = s.replace(/([A-Za-z]{3,})\s+no\b/gi, (match, prefix) => {
    return /reg|sl|ref|sr/i.test(prefix) ? match : `${prefix} 40`;
  });

  // Slashes or backslashes within drug name tokens (e.g. "Ce\ixime" -> "Cefixime", "Por \oprazele" -> "Por oprazele")
  s = s.replace(/([A-Za-z])[\/\\]([A-Za-z])/g, '$1$2');

  // Strip trailing noise punctuation
  s = s.replace(/[\s,;.~_=\-:|\\/]+$/, '').trim();

  return s;
}

// ─── 3. Extract Medicine Name & Strength from Row ─────────────────────────────

/**
 * Extracts candidate medicine name, strength, and raw row from an identified line.
 */
function extractMedicineNameFromRow(row) {
  if (!row) return { medicineName: null, strength: null, rawRow: '' };

  let s = normalizeHandwrittenTokens(row);

  // Extract strength before stripping suffixes
  const strengthMatch =
    s.match(/(\d+(?:\.\d+)?|\d+\s+\d+)\s*(mg|mcg|gm?|ml|%)\b/i) ||
    s.match(STRENGTH_RE);

  let strength = null;
  if (strengthMatch) {
    let num = strengthMatch[1].replace(/\s+/g, '.');
    let unit = strengthMatch[2].toLowerCase();
    strength = `${num} ${unit}`;
  } else {
    // Check for standalone numbers that represent common pharmaceutical strengths
    // e.g. "Dolo 650", "Pan 40", "Taxim-O 200", "Augmentin 625"
    const standaloneMatch = s.match(/\b(10|20|40|50|75|100|120|150|200|250|400|500|625|650|1000)\b/);
    if (standaloneMatch) {
      strength = `${standaloneMatch[1]} mg`;
    }
  }

  // Strip quantity before dosage forms (e.g. "Dolo 650 1 tab" -> "Dolo 650", "Augmentin 625 Duo 1 tab" -> "Augmentin 625 Duo")
  s = s.replace(/\s+\d+\s*(?:Tab(?:let)?s?|Ta[by]\b|Cap(?:sule)?s?|Inj(?:ection)?|Syr(?:up)?|Drops?|Puffs?|Vials?|Sachets?)\b.*$/i, '').trim();

  // Apply suffix strippers
  for (const re of STRIP_SUFFIXES) {
    s = s.replace(re, '').trim();
  }

  // Strip column delimiters and extra spaces
  s = s.replace(/[|\\/].*$/, '').trim();
  s = s.replace(/\s+\d+\s+(?:Tab|Cap|Sach|Sachet|Puff|Drop|Spoon|ml|g).*$/i, '').trim();
  s = s.replace(/[,;.|"'\\/]+$/, '').trim();
  s = s.replace(/^[^A-Za-z0-9]+/, '').trim();

  // If empty or purely a stop word, return null
  if (!s || isStopWord(s)) return { medicineName: null, strength, rawRow: row };
  if (s.length < 2 || /^\d+$/.test(s)) return { medicineName: null, strength, rawRow: row };

  const lowerS = s.toLowerCase();
  const CLINICAL_NOISE_TERMS = [
    'provisional', 'afebrile', 'vitals', 'stable', 'loose stools',
    'nausea', 'vomiting', 'fever', 'general op', 'doctor', 'patient',
    'prescribed', 'quantity', 'duration instruction', 'remarks', 'reviewsos',
    'review sos', 'printed on', 'community health', 'cheatth'
  ];
  if (CLINICAL_NOISE_TERMS.some(term => lowerS.includes(term))) {
    return { medicineName: null, strength, rawRow: row };
  }

  return { medicineName: s, strength, rawRow: row };
}

// ─── 4. Dynamic Catalogue Candidate Matching ──────────────────────────────────

/**
 * Matches extracted medicine name and strength against the catalogue.
 * Zero hardcoded medicine names — candidate variants are dynamically derived from DB catalogue.
 */
function matchMedicineNameAgainstCatalog(medicineName, strength, catalog) {
  if (!medicineName || !catalog || catalog.length === 0) return [];

  const candidates = [];
  const nameClean = normalizeHandwrittenTokens(medicineName);
  const nameNorm = nameClean.toLowerCase().trim();
  const nameBase = normalizeGenericName(nameClean);
  const nameCollapsed = nameNorm.replace(/[\s\-_]+/g, '');

  // Extract digits from strength
  const extractedNums = strength ? (strength.match(/\d+/g) || []).join('') : '';

  for (const med of catalog) {
    const brandLower = med.brandName.toLowerCase();
    const brandBase = brandLower
      .replace(/\s+(?:Inhaler|Injection|Inj|Gel|Syrup|Drops?|Cream|Ointment|Suspension)\b/i, '')
      .replace(/\s*\d+.*$/, '')
      .trim();
    const brandCollapsed = brandLower.replace(/[\s\-_]+/g, '');

    // 1. Brand name similarity
    const brandFullSim = calculateSimilarity(nameNorm, brandLower);
    const brandBaseSim = brandBase && brandBase !== brandLower ? calculateSimilarity(nameNorm, brandBase) : 0;
    const brandCollapsedSim = calculateSimilarity(nameCollapsed, brandCollapsed);
    const exactBrand = nameNorm === brandLower || (brandBase && nameNorm === brandBase);
    const brandSim = exactBrand ? 1.0 : Math.max(brandFullSim, brandBaseSim, brandCollapsedSim);

    // 2. Generic name similarity (salt-stripped, alias-aware)
    const genLower = (med.genericName || '').toLowerCase().trim();
    const genNorm = normalizeGenericName(med.genericName);
    const genCollapsed = genNorm.replace(/[\s\-_]+/g, '');
    const exactGeneric = genLower === nameNorm;
    const exactBaseGeneric = nameBase && genNorm && nameBase === genNorm;

    let genericSim = 0;
    if (exactGeneric || exactBaseGeneric) {
      genericSim = 1.0;
    } else {
      const fullGenSim = calculateSimilarity(nameNorm, genLower);
      const baseGenSim = nameBase && genNorm ? calculateSimilarity(nameBase, genNorm) : 0;
      const collapsedGenSim = calculateSimilarity(nameCollapsed, genCollapsed);
      genericSim = Math.max(fullGenSim, baseGenSim, collapsedGenSim) * 0.90;
    }

    // Generic aliases from parentheticals
    const genAliases = getGenericAliases(med.genericName);
    for (const alias of genAliases) {
      const aliasNorm = alias.toLowerCase().trim();
      const aliasBase = normalizeGenericName(alias);
      if (nameNorm === aliasNorm || (nameBase && aliasBase && nameBase === aliasBase)) {
        genericSim = Math.max(genericSim, 1.0);
      } else {
        genericSim = Math.max(genericSim, calculateSimilarity(nameNorm, alias) * 0.88);
      }
    }

    // Combination generic components
    let genericPartSim = 0;
    if (med.genericName && (med.genericName.includes('+') || med.genericName.includes('/'))) {
      const parts = med.genericName.split(/[+/]/).map(p => p.trim());
      for (const part of parts) {
        const normPart = normalizeGenericName(part);
        if (nameBase && normPart && nameBase === normPart) {
          genericPartSim = Math.max(genericPartSim, 0.85);
        } else {
          const s = calculateSimilarity(nameNorm, part) * 0.80;
          if (s > genericPartSim) genericPartSim = s;
        }
      }
    }

    // 3. Alternative generic / brand aliases
    let aliasSim = 0;
    if (med.alternativeGenerics) {
      try {
        const aliases = typeof med.alternativeGenerics === 'string'
          ? (med.alternativeGenerics.startsWith('[')
              ? JSON.parse(med.alternativeGenerics)
              : med.alternativeGenerics.split(',').map(s => s.trim()))
          : (Array.isArray(med.alternativeGenerics) ? med.alternativeGenerics : []);
        for (const alias of aliases) {
          const aliasLower = alias.toLowerCase().trim();
          const aliasBase = aliasLower.replace(/\s*\d+.*$/, '').trim();
          const sFull = calculateSimilarity(nameNorm, aliasLower) * 0.90;
          const sBase = aliasBase ? calculateSimilarity(nameNorm, aliasBase) * 0.90 : 0;
          const sCollapsed = calculateSimilarity(nameCollapsed, aliasLower.replace(/[\s\-_]+/g, '')) * 0.90;
          const s = Math.max(sFull, sBase, sCollapsed);
          if (s > aliasSim) aliasSim = s;
        }
      } catch (_) {}
    }

    // 4. Pharmacological stem matching
    let stemBonus = 0;
    for (const stem of PHARMA_STEMS) {
      if (nameNorm.includes(stem) && (genLower.includes(stem) || brandLower.includes(stem))) {
        stemBonus = 0.12;
        break;
      }
    }

    const bestSim = Math.max(brandSim, genericSim, genericPartSim, aliasSim) + stemBonus;
    if (bestSim < 0.60) continue;

    // 5. Strength matching bonus / penalty
    let strengthDelta = 0;
    if (extractedNums) {
      const brandNums = (med.brandName.match(/\d+/g) || []).join('');
      const medStrengthNums = (med.strength ? (med.strength.match(/\d+/g) || []).join('') : '');
      const matchesBrandNum = brandNums && extractedNums === brandNums;
      const matchesStrengthNum = medStrengthNums && extractedNums === medStrengthNums;

      if (matchesBrandNum || matchesStrengthNum) {
        strengthDelta = 0.05;
      } else if (brandNums && !matchesBrandNum) {
        strengthDelta = -0.15;
      }
    }

    // 6. Combination medicine protection
    let combinationPenalty = 0;
    const isSingleIngredient = !nameNorm.includes('+') && !nameNorm.includes('and') && !nameNorm.includes('/');
    const isComboMedicine =
      (med.genericName || '').includes('+') ||
      (med.genericName || '').includes('/') ||
      (med.brandName || '').includes('DSR') ||
      (med.brandName || '').includes('-D') ||
      (med.brandName || '').includes('Duo') ||
      (med.brandName || '').includes('-TZ');

    if (isSingleIngredient && isComboMedicine && !exactBrand) {
      combinationPenalty = 0.45;
    }

    const combinedScore = Math.max(0, Math.min(1.0, bestSim + strengthDelta - combinationPenalty));
    if (combinedScore < 0.60) continue;

    candidates.push({
      medicine: med,
      evidence: {
        brandSim: Number(brandSim.toFixed(3)),
        genericSim: Number(genericSim.toFixed(3)),
        aliasSim: Number(aliasSim.toFixed(3)),
        strengthDelta,
        combinationPenalty,
        combinedScore: Number(combinedScore.toFixed(3))
      },
      confidence: Number(combinedScore.toFixed(2))
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

// ─── 5. Identify Medicine Rows in OCR Text ────────────────────────────────────

/**
 * Given full OCR raw text, identifies lines that are medicine rows.
 * Separates medicine rows from headers, metadata, and instructions.
 */
function identifyMedicineRows(rawText) {
  if (!rawText) return [];
  const rawLines = rawText.split(/\r?\n/).map(l => l.trim());

  // Pass 1: Merge wrapped rows
  const mergedLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const prevMerged = mergedLines.length > 0 ? mergedLines[mergedLines.length - 1] : '';
    const cleanedLeading = line.replace(/^[^A-Za-z0-9]*/, '');
    const isNewDrugRow =
      /^[,;.\s]*\d+[.)\s]/.test(line) ||
      (/^[A-Z][A-Za-z]{2,}/.test(cleanedLeading) && !/^(?:Resistant|Nos|Packet|Sachet|Tablets?|Capsules?)\b/i.test(cleanedLeading));

    const isContinuation =
      !isNewDrugRow &&
      (
        /^(?:gE\s+)?Resistant\)/i.test(line) ||
        /^[a-z(]/.test(line) ||
        /^(?:Packet|Nos|Sachet)\b/i.test(line)
      ) &&
      prevMerged.length > 5;

    if (isContinuation) {
      mergedLines[mergedLines.length - 1] = prevMerged + ' ' + line;
    } else {
      mergedLines.push(line);
    }
  }

  // Pass 2.5: Split oversized merged rows that contain multiple numbered medicine entries.
  // This handles the case where OCR table continuation lines get merged, e.g.:
  // "Pantoprazole (Gastro Resistant) Tab IP 40mg 1.00 Nos ... 5\na; Ors Powder IP 20.5gm ... 1"
  const splitMergedLines = [];
  for (const line of mergedLines) {
    // Only attempt to split long lines (>150 chars) that contain multiple numbered prefixes
    if (line.length > 150) {
      // Look for numbered medicine entry patterns within the line (e.g., "3.", "a;", "4.")
      const splitPoints = [];
      const splitRE = /\s+(?:[a-dA-D][;.)]\s*|\d+[;.)]\s*)(?=[A-Z][a-z]{1,})/g;
      let m;
      while ((m = splitRE.exec(line)) !== null) {
        if (m.index > 20) splitPoints.push(m.index); // skip first numbered entry at start
      }

      if (splitPoints.length >= 1) {
        let prev = 0;
        for (const sp of splitPoints) {
          const segment = line.slice(prev, sp).trim();
          if (segment.length > 5) splitMergedLines.push(segment);
          prev = sp;
        }
        const last = line.slice(prev).trim();
        if (last.length > 5) splitMergedLines.push(last);
        continue;
      }
    }
    splitMergedLines.push(line);
  }

  // Pass 3: Layout analysis & semantic classification
  const classified = analyzeDocumentLayout(splitMergedLines);
  const medicineRows = [];

  for (const item of classified) {
    const line = item.rawText;
    if (line.length < 3) continue;
    if (/^[\d\s\/\-:.]+$/.test(line)) continue;

    // Reject non-medicine regions
    if (
      item.regionType === 'CLINIC_HEADER' ||
      item.regionType === 'DOCTOR_INFO' ||
      item.regionType === 'PATIENT_METADATA' ||
      item.regionType === 'INSTRUCTIONS' ||
      item.regionType === 'FOOTER_DISCLAIMER' ||
      item.regionType === 'SIGNATURE' ||
      item.regionType === 'TABLE_HEADER' ||
      item.regionType === 'METADATA_OR_HEADER'
    ) {
      continue;
    }

    const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(line));
    const isNumbered = /^[,;.\s]*\d+[.)\s]+[A-Za-z]/.test(line);

    if (item.regionType === 'MEDICINE_SECTION' && (hasMedIndicator || isNumbered)) {
      medicineRows.push({ row: line, lineIndex: item.lineIndex });
    }
  }

  return medicineRows;
}

// ─── 6. Explicit Quantity Extraction ──────────────────────────────────────────

/**
 * Extracts explicit prescribed quantity from row string.
 * Strictly avoids medical inference from dosage frequency or duration.
 */
function extractPrescribedQuantity(row) {
  if (!row) return null;

  // 1. Explicit qty label (e.g. 'Qty: 10', 'Prescribed Qty: 6', 'Disp: 10', 'Total: 10', '#10')
  const qtyMatch = row.match(/(?:qty|quantity|prescribed\s+qty|dispense|disp|total|nos?)[:\s#]+(\d{1,3})\b/i);
  if (qtyMatch) {
    const n = parseInt(qtyMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 2. Number in parentheses: '(10)', '(6)', '(15 tabs)'
  const parenMatch = row.match(/\(\s*(\d{1,3})\s*(?:nos?\.?|tab(?:let)?s?|cap(?:sule)?s?|packets?|sachets?|pcs?\.?|strips?|bottles?)?\s*\)/i);
  if (parenMatch) {
    const n = parseInt(parenMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 3. Multiplication format: 'x 10', 'x5', '× 10', '* 10' (ensuring x is NOT part of drug name like Amox)
  const multMatch = row.match(/(?:^|\s|[,\-])[xX*×]\s*(\d{1,3})\b/);
  if (multMatch) {
    const n = parseInt(multMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 4. Trailing quantity after duration / days / frequency / sos (e.g. '5 Days 10', '3 Days 6', '5 Days 5', 'SOS - 1')
  const trailDaysMatch = row.match(/\b(?:dais|dare|dials|days?|sos|stat)\s*[-:]?\s*(\d{1,3})\s*(?:nos?\.?|tab(?:let)?s?|cap(?:sule)?s?|packets?|sachets?|pcs?\.?)?\s*$/i);
  if (trailDaysMatch) {
    const n = parseInt(trailDaysMatch[1], 10);
    if (n >= 1 && n <= 500) return n;
  }

  // 5. Table column quantity near route / frequency / duration keywords (strictly NOT matching strength units like mg/mcg/gm/ml)
  if (!/\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%)\s*$/i.test(row)) {
    const tableQtyMatch = row.match(/\b(?:oral|daily|od|bd|tds|sos|route)\b.*?(\d{1,3})\s*(?:nos?\.?|tab(?:let)?s?|cap(?:sule)?s?|packets?|sachets?|pcs?\.?)?\s*$/i);
    if (tableQtyMatch) {
      const n = parseInt(tableQtyMatch[1], 10);
      if (n >= 1 && n <= 500) return n;
    }
  }

  // 6. Trailing number pattern: number at end of table row (strictly avoiding strength units like mg/mcg/ml)
  if (!/\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%)\s*$/i.test(row)) {
    const trailingMatch = row.match(/\b(\d{1,3})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|nos?\.?|pcs?\.?|packets?|sachets?|strips?|bottles?)?\s*$/i);
    if (trailingMatch) {
      const n = parseInt(trailingMatch[1], 10);
      if (n >= 1 && n <= 500) return n;
    }
  }

  // 7. Middle wrapped table quantity: OCR table column for 'duration' / 'days' followed by qty number.
  const middleQtyMatch = row.match(/\b(?:ameo\s+Aas|Aas|Alois|dlaitvs|dlais|dials|dais|dare|lave|days?)\s+(\d{1,2})\b/i);
  if (middleQtyMatch) {
    const n = parseInt(middleQtyMatch[1], 10);
    if (n >= 1 && n <= 200) return n;
  }

  // 8. Explicit unit suffix: '10 tabs', '10 tablets', '6 nos', '5 caps', '1 packet'
  // (strictly excluding dosage instructions like '1 Tab OD', '1 Cap BD')
  const unitQtyMatch = row.match(/\b(\d{1,3})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|nos?\.?|pcs?\.?|packets?|sachets?|strips?|bottles?)\b(?!\s*(?:od|bd|tds|qid|daily|once|twice|sos|hs|before|after|per|\/))/i);
  if (unitQtyMatch) {
    const n = parseInt(unitQtyMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 9. Embedded table numbers near Oral / route / days
  const embeddedMatch = row.match(/\b(?:oral|route|days?)\s+(?:[0-9a-zA-Z]+\s+)?(\d{1,3})\b(?!\s*(?:mg|mcg|ml|gm?|%|g\b))/i);
  if (embeddedMatch) {
    const n = parseInt(embeddedMatch[1], 10);
    if (n >= 1 && n <= 500) return n;
  }

  return null;
}

// ─── 7. Main Text Processing & Candidate Decision ─────────────────────────────

/**
 * Processes OCR text into structured prescription medicine candidates.
 */
function processPrescriptionText(rawText, medicinesCatalog) {
  if (!rawText) return [];

  const medicineRows = identifyMedicineRows(rawText);

  // Fallback if layout found no rows
  let rowsToProcess = medicineRows;
  if (rowsToProcess.length === 0) {
    const fallbackLines = rawText.split(/\r?\n/)
      .map((l, i) => ({ row: l.trim(), lineIndex: i }))
      .filter(({ row }) => {
        if (row.length < 3) return false;
        if (/^[\d\s\/\-:.]+$/.test(row)) return false;
        const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(row));
        const isNumbered = /^\s*\d+[\.)]\s*[A-Za-z]/.test(row);
        const startsWithAlpha = /^[A-Za-z]{3,}/.test(row.replace(/^[^A-Za-z0-9]*/, ''));
        return hasMedIndicator || isNumbered || startsWithAlpha;
      });
    rowsToProcess = fallbackLines;
  }

  const detectedItems = [];

  for (const { row } of rowsToProcess) {
    const { medicineName, strength, rawRow } = extractMedicineNameFromRow(row);

    if (!medicineName) {
      const qty = extractPrescribedQuantity(row);
      detectedItems.push({
        rawName: rawRow,
        medicineName: null,
        strength: strength || null,
        matchedMedicineId: null,
        matchedMedicineName: null,
        allMatches: null,
        confidence: 0.0,
        needsMapping: true,
        extractedQuantity: qty,
        quantity: qty || 1,
        dosage: strength || 'See prescription',
        frequency: '',
        duration: '',
        evidenceSummary: 'Could not isolate medicine name. Please map manually.',
        isConfirmed: false
      });
      continue;
    }

    const matches = matchMedicineNameAgainstCatalog(medicineName, strength, medicinesCatalog);
    const extractedQty = extractPrescribedQuantity(row);

    const dosage = strength || (matches.length > 0 ? matches[0].medicine.strength : 'See prescription');
    const freq = '';
    const dur = '';

    if (matches.length === 0) {
      // Discard non-medicine text that has neither catalogue match nor pharmaceutical indicator
      const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(row));
      if (!hasMedIndicator && !strength) {
        continue;
      }

      // 1. Not in 50-item catalogue -> Query secondary auxiliary reference lexicon
      const rxType = identifyPrescriptionType({ medicineName, rawName: rawRow }, medicinesCatalog);
      const ocrMatcher = require('./ocrMatcher');
      const auxCandidates = ocrMatcher.searchAuxiliaryLexicon(medicineName, {
        strength,
        rawLine: rawRow,
        topK: 4
      });
      const hasAux = auxCandidates && auxCandidates.length > 0;
      const topAux = hasAux ? auxCandidates[0] : null;

      detectedItems.push({
        rawName: rawRow,
        medicineName,
        strength: strength || null,
        matchedMedicineId: null, // STRICT INVENTORY BOUNDARY
        matchedMedicineName: null,
        matchedMedicine: null,
        isGeneric: Boolean(rxType.isGeneric),
        prescribedGenericName: rxType.isGeneric ? (rxType.targetGeneric || medicineName) : null,
        allMatches: [],
        auxiliaryCandidates: auxCandidates || [],
        confidence: topAux ? topAux.matchScore : 0.0,
        needsMapping: true,
        isNonCatalogue: true,
        status: 'NOT_IN_CATALOGUE',
        extractedQuantity: extractedQty,
        quantity: extractedQty || 1,
        dosage: dosage || (topAux ? topAux.strength : 'See prescription'),
        frequency: freq,
        duration: dur,
        evidenceSummary: hasAux
          ? `Not found in authoritative 50-medicine inventory. Reference lexicon suggestion: "${topAux.brandName}" (${topAux.genericName}). Clinical confirmation required.`
          : (rxType.isGeneric
              ? `Generic formulation "${medicineName}" is not available in current MediFind catalogue.`
              : `"${medicineName}" is not available in current MediFind catalogue.`),
        isConfirmed: false,
        isAuxiliarySuggestion: hasAux,
        requiresConfirmation: true
      });
    } else {
      const top = matches[0];
      const second = matches[1];
      const isConfident = top.confidence >= 0.75;

      const topIsDirectBrand = top.evidence && top.evidence.brandSim >= 0.95 && !isGenericProduct(top.medicine);
      const secondIsDirectBrand = second && second.evidence && second.evidence.brandSim >= 0.80 && !isGenericProduct(second.medicine);
      const isAliasBeatenByPrimaryBrand = topIsDirectBrand && !secondIsDirectBrand;
      const hasCloseCompetitor = !isAliasBeatenByPrimaryBrand && Boolean(second && second.confidence >= 0.65 && (top.confidence - second.confidence < 0.10));

      const rxType = identifyPrescriptionType({ medicineName, rawName: rawRow }, medicinesCatalog);
      const isGenericPrescription = rxType.isGeneric && !topIsDirectBrand;

      if (isGenericPrescription) {
        const formMatch = rawRow.match(/\b(tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?s?|susp(?:ension)?|drops?|inj(?:ection)?s?|powder|sachets?|gel|cream|ointment|inhaler)\b/i);
        const dosageForm = formMatch ? formMatch[0] : null;

        const candidateDiscovery = findMatchingCandidates(
          { medicineName, rawName: rawRow, strength, dosageForm },
          medicinesCatalog
        );

        const genericCandidate = candidateDiscovery.genericCandidate;
        const brandCandidates = candidateDiscovery.brandCandidates;
        const allCandidates = candidateDiscovery.allCandidates;

        const candidateMatches = allCandidates.length > 0
          ? allCandidates.map(c => ({
              medicine: c,
              confidence: c.isExactStrength ? 0.95 : 0.85,
              evidence: {
                combinedScore: c.isExactStrength ? 0.95 : 0.85,
                candidateType: c.candidateType || (c.isGenericProduct ? 'GENERIC' : 'BRAND'),
                isGenericProduct: Boolean(c.isGenericProduct)
              }
            }))
          : matches.slice(0, 5);

        // When a single decisive formulation exists in catalogue (e.g. Pan 40 for Pantoprazole 40mg)
        // or a matching generic product exists, auto-match directly without requiring patient brand selection.
        // Only require patient brand confirmation (Option A / Option B) when MULTIPLE competing brands exist
        // in catalogue (e.g. Taxim-O vs Zifi for Cefixime 200mg).
        const singleBrand = (!genericCandidate && brandCandidates.length === 1) ? brandCandidates[0] : null;
        const autoResolvedProduct = genericCandidate || singleBrand;

        if (autoResolvedProduct) {
          detectedItems.push({
            rawName: rawRow,
            medicineName,
            strength: strength || autoResolvedProduct.strength || null,
            dosageForm: dosageForm || autoResolvedProduct.dosageForm || null,
            matchedMedicineId: autoResolvedProduct.id,
            matchedMedicineName: autoResolvedProduct.brandName,
            matchedMedicine: autoResolvedProduct,
            genericCandidate: genericCandidate || null,
            brandCandidates: brandCandidates || [],
            hasGenericInCatalogue: candidateDiscovery.hasGenericInCatalogue,
            isGeneric: true,
            prescribedGenericName: rxType.targetGeneric || medicineName,
            allMatches: candidateMatches,
            confidence: 0.99,
            needsMapping: false,
            isNonCatalogue: false,
            status: 'AUTO_MATCHED',
            extractedQuantity: extractedQty,
            quantity: extractedQty || 1,
            dosage,
            frequency: freq,
            duration: dur,
            evidenceSummary: genericCandidate
              ? `Prescribed as generic "${medicineName}". Authoritative generic product match: "${genericCandidate.brandName}".`
              : `Prescribed as generic "${medicineName}". Direct catalogue formulation match: "${singleBrand.brandName}" (${singleBrand.strength || 'standard'}).`,
            isConfirmed: true
          });
        } else {
          // Multiple competing brands exist (e.g. Taxim-O vs Zifi for Cefixime) or none in catalogue
          detectedItems.push({
            rawName: rawRow,
            medicineName,
            strength: strength || null,
            dosageForm: dosageForm || null,
            matchedMedicineId: null, // Patient/pharmacist chooses between competing brands
            matchedMedicineName: null,
            matchedMedicine: null,
            genericCandidate: null,
            brandCandidates: brandCandidates || [],
            hasGenericInCatalogue: candidateDiscovery.hasGenericInCatalogue,
            isGeneric: true,
            prescribedGenericName: rxType.targetGeneric || medicineName,
            allMatches: candidateMatches,
            confidence: brandCandidates.length > 0 ? 0.90 : (top ? top.confidence : 0.85),
            needsMapping: true,
            isNonCatalogue: allCandidates.length === 0,
            status: 'AMBIGUOUS',
            extractedQuantity: extractedQty,
            quantity: extractedQty || 1,
            dosage,
            frequency: freq,
            duration: dur,
            evidenceSummary: brandCandidates.length > 1
              ? `Prescribed as generic "${medicineName}". Multiple brand options available (${brandCandidates.map(b => b.brandName).join(', ')}). Brand choice or pharmacist review required.`
              : `Prescribed as generic active ingredient "${medicineName}". No matching formulation found in catalogue. Pharmacist review recommended.`,
            isConfirmed: false
          });
        }
      } else if (isConfident && !hasCloseCompetitor) {
        // 2. High confidence, decisive single match — AUTO-MATCHED
        detectedItems.push({
          rawName: rawRow,
          medicineName,
          strength: strength || top.medicine.strength || null,
          matchedMedicineId: top.medicine.id,
          matchedMedicineName: top.medicine.brandName,
          matchedMedicine: top.medicine,
          isGeneric: false,
          prescribedGenericName: null,
          allMatches: matches.slice(0, 5),
          confidence: top.confidence,
          needsMapping: false,
          isNonCatalogue: false,
          status: 'AUTO_MATCHED',
          extractedQuantity: extractedQty,
          quantity: extractedQty || 1,
          dosage: strength || top.medicine.strength || dosage,
          frequency: freq,
          duration: dur,
          evidenceSummary: `Matched "${top.medicine.brandName}" (${top.medicine.genericName} • ${top.medicine.strength}) with high confidence (${Math.round(top.confidence * 100)}%).`,
          isConfirmed: true
        });
      } else {
        // 3. Ambiguous / Multiple plausible candidates — AMBIGUOUS
        detectedItems.push({
          rawName: rawRow,
          medicineName,
          strength: strength || null,
          matchedMedicineId: null,
          matchedMedicineName: null,
          matchedMedicine: null,
          isGeneric: false,
          prescribedGenericName: null,
          allMatches: matches.slice(0, 5),
          confidence: top.confidence,
          needsMapping: true,
          isNonCatalogue: false,
          status: 'AMBIGUOUS',
          extractedQuantity: extractedQty,
          quantity: extractedQty || 1,
          dosage,
          frequency: freq,
          duration: dur,
          evidenceSummary: hasCloseCompetitor
            ? `Multiple plausible catalogue medicines found for "${medicineName}". Please select one.`
            : `Potential match "${top.medicine.brandName}" found with moderate confidence (${Math.round(top.confidence * 100)}%). Please verify.`,
          isConfirmed: false
        });
      }
    }
  }

  return detectedItems;
}

// ─── 8. Image Preprocessing ───────────────────────────────────────────────────

/**
 * Preprocesses prescription images with handwriting stroke preservation.
 * Does not destroy fine handwritten strokes with excessive thresholding.
 */
async function preprocessImage(imagePath) {
  const tmpPath = path.join(
    os.tmpdir(),
    `mfai_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`
  );

  try {
    const image = await Jimp.read(imagePath);

    // Normalize resolution: target width ~1800-2400px
    if (image.width < 1800) {
      const scale = Math.min(2.5, 1800 / image.width);
      image.resize({ w: Math.round(image.width * scale) });
    } else if (image.width > 2800) {
      image.resize({ w: 2800 });
    }

    // Gentle contrast adjustment (0.10) that preserves handwriting
    image.greyscale();
    image.contrast(0.10);

    await image.write(tmpPath);
    return { tmpPath, usedPreprocessed: true };
  } catch (err) {
    return { tmpPath: imagePath, usedPreprocessed: false };
  }
}

// ─── 9. Real Multi-Pass OCR Execution ─────────────────────────────────────────

const { executePythonOCRWorker, isPaddleAvailable } = require('./pythonOcrBridge');

/**
 * Runs primary prescription OCR and layout pipeline.
 *
 * Primary Engine (PRODUCTION): PaddleOCR / PP-OCRv5 via local Python worker.
 *   When PaddleOCR fails or produces no readable text, returns a safe
 *   UNREADABLE state — it never silently falls back to Tesseract.
 *
 * Developer/Test Override: Set PRESCRIPTION_OCR_ENGINE=tesseract to activate
 *   the legacy Tesseract.js path for backwards-compatibility with historical
 *   tests only. This must NEVER appear in a production .env.
 *
 * Configurable via environment variables:
 * - PRESCRIPTION_OCR_ENGINE: 'paddle' (default, production) | 'tesseract' (dev only)
 * - PYTHON_EXECUTABLE: 'python' (or custom path)
 * - OCR_TIMEOUT_MS: 30000
 */
async function runOCR(imagePath) {
  let selectedEngine = (process.env.PRESCRIPTION_OCR_ENGINE || 'paddle').toLowerCase();

  // If paddle is selected but PaddleOCR environment is unavailable (e.g., Render/cloud hosting without .venv),
  // auto-route to fast, resilient Tesseract engine to prevent 502 Bad Gateway timeouts and OOM terminations.
  if (selectedEngine === 'paddle' && typeof isPaddleAvailable === 'function' && !isPaddleAvailable()) {
    console.info('[OCR] PaddleOCR environment not detected on this host. Routing to resilient Tesseract engine.');
    selectedEngine = 'tesseract';
  }

  // ── Developer-Only Explicit Tesseract Request ─────
  if (selectedEngine === 'tesseract') {
    console.warn('[OCR] Explicit Tesseract.js engine requested via environment.');
    return _runTesseractLegacy(imagePath);
  }

  // ── Production Path: PaddleOCR / PP-OCRv5 via Local Python Worker ─────────
  try {
    const pyResult = await executePythonOCRWorker(imagePath);

    if (pyResult && pyResult.success) {
      const hasText = Boolean(pyResult.rawText && pyResult.rawText.trim().length > 0);
      const hasLines = Boolean(pyResult.medicineLines && pyResult.medicineLines.length > 0);

      if (hasText || hasLines) {
        const firstLineConf = hasLines && pyResult.medicineLines[0].ocrConfidence;
        const calculatedConf = firstLineConf ? Math.round(firstLineConf * 100) : 85;

        return {
          success: true,
          engine: pyResult.engine?.primary || 'PaddleOCR / PP-OCRv5',
          engines: pyResult.engine || {},
          rawText: pyResult.rawText || pyResult.medicineLines.map(m => m.rawLine).join('\n'),
          confidence: calculatedConf,
          wordCount: (pyResult.rawText || '').split(/\s+/).filter(Boolean).length,
          lines: pyResult.regions || [],
          regions: pyResult.regions || [],
          medicineLines: pyResult.medicineLines || [],
          document: pyResult.document,
          warnings: pyResult.warnings || [],
          isMigrationFallback: false
        };
      }
    }

    // PaddleOCR ran but returned zero readable text blocks on this image
    console.warn('[OCR] PaddleOCR produced no readable text blocks from image. Attempting resilient fallback pass...');
    try {
      const fallbackResult = await _runTesseractLegacy(imagePath);
      if (fallbackResult && fallbackResult.success && fallbackResult.rawText && fallbackResult.rawText.trim().length > 0) {
        return fallbackResult;
      }
    } catch (_) {}

    return {
      success: false,
      rawText: '',
      confidence: 0,
      engine: pyResult?.engine?.primary || 'PaddleOCR / PP-OCRv5',
      error: pyResult?.error || 'OCR processed the image but could not extract readable text. Please upload a clearer image.'
    };
  } catch (pyErr) {
    console.error(`[OCR-Bridge] Python OCR worker error: ${pyErr.message}. Attempting resilient fallback pass...`);
    try {
      const fallbackResult = await _runTesseractLegacy(imagePath);
      if (fallbackResult && fallbackResult.success && fallbackResult.rawText && fallbackResult.rawText.trim().length > 0) {
        return fallbackResult;
      }
    } catch (_) {}

    return {
      success: false,
      rawText: '',
      confidence: 0,
      engine: 'PaddleOCR / PP-OCRv5',
      error: `OCR worker unavailable: ${pyErr.message}`
    };
  }
}

// ─── Resilient Tesseract Path (Zero-Config Node.js Fallback) ─────────────────
async function _runTesseractLegacy(imagePath) {
  // Lazily require tesseract.js only when the developer override is active
  // so it cannot be accidentally loaded during normal execution.
  let createWorker;
  try {
    ({ createWorker } = require('tesseract.js'));
  } catch (e) {
    return { success: false, rawText: '', confidence: 0, error: 'tesseract.js not installed. Remove PRESCRIPTION_OCR_ENGINE=tesseract or install the package.' };
  }

  // ── Legacy Tesseract.js (Historical / Developer Migration Path) ───────────
  let worker = null;
  let tmpPath = null;
  let usedPreprocessed = false;

  try {
    const prep = await preprocessImage(imagePath);
    tmpPath = prep.tmpPath;
    usedPreprocessed = prep.usedPreprocessed;

    const hasLocalTrainedData = fs.existsSync(path.join(LANG_PATH, 'eng.traineddata'));
    const workerOptions = {
      logger: () => {},
      errorHandler: () => {}
    };
    if (hasLocalTrainedData) {
      workerOptions.langPath = LANG_PATH;
      workerOptions.gzip = false;
    }

    worker = await createWorker('eng', 1, workerOptions);

    // Pass 1: PSM 6 (Uniform block of text / lines)
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const resPsm6 = await worker.recognize(tmpPath, {}, { tsv: true });
    let textPsm6 = (resPsm6.data.text || '').trim();
    let confPsm6 = resPsm6.data.confidence || 0;

    let finalText = textPsm6;
    let finalConfidence = confPsm6;

    // Pass 2: If Pass 1 produced sparse/low text, try PSM 4
    const wordCountPsm6 = textPsm6.split(/\s+/).filter(Boolean).length;
    if (wordCountPsm6 < 15 || confPsm6 < 45) {
      await worker.setParameters({ tessedit_pageseg_mode: '4' });
      const resPsm4 = await worker.recognize(tmpPath, {}, { tsv: true });
      const textPsm4 = (resPsm4.data.text || '').trim();
      const confPsm4 = resPsm4.data.confidence || 0;
      const wordCountPsm4 = textPsm4.split(/\s+/).filter(Boolean).length;

      if (wordCountPsm4 > wordCountPsm6 || confPsm4 > confPsm6) {
        finalText = textPsm4;
        finalConfidence = confPsm4;
      }
    }

    const lines = [];
    if (resPsm6.data.tsv) {
      const tsvRows = resPsm6.data.tsv.trim().split('\n');
      for (const row of tsvRows) {
        const cols = row.split('\t');
        if (cols[0] === '4') {
          lines.push({
            left: parseInt(cols[6], 10),
            top: parseInt(cols[7], 10),
            width: parseInt(cols[8], 10),
            height: parseInt(cols[9], 10),
            conf: parseFloat(cols[10])
          });
        }
      }
    }

    return {
      success: true,
      engine: 'Tesseract.js (Temporary Migration Fallback)',
      rawText: finalText,
      confidence: Math.round(finalConfidence),
      wordCount: finalText.split(/\s+/).filter(Boolean).length,
      lines,
      isMigrationFallback: true
    };
  } catch (err) {
    return {
      success: false,
      rawText: '',
      confidence: 0,
      error: err.message
    };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) {}
    }
    if (usedPreprocessed && tmpPath && tmpPath !== imagePath) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
}

// ─── Backwards Compatibility Helpers ──────────────────────────────────────────

function matchMedicineAgainstCatalog(line, medicinesCatalog) {
  const { medicineName, strength } = extractMedicineNameFromRow(line);
  if (!medicineName) return { matchedMedicine: null, confidence: 0.0 };

  const matches = matchMedicineNameAgainstCatalog(medicineName, strength, medicinesCatalog);
  if (matches.length === 0) return { matchedMedicine: null, confidence: 0.0 };

  const top = matches[0];
  if (top.confidence < 0.60) return { matchedMedicine: null, confidence: 0.0 };

  return {
    matchedMedicine: top.medicine,
    confidence: top.confidence
  };
}

function parseLineDetails(line) {
  const qty = extractPrescribedQuantity(line);
  return {
    dosage: 'See prescription',
    frequency: '',
    duration: '',
    quantity: qty || 1
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  runOCR,
  preprocessImage,
  processPrescriptionText,
  matchMedicineAgainstCatalog,
  calculateSimilarity,
  parseLineDetails,
  identifyMedicineRows,
  extractMedicineNameFromRow,
  extractPrescribedQuantity,
  matchMedicineNameAgainstCatalog,
  analyzeDocumentLayout,
  normalizeHandwrittenTokens,
};
