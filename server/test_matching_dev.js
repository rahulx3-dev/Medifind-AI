const prisma = require('./src/prisma');

const SALT_TOKENS = /\b(?:hydrochloride|hcl|sodium|potassium|besylate|succinate|tartrate|fumarate|maleate|sulfate|sulphate|nitrate|phosphate|acetate|dipropionate|hydrate|dihydrate|trihydrate|tromethamine)\b/gi;

function normalizeGenericName(genericStr) {
  if (!genericStr) return '';
  return genericStr
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(SALT_TOKENS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// Handwritten normalizer
function normalizeHandwritten(text) {
  if (!text) return '';
  let s = text;
  // OCR Euro/pound/E for 6
  s = s.replace(/[€£E]50\b/g, '650');
  // Strip leading noise punctuation
  s = s.replace(/^[^A-Za-z0-9]+/, '');
  // Strip Rx prefix
  s = s.replace(/^\s*Rx[\s.:\-_/]+/i, '');
  // Number letter substitutions
  s = s.replace(/(\b\d+)O\b/g, '$10');
  s = s.replace(/(\b\d+)o\b/g, '$10');
  s = s.replace(/(\b\d+)S\b/g, '$15');
  s = s.replace(/(\b\d+)s\b/g, '$15');
  // Handwritten "BO", "RO", "no" as 40 when preceded by medicine name
  s = s.replace(/\s+[BR]O\b/g, ' 40');
  s = s.replace(/\s+no\b/gi, ' 40');
  // Remove trailing OCR artifacts like " .", " =", " -"
  s = s.replace(/\s*[-–—:=._]+\s*$/, '');
  return s.trim();
}

async function testMatcher() {
  const catalog = await prisma.medicine.findMany();

  // Test matching against catalog
  const queries = [
    { name: 'Dolo 650', strength: '650' },
    { name: 'Dolo', strength: '650' },
    { name: 'Pavacebawol', strength: '650' },
    { name: 'Por oprazele', strength: '40' },
    { name: 'fackoprowele', strength: '40' },
    { name: 'Cel icine', strength: null },
    { name: 'Pan 40', strength: '40' },
    { name: 'Taxim O', strength: '200' },
    { name: 'Taxim-O', strength: '200' },
    { name: 'Cefixime', strength: '200 mg' },
    { name: 'Augmentin 625', strength: '625' },
    { name: 'Community Health Centre', strength: null },
    { name: 'Dr. Drisya', strength: null },
    { name: 'Loose Stools', strength: null }
  ];

  console.log('Testing Candidate Matcher:');
  for (const q of queries) {
    const candidates = [];
    const qName = q.name.toLowerCase().trim();
    const qBase = normalizeGenericName(q.name);
    const qCollapsed = qName.replace(/[\s\-_]+/g, '');

    for (const med of catalog) {
      const brandLower = med.brandName.toLowerCase();
      const brandBase = brandLower.replace(/\s*\d+.*$/, '').trim();
      const brandCollapsed = brandLower.replace(/[\s\-_]+/g, '');
      const genLower = (med.genericName || '').toLowerCase();
      const genBase = normalizeGenericName(med.genericName);
      const genCollapsed = genLower.replace(/[\s\-_]+/g, '');

      // 1. Direct or collapsed brand similarity
      const brandSim = Math.max(
        calculateSimilarity(qName, brandLower),
        calculateSimilarity(qName, brandBase),
        calculateSimilarity(qCollapsed, brandCollapsed),
        calculateSimilarity(qName.replace(/\s*\d+.*$/, '').trim(), brandBase)
      );

      // 2. Generic similarity
      const genSim = Math.max(
        calculateSimilarity(qName, genLower),
        calculateSimilarity(qBase, genBase),
        calculateSimilarity(qCollapsed, genCollapsed)
      );

      // 3. Stem matching (e.g. -prazole, -cillin, -floxacin, -mycin)
      let stemBonus = 0;
      const stems = ['prazole', 'cillin', 'floxacin', 'mycin', 'statin', 'olol', 'sartan'];
      for (const stem of stems) {
        if (qName.includes(stem) && (genLower.includes(stem) || brandLower.includes(stem))) {
          stemBonus = 0.15;
          break;
        }
      }

      // 4. Aliases
      let aliasSim = 0;
      if (med.alternativeGenerics) {
        try {
          const aliases = JSON.parse(med.alternativeGenerics);
          for (const al of aliases) {
            aliasSim = Math.max(aliasSim, calculateSimilarity(qName, al.toLowerCase()));
          }
        } catch (_) {}
      }

      const bestSim = Math.max(brandSim, genSim * 0.90, aliasSim * 0.88) + stemBonus;
      if (bestSim < 0.58) continue;

      // Strength bonus/penalty
      let strengthDelta = 0;
      if (q.strength) {
        const qNums = (q.strength.match(/\d+/g) || []).join('');
        const medNums = (med.brandName.match(/\d+/g) || med.strength.match(/\d+/g) || []).join('');
        if (qNums && medNums && qNums === medNums) {
          strengthDelta = 0.08;
        } else if (qNums && medNums && qNums !== medNums) {
          strengthDelta = -0.15;
        }
      }

      const score = Math.min(1.0, bestSim + strengthDelta);
      if (score >= 0.60) {
        candidates.push({ medicine: med, score: Number(score.toFixed(3)) });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];
    console.log(`Query: "${q.name}" (${q.strength || 'no strength'}) -> Top: ${top ? `${top.medicine.brandName} (${top.score})` : 'NONE'} | Total candidates: ${candidates.length}`);
  }

  await prisma.$disconnect();
}

testMatcher().catch(console.error);
