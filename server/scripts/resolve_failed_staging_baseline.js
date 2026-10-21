/**
 * MediFind AI — Guarded Staging Migration Rollback Resolution Script
 *
 * SAFETY GUARANTEES:
 * 1. REQUIRES explicit command-line flag: --confirm-staging-rollback-resolution
 *    Without this flag, the runner refuses to proceed and exits with code 1 immediately
 *    BEFORE connecting to any database.
 * 2. Parses server/.env.staging in an isolated scope. Does NOT mutate the parent environment.
 * 3. Enforces verifyStagingTarget() guardrail before touching anything:
 *    - Expected endpoint identifier: ep-damp-hat-az9wh7zr
 *    - Expected database name: neondb
 *    - Direct and pooled hosts resolve to identical endpoint base
 *    - TLS required (sslmode=require)
 *    - Strictly isolated from production database host
 * 4. Executes read-only preflight checks inside a SET TRANSACTION READ ONLY transaction:
 *    - Zero public application tables (excluding _prisma_migrations)
 *    - Zero public views
 *    - Zero public custom enums
 *    - Exactly one migration record in _prisma_migrations: 0_init
 *    - finished_at IS NULL
 *    - rolled_back_at IS NULL
 *    - applied_steps_count === 0
 *    - Failure log matches the reported UTF-8 BOM syntax error
 * 5. Dry-run mode (--dry-run): performs all preflight checks but halts before calling Prisma CLI.
 * 6. Authorized mutation: ONLY when all preflight checks pass and --dry-run is not set, calls:
 *    `prisma migrate resolve --rolled-back 0_init --schema=./prisma/schema.prisma`
 *    with isolated child environment and sanitized output.
 * 7. ZERO db push, ZERO migrate reset, ZERO migrate dev, ZERO direct SQL updates, ZERO table drops.
 * 8. Sanitizes all output — NEVER prints credentials, tokens, passwords, or connection URLs.
 * 9. Closes database connections cleanly in finally.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { verifyStagingTarget, maskHost } = require('./verify_staging_target');
const { sanitizeErrorMessage } = require('./probe_staging_identity');

const SERVER_ROOT = path.resolve(__dirname, '..');
const STAGING_ENV_PATH = path.join(SERVER_ROOT, '.env.staging');
const PROD_ENV_PATH = path.join(SERVER_ROOT, '.env');
const PRISMA_CLI_PATH = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'prisma', 'schema.prisma');

const MANDATORY_CONFIRMATION_FLAG = '--confirm-staging-rollback-resolution';
const DRY_RUN_FLAG = '--dry-run';
const OFFLINE_MOCK_FLAG = '--offline-mock';

const EXPECTED_ENDPOINT_KEYWORD = 'ep-damp-hat-az9wh7zr';
const EXPECTED_DB_NAME = 'neondb';

/**
 * Validates preflight conditions on migration metadata and database schema.
 * @param {object} tx Prisma interactive transaction client or mock
 * @returns {Promise<{ success: boolean, details: object }>}
 */
async function verifyPreconditions(tx) {
  // 1. Check for public application tables excluding _prisma_migrations
  const appTables = await tx.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != '_prisma_migrations';
  `);

  if (!Array.isArray(appTables) || appTables.length > 0) {
    const tableNames = (appTables || []).map(t => t.table_name).join(', ');
    throw new Error(`Precondition Failed: Found ${appTables.length} unexpected application tables: [${tableNames}]. Expected 0.`);
  }

  // 2. Check for public views
  const views = await tx.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'VIEW';
  `);

  if (!Array.isArray(views) || views.length > 0) {
    const viewNames = (views || []).map(v => v.table_name).join(', ');
    throw new Error(`Precondition Failed: Found ${views.length} unexpected public views: [${viewNames}]. Expected 0.`);
  }

  // 3. Check for custom enums
  const enums = await tx.$queryRawUnsafe(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e';
  `);

  if (!Array.isArray(enums) || enums.length > 0) {
    const enumNames = (enums || []).map(e => e.typname).join(', ');
    throw new Error(`Precondition Failed: Found ${enums.length} unexpected public custom enums: [${enumNames}]. Expected 0.`);
  }

  // 4. Verify _prisma_migrations exists
  const regclassCheck = await tx.$queryRawUnsafe(`
    SELECT to_regclass('public._prisma_migrations')::text AS regclass;
  `);

  const hasMigrationTable = Boolean(regclassCheck[0] && regclassCheck[0].regclass);
  if (!hasMigrationTable) {
    throw new Error('Precondition Failed: Table public._prisma_migrations does not exist.');
  }

  // 5. Query migration records
  const migrationRecords = await tx.$queryRawUnsafe(`
    SELECT
      id,
      migration_name,
      finished_at,
      rolled_back_at,
      applied_steps_count,
      started_at,
      logs
    FROM public._prisma_migrations
    ORDER BY started_at ASC;
  `);

  if (!Array.isArray(migrationRecords) || migrationRecords.length !== 1) {
    throw new Error(`Precondition Failed: Expected exactly 1 migration record in _prisma_migrations, but found ${migrationRecords.length}.`);
  }

  const record = migrationRecords[0];

  // 6. Verify migration name is exactly 0_init
  if (record.migration_name !== '0_init') {
    throw new Error(`Precondition Failed: Recorded migration name is '${record.migration_name}', expected '0_init'.`);
  }

  // 7. Verify finished_at IS NULL
  if (record.finished_at !== null) {
    throw new Error(`Precondition Failed: Migration 0_init finished_at is not NULL (${record.finished_at}).`);
  }

  // 8. Verify rolled_back_at IS NULL
  if (record.rolled_back_at !== null) {
    throw new Error(`Precondition Failed: Migration 0_init is already rolled back (${record.rolled_back_at}).`);
  }

  // 9. Verify applied_steps_count === 0
  if (record.applied_steps_count !== 0) {
    throw new Error(`Precondition Failed: Migration 0_init applied_steps_count is ${record.applied_steps_count}, expected 0.`);
  }

  // 10. Verify recorded error log matches UTF-8 BOM syntax error
  const logs = record.logs || '';
  const hasSyntaxError = logs.includes('syntax error at or near') || logs.includes('42601') || logs.includes('scanner_yyerror');
  const hasBomIndicator = logs.includes('\u{feff}') || logs.includes('\ufeff') || logs.includes('﻿');

  if (!hasSyntaxError || !hasBomIndicator) {
    throw new Error('Precondition Failed: Migration error log does not match the confirmed UTF-8 BOM syntax error.');
  }

  return {
    success: true,
    details: {
      migrationName: record.migration_name,
      startedAt: record.started_at,
      appliedStepsCount: record.applied_steps_count,
      appTablesCount: appTables.length,
      viewsCount: views.length,
      enumsCount: enums.length
    }
  };
}

/**
 * Spawns Prisma CLI migrate resolve command with isolated environment.
 * @param {object} options
 * @param {string} options.stagingUrl
 * @param {string} options.stagingUrlUnpooled
 * @returns {Promise<{ success: boolean, exitCode: number }>}
 */
function spawnPrismaMigrateResolve(options) {
  const { stagingUrl, stagingUrlUnpooled } = options;

  console.log('\n─── Executing Prisma Migrate Resolve on Isolated Staging ───');
  console.log('Command: node ./node_modules/prisma/build/index.js migrate resolve --rolled-back 0_init --schema=./prisma/schema.prisma');
  console.log('Target:  Isolated Staging Neon Branch (Direct Endpoint)');

  const childEnv = { ...process.env };
  childEnv.DATABASE_URL = stagingUrl;
  childEnv.DATABASE_URL_UNPOOLED = stagingUrlUnpooled;
  childEnv.DIRECT_URL = stagingUrlUnpooled;
  childEnv.PRISMA_GENERATE_SKIP_AUTOINSTALL = 'true';

  delete childEnv.DOTENV_CONFIG_PATH;
  delete childEnv.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING;
  delete childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
  delete childEnv.SHADOW_DATABASE_URL;
  delete childEnv.POSTGRES_URL;
  delete childEnv.POSTGRES_PRISMA_URL;
  delete childEnv.POSTGRES_URL_NON_POOLING;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PRISMA_CLI_PATH, 'migrate', 'resolve', '--rolled-back', '0_init', '--schema=./prisma/schema.prisma'],
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
      reject(new Error(`Failed to execute Prisma migrate resolve: ${sanitizedErr}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log('✓ Staging Baseline Migration 0_init Marked as Rolled Back (Exit Code: 0)');
        console.log('═══════════════════════════════════════════════════════════════════');
        resolve({ success: true, exitCode: 0 });
      } else {
        console.error(`\n[FAIL CLOSED] Prisma migrate resolve exited with code: ${code}`);
        reject(new Error(`Prisma migrate resolve failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Main function to resolve failed staging baseline migration.
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.offlineMock]
 * @param {string[]} [options.args]
 * @returns {Promise<{ success: boolean, dryRun?: boolean, exitCode?: number }>}
 */
async function resolveFailedStagingBaseline(options = {}) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  MediFind AI — Guarded Staging Migration Rollback Resolution');
  console.log('═══════════════════════════════════════════════════════════════════');

  const args = options.args || process.argv.slice(2);
  const hasConfirmationFlag = args.includes(MANDATORY_CONFIRMATION_FLAG);
  const isDryRun = options.dryRun || args.includes(DRY_RUN_FLAG);
  const isOfflineMock = options.offlineMock || args.includes(OFFLINE_MOCK_FLAG);

  // Safeguard: --offline-mock is strictly test-only and requires --dry-run
  if (isOfflineMock && !isDryRun) {
    console.error(`[REFUSAL] ${OFFLINE_MOCK_FLAG} is strictly test-only and cannot be used for execution. ${DRY_RUN_FLAG} is mandatory.`);
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Offline mock cannot execute migration resolution' };
  }

  // Safeguard 1: Mandatory command-line flag check BEFORE any connection
  if (!hasConfirmationFlag) {
    console.error(`[REFUSAL] Missing mandatory flag: ${MANDATORY_CONFIRMATION_FLAG}`);
    console.error('[REFUSAL] This recovery script refuses to execute without explicit user confirmation.');
    console.error(`Usage: node ./scripts/resolve_failed_staging_baseline.js ${MANDATORY_CONFIRMATION_FLAG} [${DRY_RUN_FLAG}]`);
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Missing mandatory confirmation flag' };
  }

  // Safeguard 2: Verify local files exist
  if (!fs.existsSync(STAGING_ENV_PATH)) {
    console.error('[FAIL CLOSED] Staging configuration not found at server/.env.staging');
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Missing staging configuration' };
  }

  if (!fs.existsSync(PRISMA_CLI_PATH)) {
    console.error('[FAIL CLOSED] Local Prisma CLI not found at node_modules/prisma/build/index.js');
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Missing Prisma CLI' };
  }

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('[FAIL CLOSED] Prisma schema file missing at prisma/schema.prisma');
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Missing Prisma schema' };
  }

  // Safeguard 3: Parse staging variables in isolated container
  let parsedStagingEnv = {};
  try {
    parsedStagingEnv = dotenv.parse(fs.readFileSync(STAGING_ENV_PATH, 'utf8'));
  } catch (parseErr) {
    console.error(`[FAIL CLOSED] Failed to parse staging environment: ${parseErr.message}`);
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Parse error' };
  }

  const stagingUrl = parsedStagingEnv.STAGING_DATABASE_URL;
  const stagingUrlUnpooled = parsedStagingEnv.STAGING_DATABASE_URL_UNPOOLED;
  const configuredEndpointId = (parsedStagingEnv.EXPECTED_STAGING_HOST_KEYWORD || '').toLowerCase().trim();
  const configuredDbName = (parsedStagingEnv.EXPECTED_STAGING_DB_NAME || '').toLowerCase().trim();

  // Safeguard 4: Run existing verifyStagingTarget guardrail
  console.log('─── Step 1: Executing Staging Target Guardrail Verification ───');
  const targetCheck = verifyStagingTarget({
    stagingEnvPath: STAGING_ENV_PATH,
    prodEnvPath: PROD_ENV_PATH,
    silent: false
  });

  if (!targetCheck || !targetCheck.success) {
    console.error('[FAIL CLOSED] Staging target guardrail verification failed. Aborting.');
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Target guardrail failed' };
  }

  // Explicit target assertions
  if (configuredEndpointId !== EXPECTED_ENDPOINT_KEYWORD) {
    console.error(`[FAIL CLOSED] Target endpoint mismatch. Expected: ${EXPECTED_ENDPOINT_KEYWORD}, found: ${configuredEndpointId}`);
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Endpoint keyword mismatch' };
  }

  if (configuredDbName !== EXPECTED_DB_NAME) {
    console.error(`[FAIL CLOSED] Target database mismatch. Expected: ${EXPECTED_DB_NAME}, found: ${configuredDbName}`);
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Database name mismatch' };
  }

  console.log(`✓ Staging Target Guardrails Confirmed (Endpoint: ${EXPECTED_ENDPOINT_KEYWORD}, DB: ${EXPECTED_DB_NAME})`);

  // Safeguard 5: Read-only preflight verification
  console.log('\n─── Step 2: Executing Read-Only Schema & Precondition Checks ───');

  let preflightResult;

  if (isOfflineMock) {
    console.log('[OFFLINE TEST MODE] Simulating preflight checks against offline test fixture...');
    const mockTx = {
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async (sql) => {
        if (sql.includes("table_name != '_prisma_migrations'")) return [];
        if (sql.includes("table_type = 'VIEW'")) return [];
        if (sql.includes("typtype = 'e'")) return [];
        if (sql.includes('to_regclass')) return [{ regclass: 'public._prisma_migrations' }];
        if (sql.includes('FROM public._prisma_migrations')) {
          return [{
            id: 'mock-id-001',
            migration_name: '0_init',
            finished_at: null,
            rolled_back_at: null,
            applied_steps_count: 0,
            started_at: '2026-10-15T17:15:43.567Z',
            logs: 'ERROR: syntax error at or near "﻿"\nPosition: 1 ﻿-- CreateTable\nDbError { message: "syntax error at or near \\"\\u{feff}\\"", code: SqlState(E42601) }'
          }];
        }
        return [];
      }
    };
    preflightResult = await verifyPreconditions(mockTx);
  } else {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: stagingUrlUnpooled
        }
      },
      log: ['error']
    });

    try {
      preflightResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY;');
        return await verifyPreconditions(tx);
      }, {
        timeout: 20000,
        maxWait: 5000
      });
    } catch (preflightErr) {
      const sanitized = sanitizeErrorMessage(preflightErr.message);
      console.error(`[FAIL CLOSED] Precondition check failed: ${sanitized}`);
      if (require.main === module) process.exit(1);
      return { success: false, error: sanitized };
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log('✓ Public application tables: 0 (excluding _prisma_migrations)');
  console.log('✓ Public views: 0');
  console.log('✓ Public custom enums: 0');
  console.log('✓ Recorded migration: 0_init (finished_at: null, rolled_back_at: null, steps: 0)');
  console.log('✓ Confirmed failure mode: UTF-8 BOM syntax error (\\u{feff})');
  console.log('✓ All Preconditions Verified Successfully');

  // Safeguard 6: Dry-Run Intercept
  if (isDryRun) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('[DRY RUN] All preflight checks passed successfully.');
    console.log('[DRY RUN] Prisma migrate resolve command was NOT executed.');
    console.log('═══════════════════════════════════════════════════════════════════');
    return { success: true, dryRun: true };
  }

  // Hard safety guardrail: offline mock must NEVER execute migration resolution
  if (isOfflineMock) {
    console.error('[REFUSAL] Cannot execute Prisma migrate resolve in offline mock mode.');
    if (require.main === module) process.exit(1);
    return { success: false, error: 'Cannot execute in offline mock mode' };
  }

  // Safeguard 7: Authorized execution of migrate resolve
  const result = await spawnPrismaMigrateResolve({
    stagingUrl,
    stagingUrlUnpooled
  });

  return result;
}

if (require.main === module) {
  resolveFailedStagingBaseline().catch((err) => {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    console.error(`[FATAL] Staging rollback resolution runner failed: ${sanitizedMsg}`);
    process.exit(1);
  });
}

module.exports = {
  resolveFailedStagingBaseline,
  verifyPreconditions,
  MANDATORY_CONFIRMATION_FLAG,
  DRY_RUN_FLAG,
  OFFLINE_MOCK_FLAG,
  EXPECTED_ENDPOINT_KEYWORD,
  EXPECTED_DB_NAME
};
