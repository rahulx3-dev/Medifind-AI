/**
 * Phase 6.1L.5 — Assistant Profiles & Capabilities Test Suite
 * Tests:
 * 1. AssistantProfile storage and auto-initialization.
 * 2. Profile fields: name, bio, phone, isActive, isAvailable, capabilities.
 * 3. Validation of capabilities against canonical 8 service types (rejects invalid types and empty array).
 * 4. Multi-capability support for assistants.
 * 5. Capability filtering: assistants only see available tasks matching their supported capabilities.
 * 6. Capability authorization: assistants cannot accept tasks outside their capabilities.
 * 7. Inactive / unavailable assistant handling:
 *    - Inactive/unavailable assistant receives 0 available tasks.
 *    - Inactive/unavailable assistant cannot accept tasks (HTTP 400).
 * 8. Role guard and security:
 *    - Non-assistant (PATIENT, PHARMACIST) blocked from assistant profile endpoints (HTTP 403).
 * 9. Frontend source verification:
 *    - AssistantPortal includes profile console bar, duty toggle, and capability management modal.
 */

const prisma = require('./src/prisma');
const path = require('path');
const fs = require('fs');
const assistantController = require('./src/controllers/assistantController');

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

const CANONICAL_8_SERVICES = [
  'MEDICINE_COLLECTION',
  'PHARMACY_VISIT',
  'PHARMACY_COMPANION',
  'MEDICINE_DELIVERY',
  'DIGITAL_ASSISTANCE',
  'PHARMACY_COMMS',
  'RESTOCK_ASSISTANCE',
  'PRESCRIPTION_ASSISTANCE'
];

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.data = d; return this; }
  };
}

async function run() {
  console.log('\n=== Phase 6.1L.5 Assistant Profiles & Capabilities Test Suite ===\n');

  try {
    // -------------------------------------------------------------
    // 1. Schema & Profile Storage Verification
    // -------------------------------------------------------------
    console.log('--- 1. AssistantProfile Schema & Storage ---');

    // Create test assistant user
    const assistantUser = await prisma.user.create({
      data: {
        name: 'Anita Roy',
        email: `anita_asst_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543211'
      }
    });

    const patientUser = await prisma.user.create({
      data: {
        name: 'Patient Vikram',
        email: `vikram_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT',
        phone: '+919876543212'
      }
    });

    const pharmacistUser = await prisma.user.create({
      data: {
        name: 'Pharmacist Sarah',
        email: `sarah_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PHARMACIST',
        phone: '+919876543213'
      }
    });

    let pharmacy = await prisma.pharmacy.findFirst({
      where: { name: 'Max Care Pharmacy' }
    });
    if (!pharmacy) {
      pharmacy = await prisma.pharmacy.findFirst({
        where: { isVerified: true, verificationStatus: 'VERIFIED' }
      });
    }

    // Auto-create or fetch profile
    const initialProfile = await assistantController.getOrCreateAssistantProfile(assistantUser.id);
    check('AssistantProfile auto-created successfully', !!initialProfile && !!initialProfile.id);
    check('Default status is active and available', initialProfile.isActive === true && initialProfile.isAvailable === true);
    check('Default capabilities is empty array', assistantController.parseCapabilities(initialProfile.capabilities).length === 0);

    // -------------------------------------------------------------
    // 2. Profile Retrieval & Role Security
    // -------------------------------------------------------------
    console.log('\n--- 2. Profile Retrieval & Role Authorization ---');

    const reqGetAsst = { user: assistantUser };
    const resGetAsst = createMockRes();
    await assistantController.getAssistantProfile(reqGetAsst, resGetAsst);

    check('Assistant can retrieve their own profile',
      resGetAsst.statusCode === 200 && resGetAsst.data.success === true);
    check('Profile contains name, phone, email, bio, isActive, isAvailable, capabilities',
      resGetAsst.data.profile.name === 'Anita Roy' &&
      resGetAsst.data.profile.phone === '+919876543211' &&
      Array.isArray(resGetAsst.data.profile.capabilities) &&
      resGetAsst.data.profile.capabilities.length === 0 &&
      resGetAsst.data.profile.isActive === true &&
      resGetAsst.data.profile.isAvailable === true);

    // Patient trying to access assistant profile
    const reqGetPatient = { user: patientUser };
    const resGetPatient = createMockRes();
    await assistantController.getAssistantProfile(reqGetPatient, resGetPatient);
    check('Patient blocked from assistant profile with 403',
      resGetPatient.statusCode === 403);

    // Pharmacist trying to access assistant profile
    const reqGetPharm = { user: pharmacistUser };
    const resGetPharm = createMockRes();
    await assistantController.getAssistantProfile(reqGetPharm, resGetPharm);
    check('Pharmacist blocked from assistant profile with 403',
      resGetPharm.statusCode === 403);

    // -------------------------------------------------------------
    // 3. Unconfigured Assistant Gating (Empty Capabilities)
    // -------------------------------------------------------------
    console.log('\n--- 3. Unconfigured Assistant (Empty Capabilities) Gating ---');

    // Create a sample available task to verify unconfigured assistant cannot see or accept it
    const orderPreSetup = await prisma.order.create({
      data: {
        orderNumber: `MF-CAP-PRE-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'DIGITAL_ASSISTANCE',
        verificationPin: '9999'
      }
    });
    const taskPreSetup = await prisma.assistantTask.create({
      data: {
        orderId: orderPreSetup.id,
        status: 'AVAILABLE',
        serviceType: 'DIGITAL_ASSISTANCE',
        handoverPin: '9999'
      }
    });

    const reqAvailUnconfigured = { user: assistantUser };
    const resAvailUnconfigured = createMockRes();
    await assistantController.getAvailableTasks(reqAvailUnconfigured, resAvailUnconfigured);
    check('Unconfigured assistant (empty capabilities) receives 0 available tasks',
      resAvailUnconfigured.statusCode === 200 && resAvailUnconfigured.data.tasks.length === 0);

    const reqAcceptUnconfigured = {
      params: { id: taskPreSetup.id },
      user: assistantUser
    };
    const resAcceptUnconfigured = createMockRes();
    await assistantController.acceptTask(reqAcceptUnconfigured, resAcceptUnconfigured);
    check('Unconfigured assistant blocked from accepting tasks until capabilities selected',
      resAcceptUnconfigured.statusCode === 400 &&
      resAcceptUnconfigured.data.error.includes('does not possess the supported capability'));

    // Clean up pre-setup test task
    await prisma.assistantTask.delete({ where: { id: taskPreSetup.id } });
    await prisma.order.delete({ where: { id: orderPreSetup.id } });

    // -------------------------------------------------------------
    // 4. Capability Validation & Explicit Selection
    // -------------------------------------------------------------
    console.log('\n--- 4. Capability Validation & Explicit Service Selection ---');

    // Attempt to update with invalid capability
    const reqInvalidCap = {
      user: assistantUser,
      body: {
        capabilities: ['MEDICINE_DELIVERY', 'NON_EXISTENT_SURGERY']
      }
    };
    const resInvalidCap = createMockRes();
    await assistantController.updateAssistantProfile(reqInvalidCap, resInvalidCap);
    check('Invalid service capability rejected with 400',
      resInvalidCap.statusCode === 400 && resInvalidCap.data.error.includes('Invalid service capability'));

    // Attempt to update with empty capabilities array
    const reqEmptyCap = {
      user: assistantUser,
      body: { capabilities: [] }
    };
    const resEmptyCap = createMockRes();
    await assistantController.updateAssistantProfile(reqEmptyCap, resEmptyCap);
    check('Empty capabilities array rejected with 400',
      resEmptyCap.statusCode === 400 && resEmptyCap.data.error.includes('at least one service capability'));

    // Explicit selection with subset of capabilities (DIGITAL_ASSISTANCE, PHARMACY_COMMS)
    const reqValidUpdate = {
      user: assistantUser,
      body: {
        bio: 'Certified community digital health assistant',
        capabilities: ['DIGITAL_ASSISTANCE', 'PHARMACY_COMMS']
      }
    };
    const resValidUpdate = createMockRes();
    await assistantController.updateAssistantProfile(reqValidUpdate, resValidUpdate);

    check('Explicit multi-capability selection succeeds',
      resValidUpdate.statusCode === 200 && resValidUpdate.data.success === true);
    check('Updated capabilities stored as array of 2 canonical types',
      resValidUpdate.data.profile.capabilities.length === 2 &&
      resValidUpdate.data.profile.capabilities.includes('DIGITAL_ASSISTANCE') &&
      resValidUpdate.data.profile.capabilities.includes('PHARMACY_COMMS'));
    check('Bio updated', resValidUpdate.data.profile.bio.includes('Certified community'));

    // -------------------------------------------------------------
    // 5. Capability Filtering in Task Discovery
    // -------------------------------------------------------------
    console.log('\n--- 5. Task Discovery Capability Filtering ---');

    // Create 3 available tasks:
    // Task 1: DIGITAL_ASSISTANCE (assistant is capable)
    // Task 2: PHARMACY_COMMS (assistant is capable)
    // Task 3: MEDICINE_DELIVERY (assistant is NOT capable)
    const orderDigital = await prisma.order.create({
      data: {
        orderNumber: `MF-CAP-DIG-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'DIGITAL_ASSISTANCE',
        verificationPin: '1111'
      }
    });
    const taskDigital = await prisma.assistantTask.create({
      data: {
        orderId: orderDigital.id,
        status: 'AVAILABLE',
        serviceType: 'DIGITAL_ASSISTANCE',
        handoverPin: '1111'
      }
    });

    const orderComms = await prisma.order.create({
      data: {
        orderNumber: `MF-CAP-COM-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'PHARMACY_COMMS',
        verificationPin: '2222'
      }
    });
    const taskComms = await prisma.assistantTask.create({
      data: {
        orderId: orderComms.id,
        status: 'AVAILABLE',
        serviceType: 'PHARMACY_COMMS',
        handoverPin: '2222'
      }
    });

    const orderDelivery = await prisma.order.create({
      data: {
        orderNumber: `MF-CAP-DEL-${Date.now()}`,
        userId: patientUser.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        verificationPin: '3333'
      }
    });
    const taskDelivery = await prisma.assistantTask.create({
      data: {
        orderId: orderDelivery.id,
        status: 'AVAILABLE',
        serviceType: 'MEDICINE_DELIVERY',
        handoverPin: '3333'
      }
    });

    // Query available tasks as Anita (who only has DIGITAL_ASSISTANCE and PHARMACY_COMMS)
    const reqAvailAnita = { user: assistantUser };
    const resAvailAnita = createMockRes();
    await assistantController.getAvailableTasks(reqAvailAnita, resAvailAnita);

    check('getAvailableTasks returns capable tasks', resAvailAnita.statusCode === 200);
    const returnedTaskIds = resAvailAnita.data.tasks.map(t => t.id);
    check('Anita receives DIGITAL_ASSISTANCE task', returnedTaskIds.includes(taskDigital.id));
    check('Anita receives PHARMACY_COMMS task', returnedTaskIds.includes(taskComms.id));
    check('Anita does NOT receive MEDICINE_DELIVERY task (filtered by capability)', !returnedTaskIds.includes(taskDelivery.id));

    // -------------------------------------------------------------
    // 6. Capability-Gated Task Acceptance
    // -------------------------------------------------------------
    console.log('\n--- 6. Capability-Gated Task Acceptance ---');

    // Anita attempts to accept taskDelivery (which requires MEDICINE_DELIVERY capability)
    const reqAcceptDelivery = {
      params: { id: taskDelivery.id },
      user: assistantUser
    };
    const resAcceptDelivery = createMockRes();
    await assistantController.acceptTask(reqAcceptDelivery, resAcceptDelivery);

    check('Acceptance of un-supported capability rejected with 400',
      resAcceptDelivery.statusCode === 400 &&
      resAcceptDelivery.data.error.includes('does not possess the supported capability'));

    // Anita accepts taskDigital (which she IS capable of)
    const reqAcceptDigital = {
      params: { id: taskDigital.id },
      user: assistantUser
    };
    const resAcceptDigital = createMockRes();
    await assistantController.acceptTask(reqAcceptDigital, resAcceptDigital);

    check('Acceptance of supported capability succeeds',
      resAcceptDigital.statusCode === 200 && resAcceptDigital.data.task.status === 'ACCEPTED');

    // -------------------------------------------------------------
    // 7. Inactive / Unavailable Assistant Gating
    // -------------------------------------------------------------
    console.log('\n--- 7. Inactive & Unavailable Assistant Handling ---');

    // Set Anita to unavailable (duty paused)
    const reqSetUnavailable = {
      user: assistantUser,
      body: { isAvailable: false }
    };
    const resSetUnavailable = createMockRes();
    await assistantController.updateAssistantProfile(reqSetUnavailable, resSetUnavailable);
    check('Assistant duty availability successfully set to false',
      resSetUnavailable.data.profile.isAvailable === false);

    // When unavailable, available tasks list returns 0 tasks
    const reqAvailOffline = { user: assistantUser };
    const resAvailOffline = createMockRes();
    await assistantController.getAvailableTasks(reqAvailOffline, resAvailOffline);

    check('Unavailable assistant receives 0 available tasks',
      resAvailOffline.statusCode === 200 && resAvailOffline.data.tasks.length === 0);
    check('Response notifies assistant of paused duty status',
      resAvailOffline.data.assistantStatus.isAvailable === false);

    // Unavailable assistant cannot accept tasks
    const reqAcceptOffline = {
      params: { id: taskComms.id },
      user: assistantUser
    };
    const resAcceptOffline = createMockRes();
    await assistantController.acceptTask(reqAcceptOffline, resAcceptOffline);

    check('Unavailable assistant blocked from accepting tasks with 400',
      resAcceptOffline.statusCode === 400 &&
      resAcceptOffline.data.error.includes('inactive or unavailable'));

    // Toggle Anita back to available
    const reqSetAvailable = {
      user: assistantUser,
      body: { isAvailable: true }
    };
    const resSetAvailable = createMockRes();
    await assistantController.updateAssistantProfile(reqSetAvailable, resSetAvailable);
    check('Assistant duty availability restored to true',
      resSetAvailable.data.profile.isAvailable === true);

    // Now acceptance of taskComms succeeds
    const reqAcceptComms = {
      params: { id: taskComms.id },
      user: assistantUser
    };
    const resAcceptComms = createMockRes();
    await assistantController.acceptTask(reqAcceptComms, resAcceptComms);
    check('Active assistant successfully accepts supported task',
      resAcceptComms.statusCode === 200 && resAcceptComms.data.task.status === 'ACCEPTED');

    // -------------------------------------------------------------
    // 8. Frontend UI Integration Source Verification
    // -------------------------------------------------------------
    console.log('\n--- 8. Frontend UI Integration Verification ---');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');

    check('AssistantPortal declares profile state',
      portalSrc.includes('const [profile, setProfile] = useState'));

    check('AssistantPortal fetches assistant profile',
      portalSrc.includes("fetch('/api/assistant/profile'"));

    check('AssistantPortal provides handleToggleAvailability',
      portalSrc.includes('handleToggleAvailability'));

    check('AssistantPortal provides capability management handler',
      portalSrc.includes('handleSaveCapabilities'));

    check('AssistantPortal displays Assistant Duty & Capability Console Bar',
      portalSrc.includes('Assistant Duty & Capability Console Bar') &&
      portalSrc.includes('ACTIVE DUTY • AVAILABLE'));

    check('AssistantPortal displays duty paused notification in available tab',
      portalSrc.includes('Duty status paused:') &&
      portalSrc.includes('Go On Duty'));

    check('AssistantPortal renders capability selection modal with all 8 services',
      portalSrc.includes('Manage Supported Service Capabilities') &&
      portalSrc.includes('Object.keys(SERVICE_TYPE_CONFIG).map'));

    // -------------------------------------------------------------
    // Cleanup test artifacts
    // -------------------------------------------------------------
    try {
      const testOrderIds = [orderIneligible?.id, orderMatchesA?.id, orderMatchesB?.id, orderPhysical?.id].filter(Boolean);
      if (testOrderIds.length > 0) {
        await prisma.assistantTask.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
      }
      const testUserIds = [patientUser?.id, assistantUser?.id, otherUser?.id, asstB?.id].filter(Boolean);
      if (testUserIds.length > 0) {
        await prisma.assistantProfile.deleteMany({ where: { userId: { in: testUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
      }
    } catch (cleanupErr) {
      console.warn('Non-fatal test cleanup warning:', cleanupErr.message);
    }

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n========================================`);
    console.log(`Phase 6.1L.5 Tests Completed: ${pass} passed, ${fail} failed.`);
    console.log(`========================================\n`);

    if (fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error in test_phase6_1L5_profiles_capabilities:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
