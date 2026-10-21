'use strict';

/**
 * MediFind AI — Gates 7 & 8: Clinical Assistance & Pharmacy Routing PostgreSQL Integration Test
 *
 * Real PostgreSQL-backed integration test suite executing against the local
 * disposable database (medifind_disposable_test on localhost:5432).
 *
 * STRICT SAFETY ENFORCEMENT:
 * 1. Uses assertSafeTestDatabase() and createSafeTestPrismaClient() strictly bound
 *    to TEST_DATABASE_URL from server/.env.test.local.
 * 2. Preflight verification: Confirms current_database() === 'medifind_disposable_test'
 *    and port === 5432 for both the safe test client and the controller's internal Prisma client.
 * 3. Never connects to Neon, production, or staging.
 * 4. Generates unique ephemeral test fixtures tagged with an isolated run ID.
 * 5. Guarantees complete reverse-dependency cleanup in a finally block and verifies
 *    zero test artifacts remain in the database.
 * 6. Tests the 8 core Gate 7 & 8 integration scenarios:
 *    - Scenario 1: Multilingual emergency triage (Malayalam & Hindi emergency keywords, persisted isEmergency, language, status, notifications).
 *    - Scenario 2: Initial pharmacy routing limit (3 eligible pharmacies seeded; asserts exactly 2 dispatched, 3rd remains unassigned).
 *    - Scenario 3: Database uniqueness enforcement (PostgreSQL rejects duplicate (requestId, pharmacyId) assignment with P2002 error).
 *    - Scenario 4: Pharmacy queue retrieval and opening status update (assigned pharmacist sees queue, viewing detail updates status to OPENED).
 *    - Scenario 5: Unauthorized response rejection (unassigned pharmacist receives 403 Forbidden, zero partial writes).
 *    - Scenario 6: Authorized pharmacist response (clinical response persisted, request status -> RESPONDED, assignment -> RESPONDED, patient notification sent).
 *    - Scenario 7: Timeout escalation to next round (backdates assignments in PostgreSQL, invokes processSingleRequestTimeout, marks EXPIRED, round 2 assigned to next eligible pharmacy).
 *    - Scenario 8: Patient follow-up transitions (RESOLVED -> CLOSED, NEEDS_MORE_HELP -> UNDER_REVIEW).
 */

const assert = require('assert');
const { URL } = require('url');
const crypto = require('crypto');
const { createSafeTestPrismaClient, assertSafeTestDatabase } = require('./src/utils/testDatabaseGuard');

// ── Guard Validation & Environment Configuration ──────────────────────────────
const initialGuard = assertSafeTestDatabase();
if (!initialGuard.isSafe) {
  throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${initialGuard.error}`);
}

const parsedInitialUrl = new URL(initialGuard.resolvedUrl);
const allowedHosts = new Set(['localhost', '127.0.0.1']);
if (
  parsedInitialUrl.pathname !== '/medifind_disposable_test' ||
  !allowedHosts.has(parsedInitialUrl.hostname) ||
  Number(parsedInitialUrl.port || 5432) !== 5432
) {
  throw new Error(
    `[FAIL CLOSED] Target database must be strictly medifind_disposable_test on localhost:5432. Received: ${initialGuard.maskedHost}`
  );
}

// Configure process connection variables from validated local test URL
process.env.DATABASE_URL = initialGuard.resolvedUrl;
process.env.DATABASE_URL_UNPOOLED = initialGuard.resolvedUrl;
process.env.DIRECT_URL = initialGuard.resolvedUrl;
process.env.TEST_DATABASE_URL = initialGuard.resolvedUrl;

// Evict cached modules to guarantee binding to the validated local test URL
try {
  delete require.cache[require.resolve('./src/prisma')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/controllers/clinicalAssistanceController')];
} catch (_) {}
try {
  delete require.cache[require.resolve('./src/utils/clinicalTimeoutWorker')];
} catch (_) {}

// Safely import controller functions and clinical timeout worker functions
const {
  submitClinicalRequest,
  getPatientClinicalRequests,
  getPharmacyClinicalQueue,
  getClinicalRequestById,
  respondToClinicalRequest,
  submitClinicalFollowUp,
  processSingleRequestTimeout
} = require('./src/controllers/clinicalAssistanceController');

// Retrieve controller's internal Prisma client by re-requiring or checking instance
// Note: clinicalAssistanceController does `const prisma = new PrismaClient()` at top level.
// We can access or inspect it via require.cache or instantiate a matching client.
const globalPrisma = require('./src/prisma');

// Unique run tag to ensure zero collision with any other tests
const RUN_ID = `g78_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

let passCount = 0;
let failCount = 0;

function check(title, condition, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✓ PASS: ${title}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${title} ${details ? '(' + details + ')' : ''}`);
    throw new Error(`Assertion failed: ${title}`);
  }
}

function createMockReq({ params = {}, body = {}, user = {}, headers = {} }) {
  return {
    params,
    body,
    user,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runPostgresGate78IntegrationTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('🛡️  MEDIFIND AI — GATES 7 & 8: POSTGRESQL INTEGRATION TEST');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // ── Preflight Step 1: Guard Validation ──────────────────────────────────────
  console.log('─── Preflight 1: Offline Database Guard Validation ───');
  const guard = assertSafeTestDatabase();
  if (!guard.isSafe) {
    throw new Error(`[FAIL CLOSED] Test database guard rejected configuration: ${guard.error}`);
  }
  console.log(`✓ Safety Guard Accepted: ${guard.identityType} (${guard.maskedHost})`);

  const prisma = createSafeTestPrismaClient();

  // ── Preflight Step 2: Live Connection & Identity Verification ──────────────
  console.log('\n─── Preflight 2: Verifying PostgreSQL Connection & Identity ───');
  const meta = await prisma.$queryRawUnsafe(`
    SELECT 
      current_database() as db_name,
      inet_server_port() as server_port,
      inet_server_addr()::text as server_ip,
      current_user as db_user
  `);

  const dbInfo = meta[0];
  console.log(`✓ Safe Test Client Connected to Database: "${dbInfo.db_name}"`);
  console.log(`✓ Safe Test Client Connected Port: ${dbInfo.server_port}`);
  console.log(`✓ Safe Test Client Connected Role: ${dbInfo.db_user}`);

  if (dbInfo.db_name !== 'medifind_disposable_test') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Safe test client connected to "${dbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(dbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Safe test client connected to port ${dbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // Also verify controller's global Prisma client targets exactly medifind_disposable_test on localhost
  const globalMeta = await globalPrisma.$queryRawUnsafe(`
    SELECT 
      current_database() as db_name,
      inet_server_port() as server_port,
      inet_server_addr()::text as server_ip,
      current_user as db_user
  `);

  const globalDbInfo = globalMeta[0];
  console.log(`✓ Global Controller Prisma Connected to Database: "${globalDbInfo.db_name}"`);
  console.log(`✓ Global Controller Prisma Connected Port: ${globalDbInfo.server_port}`);

  if (globalDbInfo.db_name !== 'medifind_disposable_test') {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Global Prisma client connected to "${globalDbInfo.db_name}". Expected strictly "medifind_disposable_test". Aborting.`);
  }

  if (Number(globalDbInfo.server_port) !== 5432) {
    throw new Error(`[CRITICAL SAFETY VIOLATION] Global Prisma client connected to port ${globalDbInfo.server_port}. Expected strictly 5432. Aborting.`);
  }

  // Tracking fixture IDs for deterministic cleanup
  const createdUserIds = [];
  const createdPharmacyIds = [];
  const createdRequestIds = [];

  const cleanupErrors = [];

  try {
    // ── Setup Common Test Fixtures ──────────────────────────────────────────
    console.log('\n─── Setting Up Isolated Test Fixtures ───');

    // 1. Patient User
    const patientUser = await prisma.user.create({
      data: {
        name: `Test Patient ${RUN_ID}`,
        email: `patient_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PATIENT',
        phone: '9876543210'
      }
    });
    createdUserIds.push(patientUser.id);

    // 2. Three Pharmacist Users
    const pharmacistUser1 = await prisma.user.create({
      data: {
        name: `Pharmacist One ${RUN_ID}`,
        email: `pharm1_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PHARMACIST',
        phone: '9876543211'
      }
    });
    createdUserIds.push(pharmacistUser1.id);

    const pharmacistUser2 = await prisma.user.create({
      data: {
        name: `Pharmacist Two ${RUN_ID}`,
        email: `pharm2_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PHARMACIST',
        phone: '9876543212'
      }
    });
    createdUserIds.push(pharmacistUser2.id);

    const pharmacistUser3 = await prisma.user.create({
      data: {
        name: `Pharmacist Three ${RUN_ID}`,
        email: `pharm3_${RUN_ID}@example.com`,
        password: 'hashed_password_safe',
        role: 'PHARMACIST',
        phone: '9876543213'
      }
    });
    createdUserIds.push(pharmacistUser3.id);

    // 3. Three Verified, Open Pharmacies managed by the pharmacists
    // Coordinates set near Chengannur
    const pharmacy1 = await prisma.pharmacy.create({
      data: {
        name: `Care Pharmacy A ${RUN_ID}`,
        licenseNumber: `KL-PHA-${RUN_ID}-1`,
        address: '12 Market Road, Chengannur',
        phone: '9876543211',
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        rating: 4.8,
        latitude: 9.3176,
        longitude: 76.6120,
        managerId: pharmacistUser1.id
      }
    });
    createdPharmacyIds.push(pharmacy1.id);

    const pharmacy2 = await prisma.pharmacy.create({
      data: {
        name: `Care Pharmacy B ${RUN_ID}`,
        licenseNumber: `KL-PHA-${RUN_ID}-2`,
        address: '34 Station Road, Chengannur',
        phone: '9876543212',
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        rating: 4.5,
        latitude: 9.3180,
        longitude: 76.6130,
        managerId: pharmacistUser2.id
      }
    });
    createdPharmacyIds.push(pharmacy2.id);

    const pharmacy3 = await prisma.pharmacy.create({
      data: {
        name: `Care Pharmacy C ${RUN_ID}`,
        licenseNumber: `KL-PHA-${RUN_ID}-3`,
        address: '56 Hospital Road, Chengannur',
        phone: '9876543213',
        isOpen: true,
        isVerified: true,
        verificationStatus: 'VERIFIED',
        rating: 4.2,
        latitude: 9.3200,
        longitude: 76.6150,
        managerId: pharmacistUser3.id
      }
    });
    createdPharmacyIds.push(pharmacy3.id);

    console.log(`✓ Fixtures created: 1 Patient, 3 Pharmacists, 3 Active Verified Pharmacies.`);

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 1: Multilingual Emergency Triage (Gate 7)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 1: Multilingual Emergency Triage ───');
    {
      const req = createMockReq({
        body: {
          concernText: 'എനിക്ക് കടുത്ത നെഞ്ചുവേദന അനുഭവപ്പെടുന്നു (Severe chest tightness since 20 mins)',
          language: 'ml',
          inputMethod: 'VOICE',
          latitude: 9.3176,
          longitude: 76.6120
        },
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const res = createMockRes();

      await submitClinicalRequest(req, res);

      check('Scenario 1: Handler returned status 201 Created', res.statusCode === 201, `Status: ${res.statusCode}`);
      check('Scenario 1: Response indicates emergency', res.body?.request?.isEmergency === true);
      check('Scenario 1: Language preference is Malayalam (ml)', res.body?.request?.language === 'ml');
      check('Scenario 1: Input method is VOICE', res.body?.request?.inputMethod === 'VOICE');
      check('Scenario 1: Status is UNDER_REVIEW', res.body?.request?.status === 'UNDER_REVIEW');

      const requestId = res.body?.request?.id;
      createdRequestIds.push(requestId);

      // Verify PostgreSQL DB state directly
      const dbRequest = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: requestId },
        include: { assignments: true }
      });

      check('Scenario 1: DB request exists in PostgreSQL', !!dbRequest);
      check('Scenario 1: DB isEmergency is true', dbRequest?.isEmergency === true);
      check('Scenario 1: DB language is ml', dbRequest?.language === 'ml');
      check('Scenario 1: DB originalText preserved without alteration', dbRequest?.originalText === 'എനിക്ക് കടുത്ത നെഞ്ചുവേദന അനുഭവപ്പെടുന്നു (Severe chest tightness since 20 mins)');
      check('Scenario 1: Emergency guidance text attached', !!dbRequest?.emergencyGuidance && dbRequest.emergencyGuidance.includes('108'));

      // Check emergency notification sent to patient
      const emergencyNotif = await prisma.notification.findFirst({
        where: {
          userId: patientUser.id,
          type: 'EMERGENCY'
        }
      });
      check('Scenario 1: Emergency notification persisted in PostgreSQL for patient', !!emergencyNotif);
      check('Scenario 1: Emergency notification contains 108/112 guidance', emergencyNotif?.message?.includes('108'));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 2: Initial Pharmacy Routing Limit (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 2: Initial Pharmacy Routing Limit ───');
    let nonEmergencyRequestId;
    {
      const req = createMockReq({
        body: {
          concernText: 'मुझे पिछले दो दिनों से हल्का सिरदर्द और थकान है (Mild headache and fatigue)',
          language: 'hi',
          inputMethod: 'TEXT',
          latitude: 9.3176,
          longitude: 76.6120
        },
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const res = createMockRes();

      await submitClinicalRequest(req, res);

      check('Scenario 2: Handler returned status 201', res.statusCode === 201, `Status: ${res.statusCode}`);
      check('Scenario 2: Non-emergency request isEmergency === false', res.body?.request?.isEmergency === false);
      check('Scenario 2: Routing dispatched exactly 2 pharmacies', res.body?.routing?.dispatchedCount === 2, `Dispatched: ${res.body?.routing?.dispatchedCount}`);

      nonEmergencyRequestId = res.body?.request?.id;
      createdRequestIds.push(nonEmergencyRequestId);

      // Verify in PostgreSQL
      const assignments = await prisma.clinicalAssistanceAssignment.findMany({
        where: { requestId: nonEmergencyRequestId }
      });

      check('Scenario 2: Exactly 2 assignments persisted in PostgreSQL', assignments.length === 2, `Count: ${assignments.length}`);
      check('Scenario 2: Assignments are round 1', assignments.every(a => a.round === 1));
      check('Scenario 2: Initial assignment status is ASSIGNED', assignments.every(a => a.status === 'ASSIGNED'));

      const assignedPharmacyIds = assignments.map(a => a.pharmacyId);
      // Pharmacy 1 and Pharmacy 2 have higher ratings / closer distance than Pharmacy 3
      check('Scenario 2: Pharmacy 3 is NOT assigned in initial round', !assignedPharmacyIds.includes(pharmacy3.id));
      check('Scenario 2: Pharmacy 1 is assigned', assignedPharmacyIds.includes(pharmacy1.id));
      check('Scenario 2: Pharmacy 2 is assigned', assignedPharmacyIds.includes(pharmacy2.id));

      // Verify notifications sent to managers of Pharmacy 1 and 2
      const notif1 = await prisma.notification.findFirst({
        where: { userId: pharmacistUser1.id }
      });
      const notif2 = await prisma.notification.findFirst({
        where: { userId: pharmacistUser2.id }
      });
      const notif3 = await prisma.notification.findFirst({
        where: { userId: pharmacistUser3.id }
      });

      check('Scenario 2: Pharmacist 1 received dispatch notification', !!notif1);
      check('Scenario 2: Pharmacist 2 received dispatch notification', !!notif2);
      check('Scenario 2: Pharmacist 3 received zero notifications', notif3 === null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 3: Database Uniqueness Enforcement (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 3: Database Uniqueness Enforcement ───');
    {
      let duplicateErrorCaught = false;
      let errorCode = null;

      try {
        // Direct attempt to create duplicate assignment for Pharmacy 1 on nonEmergencyRequestId
        await prisma.clinicalAssistanceAssignment.create({
          data: {
            requestId: nonEmergencyRequestId,
            pharmacyId: pharmacy1.id,
            round: 1,
            status: 'ASSIGNED'
          }
        });
      } catch (err) {
        duplicateErrorCaught = true;
        errorCode = err.code;
      }

      check('Scenario 3: PostgreSQL rejected duplicate assignment', duplicateErrorCaught === true);
      check('Scenario 3: Error is Prisma unique constraint violation P2002', errorCode === 'P2002', `Code: ${errorCode}`);

      // Confirm assignment count is still exactly 2
      const totalAssignments = await prisma.clinicalAssistanceAssignment.count({
        where: { requestId: nonEmergencyRequestId }
      });
      check('Scenario 3: Total assignments remain strictly 2', totalAssignments === 2);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 4: Pharmacy Queue & Opening Status (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 4: Pharmacy Queue & Opening Status ───');
    {
      // 4A: Pharmacist 1 queries queue
      const reqQueue1 = createMockReq({
        user: { id: pharmacistUser1.id, role: 'PHARMACIST' }
      });
      const resQueue1 = createMockRes();

      await getPharmacyClinicalQueue(reqQueue1, resQueue1);

      check('Scenario 4: Pharmacist 1 queue returned 200', resQueue1.statusCode === 200);
      const queue1Items = resQueue1.body?.queue || [];
      const item1 = queue1Items.find(q => q.request?.id === nonEmergencyRequestId);
      check('Scenario 4: Request found in Pharmacist 1 queue', !!item1);
      check('Scenario 4: Queue item status is initially ASSIGNED', item1?.assignmentStatus === 'ASSIGNED');

      // 4B: Pharmacist 3 (unassigned) queries queue
      const reqQueue3 = createMockReq({
        user: { id: pharmacistUser3.id, role: 'PHARMACIST' }
      });
      const resQueue3 = createMockRes();

      await getPharmacyClinicalQueue(reqQueue3, resQueue3);

      check('Scenario 4: Pharmacist 3 queue returned 200', resQueue3.statusCode === 200);
      const queue3Items = resQueue3.body?.queue || [];
      const item3 = queue3Items.find(q => q.request?.id === nonEmergencyRequestId);
      check('Scenario 4: Pharmacist 3 queue does NOT contain the request', item3 === undefined);

      // 4C: Pharmacist 1 opens detail view
      const reqDetail = createMockReq({
        params: { id: nonEmergencyRequestId },
        user: { id: pharmacistUser1.id, role: 'PHARMACIST' }
      });
      const resDetail = createMockRes();

      await getClinicalRequestById(reqDetail, resDetail);

      check('Scenario 4: Pharmacist 1 getClinicalRequestById returned 200', resDetail.statusCode === 200);
      check('Scenario 4: Request detail returned requestNumber', !!resDetail.body?.request?.requestNumber);

      // Verify in DB: Pharmacist 1's assignment status transitioned to 'OPENED'
      const assignment1 = await prisma.clinicalAssistanceAssignment.findFirst({
        where: {
          requestId: nonEmergencyRequestId,
          pharmacyId: pharmacy1.id
        }
      });
      check('Scenario 4: Pharmacist 1 assignment status transitioned to OPENED in DB', assignment1?.status === 'OPENED');
      check('Scenario 4: openedAt timestamp was set', !!assignment1?.openedAt);

      // Pharmacist 2's assignment must remain ASSIGNED
      const assignment2 = await prisma.clinicalAssistanceAssignment.findFirst({
        where: {
          requestId: nonEmergencyRequestId,
          pharmacyId: pharmacy2.id
        }
      });
      check('Scenario 4: Pharmacist 2 assignment remains ASSIGNED in DB', assignment2?.status === 'ASSIGNED');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 5: Unauthorized Response Rejection (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 5: Unauthorized Response Rejection ───');
    {
      // Pharmacist 3 attempts to respond to nonEmergencyRequestId (not assigned to Pharmacy 3)
      const reqUnauth = createMockReq({
        params: { id: nonEmergencyRequestId },
        body: {
          clinicianResponse: 'Please drink plenty of water and rest well.'
        },
        user: { id: pharmacistUser3.id, role: 'PHARMACIST' }
      });
      const resUnauth = createMockRes();

      await respondToClinicalRequest(reqUnauth, resUnauth);

      check('Scenario 5: Unauthorized response rejected with 403 Forbidden', resUnauth.statusCode === 403, `Status: ${resUnauth.statusCode}`);
      check('Scenario 5: Error message mentions access denied', resUnauth.body?.error?.includes('Access denied'));

      // Verify DB state did not change
      const dbRequest = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: nonEmergencyRequestId }
      });
      check('Scenario 5: Request status remains UNDER_REVIEW', dbRequest?.status === 'UNDER_REVIEW');
      check('Scenario 5: clinicianResponse remains null', dbRequest?.clinicianResponse === null);
      check('Scenario 5: respondedById remains null', dbRequest?.respondedById === null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 6: Authorized Pharmacist Response (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 6: Authorized Pharmacist Response ───');
    {
      const responseText = 'Ensure proper hydration and take Paracetamol 500mg if temperature exceeds 38°C. Consult a physician if headache persists beyond 48 hours.';
      const reqAuth = createMockReq({
        params: { id: nonEmergencyRequestId },
        body: {
          clinicianResponse: responseText,
          internalNotes: 'Patient advised on hydration and OTC antipyretic.'
        },
        user: { id: pharmacistUser1.id, role: 'PHARMACIST' }
      });
      const resAuth = createMockRes();

      await respondToClinicalRequest(reqAuth, resAuth);

      check('Scenario 6: Authorized response returned 200 OK', resAuth.statusCode === 200, `Status: ${resAuth.statusCode}`);
      check('Scenario 6: Response payload indicates success', resAuth.body?.success === true);

      // Verify in PostgreSQL
      const dbRequest = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: nonEmergencyRequestId }
      });

      check('Scenario 6: Request status transitioned to RESPONDED in DB', dbRequest?.status === 'RESPONDED');
      check('Scenario 6: clinicianResponse accurately persisted', dbRequest?.clinicianResponse === responseText);
      check('Scenario 6: respondedById is Pharmacist 1', dbRequest?.respondedById === pharmacistUser1.id);
      check('Scenario 6: respondedAt timestamp is set', !!dbRequest?.respondedAt);
      check('Scenario 6: internalNotes saved', dbRequest?.internalNotes?.includes('hydration'));

      // Verify assignment status for Pharmacy 1
      const assignment1 = await prisma.clinicalAssistanceAssignment.findFirst({
        where: {
          requestId: nonEmergencyRequestId,
          pharmacyId: pharmacy1.id
        }
      });
      check('Scenario 6: Pharmacy 1 assignment status transitioned to RESPONDED in DB', assignment1?.status === 'RESPONDED');
      check('Scenario 6: Pharmacy 1 assignment respondedAt is set', !!assignment1?.respondedAt);

      // Verify notification sent to patient
      const patientNotif = await prisma.notification.findFirst({
        where: {
          userId: patientUser.id,
          title: { contains: 'Clinical Assistance Response' }
        }
      });
      check('Scenario 6: Patient notification persisted in DB', !!patientNotif);
      check('Scenario 6: Patient notification link points to request', patientNotif?.linkUrl?.includes(nonEmergencyRequestId));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 7: Timeout Escalation to Next Round (Gate 8)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 7: Timeout Escalation to Next Round ───');
    let timeoutRequestId;
    {
      // Create a fresh request for timeout testing
      const req = createMockReq({
        body: {
          concernText: 'Mild throat irritation for one day, no fever (Sore throat concern)',
          language: 'en',
          inputMethod: 'TEXT',
          latitude: 9.3176,
          longitude: 76.6120
        },
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const res = createMockRes();

      await submitClinicalRequest(req, res);
      timeoutRequestId = res.body?.request?.id;
      createdRequestIds.push(timeoutRequestId);

      check('Scenario 7: Fresh request created for timeout testing', res.statusCode === 201);

      // Verify initial assignments
      const initialAssignments = await prisma.clinicalAssistanceAssignment.findMany({
        where: { requestId: timeoutRequestId }
      });
      check('Scenario 7: Fresh request initially has 2 assignments', initialAssignments.length === 2);

      // Test pre-timeout check: Calling processSingleRequestTimeout when window has NOT expired
      const preTimeoutResult = await processSingleRequestTimeout(prisma, timeoutRequestId);
      check('Scenario 7: Pre-timeout check does NOT escalate', preTimeoutResult.escalated === false);
      check('Scenario 7: Message notes window has not expired', preTimeoutResult.message?.includes('not expired'));

      // Now deterministically BACKDATE both assignments by 16 minutes in PostgreSQL (> 15-minute threshold)
      const pastTime = new Date(Date.now() - 16 * 60 * 1000);
      await prisma.clinicalAssistanceAssignment.updateMany({
        where: { requestId: timeoutRequestId },
        data: { assignedAt: pastTime }
      });

      // Call processSingleRequestTimeout directly (without starting background timer)
      const escalationResult = await processSingleRequestTimeout(prisma, timeoutRequestId);

      check('Scenario 7: Escalation function returned success', escalationResult.success === true);
      check('Scenario 7: Escalation triggered (escalated === true)', escalationResult.escalated === true);
      check('Scenario 7: Dispatched count is 1 for escalation round', escalationResult.routing?.dispatchedCount === 1, `Count: ${escalationResult.routing?.dispatchedCount}`);

      // Verify PostgreSQL database state post-escalation:
      // 1. Initial round 1 assignments must now be EXPIRED
      const round1Assignments = await prisma.clinicalAssistanceAssignment.findMany({
        where: { requestId: timeoutRequestId, round: 1 }
      });
      check('Scenario 7: All round 1 assignments marked EXPIRED in PostgreSQL', round1Assignments.every(a => a.status === 'EXPIRED'));

      // 2. Round 2 assignment must be created and assigned to Pharmacy 3 (the next eligible pharmacy)
      const round2Assignments = await prisma.clinicalAssistanceAssignment.findMany({
        where: { requestId: timeoutRequestId, round: 2 }
      });
      check('Scenario 7: Exactly 1 round 2 assignment created in PostgreSQL', round2Assignments.length === 1);
      check('Scenario 7: Round 2 assignment is for Pharmacy 3', round2Assignments[0]?.pharmacyId === pharmacy3.id);
      check('Scenario 7: Round 2 assignment status is ASSIGNED', round2Assignments[0]?.status === 'ASSIGNED');

      // 3. Pharmacist 3 must now have received a notification for this request
      const notif3Escalated = await prisma.notification.findFirst({
        where: {
          userId: pharmacistUser3.id,
          linkUrl: { contains: timeoutRequestId }
        }
      });
      check('Scenario 7: Pharmacist 3 received escalation notification in PostgreSQL', !!notif3Escalated);

      // 4. Concurrency / Idempotency check: invoking processSingleRequestTimeout again on same round does not double-escalate
      const duplicateEscalation = await processSingleRequestTimeout(prisma, timeoutRequestId);
      check('Scenario 7: Re-evaluating timeout does not double-escalate', duplicateEscalation.escalated === false);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 8: Patient Follow-Up Transitions (Gate 7)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n─── Scenario 8: Patient Follow-Up Transitions ───');
    {
      // 8A: Patient marks nonEmergencyRequestId as RESOLVED
      const reqFollowUpResolved = createMockReq({
        params: { id: nonEmergencyRequestId },
        body: {
          followUpState: 'RESOLVED',
          notes: 'Symptoms resolved completely after hydration and rest.'
        },
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const resFollowUpResolved = createMockRes();

      await submitClinicalFollowUp(reqFollowUpResolved, resFollowUpResolved);

      check('Scenario 8A: RESOLVED follow-up returned 200 OK', resFollowUpResolved.statusCode === 200);
      check('Scenario 8A: Status updated to CLOSED', resFollowUpResolved.body?.request?.status === 'CLOSED');

      // Verify in DB
      const dbRequestResolved = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: nonEmergencyRequestId }
      });
      check('Scenario 8A: DB status is strictly CLOSED', dbRequestResolved?.status === 'CLOSED');
      check('Scenario 8A: internalNotes contains [FOLLOW_UP:RESOLVED:...]', dbRequestResolved?.internalNotes?.includes('[FOLLOW_UP:RESOLVED:'));

      // 8B: Patient marks timeoutRequestId as NEEDS_MORE_HELP
      // First respond to timeoutRequestId to allow follow-up
      await prisma.clinicalAssistanceRequest.update({
        where: { id: timeoutRequestId },
        data: {
          status: 'RESPONDED',
          clinicianResponse: 'Initial escalation response provided.',
          respondedById: pharmacistUser3.id,
          respondedAt: new Date()
        }
      });

      const reqFollowUpNeedsHelp = createMockReq({
        params: { id: timeoutRequestId },
        body: {
          followUpState: 'NEEDS_MORE_HELP',
          notes: 'Throat irritation has not improved.'
        },
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const resFollowUpNeedsHelp = createMockRes();

      await submitClinicalFollowUp(reqFollowUpNeedsHelp, resFollowUpNeedsHelp);

      check('Scenario 8B: NEEDS_MORE_HELP follow-up returned 200 OK', resFollowUpNeedsHelp.statusCode === 200);
      check('Scenario 8B: Status updated to UNDER_REVIEW', resFollowUpNeedsHelp.body?.request?.status === 'UNDER_REVIEW');

      // Verify in DB
      const dbRequestNeedsHelp = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id: timeoutRequestId }
      });
      check('Scenario 8B: DB status is strictly UNDER_REVIEW', dbRequestNeedsHelp?.status === 'UNDER_REVIEW');
      check('Scenario 8B: internalNotes contains [FOLLOW_UP:NEEDS_MORE_HELP:...]', dbRequestNeedsHelp?.internalNotes?.includes('[FOLLOW_UP:NEEDS_MORE_HELP:'));

      // 8C: Verify patient request history endpoint strips internalNotes
      const reqHistory = createMockReq({
        user: { id: patientUser.id, role: 'PATIENT' }
      });
      const resHistory = createMockRes();

      await getPatientClinicalRequests(reqHistory, resHistory);

      check('Scenario 8C: getPatientClinicalRequests returned 200', resHistory.statusCode === 200);
      const patientRequests = resHistory.body?.requests || [];
      check('Scenario 8C: Patient retrieved their requests', patientRequests.length >= 2);
      check('Scenario 8C: internalNotes is stripped from patient view', patientRequests.every(r => r.internalNotes === undefined));
      check('Scenario 8C: followUpState extracted for patient view', patientRequests.some(r => r.followUpState === 'RESOLVED'));
    }

  } catch (error) {
    failCount++;
    console.error('\n❌ Unhandled Integration Test Error:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    console.log('\n─── Cleanup: Deleting Fixtures in Reverse Foreign-Key Order ───');

    // 1. Delete Notifications referencing test users
    try {
      const deletedNotifs = await prisma.notification.deleteMany({
        where: {
          userId: { in: createdUserIds }
        }
      });
      console.log(`✓ Deleted ${deletedNotifs.count} test notification records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Notifications: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (Notifications): ${err.message}`);
    }

    // 2. Delete ClinicalAssistanceAssignment records
    try {
      const deletedAssignments = await prisma.clinicalAssistanceAssignment.deleteMany({
        where: {
          OR: [
            { requestId: { in: createdRequestIds } },
            { pharmacyId: { in: createdPharmacyIds } }
          ]
        }
      });
      console.log(`✓ Deleted ${deletedAssignments.count} test clinical assistance assignments`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete ClinicalAssistanceAssignment: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (ClinicalAssistanceAssignment): ${err.message}`);
    }

    // 3. Delete ClinicalAssistanceRequest records
    try {
      const deletedRequests = await prisma.clinicalAssistanceRequest.deleteMany({
        where: {
          OR: [
            { id: { in: createdRequestIds } },
            { patientId: { in: createdUserIds } }
          ]
        }
      });
      console.log(`✓ Deleted ${deletedRequests.count} test clinical assistance requests`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete ClinicalAssistanceRequest: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (ClinicalAssistanceRequest): ${err.message}`);
    }

    // 4. Delete Pharmacies
    try {
      const deletedPharmacies = await prisma.pharmacy.deleteMany({
        where: {
          id: { in: createdPharmacyIds }
        }
      });
      console.log(`✓ Deleted ${deletedPharmacies.count} test pharmacy records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete Pharmacy: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (Pharmacy): ${err.message}`);
    }

    // 5. Delete Users
    try {
      const deletedUsers = await prisma.user.deleteMany({
        where: {
          id: { in: createdUserIds }
        }
      });
      console.log(`✓ Deleted ${deletedUsers.count} test user records`);
    } catch (err) {
      cleanupErrors.push(`Failed to delete User: ${err.message}`);
      console.error(`  ⚠️ Cleanup error (User): ${err.message}`);
    }

    // ── Residual Artifact Check ─────────────────────────────────────────────
    console.log('\n─── Residual Artifact Check ───');
    try {
      const remainingNotifs = await prisma.notification.count({
        where: { userId: { in: createdUserIds } }
      });
      const remainingAssignments = await prisma.clinicalAssistanceAssignment.count({
        where: {
          OR: [
            { requestId: { in: createdRequestIds } },
            { pharmacyId: { in: createdPharmacyIds } }
          ]
        }
      });
      const remainingRequests = await prisma.clinicalAssistanceRequest.count({
        where: {
          OR: [
            { id: { in: createdRequestIds } },
            { patientId: { in: createdUserIds } }
          ]
        }
      });
      const remainingPharmacies = await prisma.pharmacy.count({
        where: { id: { in: createdPharmacyIds } }
      });
      const remainingUsers = await prisma.user.count({
        where: { id: { in: createdUserIds } }
      });

      console.log(`✓ Residual Artifact Count: Notifications: ${remainingNotifs}, Assignments: ${remainingAssignments}, Requests: ${remainingRequests}, Pharmacies: ${remainingPharmacies}, Users: ${remainingUsers}`);

      if (
        remainingNotifs !== 0 ||
        remainingAssignments !== 0 ||
        remainingRequests !== 0 ||
        remainingPharmacies !== 0 ||
        remainingUsers !== 0
      ) {
        throw new Error(
          `[FAIL CLOSED] Residual test records detected after cleanup: notifications=${remainingNotifs}, assignments=${remainingAssignments}, requests=${remainingRequests}, pharmacies=${remainingPharmacies}, users=${remainingUsers}`
        );
      }
    } catch (err) {
      cleanupErrors.push(`Failed to verify residual artifacts: ${err.message}`);
      failCount++;
      console.error(`  ⚠️ Residual verification error: ${err.message}`);
    }

    // Disconnect clients cleanly
    try {
      await prisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Safe test client disconnect error: ${err.message}`);
    }

    try {
      await globalPrisma.$disconnect();
    } catch (err) {
      cleanupErrors.push(`Global Prisma client disconnect error: ${err.message}`);
    }

    if (cleanupErrors.length > 0) {
      console.error(`\n⚠️ Cleanup completed with ${cleanupErrors.length} error(s):`);
      for (const msg of cleanupErrors) {
        console.error(`   - ${msg}`);
      }
    } else {
      console.log('✓ All cleanup operations and client disconnects completed without errors');
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`Gates 7 & 8 PostgreSQL Integration Results: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (failCount > 0 || cleanupErrors.length > 0) {
    process.exit(1);
  }
}

// Direct invocation handler
if (require.main === module) {
  runPostgresGate78IntegrationTest().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}

module.exports = {
  runPostgresGate78IntegrationTest
};
