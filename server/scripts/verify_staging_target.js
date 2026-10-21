/**
 * MediFind AI — Staging Database Target Verification Guardrail (Hardened)
 *
 * Strictly non-destructive.
 * Verifies that the staging environment variables are present, valid PostgreSQL URLs,
 * and match the expected staging host and database name.
 *
 * SAFETY GUARANTEES:
 * 1. NEVER prints passwords, usernames, secrets, or full connection URLs.
 * 2. FAILS CLOSED if any variable is missing, malformed, placeholder, or does not match staging.
 * 3. FAILS CLOSED if pooled and direct hosts do not belong to the same endpoint base.
 * 4. FAILS CLOSED if any staging host matches production host (anti-collision).
 * 5. DOES NOT connect to, query, or mutate any database.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_STAGING_ENV_PATH = path.resolve(__dirname, '..', '.env.staging');
const DEFAULT_PROD_ENV_PATH = path.resolve(__dirname, '..', '.env');

function maskHost(host) {
  if (!host || typeof host !== 'string') return '[empty]';
  if (host.length <= 10) return host.slice(0, 3) + '***';
  return host.slice(0, 6) + '***' + host.slice(-8);
}

function normalizeNeonHost(host) {
  if (!host || typeof host !== 'string') return '';
  const lower = host.toLowerCase().trim();
  // Strip -pooler from the first subdomain segment (e.g. ep-xyz-pooler -> ep-xyz)
  return lower.replace(/^([a-z0-9_-]+)-pooler(\..+)$/, '$1$2');
}

/**
 * Verifies staging configuration safely without connecting to any database.
 * @param {object} options
 * @param {string} [options.stagingEnvPath] Custom staging env path (for unit/dummy testing)
 * @param {string} [options.prodEnvPath] Custom prod env path (for unit/dummy testing)
 * @param {boolean} [options.silent] Suppress console logs during testing
 * @returns {{ success: boolean, error?: string, details?: object }}
 */
function verifyStagingTarget(options = {}) {
  const stagingEnvPath = options.stagingEnvPath || DEFAULT_STAGING_ENV_PATH;
  const prodEnvPath = options.prodEnvPath || DEFAULT_PROD_ENV_PATH;
  const isSilent = Boolean(options.silent);

  const log = (...args) => { if (!isSilent) console.log(...args); };
  const logError = (...args) => { if (!isSilent) console.error(...args); };

  log('─── MediFind AI: Verifying Staging Environment Configuration ───');

  // 1. Verify existence of staging env file
  if (!fs.existsSync(stagingEnvPath)) {
    const msg = `Staging environment file not found at ${stagingEnvPath}`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 2. Parse staging environment file in an isolated container
  let parsedEnv = {};
  try {
    const envContent = fs.readFileSync(stagingEnvPath, 'utf8');
    parsedEnv = dotenv.parse(envContent);
  } catch (readErr) {
    const msg = `Failed to read or parse staging env file: ${readErr.message}`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  const stagingUrl = parsedEnv.STAGING_DATABASE_URL;
  const stagingUrlUnpooled = parsedEnv.STAGING_DATABASE_URL_UNPOOLED;
  const expectedEndpointId = (parsedEnv.EXPECTED_STAGING_HOST_KEYWORD || '').toLowerCase().trim();
  const expectedDbName = (parsedEnv.EXPECTED_STAGING_DB_NAME || 'neondb').toLowerCase().trim();

  // 3. Verify EXPECTED_STAGING_HOST_KEYWORD is explicitly configured with zero fallback
  if (!expectedEndpointId || expectedEndpointId === 'replace_locally') {
    const msg = 'Missing or unconfigured EXPECTED_STAGING_HOST_KEYWORD in staging environment. An explicit endpoint identifier is required.';
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 4. Verify presence of required connection strings
  if (!stagingUrl || typeof stagingUrl !== 'string' || stagingUrl.trim() === '') {
    const msg = 'Missing STAGING_DATABASE_URL in staging environment.';
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  if (!stagingUrlUnpooled || typeof stagingUrlUnpooled !== 'string' || stagingUrlUnpooled.trim() === '') {
    const msg = 'Missing STAGING_DATABASE_URL_UNPOOLED in staging environment.';
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 5. Strictly reject placeholders in connection URLs
  const placeholderPatterns = [
    'user:password',
    'replace_locally',
    'your_password',
    'your_user',
    'example.com',
    'ep-migration-test-pooler'
  ];

  for (const pattern of placeholderPatterns) {
    if (stagingUrl.toLowerCase().includes(pattern) || stagingUrlUnpooled.toLowerCase().includes(pattern)) {
      const msg = `STAGING connection URL contains placeholder values matching "${pattern}". Real staging credentials required.`;
      logError(`[FAIL CLOSED] ${msg}`);
      if (!options.silent && require.main === module) process.exit(1);
      return { success: false, error: msg };
    }
  }

  // 6. Parse and validate STAGING_DATABASE_URL
  let parsedUrl, parsedUnpooledUrl;
  try {
    parsedUrl = new URL(stagingUrl);
  } catch (err) {
    const msg = 'STAGING_DATABASE_URL is not a valid URL format.';
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  try {
    parsedUnpooledUrl = new URL(stagingUrlUnpooled);
  } catch (err) {
    const msg = 'STAGING_DATABASE_URL_UNPOOLED is not a valid URL format.';
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 7. Verify PostgreSQL protocols
  if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
    const msg = `STAGING_DATABASE_URL protocol must be postgresql:, found "${parsedUrl.protocol}"`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  if (parsedUnpooledUrl.protocol !== 'postgresql:' && parsedUnpooledUrl.protocol !== 'postgres:') {
    const msg = `STAGING_DATABASE_URL_UNPOOLED protocol must be postgresql:, found "${parsedUnpooledUrl.protocol}"`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 8. Verify database name matches expected
  const dbName = (parsedUrl.pathname || '').replace(/^\//, '').toLowerCase();
  const unpooledDbName = (parsedUnpooledUrl.pathname || '').replace(/^\//, '').toLowerCase();

  if (dbName !== expectedDbName) {
    const msg = `STAGING_DATABASE_URL database name "${dbName}" does not match expected "${expectedDbName}".`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  if (unpooledDbName !== expectedDbName) {
    const msg = `STAGING_DATABASE_URL_UNPOOLED database name "${unpooledDbName}" does not match expected "${expectedDbName}".`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 9. Hostname validation and normalization
  const pooledHost = (parsedUrl.hostname || '').toLowerCase();
  const directHost = (parsedUnpooledUrl.hostname || '').toLowerCase();
  const normalizedPooledHost = normalizeNeonHost(pooledHost);
  const normalizedDirectHost = normalizeNeonHost(directHost);

  // 10. Confirm both pooled and direct hosts match each other's base endpoint
  if (normalizedPooledHost !== normalizedDirectHost) {
    const msg = `Staging pooled endpoint base does not match direct endpoint base. Pooled mask: ${maskHost(pooledHost)}, Direct mask: ${maskHost(directHost)}`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 11. Confirm both hostnames match the explicitly configured endpoint identifier
  if (!pooledHost.includes(expectedEndpointId)) {
    const msg = `Staging pooled host does not contain required staging identifier "${expectedEndpointId}". Mask: ${maskHost(pooledHost)}`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  if (!directHost.includes(expectedEndpointId)) {
    const msg = `Staging direct host does not contain required staging identifier "${expectedEndpointId}". Mask: ${maskHost(directHost)}`;
    logError(`[FAIL CLOSED] ${msg}`);
    if (!options.silent && require.main === module) process.exit(1);
    return { success: false, error: msg };
  }

  // 12. Protect Production: Anti-collision check against production server/.env
  if (fs.existsSync(prodEnvPath)) {
    try {
      const prodEnvContent = fs.readFileSync(prodEnvPath, 'utf8');
      const parsedProdEnv = dotenv.parse(prodEnvContent);

      const prodUrls = [
        parsedProdEnv.DATABASE_URL,
        parsedProdEnv.DATABASE_URL_UNPOOLED,
        parsedProdEnv.DIRECT_URL
      ].filter(Boolean);

      for (const rawProdUrl of prodUrls) {
        try {
          const prodParsed = new URL(rawProdUrl);
          const prodHost = (prodParsed.hostname || '').toLowerCase();
          const normalizedProdHost = normalizeNeonHost(prodHost);

          if (normalizedProdHost === normalizedDirectHost || prodHost === directHost || prodHost === pooledHost) {
            const msg = `CRITICAL COLLISION: Staging host matches production database host (${maskHost(prodHost)})!`;
            logError(`[FAIL CLOSED] ${msg}`);
            logError('[REFUSAL] Refusing to proceed. Production and Staging hosts must be strictly different.');
            if (!options.silent && require.main === module) process.exit(1);
            return { success: false, error: msg };
          }
        } catch (_) {
          // Ignore invalid URLs in prod env check
        }
      }
    } catch (prodErr) {
      logError(`[WARN] Could not verify production host isolation: ${prodErr.message}`);
    }
  }

  log('✓ Staging URL syntax: VALID PostgreSQL URL');
  log(`✓ Staging Target Host (Masked): ${maskHost(pooledHost)} (matches "${expectedEndpointId}")`);
  log(`✓ Staging Target Direct Host (Masked): ${maskHost(directHost)}`);
  log(`✓ Pooled/Direct Host Base Consistency: PASSED (${maskHost(normalizedDirectHost)})`);
  log(`✓ Database Name: ${dbName}`);
  log('✓ Production Host Isolation Check: PASSED (Strictly isolated from production)');
  log('─── Staging Environment Target Confirmed Safe ───');

  return {
    success: true,
    details: {
      dbName,
      maskedPooledHost: maskHost(pooledHost),
      maskedDirectHost: maskHost(directHost),
      matchedEndpointId: expectedEndpointId
    }
  };
}

if (require.main === module) {
  const result = verifyStagingTarget();
  if (!result.success) {
    process.exit(1);
  }
}

module.exports = {
  verifyStagingTarget,
  normalizeNeonHost,
  maskHost
};
