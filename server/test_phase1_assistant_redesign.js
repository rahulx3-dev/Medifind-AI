/**
 * MediFind AI — Phase 1 Verification Test Suite
 * Tests:
 * 1. User registration with role 'ASSISTANT' initializes onboarding state (assistantType null, onboardingCompleted false)
 * 2. Role selection endpoint: Selecting 'DELIVERY_ASSISTANT' persists role
 * 3. Delivery Assistant onboarding: Operating profile updates without clinical credentials
 * 4. Returning onboarded user: Does not repeat role selection (onboardingCompleted is true)
 * 5. Role selection endpoint: Selecting 'HEALTHCARE_PROFESSIONAL' sets status to PENDING
 * 6. Healthcare Professional onboarding: Submits license & qualifications, verificationStatus strictly PENDING
 * 7. Delivery tasks gating: Pending Healthcare Professional receives 0 delivery tasks and clinical disclaimer
 * 8. Clinical security: Non-approved professional cannot gain clinical verified permissions
 * 9. Role switching: Explicit switch endpoint enforces permission state
 * 10. Service catalogue audit: Obsolete categories (DIGITAL_ASSISTANCE, etc.) identified and separated from active delivery
 * 11. Delivery workflow preservation: Medicine delivery and collection tasks preserved and functional
 * 12. Frontend verification: AssistantPortal includes role selection, separate paths, and clinical safeguards
 */

const prisma = require('./src/prisma');
const path = require('path');
const fs = require('fs');
const assistantController = require('./src/controllers/assistantController');
const { SERVICE_CATALOGUE, isObsoleteService, isClinicalService, isDeliveryService } = require('./src/utils/serviceCatalogue');

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

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.data = d; return this; }
  };
}

async function run() {
  console.log('\n=============================================================');
  console.log('🧪 MediFind AI — Phase 1 Assistant Portal Redesign & Onboarding Test Suite');
  console.log('=============================================================\n');

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. Service Catalogue Audit Verification
    // ─────────────────────────────────────────────────────────────
    console.log('--- 1. Service Catalogue Structure & Obsolete Category Audit ---');
    check('serviceCatalogue module loaded', !!SERVICE_CATALOGUE);
    check('Obsolete category DIGITAL_ASSISTANCE marked obsolete', isObsoleteService('DIGITAL_ASSISTANCE'));
    check('Obsolete category PRESCRIPTION_ASSISTANCE marked obsolete', isObsoleteService('PRESCRIPTION_ASSISTANCE'));
    check('Obsolete category PHARMACY_COMMS marked obsolete', isObsoleteService('PHARMACY_COMMS'));
    check('Obsolete category RESTOCK_ASSISTANCE marked obsolete', isObsoleteService('RESTOCK_ASSISTANCE'));
    check('Active category MEDICINE_DELIVERY is marked active delivery', isDeliveryService('MEDICINE_DELIVERY'));
    check('Active category MEDICINE_COLLECTION is marked active delivery', isDeliveryService('MEDICINE_COLLECTION'));
    check('Candidate category NURSING_VISIT is marked clinical', isClinicalService('NURSING_VISIT'));
    check('Candidate category VITAL_SIGN_MEASUREMENT is marked clinical', isClinicalService('VITAL_SIGN_MEASUREMENT'));

    // ─────────────────────────────────────────────────────────────
    // 2. New Assistant User Registration & Initial Onboarding State
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 2. Assistant Registration & Mandatory First-Time Role Selection ---');
    const timestamp = Date.now();
    const newAsstUser = await prisma.user.create({
      data: {
        name: 'Arjun Nair',
        email: `arjun_asst_${timestamp}@medifind.test`,
        password: 'hashedpassword123',
        role: 'ASSISTANT',
        phone: '+919876543290',
        assistantProfile: {
          create: {
            assistantType: null,
            onboardingCompleted: false,
            onboardingStep: 'ROLE_SELECTION',
            isActive: true,
            isAvailable: true,
            capabilities: ''
          }
        }
      },
      include: { assistantProfile: true }
    });

    check('User registered with role ASSISTANT', newAsstUser.role === 'ASSISTANT');
    check('AssistantProfile created with assistantType null (requires role selection)', newAsstUser.assistantProfile.assistantType === null);
    check('AssistantProfile onboardingCompleted is false', newAsstUser.assistantProfile.onboardingCompleted === false);

    // Profile retrieval returns initial onboarding state
    const reqProfile = { user: newAsstUser };
    const resProfile = createMockRes();
    await assistantController.getAssistantProfile(reqProfile, resProfile);
    check('getAssistantProfile returns onboardingCompleted: false', resProfile.data.profile.onboardingCompleted === false);
    check('getAssistantProfile returns onboardingStep: ROLE_SELECTION', resProfile.data.profile.onboardingStep === 'ROLE_SELECTION');

    // ─────────────────────────────────────────────────────────────
    // 3. Role Selection: Delivery Assistant Track
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 3. Delivery Assistant Role Selection & Simple Profile Setup ---');
    const reqSelectDelivery = {
      user: newAsstUser,
      body: { role: 'DELIVERY_ASSISTANT' }
    };
    const resSelectDelivery = createMockRes();
    await assistantController.selectAssistantRole(reqSelectDelivery, resSelectDelivery);

    check('Role selection endpoint returns 200 for DELIVERY_ASSISTANT', resSelectDelivery.statusCode === 200);
    check('Role persisted as DELIVERY_ASSISTANT', resSelectDelivery.data.profile.assistantType === 'DELIVERY_ASSISTANT');
    check('Default capabilities populated with medicine delivery', resSelectDelivery.data.profile.capabilities.includes('MEDICINE_DELIVERY'));

    // Update Delivery Operational Profile (without clinical credentials)
    const reqUpdateDelivery = {
      user: newAsstUser,
      body: {
        operatingCity: 'Chengannur / Alappuzha',
        operatingRadiusKm: 15,
        vehicleType: 'MOTORCYCLE',
        bio: 'Fast and reliable local medicine collection assistant.'
      }
    };
    const resUpdateDelivery = createMockRes();
    await assistantController.updateDeliveryProfile(reqUpdateDelivery, resUpdateDelivery);

    check('Delivery profile updated successfully', resUpdateDelivery.statusCode === 200);
    check('onboardingCompleted transitioned to true', resUpdateDelivery.data.profile.onboardingCompleted === true);
    check('Operating radius persisted (15 km)', resUpdateDelivery.data.profile.operatingRadiusKm === 15);
    check('Vehicle type persisted (MOTORCYCLE)', resUpdateDelivery.data.profile.vehicleType === 'MOTORCYCLE');
    check('Delivery profile requires NO professional registration number', resUpdateDelivery.data.profile.registrationNumber === null);

    // ─────────────────────────────────────────────────────────────
    // 4. Returning Onboarded User Persistence
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 4. Returning User Persistence Check ---');
    const resReturning = createMockRes();
    await assistantController.getAssistantProfile({ user: newAsstUser }, resReturning);
    check('Returning assistant has onboardingCompleted: true (no repeated prompt)', resReturning.data.profile.onboardingCompleted === true);
    check('Returning assistant retains DELIVERY_ASSISTANT type', resReturning.data.profile.assistantType === 'DELIVERY_ASSISTANT');

    // ─────────────────────────────────────────────────────────────
    // 5. Healthcare Professional Role Selection & Application Submission
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 5. Healthcare Professional Application & PENDING Status Gating ---');
    const newNurseUser = await prisma.user.create({
      data: {
        name: 'Nurse Lakshmi Pillai',
        email: `lakshmi_nurse_${timestamp}@medifind.test`,
        password: 'hashedpassword123',
        role: 'ASSISTANT',
        phone: '+919876543291',
        assistantProfile: {
          create: {
            assistantType: null,
            onboardingCompleted: false,
            onboardingStep: 'ROLE_SELECTION',
            isActive: true,
            isAvailable: true,
            capabilities: ''
          }
        }
      },
      include: { assistantProfile: true }
    });

    const reqSelectNurse = {
      user: newNurseUser,
      body: { role: 'HEALTHCARE_PROFESSIONAL' }
    };
    const resSelectNurse = createMockRes();
    await assistantController.selectAssistantRole(reqSelectNurse, resSelectNurse);

    check('Role selection endpoint returns 200 for HEALTHCARE_PROFESSIONAL', resSelectNurse.statusCode === 200);
    check('Role persisted as HEALTHCARE_PROFESSIONAL', resSelectNurse.data.profile.assistantType === 'HEALTHCARE_PROFESSIONAL');
    check('Default verificationStatus is strictly PENDING', resSelectNurse.data.profile.verificationStatus === 'PENDING');

    // Submit professional application
    const reqSubmitApp = {
      user: newNurseUser,
      body: {
        professionTitle: 'Registered Nurse (RN)',
        registrationNumber: 'KNC-RN-2024-88412',
        qualifications: 'B.Sc. Nursing, GNM Diploma',
        serviceAreasApplied: ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT', 'POST_HOSPITAL_CARE'],
        bio: 'Over 6 years of community nursing experience.'
      }
    };
    const resSubmitApp = createMockRes();
    await assistantController.submitProfessionalApplication(reqSubmitApp, resSubmitApp);

    check('Professional application submitted successfully', resSubmitApp.statusCode === 200);
    check('Verification status remains strictly PENDING (not auto-verified)', resSubmitApp.data.profile.verificationStatus === 'PENDING');
    check('SubmittedAt timestamp recorded', !!resSubmitApp.data.profile.submittedAt);
    check('Council registration number stored', resSubmitApp.data.profile.registrationNumber === 'KNC-RN-2024-88412');
    check('Applied service categories stored', resSubmitApp.data.profile.serviceAreasApplied.includes('NURSING_VISIT'));

    // ─────────────────────────────────────────────────────────────
    // 6. Clinical Permissions Gating: Pending Professional Blocked
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 6. Security Gating: Pending Healthcare Professional Blocked From Tasks ---');
    const reqNurseTasks = { user: newNurseUser };
    const resNurseTasks = createMockRes();
    await assistantController.getAvailableTasks(reqNurseTasks, resNurseTasks);

    check('Pending healthcare professional receives 0 available delivery tasks', resNurseTasks.data.count === 0 && resNurseTasks.data.tasks.length === 0);
    check('Response notifies professional that verification is PENDING', resNurseTasks.data.assistantStatus.message.includes('PENDING'));

    // ─────────────────────────────────────────────────────────────
    // 7. Role Switching with Permission Boundaries
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 7. Explicit Role Switching & Security Preservation ---');
    const reqSwitch = {
      user: newNurseUser,
      body: { targetRole: 'DELIVERY_ASSISTANT' }
    };
    const resSwitch = createMockRes();
    await assistantController.switchAssistantRole(reqSwitch, resSwitch);

    check('Switching from Professional to Delivery Assistant succeeds', resSwitch.statusCode === 200);
    check('Active assistantType is now DELIVERY_ASSISTANT', resSwitch.data.profile.assistantType === 'DELIVERY_ASSISTANT');
    check('Delivery capabilities restored on track switch', resSwitch.data.profile.capabilities.includes('MEDICINE_DELIVERY'));

    // Switch back to Healthcare Professional: verificationStatus must NOT become APPROVED
    const reqSwitchBack = {
      user: newNurseUser,
      body: { targetRole: 'HEALTHCARE_PROFESSIONAL' }
    };
    const resSwitchBack = createMockRes();
    await assistantController.switchAssistantRole(reqSwitchBack, resSwitchBack);

    check('Switching back to Healthcare Professional succeeds', resSwitchBack.statusCode === 200);
    check('Healthcare verificationStatus is NOT approved upon switch', resSwitchBack.data.profile.verificationStatus !== 'APPROVED');

    // ─────────────────────────────────────────────────────────────
    // 8. Frontend UI Source Verification
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 8. Frontend Assistant Portal Source Verification ---');
    const portalSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AssistantPortal.jsx'), 'utf-8');

    check('Includes mandatory prompt "How would you like to join MediFind AI?"', portalSrc.includes('How would you like to join MediFind AI?'));
    check('Includes "Continue as Delivery Assistant"', portalSrc.includes('Continue as Delivery Assistant'));
    check('Includes "Apply as a Healthcare Professional"', portalSrc.includes('Apply as a Healthcare Professional'));
    check('Includes delivery explanation without clinical certificates', portalSrc.includes('Zero Clinical Requirements'));
    check('Includes 4-step verification progress timeline', portalSrc.includes('Application Verification & Review Progress'));
    check('Includes role switching UI', portalSrc.includes('handleSwitchRole'));

    // Check CheckoutPage service filtering
    const checkoutPageSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/CheckoutPage.jsx'), 'utf-8');
    check('CheckoutPage filters obsolete services from patient selection', checkoutPageSrc.includes('filter(svc => ![\'DIGITAL_ASSISTANCE\''));

    // Check AuthPage account type selector
    const authPageSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/AuthPage.jsx'), 'utf-8');
    check('AuthPage has Join As account type selector', authPageSrc.includes('How would you like to register?'));
    check('AuthPage passes registerRole to backend', authPageSrc.includes('role: registerRole'));

    // ─────────────────────────────────────────────────────────────
    // Clean up test data
    // ─────────────────────────────────────────────────────────────
    await prisma.assistantProfile.deleteMany({ where: { userId: { in: [newAsstUser.id, newNurseUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [newAsstUser.id, newNurseUser.id] } } });

    await prisma.$disconnect();
  } catch (err) {
    console.error('\nFatal test runner error:', err);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=============================================================`);
  console.log(`Phase 1 Verification Complete: ${pass} passed, ${fail} failed.`);
  console.log(`=============================================================\n`);

  if (fail > 0) process.exit(1);
}

run();
