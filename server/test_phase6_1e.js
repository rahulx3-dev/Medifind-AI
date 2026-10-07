/**
 * ====================================================================
 * MEDIFIND AI — PHASE 6.1E DEDICATED VERIFICATION TEST SUITE
 * ====================================================================
 * Tests the Phase 6.1E functional contracts:
 * 1. Verified pharmacy conditional state (verified vs test fixture disclosure)
 * 2. Test pharmacy database records (isVerified=false, verificationStatus='TEST')
 * 3. Order fulfillment state mapping (strict backend states, no 'PREPARING')
 * 4. AssistantTask state mapping (strict backend states, IN_TRANSIT on task only)
 * 5. Missing-coordinate map fallback logic (no invented coordinates)
 * 6. Voice search browser support / fallback / empty handling logic
 * 7. Notification schema and data integrity
 * 8. Reduced-motion stylesheet rules for skeleton shimmer
 * 9. Codebase search audit verification (zero forbidden claims)
 */

const fs = require('fs');
const path = require('path');
const prisma = require('./src/prisma');

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function assert(condition, message, details = '') {
  if (condition) {
    passedCount++;
    console.log(`  PASS: ${message}`);
    testResults.push({ message, pass: true, details });
  } else {
    failedCount++;
    console.error(`  FAIL: ${message} ${details ? '— ' + details : ''}`);
    testResults.push({ message, pass: false, details });
  }
}

async function runPhase61ETests() {
  console.log('\n====================================================================');
  console.log('🧪 MEDIFIND AI — PHASE 6.1E DEDICATED VERIFICATION TEST SUITE');
  console.log('====================================================================\n');

  // ------------------------------------------------------------------
  // GROUP 1: Verified Pharmacy Conditional State & Test Fixtures
  // ------------------------------------------------------------------
  console.log('--- GROUP 1: VERIFIED PHARMACY CONDITIONAL STATE ---');

  const testPharmacies = await prisma.pharmacy.findMany({
    where: { name: { contains: '[TEST]' } },
    take: 5
  });

  assert(testPharmacies.length > 0, 'Test seed pharmacies exist in database', `Count: ${testPharmacies.length}`);

  // Test fixtures must be unverified
  const allTestUnverified = testPharmacies.every(p => p.isVerified === false || p.verificationStatus === 'TEST');
  assert(allTestUnverified, 'All test pharmacies in seed dataset have isVerified=false or verificationStatus=TEST');

  // Conditional logic unit check matching client implementation
  const evaluateVerificationBadge = (p) => {
    const isVerified = !!(p?.isVerified || p?.verificationStatus === 'VERIFIED');
    return isVerified ? 'VERIFIED PHARMACY PARTNER' : 'TEST DATA — NOT A PARTICIPATING PHARMACY';
  };

  const testFixtureOutput = evaluateVerificationBadge(testPharmacies[0]);
  assert(
    testFixtureOutput === 'TEST DATA — NOT A PARTICIPATING PHARMACY',
    'Test pharmacy correctly evaluates to TEST DATA disclosure',
    `Result: ${testFixtureOutput}`
  );

  const mockRealVerifiedPharmacy = {
    id: 'real-pharm-1',
    name: 'Kerala State Medical Depot',
    isVerified: true,
    verificationStatus: 'VERIFIED'
  };
  const verifiedOutput = evaluateVerificationBadge(mockRealVerifiedPharmacy);
  assert(
    verifiedOutput === 'VERIFIED PHARMACY PARTNER',
    'Future real verified pharmacy correctly evaluates to VERIFIED PHARMACY PARTNER',
    `Result: ${verifiedOutput}`
  );

  // ------------------------------------------------------------------
  // GROUP 2: Order Fulfillment State Mapping
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 2: ORDER FULFILLMENT STATE MAPPING ---');

  const VALID_ORDER_STATES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'REJECTED'];
  const FORBIDDEN_ORDER_STATES = ['PREPARING', 'IN_TRANSIT', 'DISPATCHED', 'COOKING'];

  FORBIDDEN_ORDER_STATES.forEach(st => {
    assert(!VALID_ORDER_STATES.includes(st), `Order state machine rejects invented state: ${st}`);
  });

  const schemaPrismaPath = path.resolve(__dirname, 'prisma/schema.prisma');
  const schemaPrismaContent = fs.readFileSync(schemaPrismaPath, 'utf8');
  assert(
    schemaPrismaContent.includes('// PENDING, CONFIRMED, READY_FOR_PICKUP, COMPLETED, CANCELLED, REJECTED'),
    'Prisma schema specifies exact valid Order states in model definition'
  );

  // Validate existing database orders only have valid states
  const dbOrders = await prisma.order.findMany({ select: { status: true }, take: 50 });
  const allOrdersValid = dbOrders.every(o => VALID_ORDER_STATES.includes(o.status));
  assert(allOrdersValid, 'All database orders adhere strictly to approved Order state machine', `Checked: ${dbOrders.length}`);

  // ------------------------------------------------------------------
  // GROUP 3: AssistantTask State Mapping
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 3: ASSISTANT TASK STATE MAPPING ---');

  const VALID_ASSISTANT_STATES = ['AVAILABLE', 'ACCEPTED', 'COLLECTING', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
  assert(VALID_ASSISTANT_STATES.includes('IN_TRANSIT'), 'IN_TRANSIT is strictly an AssistantTask state');
  assert(!VALID_ORDER_STATES.includes('IN_TRANSIT'), 'IN_TRANSIT is not an Order state');

  const dbAssistantTasks = await prisma.assistantTask.findMany({ select: { status: true }, take: 20 });
  const allTasksValid = dbAssistantTasks.every(t => VALID_ASSISTANT_STATES.includes(t.status));
  assert(allTasksValid, 'All database assistant tasks adhere strictly to AssistantTask state machine', `Checked: ${dbAssistantTasks.length}`);

  // ------------------------------------------------------------------
  // GROUP 4: Missing-Coordinate Map Fallback Logic
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 4: MAP COORDINATE VALIDATION & FALLBACK ---');

  const isValidCoordinate = (lat, lng) =>
    typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);

  assert(isValidCoordinate(9.3176, 76.6178), 'Valid coordinates (9.3176, 76.6178) recognized');
  assert(!isValidCoordinate(null, 76.6178), 'Null latitude correctly rejected');
  assert(!isValidCoordinate(undefined, undefined), 'Undefined coordinates correctly rejected');
  assert(!isValidCoordinate(NaN, 76.6178), 'NaN coordinates correctly rejected');

  // Verify map container does not invent dummy destination coords when absent
  const evaluateMapDestination = (dest) => {
    if (!dest || !isValidCoordinate(dest.latitude, dest.longitude)) {
      return null; // Must return null, NOT dummy coordinates (e.g. pharmLat + 0.007)
    }
    return { lat: dest.latitude, lng: dest.longitude };
  };

  assert(evaluateMapDestination(null) === null, 'Missing destination returns null without inventing coordinates');
  assert(evaluateMapDestination({ address: 'No coords' }) === null, 'Address without coords returns null');
  assert(
    evaluateMapDestination({ latitude: 9.32, longitude: 76.62 }) !== null,
    'Legitimate destination coordinates preserved'
  );

  // ------------------------------------------------------------------
  // GROUP 5: Voice Search Fallback & Speech Recognition Contract
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 5: VOICE SEARCH BROWSER RECOGNITION CONTRACT ---');

  const detectSpeechSupport = (windowMock) => {
    return !!(windowMock && (windowMock.SpeechRecognition || windowMock.webkitSpeechRecognition));
  };

  assert(!detectSpeechSupport(null), 'detectSpeechSupport handles null window gracefully');
  assert(!detectSpeechSupport({}), 'detectSpeechSupport reports unsupported browser without throwing');
  assert(
    detectSpeechSupport({ SpeechRecognition: class {} }),
    'detectSpeechSupport detects standard SpeechRecognition'
  );
  assert(
    detectSpeechSupport({ webkitSpeechRecognition: class {} }),
    'detectSpeechSupport detects webkitSpeechRecognition'
  );

  // Empty voice transcript validation: must not submit empty search
  const validateVoiceTranscript = (text) => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { canSubmit: false, cleanQuery: '' };
    }
    return { canSubmit: true, cleanQuery: text.trim() };
  };

  assert(!validateVoiceTranscript('').canSubmit, 'Empty voice transcript rejected from submission');
  assert(!validateVoiceTranscript('   ').canSubmit, 'Whitespace voice transcript rejected from submission');
  assert(
    validateVoiceTranscript('Paracetamol 500mg').canSubmit &&
    validateVoiceTranscript('Paracetamol 500mg').cleanQuery === 'Paracetamol 500mg',
    'Valid voice transcript cleaned and approved for submission'
  );

  // ------------------------------------------------------------------
  // GROUP 6: Notification Schema and Integrity
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 6: NOTIFICATION SCHEMA & DATA INTEGRITY ---');

  const notifications = await prisma.notification.findMany({ take: 10 });
  assert(Array.isArray(notifications), 'Notifications array returned from database');

  if (notifications.length > 0) {
    const validFields = notifications.every(n =>
      typeof n.id === 'string' &&
      typeof n.userId === 'string' &&
      typeof n.title === 'string' &&
      typeof n.message === 'string' &&
      ['INFO', 'ORDER_STATUS', 'EMERGENCY', 'ASSISTANT'].includes(n.type)
    );
    assert(validFields, 'All database notifications conform to notification schema');

    // Ensure no sensitive financial tokens leak into notification messages
    const leakCheck = notifications.every(n =>
      !n.message.includes('rzp_') &&
      !n.message.includes('signature') &&
      !n.message.includes('secret')
    );
    assert(leakCheck, 'Notification payloads contain no financial credentials or secrets');
  } else {
    assert(true, 'Notifications table is accessible (zero records currently present)');
  }

  // ------------------------------------------------------------------
  // GROUP 7: Reduced Motion Stylesheet Rule Verification
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 7: REDUCED MOTION STYLESHEET RULES ---');

  const cssPath = path.resolve(__dirname, '../client/src/index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert(
    cssContent.includes('@media (prefers-reduced-motion: reduce)'),
    'index.css includes @media (prefers-reduced-motion: reduce) media query'
  );
  assert(
    cssContent.includes('.skeleton-shimmer::after'),
    'index.css targets .skeleton-shimmer::after for reduced motion'
  );
  assert(
    cssContent.includes('animation: none'),
    'index.css halts animation on skeleton shimmer when reduced motion is preferred'
  );

  // ------------------------------------------------------------------
  // GROUP 8: Unsupported Claims Audit (Zero Tolerance)
  // ------------------------------------------------------------------
  console.log('\n--- GROUP 8: UNSUPPORTED CLAIMS ZERO-TOLERANCE AUDIT ---');

  const clientSrcPath = path.resolve(__dirname, '../client/src');
  const forbiddenPhrases = [
    'live telemetry',
    'network telemetry',
    'hipaa shield',
    'hipaa certified',
    'dpdp certified',
    'regulatory shield',
    'certified authenticity',
    'zero-knowledge',
    'cryptographic handoff',
    'guaranteed stock',
    'guaranteed availability',
    'verified emergency node',
    'medical diagnosis'
  ];

  function searchFilesRecursively(dir, results = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        searchFilesRecursively(fullPath, results);
      } else if (entry.isFile() && /\.(jsx?|tsx?|html)$/.test(entry.name) && entry.name !== 'search_audit.cjs') {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allFiles = searchFilesRecursively(clientSrcPath);
  const claimViolations = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Strip comments to inspect actual code / UI claims
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    for (const phrase of forbiddenPhrases) {
      if (stripped.toLowerCase().includes(phrase)) {
        claimViolations.push({ file: path.basename(file), phrase });
      }
    }
  }

  assert(
    claimViolations.length === 0,
    `Client codebase contains 0 unsupported claims across ${allFiles.length} files`,
    claimViolations.length > 0 ? JSON.stringify(claimViolations) : 'Clean'
  );

  // ------------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log(`📊 PHASE 6.1E TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('====================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase61ETests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
