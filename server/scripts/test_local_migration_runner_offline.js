/**
 * MediFind AI — Offline Tests for Guarded Local Test Migration Runner
 *
 * SAFETY RULES:
 * - Strictly offline test suite.
 * - Does NOT start Prisma CLI, open database connections, or access Neon.
 * - Validates fail-closed behavior across edge cases and negative controls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  validateLocalTestTarget,
  buildIsolatedPrismaEnv,
  buildPrismaArgs,
  sanitizeErrorMessage,
  AUTHORIZED_LOOPBACK_HOSTS,
  REQUIRED_TEST_DB_NAME
} = require('./deploy_local_test_migrations');

let passedTests = 0;
let failedTests = 0;

function check(title, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${title}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${title} — ${err.message}`);
    failedTests++;
  }
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log('🛡️  MEDIFIND AI — OFFLINE LOCAL MIGRATION RUNNER TESTS');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Missing configuration tests
console.log('--- 1. Missing Configuration & Environment Flags ---');

check('Rejects missing .env.test.local when file does not exist', () => {
  assert.throws(
    () => validateLocalTestTarget({ envPath: '/nonexistent/path/.env.test.local' }),
    /\[FAIL CLOSED\] Test environment configuration file not found/
  );
});

check('Rejects missing TEST_DATABASE_URL in raw config', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'EXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /TEST_DATABASE_URL is not set/
  );
});

check('Rejects missing IS_DISPOSABLE_TEST_DATABASE=true', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="localhost"',
      envPath: '/fake/.env.test.local'
    }),
    /IS_DISPOSABLE_TEST_DATABASE must be explicitly set to "true"/
  );
});

check('Rejects IS_DISPOSABLE_TEST_DATABASE=false', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=false',
      envPath: '/fake/.env.test.local'
    }),
    /IS_DISPOSABLE_TEST_DATABASE must be explicitly set to "true"/
  );
});

// 2. Target Host & Anti-Collision Tests
console.log('\n--- 2. Host Identity & Anti-Collision ---');

check('Rejects production Neon endpoint pattern', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://medifind:secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="ep-weathered-mouse-a751mmhd"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /matches protected pattern/
  );
});

check('Rejects staging Neon endpoint pattern', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://medifind:secret@ep-damp-hat-az9wh7zr.aws.neon.tech/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="ep-damp-hat-az9wh7zr"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /matches protected pattern/
  );
});

check('Rejects remote non-loopback host even with matched expected keyword', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://medifind:secret@ep-isolated-test-branch-99999.aws.neon.tech/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="ep-isolated-test-branch-99999"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /is not an authorized local loopback host/
  );
});

check('Rejects host.docker.internal container alias strictly', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="host.docker.internal"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /is not an authorized local loopback host\. Only "localhost" and "127\.0\.0\.1" are permitted/
  );
});

check('Rejects IPv6 loopback ::1 strictly (only localhost and 127.0.0.1 allowed)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@[::1]:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="::1"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /CRITICAL SAFETY VIOLATION/
  );
});

check('Rejects arbitrary non-loopback host (e.g. test-db.internal)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@test-db.internal:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="test-db.internal"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /is not an authorized local loopback host/
  );
});

check('Rejects placeholder credentials (user:password)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://user:password@localhost:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /placeholder credentials/
  );
});

// 3. Database Name Verification Tests
console.log('\n--- 3. Database Name Enforcement ---');

check('Rejects wrong database name (neondb)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/neondb"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /Invalid database name "neondb"\. Local test migration runner strictly requires database name to be exactly "medifind_disposable_test"/
  );
});

check('Rejects wrong database name (production/staging name)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/medifind_prod"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /Invalid database name "medifind_prod"/
  );
});

check('Rejects root database (empty db name)', () => {
  assert.throws(
    () => validateLocalTestTarget({
      rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
      envPath: '/fake/.env.test.local'
    }),
    /Invalid database name ""/
  );
});

// 4. Successful Validation & Environment Construction
console.log('\n--- 4. Valid Target & Isolated Environment Construction ---');

check('Accepts valid localhost disposable test configuration', () => {
  const result = validateLocalTestTarget({
    rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="localhost"\nIS_DISPOSABLE_TEST_DATABASE=true',
    envPath: '/fake/.env.test.local'
  });
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.dbName, 'medifind_disposable_test');
  assert.ok(result.maskedHost.includes('loc'));
});

check('Accepts valid 127.0.0.1 disposable test configuration', () => {
  const result = validateLocalTestTarget({
    rawContent: 'TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/medifind_disposable_test"\nEXPECTED_TEST_HOST_KEYWORD="127.0.0.1"\nIS_DISPOSABLE_TEST_DATABASE=true',
    envPath: '/fake/.env.test.local'
  });
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.dbName, 'medifind_disposable_test');
});

check('buildIsolatedPrismaEnv cleanly overrides Prisma variables and removes parent production secrets', () => {
  const fakeBaseEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    DATABASE_URL: 'postgresql://prod_user:prod_secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/neondb',
    DATABASE_URL_UNPOOLED: 'postgresql://prod_user:prod_secret@ep-weathered-mouse-a751mmhd.aws.neon.tech/neondb',
    STAGING_DATABASE_URL: 'postgresql://staging_user:staging_secret@ep-damp-hat-az9wh7zr.aws.neon.tech/neondb',
    DOTENV_CONFIG_PATH: '/malicious/path/.env'
  };

  const testUrl = 'postgresql://postgres:postgres@localhost:5432/medifind_disposable_test';
  const childEnv = buildIsolatedPrismaEnv(testUrl, fakeBaseEnv);

  assert.strictEqual(childEnv.DATABASE_URL, testUrl);
  assert.strictEqual(childEnv.DATABASE_URL_UNPOOLED, testUrl);
  assert.strictEqual(childEnv.DIRECT_URL, testUrl);
  assert.strictEqual(childEnv.PRISMA_GENERATE_SKIP_AUTOINSTALL, 'true');
  assert.strictEqual(childEnv.STAGING_DATABASE_URL, undefined);
  assert.strictEqual(childEnv.DOTENV_CONFIG_PATH, undefined);
  assert.ok(!JSON.stringify(childEnv).includes('prod_secret'));
  assert.ok(!JSON.stringify(childEnv).includes('staging_secret'));
});

check('buildPrismaArgs outputs exact expected migrate deploy command', () => {
  const args = buildPrismaArgs('/test/schema.prisma');
  assert.strictEqual(args[1], 'migrate');
  assert.strictEqual(args[2], 'deploy');
  assert.strictEqual(args[3], '--schema=/test/schema.prisma');
  assert.strictEqual(args.includes('dev'), false);
  assert.strictEqual(args.includes('reset'), false);
  assert.strictEqual(args.includes('push'), false);
});

// 5. CLI Execution Refusal & Error Sanitization
console.log('\n--- 5. CLI Refusal & Sanitization ---');

check('Refuses execution when --confirm-local-test-migrations flag is omitted', () => {
  const runnerPath = path.resolve(__dirname, 'deploy_local_test_migrations.js');
  const res = spawnSync(process.execPath, [runnerPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 3000
  });

  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('[REFUSAL] Missing mandatory flag: --confirm-local-test-migrations'));
});

check('sanitizeErrorMessage masks postgres connection strings and credentials', () => {
  const leaked = 'Error connecting to postgresql://postgres:mypassword123@localhost:5432/medifind_disposable_test with token=abc12345';
  const clean = sanitizeErrorMessage(leaked);
  assert.ok(!clean.includes('mypassword123'));
  assert.ok(!clean.includes('abc12345'));
  assert.ok(clean.includes('postgresql://***:***@***/***'));
});

// Summary
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`Summary: ${passedTests} passed, ${failedTests} failed`);
console.log('═══════════════════════════════════════════════════════════════════\n');

if (failedTests > 0) {
  process.exit(1);
}
