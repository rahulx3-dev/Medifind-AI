/**
 * MediFind AI — Read-Only Staging Schema & Migration History Inspector
 *
 * Strict read-only inspection script.
 * Connects strictly to the isolated staging Neon branch (direct unpooled endpoint).
 *
 * SAFETY & SECURITY:
 * 1. Executes in a single interactive transaction with SET TRANSACTION READ ONLY.
 * 2. Runs verifyStagingTarget() guardrail before touching anything.
 * 3. Never prints passwords, connection strings, usernames, or tokens.
 * 4. Sanitizes all error messages.
 * 5. Disconnects cleanly in all success and failure branches via finally.
 * 6. Compares live database objects against the expected 19-table baseline.
 * 7. ZERO DDL, ZERO mutations, ZERO automated repairs or deletions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { verifyStagingTarget, maskHost, normalizeNeonHost } = require('./verify_staging_target');
const { sanitizeErrorMessage } = require('./probe_staging_identity');

const SERVER_ROOT = path.resolve(__dirname, '..');
const STAGING_ENV_PATH = path.join(SERVER_ROOT, '.env.staging');
const PROD_ENV_PATH = path.join(SERVER_ROOT, '.env');
const BASELINE_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'baseline_init_review.sql');
const MIGRATION_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'migrations', '0_init', 'migration.sql');
const EXPECTED_HASH = 'E09DF7DEF0E6CCBA8358E347C1CADDAB858EF619867237D26977FF1C90B080C7';

// Expected 19 baseline tables
const EXPECTED_TABLES = new Set([
  'User',
  'AssistantProfile',
  'VerificationDocument',
  'VerificationReviewLog',
  'Pharmacy',
  'Medicine',
  'Inventory',
  'Prescription',
  'DetectedMedicine',
  'Order',
  'PatientAddress',
  'Payment',
  'OrderItem',
  'OrderStatusHistory',
  'AssistantTask',
  'Notification',
  'RestockRequest',
  'HealthcareAppointment',
  'AppointmentStatusHistory'
]);

function calculateChecksum(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File missing for checksum: ${path.basename(filePath)}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

async function inspectStagingSchema() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  MediFind AI — Staging Schema & Migration History Inspector');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Step 1: Baseline File Integrity Verification
  console.log('─── Step 1: Checking Baseline Artifact Integrity ───');
  const baselineHash = calculateChecksum(BASELINE_SQL_PATH);
  const migrationHash = calculateChecksum(MIGRATION_SQL_PATH);

  if (baselineHash !== EXPECTED_HASH || migrationHash !== EXPECTED_HASH) {
    console.error('[FAIL CLOSED] Checksum discrepancy on baseline artifacts!');
    console.error(`Expected:  ${EXPECTED_HASH}`);
    console.error(`Baseline:  ${baselineHash}`);
    console.error(`Migration: ${migrationHash}`);
    process.exit(1);
  }
  console.log(`✓ Baseline Artifacts Verified (SHA-256: ${EXPECTED_HASH})`);

  // Step 2: Target Guardrail Check
  console.log('\n─── Step 2: Staging Target Guardrail Verification ───');
  const targetCheck = verifyStagingTarget({ silent: false });
  if (!targetCheck || !targetCheck.success) {
    console.error('[FAIL CLOSED] Staging target verification guardrail failed. Aborting.');
    process.exit(1);
  }

  // Step 3: Parse staging connection in isolated scope
  const parsedStagingEnv = dotenv.parse(fs.readFileSync(STAGING_ENV_PATH, 'utf8'));
  const unpooledUrl = parsedStagingEnv.STAGING_DATABASE_URL_UNPOOLED;
  const expectedEndpointId = (parsedStagingEnv.EXPECTED_STAGING_HOST_KEYWORD || '').toLowerCase().trim();

  let parsedUrl;
  try {
    parsedUrl = new URL(unpooledUrl);
  } catch (err) {
    console.error('[FAIL CLOSED] STAGING_DATABASE_URL_UNPOOLED is not a valid URL.');
    process.exit(1);
  }

  const directHost = (parsedUrl.hostname || '').toLowerCase();
  const normalizedDirectHost = normalizeNeonHost(directHost);

  // Anti-collision check against production
  if (fs.existsSync(PROD_ENV_PATH)) {
    try {
      const prodEnv = dotenv.parse(fs.readFileSync(PROD_ENV_PATH, 'utf8'));
      const prodUrls = [prodEnv.DATABASE_URL, prodEnv.DATABASE_URL_UNPOOLED, prodEnv.DIRECT_URL].filter(Boolean);
      for (const pUrl of prodUrls) {
        try {
          const pHost = new URL(pUrl).hostname.toLowerCase();
          if (normalizeNeonHost(pHost) === normalizedDirectHost) {
            console.error(`[FAIL CLOSED] Target host matches production host (${maskHost(pHost)})! Aborting.`);
            process.exit(1);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Ensure SSL verification
  const sslMode = parsedUrl.searchParams.get('sslmode');
  if (sslMode && sslMode !== 'require' && sslMode !== 'verify-full' && sslMode !== 'verify-ca') {
    console.error(`[FAIL CLOSED] Insecure sslmode "${sslMode}" detected. Staging requires valid TLS.`);
    process.exit(1);
  }

  // Step 4: Instantiate PrismaClient targeting ONLY unpooled staging URL
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: unpooledUrl
      }
    },
    log: ['error']
  });

  try {
    await prisma.$connect();

    // Step 5: Execute all inspection queries within a single interactive read-only transaction
    const inspectionData = await prisma.$transaction(async (tx) => {
      // Enforce read-only at session/transaction level
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY;');

      // 1. Current Database & Schema
      const identityRows = await tx.$queryRawUnsafe(`
        SELECT 
          current_database() AS db_name,
          current_schema() AS schema_name,
          version() AS pg_version;
      `);
      const identity = identityRows[0] || {};

      // 2. Public Base Tables
      const tableRows = await tx.$queryRawUnsafe(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name ASC;
      `);
      const baseTables = tableRows.map(r => r.table_name);

      // 3. Public Views
      const viewRows = await tx.$queryRawUnsafe(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'VIEW'
        ORDER BY table_name ASC;
      `);
      const views = viewRows.map(r => r.table_name);

      // 4. Indexes & Associated Tables
      const indexRows = await tx.$queryRawUnsafe(`
        SELECT
          tablename AS table_name,
          indexname AS index_name,
          indexdef AS index_def
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename ASC, indexname ASC;
      `);
      const indexes = indexRows;

      // 5. Foreign Key Constraints (pg_constraint catalog query)
      const fkRows = await tx.$queryRawUnsafe(`
        SELECT
          c.conname AS constraint_name,
          c.conrelid::regclass::text AS table_name,
          c.confrelid::regclass::text AS foreign_table_name,
          pg_get_constraintdef(c.oid) AS constraint_def
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
        ORDER BY c.conrelid::regclass::text, c.conname;
      `);
      const foreignKeys = fkRows;

      // 6. Public Enums
      const enumRows = await tx.$queryRawUnsafe(`
        SELECT
          t.typname AS enum_name,
          e.enumlabel AS enum_value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.typname ASC, e.enumsortorder ASC;
      `);
      const enums = enumRows;

      // 7 & 8. Check for _prisma_migrations table
      const hasMigrationTableQuery = await tx.$queryRawUnsafe(`
        SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
      `);
      const hasMigrationTable = (hasMigrationTableQuery[0]?.count ?? 0) > 0;

      let migrationRecords = [];
      if (hasMigrationTable) {
        migrationRecords = await tx.$queryRawUnsafe(`
          SELECT
            id,
            checksum,
            finished_at,
            migration_name,
            logs,
            rolled_back_at,
            started_at,
            applied_steps_count
          FROM public._prisma_migrations
          ORDER BY started_at ASC;
        `);
      }

      return {
        identity,
        baseTables,
        views,
        indexes,
        foreignKeys,
        enums,
        hasMigrationTable,
        migrationRecords
      };
    }, {
      timeout: 20000,
      maxWait: 5000
    });

    // Step 6: Format and Report Inspection Findings
    console.log('\n─── Step 3: Live Staging Target Inspection Findings ───');
    console.log(`Connected Database: ${inspectionData.identity.db_name}`);
    console.log(`Connected Schema:   ${inspectionData.identity.schema_name}`);
    console.log(`Target Endpoint:    ${maskHost(directHost)} (matches "${expectedEndpointId}")`);
    console.log(`PostgreSQL Engine:  ${(inspectionData.identity.pg_version || '').split(' on ')[0]}`);
    console.log(`Public Base Tables: ${inspectionData.baseTables.length}`);
    console.log(`Public Views:       ${inspectionData.views.length}`);
    console.log(`Total Indexes:      ${inspectionData.indexes.length}`);
    console.log(`Total Foreign Keys: ${inspectionData.foreignKeys.length}`);
    console.log(`Public Enums:       ${inspectionData.enums.length}`);
    console.log(`_prisma_migrations: ${inspectionData.hasMigrationTable ? 'EXISTS' : 'ABSENT'}`);

    // Detailed Table Classification
    console.log('\n─── Step 4: Baseline Comparison & Schema Classification ───');
    const liveTables = inspectionData.baseTables.filter(t => t !== '_prisma_migrations');
    const missingExpected = [...EXPECTED_TABLES].filter(t => !liveTables.includes(t));
    const unexpectedTables = liveTables.filter(t => !EXPECTED_TABLES.has(t));

    if (liveTables.length === 0 && !inspectionData.hasMigrationTable) {
      console.log('Classification: EMPTY STAGING DATABASE (Clean for baseline deployment)');
      console.log('✓ 0 tables present. Ready to apply 0_init baseline migration.');
    } else if (missingExpected.length === 0 && unexpectedTables.length === 0) {
      console.log('Classification: MATCHING BASELINE TABLE INVENTORY (19/19 tables present by name)');
      console.log('✓ All 19 expected application tables are present by name.');
      console.log('  Notice: This confirms table presence by name only; it does not evaluate column-level or constraint-level equivalence.');
    } else {
      console.log('Classification: UNEXPECTED / PARTIAL SCHEMA STATE');
      if (missingExpected.length > 0) {
        console.warn(`Missing Expected Tables (${missingExpected.length}): ${missingExpected.join(', ')}`);
      }
      if (unexpectedTables.length > 0) {
        console.warn(`Unexpected Tables Found (${unexpectedTables.length}): ${unexpectedTables.join(', ')}`);
      }
    }

    // Migration History Inspection
    if (inspectionData.hasMigrationTable) {
      console.log('\n─── Step 5: Prisma Migration History Audit ───');
      console.log(`Total Recorded Migrations: ${inspectionData.migrationRecords.length}`);
      for (const m of inspectionData.migrationRecords) {
        const isComplete = Boolean(m.finished_at && !m.rolled_back_at);
        const status = isComplete ? 'COMPLETED' : (m.rolled_back_at ? 'ROLLED_BACK' : 'FAILED / IN_PROGRESS');
        console.log(`- Migration: ${m.migration_name} | Status: ${status} | Steps: ${m.applied_steps_count} | Started: ${m.started_at}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('✓ Read-Only Staging Schema Inspection Completed Cleanly');
    console.log('═══════════════════════════════════════════════════════════════════');

    return {
      success: true,
      data: inspectionData
    };
  } catch (err) {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    console.error(`[FAIL CLOSED] Schema inspection query error: ${sanitizedMsg}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  inspectStagingSchema().catch((err) => {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    console.error(`[FATAL] Inspector execution failure: ${sanitizedMsg}`);
    process.exit(1);
  });
}

module.exports = {
  inspectStagingSchema,
  calculateChecksum
};
