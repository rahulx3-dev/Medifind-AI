/**
 * MediFind AI — Staging-Only Baseline Deployment Runner
 *
 * SAFETY GUARANTEES:
 * 1. REQUIRES explicit command-line flag: --confirm-staging-baseline
 *    Without this flag, the runner refuses to proceed and exits with code 1 immediately.
 * 2. Parses server/.env.staging in an isolated scope. Does NOT mutate the parent environment.
 * 3. Enforces verifyStagingTarget() guardrail before touching anything.
 * 4. Runs probeStagingIdentity() preflight (clean schema, 0 tables, 0 enums, no _prisma_migrations,
 *    read-only session check, anti-collision check against production).
 * 5. Verifies the SHA-256 checksum of prisma/migrations/0_init/migration.sql against
 *    prisma/baseline_init_review.sql before executing.
 * 6. Spawns local installed Prisma CLI (5.22.0) with an isolated environment:
 *    - DATABASE_URL = STAGING_DATABASE_URL
 *    - DATABASE_URL_UNPOOLED = STAGING_DATABASE_URL_UNPOOLED
 *    - Zero production fallbacks.
 * 7. Executes strictly: `prisma migrate deploy`
 *    - NEVER uses db push, migrate dev, migrate reset, or seed scripts.
 * 8. Sanitizes all child process output and errors — NEVER prints credentials, usernames,
 *    or connection URLs.
 * 9. Closes child processes and handles signals cleanly.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const { verifyStagingTarget, maskHost } = require('./verify_staging_target');
const { probeStagingIdentity, sanitizeErrorMessage } = require('./probe_staging_identity');

const SERVER_ROOT = path.resolve(__dirname, '..');
const STAGING_ENV_PATH = path.join(SERVER_ROOT, '.env.staging');
const BASELINE_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'baseline_init_review.sql');
const MIGRATION_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'migrations', '0_init', 'migration.sql');
const MIGRATION_LOCK_PATH = path.join(SERVER_ROOT, 'prisma', 'migrations', 'migration_lock.toml');
const PRISMA_CLI_PATH = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const EXPECTED_HASH = 'E09DF7DEF0E6CCBA8358E347C1CADDAB858EF619867237D26977FF1C90B080C7';

function calculateChecksum(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for checksum verification: ${path.basename(filePath)}`);
  }
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

async function runStagingBaselineDeployment() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  MediFind AI — Staging-Only Baseline Deployment Runner');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Guardrail 1: Check for explicit mandatory command-line flag
  const args = process.argv.slice(2);
  const hasConfirmationFlag = args.includes('--confirm-staging-baseline');

  if (!hasConfirmationFlag) {
    console.error('[REFUSAL] Missing mandatory flag: --confirm-staging-baseline');
    console.error('[REFUSAL] The staging runner refuses to execute without explicit user confirmation.');
    console.error('Usage: node ./scripts/deploy_staging_baseline.js --confirm-staging-baseline');
    process.exit(1);
  }

  // Guardrail 2: Verify local staging configuration file exists
  if (!fs.existsSync(STAGING_ENV_PATH)) {
    console.error('[FAIL CLOSED] Staging environment file not found at server/.env.staging');
    process.exit(1);
  }

  // Guardrail 3: Verify local Prisma CLI binary exists
  if (!fs.existsSync(PRISMA_CLI_PATH)) {
    console.error('[FAIL CLOSED] Local Prisma CLI not found at node_modules/prisma/build/index.js');
    process.exit(1);
  }

  // Guardrail 4: Verify migration files and baseline integrity
  console.log('─── Step 1: Verifying Migration Artifacts & Checksums ───');
  if (!fs.existsSync(MIGRATION_SQL_PATH)) {
    console.error('[FAIL CLOSED] Baseline migration SQL missing at prisma/migrations/0_init/migration.sql');
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATION_LOCK_PATH)) {
    console.error('[FAIL CLOSED] Migration lockfile missing at prisma/migrations/migration_lock.toml');
    process.exit(1);
  }

  const baselineHash = calculateChecksum(BASELINE_SQL_PATH);
  const migrationHash = calculateChecksum(MIGRATION_SQL_PATH);

  if (baselineHash !== migrationHash || baselineHash !== EXPECTED_HASH) {
    console.error('[FAIL CLOSED] Checksum discrepancy on baseline migration artifacts!');
    console.error(`Expected:  ${EXPECTED_HASH}`);
    console.error(`Baseline:  ${baselineHash}`);
    console.error(`Migration: ${migrationHash}`);
    process.exit(1);
  }
  console.log(`✓ Migration Checksum Verified (SHA-256: ${baselineHash})`);

  // Guardrail 5: Run existing target verification
  console.log('\n─── Step 2: Executing Staging Target Guardrail Checks ───');
  const targetCheck = verifyStagingTarget({ silent: false });
  if (!targetCheck || !targetCheck.success) {
    console.error('[FAIL CLOSED] Staging target guardrail verification failed. Aborting.');
    process.exit(1);
  }

  // Guardrail 6: Re-run read-only identity probe and schema precondition check
  console.log('\n─── Step 3: Executing Staging Preflight Probe (Identity & Clean Schema) ───');
  const probeCheck = await probeStagingIdentity();
  if (!probeCheck || !probeCheck.success) {
    console.error('[FAIL CLOSED] Preflight identity or clean schema probe failed. Aborting.');
    process.exit(1);
  }

  if (probeCheck.tableCount !== 0) {
    console.error(`[FAIL CLOSED] Preflight found ${probeCheck.tableCount} existing application tables. Expected 0. Aborting.`);
    process.exit(1);
  }

  // Guardrail 7: Load staging variables for child environment
  const parsedStagingEnv = dotenv.parse(fs.readFileSync(STAGING_ENV_PATH, 'utf8'));
  const stagingUrl = parsedStagingEnv.STAGING_DATABASE_URL;
  const stagingUrlUnpooled = parsedStagingEnv.STAGING_DATABASE_URL_UNPOOLED;

  if (!stagingUrl || !stagingUrlUnpooled) {
    console.error('[FAIL CLOSED] Incomplete staging connection URLs in server/.env.staging');
    process.exit(1);
  }

  // Build isolated environment for child process — explicitly override database URLs
  const childEnv = { ...process.env };

  // Explicitly assign staging connection parameters
  childEnv.DATABASE_URL = stagingUrl;
  childEnv.DATABASE_URL_UNPOOLED = stagingUrlUnpooled;
  childEnv.DIRECT_URL = stagingUrlUnpooled;
  childEnv.PRISMA_GENERATE_SKIP_AUTOINSTALL = 'true';

  // Ensure dotenv path redirection cannot occur
  delete childEnv.DOTENV_CONFIG_PATH;
  delete childEnv.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING;
  delete childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;

  console.log('\n─── Step 4: Spawning Prisma Migrate Deploy on Isolated Staging ───');
  console.log('Command: node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma');
  console.log('Target: Isolated Staging Neon Branch (Direct Endpoint)');

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PRISMA_CLI_PATH, 'migrate', 'deploy', '--schema=./prisma/schema.prisma'],
      {
        cwd: SERVER_ROOT,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk) => {
      const sanitized = sanitizeErrorMessage(chunk.toString());
      stdoutBuffer += sanitized;
      process.stdout.write(sanitized);
    });

    child.stderr.on('data', (chunk) => {
      const sanitized = sanitizeErrorMessage(chunk.toString());
      stderrBuffer += sanitized;
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
        console.log('✓ Staging Baseline Migration Deployed Successfully (Exit Code: 0)');
        console.log('═══════════════════════════════════════════════════════════════════');
        resolve({ success: true, exitCode: 0 });
      } else {
        console.error(`\n[FAIL CLOSED] Prisma migrate deploy exited with code: ${code}`);
        reject(new Error(`Prisma migrate deploy failed with exit code ${code}`));
      }
    });
  });
}

if (require.main === module) {
  runStagingBaselineDeployment().catch((err) => {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    console.error(`[FATAL] Staging baseline deployment runner failed: ${sanitizedMsg}`);
    process.exit(1);
  });
}

module.exports = {
  runStagingBaselineDeployment,
  calculateChecksum,
  EXPECTED_HASH
};
