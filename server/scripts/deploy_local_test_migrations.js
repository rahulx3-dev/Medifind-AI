/**
 * MediFind AI — Guarded Local Disposable Test Migration Runner
 *
 * CRITICAL SAFETY ENFORCEMENT:
 * 1. Strictly dedicated to local disposable test databases (localhost/127.0.0.1 only).
 * 2. Loads ONLY server/.env.test.local. NEVER loads .env, .env.staging, or production credentials.
 * 3. Enforces assertSafeTestDatabase() from testDatabaseGuard.js.
 * 4. Requires target host to be an authorized loopback address (localhost / 127.0.0.1 / ::1 / host.docker.internal).
 * 5. Requires target database name to be strictly "medifind_disposable_test".
 * 6. Requires IS_DISPOSABLE_TEST_DATABASE=true.
 * 7. Explicitly passes DATABASE_URL and DATABASE_URL_UNPOOLED to child Prisma process in an isolated environment.
 * 8. Executes strictly: `prisma migrate deploy --schema=./prisma/schema.prisma`
 *    NEVER executes db push, migrate dev, migrate reset, or seed scripts.
 * 9. Requires explicit CLI confirmation flag: --confirm-local-test-migrations.
 * 10. Sanitizes all child process output and errors — NEVER prints URLs, credentials, or secrets.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const { assertSafeTestDatabase, maskHost } = require('../src/utils/testDatabaseGuard');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TEST_LOCAL_PATH = path.join(SERVER_ROOT, '.env.test.local');
const PRISMA_CLI_PATH = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'prisma', 'migrations');

const AUTHORIZED_LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1'
]);

const REQUIRED_TEST_DB_NAME = 'medifind_disposable_test';

/**
 * Strips sensitive connection strings, credentials, and query params.
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgresql://***:***@***/***')
    .replace(/password=[^\s&'"`]+/gi, 'password=***')
    .replace(/user=[^\s&'"`]+/gi, 'user=***')
    .replace(/token=[^\s&'"`]+/gi, 'token=***')
    .replace(/api[-_]?key=[^\s&'"`]+/gi, 'api_key=***');
}

/**
 * Validates that the local test configuration is valid, safe, and disposable.
 *
 * @param {object} [options]
 * @param {string} [options.envPath] - Path to .env.test.local
 * @param {string} [options.rawContent] - Raw content of env file (for testing)
 * @param {string} [options.targetUrl] - Explicit target URL override
 * @param {string} [options.expectedKeyword] - Explicit keyword override
 * @param {string} [options.isDisposable] - Explicit isDisposable override
 * @returns {{ isValid: boolean, targetUrl: string, maskedHost: string, dbName: string }}
 */
function validateLocalTestTarget(options = {}) {
  let targetUrl = options.targetUrl;
  let expectedKeyword = options.expectedKeyword;
  let isDisposable = options.isDisposable;

  // Read strictly from .env.test.local if not explicitly passed
  if (!targetUrl) {
    const envPath = options.envPath || DEFAULT_TEST_LOCAL_PATH;
    if (!fs.existsSync(envPath) && !options.rawContent) {
      throw new Error(`[FAIL CLOSED] Test environment configuration file not found at: ${envPath}. Cannot run local migrations without server/.env.test.local.`);
    }

    const content = options.rawContent !== undefined ? options.rawContent : fs.readFileSync(envPath, 'utf8');
    const parsed = dotenv.parse(content);

    targetUrl = parsed.TEST_DATABASE_URL;
    expectedKeyword = expectedKeyword || parsed.EXPECTED_TEST_HOST_KEYWORD;
    isDisposable = isDisposable !== undefined ? isDisposable : parsed.IS_DISPOSABLE_TEST_DATABASE;
  }

  // Check 1: Mandatory disposability flag
  if (isDisposable !== 'true' && isDisposable !== true) {
    throw new Error('[FAIL CLOSED] IS_DISPOSABLE_TEST_DATABASE must be explicitly set to "true" in server/.env.test.local.');
  }

  // Check 2: Core test database guard
  const guard = assertSafeTestDatabase(targetUrl, {
    expectedHostKeyword: expectedKeyword,
    testLocalEnvPath: options.envPath || DEFAULT_TEST_LOCAL_PATH
  });

  if (!guard.isSafe) {
    throw new Error(guard.error || '[FAIL CLOSED] Target database failed test database safety guard.');
  }

  // Check 3: Strictly enforce loopback identity
  let parsedUrl;
  try {
    parsedUrl = new url.URL(targetUrl);
  } catch (err) {
    throw new Error(`[FAIL CLOSED] Malformed target URL: ${err.message}`);
  }

  const hostname = (parsedUrl.hostname || '').toLowerCase();
  if (!AUTHORIZED_LOOPBACK_HOSTS.has(hostname) || guard.identityType !== 'LOCAL_LOOPBACK') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Target host (${maskHost(hostname)}) is not an authorized local loopback host. Only "localhost" and "127.0.0.1" are permitted. Container aliases (including host.docker.internal) and remote hosts are strictly prohibited.`);
  }

  // Check 4: Strictly enforce exact database name
  const dbName = (parsedUrl.pathname || '').replace(/^\//, '').split('?')[0].trim();
  if (dbName !== REQUIRED_TEST_DB_NAME) {
    throw new Error(`[FAIL CLOSED] Invalid database name "${dbName}". Local test migration runner strictly requires database name to be exactly "${REQUIRED_TEST_DB_NAME}".`);
  }

  return {
    isValid: true,
    targetUrl,
    maskedHost: maskHost(hostname),
    dbName
  };
}

/**
 * Builds an isolated environment for the child Prisma process.
 * Strips parent database variables and assigns validated test URL.
 */
function buildIsolatedPrismaEnv(validatedUrl, baseEnv = process.env) {
  const childEnv = {};

  // Copy safe system essentials only
  const safeKeys = [
    'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot',
    'TEMP', 'TMP', 'USERPROFILE', 'HOMEPATH', 'HOMEDRIVE',
    'NODE_PATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA'
  ];

  for (const key of Object.keys(baseEnv)) {
    if (safeKeys.includes(key) || (!key.includes('DATABASE') && !key.includes('NEON') && !key.includes('PRISMA') && !key.includes('DOTENV'))) {
      childEnv[key] = baseEnv[key];
    }
  }

  // Explicitly assign validated local test URL to Prisma variables
  childEnv.DATABASE_URL = validatedUrl;
  childEnv.DATABASE_URL_UNPOOLED = validatedUrl;
  childEnv.DIRECT_URL = validatedUrl;
  childEnv.PRISMA_GENERATE_SKIP_AUTOINSTALL = 'true';

  // Prevent dotenv path redirection
  delete childEnv.DOTENV_CONFIG_PATH;

  return childEnv;
}

/**
 * Returns arguments for spawning Prisma migrate deploy.
 */
function buildPrismaArgs(schemaPath = SCHEMA_PATH) {
  return [PRISMA_CLI_PATH, 'migrate', 'deploy', `--schema=${schemaPath}`];
}

/**
 * Executes `prisma migrate deploy` against the validated local test target.
 */
async function deployLocalTestMigrations(options = {}) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  MediFind AI — Guarded Local Test Migration Runner');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Guardrail 1: Require explicit command-line confirmation flag
  const args = options.args || process.argv.slice(2);
  const hasConfirmationFlag = args.includes('--confirm-local-test-migrations') || options.force === true;

  if (!hasConfirmationFlag) {
    console.error('\n[REFUSAL] Missing mandatory flag: --confirm-local-test-migrations');
    console.error('The guarded local migration runner refuses to proceed without explicit confirmation.');
    console.error('Usage: node ./scripts/deploy_local_test_migrations.js --confirm-local-test-migrations\n');
    process.exit(1);
  }

  // Guardrail 2: Verify local prerequisites on disk
  if (!fs.existsSync(PRISMA_CLI_PATH)) {
    console.error('[FAIL CLOSED] Local Prisma CLI not found at node_modules/prisma/build/index.js');
    process.exit(1);
  }

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('[FAIL CLOSED] Prisma schema file missing at prisma/schema.prisma');
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('[FAIL CLOSED] Prisma migrations directory missing at prisma/migrations');
    process.exit(1);
  }

  // Guardrail 3: Validate target configuration
  console.log('\n─── Step 1: Validating Local Disposable Test Target ───');
  const validation = validateLocalTestTarget(options);
  console.log(`✓ Target Host: Authorized Loopback (${validation.maskedHost})`);
  console.log(`✓ Database Name: Verified strictly as "${validation.dbName}"`);
  console.log('✓ Disposability: IS_DISPOSABLE_TEST_DATABASE=true verified');

  // Guardrail 4: Build isolated child environment
  console.log('\n─── Step 2: Preparing Isolated Child Environment ───');
  const childEnv = buildIsolatedPrismaEnv(validation.targetUrl, process.env);
  console.log('✓ Overrode DATABASE_URL and DATABASE_URL_UNPOOLED with validated local target');
  console.log('✓ Stripped production/staging environment variables from child scope');

  // Guardrail 5: Spawn Prisma migrate deploy
  console.log('\n─── Step 3: Spawning Prisma Migrate Deploy on Local Container ───');
  const prismaArgs = buildPrismaArgs(SCHEMA_PATH);
  console.log(`Command: node ${path.relative(SERVER_ROOT, PRISMA_CLI_PATH)} ${prismaArgs.slice(1).join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, prismaArgs, {
      cwd: SERVER_ROOT,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    child.stdout.on('data', (chunk) => {
      const sanitized = sanitizeErrorMessage(chunk.toString());
      process.stdout.write(sanitized);
    });

    child.stderr.on('data', (chunk) => {
      const sanitized = sanitizeErrorMessage(chunk.toString());
      process.stderr.write(sanitized);
    });

    child.on('error', (err) => {
      const sanitizedErr = sanitizeErrorMessage(err.message);
      console.error(`[FAIL CLOSED] Child process error: ${sanitizedErr}`);
      reject(new Error(`Failed to execute Prisma migrate: ${sanitizedErr}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log('✓ Local Disposable Test Migrations Deployed Successfully (Exit: 0)');
        console.log('═══════════════════════════════════════════════════════════════════\n');
        resolve({ success: true, exitCode: 0 });
      } else {
        console.error(`\n[FAIL CLOSED] Prisma migrate deploy exited with code: ${code}\n`);
        reject(new Error(`Prisma migrate deploy failed with exit code ${code}`));
      }
    });
  });
}

// CLI entry point
if (require.main === module) {
  deployLocalTestMigrations().catch(() => {
    process.exit(1);
  });
}

module.exports = {
  validateLocalTestTarget,
  buildIsolatedPrismaEnv,
  buildPrismaArgs,
  sanitizeErrorMessage,
  deployLocalTestMigrations,
  AUTHORIZED_LOOPBACK_HOSTS,
  REQUIRED_TEST_DB_NAME
};
