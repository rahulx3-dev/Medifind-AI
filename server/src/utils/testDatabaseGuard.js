/**
 * MediFind AI — Test Database Safety Guard (Hardened)
 *
 * CRITICAL SAFETY ENFORCEMENT:
 * 1. Strictly prevents any integration test or migration script from running against production or staging.
 * 2. Requires explicit TEST_DATABASE_URL; NEVER falls back to DATABASE_URL or STAGING_DATABASE_URL.
 * 3. Enforces anti-collision checks: rejects any URL matching known production or staging endpoints.
 * 4. Enforces positive identification: rejects unknown, ambiguous, or unverified database targets.
 *    (A database is never treated as disposable based only on its name).
 * 5. Fails closed with descriptive, sanitized error messages (never logs secrets, credentials, or full URLs).
 */

'use strict';

const url = require('url');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const KNOWN_PROTECTED_HOST_PATTERNS = [
  'ep-weathered-mouse-a751mmhd', // Production Neon Endpoint
  'ep-damp-hat-az9wh7zr'         // Staging Neon Endpoint
];

const LOCAL_DISPOSABLE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal'
]);

const DISALLOWED_REMOTE_HOST_KEYWORDS = new Set([
  'neon.tech',
  'aws.neon.tech',
  'aws',
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'replace_locally',
  'example.com',
  'test',
  'staging',
  'production'
]);

const DEFAULT_PROD_ENV_PATH = path.resolve(__dirname, '../../.env');
const DEFAULT_STAGING_ENV_PATH = path.resolve(__dirname, '../../.env.staging');
const DEFAULT_TEST_LOCAL_ENV_PATH = path.resolve(__dirname, '../../.env.test.local');

const AUTHORIZED_LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1'
]);

const REQUIRED_DISPOSABLE_DB_NAME = 'medifind_disposable_test';
const REQUIRED_DISPOSABLE_PORT = 5432;

/**
 * Evaluates whether two URLs independently resolve to the exact same authorized
 * local disposable test endpoint (strict loopback host, port 5432, and medifind_disposable_test).
 * Returns false if either URL targets any other database, port, or remote/unauthorized host.
 */
function isSameAuthorizedLocalTestEndpoint(urlA, urlB) {
  if (!urlA || !urlB) return false;

  const hostA = (urlA.hostname || '').toLowerCase();
  const hostB = (urlB.hostname || '').toLowerCase();
  if (!AUTHORIZED_LOOPBACK_HOSTS.has(hostA) || !AUTHORIZED_LOOPBACK_HOSTS.has(hostB) || hostA !== hostB) {
    return false;
  }

  const portA = Number(urlA.port || 5432);
  const portB = Number(urlB.port || 5432);
  if (portA !== REQUIRED_DISPOSABLE_PORT || portB !== REQUIRED_DISPOSABLE_PORT) {
    return false;
  }

  const dbA = (urlA.pathname || '').replace(/^\//, '').split('?')[0].trim();
  const dbB = (urlB.pathname || '').replace(/^\//, '').split('?')[0].trim();
  if (dbA !== REQUIRED_DISPOSABLE_DB_NAME || dbB !== REQUIRED_DISPOSABLE_DB_NAME) {
    return false;
  }

  return true;
}

/**
 * Masks hostnames to prevent leaking full identifiers or credentials.
 * E.g. "ep-weathered-mouse-a751mmhd.aws.neon.tech" -> "ep-wea***neon.tech"
 */
function maskHost(host) {
  if (!host || typeof host !== 'string') return '[empty]';
  if (host.length <= 10) return host.slice(0, 3) + '***';
  return host.slice(0, 6) + '***' + host.slice(-8);
}

/**
 * Safely extracts hostnames from environment files if present.
 */
function extractHostsFromEnvFile(filePath, varNames = []) {
  const hosts = [];
  if (!fs.existsSync(filePath)) return hosts;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = dotenv.parse(content);
    for (const v of varNames) {
      if (parsed[v]) {
        try {
          const u = new url.URL(parsed[v]);
          if (u.hostname) hosts.push(u.hostname.toLowerCase());
        } catch (_) {}
      }
    }
  } catch (_) {}
  return hosts;
}

/**
 * Validates that the provided connection string is safe for disposable testing.
 *
 * @param {string} [customUrl] - Connection string to validate (defaults to process.env.TEST_DATABASE_URL or .env.test.local)
 * @param {object} [options] - Optional verification configuration
 * @param {string} [options.expectedHostKeyword] - Expected host keyword for positive identification
 * @param {string} [options.testLocalEnvPath] - Custom path to .env.test.local
 * @param {string} [options.prodEnvPath] - Custom path to .env (production)
 * @param {string} [options.stagingEnvPath] - Custom path to .env.staging
 * @returns {{ isSafe: boolean, maskedHost: string, identityType?: string, error?: string }}
 */
function assertSafeTestDatabase(customUrl, options = {}) {
  let targetUrl = customUrl || process.env.TEST_DATABASE_URL;
  let expectedKeyword = (options.expectedHostKeyword || process.env.EXPECTED_TEST_HOST_KEYWORD || '').toLowerCase().trim();

  // If no targetUrl is set in memory, attempt reading strictly from .env.test.local
  const testLocalPath = options.testLocalEnvPath || DEFAULT_TEST_LOCAL_ENV_PATH;
  if ((!targetUrl || targetUrl.trim() === '') && fs.existsSync(testLocalPath)) {
    try {
      const localContent = fs.readFileSync(testLocalPath, 'utf8');
      const parsedLocal = dotenv.parse(localContent);
      if (parsedLocal.TEST_DATABASE_URL) {
        targetUrl = parsedLocal.TEST_DATABASE_URL;
      }
      if (!expectedKeyword && parsedLocal.EXPECTED_TEST_HOST_KEYWORD) {
        expectedKeyword = parsedLocal.EXPECTED_TEST_HOST_KEYWORD.toLowerCase().trim();
      }
    } catch (_) {}
  }

  // Check 1: Fail closed if targetUrl is missing — STRICTLY NO FALLBACK to DATABASE_URL or STAGING_DATABASE_URL
  if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    const errorMsg = '[FAIL CLOSED] TEST_DATABASE_URL is not set. Real PostgreSQL integration tests cannot run without an explicitly configured disposable test database. Fallback to DATABASE_URL or STAGING_DATABASE_URL is strictly prohibited.';
    return { isSafe: false, maskedHost: '[none]', error: errorMsg };
  }

  // Check 2: Parse URL format
  let parsed;
  try {
    parsed = new url.URL(targetUrl);
  } catch (err) {
    return { isSafe: false, maskedHost: '[invalid]', error: `[FAIL CLOSED] TEST_DATABASE_URL is not a valid URL: ${err.message}` };
  }

  // Check 3: Enforce PostgreSQL protocol
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { isSafe: false, maskedHost: '[invalid-protocol]', error: `[FAIL CLOSED] TEST_DATABASE_URL must use postgresql: protocol, received: ${parsed.protocol}` };
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  const masked = maskHost(hostname);

  // Check 4: Reject placeholder credentials
  if (parsed.username === 'user' && (parsed.password === 'password' || parsed.password === 'pass')) {
    const errorMsg = `[FAIL CLOSED] TEST_DATABASE_URL contains placeholder credentials ("user:password"). A valid disposable target is required.`;
    return { isSafe: false, maskedHost: masked, error: errorMsg };
  }

  // Check 5: Anti-collision against known production and staging host identifiers
  for (const pattern of KNOWN_PROTECTED_HOST_PATTERNS) {
    if (hostname.includes(pattern.toLowerCase())) {
      const errorMsg = `[CRITICAL SAFETY VIOLATION] Target host (${masked}) matches protected pattern "${pattern}". Refusing to execute tests against protected environment.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }
  }

  // Check 6: Anti-collision against process.env.DATABASE_URL (Production)
  if (process.env.DATABASE_URL) {
    let prodParsed;
    try {
      prodParsed = new url.URL(process.env.DATABASE_URL);
    } catch (err) {
      return {
        isSafe: false,
        maskedHost: masked,
        error: `[FAIL CLOSED] DATABASE_URL is set but is not a valid URL: ${err.message}`
      };
    }

    const prodHost = (prodParsed.hostname || '').toLowerCase();
    if (prodHost && hostname === prodHost) {
      const isAllowedSameEndpoint = isSameAuthorizedLocalTestEndpoint(parsed, prodParsed);
      if (!isAllowedSameEndpoint) {
        const errorMsg = `[CRITICAL SAFETY VIOLATION] TEST_DATABASE_URL host (${masked}) matches DATABASE_URL host. Refusing to execute tests against production environment.`;
        return { isSafe: false, maskedHost: masked, error: errorMsg };
      }
    }
  }

  // Check 7: Anti-collision against process.env.STAGING_DATABASE_URL (Staging)
  if (process.env.STAGING_DATABASE_URL) {
    let stagingParsed;
    try {
      stagingParsed = new url.URL(process.env.STAGING_DATABASE_URL);
    } catch (err) {
      return {
        isSafe: false,
        maskedHost: masked,
        error: `[FAIL CLOSED] STAGING_DATABASE_URL is set but is not a valid URL: ${err.message}`
      };
    }

    const stagingHost = (stagingParsed.hostname || '').toLowerCase();
    if (stagingHost && hostname === stagingHost) {
      const isAllowedSameEndpoint = isSameAuthorizedLocalTestEndpoint(parsed, stagingParsed);
      if (!isAllowedSameEndpoint) {
        const errorMsg = `[CRITICAL SAFETY VIOLATION] TEST_DATABASE_URL host (${masked}) matches STAGING_DATABASE_URL host. Refusing to execute tests against staging environment.`;
        return { isSafe: false, maskedHost: masked, error: errorMsg };
      }
    }
  }

  // Check 8: Anti-collision against .env files on disk (even if env vars were not loaded into process.env)
  const prodFilePath = options.prodEnvPath || DEFAULT_PROD_ENV_PATH;
  const prodFileHosts = extractHostsFromEnvFile(prodFilePath, ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']);
  for (const pfHost of prodFileHosts) {
    if (hostname === pfHost || (pfHost && hostname.includes(pfHost))) {
      const errorMsg = `[CRITICAL SAFETY VIOLATION] TEST_DATABASE_URL host (${masked}) matches production host in .env file. Refusing to execute tests against production environment.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }
  }

  const stagingFilePath = options.stagingEnvPath || DEFAULT_STAGING_ENV_PATH;
  const stagingFileHosts = extractHostsFromEnvFile(stagingFilePath, ['STAGING_DATABASE_URL', 'STAGING_DATABASE_URL_UNPOOLED']);
  for (const sfHost of stagingFileHosts) {
    if (hostname === sfHost || (sfHost && hostname.includes(sfHost))) {
      const errorMsg = `[CRITICAL SAFETY VIOLATION] TEST_DATABASE_URL host (${masked}) matches staging host in .env.staging file. Refusing to execute tests against staging environment.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }
  }

  // Check 9: Positive Identification & Host Identity Verification
  // Rule: Do NOT treat a database as disposable based only on its database name in pathname.
  // A verified hostname match confirms configuration intent only; it does NOT independently prove remote branch isolation or disposability.
  const isLocalHost = LOCAL_DISPOSABLE_HOSTS.has(hostname);
  let isPositivelyIdentified = false;
  let identityType = '';

  if (isLocalHost) {
    if (expectedKeyword && expectedKeyword !== 'replace_locally' && hostname !== expectedKeyword && expectedKeyword !== 'localhost') {
      const errorMsg = `[FAIL CLOSED] Target local host (${masked}) does not match explicit EXPECTED_TEST_HOST_KEYWORD "${expectedKeyword}".`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }
    isPositivelyIdentified = true;
    identityType = 'LOCAL_LOOPBACK';
  } else {
    // Remote host verification: strictly eliminate broad substring matching
    if (!expectedKeyword || expectedKeyword === 'replace_locally') {
      const errorMsg = `[FAIL CLOSED] Remote database target (${masked}) requires an explicit, strictly validated EXPECTED_TEST_HOST_KEYWORD.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }

    if (DISALLOWED_REMOTE_HOST_KEYWORDS.has(expectedKeyword) || expectedKeyword.length < 5) {
      const errorMsg = `[CRITICAL SAFETY VIOLATION] Broad, generic, or loopback keyword "${expectedKeyword}" is rejected for remote host authorization. Remote test targets require an exact hostname match.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }

    // Require exact hostname match against expected host identity
    const matchesExact = hostname === expectedKeyword || (expectedKeyword.startsWith('ep-') && hostname === `${expectedKeyword}.aws.neon.tech`);
    if (!matchesExact) {
      const errorMsg = `[FAIL CLOSED] Target remote host (${masked}) does not exactly match expected host identity "${expectedKeyword}". Substring matching is prohibited.`;
      return { isSafe: false, maskedHost: masked, error: errorMsg };
    }

    isPositivelyIdentified = true;
    identityType = 'EXACT_REMOTE_HOST_MATCH';
  }

  if (!isPositivelyIdentified) {
    const errorMsg = `[FAIL CLOSED] Unknown or ambiguous database identity: Target host (${masked}) cannot be positively identified as the intended disposable test database. It is not an authorized local disposable target (localhost/127.0.0.1) and does not match any configured EXPECTED_TEST_HOST_KEYWORD. Do not treat a database as disposable based only on its name.`;
    return { isSafe: false, maskedHost: masked, error: errorMsg };
  }

  return {
    isSafe: true,
    maskedHost: masked,
    identityType,
    disclaimer: 'Hostname match verifies configured identity only; it does not prove remote branch isolation or disposability.',
    resolvedUrl: targetUrl
  };
}

/**
 * Creates a PrismaClient instance explicitly bound to the validated TEST_DATABASE_URL.
 * Throws immediately if the guard fails. NEVER falls back to DATABASE_URL or STAGING_DATABASE_URL.
 */
function createSafeTestPrismaClient(options = {}) {
  const guard = assertSafeTestDatabase(options.customUrl, options);
  if (!guard.isSafe) {
    const err = new Error(guard.error);
    err.code = 'UNSAFE_TEST_DATABASE';
    throw err;
  }

  const resolvedUrl = guard.resolvedUrl || options.customUrl || process.env.TEST_DATABASE_URL;
  if (!resolvedUrl || typeof resolvedUrl !== 'string' || resolvedUrl.trim() === '') {
    const err = new Error('[FAIL CLOSED] Resolved test database URL is empty. Refusing to construct PrismaClient without explicit datasources URL.');
    err.code = 'UNSAFE_TEST_DATABASE';
    throw err;
  }

  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({
    datasources: {
      db: { url: resolvedUrl }
    }
  });
}

/**
 * Returns the validated TEST_DATABASE_URL or throws.
 */
function getSafeTestDatabaseUrl(options = {}) {
  const guard = assertSafeTestDatabase(options.customUrl, options);
  if (!guard.isSafe) {
    const err = new Error(guard.error);
    err.code = 'UNSAFE_TEST_DATABASE';
    throw err;
  }
  return guard.resolvedUrl || options.customUrl || process.env.TEST_DATABASE_URL;
}

module.exports = {
  assertSafeTestDatabase,
  maskHost,
  createSafeTestPrismaClient,
  getSafeTestDatabaseUrl,
  KNOWN_PROTECTED_HOST_PATTERNS,
  AUTHORIZED_LOOPBACK_HOSTS,
  REQUIRED_DISPOSABLE_DB_NAME,
  REQUIRED_DISPOSABLE_PORT,
  isSameAuthorizedLocalTestEndpoint
};
