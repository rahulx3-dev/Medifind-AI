/**
 * MediFind AI — Dummy Test Suite for Staging Target Guardrail
 *
 * Runs 5 synthetic negative test cases entirely offline with temporary dummy configs:
 * 1. Missing endpoint identifier (EXPECTED_STAGING_HOST_KEYWORD omitted)
 * 2. Placeholder credentials in URL (user:password / REPLACE_LOCALLY)
 * 3. Malformed URL format
 * 4. Mismatched pooled/direct hosts (e.g. ep-one-pooler vs ep-two)
 * 5. Production-host collision (staging points to production endpoint)
 *
 * All tests run without connecting to any database.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { verifyStagingTarget } = require('../scripts/verify_staging_target');

const TEMP_DIR = path.resolve(__dirname, '..', 'scratch');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function runTestCase(name, stagingContent, prodContent, expectedErrorMessageSubstring) {
  const stagingFile = path.join(TEMP_DIR, `dummy_staging_${Date.now()}_${Math.random().toString(36).substring(7)}.env`);
  const prodFile = path.join(TEMP_DIR, `dummy_prod_${Date.now()}_${Math.random().toString(36).substring(7)}.env`);

  try {
    fs.writeFileSync(stagingFile, stagingContent, 'utf8');
    fs.writeFileSync(prodFile, prodContent, 'utf8');

    const result = verifyStagingTarget({
      stagingEnvPath: stagingFile,
      prodEnvPath: prodFile,
      silent: true
    });

    if (result.success) {
      console.error(`FAIL: Test "${name}" was expected to fail, but succeeded.`);
      return false;
    }

    const matchesExpected = result.error && result.error.toLowerCase().includes(expectedErrorMessageSubstring.toLowerCase());
    if (!matchesExpected) {
      console.error(`FAIL: Test "${name}" failed with unexpected message: "${result.error}" (expected substring: "${expectedErrorMessageSubstring}")`);
      return false;
    }

    console.log(`✓ PASS: "${name}" correctly failed closed with: "${result.error}"`);
    return true;
  } finally {
    if (fs.existsSync(stagingFile)) fs.unlinkSync(stagingFile);
    if (fs.existsSync(prodFile)) fs.unlinkSync(prodFile);
  }
}

console.log('─── Starting Staging Guardrail Dummy Test Suite ───');
let allPassed = true;

// Test 1: Missing endpoint identifier
allPassed = runTestCase(
  'Test 1: Missing endpoint identifier',
  `STAGING_DATABASE_URL="postgresql://user:pass@ep-valid-az1-pooler.aws.neon.tech/neondb"
STAGING_DATABASE_URL_UNPOOLED="postgresql://user:pass@ep-valid-az1.aws.neon.tech/neondb"`,
  `DATABASE_URL="postgresql://prod:pass@ep-prod-az1.aws.neon.tech/neondb"`,
  'Missing or unconfigured EXPECTED_STAGING_HOST_KEYWORD'
) && allPassed;

// Test 2: Placeholder credentials in URL
allPassed = runTestCase(
  'Test 2: Placeholder credentials in URL',
  `STAGING_DATABASE_URL="postgresql://user:password@ep-valid-az1-pooler.aws.neon.tech/neondb"
STAGING_DATABASE_URL_UNPOOLED="postgresql://user:password@ep-valid-az1.aws.neon.tech/neondb"
EXPECTED_STAGING_HOST_KEYWORD="ep-valid-az1"`,
  `DATABASE_URL="postgresql://prod:pass@ep-prod-az1.aws.neon.tech/neondb"`,
  'contains placeholder values'
) && allPassed;

// Test 3: Malformed URL format
allPassed = runTestCase(
  'Test 3: Malformed URL format',
  `STAGING_DATABASE_URL="not-a-valid-url"
STAGING_DATABASE_URL_UNPOOLED="not-a-valid-url"
EXPECTED_STAGING_HOST_KEYWORD="ep-valid-az1"`,
  `DATABASE_URL="postgresql://prod:pass@ep-prod-az1.aws.neon.tech/neondb"`,
  'not a valid URL format'
) && allPassed;

// Test 4: Mismatched pooled/direct hosts
allPassed = runTestCase(
  'Test 4: Mismatched pooled/direct hosts',
  `STAGING_DATABASE_URL="postgresql://validuser:validpass@ep-branch-one-pooler.aws.neon.tech/neondb"
STAGING_DATABASE_URL_UNPOOLED="postgresql://validuser:validpass@ep-branch-two.aws.neon.tech/neondb"
EXPECTED_STAGING_HOST_KEYWORD="ep-branch"`,
  `DATABASE_URL="postgresql://prod:pass@ep-prod-az1.aws.neon.tech/neondb"`,
  'does not match direct endpoint base'
) && allPassed;

// Test 5: Production-host collision
allPassed = runTestCase(
  'Test 5: Production-host collision',
  `STAGING_DATABASE_URL="postgresql://validuser:validpass@ep-prod-endpoint-pooler.aws.neon.tech/neondb"
STAGING_DATABASE_URL_UNPOOLED="postgresql://validuser:validpass@ep-prod-endpoint.aws.neon.tech/neondb"
EXPECTED_STAGING_HOST_KEYWORD="ep-prod-endpoint"`,
  `DATABASE_URL="postgresql://realproduser:realprodpass@ep-prod-endpoint.aws.neon.tech/neondb"`,
  'CRITICAL COLLISION: Staging host matches production database host'
) && allPassed;

console.log('─── Test Suite Complete ───');
if (allPassed) {
  console.log('ALL 5 DUMMY TESTS PASSED: Fail-closed guardrails verified successfully.');
} else {
  console.error('FAIL: One or more dummy test cases failed.');
  process.exit(1);
}
