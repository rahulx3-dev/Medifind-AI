/**
 * MediFind AI — Comprehensive Schema-Equivalence Audit Engine (Hardened)
 *
 * Strict read-only audit comparing live PostgreSQL schema on isolated Neon staging
 * against server/prisma/schema.prisma and baseline migration artifacts.
 *
 * SAFETY & SECURITY:
 * 1. Read-only transaction: SET TRANSACTION READ ONLY.
 * 2. Mandatory verifyStagingTarget() guardrail before any database or child process connection.
 * 3. Shell-free child process execution via execFileSync(process.execPath, args, { shell: false, env: controlledEnv }).
 * 4. Comprehensive output sanitization redacting credentials, URLs, and secrets.
 * 5. Accurate schema parsing handling @map, @@map, @@index, native types, and declared relation referential actions.
 * 6. Compares:
 *    - 19 application tables
 *    - Column types, nullability, defaults
 *    - Primary keys (single & composite, with column order)
 *    - Unique constraints & unique indexes (single & composite, with column order)
 *    - Secondary indexes (single & composite, with column order)
 *    - Foreign keys (source/target columns, onDelete, onUpdate, optionality)
 *    - Dual-validation with Prisma engine (prisma migrate diff --exit-code)
 *    - Migration history (_prisma_migrations)
 *    - Baseline artifact SHA-256 checksums
 * 7. Zero mutations, zero DDL, zero credential exposure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { execFileSync } = require('child_process');
const { PrismaClient, Prisma } = require('@prisma/client');
const { verifyStagingTarget, maskHost } = require('./verify_staging_target');

const SERVER_ROOT = path.resolve(__dirname, '..');
const STAGING_ENV_PATH = path.join(SERVER_ROOT, '.env.staging');
const PROD_ENV_PATH = path.join(SERVER_ROOT, '.env');
const SCHEMA_PRISMA_PATH = path.join(SERVER_ROOT, 'prisma', 'schema.prisma');
const BASELINE_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'baseline_init_review.sql');
const MIGRATION_SQL_PATH = path.join(SERVER_ROOT, 'prisma', 'migrations', '0_init', 'migration.sql');
const PRISMA_CLI_PATH = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const EXPECTED_CHECKSUM = 'E09DF7DEF0E6CCBA8358E347C1CADDAB858EF619867237D26977FF1C90B080C7';

/**
 * Strips sensitive connection strings, credentials, and query params from error messages and subprocess output.
 * @param {string} msg
 * @returns {string} Sanitized string
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'Unknown error occurred.';
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgresql://***:***@***/***')
    .replace(/(?:mysql|mongodb|redis):\/\/[^\s'"`]+/gi, '$1://***:***@***/***')
    .replace(/password=[^\s&'"`]+/gi, 'password=***')
    .replace(/user=[^\s&'"`]+/gi, 'user=***')
    .replace(/token=[^\s&'"`]+/gi, 'token=***')
    .replace(/api[-_]?key=[^\s&'"`]+/gi, 'api_key=***')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*/gi, 'Bearer ***');
}

function calculateSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File missing: ${path.basename(filePath)}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

/**
 * Parse secondary indexes (@@index) directly from schema.prisma.
 * Returns map of modelName -> array of { columns: string[], raw: string }
 */
function parseSchemaSecondaryIndexes(schemaContent) {
  const modelRegex = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;
  let match;
  const secondaryIndexes = {};

  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];
    secondaryIndexes[modelName] = [];

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('@@index')) continue;

      // Match @@index([col1, col2, ...])
      const indexMatch = trimmed.match(/@@index\(\s*\[([^\]]+)\]/);
      if (indexMatch) {
        const columns = indexMatch[1]
          .split(',')
          .map(c => c.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
        secondaryIndexes[modelName].push({
          columns,
          raw: trimmed
        });
      }
    }
  }

  return secondaryIndexes;
}

/**
 * Parse relation attributes (@relation) from schema.prisma to capture declared onDelete and onUpdate actions.
 * Returns map of modelName -> fieldName -> { onDelete, onUpdate, isExplicitDelete, isExplicitUpdate, error }
 */
function parseSchemaRelationAttributes(schemaContent) {
  const modelRegex = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;
  let match;
  const relations = {};

  const validActions = new Set(['CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT']);

  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];
    relations[modelName] = {};

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || !trimmed.includes('@relation')) continue;

      const parts = trimmed.split(/\s+/);
      const fieldName = parts[0];

      const relMatch = trimmed.match(/@relation\(([^)]+)\)/);
      if (relMatch) {
        const relArgs = relMatch[1];

        // Parse onDelete
        let onDelete = null;
        let isExplicitDelete = false;
        const deleteMatch = relArgs.match(/onDelete\s*:\s*(\w+)/);
        if (deleteMatch) {
          isExplicitDelete = true;
          let rawDel = deleteMatch[1].toUpperCase();
          if (rawDel === 'SETNULL') rawDel = 'SET NULL';
          if (rawDel === 'NOACTION') rawDel = 'NO ACTION';
          if (rawDel === 'SETDEFAULT') rawDel = 'SET DEFAULT';
          if (validActions.has(rawDel)) {
            onDelete = rawDel;
          } else {
            onDelete = 'UNSUPPORTED';
          }
        }

        // Parse onUpdate
        let onUpdate = null;
        let isExplicitUpdate = false;
        const updateMatch = relArgs.match(/onUpdate\s*:\s*(\w+)/);
        if (updateMatch) {
          isExplicitUpdate = true;
          let rawUpd = updateMatch[1].toUpperCase();
          if (rawUpd === 'SETNULL') rawUpd = 'SET NULL';
          if (rawUpd === 'NOACTION') rawUpd = 'NO ACTION';
          if (rawUpd === 'SETDEFAULT') rawUpd = 'SET DEFAULT';
          if (validActions.has(rawUpd)) {
            onUpdate = rawUpd;
          } else {
            onUpdate = 'UNSUPPORTED';
          }
        }

        relations[modelName][fieldName] = {
          onDelete,
          onUpdate,
          isExplicitDelete,
          isExplicitUpdate
        };
      }
    }
  }

  return relations;
}

/**
 * Parse native database type attributes (@db.*) and name mappings (@map, @@map) from schema.prisma.
 */
function parseSchemaFieldMeta(schemaContent) {
  const modelRegex = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;
  let match;
  const meta = {
    models: {},
    fields: {},
    hasUnsupportedNativeTypes: false,
    unsupportedNativeTypes: []
  };

  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];

    // Check @@map
    const modelMapMatch = body.match(/@@map\("([^"]+)"\)/);
    meta.models[modelName] = {
      dbName: modelMapMatch ? modelMapMatch[1] : modelName
    };

    meta.fields[modelName] = {};

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('@@') || !trimmed) continue;

      const parts = trimmed.split(/\s+/);
      const fieldName = parts[0];

      // Check @map
      const fieldMapMatch = trimmed.match(/@map\("([^"]+)"\)/);
      const dbColumnName = fieldMapMatch ? fieldMapMatch[1] : fieldName;

      // Check @db.<type>
      const dbTypeMatch = trimmed.match(/@db\.([A-Za-z0-9_]+)(?:\(([^)]+)\))?/);
      let nativeType = null;
      if (dbTypeMatch) {
        nativeType = dbTypeMatch[1];
        // Validate native types supported in standard comparison
        const supportedNative = ['VarChar', 'Text', 'Uuid', 'Timestamp', 'Timestamptz', 'Boolean', 'Integer', 'DoublePrecision', 'JsonB'];
        if (!supportedNative.includes(nativeType)) {
          meta.hasUnsupportedNativeTypes = true;
          meta.unsupportedNativeTypes.push(`${modelName}.${fieldName} (@db.${nativeType})`);
        }
      }

      meta.fields[modelName][fieldName] = {
        dbName: dbColumnName,
        nativeType
      };
    }
  }

  return meta;
}

/**
 * Normalize PostgreSQL column defaults for comparison with Prisma defaults.
 */
function normalizePostgresDefault(rawDefault) {
  if (rawDefault === null || rawDefault === undefined) return null;
  let d = String(rawDefault).trim();

  // Strip PostgreSQL type casts (e.g. 'VALUE'::text -> 'VALUE', 0::double precision -> 0)
  d = d.replace(/::[a-zA-Z0-9_ ]+(\[\])?/g, '');

  // Strip outer quotes if single-quoted string
  if (d.startsWith("'") && d.endsWith("'")) {
    d = d.slice(1, -1);
  }

  // Normalize now() and CURRENT_TIMESTAMP
  if (d === 'now()' || d === 'CURRENT_TIMESTAMP' || d.startsWith('CURRENT_TIMESTAMP')) {
    return 'now()';
  }

  return d;
}

/**
 * Compare Prisma default vs PostgreSQL default.
 */
function compareDefaults(prismaField, rawPgDefault) {
  const pgDefault = normalizePostgresDefault(rawPgDefault);

  if (!prismaField.hasDefaultValue) {
    if (rawPgDefault !== null) {
      return { match: false, reason: `Unexpected DB default "${rawPgDefault}" when Prisma has no default` };
    }
    return { match: true };
  }

  const pDef = prismaField.default;

  // Function defaults (e.g. now(), uuid())
  if (pDef && typeof pDef === 'object' && pDef.name) {
    if (pDef.name === 'now') {
      if (pgDefault === 'now()') return { match: true };
      return { match: false, reason: `Expected now() / CURRENT_TIMESTAMP, found "${rawPgDefault}"` };
    }
    if (pDef.name === 'uuid' || pDef.name.startsWith('uuid(')) {
      // In Prisma with PostgreSQL, uuid() defaults are generated client-side by Prisma Client.
      // Therefore, the PostgreSQL column does not have a DEFAULT clause.
      if (rawPgDefault === null) return { match: true };
      return { match: false, reason: `Expected client-side UUID default (null in DB), found "${rawPgDefault}"` };
    }
  }

  // Primitive defaults (string, number, boolean)
  if (typeof pDef === 'string' || typeof pDef === 'number' || typeof pDef === 'boolean') {
    const expectedStr = String(pDef);
    if (pgDefault === expectedStr) return { match: true };
    // Numeric equivalence (e.g. 0 vs 0.0)
    if (!isNaN(Number(expectedStr)) && !isNaN(Number(pgDefault))) {
      if (Number(expectedStr) === Number(pgDefault)) return { match: true };
    }
    // JSON array / object default strings
    if (expectedStr.startsWith('[') || expectedStr.startsWith('{')) {
      try {
        if (JSON.stringify(JSON.parse(expectedStr)) === JSON.stringify(JSON.parse(pgDefault))) {
          return { match: true };
        }
      } catch (_) {}
    }
    return { match: false, reason: `Expected default "${expectedStr}", found "${pgDefault}" (raw: "${rawPgDefault}")` };
  }

  return { match: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Comparison Helpers (Isolated & Unit-Testable)
// ─────────────────────────────────────────────────────────────────────────────

function compareTables(expectedTables, liveTables) {
  const expSet = new Set(expectedTables);
  const liveSet = new Set(liveTables);
  const missing = expectedTables.filter(t => !liveSet.has(t)).sort();
  const unexpected = liveTables.filter(t => !expSet.has(t)).sort();
  const mismatches = [];

  if (missing.length > 0) mismatches.push(`Missing tables: ${missing.join(', ')}`);
  if (unexpected.length > 0) mismatches.push(`Unexpected tables: ${unexpected.join(', ')}`);

  return {
    pass: mismatches.length === 0,
    expectedCount: expectedTables.length,
    liveCount: liveTables.length,
    missing,
    unexpected,
    mismatches
  };
}

function compareColumns(dmmfModels, liveColumns, schemaFieldMeta = {}) {
  const mismatches = [];
  const scalarTypeMap = {
    'String': ['text', 'character varying'],
    'Int': ['integer', 'serial'],
    'Float': ['double precision', 'real', 'numeric'],
    'Boolean': ['boolean'],
    'DateTime': ['timestamp without time zone', 'timestamp(3) without time zone', 'timestamp'],
    'Json': ['jsonb', 'json']
  };

  for (const model of dmmfModels) {
    const effectiveTableName = (schemaFieldMeta.models?.[model.name]?.dbName) || model.dbName || model.name;
    const liveCols = liveColumns.filter(c => c.table_name === effectiveTableName);
    const liveColMap = new Map(liveCols.map(c => [c.column_name, c]));

    const expectedScalarFields = model.fields.filter(f => f.kind === 'scalar' && !f.isList);
    const expectedColNames = new Set();

    for (const field of expectedScalarFields) {
      const effectiveColName = (schemaFieldMeta.fields?.[model.name]?.[field.name]?.dbName) || field.dbName || field.name;
      expectedColNames.add(effectiveColName);

      const liveCol = liveColMap.get(effectiveColName);
      if (!liveCol) {
        mismatches.push(`Missing column in live DB: ${effectiveTableName}.${effectiveColName}`);
        continue;
      }

      // Nullability
      const expectedNullable = !field.isRequired;
      const liveNullable = (liveCol.is_nullable === 'YES');
      if (expectedNullable !== liveNullable) {
        mismatches.push(
          `Nullability mismatch on ${effectiveTableName}.${effectiveColName}: Prisma isRequired=${field.isRequired}, DB is_nullable=${liveCol.is_nullable}`
        );
      }

      // Native type or Scalar Type check
      const fieldMeta = schemaFieldMeta.fields?.[model.name]?.[field.name];
      if (fieldMeta && fieldMeta.nativeType) {
        // Handled via native type
        const liveType = liveCol.data_type.toLowerCase();
        const expectedNative = fieldMeta.nativeType.toLowerCase();
        if (!liveType.includes(expectedNative)) {
          mismatches.push(
            `Native type mismatch on ${effectiveTableName}.${effectiveColName}: Prisma @db.${fieldMeta.nativeType}, DB data_type=${liveCol.data_type}`
          );
        }
      } else {
        const allowedTypes = scalarTypeMap[field.type] || [];
        const liveType = liveCol.data_type.toLowerCase();
        if (!allowedTypes.some(t => liveType.includes(t))) {
          mismatches.push(
            `Data type mismatch on ${effectiveTableName}.${effectiveColName}: Prisma type=${field.type}, DB data_type=${liveCol.data_type}`
          );
        }
      }

      // Default
      const defaultCheck = compareDefaults(field, liveCol.column_default);
      if (!defaultCheck.match) {
        mismatches.push(`Default mismatch on ${effectiveTableName}.${effectiveColName}: ${defaultCheck.reason}`);
      }
    }

    // Unexpected columns in DB
    for (const liveCol of liveCols) {
      if (!expectedColNames.has(liveCol.column_name)) {
        mismatches.push(`Unexpected extra column in DB: ${effectiveTableName}.${liveCol.column_name}`);
      }
    }
  }

  return {
    pass: mismatches.length === 0,
    mismatches
  };
}

function comparePrimaryKeys(dmmfModels, livePks, schemaFieldMeta = {}) {
  const mismatches = [];

  for (const model of dmmfModels) {
    const effectiveTableName = (schemaFieldMeta.models?.[model.name]?.dbName) || model.dbName || model.name;
    const actualPks = livePks
      .filter(p => p.table_name === effectiveTableName)
      .sort((a, b) => a.ordinal_position - b.ordinal_position)
      .map(p => p.column_name);

    let expectedPkCols = [];
    if (model.primaryKey && model.primaryKey.fields) {
      expectedPkCols = model.primaryKey.fields.map(
        fName => (schemaFieldMeta.fields?.[model.name]?.[fName]?.dbName) || fName
      );
    } else {
      const idField = model.fields.find(f => f.isId);
      if (idField) {
        expectedPkCols = [(schemaFieldMeta.fields?.[model.name]?.[idField.name]?.dbName) || idField.name];
      }
    }

    if (expectedPkCols.length === 0 && actualPks.length > 0) {
      mismatches.push(`Unexpected Primary Key on ${effectiveTableName}: [${actualPks.join(', ')}]`);
    } else if (expectedPkCols.length > 0 && actualPks.length === 0) {
      mismatches.push(`Missing Primary Key on ${effectiveTableName}: expected [${expectedPkCols.join(', ')}]`);
    } else {
      const colsMatch = expectedPkCols.length === actualPks.length &&
        expectedPkCols.every((c, i) => c === actualPks[i]);
      if (!colsMatch) {
        mismatches.push(
          `Primary Key mismatch on ${effectiveTableName}: expected [${expectedPkCols.join(', ')}], found [${actualPks.join(', ')}]`
        );
      }
    }
  }

  return {
    pass: mismatches.length === 0,
    mismatches
  };
}

function compareUniqueConstraints(dmmfModels, liveIndexes, schemaFieldMeta = {}) {
  const mismatches = [];

  for (const model of dmmfModels) {
    const effectiveTableName = (schemaFieldMeta.models?.[model.name]?.dbName) || model.dbName || model.name;

    const expectedUniques = [];
    for (const field of model.fields) {
      if (field.isUnique) {
        const colName = (schemaFieldMeta.fields?.[model.name]?.[field.name]?.dbName) || field.name;
        expectedUniques.push([colName]);
      }
    }
    if (model.uniqueFields && model.uniqueFields.length > 0) {
      for (const uf of model.uniqueFields) {
        const mappedUf = uf.map(fName => (schemaFieldMeta.fields?.[model.name]?.[fName]?.dbName) || fName);
        expectedUniques.push([...mappedUf]);
      }
    }

    const liveUniques = liveIndexes.filter(
      idx => idx.table_name === effectiveTableName && idx.is_unique && !idx.is_primary
    );

    // Verify every expected unique constraint exists in exact order
    for (const expCols of expectedUniques) {
      const expStr = expCols.join(', ');
      const matched = liveUniques.find(
        idx => idx.columns && idx.columns.length === expCols.length &&
          idx.columns.every((c, i) => c === expCols[i])
      );

      if (!matched) {
        mismatches.push(`Missing Unique Constraint on ${effectiveTableName}: [${expStr}]`);
      }
    }

    // Verify no unexpected unique indexes exist
    for (const liveIdx of liveUniques) {
      const liveCols = liveIdx.columns || [];
      const isExpected = expectedUniques.some(
        expCols => expCols.length === liveCols.length && expCols.every((c, i) => c === liveCols[i])
      );
      if (!isExpected) {
        mismatches.push(
          `Unexpected Unique Index on ${effectiveTableName}: ${liveIdx.index_name} [${liveCols.join(', ')}]`
        );
      }
    }
  }

  return {
    pass: mismatches.length === 0,
    mismatches
  };
}

function compareSecondaryIndexes(expectedSecondaryIndexesByModel, liveIndexes, schemaFieldMeta = {}) {
  const mismatches = [];

  const allModelNames = Object.keys(expectedSecondaryIndexesByModel);
  for (const modelName of allModelNames) {
    const effectiveTableName = (schemaFieldMeta.models?.[modelName]?.dbName) || modelName;
    const expectedSecIndexes = expectedSecondaryIndexesByModel[modelName] || [];

    const liveSecIndexes = liveIndexes.filter(
      idx => idx.table_name === effectiveTableName && !idx.is_unique && !idx.is_primary
    );

    // Verify every expected index exists in exact column order
    for (const expIdx of expectedSecIndexes) {
      const expCols = expIdx.columns.map(
        cName => (schemaFieldMeta.fields?.[modelName]?.[cName]?.dbName) || cName
      );
      const matched = liveSecIndexes.find(
        liveIdx => liveIdx.columns && liveIdx.columns.length === expCols.length &&
          liveIdx.columns.every((c, i) => c === expCols[i])
      );

      if (!matched) {
        mismatches.push(
          `Missing Secondary Index on ${effectiveTableName}: [${expCols.join(', ')}]`
        );
      }
    }

    // Verify no unexpected secondary indexes exist
    for (const liveIdx of liveSecIndexes) {
      const liveCols = liveIdx.columns || [];
      const isExpected = expectedSecIndexes.some(exp => {
        const mappedExpCols = exp.columns.map(
          cName => (schemaFieldMeta.fields?.[modelName]?.[cName]?.dbName) || cName
        );
        return mappedExpCols.length === liveCols.length &&
          mappedExpCols.every((c, i) => c === liveCols[i]);
      });
      if (!isExpected) {
        mismatches.push(
          `Unexpected Secondary Index on ${effectiveTableName}: ${liveIdx.index_name} [${liveCols.join(', ')}]`
        );
      }
    }
  }

  return {
    pass: mismatches.length === 0,
    mismatches
  };
}

function compareForeignKeys(expectedFks, liveForeignKeys) {
  const mismatches = [];
  const matchedLiveFkNames = new Set();

  for (const expFk of expectedFks) {
    const matched = liveForeignKeys.find(liveFk => {
      if (liveFk.from_table !== expFk.fromTable) return false;
      if (liveFk.to_table !== expFk.toTable) return false;
      if (!liveFk.from_columns || liveFk.from_columns.length !== expFk.fromCols.length) return false;
      if (!liveFk.to_columns || liveFk.to_columns.length !== expFk.toCols.length) return false;
      const fromMatch = expFk.fromCols.every((c, i) => c === liveFk.from_columns[i]);
      const toMatch = expFk.toCols.every((c, i) => c === liveFk.to_columns[i]);
      return fromMatch && toMatch;
    });

    if (!matched) {
      mismatches.push(
        `Missing Foreign Key: ${expFk.fromTable}([${expFk.fromCols.join(', ')}]) -> ${expFk.toTable}([${expFk.toCols.join(', ')}])`
      );
    } else {
      matchedLiveFkNames.add(matched.constraint_name);
      if (matched.delete_rule !== expFk.expectedDelete) {
        mismatches.push(
          `Foreign Key onDelete mismatch on ${matched.constraint_name} (${expFk.fromTable} -> ${expFk.toTable}): expected ${expFk.expectedDelete}, found ${matched.delete_rule}`
        );
      }
      if (matched.update_rule !== expFk.expectedUpdate) {
        mismatches.push(
          `Foreign Key onUpdate mismatch on ${matched.constraint_name} (${expFk.fromTable} -> ${expFk.toTable}): expected ${expFk.expectedUpdate}, found ${matched.update_rule}`
        );
      }
    }
  }

  // Check unexpected live foreign keys
  for (const liveFk of liveForeignKeys) {
    if (!matchedLiveFkNames.has(liveFk.constraint_name)) {
      mismatches.push(
        `Unexpected Foreign Key: ${liveFk.constraint_name} (${liveFk.from_table} -> ${liveFk.to_table})`
      );
    }
  }

  return {
    pass: mismatches.length === 0,
    expectedCount: expectedFks.length,
    liveCount: liveForeignKeys.length,
    mismatches
  };
}

/**
 * Pure evaluation helper for prisma migrate diff output and exit codes.
 */
function evaluateDiffResult(diffResult) {
  const mismatches = [];
  if (!diffResult || typeof diffResult.exitCode !== 'number') {
    return {
      pass: false,
      inSync: false,
      mismatches: ['Prisma migrate diff result missing or invalid.']
    };
  }

  if (diffResult.exitCode === 0 && diffResult.inSync) {
    return {
      pass: true,
      inSync: true,
      mismatches: []
    };
  }

  if (diffResult.exitCode === 2) {
    mismatches.push(`Prisma engine detected schema divergence:\n${diffResult.diffOutput}`);
    return {
      pass: false,
      inSync: false,
      mismatches
    };
  }

  mismatches.push(`prisma migrate diff failed to execute (exit code ${diffResult.exitCode}): ${diffResult.diffOutput}`);
  return {
    pass: false,
    inSync: false,
    mismatches
  };
}

/**
 * Executes prisma migrate diff using a shell-free child process (execFileSync) with a controlled environment.
 * Accepts optional options.execFileSync for dependency injection during offline tests.
 */
function runPrismaMigrateDiff(unpooledUrl, options = {}) {
  const serverRoot = options.serverRoot || SERVER_ROOT;
  const prismaCliPath = options.prismaCliPath || PRISMA_CLI_PATH;
  const schemaPath = options.schemaPath || SCHEMA_PRISMA_PATH;
  const execFn = options.execFileSync || execFileSync;

  // Controlled, minimal environment without ambient pollution
  const controlledEnv = {
    PATH: process.env.PATH || '',
    SYSTEMROOT: process.env.SYSTEMROOT || '',
    TEMP: process.env.TEMP || '',
    TMP: process.env.TMP || '',
    USERPROFILE: process.env.USERPROFILE || '',
    HOMEDRIVE: process.env.HOMEDRIVE || '',
    HOMEPATH: process.env.HOMEPATH || '',
    APPDATA: process.env.APPDATA || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    DATABASE_URL: unpooledUrl,
    DATABASE_URL_UNPOOLED: unpooledUrl,
    NODE_ENV: 'production'
  };

  const args = [
    prismaCliPath,
    'migrate',
    'diff',
    '--from-url',
    unpooledUrl,
    '--to-schema-datamodel',
    schemaPath,
    '--exit-code'
  ];

  try {
    const stdout = execFn(process.execPath, args, {
      cwd: serverRoot,
      env: controlledEnv,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      timeout: 30000
    });

    const sanitizedOutput = sanitizeErrorMessage(stdout.trim());
    return {
      exitCode: 0,
      diffOutput: sanitizedOutput,
      inSync: true
    };
  } catch (err) {
    const exitCode = typeof err.status === 'number' ? err.status : 1;
    const rawOutput = ((err.stdout || '') + '\n' + (err.stderr || '')).trim() || err.message || '';
    const sanitizedOutput = sanitizeErrorMessage(rawOutput);

    return {
      exitCode,
      diffOutput: sanitizedOutput,
      inSync: exitCode === 0
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Audit Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function runSchemaEquivalenceAudit(options = {}) {
  const silent = Boolean(options.silent);
  const log = (...args) => { if (!silent) console.log(...args); };
  const warn = (...args) => { if (!silent) console.warn(...args); };
  const error = (...args) => { if (!silent) console.error(...args); };

  log('═══════════════════════════════════════════════════════════════════');
  log('  MediFind AI — Phase 0 Schema-Equivalence Audit Engine (Hardened)');
  log('═══════════════════════════════════════════════════════════════════');

  const auditReport = {
    verdict: 'INCOMPLETE',
    checksumVerification: null,
    stagingGuardrail: null,
    prismaMigrateDiff: null,
    tableEquivalence: null,
    columnEquivalence: null,
    primaryKeyEquivalence: null,
    uniqueConstraintEquivalence: null,
    secondaryIndexEquivalence: null,
    foreignKeyEquivalence: null,
    migrationHistoryAudit: null,
    mismatches: []
  };

  // 1. Baseline File Checksums & Byte-Identity
  log('\n─── Step 1: Baseline Artifact Integrity & Checksums ───');
  const b1 = fs.readFileSync(BASELINE_SQL_PATH);
  const b2 = fs.readFileSync(MIGRATION_SQL_PATH);
  const hash1 = crypto.createHash('sha256').update(b1).digest('hex').toUpperCase();
  const hash2 = crypto.createHash('sha256').update(b2).digest('hex').toUpperCase();
  const byteIdentical = b1.equals(b2);
  const hashMatches = (hash1 === EXPECTED_CHECKSUM && hash2 === EXPECTED_CHECKSUM);

  auditReport.checksumVerification = {
    byteIdentical,
    hash1,
    hash2,
    expectedHash: EXPECTED_CHECKSUM,
    pass: byteIdentical && hashMatches
  };

  if (!auditReport.checksumVerification.pass) {
    auditReport.mismatches.push('Baseline SQL artifacts failed checksum verification or byte-identity check.');
    log(`[FAIL] Checksum mismatch. Expected: ${EXPECTED_CHECKSUM}`);
  } else {
    log(`✓ Baseline artifacts verified byte-identical and match SHA-256: ${EXPECTED_CHECKSUM}`);
  }

  // 2. Guardrails & Connection Configuration
  log('\n─── Step 2: Staging Target Guardrail Verification ───');
  const targetCheck = verifyStagingTarget({
    stagingEnvPath: STAGING_ENV_PATH,
    prodEnvPath: PROD_ENV_PATH,
    silent: true
  });

  auditReport.stagingGuardrail = {
    pass: targetCheck.success,
    error: targetCheck.error || null
  };

  if (!targetCheck.success) {
    auditReport.mismatches.push(`Staging target guardrail failed: ${targetCheck.error}`);
    log(`[FAIL] Staging target guardrail rejected: ${targetCheck.error}`);
    auditReport.verdict = 'FAIL';
    return auditReport;
  }
  log(`✓ Staging Target Guardrail: PASSED (${maskHost(targetCheck.details?.stagingHost || 'staging')})`);

  const parsedStagingEnv = dotenv.parse(fs.readFileSync(STAGING_ENV_PATH, 'utf8'));
  const unpooledUrl = parsedStagingEnv.STAGING_DATABASE_URL_UNPOOLED;

  // 3. Engine-Level Dual Check: prisma migrate diff via shell-free child process
  log('\n─── Step 3: Prisma Engine Schema Diff (prisma migrate diff via execFileSync) ───');
  const diffResult = runPrismaMigrateDiff(unpooledUrl, options);
  auditReport.prismaMigrateDiff = diffResult;
  const evaluatedDiff = evaluateDiffResult(diffResult);

  if (evaluatedDiff.pass) {
    log('✓ prisma migrate diff exited with code 0: No difference detected.');
  } else {
    auditReport.mismatches.push(...evaluatedDiff.mismatches);
    if (diffResult.exitCode === 2) {
      warn(`[DIFF DETECTED] prisma migrate diff returned exit code 2:\n${diffResult.diffOutput}`);
    } else {
      warn(`[DIFF ERROR] prisma migrate diff execution error: ${diffResult.exitCode}`);
    }
  }

  // 4. Detailed Object-Level Catalog Comparison
  log('\n─── Step 4: Extracting PostgreSQL Catalog in Read-Only Transaction ───');
  const prisma = new PrismaClient({
    datasources: { db: { url: unpooledUrl } },
    log: ['error']
  });

  try {
    await prisma.$connect();

    const catalog = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY;');

      // Base Tables
      const tables = await tx.$queryRawUnsafe(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);

      // Columns
      const columns = await tx.$queryRawUnsafe(`
        SELECT 
          table_name,
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `);

      // Primary Keys with ordinal position
      const pks = await tx.$queryRawUnsafe(`
        SELECT
          tc.table_name,
          kcu.column_name,
          kcu.ordinal_position,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.ordinal_position;
      `);

      // Indexes (with exact ordered column array using unnest WITH ORDINALITY)
      const indexes = await tx.$queryRawUnsafe(`
        SELECT
          t.relname AS table_name,
          i.relname AS index_name,
          ix.indisunique AS is_unique,
          ix.indisprimary AS is_primary,
          ARRAY_TO_STRING(ARRAY_AGG(a.attname ORDER BY k.ord), ', ') AS column_names_str,
          ARRAY_AGG(a.attname ORDER BY k.ord) AS columns
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public'
          AND t.relkind = 'r'
        GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary
        ORDER BY t.relname, i.relname;
      `);

      // Foreign Keys with source/target columns and referential actions
      const foreignKeys = await tx.$queryRawUnsafe(`
        SELECT
          c.conname AS constraint_name,
          src_tbl.relname AS from_table,
          ARRAY_AGG(src_att.attname ORDER BY k.ord) AS from_columns,
          dst_tbl.relname AS to_table,
          ARRAY_AGG(dst_att.attname ORDER BY k.ord) AS to_columns,
          CASE c.confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE c.confdeltype::text
          END AS delete_rule,
          CASE c.confupdtype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE c.confupdtype::text
          END AS update_rule
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        JOIN pg_class src_tbl ON src_tbl.oid = c.conrelid
        JOIN pg_class dst_tbl ON dst_tbl.oid = c.confrelid
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute src_att ON src_att.attrelid = c.conrelid AND src_att.attnum = k.attnum
        JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS kf(attnum, ord) ON kf.ord = k.ord
        JOIN pg_attribute dst_att ON dst_att.attrelid = c.confrelid AND dst_att.attnum = kf.attnum
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
        GROUP BY c.conname, src_tbl.relname, dst_tbl.relname, c.confdeltype, c.confupdtype
        ORDER BY src_tbl.relname, c.conname;
      `);

      // Migration Records
      const migrations = await tx.$queryRawUnsafe(`
        SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
        FROM public._prisma_migrations
        ORDER BY started_at ASC;
      `);

      return { tables, columns, pks, indexes, foreignKeys, migrations };
    });

    log('✓ Catalog extraction in read-only transaction completed successfully.');

    // 5. Parse Schema via Prisma DMMF + Schema File Meta
    const schemaContent = fs.readFileSync(SCHEMA_PRISMA_PATH, 'utf8');
    const dmmfModels = Prisma.dmmf.datamodel.models;
    const secondaryIndexesByModel = parseSchemaSecondaryIndexes(schemaContent);
    const relationAttributesByModel = parseSchemaRelationAttributes(schemaContent);
    const schemaFieldMeta = parseSchemaFieldMeta(schemaContent);

    // If schema contains unhandled native types, report INCOMPLETE
    if (schemaFieldMeta.hasUnsupportedNativeTypes) {
      const err = `Schema contains unsupported native @db types: ${schemaFieldMeta.unsupportedNativeTypes.join(', ')}`;
      auditReport.mismatches.push(err);
      auditReport.verdict = 'INCOMPLETE';
      warn(`[INCOMPLETE] ${err}`);
      return auditReport;
    }

    // --- 5A. Table Equivalence ---
    log('\n─── Step 5: Checking Table Equivalence ───');
    const expectedModelTableNames = dmmfModels.map(
      m => (schemaFieldMeta.models?.[m.name]?.dbName) || m.dbName || m.name
    ).sort();
    const liveAppTables = catalog.tables
      .map(t => t.table_name)
      .filter(t => t !== '_prisma_migrations')
      .sort();

    const tableComp = compareTables(expectedModelTableNames, liveAppTables);
    auditReport.tableEquivalence = tableComp;

    if (!tableComp.pass) {
      auditReport.mismatches.push(...tableComp.mismatches);
    } else {
      log(`✓ All ${expectedModelTableNames.length} tables present with zero missing/unexpected tables.`);
    }

    // --- 5B. Columns, Types, Nullability, Defaults ---
    log('\n─── Step 6: Checking Columns, Data Types, Nullability & Defaults ───');
    const colComp = compareColumns(dmmfModels, catalog.columns, schemaFieldMeta);
    auditReport.columnEquivalence = colComp;

    if (!colComp.pass) {
      auditReport.mismatches.push(...colComp.mismatches);
      warn(`[MISMATCH] ${colComp.mismatches.length} column/type/nullability/default discrepancies detected.`);
    } else {
      log('✓ All columns, PostgreSQL types, nullability, and defaults match Prisma specifications.');
    }

    // --- 5C. Primary Keys (Handling composite PK & column ordering) ---
    log('\n─── Step 7: Checking Primary Keys (Single & Composite) ───');
    const pkComp = comparePrimaryKeys(dmmfModels, catalog.pks, schemaFieldMeta);
    auditReport.primaryKeyEquivalence = pkComp;

    if (!pkComp.pass) {
      auditReport.mismatches.push(...pkComp.mismatches);
      warn(`[MISMATCH] Primary key discrepancies: ${pkComp.mismatches.join('; ')}`);
    } else {
      log('✓ All 19 Primary Keys match with exact column order.');
    }

    // --- 5D. Unique Constraints & Unique Indexes ---
    log('\n─── Step 8: Checking Unique Constraints & Unique Indexes ───');
    const uniqueComp = compareUniqueConstraints(dmmfModels, catalog.indexes, schemaFieldMeta);
    auditReport.uniqueConstraintEquivalence = uniqueComp;

    if (!uniqueComp.pass) {
      auditReport.mismatches.push(...uniqueComp.mismatches);
      warn(`[MISMATCH] Unique constraint discrepancies: ${uniqueComp.mismatches.join('; ')}`);
    } else {
      log('✓ All unique constraints and indexes match with exact composite column order.');
    }

    // --- 5E. Secondary (Non-Unique) Indexes ---
    log('\n─── Step 9: Checking Secondary (Non-Unique) Indexes ───');
    const secComp = compareSecondaryIndexes(secondaryIndexesByModel, catalog.indexes, schemaFieldMeta);
    auditReport.secondaryIndexEquivalence = secComp;

    if (!secComp.pass) {
      auditReport.mismatches.push(...secComp.mismatches);
      warn(`[MISMATCH] Secondary index discrepancies: ${secComp.mismatches.join('; ')}`);
    } else {
      log('✓ All secondary indexes match with exact column order.');
    }

    // --- 5F. Foreign Keys & Referential Actions ---
    log('\n─── Step 10: Checking Foreign Keys & Referential Actions ───');
    const expectedFks = [];

    for (const model of dmmfModels) {
      const fromTable = (schemaFieldMeta.models?.[model.name]?.dbName) || model.dbName || model.name;

      for (const field of model.fields) {
        if (field.kind === 'object' && field.relationFromFields && field.relationFromFields.length > 0) {
          const fromCols = field.relationFromFields.map(
            fName => (schemaFieldMeta.fields?.[model.name]?.[fName]?.dbName) || fName
          );
          const toModel = dmmfModels.find(m => m.name === field.type);
          const toTable = toModel
            ? ((schemaFieldMeta.models?.[toModel.name]?.dbName) || toModel.dbName || toModel.name)
            : field.type;
          const toCols = field.relationToFields.map(
            fName => (toModel && schemaFieldMeta.fields?.[toModel.name]?.[fName]?.dbName) || fName
          );

          // Referential Actions from parsed schema attributes with fallback to Prisma PostgreSQL semantics
          const declaredRel = relationAttributesByModel[model.name]?.[field.name];

          let expectedDelete = 'RESTRICT';
          if (declaredRel && declaredRel.onDelete) {
            if (declaredRel.onDelete === 'UNSUPPORTED') {
              auditReport.mismatches.push(`Unsupported onDelete action declared on ${model.name}.${field.name}`);
              auditReport.verdict = 'INCOMPLETE';
              return auditReport;
            }
            expectedDelete = declaredRel.onDelete;
          } else if (field.relationOnDelete) {
            let dmmfDel = field.relationOnDelete.toUpperCase();
            if (dmmfDel === 'SETNULL') dmmfDel = 'SET NULL';
            expectedDelete = dmmfDel;
          } else {
            // Prisma default: SET NULL if optional column, RESTRICT if required column
            const isOptional = field.relationFromFields.some(colName => {
              const scalarField = model.fields.find(f => f.name === colName);
              return scalarField && !scalarField.isRequired;
            });
            expectedDelete = isOptional ? 'SET NULL' : 'RESTRICT';
          }

          let expectedUpdate = 'CASCADE';
          if (declaredRel && declaredRel.onUpdate) {
            if (declaredRel.onUpdate === 'UNSUPPORTED') {
              auditReport.mismatches.push(`Unsupported onUpdate action declared on ${model.name}.${field.name}`);
              auditReport.verdict = 'INCOMPLETE';
              return auditReport;
            }
            expectedUpdate = declaredRel.onUpdate;
          }

          expectedFks.push({
            fromTable,
            fromCols,
            toTable,
            toCols,
            expectedDelete,
            expectedUpdate
          });
        }
      }
    }

    const fkComp = compareForeignKeys(expectedFks, catalog.foreignKeys);
    auditReport.foreignKeyEquivalence = fkComp;

    if (!fkComp.pass) {
      auditReport.mismatches.push(...fkComp.mismatches);
      warn(`[MISMATCH] Foreign key discrepancies: ${fkComp.mismatches.join('; ')}`);
    } else {
      log(`✓ All ${expectedFks.length} foreign keys match source/target columns and referential actions.`);
    }

    // --- 5G. Migration Tracking History ---
    log('\n─── Step 11: Checking _prisma_migrations Status ───');
    const active0Init = catalog.migrations.find(
      m => m.migration_name === '0_init' && m.finished_at !== null && m.rolled_back_at === null && m.applied_steps_count === 1
    );

    auditReport.migrationHistoryAudit = {
      totalRecords: catalog.migrations.length,
      active0InitFound: Boolean(active0Init),
      records: catalog.migrations,
      pass: Boolean(active0Init)
    };

    if (!active0Init) {
      auditReport.mismatches.push('Active 0_init record missing or unfinished in _prisma_migrations.');
      warn('[MISMATCH] Active 0_init record not found in _prisma_migrations.');
    } else {
      log('✓ Active 0_init migration record verified in _prisma_migrations.');
    }

    // Final Verdict Computation
    const allChecksPass =
      auditReport.checksumVerification.pass &&
      auditReport.stagingGuardrail.pass &&
      (auditReport.prismaMigrateDiff ? auditReport.prismaMigrateDiff.inSync : false) &&
      auditReport.tableEquivalence.pass &&
      auditReport.columnEquivalence.pass &&
      auditReport.primaryKeyEquivalence.pass &&
      auditReport.uniqueConstraintEquivalence.pass &&
      auditReport.secondaryIndexEquivalence.pass &&
      auditReport.foreignKeyEquivalence.pass &&
      auditReport.migrationHistoryAudit.pass &&
      auditReport.mismatches.length === 0;

    auditReport.verdict = allChecksPass ? 'PASS' : 'FAIL';

    log('\n═══════════════════════════════════════════════════════════════════');
    log(`  AUDIT VERDICT: ${auditReport.verdict}`);
    log(`  Total Mismatches Detected: ${auditReport.mismatches.length}`);
    log('═══════════════════════════════════════════════════════════════════');

    return auditReport;
  } catch (err) {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    error(`[AUDIT INCOMPLETE / ERROR] Catalog inspection error: ${sanitizedMsg}`);
    auditReport.verdict = 'INCOMPLETE';
    auditReport.mismatches.push(`Audit terminated with error: ${sanitizedMsg}`);
    return auditReport;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runSchemaEquivalenceAudit().then(report => {
    if (report.verdict !== 'PASS') {
      process.exit(1);
    }
    process.exit(0);
  }).catch(err => {
    console.error(`[FATAL] Audit execution failed: ${sanitizeErrorMessage(err.message)}`);
    process.exit(1);
  });
}

module.exports = {
  runSchemaEquivalenceAudit,
  runPrismaMigrateDiff,
  evaluateDiffResult,
  parseSchemaSecondaryIndexes,
  parseSchemaRelationAttributes,
  parseSchemaFieldMeta,
  normalizePostgresDefault,
  compareDefaults,
  compareTables,
  compareColumns,
  comparePrimaryKeys,
  compareUniqueConstraints,
  compareSecondaryIndexes,
  compareForeignKeys,
  sanitizeErrorMessage
};
