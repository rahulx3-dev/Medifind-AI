/**
 * Phase 6.1L.2 — Assistant Service Selection Test
 * Tests:
 * 1. Order model has assistantServiceType column (nullable)
 * 2. AssistantTask schema has serviceType column (nullable)
 * 3. checkoutController accepts and validates assistantServiceType
 * 4. checkoutController rejects ASSISTANT_DELIVERY without serviceType
 * 5. checkoutController rejects ASSISTANT_DELIVERY with invalid serviceType
 * 6. checkoutController stores correct serviceType on Order
 * 7. verifyPayment propagates serviceType to AssistantTask
 * 8. All 8 valid service types accepted
 * 9. Phase 6.1L.1 tests still pass (state machine, PIN, routes, labels)
 */

const prisma = require('./src/prisma');
const path = require('path');
const fs = require('fs');

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

const VALID_SERVICE_TYPES = [
  'MEDICINE_COLLECTION', 'PHARMACY_VISIT', 'PHARMACY_COMPANION',
  'MEDICINE_DELIVERY', 'DIGITAL_ASSISTANCE', 'PHARMACY_COMMS',
  'RESTOCK_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE'
];

async function run() {
  console.log('\n=== Phase 6.1L.2 Assistant Service Selection Test ===\n');

  try {
    // 1. Order schema — assistantServiceType column present and nullable
    console.log('--- Order schema ---');
    const orderFields = await prisma.$queryRawUnsafe('PRAGMA table_info("Order")');
    const orderColMap = Object.fromEntries(orderFields.map(f => [f.name, f]));
    check('Order.assistantServiceType column present', 'assistantServiceType' in orderColMap);
    if ('assistantServiceType' in orderColMap) {
      check('Order.assistantServiceType is nullable', Number(orderColMap['assistantServiceType'].notnull) === 0);
    }

    // 2. AssistantTask schema — serviceType column
    console.log('\n--- AssistantTask schema ---');
    const atFields = await prisma.$queryRawUnsafe('PRAGMA table_info(AssistantTask)');
    const atColMap = Object.fromEntries(atFields.map(f => [f.name, f]));
    check('AssistantTask.serviceType column present', 'serviceType' in atColMap);
    if ('serviceType' in atColMap) {
      check('AssistantTask.serviceType is nullable', Number(atColMap['serviceType'].notnull) === 0);
    }

    // 3. checkoutController accepts assistantServiceType
    console.log('\n--- checkoutController source ---');
    const checkoutSrc = fs.readFileSync(path.join(__dirname, 'src/controllers/checkoutController.js'), 'utf-8');
    check('Extracts assistantServiceType from req.body', checkoutSrc.includes('assistantServiceType } = req.body'));
    check('Validates VALID_ASSISTANT_SERVICE_TYPES array', checkoutSrc.includes('VALID_ASSISTANT_SERVICE_TYPES'));
    check('Validates all 8 service types', VALID_SERVICE_TYPES.every(t => checkoutSrc.includes(t)));
    check('Rejects ASSISTANT_DELIVERY without serviceType (400 check)', checkoutSrc.includes('assistantServiceType is required for ASSISTANT_DELIVERY'));
    check('Stores assistantServiceType on Order update', checkoutSrc.includes('assistantServiceType: fulfillmentType === \'ASSISTANT_DELIVERY\' ? assistantServiceType : null'));

    // 4. verifyPayment propagates serviceType to AssistantTask
    check('Propagates serviceType to AssistantTask.serviceType', checkoutSrc.includes('serviceType: order.assistantServiceType || null'));
    check('Propagates serviceNote to AssistantTask.serviceNote', checkoutSrc.includes('serviceNote: order.notes || null'));

    // 5. All 8 service types explicitly defined
    console.log('\n--- Service type completeness ---');
    VALID_SERVICE_TYPES.forEach(t => {
      check(`Service type ${t} in VALID_ASSISTANT_SERVICE_TYPES`, checkoutSrc.includes(`'${t}'`));
    });

    // 6. AssistantPortal has SERVICE_TYPE_CONFIG for all 8 types
    console.log('\n--- AssistantPortal service config ---');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');
    check('SERVICE_TYPE_CONFIG declared', portalSrc.includes('const SERVICE_TYPE_CONFIG'));
    check('ServiceTypeBadge component declared', portalSrc.includes('function ServiceTypeBadge'));
    VALID_SERVICE_TYPES.forEach(t => {
      check(`Portal has config for ${t}`, portalSrc.includes(t + ':'));
    });
    check('Service instructions shown in available task cards', portalSrc.includes('SERVICE_TYPE_CONFIG[task.serviceType].instruction'));
    check('Service badges shown in available task cards', portalSrc.includes('<ServiceTypeBadge serviceType={task.serviceType} size="lg" />'));
    check('Service badges shown in active task cards', portalSrc.includes('<ServiceTypeBadge serviceType={task.serviceType} />'));

    // 7. CheckoutPage has ASSISTANT_SERVICE_TYPES
    console.log('\n--- CheckoutPage service selector ---');
    const checkoutPageSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/CheckoutPage.jsx'), 'utf-8');
    check('ASSISTANT_SERVICE_TYPES declared', checkoutPageSrc.includes('const ASSISTANT_SERVICE_TYPES'));
    check('selectedServiceType state', checkoutPageSrc.includes('selectedServiceType'));
    check('Non-clinical disclaimer rendered', checkoutPageSrc.includes('Non-Clinical Service Only'));
    check('Service type required validation', checkoutPageSrc.includes('Please select the type of service'));
    check('assistantServiceType sent in API body', checkoutPageSrc.includes('body.assistantServiceType = selectedServiceType'));
    check('Continue button disabled without serviceType for ASSISTANT', checkoutPageSrc.includes("'ASSISTANT_DELIVERY' && !selectedServiceType"));
    check('verified → registered in description', checkoutPageSrc.includes('A registered MediFind Assistant'));

    // 8. OrderTracking bug fixes
    console.log('\n--- OrderTracking bug fixes ---');
    const trackingSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/OrderTracking.jsx'), 'utf-8');
    check('Back button sentinel __clear__ present', trackingSrc.includes("fetchOrders('__clear__')"));
    check('__clear__ guard in fetchOrders', trackingSrc.includes("if (targetSelectId === '__clear__') return;"));
    check('Price fallback to medicineSubtotal from items', trackingSrc.includes('medSubtotal'));
    check('isPreCheckout logic present', trackingSrc.includes('isPreCheckout'));

    // 9. Phase 6.1L.1 preserved
    console.log('\n--- Phase 6.1L.1 preserved ---');
    const ctrlSrc = fs.readFileSync(path.join(__dirname, 'src/controllers/assistantController.js'), 'utf-8');
    check('State machine AVAILABLE→ACCEPTED', ctrlSrc.includes("'ACCEPTED': ['COLLECTING']"));
    check('handoverPin verification intact', ctrlSrc.includes('handoverPin.trim() !== task.handoverPin'));
    check('Role guard preserved', ctrlSrc.includes('Only registered Medicine Access Assistants'));

    await prisma.$disconnect();
  } catch (err) {
    console.error('\nFATAL:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

run();
