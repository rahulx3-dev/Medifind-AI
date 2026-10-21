/**
 * MediFind AI — Issue 1, Task 2: Offline Database Safety-Guard Verification Suite
 *
 * Strictly Offline Test Suite.
 * Validates that all 11 hardened scripts and the testDatabaseGuard utility
 * refuse execution when:
 *  1. TEST_DATABASE_URL is missing (fails closed)
 *  2. Target host matches production endpoint (ep-weathered-mouse-a751mmhd)
 *  3. Target host matches staging endpoint (ep-damp-hat-az9wh7zr)
 *  4. Target host matches .env / .env.staging disk files
 *  5. Destructive scripts lack explicit caller authorization
 *
 * CRITICAL SAFETY RULES:
 * - NO real database connections are made.
 * - All script execution tests run in isolated sub-processes with controlled env.
 * - No network I/O or Prisma operations occur.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');
const {
  assertSafeTestDatabase,
  createSafeTestPrismaClient,
  maskHost,
  KNOWN_PROTECTED_HOST_PATTERNS
} = require('./src/utils/testDatabaseGuard');

const SERVER_DIR = path.resolve(__dirname);

let passedTests = 0;
let failedTests = 0;

function check(title, condition, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${title}${details ? ' (' + details + ')' : ''}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${title}${details ? ' (' + details + ')' : ''}`);
    failedTests++;
  }
}

console.log('====================================================================');
console.log('🛡️  MEDIFIND AI — OFFLINE DATABASE SAFETY-GUARD TEST SUITE');
console.log('====================================================================\n');

// -------------------------------------------------------------------
// 1. UNIT TESTS: testDatabaseGuard Core Logic
// -------------------------------------------------------------------
console.log('--- 1. Testing testDatabaseGuard Core Logic (Offline Unit Tests) ---');

// 1.1 Fails closed when TEST_DATABASE_URL is missing
{
  const res = assertSafeTestDatabase(undefined, { testLocalEnvPath: '/nonexistent/.env.test.local' });
  check('Missing TEST_DATABASE_URL fails closed', !res.isSafe && res.error.includes('[FAIL CLOSED] TEST_DATABASE_URL is not set'));
}

// 1.2 Rejects production Neon host
{
  const prodUrl = 'postgresql://medifind:secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/neondb?sslmode=require';
  const res = assertSafeTestDatabase(prodUrl);
  check('Production Neon host rejected', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION] Target host'));
}

// 1.3 Rejects staging Neon host
{
  const stagingUrl = 'postgresql://medifind:secret@ep-damp-hat-az9wh7zr.aws.neon.tech/neondb?sslmode=require';
  const res = assertSafeTestDatabase(stagingUrl);
  check('Staging Neon host rejected', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION] Target host'));
}

// 1.4 Rejects production host even with deceptive database name like /test_disposable
{
  const deceptiveUrl = 'postgresql://medifind:secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/test_disposable';
  const res = assertSafeTestDatabase(deceptiveUrl);
  check('Deceptive db name on production host rejected', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION]'));
}

// 1.5 Rejects placeholder credentials
{
  const placeholderUrl = 'postgresql://user:password@localhost:5432/medifind_test';
  const res = assertSafeTestDatabase(placeholderUrl);
  check('Placeholder credentials (user:password) rejected', !res.isSafe && res.error.includes('placeholder credentials'));
}

// 1.6 Rejects non-postgresql protocol
{
  const mysqlUrl = 'mysql://root:secret@localhost:3306/medifind_test';
  const res = assertSafeTestDatabase(mysqlUrl);
  check('Non-postgresql protocol rejected', !res.isSafe && res.error.includes('must use postgresql: protocol'));
}

// 1.7 Rejects unverified remote host without expected keyword
{
  const unknownRemoteUrl = 'postgresql://user:secret@ep-unknown-shadow-12345.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(unknownRemoteUrl);
  check('Unknown remote host rejected without keyword', !res.isSafe && (res.error.includes('requires an explicit, strictly validated') || res.error.includes('Unknown or ambiguous database identity')));
}

// 1.8 Accepts valid local loopback host
{
  const localUrl = 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test';
  const res = assertSafeTestDatabase(localUrl);
  check('Valid local loopback accepted', res.isSafe && res.identityType === 'LOCAL_LOOPBACK');
}

// 1.9 Accepts verified remote host with exact hostname match and disclaimer
{
  const verifiedRemote = 'postgresql://user:secret@ep-my-test-ephemeral.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(verifiedRemote, { expectedHostKeyword: 'ep-my-test-ephemeral' });
  check('Verified remote host accepted with exact match', res.isSafe && res.identityType === 'EXACT_REMOTE_HOST_MATCH' && res.disclaimer.includes('does not prove'));
}

// 1.10 Rejects broad keyword 'neon.tech' for remote host
{
  const remoteUrl = 'postgresql://user:secret@ep-some-remote.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'neon.tech' });
  check('Broad keyword "neon.tech" rejected for remote host', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION]'));
}

// 1.11 Rejects broad keyword 'aws' for remote host
{
  const remoteUrl = 'postgresql://user:secret@ep-some-remote.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'aws' });
  check('Broad keyword "aws" rejected for remote host', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION]'));
}

// 1.12 Rejects loopback keyword 'localhost' for remote host
{
  const remoteUrl = 'postgresql://user:secret@ep-some-remote.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'localhost' });
  check('Loopback keyword "localhost" rejected for remote host', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION]'));
}

// 1.13 Rejects short keyword (<5 chars) for remote host
{
  const remoteUrl = 'postgresql://user:secret@ep-some-remote.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'test' });
  check('Short/generic keyword "test" rejected for remote host', !res.isSafe && res.error.includes('[CRITICAL SAFETY VIOLATION]'));
}

// 1.14 Rejects malformed placeholder 'replace_locally'
{
  const remoteUrl = 'postgresql://user:secret@ep-some-remote.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'replace_locally' });
  check('Placeholder "replace_locally" rejected for remote host', !res.isSafe && res.error.includes('requires an explicit, strictly validated'));
}

// 1.15 Rejects remote hostname mismatch against expected identity
{
  const remoteUrl = 'postgresql://user:secret@ep-actual-branch-12345.aws.neon.tech/neondb';
  const res = assertSafeTestDatabase(remoteUrl, { expectedHostKeyword: 'ep-different-branch-99999' });
  check('Remote hostname mismatch rejected', !res.isSafe && res.error.includes('does not exactly match'));
}

// 1.16 Rejects local loopback when mismatched expected keyword is supplied
{
  const localUrl = 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test';
  const res = assertSafeTestDatabase(localUrl, { expectedHostKeyword: 'host.docker.internal' });
  check('Local loopback with mismatched expected keyword rejected', !res.isSafe && res.error.includes('does not match explicit EXPECTED_TEST_HOST_KEYWORD'));
}

// 1.17 createSafeTestPrismaClient throws UNSAFE_TEST_DATABASE on unsafe url
{
  let caught = false;
  try {
    createSafeTestPrismaClient({ customUrl: 'postgresql://medifind:secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/neondb' });
  } catch (err) {
    caught = err.code === 'UNSAFE_TEST_DATABASE';
  }
  check('createSafeTestPrismaClient throws UNSAFE_TEST_DATABASE error', caught);
}

// -------------------------------------------------------------------
// 2. INTEGRATION TESTS: Refusal Behavior Across 11 Hardened Scripts
// -------------------------------------------------------------------
console.log('\n--- 2. Testing Execution Refusal Across 11 Hardened Scripts ---');

const SCRIPTS_TO_TEST = [
  { file: 'test_neon_services.js', isScriptDir: false },
  { file: 'test_pricing_and_razorpay.js', isScriptDir: false },
  { file: 'test_user_3_images.js', isScriptDir: false },
  { file: 'test_phase6_1e3_ocr_runtime.js', isScriptDir: false },
  { file: 'test_phase6_1k_data_cleanup.js', isScriptDir: false },
  { file: 'test_phase6_1L8_emergency_restock.js', isScriptDir: false },
  { file: 'test_phase6_1L9_offline_sms.js', isScriptDir: false },
  { file: 'test_phase6_1L10_pricing_consistency.js', isScriptDir: false },
  { file: 'test_phase6_1L12_cross_role_integration.js', isScriptDir: false },
  { file: 'scripts/clean_test_pharmacies.js', isScriptDir: true, isDestructive: true, authEnv: 'ALLOW_TEST_DATA_CLEANUP' },
  { file: 'scripts/syncReferencePrices.js', isScriptDir: true, isDestructive: true, authEnv: 'ALLOW_TEST_PRICE_SYNC' },
  { file: 'scripts/delete_alappuzha_test_pharmacy.js', isScriptDir: true, isDestructive: true, authEnv: 'ALLOW_TEST_DATA_CLEANUP' },
  { file: 'final_publish_cleanup.js', isScriptDir: false, isDestructive: true, authEnv: 'ALLOW_FINAL_PUBLISH_CLEANUP' },
  { file: 'find_patients.js', isScriptDir: false, isDestructive: false },
  { file: 'prisma/seed.js', isScriptDir: false, isDestructive: true, authEnv: 'ALLOW_DATABASE_SEED' },
  { file: 'prisma/import_real_pharmacies.js', isScriptDir: false, isDestructive: true, authEnv: 'ALLOW_REAL_PHARMACY_IMPORT' }
];

function runScriptOffline(relPath, customEnv = {}) {
  const fullPath = path.resolve(SERVER_DIR, relPath);
  // Strictly clean environment: wipe test database variables and isolate
  const cleanEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    NODE_PATH: process.env.NODE_PATH,
    ...customEnv
  };

  const proc = spawnSync('node', [fullPath], {
    cwd: SERVER_DIR,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 5000
  });

  return {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    combined: (proc.stdout || '') + (proc.stderr || '')
  };
}

for (const item of SCRIPTS_TO_TEST) {
  const scriptName = item.file;

  // Test Case A: Missing TEST_DATABASE_URL fails closed
  {
    const env = {};
    if (item.isDestructive) {
      env[item.authEnv] = 'true'; // Provide caller authorization to test guard refusal
    }
    const result = runScriptOffline(scriptName, env);
    const refused = result.status !== 0 && (
      result.combined.includes('[FAIL CLOSED]') ||
      result.combined.includes('UNSAFE_TEST_DATABASE') ||
      result.combined.includes('TEST_DATABASE_URL is not set') ||
      result.combined.includes('Resolved test database URL is empty')
    );
    check(`[${scriptName}] Refuses execution when TEST_DATABASE_URL is missing`, refused, `exit=${result.status}`);
  }

  // Test Case B: Production target rejected
  {
    const env = {
      TEST_DATABASE_URL: 'postgresql://medifind:secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/neondb?sslmode=require'
    };
    if (item.isDestructive) {
      env[item.authEnv] = 'true';
    }
    const result = runScriptOffline(scriptName, env);
    const refused = result.status !== 0 && (
      result.combined.includes('[CRITICAL SAFETY VIOLATION]') ||
      result.combined.includes('matches protected pattern') ||
      result.combined.includes('Refusing to execute tests against protected environment')
    );
    check(`[${scriptName}] Refuses execution against Production Neon target`, refused, `exit=${result.status}`);
  }

  // Test Case C: Staging target rejected
  {
    const env = {
      TEST_DATABASE_URL: 'postgresql://medifind:secret@ep-damp-hat-az9wh7zr.aws.neon.tech/neondb?sslmode=require'
    };
    if (item.isDestructive) {
      env[item.authEnv] = 'true';
    }
    const result = runScriptOffline(scriptName, env);
    const refused = result.status !== 0 && (
      result.combined.includes('[CRITICAL SAFETY VIOLATION]') ||
      result.combined.includes('matches protected pattern') ||
      result.combined.includes('Refusing to execute tests against protected environment')
    );
    check(`[${scriptName}] Refuses execution against Staging Neon target`, refused, `exit=${result.status}`);
  }

  // Test Case D: Unverified remote Neon branch target rejected
  {
    const env = {
      TEST_DATABASE_URL: 'postgresql://medifind:secret@ep-unknown-remote-branch-99999.aws.neon.tech/neondb?sslmode=require'
    };
    if (item.isDestructive) {
      env[item.authEnv] = 'true';
    }
    const result = runScriptOffline(scriptName, env);
    const refused = result.status !== 0 && (
      result.combined.includes('Unknown or ambiguous database identity') ||
      result.combined.includes('UNSAFE_TEST_DATABASE') ||
      result.combined.includes('[FAIL CLOSED]')
    );
    check(`[${scriptName}] Refuses execution against Unverified remote Neon target`, refused, `exit=${result.status}`);
  }
}

// -------------------------------------------------------------------
// 3. DESTRUCTIVE SCRIPTS: Caller Authorization Gate Tests
// -------------------------------------------------------------------
console.log('\n--- 3. Testing Caller Authorization Gates on Destructive Scripts ---');

// 3.1 clean_test_pharmacies without ALLOW_TEST_DATA_CLEANUP
{
  const result = runScriptOffline('scripts/clean_test_pharmacies.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_TEST_DATA_CLEANUP=true')
  );
  check('clean_test_pharmacies refuses execution without ALLOW_TEST_DATA_CLEANUP=true', refused, `exit=${result.status}`);
}

// 3.2 syncReferencePrices without ALLOW_TEST_PRICE_SYNC
{
  const result = runScriptOffline('scripts/syncReferencePrices.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_TEST_PRICE_SYNC=true')
  );
  check('syncReferencePrices refuses execution without ALLOW_TEST_PRICE_SYNC=true', refused, `exit=${result.status}`);
}

// 3.3 delete_alappuzha_test_pharmacy without ALLOW_TEST_DATA_CLEANUP
{
  const result = runScriptOffline('scripts/delete_alappuzha_test_pharmacy.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_TEST_DATA_CLEANUP=true')
  );
  check('delete_alappuzha_test_pharmacy refuses execution without ALLOW_TEST_DATA_CLEANUP=true', refused, `exit=${result.status}`);
}

// 3.4 final_publish_cleanup without ALLOW_FINAL_PUBLISH_CLEANUP
{
  const result = runScriptOffline('final_publish_cleanup.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_FINAL_PUBLISH_CLEANUP=true')
  );
  check('final_publish_cleanup refuses execution without ALLOW_FINAL_PUBLISH_CLEANUP=true', refused, `exit=${result.status}`);
}

// 3.5 prisma/seed.js without ALLOW_DATABASE_SEED
{
  const result = runScriptOffline('prisma/seed.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_DATABASE_SEED=true')
  );
  check('prisma/seed.js refuses execution without ALLOW_DATABASE_SEED=true', refused, `exit=${result.status}`);
}

// 3.6 prisma/import_real_pharmacies.js without ALLOW_REAL_PHARMACY_IMPORT
{
  const result = runScriptOffline('prisma/import_real_pharmacies.js', {
    TEST_DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/medifind_disposable_test'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('ALLOW_REAL_PHARMACY_IMPORT=true')
  );
  check('prisma/import_real_pharmacies.js refuses execution without ALLOW_REAL_PHARMACY_IMPORT=true', refused, `exit=${result.status}`);
}

// 3.7 prisma/import_real_pharmacies.js with TARGET_ENV=production without CONFIRM_PRODUCTION_IMPORT
{
  const result = runScriptOffline('prisma/import_real_pharmacies.js', {
    ALLOW_REAL_PHARMACY_IMPORT: 'true',
    TARGET_ENV: 'production'
  });
  const refused = result.status !== 0 && (
    result.combined.includes('[CRITICAL REFUSAL]') &&
    result.combined.includes('CONFIRM_PRODUCTION_IMPORT=true')
  );
  check('prisma/import_real_pharmacies.js refuses production import without CONFIRM_PRODUCTION_IMPORT=true', refused, `exit=${result.status}`);
}

// -------------------------------------------------------------------
// Final Summary
// -------------------------------------------------------------------
console.log('\n====================================================================');
console.log(`Summary: ${passedTests} passed, ${failedTests} failed`);
console.log('====================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🛡️  All offline safety-guard bypass tests PASSED successfully.');
  process.exit(0);
}
