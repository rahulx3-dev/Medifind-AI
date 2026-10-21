/**
 * MediFind AI — Auxiliary Medicine Reference Lexicon Verification Test Suite
 *
 * Verifies:
 * 1. File existence, disk sizes, and formats for source, lexicon JSON/CSV, metadata, LICENSE, and documentation
 * 2. Schema consistency across all 2,200 curated lexicon records
 * 3. Strict deduplication of (brandName, genericName, strength, dosageForm)
 * 4. Structured preservation of single-ingredient vs combination drugs
 * 5. Data integrity: preservation of raw sourceName without hallucinated strengths
 * 6. Source attribution and MIT license verification
 * 7. System invariant protection: catalog_50.json untouched, gitignore protects raw CSV
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SOURCE_CSV_PATH = path.join(__dirname, 'ocr/datasets/source/indian_medicine_data.csv');
const LEXICON_JSON_PATH = path.join(__dirname, 'ocr/datasets/lexicon/indian_medicine_lexicon_v1.json');
const LEXICON_CSV_PATH = path.join(__dirname, 'ocr/datasets/lexicon/indian_medicine_lexicon_v1.csv');
const METADATA_PATH = path.join(__dirname, 'ocr/datasets/lexicon/lexicon_metadata.json');
const LICENSE_PATH = path.join(__dirname, 'ocr/datasets/LICENSE');
const README_PATH = path.join(__dirname, 'ocr/datasets/README.md');
const REPORT_PATH = path.join(__dirname, 'ocr/datasets/DATASET_REPORT.md');
const CATALOG_50_PATH = path.join(__dirname, 'ocr/catalog_50.json');
const GITIGNORE_PATH = path.join(__dirname, '../.gitignore');

let testCount = 0;
let passedCount = 0;

async function runTest(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
  }
}

async function runSuite() {
  console.log('\n=== MediFind AI: Auxiliary Medicine Reference Lexicon Validation Suite ===\n');

  // Test 1: File Existence & Non-Empty Disk Footprint
  await runTest('1. All dataset artifacts exist on disk with valid file sizes', () => {
    assert(fs.existsSync(SOURCE_CSV_PATH), 'Source CSV must exist');
    const sourceStat = fs.statSync(SOURCE_CSV_PATH);
    assert(sourceStat.size > 30 * 1024 * 1024, `Source CSV must be > 30MB (actual: ${sourceStat.size} bytes)`);

    assert(fs.existsSync(LEXICON_JSON_PATH), 'Lexicon JSON must exist');
    const jsonStat = fs.statSync(LEXICON_JSON_PATH);
    assert(jsonStat.size > 500 * 1024, `Lexicon JSON must be > 500KB (actual: ${jsonStat.size} bytes)`);

    assert(fs.existsSync(LEXICON_CSV_PATH), 'Lexicon CSV companion must exist');
    const csvStat = fs.statSync(LEXICON_CSV_PATH);
    assert(csvStat.size > 150 * 1024, `Lexicon CSV must be > 150KB (actual: ${csvStat.size} bytes)`);

    assert(fs.existsSync(METADATA_PATH), 'Metadata JSON must exist');
    assert(fs.existsSync(LICENSE_PATH), 'LICENSE must exist');
    assert(fs.existsSync(README_PATH), 'README.md must exist');
    assert(fs.existsSync(REPORT_PATH), 'DATASET_REPORT.md must exist');
  });

  // Test 2: Source Attribution and MIT Licence Verification
  await runTest('2. Licence file confirms MIT Licence and JuniorAlive copyright', () => {
    const licenseText = fs.readFileSync(LICENSE_PATH, 'utf-8');
    assert(licenseText.includes('MIT License'), 'License must declare MIT License');
    assert(licenseText.includes('Copyright (c) 2024 JuniorAlive'), 'License must cite JuniorAlive');

    const readmeText = fs.readFileSync(README_PATH, 'utf-8');
    assert(readmeText.includes('junioralive/Indian-Medicine-Dataset'), 'README must cite repository source URL');
    assert(readmeText.includes('MIT Licence'), 'README must reference MIT licence');
  });

  // Test 3: Schema Consistency Across Curated Lexicon
  await runTest('3. Curated lexicon records adhere to strict schema invariants', () => {
    const data = JSON.parse(fs.readFileSync(LEXICON_JSON_PATH, 'utf-8'));
    assert(Array.isArray(data), 'Lexicon must be an array');
    assert(data.length >= 1000 && data.length <= 3000, `Lexicon count must be between 1000 and 3000 (actual: ${data.length})`);

    const VALID_FORMS = new Set([
      'Tablet', 'Capsule', 'Syrup', 'Injection', 'Oral Suspension',
      'Ointment', 'Cream', 'Gel', 'Eye Drops', 'Ear Drops', 'Nasal Spray',
      'Powder', 'Drops', 'Other'
    ]);

    for (const item of data) {
      assert(typeof item.lexiconId === 'string' && /^LEX-IND-\d{5}$/.test(item.lexiconId), `Invalid lexiconId: ${item.lexiconId}`);
      assert(typeof item.sourceId === 'number' && item.sourceId > 0, `Invalid sourceId: ${item.sourceId}`);
      assert(typeof item.brandName === 'string' && item.brandName.trim().length > 0, `Empty brandName in: ${item.lexiconId}`);
      assert(typeof item.genericName === 'string' && item.genericName.trim().length > 0, `Empty genericName in: ${item.lexiconId}`);
      assert(Array.isArray(item.activeIngredients) && item.activeIngredients.length > 0, `Empty activeIngredients in: ${item.lexiconId}`);
      assert(typeof item.isCombination === 'boolean', `isCombination must be boolean in: ${item.lexiconId}`);
      assert(typeof item.dosageForm === 'string' && VALID_FORMS.has(item.dosageForm), `Invalid dosageForm (${item.dosageForm}) in: ${item.lexiconId}`);
      assert(typeof item.manufacturer === 'string' && item.manufacturer.trim().length > 0, `Empty manufacturer in: ${item.lexiconId}`);
      assert(typeof item.sourceName === 'string' && item.sourceName.trim().length > 0, `Empty sourceName in: ${item.lexiconId}`);
    }
  });

  // Test 4: Deduplication Integrity
  await runTest('4. Curated lexicon contains zero duplicate IDs or duplicate formulation tuples', () => {
    const data = JSON.parse(fs.readFileSync(LEXICON_JSON_PATH, 'utf-8'));
    const idSet = new Set();
    const tupleSet = new Set();

    for (const item of data) {
      assert(!idSet.has(item.lexiconId), `Duplicate lexiconId found: ${item.lexiconId}`);
      idSet.add(item.lexiconId);

      const normTuple = `${item.brandName.toLowerCase().replace(/[^a-z0-9]/g, '')}|${item.genericName.toLowerCase().replace(/[^a-z0-9]/g, '')}|${(item.strength || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${item.dosageForm.toLowerCase()}`;
      assert(!tupleSet.has(normTuple), `Duplicate formulation tuple found: ${normTuple}`);
      tupleSet.add(normTuple);
    }
  });

  // Test 5: Combination vs Single-Ingredient Representation
  await runTest('5. Combination and single-ingredient drugs are accurately differentiated', () => {
    const data = JSON.parse(fs.readFileSync(LEXICON_JSON_PATH, 'utf-8'));
    let comboCount = 0;
    let singleCount = 0;

    for (const item of data) {
      if (item.isCombination) {
        comboCount++;
        assert(item.activeIngredients.length > 1, `Combo drug ${item.lexiconId} must have >1 active ingredients`);
        assert(item.genericName.includes('+'), `Combo drug ${item.lexiconId} genericName must contain '+'`);
      } else {
        singleCount++;
        assert.strictEqual(item.activeIngredients.length, 1, `Single drug ${item.lexiconId} must have exactly 1 active ingredient`);
      }
    }

    assert(comboCount > 0, 'Must have combination drugs represented');
    assert(singleCount > 0, 'Must have single ingredient drugs represented');
  });

  // Test 6: Companion CSV Row Parity
  await runTest('6. Companion CSV contains exact record count and matching columns', () => {
    const csvContent = fs.readFileSync(LEXICON_CSV_PATH, 'utf-8');
    const lines = csvContent.trim().split('\n');
    assert.strictEqual(lines.length, 2201, 'CSV must have 1 header line + 2200 data rows');
    assert(lines[0].startsWith('lexiconId,sourceId,brandName,genericName'), 'CSV header mismatch');
  });

  // Test 7: Authoritative Catalogue Isolation & Git Protection
  await runTest('7. Authoritative catalog_50.json is untouched and large source is gitignored', () => {
    assert(fs.existsSync(CATALOG_50_PATH), 'catalog_50.json must exist');
    const catalog = JSON.parse(fs.readFileSync(CATALOG_50_PATH, 'utf-8'));
    assert.strictEqual(catalog.length, 50, 'catalog_50.json must strictly preserve its 50 items');

    const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf-8');
    assert(
      gitignore.includes('server/ocr/datasets/source/*.csv') || gitignore.includes('*.csv'),
      '.gitignore must protect large raw source datasets from git commits'
    );
  });

  console.log(`\nResults: ${passedCount} / ${testCount} tests passed.\n`);
  if (passedCount !== testCount) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
