/**
 * MediFind AI — Test Database Safety Guard Offline Test Suite
 *
 * Runs non-destructive synthetic tests entirely offline without connecting to any database.
 * Verifies all 5 mandatory safety requirements:
 * 1. Missing test URL rejection (fail closed)
 * 2. Production URL rejection (anti-collision)
 * 3. Staging URL rejection (anti-collision)
 * 4. Acceptance of dedicated test target (positive identification)
 * 5. Unknown or ambiguous database identity rejection (positive identification)
 * 6. Zero fallback to DATABASE_URL or STAGING_DATABASE_URL
 * 7. Rejection of placeholder credentials
 * 8. Rejection of invalid protocols
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { assertSafeTestDatabase, maskHost, createSafeTestPrismaClient } = require('../src/utils/testDatabaseGuard');

const TEMP_DIR = path.resolve(__dirname, '..', 'scratch');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let passedChecks = 0;
let totalChecks = 0;

function reportCheck(title, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ PASS: ${title}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  ✗ FAIL: ${title}${detail ? ` (${detail})` : ''}`);
    throw new Error(`Guard test assertion failed: ${title}`);
  }
}

async function runOfflineGuardTests() {
  console.log('================================================================');
  console.log('MediFind AI — Test Database Safety Guard Offline Test Suite');
  console.log('================================================================\n');

  // Preserve original environment
  const originalTestDbUrl = process.env.TEST_DATABASE_URL;
  const originalProdDbUrl = process.env.DATABASE_URL;
  const originalStagingDbUrl = process.env.STAGING_DATABASE_URL;
  const originalKeyword = process.env.EXPECTED_TEST_HOST_KEYWORD;

  try {
    // -------------------------------------------------------------
    // Test 1: Missing Test URL (Fails Closed)
    // -------------------------------------------------------------
    console.log('--- Test 1: Missing Test URL (Fail-Closed) ---');
    delete process.env.TEST_DATABASE_URL;

    // With zero env and no custom URL
    const res1a = assertSafeTestDatabase(undefined, { testLocalEnvPath: '/nonexistent/path' });
    reportCheck('Rejects undefined TEST_DATABASE_URL', res1a.isSafe === false);
    reportCheck('Error message mentions fail-closed missing variable',
      res1a.error.includes('[FAIL CLOSED] TEST_DATABASE_URL is not set'));

    // With empty string
    const res1b = assertSafeTestDatabase('', { testLocalEnvPath: '/nonexistent/path' });
    reportCheck('Rejects empty string TEST_DATABASE_URL', res1b.isSafe === false);

    // With whitespace-only string
    const res1c = assertSafeTestDatabase('   ', { testLocalEnvPath: '/nonexistent/path' });
    reportCheck('Rejects whitespace TEST_DATABASE_URL', res1c.isSafe === false);

    // -------------------------------------------------------------
    // Test 2: Production URL Rejection (Anti-Collision)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Production URL Rejection (Anti-Collision) ---');

    // Case 2a: Direct Neon production pattern
    const prodNeonUrl = 'postgresql://medifind_owner:secretpass@ep-weathered-mouse-a751mmhd-pooler.ap-southeast-1.aws.neon.tech/neondb';
    const res2a = assertSafeTestDatabase(prodNeonUrl);
    reportCheck('Rejects direct production Neon URL pattern', res2a.isSafe === false);
    reportCheck('Error message flags critical safety violation', res2a.error.includes('[CRITICAL SAFETY VIOLATION]'));
    reportCheck('Host is masked in error message', res2a.error.includes(res2a.maskedHost) && !res2a.error.includes('secretpass'));

    // Case 2b: Collision with DATABASE_URL in process.env (remote collision rejected)
    process.env.DATABASE_URL = 'postgresql://user:pass@production-db-instance.amazonaws.com:5432/medifind';
    const res2b = assertSafeTestDatabase('postgresql://otheruser:otherpass@production-db-instance.amazonaws.com:5432/testdb');
    reportCheck('Rejects TEST_DATABASE_URL colliding with process.env.DATABASE_URL host', res2b.isSafe === false);
    reportCheck('Error message explains DATABASE_URL collision', res2b.error.includes('matches DATABASE_URL host'));

    // Case 2c: Malformed DATABASE_URL fails closed
    process.env.DATABASE_URL = 'not-a-valid-connection-url';
    const res2cMalformed = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Malformed process.env.DATABASE_URL fails closed', res2cMalformed.isSafe === false && res2cMalformed.error.includes('DATABASE_URL is set but is not a valid URL'));

    // Case 2d: Same validated local disposable endpoint in DATABASE_URL is permitted
    process.env.DATABASE_URL = 'postgresql://postgres:pass@localhost:5432/medifind_disposable_test';
    const res2dSameEndpoint = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Permits identical validated local disposable endpoint in process.env.DATABASE_URL', res2dSameEndpoint.isSafe === true);

    // Case 2e: Same local host but different database in DATABASE_URL is rejected
    process.env.DATABASE_URL = 'postgresql://postgres:pass@localhost:5432/medifind_production';
    const res2eDiffDb = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Rejects same local host with different database in process.env.DATABASE_URL', res2eDiffDb.isSafe === false && res2eDiffDb.error.includes('matches DATABASE_URL host'));

    // Case 2f: Same local host but different port in DATABASE_URL is rejected
    process.env.DATABASE_URL = 'postgresql://postgres:pass@localhost:5433/medifind_disposable_test';
    const res2fDiffPort = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Rejects same local host with different port in process.env.DATABASE_URL', res2fDiffPort.isSafe === false && res2fDiffPort.error.includes('matches DATABASE_URL host'));

    delete process.env.DATABASE_URL;

    // Case 2g: Collision with production host in .env file
    const dummyProdEnvFile = path.join(TEMP_DIR, `dummy_prod_${Date.now()}.env`);
    fs.writeFileSync(dummyProdEnvFile, 'DATABASE_URL="postgresql://produser:pass@ep-prod-file-host.neon.tech/prod"', 'utf8');
    const res2g = assertSafeTestDatabase('postgresql://testuser:pass@ep-prod-file-host.neon.tech/test', {
      prodEnvPath: dummyProdEnvFile
    });
    reportCheck('Rejects collision with production host found in .env file on disk', res2g.isSafe === false);
    reportCheck('Error specifies .env file match', res2g.error.includes('in .env file'));
    if (fs.existsSync(dummyProdEnvFile)) fs.unlinkSync(dummyProdEnvFile);

    // -------------------------------------------------------------
    // Test 3: Staging URL Rejection (Anti-Collision)
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Staging URL Rejection (Anti-Collision) ---');

    // Case 3a: Direct Neon staging pattern
    const stagingNeonUrl = 'postgresql://medifind_staging:secretpass@ep-damp-hat-az9wh7zr.ap-southeast-1.aws.neon.tech/neondb';
    const res3a = assertSafeTestDatabase(stagingNeonUrl);
    reportCheck('Rejects direct staging Neon URL pattern', res3a.isSafe === false);
    reportCheck('Error message flags critical safety violation for staging', res3a.error.includes('[CRITICAL SAFETY VIOLATION]'));

    // Case 3b: Collision with STAGING_DATABASE_URL in process.env (remote collision rejected)
    process.env.STAGING_DATABASE_URL = 'postgresql://staging_user:pass@staging-db-instance.amazonaws.com:5432/staging_db';
    const res3b = assertSafeTestDatabase('postgresql://test_user:pass@staging-db-instance.amazonaws.com:5432/test_db');
    reportCheck('Rejects TEST_DATABASE_URL colliding with process.env.STAGING_DATABASE_URL host', res3b.isSafe === false);
    reportCheck('Error message explains STAGING_DATABASE_URL collision', res3b.error.includes('matches STAGING_DATABASE_URL host'));

    // Case 3c: Malformed STAGING_DATABASE_URL fails closed
    process.env.STAGING_DATABASE_URL = 'not-a-valid-staging-url';
    const res3cMalformed = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Malformed process.env.STAGING_DATABASE_URL fails closed', res3cMalformed.isSafe === false && res3cMalformed.error.includes('STAGING_DATABASE_URL is set but is not a valid URL'));

    // Case 3d: Same validated local disposable endpoint in STAGING_DATABASE_URL is permitted
    process.env.STAGING_DATABASE_URL = 'postgresql://postgres:pass@localhost:5432/medifind_disposable_test';
    const res3dSameEndpoint = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Permits identical validated local disposable endpoint in process.env.STAGING_DATABASE_URL', res3dSameEndpoint.isSafe === true);

    // Case 3e: Same local host but different database in STAGING_DATABASE_URL is rejected
    process.env.STAGING_DATABASE_URL = 'postgresql://postgres:pass@localhost:5432/medifind_staging';
    const res3eDiffDb = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Rejects same local host with different database in process.env.STAGING_DATABASE_URL', res3eDiffDb.isSafe === false && res3eDiffDb.error.includes('matches STAGING_DATABASE_URL host'));

    // Case 3f: Same local host but different port in STAGING_DATABASE_URL is rejected
    process.env.STAGING_DATABASE_URL = 'postgresql://postgres:pass@localhost:5433/medifind_disposable_test';
    const res3fDiffPort = assertSafeTestDatabase('postgresql://postgres:pass@localhost:5432/medifind_disposable_test');
    reportCheck('Rejects same local host with different port in process.env.STAGING_DATABASE_URL', res3fDiffPort.isSafe === false && res3fDiffPort.error.includes('matches STAGING_DATABASE_URL host'));

    delete process.env.STAGING_DATABASE_URL;

    // Case 3g: Collision with staging host in .env.staging file
    const dummyStagingEnvFile = path.join(TEMP_DIR, `dummy_staging_${Date.now()}.env`);
    fs.writeFileSync(dummyStagingEnvFile, 'STAGING_DATABASE_URL="postgresql://stg:pass@ep-staging-file-host.neon.tech/stg"', 'utf8');
    const res3g = assertSafeTestDatabase('postgresql://testuser:pass@ep-staging-file-host.neon.tech/test', {
      stagingEnvPath: dummyStagingEnvFile
    });
    reportCheck('Rejects collision with staging host found in .env.staging file on disk', res3g.isSafe === false);
    reportCheck('Error specifies .env.staging file match', res3g.error.includes('in .env.staging file'));
    if (fs.existsSync(dummyStagingEnvFile)) fs.unlinkSync(dummyStagingEnvFile);

    // -------------------------------------------------------------
    // Test 4: Acceptance of Dedicated Test Target
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Acceptance of Dedicated Test Target (Positive Identification) ---');

    // Case 4a: Localhost disposable database
    const validLocalUrl = 'postgresql://postgres:localpassword@localhost:5432/medifind_disposable_test';
    const res4a = assertSafeTestDatabase(validLocalUrl, { expectedHostKeyword: 'localhost' });
    reportCheck('Accepts authorized local disposable PostgreSQL target', res4a.isSafe === true);
    reportCheck('Identity type classified as LOCAL_LOOPBACK', res4a.identityType === 'LOCAL_LOOPBACK');
    reportCheck('Masked host is sanitized', res4a.maskedHost.startsWith('loc'));

    // Case 4b: 127.0.0.1 loopback target
    const validLoopbackUrl = 'postgresql://postgres:localpassword@127.0.0.1:5432/medifind_disposable_test';
    const res4b = assertSafeTestDatabase(validLoopbackUrl);
    reportCheck('Accepts 127.0.0.1 loopback disposable target', res4b.isSafe === true);

    // Case 4c: Explicit keyword match for dedicated ephemeral cloud branch
    const dedicatedCloudUrl = 'postgresql://ephem_user:pass123@ep-disposable-ephemeral-test.aws.neon.tech/test_db';
    const res4c = assertSafeTestDatabase(dedicatedCloudUrl, {
      expectedHostKeyword: 'ep-disposable-ephemeral-test'
    });
    reportCheck('Accepts positively identified test target when explicit keyword matches', res4c.isSafe === true);
    reportCheck('Identity type classified as EXACT_REMOTE_HOST_MATCH', res4c.identityType === 'EXACT_REMOTE_HOST_MATCH');

    // -------------------------------------------------------------
    // Test 5: Unknown or Ambiguous Database Identity Rejection
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Unknown or Ambiguous Database Identity Rejection ---');

    // Case 5a: Arbitrary cloud database without matching keyword
    const unknownCloudUrl = 'postgresql://user:pass123@ep-random-cloud-instance.aws.neon.tech/some_db';
    const res5a = assertSafeTestDatabase(unknownCloudUrl);
    reportCheck('Rejects unknown/unverified cloud database without keyword', res5a.isSafe === false);
    reportCheck('Error message explains unknown/ambiguous identity',
      res5a.error.includes('[FAIL CLOSED] Unknown or ambiguous database identity') ||
      res5a.error.includes('requires an explicit, strictly validated EXPECTED_TEST_HOST_KEYWORD'));

    // Case 5b: Rejection of database named "test" or "disposable" on arbitrary remote host
    // Rule: "Do not treat a database as disposable based only on its name"
    const remoteNamedTestUrl = 'postgresql://admin:secret@untrusted-remote-server.com:5432/disposable_test_database';
    const res5b = assertSafeTestDatabase(remoteNamedTestUrl);
    reportCheck('Rejects untrusted remote server even if database name is "disposable_test_database"',
      res5b.isSafe === false);
    reportCheck('Error explicitly confirms database name alone does not prove disposability',
      res5b.error.includes('Do not treat a database as disposable based only on its name') ||
      res5b.error.includes('requires an explicit, strictly validated EXPECTED_TEST_HOST_KEYWORD'));

    // Case 5c: Mismatched expected keyword
    const mismatchedKeywordUrl = 'postgresql://user:pass@ep-isolated-branch-alpha.neon.tech/test';
    const res5c = assertSafeTestDatabase(mismatchedKeywordUrl, {
      expectedHostKeyword: 'ep-isolated-branch-beta'
    });
    reportCheck('Rejects target when host does not match configured EXPECTED_TEST_HOST_KEYWORD', res5c.isSafe === false);

    // -------------------------------------------------------------
    // Test 6: Zero Fallback Verification
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Zero Fallback to DATABASE_URL or STAGING_DATABASE_URL ---');
    process.env.DATABASE_URL = 'postgresql://prod_user:secret@ep-weathered-mouse-a751mmhd.neon.tech/prod';
    process.env.STAGING_DATABASE_URL = 'postgresql://stg_user:secret@ep-damp-hat-az9wh7zr.neon.tech/staging';
    delete process.env.TEST_DATABASE_URL;

    const res6 = assertSafeTestDatabase(undefined, { testLocalEnvPath: '/nonexistent/path' });
    reportCheck('Never falls back to DATABASE_URL when TEST_DATABASE_URL is absent', res6.isSafe === false);
    reportCheck('Error explicitly states fallback to DATABASE_URL or STAGING_DATABASE_URL is prohibited',
      res6.error.includes('Fallback to DATABASE_URL or STAGING_DATABASE_URL is strictly prohibited'));

    // -------------------------------------------------------------
    // Test 7: Placeholder Credentials Rejection
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Placeholder Credentials Rejection ---');
    const placeholderUrl = 'postgresql://user:password@localhost:5432/test';
    const res7 = assertSafeTestDatabase(placeholderUrl);
    reportCheck('Rejects placeholder credentials ("user:password")', res7.isSafe === false);
    reportCheck('Error message mentions placeholder credentials', res7.error.includes('placeholder credentials'));

    // -------------------------------------------------------------
    // Test 8: Invalid Protocol & Malformed URLs
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Invalid Protocol & Malformed URLs ---');
    const invalidProtoUrl = 'mysql://localhost:3306/test';
    const res8a = assertSafeTestDatabase(invalidProtoUrl);
    reportCheck('Rejects non-postgresql protocol', res8a.isSafe === false);

    const malformedUrl = 'not-a-valid-connection-string';
    const res8b = assertSafeTestDatabase(malformedUrl);
    reportCheck('Rejects malformed connection string', res8b.isSafe === false);

    // -------------------------------------------------------------
    // Test 9: createSafeTestPrismaClient Fail-Closed Guarantee
    // -------------------------------------------------------------
    console.log('\n--- Test 9: createSafeTestPrismaClient Fail-Closed Guarantee ---');
    let threwExpectedError = false;
    try {
      createSafeTestPrismaClient({ customUrl: prodNeonUrl });
    } catch (e) {
      threwExpectedError = true;
      reportCheck('createSafeTestPrismaClient throws on unsafe production target',
        e.code === 'UNSAFE_TEST_DATABASE' && e.message.includes('[CRITICAL SAFETY VIOLATION]'));
    }
    reportCheck('createSafeTestPrismaClient did not return or connect on unsafe target', threwExpectedError);

    console.log('\n================================================================');
    console.log(`Guard Offline Results: ${passedChecks} Passed, 0 Failed out of ${totalChecks} checks`);
    console.log('================================================================');
  } finally {
    // Restore environment
    if (originalTestDbUrl !== undefined) process.env.TEST_DATABASE_URL = originalTestDbUrl;
    else delete process.env.TEST_DATABASE_URL;

    if (originalProdDbUrl !== undefined) process.env.DATABASE_URL = originalProdDbUrl;
    else delete process.env.DATABASE_URL;

    if (originalStagingDbUrl !== undefined) process.env.STAGING_DATABASE_URL = originalStagingDbUrl;
    else delete process.env.STAGING_DATABASE_URL;

    if (originalKeyword !== undefined) process.env.EXPECTED_TEST_HOST_KEYWORD = originalKeyword;
    else delete process.env.EXPECTED_TEST_HOST_KEYWORD;
  }
}

runOfflineGuardTests().catch(err => {
  console.error('Fatal error in guard test suite:', err);
  process.exit(1);
});
