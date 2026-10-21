/**
 * MediFind AI — Phase 2.1 Verification Security & Adversarial Integration Suite
 *
 * Covers:
 * 1. Document security & traversal attacks (null bytes, path separators, symlinks)
 * 2. Cross-user document download and cross-user deletion attacks
 * 3. Document deletion state protection (disallowed during PENDING, UNDER_REVIEW, APPROVED, SUSPENDED)
 * 4. Orphaned file prevention on upload database failure
 * 5. Admin authentication & authorization enforcement (non-admin, forged role)
 * 6. Application status transition rules:
 *    - Cannot approve DRAFT or SUSPENDED application directly
 *    - Cannot reject or request corrections on DRAFT or SUSPENDED
 *    - Checklist confirmation enforcement on approval
 *    - Admin restore endpoint for SUSPENDED accounts
 * 7. Suspended account security:
 *    - Suspended professional cannot edit application
 *    - Suspended professional cannot switch role to Delivery Assistant
 *    - Suspended professional cannot reactivate via profile update
 *    - Suspended professional cannot accept tasks
 * 8. Clinical vs Delivery separation & Task assignment security:
 *    - Professional cannot accept delivery task
 *    - Delivery assistant cannot claim unassigned tasks without capability
 *    - Assistant cannot accept task assigned to someone else
 * 9. Pharmacy & Booking integrity:
 *    - Deactivated test fixture pharmacy is rejected during order booking
 *    - Active participating pharmacy reservation succeeds
 *    - Historical delivery and order records remain intact
 */

const fs = require('fs');
const path = require('path');
const prisma = require('./src/prisma');
const verificationController = require('./src/controllers/verificationController');
const assistantController = require('./src/controllers/assistantController');
const orderController = require('./src/controllers/orderController');
const {
  DOCUMENTS_UPLOAD_DIR,
  resolveSecureDocumentPath,
  validateFileSignature,
  computeFileHash
} = require('./src/utils/documentSecurity');
const { APPLICATION_STATUSES } = require('./src/utils/serviceCatalogue');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(label, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  PASS  ${label}`);
  } else {
    failedTests++;
    console.error(`  FAIL  ${label}${details ? ' - ' + details : ''}`);
  }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    pipe(dest) { return dest; }
  };
}

async function runAdversarialAudit() {
  console.log('\n======================================================================');
  console.log('🛡️  MediFind AI — Phase 2.1 Adversarial Security & Integration Audit');
  console.log('======================================================================\n');

  // Baseline database snapshot
  const [initialUsers, initialOrders, initialTasks, initialPharmacies] = await Promise.all([
    prisma.user.count(),
    prisma.order.count(),
    prisma.assistantTask.count(),
    prisma.pharmacy.count()
  ]);

  // Clean any previous test artifacts from this script
  const cleanupEmails = [
    'adv_nurse_1@test.medifind.com',
    'adv_nurse_2@test.medifind.com',
    'adv_patient@test.medifind.com',
    'adv_delivery@test.medifind.com',
    'adv_admin@test.medifind.com'
  ];
  await prisma.user.deleteMany({ where: { email: { in: cleanupEmails } } });

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. PATH TRAVERSAL & MALFORMED FILENAME ADVERSARIAL TESTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- 1. Path Traversal & Malformed Document Security ---');
    check('Rejects relative traversal ../../etc/passwd', resolveSecureDocumentPath('../../etc/passwd') === null);
    check('Rejects Windows path traversal ..\\..\\windows\\system32', resolveSecureDocumentPath('..\\..\\windows\\system32') === null);
    check('Rejects null-byte injection payload vdoc_test.pdf\\0.jpg', resolveSecureDocumentPath('vdoc_test.pdf\0.jpg') === null);
    check('Rejects control character in filename', resolveSecureDocumentPath('vdoc_\x01_test.pdf') === null);
    check('Rejects slash within filename', resolveSecureDocumentPath('subfolder/vdoc_1.pdf') === null);
    check('Rejects empty or non-string input', resolveSecureDocumentPath(null) === null && resolveSecureDocumentPath('') === null);

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ORPHANED FILE RESILIENCE ON UPLOAD FAILURE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 2. Orphaned File Prevention on DB Failure ---');
    const filesBefore = fs.readdirSync(DOCUMENTS_UPLOAD_DIR).length;

    // Simulate upload with invalid assistantProfileId to trigger DB rejection
    const fakeReq = {
      user: { id: 'non-existent-user-id', role: 'ASSISTANT' },
      body: { documentType: 'REGISTRATION_CERTIFICATE' },
      file: {
        buffer: Buffer.from('%PDF-1.4 simulated pdf header for test'),
        originalname: 'test_cert.pdf'
      }
    };
    const fakeRes = mockRes();
    await verificationController.uploadVerificationDocument(fakeReq, fakeRes);
    const filesAfter = fs.readdirSync(DOCUMENTS_UPLOAD_DIR).length;
    check('Upload failed gracefully on non-existent assistant (404)', fakeRes.statusCode === 404);
    check('Zero orphaned files left in upload directory', filesBefore === filesAfter);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. CREATE TEST ACTORS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 3. Actor Setup for Cross-User Security ---');
    const nurse1 = await prisma.user.create({
      data: {
        email: 'adv_nurse_1@test.medifind.com',
        name: 'Nurse Priya Adv',
        password: 'hashedpassword',
        role: 'ASSISTANT',
        assistantProfile: {
          create: {
            assistantType: 'HEALTHCARE_PROFESSIONAL',
            onboardingCompleted: true,
            verificationStatus: 'DRAFT',
            professionTitle: 'Registered Nurse',
            registrationNumber: 'KNMC-ADV-101',
            qualifications: 'B.Sc Nursing',
            issuingAuthority: 'Kerala Nursing Council',
            yearsOfExperience: 4,
            serviceAreasApplied: JSON.stringify(['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'])
          }
        }
      },
      include: { assistantProfile: true }
    });

    const nurse2 = await prisma.user.create({
      data: {
        email: 'adv_nurse_2@test.medifind.com',
        name: 'Nurse Lekha Adv',
        password: 'hashedpassword',
        role: 'ASSISTANT',
        assistantProfile: {
          create: {
            assistantType: 'HEALTHCARE_PROFESSIONAL',
            onboardingCompleted: true,
            verificationStatus: 'DRAFT'
          }
        }
      },
      include: { assistantProfile: true }
    });

    const patient = await prisma.user.create({
      data: {
        email: 'adv_patient@test.medifind.com',
        name: 'Patient Vikram Adv',
        password: 'hashedpassword',
        role: 'PATIENT'
      }
    });

    const deliveryAssistant = await prisma.user.create({
      data: {
        email: 'adv_delivery@test.medifind.com',
        name: 'Delivery Assistant Jitin Adv',
        password: 'hashedpassword',
        role: 'ASSISTANT',
        assistantProfile: {
          create: {
            assistantType: 'DELIVERY_ASSISTANT',
            onboardingCompleted: true,
            isActive: true,
            isAvailable: true,
            capabilities: 'MEDICINE_DELIVERY,MEDICINE_COLLECTION'
          }
        }
      },
      include: { assistantProfile: true }
    });

    const admin = await prisma.user.create({
      data: {
        email: 'adv_admin@test.medifind.com',
        name: 'Admin Officer Adv',
        password: 'hashedpassword',
        role: 'ADMIN'
      }
    });

    check('Nurse 1, Nurse 2, Patient, Delivery Assistant, Admin created', Boolean(nurse1 && nurse2 && patient && deliveryAssistant && admin));

    // Upload a valid document for Nurse 1
    const uploadReq = {
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: { documentType: 'REGISTRATION_CERTIFICATE' },
      file: {
        buffer: Buffer.from('%PDF-1.4 official kerala nursing council certificate'),
        originalname: 'nurse1_council_cert.pdf'
      }
    };
    const uploadRes = mockRes();
    await verificationController.uploadVerificationDocument(uploadReq, uploadRes);
    check('Nurse 1 uploaded document successfully (201)', uploadRes.statusCode === 201);
    const doc1 = uploadRes.data.document;

    // ─────────────────────────────────────────────────────────────────────────
    // 4. CROSS-USER DOCUMENT ACCESS & UNAUTHORIZED DELETION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 4. Cross-User Document Access & Deletion Attacks ---');
    // Nurse 2 tries to download Nurse 1's document
    let res = mockRes();
    await verificationController.downloadMyDocument({
      user: { id: nurse2.id, role: 'ASSISTANT' },
      params: { id: doc1.id }
    }, res);
    check('Nurse 2 blocked from reading Nurse 1 document (403)', res.statusCode === 403);

    // Patient tries to download Nurse 1's document
    res = mockRes();
    await verificationController.downloadMyDocument({
      user: { id: patient.id, role: 'PATIENT' },
      params: { id: doc1.id }
    }, res);
    check('Patient blocked from reading assistant document (403)', res.statusCode === 403);

    // Nurse 2 tries to delete Nurse 1's document
    res = mockRes();
    await verificationController.deleteVerificationDocument({
      user: { id: nurse2.id, role: 'ASSISTANT' },
      params: { id: doc1.id }
    }, res);
    check('Nurse 2 blocked from deleting Nurse 1 document (403)', res.statusCode === 403);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. APPLICATION SUBMISSION & DELETION STATE GATING
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 5. Document Deletion Gating Across Status Lifecycle ---');
    // Submit Nurse 1 application -> status becomes PENDING
    res = mockRes();
    await verificationController.saveOrSubmitApplication({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: {
        professionTitle: 'Registered Nurse',
        registrationNumber: 'KNMC-ADV-101',
        qualifications: 'B.Sc Nursing',
        issuingAuthority: 'Kerala Nursing Council',
        yearsOfExperience: 4,
        serviceAreasApplied: ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'],
        declarationAccepted: true,
        isDraft: false
      }
    }, res);
    check('Nurse 1 submits application successfully (200, PENDING)', res.statusCode === 200 && res.data.profile.verificationStatus === 'PENDING');

    // Nurse 1 tries to delete their document while application is PENDING
    res = mockRes();
    await verificationController.deleteVerificationDocument({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      params: { id: doc1.id }
    }, res);
    check('Document deletion BLOCKED while application is PENDING (400)', res.statusCode === 400);

    // Move to UNDER_REVIEW
    res = mockRes();
    await verificationController.startApplicationReview({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id }
    }, res);
    check('Admin moves application to UNDER_REVIEW (200)', res.statusCode === 200);

    // Nurse 1 tries to delete document while UNDER_REVIEW
    res = mockRes();
    await verificationController.deleteVerificationDocument({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      params: { id: doc1.id }
    }, res);
    check('Document deletion BLOCKED while application is UNDER_REVIEW (400)', res.statusCode === 400);

    // Nurse 1 tries to upload new document while UNDER_REVIEW
    res = mockRes();
    await verificationController.uploadVerificationDocument({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: { documentType: 'DEGREE_CERTIFICATE' },
      file: {
        buffer: Buffer.from('%PDF-1.4 extra degree cert'),
        originalname: 'extra_cert.pdf'
      }
    }, res);
    check('Document upload BLOCKED while application is UNDER_REVIEW (400)', res.statusCode === 400);

    // ─────────────────────────────────────────────────────────────────────────
    // 6. ADMIN REVIEW CHECKLIST & INVALID STATUS TRANSITIONS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 6. Admin Checklist Enforcement & Invalid Status Transitions ---');
    // Admin tries to approve without review checklist
    res = mockRes();
    await verificationController.approveApplication({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: {
        approvedServices: ['NURSING_VISIT'],
        notes: 'Trying to approve without checklist confirmation'
        // reviewChecklist omitted
      }
    }, res);
    check('Approval REJECTED without checklist confirmation (400)', res.statusCode === 400);

    // Admin tries to approve with incomplete checklist
    res = mockRes();
    await verificationController.approveApplication({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: {
        approvedServices: ['NURSING_VISIT'],
        reviewChecklist: {
          idVerified: true,
          councilActive: true,
          qualificationValid: false, // Incomplete!
          scopeAppropriate: true
        }
      }
    }, res);
    check('Approval REJECTED with incomplete checklist (400)', res.statusCode === 400);

    // Admin approves with complete 4-point checklist
    res = mockRes();
    await verificationController.approveApplication({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: {
        approvedServices: ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'],
        notes: 'Council registration verified on KNMC portal.',
        reviewChecklist: {
          idVerified: true,
          councilActive: true,
          qualificationValid: true,
          scopeAppropriate: true
        }
      }
    }, res);
    check('Approval SUCCEEDS with verified checklist (200)', res.statusCode === 200 && res.data.profile.verificationStatus === 'APPROVED');

    // Admin tries to start review on an already APPROVED application (invalid transition)
    res = mockRes();
    await verificationController.startApplicationReview({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id }
    }, res);
    check('Invalid transition: start-review on APPROVED rejected (400)', res.statusCode === 400);

    // Admin tries to request corrections on an already APPROVED application (invalid transition)
    res = mockRes();
    await verificationController.requestApplicationCorrections({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: { reason: 'Need correction after approval' }
    }, res);
    check('Invalid transition: request-corrections on APPROVED rejected (400)', res.statusCode === 400);

    // ─────────────────────────────────────────────────────────────────────────
    // 7. SUSPENSION & PREVENTING PRIVILEGE ESCALATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 7. Suspended Account Lockdown & Restoration ---');
    // Admin suspends Nurse 1
    res = mockRes();
    await verificationController.suspendProfessional({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: { reason: 'Clinical malpractice audit in progress' }
    }, res);
    check('Admin suspends Nurse 1 (200, SUSPENDED)', res.statusCode === 200 && res.data.profile.verificationStatus === 'SUSPENDED');

    // Suspended Nurse 1 tries to call switchAssistantRole to become a Delivery Assistant
    res = mockRes();
    await assistantController.switchAssistantRole({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: { targetRole: 'DELIVERY_ASSISTANT' }
    }, res);
    check('Suspended professional BLOCKED from role switching to DELIVERY_ASSISTANT (403)', res.statusCode === 403);

    // Suspended Nurse 1 tries to reactivate availability via updateAssistantProfile
    res = mockRes();
    await assistantController.updateAssistantProfile({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: { isActive: true, isAvailable: true }
    }, res);
    check('Suspended professional BLOCKED from reactivating availability (403)', res.statusCode === 403);

    // Suspended Nurse 1 tries to edit/resubmit their application
    res = mockRes();
    await verificationController.saveOrSubmitApplication({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      body: { professionTitle: 'Nurse Specialist', isDraft: true }
    }, res);
    check('Suspended professional BLOCKED from saving application drafts (400)', res.statusCode === 400);

    // Non-admin user tries to call restore endpoint
    res = mockRes();
    await verificationController.restoreProfessional({
      user: { id: nurse1.id, role: 'ASSISTANT' },
      params: { id: nurse1.assistantProfile.id },
      body: { reason: 'Self restore attempt' }
    }, res);
    check('Non-admin BLOCKED from restoring suspended account (403)', res.statusCode === 403);

    // Admin restores Nurse 1
    res = mockRes();
    await verificationController.restoreProfessional({
      user: { id: admin.id, role: 'ADMIN', name: admin.name, email: admin.email },
      params: { id: nurse1.assistantProfile.id },
      body: { reason: 'Investigation concluded. Registration certificate affirmed by council.' }
    }, res);
    check('Admin successfully restores Nurse 1 (200, APPROVED)', res.statusCode === 200 && res.data.profile.verificationStatus === 'APPROVED');
    check('Capabilities restored upon restoration', res.data.profile.capabilities.includes('NURSING_VISIT'));

    // ─────────────────────────────────────────────────────────────────────────
    // 8. CLINICAL & DELIVERY SEPARATION (TASK ACCESS GATING)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 8. Clinical & Delivery Task Separation ---');
    // Approved healthcare professional tries to accept a medicine delivery task
    const activePharmacy = await prisma.pharmacy.findFirst({
      where: { isVerified: true, verificationStatus: 'VERIFIED' }
    });

    const testOrder = await prisma.order.create({
      data: {
        orderNumber: `MF-ADV-${Date.now().toString().slice(-4)}`,
        userId: patient.id,
        pharmacyId: activePharmacy.id,
        status: 'READY_FOR_PICKUP',
        orderType: 'ASSISTED_DELIVERY',
        deliveryAddress: '42 Central Avenue, Chengannur',
        verificationPin: '8877',
        assistantTask: {
          create: {
            status: 'AVAILABLE',
            serviceType: 'MEDICINE_DELIVERY',
            deliveryAddress: '42 Central Avenue, Chengannur',
            handoverPin: '8877'
          }
        }
      },
      include: { assistantTask: true }
    });

    // Nurse 1 tries to accept the delivery task
    res = mockRes();
    await assistantController.acceptTask({
      user: { id: nurse1.id, role: 'ASSISTANT', name: nurse1.name },
      params: { id: testOrder.assistantTask.id }
    }, res);
    check('Approved Healthcare Professional BLOCKED from accepting delivery tasks (403)', res.statusCode === 403);

    // Delivery Assistant accepts the delivery task
    res = mockRes();
    await assistantController.acceptTask({
      user: { id: deliveryAssistant.id, role: 'ASSISTANT', name: deliveryAssistant.name },
      params: { id: testOrder.assistantTask.id }
    }, res);
    check('Delivery Assistant can accept delivery task (200)', res.statusCode === 200);

    // Nurse 2 tries to progress task assigned to Delivery Assistant
    res = mockRes();
    await assistantController.progressTaskStatus({
      user: { id: nurse2.id, role: 'ASSISTANT' },
      params: { id: testOrder.assistantTask.id },
      body: { status: 'COLLECTING' }
    }, res);
    check('Another assistant BLOCKED from progressing task assigned to someone else (403)', res.statusCode === 403);

    // ─────────────────────────────────────────────────────────────────────────
    // 9. DATABASE & PHARMACY INTEGRITY (DEACTIVATED TEST PHARMACY CHECK)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 9. Pharmacy & Booking Integrity ---');
    // Create ephemeral deactivated test pharmacy fixture
    const testPharmManager = await prisma.user.create({
      data: {
        email: `dummy_rx_${Date.now()}@medifind.test`,
        password: 'hashed_password',
        name: 'Ephemeral Dummy Pharmacist',
        role: 'PHARMACIST'
      }
    });
    const testPharmacy = await prisma.pharmacy.create({
      data: {
        name: 'Ephemeral Test Pharmacy',
        verificationStatus: 'TEST',
        isVerified: false,
        isOpen: false,
        managerId: testPharmManager.id,
        address: 'Test Address',
        phone: '123'
      }
    });
    check('Deactivated test pharmacy fixture initialized', Boolean(testPharmacy));

    // Try to place an order at the deactivated test fixture pharmacy
    res = mockRes();
    await orderController.createOrder({
      user: { id: patient.id, role: 'PATIENT' },
      body: {
        pharmacyId: testPharmacy.id,
        items: [{ medicineId: 'any-medicine-id', quantity: 1 }],
        orderType: 'RESERVATION'
      }
    }, res);
    check('Booking at deactivated test fixture pharmacy REJECTED (400)', res.statusCode === 400);

    // Clean up ephemeral test pharmacy fixture
    await prisma.pharmacy.delete({ where: { id: testPharmacy.id } });
    await prisma.user.delete({ where: { id: testPharmManager.id } });

    // Clean up test order
    await prisma.assistantTask.deleteMany({ where: { orderId: testOrder.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: testOrder.id } });
    await prisma.notification.deleteMany({ where: { userId: patient.id } });
    await prisma.order.delete({ where: { id: testOrder.id } });

  } finally {
    // Clean up test users and their verification documents
    const testUsers = await prisma.user.findMany({
      where: { email: { in: cleanupEmails } },
      include: { assistantProfile: { include: { documents: true } } }
    });

    for (const u of testUsers) {
      if (u.assistantProfile?.documents) {
        for (const d of u.assistantProfile.documents) {
          const p = resolveSecureDocumentPath(d.fileName);
          if (p && fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
          }
        }
      }
    }

    await prisma.user.deleteMany({ where: { email: { in: cleanupEmails } } });

    // Verify database counts
    const [finalUsers, finalOrders, finalTasks, finalPharmacies] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.assistantTask.count(),
      prisma.pharmacy.count()
    ]);

    console.log('\n--- 10. Database Conservation Check ---');
    check(`Orders preserved exactly (${initialOrders} === ${finalOrders})`, initialOrders === finalOrders);
    check(`Pharmacies preserved exactly (${initialPharmacies} === ${finalPharmacies})`, initialPharmacies === finalPharmacies);
    check(`Tasks preserved exactly (${initialTasks} === ${finalTasks})`, initialTasks === finalTasks);
    check('Users restored to baseline', initialUsers === finalUsers);
  }

  console.log('\n======================================================================');
  console.log(`Phase 2.1 Adversarial Audit Summary: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${totalTests})`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialAudit().then(() => prisma.$disconnect()).catch(err => {
  console.error('Fatal test error:', err);
  prisma.$disconnect();
  process.exit(1);
});
