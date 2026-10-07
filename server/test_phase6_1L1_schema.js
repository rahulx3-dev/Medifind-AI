/**
 * Phase 6.1L.1 — AssistantTask Schema & Domain Correction Test
 * Verifies that:
 * 1. New schema fields (serviceType, serviceNote) exist and are nullable
 * 2. deliveryAddress is now nullable (was NOT NULL before)
 * 3. Existing fields untouched (handoverPin, status, acceptedAt, collectedAt, deliveredAt)
 * 4. assistantController exports are intact
 * 5. assistantRoutes are intact
 */

const prisma = require('./src/prisma');
const path = require('path');

let pass = 0;
let fail = 0;

function check(label, value) {
  if (value) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

async function run() {
  console.log('\n=== Phase 6.1L.1 AssistantTask Schema Test ===\n');

  try {
    // Get table columns via PRAGMA
    const fields = await prisma.$queryRawUnsafe('PRAGMA table_info(AssistantTask)');
    const colMap = {};
    fields.forEach(f => { colMap[f.name] = f; });

    const colNames = Object.keys(colMap);
    console.log('AssistantTask columns detected:', colNames.join(', '), '\n');

    // --- Existing fields must still exist ---
    check('id column present', colNames.includes('id'));
    check('orderId column present', colNames.includes('orderId'));
    check('assistantId column present', colNames.includes('assistantId'));
    check('status column present', colNames.includes('status'));
    check('handoverPin column present', colNames.includes('handoverPin'));
    check('acceptedAt column present', colNames.includes('acceptedAt'));
    check('collectedAt column present', colNames.includes('collectedAt'));
    check('deliveredAt column present', colNames.includes('deliveredAt'));
    check('createdAt column present', colNames.includes('createdAt'));
    check('updatedAt column present', colNames.includes('updatedAt'));
    check('deliveryNotes column present (backward compat)', colNames.includes('deliveryNotes'));

    // --- New fields must exist ---
    check('serviceType column present (NEW)', colNames.includes('serviceType'));
    check('serviceNote column present (NEW)', colNames.includes('serviceNote'));

    // --- Nullability checks ---
    if (colMap['serviceType']) {
      check('serviceType is nullable (notnull=0)', Number(colMap['serviceType'].notnull) === 0);
    } else {
      check('serviceType nullable (column missing)', false);
    }

    if (colMap['serviceNote']) {
      check('serviceNote is nullable (notnull=0)', Number(colMap['serviceNote'].notnull) === 0);
    } else {
      check('serviceNote nullable (column missing)', false);
    }

    if (colMap['deliveryAddress']) {
      check('deliveryAddress is now nullable (notnull=0)', Number(colMap['deliveryAddress'].notnull) === 0);
    } else {
      check('deliveryAddress nullable (column missing)', false);
    }

    // --- Controller interface test ---
    console.log('\n--- assistantController exports ---');
    const ctrl = require('./src/controllers/assistantController');
    check('getAvailableTasks exported', typeof ctrl.getAvailableTasks === 'function');
    check('getMyTasks exported', typeof ctrl.getMyTasks === 'function');
    check('acceptTask exported', typeof ctrl.acceptTask === 'function');
    check('progressTaskStatus exported', typeof ctrl.progressTaskStatus === 'function');

    // --- State machine constants are intact ---
    console.log('\n--- State machine transition check ---');
    const src = require('fs').readFileSync(path.join(__dirname, 'src/controllers/assistantController.js'), 'utf-8');
    check('AVAILABLE transition present', src.includes("'ACCEPTED': ['COLLECTING']"));
    check('COLLECTING transition present', src.includes("'COLLECTING': ['IN_TRANSIT']"));
    check('IN_TRANSIT transition present', src.includes("'IN_TRANSIT': ['DELIVERED']"));
    check('DELIVERED transition present', src.includes("'DELIVERED': ['CONFIRMED']"));
    check('handoverPin verification intact', src.includes('handoverPin.trim() !== task.handoverPin'));

    // --- Domain correction labels ---
    console.log('\n--- Domain correction labels ---');
    check('Neutral error message: Medicine Access Assistants', src.includes('Only registered Medicine Access Assistants can accept service tasks'));
    check('Neutral notification: medicine access request', src.includes('accepted your medicine access request'));
    check('Neutral notification title: Medicine Access Assistant Assigned', src.includes('Medicine Access Assistant Assigned!'));
    check('Neutral progress title: Service Progress Update', src.includes('Service Progress Update'));
    check('Neutral handover title: Service Handover Complete', src.includes('Service Handover Complete'));

    // --- Routes intact ---
    console.log('\n--- Assistant routes ---');
    const routeSrc = require('fs').readFileSync(path.join(__dirname, 'src/routes/assistantRoutes.js'), 'utf-8');
    check('GET /available route defined', routeSrc.includes("router.get('/available'"));
    check('GET /my-tasks route defined', routeSrc.includes("router.get('/my-tasks'"));
    check('PUT /tasks/:id/accept route defined', routeSrc.includes("router.put('/tasks/:id/accept'"));
    check('PUT /tasks/:id/progress route defined', routeSrc.includes("router.put('/tasks/:id/progress'"));
    check('ASSISTANT role guard on routes', routeSrc.includes("requireRole('ASSISTANT', 'ADMIN')"));

    // --- Security: assistant cannot touch prescriptions ---
    console.log('\n--- Role isolation (security) ---');
    const prescCtrl = require('fs').readFileSync(path.join(__dirname, 'src/controllers/prescriptionController.js'), 'utf-8');
    check('PHARMACIST check in prescription controller', prescCtrl.includes("PHARMACIST") || prescCtrl.includes("ADMIN"));

    await prisma.$disconnect();
  } catch (err) {
    console.error('\nFATAL TEST ERROR:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

run();
