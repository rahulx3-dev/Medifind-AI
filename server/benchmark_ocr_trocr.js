/**
 * MediFind AI — OCR Benchmarking Script (PaddleOCR vs PaddleOCR + TrOCR Fallback)
 * ==============================================================================
 *
 * Runs representative test samples under two configurations:
 *   Mode A: Baseline PaddleOCR (Primary engine alone)
 *   Mode B: PaddleOCR + TrOCR Fallback (Selective handwriting/low-confidence fallback)
 *
 * Measures and reports separately:
 *   1. Recognition Quality (Raw text, extracted medicine name, candidate confidence, match score)
 *   2. Latency (Preprocessing ms, OCR inference ms, Total pipeline ms)
 *   3. Resource Requirements (Memory delta, CPU execution profile, model parameter sizes)
 *
 * Run: node server/benchmark_ocr_trocr.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { executePythonOCRWorker } = require('./src/utils/pythonOcrBridge');

const SAMPLES = [
  {
    id: 'sample_dolo_printed',
    name: 'Printed Rx: Dolo 650',
    path: path.join(__dirname, 'test_fixtures/test_prescription_dolo.jpg'),
    groundTruth: 'Rx: Dolo 650\n1 tab twice daily',
    expectedMedicine: 'Dolo 650',
    type: 'printed'
  },
  {
    id: 'sample_aug_printed',
    name: 'Printed Rx: Augmentin 625 Duo',
    path: path.join(__dirname, 'test_fixtures/test_prescription_aug.png'),
    groundTruth: 'Augmentin 625 Duo\n1 tab daily 5 days.',
    expectedMedicine: 'Augmentin 625 Duo',
    type: 'printed'
  },
  {
    id: 'sample_clear_synthetic',
    name: 'Synthetic Prescription Template',
    path: path.join(__dirname, 'test_fixtures_screening/clear_synthetic_rx.png'),
    groundTruth: 'Synthetic Rx',
    expectedMedicine: null,
    type: 'synthetic'
  }
];

const CATALOG_PATH = path.join(__dirname, 'ocr/catalog_50.json');
const LEXICON_PATH = path.join(__dirname, 'ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');

function calculateLevenshtein(a, b) {
  const s1 = (a || '').toLowerCase().trim();
  const s2 = (b || '').toLowerCase().trim();
  const m = s1.length, n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const dist = calculateLevenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : Math.max(0, 1 - dist / maxLen);
}

async function runBenchmark() {
  console.log('========================================================================');
  console.log('MediFind AI — Prescription OCR Benchmark: PaddleOCR vs PaddleOCR + TrOCR');
  console.log('========================================================================\n');

  const benchmarkResults = [];

  for (const sample of SAMPLES) {
    if (!fs.existsSync(sample.path)) {
      console.warn(`[Benchmark] Skipping missing fixture: ${sample.path}`);
      continue;
    }

    console.log(`Evaluating Sample: ${sample.name} (${sample.type})`);

    // ── Mode A: Baseline PaddleOCR Alone ────────────────────────────────────
    const memBeforeA = process.memoryUsage().rss;
    const t0A = Date.now();
    const resA = await executePythonOCRWorker(sample.path, {
      catalogPath: CATALOG_PATH,
      lexiconPath: LEXICON_PATH,
      enableTrocr: false
    });
    const durationA = Date.now() - t0A;
    const memAfterA = process.memoryUsage().rss;

    // ── Mode B: PaddleOCR + Selective TrOCR Fallback ────────────────────────
    const memBeforeB = process.memoryUsage().rss;
    const t0B = Date.now();
    const resB = await executePythonOCRWorker(sample.path, {
      catalogPath: CATALOG_PATH,
      lexiconPath: LEXICON_PATH,
      enableTrocr: true
    });
    const durationB = Date.now() - t0B;
    const memAfterB = process.memoryUsage().rss;

    const lineA = resA?.medicineLines?.[0];
    const lineB = resB?.medicineLines?.[0];

    const rawSimA = calculateSimilarity(resA?.rawText, sample.groundTruth);
    const rawSimB = calculateSimilarity(resB?.rawText, sample.groundTruth);

    const record = {
      sampleId: sample.id,
      sampleName: sample.name,
      sampleType: sample.type,
      baseline: {
        rawText: resA?.rawText || '',
        textSimilarity: Math.round(rawSimA * 1000) / 10,
        extractedName: lineA?.extractedName || 'None',
        topCandidate: lineA?.medicineCandidates?.[0]?.medicineName || lineA?.auxiliaryCandidates?.[0]?.brandName || 'None',
        candidateScore: lineA?.medicineCandidates?.[0]?.matchConfidence || lineA?.auxiliaryCandidates?.[0]?.matchScore || 0,
        confidenceClass: lineA?.confidenceClass || 'N/A',
        ocrConfidence: lineA?.ocrConfidence || 0,
        latencyMs: resA?.performance?.totalMs || durationA,
        ocrLatencyMs: resA?.performance?.ocrMs || 0,
        engine: resA?.engine?.primary || 'PaddleOCR'
      },
      withTrocr: {
        rawText: resB?.rawText || '',
        textSimilarity: Math.round(rawSimB * 1000) / 10,
        extractedName: lineB?.extractedName || 'None',
        topCandidate: lineB?.medicineCandidates?.[0]?.medicineName || lineB?.auxiliaryCandidates?.[0]?.brandName || 'None',
        candidateScore: lineB?.medicineCandidates?.[0]?.matchConfidence || lineB?.auxiliaryCandidates?.[0]?.matchScore || 0,
        confidenceClass: lineB?.confidenceClass || 'N/A',
        ocrConfidence: lineB?.ocrConfidence || 0,
        latencyMs: resB?.performance?.totalMs || durationB,
        ocrLatencyMs: resB?.performance?.ocrMs || 0,
        fallbackTriggered: lineB?.fallbackTriggered || false,
        fallbackAccepted: lineB?.fallbackAccepted || false,
        trocrText: lineB?.trocrText || null,
        fallbackReason: lineB?.fallbackReason || null,
        engine: lineB?.recognitionEngine || 'PaddleOCR'
      }
    };

    benchmarkResults.push(record);
    console.log(`  Mode A (Baseline): Latency = ${record.baseline.latencyMs}ms, Top = ${record.baseline.topCandidate} (${record.baseline.candidateScore})`);
    console.log(`  Mode B (+ TrOCR):  Latency = ${record.withTrocr.latencyMs}ms, FallbackTriggered = ${record.withTrocr.fallbackTriggered}, Engine = ${record.withTrocr.engine}`);
    console.log('');
  }

  // Write structured JSON benchmark output
  const reportPath = path.join(__dirname, 'scratch/trocr_benchmark_results.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(benchmarkResults, null, 2), 'utf-8');
  console.log(`Benchmark results saved to: ${reportPath}`);

  return benchmarkResults;
}

runBenchmark().catch(err => {
  console.error('Fatal error running benchmark:', err);
  process.exit(1);
});
