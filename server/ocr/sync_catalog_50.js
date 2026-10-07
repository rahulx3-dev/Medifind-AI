#!/usr/bin/env node
/**
 * MediFind AI — Authoritative Catalogue Synchronization Script (Phase 6.1E.2)
 * =============================================================================
 *
 * PURPOSE:
 *   Regenerates server/ocr/catalog_50.json from server/prisma/seedData.js,
 *   which is the SINGLE SOURCE OF TRUTH for the 50-medicine MediFind catalogue.
 *
 *   This script MUST be re-run whenever seedData.js changes.
 *   It guarantees that the Python OCR worker always uses exactly the same
 *   medicine identities as the application database.
 *
 * ARCHITECTURE DECISION:
 *   - Source of Truth:   server/prisma/seedData.js  (medicinesData array)
 *   - Generated Output:  server/ocr/catalog_50.json (runtime OCR snapshot)
 *   - catalog_50.json is a GENERATED FILE. It must NOT be edited manually.
 *     Any manual edit will be overwritten by the next run of this script.
 *
 * USAGE:
 *   node server/ocr/sync_catalog_50.js
 *   node server/ocr/sync_catalog_50.js --check   # Check only, no write
 *
 * EXIT CODES:
 *   0 — Sync succeeded (or check passed)
 *   1 — Sync failed or catalogue divergence detected
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Source of Truth ─────────────────────────────────────────────────────────
const SEED_DATA_PATH = path.join(__dirname, '../prisma/seedData.js');
const OUTPUT_PATH    = path.join(__dirname, 'catalog_50.json');
const EXPECTED_COUNT = 50;

// ── Arguments ────────────────────────────────────────────────────────────────
const isCheckOnly = process.argv.includes('--check');

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg)  { process.stdout.write(`[sync_catalog_50] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[sync_catalog_50] WARN: ${msg}\n`); }
function fail(msg) { process.stderr.write(`[sync_catalog_50] ERROR: ${msg}\n`); process.exit(1); }

// ── Load seedData ────────────────────────────────────────────────────────────
let medicinesData;
try {
  ({ medicinesData } = require(SEED_DATA_PATH));
} catch (err) {
  fail(`Cannot load seedData.js: ${err.message}`);
}

if (!Array.isArray(medicinesData) || medicinesData.length === 0) {
  fail('seedData.js medicinesData is empty or not an array.');
}

// ── Validate count ───────────────────────────────────────────────────────────
if (medicinesData.length !== EXPECTED_COUNT) {
  warn(`Unexpected medicine count: expected ${EXPECTED_COUNT}, found ${medicinesData.length}. Proceeding with actual count.`);
}

// ── Build catalogue snapshot ─────────────────────────────────────────────────
// Projects only the fields consumed by ocr_worker.py for matching.
// Does NOT include sensitive or order-flow fields.
const catalogSnapshot = medicinesData.map((med, idx) => ({
  // Use 1-indexed position as stable catalogue ID (consistent with DB seeding order)
  id: `cat-${String(idx + 1).padStart(3, '0')}`,
  brandName:          med.brandName,
  genericName:        med.genericName,
  dosageForm:         med.dosageForm        || null,
  strength:           med.strength          || null,
  category:           med.category          || null,
  alternativeGenerics: med.alternativeGenerics
    ? (typeof med.alternativeGenerics === 'string'
        ? med.alternativeGenerics           // already JSON string from seedData
        : JSON.stringify(med.alternativeGenerics))
    : null,
  // Explicit _syncMeta for human auditability
  _syncMeta: {
    sourceFile:   'server/prisma/seedData.js',
    syncedAt:     new Date().toISOString(),
    seedDataIndex: idx
  }
}));

// ── Divergence check against existing catalog_50.json ───────────────────────
if (fs.existsSync(OUTPUT_PATH)) {
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
  } catch (err) {
    warn(`Existing catalog_50.json is not valid JSON: ${err.message}`);
    existing = null;
  }

  if (existing) {
    // Count check
    if (existing.length !== catalogSnapshot.length) {
      const msg = `CATALOGUE DIVERGENCE DETECTED: existing catalog_50.json has ${existing.length} entries, seedData.js has ${catalogSnapshot.length}.`;
      if (isCheckOnly) {
        fail(msg);
      } else {
        warn(msg + ' — Overwriting with authoritative seedData version.');
      }
    }

    // Identity check: verify brand names match by position
    let divergenceCount = 0;
    const minLen = Math.min(existing.length, catalogSnapshot.length);
    for (let i = 0; i < minLen; i++) {
      const existingBrand  = (existing[i].brandName  || '').trim();
      const expectedBrand  = (catalogSnapshot[i].brandName || '').trim();
      const existingGeneric = (existing[i].genericName || '').trim();
      const expectedGeneric = (catalogSnapshot[i].genericName || '').trim();

      if (existingBrand !== expectedBrand || existingGeneric !== expectedGeneric) {
        warn(`Divergence at index ${i}: catalog has "${existingBrand} / ${existingGeneric}", seedData has "${expectedBrand} / ${expectedGeneric}".`);
        divergenceCount++;
      }
    }

    if (divergenceCount === 0 && existing.length === catalogSnapshot.length) {
      if (isCheckOnly) {
        log(`✅ Check passed: catalog_50.json is in sync with seedData.js (${catalogSnapshot.length} medicines).`);
        process.exit(0);
      } else {
        log(`✅ No divergence detected (${catalogSnapshot.length} medicines). Refreshing _syncMeta timestamps.`);
      }
    } else {
      const msg = `${divergenceCount} medicine identity/name divergence(s) found.`;
      if (isCheckOnly) {
        fail(`❌ ${msg} — Run without --check to resync.`);
      } else {
        warn(msg + ' — Overwriting with authoritative seedData version.');
      }
    }
  }
}

// ── Write Output ─────────────────────────────────────────────────────────────
if (isCheckOnly) {
  // In check mode, catalog_50.json did not exist; seed data is valid
  log(`✅ catalog_50.json not found but seedData.js is valid with ${catalogSnapshot.length} medicines.`);
  process.exit(0);
}

try {
  const json = JSON.stringify(catalogSnapshot, null, 2);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf-8');
  log(`✅ catalog_50.json successfully regenerated from seedData.js.`);
  log(`   Medicines: ${catalogSnapshot.length}`);
  log(`   Output:    ${OUTPUT_PATH}`);
} catch (err) {
  fail(`Failed to write catalog_50.json: ${err.message}`);
}

// ── Final Summary ─────────────────────────────────────────────────────────────
log('');
log('IMPORTANT: catalog_50.json is a GENERATED FILE.');
log('Do NOT edit it manually. Re-run this script after any seedData.js change.');
log('');
