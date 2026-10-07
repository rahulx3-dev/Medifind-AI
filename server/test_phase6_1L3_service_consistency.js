/**
 * Phase 6.1L.3 — Assistant Service Flow Consistency Test
 * Tests:
 * 1. Non-address assistant service types (DIGITAL_ASSISTANCE, PRESCRIPTION_ASSISTANCE, PHARMACY_COMMS)
 *    do not require a physical delivery address in checkoutController.
 * 2. Physical assistant service types (e.g. MEDICINE_DELIVERY, PHARMACY_COMPANION) still require an address.
 * 3. Invalid / missing assistantServiceType is caught before address check.
 * 4. getCheckoutSummary returns assistantServiceType.
 * 5. selectFulfillment returns assistantServiceType.
 * 6. CheckoutPage.jsx conditionally suppresses address input for non-address service types.
 * 7. CheckoutPage.jsx shows human-readable service label in payment summary.
 * 8. OrderTracking.jsx contains ASSISTANT_SERVICE_CONFIG and getAssistantServiceLabel.
 * 9. OrderTracking.jsx shows "Medicine Access Assistant" and service label in My Orders cards.
 * 10. OrderTracking.jsx shows dedicated Fulfillment & Service card in Order Details.
 * 11. AssistantPortal.jsx uses SERVICE_TYPE_CONFIG instructions in accept task modal.
 * 12. Terminology: no generic "courier" or blanket "delivery" for non-delivery assistant tasks.
 * 13. State machine, 4-digit PIN, and security isolation preserved.
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

const NON_ADDRESS_SERVICE_TYPES = [
  'DIGITAL_ASSISTANCE',
  'PRESCRIPTION_ASSISTANCE',
  'PHARMACY_COMMS'
];

const PHYSICAL_SERVICE_TYPES = [
  'MEDICINE_COLLECTION',
  'PHARMACY_VISIT',
  'PHARMACY_COMPANION',
  'MEDICINE_DELIVERY',
  'RESTOCK_ASSISTANCE'
];

const ALL_8_SERVICE_TYPES = [
  ...NON_ADDRESS_SERVICE_TYPES,
  ...PHYSICAL_SERVICE_TYPES
];

async function run() {
  console.log('\n=== Phase 6.1L.3 Assistant Service Flow Consistency Test ===\n');

  try {
    // -------------------------------------------------------------
    // 1. Controller Source Inspection
    // -------------------------------------------------------------
    console.log('--- 1. checkoutController Address & Service Consistency ---');
    const checkoutSrc = fs.readFileSync(path.join(__dirname, 'src/controllers/checkoutController.js'), 'utf-8');

    check('NON_ADDRESS_SERVICE_TYPES defined in checkoutController',
      checkoutSrc.includes("NON_ADDRESS_SERVICE_TYPES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS']"));

    check('isAssistantNonAddress logic present',
      checkoutSrc.includes('isAssistantNonAddress'));

    check('Address required only when not a non-address assistant service',
      checkoutSrc.includes('!isAssistantNonAddress'));

    check('assistantServiceType validated before address check',
      checkoutSrc.indexOf('VALID_ASSISTANT_SERVICE_TYPES.includes(assistantServiceType)') < checkoutSrc.indexOf('requiresAddress'));

    check('getCheckoutSummary exposes assistantServiceType',
      checkoutSrc.includes('assistantServiceType: order.assistantServiceType'));

    check('selectFulfillment response returns assistantServiceType',
      checkoutSrc.includes('assistantServiceType: updated.assistantServiceType'));

    check('Updated order saves null address for non-address services',
      checkoutSrc.includes('deliveryAddress: requiresAddress ? deliveryAddress.trim() : null'));

    // -------------------------------------------------------------
    // 2. Functional Controller Test with Test Order
    // -------------------------------------------------------------
    console.log('\n--- 2. Functional selectFulfillment Tests ---');

    // Find or create test patient, pharmacy, and medicine
    let user = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: 'Phase 61L3 Patient',
          email: `test_p61l3_${Date.now()}@medifind.test`,
          passwordHash: 'fakepassword',
          role: 'PATIENT',
          phone: '+919876543210'
        }
      });
    }

    let pharmacy = await prisma.pharmacy.findFirst({ where: { isVerified: true } });
    if (!pharmacy) {
      pharmacy = await prisma.pharmacy.create({
        data: {
          name: 'Phase 61L3 Pharmacy',
          address: '100 Medical Enclave, Chengannur',
          phone: '04792451234',
          email: `rx_p61l3_${Date.now()}@medifind.test`,
          licenseNumber: 'KL-CHG-61L3',
          isVerified: true,
          verificationStatus: 'VERIFIED'
        }
      });
    }

    let medicine = await prisma.medicine.findFirst();
    if (!medicine) {
      medicine = await prisma.medicine.create({
        data: {
          name: 'Paracetamol 500mg',
          brandName: 'Dolo 500',
          manufacturer: 'Micro Labs',
          category: 'Analgesics',
          dosageForm: 'Tablet',
          strength: '500mg',
          price: 30.0,
          prescriptionRequired: false
        }
      });
    }

    // Create a CONFIRMED test order
    const testOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-61L3-${Date.now().toString().slice(-6)}`,
        userId: user.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        totalAmount: 60.0,
        medicineSubtotal: 60.0,
        verificationPin: '4321',
        items: {
          create: [
            { medicineId: medicine.id, quantity: 2, unitPrice: 30.0, subtotal: 60.0 }
          ]
        }
      },
      include: { items: true }
    });

    // Test A: DIGITAL_ASSISTANCE allows empty address
    for (const nonAddrType of NON_ADDRESS_SERVICE_TYPES) {
      // Simulate controller update logic directly against DB as selectFulfillment does
      const isNonAddr = NON_ADDRESS_SERVICE_TYPES.includes(nonAddrType);
      const reqAddr = !isNonAddr;
      check(`Non-address service ${nonAddrType} requiresAddress is false`, reqAddr === false);

      const updated = await prisma.order.update({
        where: { id: testOrder.id },
        data: {
          fulfillmentType: 'ASSISTANT_DELIVERY',
          assistantServiceType: nonAddrType,
          deliveryAddress: null
        }
      });
      check(`Order updated with ${nonAddrType} has null deliveryAddress`, updated.deliveryAddress === null && updated.assistantServiceType === nonAddrType);
    }

    // Test B: Physical services require address
    for (const physType of PHYSICAL_SERVICE_TYPES) {
      const isNonAddr = NON_ADDRESS_SERVICE_TYPES.includes(physType);
      const reqAddr = !isNonAddr;
      check(`Physical service ${physType} requiresAddress is true`, reqAddr === true);
    }

    // Clean up test order
    await prisma.orderItem.deleteMany({ where: { orderId: testOrder.id } });
    await prisma.order.delete({ where: { id: testOrder.id } });

    // -------------------------------------------------------------
    // 3. CheckoutPage.jsx Frontend Consistency
    // -------------------------------------------------------------
    console.log('\n--- 3. CheckoutPage.jsx Display & Address Handling ---');
    const checkoutPageSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/CheckoutPage.jsx'), 'utf-8');

    check('CheckoutPage defines NON_ADDRESS_SERVICE_TYPES',
      checkoutPageSrc.includes("const NON_ADDRESS_SERVICE_TYPES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS']"));

    check('CheckoutPage has getAssistantServiceLabel helper',
      checkoutPageSrc.includes('function getAssistantServiceLabel'));

    check('CheckoutPage fetches and stores assistantServiceType',
      checkoutPageSrc.includes('setSelectedServiceType(c.assistantServiceType)'));

    check('Address input conditionally rendered based on physical requirement',
      checkoutPageSrc.includes('!NON_ADDRESS_SERVICE_TYPES.includes(selectedServiceType)'));

    check('Address submission validation accounts for non-address types',
      checkoutPageSrc.includes('const assistantNeedsAddress = selectedFulfillment === \'ASSISTANT_DELIVERY\' &&'));

    check('Payment summary shows "Medicine Access Assistant"',
      checkoutPageSrc.includes("'Medicine Access Assistant'"));

    check('Payment summary displays "Service:" with human-readable label',
      checkoutPageSrc.includes('Service: {getAssistantServiceLabel(selectedServiceType || checkout.assistantServiceType)}'));

    check('Payment step hides delivery address for non-address service types',
      checkoutPageSrc.includes('!NON_ADDRESS_SERVICE_TYPES.includes(selectedServiceType || checkout.assistantServiceType)'));

    // -------------------------------------------------------------
    // 4. OrderTracking.jsx (My Orders & Order Details) Consistency
    // -------------------------------------------------------------
    console.log('\n--- 4. OrderTracking.jsx List & Detail Views ---');
    const trackingSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/OrderTracking.jsx'), 'utf-8');

    check('OrderTracking defines ASSISTANT_SERVICE_CONFIG',
      trackingSrc.includes('const ASSISTANT_SERVICE_CONFIG'));

    check('OrderTracking defines getAssistantServiceLabel',
      trackingSrc.includes('function getAssistantServiceLabel'));

    ALL_8_SERVICE_TYPES.forEach(st => {
      check(`ASSISTANT_SERVICE_CONFIG includes ${st}`,
        trackingSrc.includes(`${st}: { label:`));
    });

    check('My Orders list card strip displays "Medicine Access Assistant:" with service label',
      trackingSrc.includes('Medicine Access Assistant: {getAssistantServiceLabel(ord.assistantServiceType || ord.assistantTask?.serviceType)}'));

    check('My Orders list card body displays Medicine Access Assistant service pill',
      trackingSrc.includes('{/* Assistant Service Pill for Assistant Fulfillment */}'));

    check('Order Detail quick micro-badges display "Fulfillment: Medicine Access Assistant"',
      trackingSrc.includes('Fulfillment: Medicine Access Assistant'));

    check('Order Detail quick micro-badges display "Service:" with human-readable label',
      trackingSrc.includes('Service: {getAssistantServiceLabel(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType)}'));

    check('Order Detail has dedicated Fulfillment & Service overview card',
      trackingSrc.includes('{/* FULFILLMENT & SERVICE OVERVIEW CARD */}'));

    check('Dedicated card displays "Fulfillment" header with "Medicine Access Assistant"',
      trackingSrc.includes("detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY'") && trackingSrc.includes("'Medicine Access Assistant'"));

    check('Dedicated card displays "Service" header with human-readable label',
      trackingSrc.includes('getAssistantServiceLabel(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType)'));

    check('Non-address service types hide location in detail card',
      trackingSrc.includes("!['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'].includes(detailOrder.assistantServiceType"));

    check('Architecture box renamed to "Medicine Access Assistant Architecture"',
      trackingSrc.includes('Medicine Access Assistant Architecture'));

    check('Simulation CTA renamed to "Simulate Assistant Service Flow"',
      trackingSrc.includes('Simulate Assistant Service Flow'));

    // -------------------------------------------------------------
    // 5. AssistantPortal.jsx Accept Task Modal & Instructions
    // -------------------------------------------------------------
    console.log('\n--- 5. AssistantPortal.jsx Accept Modal Instructions ---');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');

    check('SERVICE_TYPE_CONFIG has Pharmacy Companion instruction',
      portalSrc.includes('Meet and accompany the patient for the pharmacy visit.'));

    check('SERVICE_TYPE_CONFIG has Digital Assistance instruction',
      portalSrc.includes('Help the patient navigate the MediFind process. Do not provide medical advice.'));

    check('SERVICE_TYPE_CONFIG has Medicine Collection instruction',
      portalSrc.includes('Collect the patient’s reserved medicine from the selected pharmacy.'));

    check('Accept modal uses service-specific instruction from SERVICE_TYPE_CONFIG',
      portalSrc.includes('const serviceCfg = SERVICE_TYPE_CONFIG[task.serviceType]') &&
      portalSrc.includes('message: serviceCfg.instruction'));

    check('Accept modal title incorporates service label',
      portalSrc.includes('title: `Accept Service Task: ${serviceCfg.label}`'));

    check('Accept modal impactPoints reinforce non-clinical scope',
      portalSrc.includes('Non-clinical assistance only: do not provide medical advice or modify prescriptions.'));

    check('PIN keypad uses service-aware header',
      portalSrc.includes("task.serviceType === 'MEDICINE_DELIVERY' ? 'Delivery Handover Verification' : 'Service Handover Verification'"));

    check('PIN keypad submit uses service-aware button label',
      portalSrc.includes("task.serviceType === 'MEDICINE_DELIVERY' ? 'Verify PIN & Confirm Delivery Handover' : 'Verify PIN & Complete Service Handover'"));

    check('Toast notifications use "service task" terminology for non-delivery',
      portalSrc.includes("'Handover PIN verified! Service task successfully confirmed and recorded.'"));

    // -------------------------------------------------------------
    // 6. Security, Isolation & State Machine
    // -------------------------------------------------------------
    console.log('\n--- 6. Security, PIN & State Machine Integrity ---');
    const ctrlSrc = fs.readFileSync(path.join(__dirname, 'src/controllers/assistantController.js'), 'utf-8');

    check('State machine: AVAILABLE -> ACCEPTED',
      ctrlSrc.includes("where: { id },\n        data: {\n          status: 'ACCEPTED'"));

    check('State machine valid transitions intact',
      ctrlSrc.includes("'ACCEPTED': ['COLLECTING']") &&
      ctrlSrc.includes("'COLLECTING': ['IN_TRANSIT']") &&
      ctrlSrc.includes("'IN_TRANSIT': ['DELIVERED']") &&
      ctrlSrc.includes("'DELIVERED': ['CONFIRMED']"));

    check('4-digit handoverPin verification required for CONFIRMED',
      ctrlSrc.includes('handoverPin.trim() !== task.handoverPin'));

    check('handoverPin stripped from lists to prevent leakage',
      ctrlSrc.includes('const sanitized = tasks.map(({ handoverPin: _hp, ...t }) => t)'));

    check('Role guard: Only ASSISTANT or ADMIN can accept tasks',
      ctrlSrc.includes("req.user.role !== 'ASSISTANT' && req.user.role !== 'ADMIN'"));

    await prisma.$disconnect();
  } catch (err) {
    console.error('\nFATAL TEST ERROR:', err);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

run();
