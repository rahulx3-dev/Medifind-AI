const prisma = require('../prisma');
const {
  getReferencePricing,
  roundCurrency,
  calculateUnitPrice,
  getSupportedSaleUnits,
  calculateMedicinePricing
} = require('../utils/referencePricing');

// In-memory caching for catalogue and categories
let cachedMedicines = null;
let cachedMedicinesTimestamp = 0;
const MEDICINES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes high-performance RAM cache

let cachedCategories = null;
let cachedCategoriesTimestamp = 0;
const CATEGORIES_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes high-performance RAM cache

// Common medical abbreviations and short forms
const COMMON_ABBREVIATIONS = {
  pcm: 'paracetamol',
  paracet: 'paracetamol',
  azi: 'azithromycin',
  azithro: 'azithromycin',
  pan: 'pantoprazole',
  panto: 'pantoprazole',
  amox: 'amoxicillin',
  amoxclav: 'amoxicillin',
  augmentin: 'amoxicillin',
  met: 'metformin',
  glyco: 'metformin',
  telmi: 'telmisartan',
  ator: 'atorvastatin',
  atro: 'atorvastatin',
  amlo: 'amlodipine',
  cefix: 'cefixime',
  ibu: 'ibuprofen',
  tram: 'tramadol'
};

/**
 * Levenshtein distance for safe minor spelling mistake tolerance.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Normalizes speech/voice inputs and raw text queries.
 * Strips conversational voice search prefixes, normalizes punctuation, and fixes common voice/OCR typos (e.g. Taxim 0 -> Taxim O).
 */
function normalizeQuery(raw) {
  if (!raw) return '';
  let q = String(raw).toLowerCase().trim();

  // Strip common conversational voice search prefixes
  q = q.replace(/^(search\s+for|find\s+me|find|look\s+for|show\s+me|give\s+me|please\s+give\s+me|can\s+i\s+get|i\s+need|i\s+want|order|medicine\s+for)\s+/i, '');

  // Strip trailing conversational voice suffixes if preceded by medicine keywords
  q = q.replace(/\s+(please|urgently|now|asap|near\s+me)$/i, '');

  // Normalize common OCR / speech recognition substitution: 'Taxim 0' -> 'Taxim O'
  q = q.replace(/\btaxim[\s\-_]*0\b/gi, 'taxim o');

  return q.trim();
}

/**
 * Splits string into clean alphanumeric tokens.
 */
function normalizeTokens(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Enriches medicine record with authoritative reference pricing and pack size calculations.
 */
function enrichMedicine(med) {
  const ref = getReferencePricing(med.brandName, med.genericName);
  const unitsPerPack = ref?.unitsPerPack || (
    med.dosageForm === 'Syrup' || med.dosageForm === 'Inhaler' || med.dosageForm === 'Injection' ? 1 : 10
  );
  const publishedMrp = ref?.publishedMrp != null ? roundCurrency(ref.publishedMrp) : null;
  const unitPrice = ref?.unitPrice != null
    ? roundCurrency(ref.unitPrice)
    : (publishedMrp ? calculateUnitPrice(publishedMrp, unitsPerPack) : null);
  const packSize = ref?.packSize || (unitsPerPack > 1 ? `Strip of ${unitsPerPack}` : `1 ${med.dosageForm}`);
  const pricingUnit = ref?.pricingUnit || (
    med.dosageForm === 'Tablet' ? 'per tablet' : (med.dosageForm === 'Capsule' ? 'per capsule' : 'per unit')
  );
  const supportedSaleUnits = getSupportedSaleUnits(med.dosageForm, unitsPerPack);
  const allowIndividualUnit = unitsPerPack > 1 && (
    (med.dosageForm || '').toLowerCase().includes('tablet') ||
    (med.dosageForm || '').toLowerCase().includes('capsule')
  );

  const isUnpriced = publishedMrp == null && unitPrice == null;

  return {
    ...med,
    // Clear price representation: publishedMrp is pack price, unitPrice is per tablet/capsule/unit price
    price: publishedMrp ?? unitPrice ?? med.price ?? null,
    publishedMrp,
    packPrice: publishedMrp,
    unitPrice,
    packSize,
    unitsPerPack,
    pricingUnit: isUnpriced ? 'Counter payment required' : pricingUnit,
    supportedSaleUnits,
    allowIndividualUnit,
    isVerifiedPrice: !isUnpriced,
    isUnpriced,
    isInvalidPackSize: !unitsPerPack || unitsPerPack <= 0
  };
}

/**
 * Loads all authoritative medicines from database with short TTL caching.
 */
async function getLoadedMedicines() {
  if (cachedMedicines && (Date.now() - cachedMedicinesTimestamp < MEDICINES_CACHE_TTL_MS)) {
    return cachedMedicines;
  }
  const meds = await prisma.medicine.findMany({
    orderBy: { brandName: 'asc' }
  });
  cachedMedicines = meds;
  cachedMedicinesTimestamp = Date.now();
  return meds;
}

/**
 * Scores and matches a medicine against a search query.
 */
function matchMedicineScore(med, query) {
  const normQuery = normalizeQuery(query);
  const qTokens = normalizeTokens(normQuery);
  if (qTokens.length === 0) return { matched: true, score: 0 };

  const brandTokens = normalizeTokens(med.brandName);
  const genericTokens = normalizeTokens(med.genericName);
  const brandCombined = med.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const genericCombined = med.genericName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const queryCombined = normQuery.replace(/[^a-z0-9]/g, '');

  let score = 0;
  let nonNumericMatched = 0;
  const expandedQuery = COMMON_ABBREVIATIONS[queryCombined] || queryCombined;

  // 1. Exact or whole-string matches
  if (brandCombined === queryCombined || brandCombined === expandedQuery) {
    score += 300;
    nonNumericMatched += 2;
  } else if (genericCombined === queryCombined || genericCombined === expandedQuery) {
    score += 260;
    nonNumericMatched += 2;
  } else if (brandCombined.startsWith(queryCombined) && queryCombined.length >= 3) {
    score += 220;
    nonNumericMatched += 1;
  } else if (brandCombined.includes(queryCombined) && queryCombined.length >= 3) {
    score += 180;
    nonNumericMatched += 1;
  } else if (genericCombined.includes(queryCombined) || genericCombined.includes(expandedQuery)) {
    score += 160;
    nonNumericMatched += 1;
  }


  // 2. Token-level analysis
  const nonNumericQTokens = qTokens.filter(t => !/^\d+$/.test(t));
  const numericQTokens = qTokens.filter(t => /^\d+$/.test(t));

  for (const qTok of nonNumericQTokens) {
    const expanded = COMMON_ABBREVIATIONS[qTok] || qTok;

    // Exact word in brand or generic
    if (brandTokens.includes(qTok)) {
      nonNumericMatched++;
      score += 80;
    } else if (genericTokens.includes(expanded) || genericTokens.includes(qTok)) {
      nonNumericMatched++;
      score += 70;
    } else if (qTok.length >= 3 && brandTokens.some(b => b.startsWith(qTok))) {
      nonNumericMatched++;
      score += 50;
    } else if (qTok.length >= 3 && genericTokens.some(g => g.startsWith(expanded))) {
      nonNumericMatched++;
      score += 45;
    } else if (qTok.length >= 4) {
      // Safe fuzzy matching for minor typos (Levenshtein dist <= 1 for 4-5 chars, dist <= 2 for 6+ chars)
      const maxDist = qTok.length <= 5 ? 1 : 2;
      const candidates = [...brandTokens, ...genericTokens].filter(w => w.length >= 4 && !/^\d+$/.test(w));
      for (const cand of candidates) {
        if (levenshtein(qTok, cand) <= maxDist) {
          nonNumericMatched++;
          score += 35;
          break;
        }
      }
    }
  }

  // 3. Alternative generics / aliases
  if (med.alternativeGenerics) {
    try {
      let alts = [];
      try {
        alts = JSON.parse(med.alternativeGenerics);
      } catch (_) {
        alts = med.alternativeGenerics.split(',').map(s => s.trim());
      }
      for (const alt of alts) {
        const altTokens = normalizeTokens(alt);
        const altCombined = alt.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (altCombined === queryCombined || altCombined.includes(queryCombined)) {
          score += 150;
          nonNumericMatched = Math.max(nonNumericMatched, 1);
        } else if (nonNumericQTokens.some(t => t.length >= 3 && altTokens.includes(t))) {
          score += 60;
          nonNumericMatched = Math.max(nonNumericMatched, 1);
        }
      }
    } catch (_) {}
  }

  // 4. Category & Common Uses match
  if (med.category) {
    const catLower = med.category.toLowerCase();
    if (nonNumericQTokens.some(t => t.length >= 4 && catLower.includes(t))) {
      score += 25;
      nonNumericMatched = Math.max(nonNumericMatched, 1);
    }
  }
  if (med.commonUses) {
    const usesLower = med.commonUses.toLowerCase();
    if (nonNumericQTokens.some(t => t.length >= 4 && usesLower.includes(t))) {
      score += 20;
      nonNumericMatched = Math.max(nonNumericMatched, 1);
    }
  }

  // 5. Strength check & distinction:
  // If query contains numeric tokens (like 650, 200, 500, 40):
  const medNums = [...brandTokens, ...normalizeTokens(med.strength || '')].filter(t => /^\d+$/.test(t));
  if (numericQTokens.length > 0) {
    const hasMatchingStrength = numericQTokens.some(num => medNums.includes(num));
    if (hasMatchingStrength) {
      score += 60;
    } else if (medNums.length > 0 && numericQTokens.some(num => !medNums.includes(num))) {
      // Conflicting explicit strength: penalize so different strengths don't displace requested one
      score -= 50;
    }
  }

  // 6. Dosage form distinction:
  const queryFormMatch = normQuery.match(/\b(tablet|capsule|syrup|inhaler|injection|drops)\b/i);
  if (queryFormMatch) {
    const requestedForm = queryFormMatch[0].toLowerCase();
    const medForm = (med.dosageForm || '').toLowerCase();
    if (medForm.includes(requestedForm)) {
      score += 30;
    } else {
      score -= 40;
    }
  }

  // Safety rule:
  // If query had non-numeric tokens, a medicine cannot match on a generic number alone!
  // (e.g. searching "Taxim-O 200" must not return "Oflox 200" because of "200")
  if (nonNumericQTokens.length > 0 && nonNumericMatched === 0) {
    return { matched: false, score: 0 };
  }

  // If query had ONLY numeric tokens (e.g. "650" or "200"), match by strength:
  if (nonNumericQTokens.length === 0 && numericQTokens.length > 0) {
    const hasMatchingStrength = numericQTokens.some(num => medNums.includes(num));
    return { matched: hasMatchingStrength, score: hasMatchingStrength ? 100 : 0 };
  }

  return { matched: score > 0 && nonNumericMatched > 0, score };
}

// Search medicines catalog
async function searchMedicines(req, res) {
  try {
    const {
      query,
      q,
      search,
      category,
      dosageForm,
      filterTag,
      emergencyOnly,
      sortBy
    } = req.query;

    const searchTerm = (query || q || search || '').trim();
    const allMedicines = await getLoadedMedicines();

    let filtered = allMedicines;

    // 1. Text & Voice search matching
    if (searchTerm !== '') {
      const scoredResults = [];
      for (const med of allMedicines) {
        const { matched, score } = matchMedicineScore(med, searchTerm);
        if (matched) {
          scoredResults.push({ med, score });
        }
      }
      // Sort by relevance score descending
      scoredResults.sort((a, b) => b.score - a.score);
      filtered = scoredResults.map(r => r.med);
    }

    // 2. Clinical Category Filter
    if (category && category !== 'ALL') {
      const catLower = category.toLowerCase().trim();
      const catStem = catLower.endsWith('s') ? catLower.slice(0, -1) : catLower;
      filtered = filtered.filter(m => {
        const itemCat = (m.category || '').toLowerCase();
        return itemCat.includes(catLower) || itemCat.includes(catStem);
      });
    }

    // 3. Dosage Form Filter
    if (dosageForm && dosageForm !== 'ALL') {
      const formLower = dosageForm.toLowerCase().trim();
      filtered = filtered.filter(m => (m.dosageForm || '').toLowerCase().includes(formLower));
    }

    // 4. Regulatory Status Filter (rx, otc, emergency)
    if (emergencyOnly === 'true' || filterTag === 'emergency') {
      filtered = filtered.filter(m => m.isEmergency === true);
    } else if (filterTag === 'rx') {
      filtered = filtered.filter(m =>
        m.requiresPrescription ||
        m.isEmergency ||
        (m.dosageForm && m.dosageForm.toLowerCase().includes('inhaler')) ||
        (m.category && m.category.toLowerCase().includes('antibiotic'))
      );
    } else if (filterTag === 'otc') {
      filtered = filtered.filter(m =>
        !m.requiresPrescription &&
        !m.isEmergency &&
        !(m.category && m.category.toLowerCase().includes('antibiotic'))
      );
    }

    // 5. Enrich all results with authoritative pack-size and unit-price details
    const enrichedMedicines = filtered.map(med => enrichMedicine(med));

    // 6. Sorting
    if (sortBy === 'name-asc') {
      enrichedMedicines.sort((a, b) => (a.brandName || '').localeCompare(b.brandName || ''));
    } else if (sortBy === 'name-desc') {
      enrichedMedicines.sort((a, b) => (b.brandName || '').localeCompare(a.brandName || ''));
    } else if (sortBy === 'price-asc') {
      enrichedMedicines.sort((a, b) => {
        const pA = a.publishedMrp ?? a.unitPrice ?? 999999;
        const pB = b.publishedMrp ?? b.unitPrice ?? 999999;
        return pA - pB;
      });
    } else if (sortBy === 'price-desc') {
      enrichedMedicines.sort((a, b) => {
        const pA = a.publishedMrp ?? a.unitPrice ?? 0;
        const pB = b.publishedMrp ?? b.unitPrice ?? 0;
        return pB - pA;
      });
    }

    return res.json({
      success: true,
      count: enrichedMedicines.length,
      medicines: enrichedMedicines
    });
  } catch (err) {
    console.error('searchMedicines error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search medicines.' });
  }
}

// Get single medicine details with alternative options
async function getMedicineById(req, res) {
  try {
    const { id } = req.params;

    const medicine = await prisma.medicine.findUnique({
      where: { id },
      include: {
        inventoryItems: {
          where: {
            pharmacy: {
              isVerified: true,
              verificationStatus: 'VERIFIED'
            }
          },
          include: {
            pharmacy: {
              select: {
                id: true,
                name: true,
                address: true,
                latitude: true,
                longitude: true,
                phone: true,
                isOpen: true,
                is24x7: true,
                rating: true
              }
            }
          }
        }
      }
    });

    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found.' });
    }

    // Parse alternative generics if saved as JSON
    let parsedAlternatives = [];
    if (medicine.alternativeGenerics) {
      try {
        parsedAlternatives = JSON.parse(medicine.alternativeGenerics);
      } catch (e) {
        parsedAlternatives = medicine.alternativeGenerics.split(',').map(s => s.trim());
      }
    }

    const enriched = enrichMedicine(medicine);

    return res.json({
      success: true,
      medicine: {
        ...enriched,
        alternativeGenericsList: parsedAlternatives
      }
    });
  } catch (err) {
    console.error('getMedicineById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch medicine details.' });
  }
}

// Get distinct categories
async function getCategories(req, res) {
  try {
    if (cachedCategories && (Date.now() - cachedCategoriesTimestamp < CATEGORIES_CACHE_TTL_MS)) {
      return res.json({ success: true, categories: cachedCategories });
    }

    const medicines = await prisma.medicine.findMany({
      select: { category: true }
    });

    const categories = Array.from(new Set(medicines.map(m => m.category).filter(Boolean))).sort();
    cachedCategories = categories;
    cachedCategoriesTimestamp = Date.now();

    return res.json({
      success: true,
      categories
    });
  } catch (err) {
    console.error('getCategories error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve categories.' });
  }
}

// Get emergency critical medicines
async function getEmergencyMedicines(req, res) {
  try {
    const emergencyMeds = await prisma.medicine.findMany({
      where: { isEmergency: true },
      orderBy: { brandName: 'asc' }
    });

    const enrichedEmergencyMeds = emergencyMeds.map(med => enrichMedicine(med));

    return res.json({
      success: true,
      count: enrichedEmergencyMeds.length,
      medicines: enrichedEmergencyMeds
    });
  } catch (err) {
    console.error('getEmergencyMedicines error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve emergency medicines.' });
  }
}

module.exports = {
  searchMedicines,
  getMedicineById,
  getCategories,
  getEmergencyMedicines,
  enrichMedicine,
  matchMedicineScore,
  normalizeQuery,
  levenshtein
};
