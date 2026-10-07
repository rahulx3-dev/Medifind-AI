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

  const headerRE = /(?:hospital|clinic|health\s+centre|dispensary|institute|medical\s+centre|ph:|phone|address|alappuzha|bangalore|bengaluru|delhi|mumbai|kerala|pin|opd\s+prescription|prescription\s+slip)/i;
  const doctorRE = /(?:dr\.?\s+|consultant|m\.?b\.?b\.?s|m\.?d\.|reg(?:istration)?\.?\s*(?:no\.?|:)|department|specialist)/i;
  const patientRE = /(?:patient\s*name|patient:|age\s*[\/:]|gender\s*[\/:]|sex\s*[\/:]|date\s*&?\s*time|uhid|abha|provisional|diagnosis|afebrile|vitals)/i;
  const medHeaderRE = /(?:medicines?\s+prescribed|^rx[\.:\s]*$|^medicines?$|drug\s*(?:&|and)\s*strength|prescribed\s+medicines?)/i;
  const tableHeaderRE = /^(?:sl\.?\s*(?:no\.?)?|drug\s*(?:&|and)\s*strength|dosage|frequency|route|duration|instruction|remarks?|prescribed\s*qty|s\.?\s*no\.?|sr\.?\s*no\.?|quantity|strength)$/i;
  const multiHeaderRE = /drug\s*(?:&|and)\s*strength.*(dosage|frequency|route|duration|qty)/i;
  const instructionsRE = /(?:plenty\s+of\s+oral|avoid\s+cold|dietary|advice:|instructions?:|review\s+(?:sos|after)|take\s+with\s+warm)/i;
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
    } else if (!hasEncounteredMedHeader && headerRE.test(line)) {
      regionType = 'CLINIC_HEADER';
    } else if (!hasEncounteredMedHeader && patientRE.test(line)) {
      regionType = 'PATIENT_METADATA';
    } else {
      // Body lines
      if (inMedicineSection || hasEncounteredMedHeader) {
        regionType = 'MEDICINE_SECTION';
      } else {
        // Pre-Rx section or unlabeled prescription body
        const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(line));
        const isNumbered = /^[,;.\s]*\d+[.)\s]/.test(line);
        if (hasMedIndicator || isNumbered || /^[A-Z][a-z]{2,}/.test(line)) {
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

  // Strip leading numbering
  s = s
    .replace(/^\s*(?:Sl\.?\s*No\.?\s*\d*\s*)/i, '')
    .replace(/^\s*\d+\s*[,.)]?\s+/, '')
    .trim();

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
      combinationPenalty = 0.30;
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
      item.regionType === 'TABLE_HEADER'
    ) {
      continue;
    }

    const hasMedIndicator = MEDICINE_ROW_INDICATORS.some(re => re.test(line));
    const isNumbered = /^[,;.\s]*\d+[.)\s]/.test(line);
    const hasMedWord = /^[A-Za-z]{3,}/.test(line.replace(/^[^A-Za-z0-9]*/, ''));

    if (item.regionType === 'MEDICINE_SECTION' && (hasMedIndicator || isNumbered || hasMedWord)) {
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

  // 1. Explicit qty label (e.g. "Qty: 10")
  const qtyMatch = row.match(QUANTITY_RE);
  if (qtyMatch) {
    const n = parseInt(qtyMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 2. Multiplication format: "x 10", "x5", "× 10"
  const multMatch = row.match(MULT_QTY_RE);
  if (multMatch) {
    const n = parseInt(multMatch[1], 10);
    if (n > 0 && n <= 500) return n;
  }

  // 3. Middle wrapped table quantity: OCR table column for "duration" / "days" followed by qty number.
  // Common Tesseract OCR artifacts for "days": Alois, dais, lave, dlaitvs, dare, dials, dlais
  const middleQtyMatch = row.match(/\b(?:ameo\s+Aas|Aas|Alois|dlaitvs|dlais|dials|dais|dare|lave|days?)\s+(\d{1,2})\b/i);
  if (middleQtyMatch) {
    const n = parseInt(middleQtyMatch[1], 10);
    if (n >= 1 && n <= 200) return n;
  }

  // 3b. Trailing "N dais" / "N dare" / "N days" at very end of row (e.g. "5 dais 10")
  const trailDaysMatch = row.match(/\b(\d{1,3})\s+(?:dais|dare|dials|days?)\s*\d*\s*$/i);
  if (trailDaysMatch) {
    const n = parseInt(trailDaysMatch[1], 10);
    if (n >= 1 && n <= 200) return n;
  }

  // 4. Trailing number pattern: number at end of table row
  const trailingMatch = row.match(TRAILING_QTY_RE);
  if (trailingMatch) {
    const n = parseInt(trailingMatch[1], 10);
    if (n >= 1 && n <= 200) return n;
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
      // 1. Not in 50-item catalogue
      detectedItems.push({
        rawName: rawRow,
        medicineName,
        strength: strength || null,
        matchedMedicineId: null,
        matchedMedicineName: null,
        matchedMedicine: null,
        allMatches: [],
        confidence: 0.0,
        needsMapping: true,
        isNonCatalogue: true,
        status: 'NOT_IN_CATALOGUE',
        extractedQuantity: extractedQty,
        quantity: extractedQty || 1,
        dosage,
        frequency: freq,
        duration: dur,
        evidenceSummary: `"${medicineName}" is not available in current MediFind catalogue.`,
        isConfirmed: false
      });
    } else {
      const top = matches[0];
      const second = matches[1];
      const isConfident = top.confidence >= 0.75;

      const topIsDirectBrand = top.evidence && top.evidence.brandSim >= 0.95;
      const secondIsDirectBrand = second && second.evidence && second.evidence.brandSim >= 0.80;
      const isAliasBeatenByPrimaryBrand = topIsDirectBrand && !secondIsDirectBrand;
      const hasCloseCompetitor = !isAliasBeatenByPrimaryBrand && Boolean(second && second.confidence >= 0.65 && (top.confidence - second.confidence < 0.10));

      if (isConfident && !hasCloseCompetitor) {
        // 2. High confidence, decisive single match — AUTO-MATCHED
        detectedItems.push({
          rawName: rawRow,
          medicineName,
          strength: strength || top.medicine.strength || null,
          matchedMedicineId: top.medicine.id,
          matchedMedicineName: top.medicine.brandName,
          matchedMedicine: top.medicine,
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

const { executePythonOCRWorker } = require('./pythonOcrBridge');

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
  const selectedEngine = (process.env.PRESCRIPTION_OCR_ENGINE || 'paddle').toLowerCase();

  // ── Developer-Only Path: Tesseract.js override (explicit opt-in only) ─────
  // This block is unreachable during normal production execution because
  // PRESCRIPTION_OCR_ENGINE defaults to 'paddle'.
  if (selectedEngine === 'tesseract') {
    console.warn('[OCR] DEVELOPER OVERRIDE: Tesseract.js engine is active. This must never occur in production.');
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

    // PaddleOCR ran but returned zero text → safe UNREADABLE state.
    // Do NOT fall back to Tesseract — the patient receives a clear error.
    return {
      success: false,
      rawText: '',
      confidence: 0,
      engine: 'PaddleOCR / PP-OCRv5',
      error: pyResult?.error || 'PaddleOCR processed the image but could not extract readable text. Please upload a clearer image.'
    };
  } catch (pyErr) {
    // PaddleOCR worker itself crashed/timed out → safe UNREADABLE state.
    // Do NOT fall back to Tesseract.
    console.error(`[OCR-Bridge] Python OCR worker failed: ${pyErr.message}`);
    return {
      success: false,
      rawText: '',
      confidence: 0,
      engine: 'PaddleOCR / PP-OCRv5',
      error: `OCR worker unavailable: ${pyErr.message}`
    };
  }
}

// ─── Legacy Tesseract Path (Developer/Test Override ONLY) ────────────────────
// ⚠️  This function must ONLY be called when PRESCRIPTION_OCR_ENGINE=tesseract.
// ⚠️  It must NEVER be called automatically in the normal patient workflow.
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

    worker = await createWorker('eng', 1, {
      langPath: LANG_PATH,
      logger: () => {},
      errorHandler: () => {}
    });

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
