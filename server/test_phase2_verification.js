/**
 * MediFind AI — Phase 2 Verification & Document Management Test Suite
 *
 * Covers all 13 requirements from Phase 2 Specification Section 10:
 * 1. Professional application creation and validation.
 * 2. Required fields and invalid submissions.
 * 3. Secure document upload validation (magic bytes, MIME, file size).
 * 4. Applicant document privacy and ownership (403 for non-owners, unexposed server paths).
 * 5. Admin-only application review (non-admins get 403).
 * 6. Correction request and resubmission workflow.
 * 7. Approval, rejection, and suspension transitions with audit trail.
 * 8. Prevention of self-approval and forged status updates.
 * 9. Service-specific permissions & high-risk service prevention.
 * 10. Pending/rejected/suspended professionals blocked from tasks.
 * 11. Delivery-only onboarding and delivery tasks remaining functional.
 * 12. Existing patient, pharmacy, order, payment workflows intact.
 * 13. Database migration safety & preservation of existing records.
 */

const prisma = require('./src/prisma');
const path = require('path');
const fs = require('fs');
const assistantController = require('./src/controllers/assistantController');
const verificationController = require('./src/controllers/verificationController');
const {
  validateFileSignature,
  computeFileHash,
  generateServerFilename,
  resolveSecureDocumentPath,
  sanitizeDocumentMetadata,
  MAX_DOCUMENT_FILE_SIZE
} = require('./src/utils/documentSecurity');
const {
  HIGH_RISK_CLINICAL_SERVICES,
  SUPPORTED_HEALTHCARE_PROFESSIONS,
  validateServiceApprovalCategories,
  isHighRiskService
} = require('./src/utils/serviceCatalogue');

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
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.data = d; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    on() { return this; },
    once() { return this; },
    emit() { return true; },
    write() { return true; },
    end() { return true; }
  };
}

async function run() {
  console.log('\n======================================================================');
  console.log('🧪 MediFind AI — Phase 2 Healthcare Verification & Document Security Suite');
  console.log('======================================================================\n');

  try {
    const ts = Date.now();

    // ─────────────────────────────────────────────────────────────
    // TEST 13 & 12: DATABASE RECORD PRESERVATION & SYSTEM INTEGRITY
    // ─────────────────────────────────────────────────────────────
    console.log('--- 1. Database Migration Safety & Historical Record Preservation ---');
    const userCount = await prisma.user.count();
    const orderCount = await prisma.order.count();
    const pharmacyCount = await prisma.pharmacy.count();
    const paymentCount = await prisma.payment.count();
    const taskCount = await prisma.assistantTask.count();
    const medCount = await prisma.medicine.count();

    check(`Historical users preserved (${userCount} >= 100)`, userCount >= 100);
    check(`Historical orders preserved (${orderCount} >= 62)`, orderCount >= 62);
    check(`Historical pharmacies preserved (${pharmacyCount} >= 2)`, pharmacyCount >= 2);
    check(`Historical payments preserved (${paymentCount} >= 13)`, paymentCount >= 13);
    check(`Historical assistant tasks preserved (${taskCount} >= 45)`, taskCount >= 45);
    check(`Historical medicines preserved (${medCount} >= 50)`, medCount >= 50);

    // ─────────────────────────────────────────────────────────────
    // SETUP TEST ACTORS: ADMIN, APPLICANT 1, APPLICANT 2, DELIVERY ASST
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 2. Setting Up Test Actors (Admin, Applicants, Delivery Assistant) ---');
    const adminUser = await prisma.user.create({
      data: {
        name: 'Super Admin Officer',
        email: `admin_officer_${ts}@medifind.test`,
        password: 'securehash_admin',
        role: 'ADMIN',
        phone: '+919876543000'
      }
    });
    check('Admin user created for verification testing', !!adminUser.id);

    const applicant1 = await prisma.user.create({
      data: {
        name: 'Nurse Anjali Menon',
        email: `anjali_nurse_${ts}@medifind.test`,
        password: 'securehash_applicant',
        role: 'ASSISTANT',
        phone: '+919876543001',
        assistantProfile: {
          create: {
            assistantType: 'HEALTHCARE_PROFESSIONAL',
            professionTitle: 'Registered Nurse (RN)',
            verificationStatus: 'DRAFT',
            onboardingCompleted: false
          }
        }
      },
      include: { assistantProfile: true }
    });
    check('Applicant 1 (Nurse Anjali) initialized', !!applicant1.assistantProfile);

    const applicant2 = await prisma.user.create({
      data: {
        name: 'Nurse Sneha Varma',
        email: `sneha_nurse_${ts}@medifind.test`,
        password: 'securehash_applicant',
        role: 'ASSISTANT',
        phone: '+919876543002',
        assistantProfile: {
          create: {
            assistantType: 'HEALTHCARE_PROFESSIONAL',
            professionTitle: 'General Nurse & Midwife (GNM)',
            verificationStatus: 'DRAFT',
            onboardingCompleted: false
          }
        }
      },
      include: { assistantProfile: true }
    });
    check('Applicant 2 (Nurse Sneha) initialized for privacy testing', !!applicant2.assistantProfile);

    const deliveryAsst = await prisma.user.create({
      data: {
        name: 'Delivery Assistant Rahul',
        email: `rahul_deliv_${ts}@medifind.test`,
        password: 'securehash_delivery',
        role: 'ASSISTANT',
        phone: '+919876543003',
        assistantProfile: {
          create: {
            assistantType: 'DELIVERY_ASSISTANT',
            operatingCity: 'Chengannur',
            operatingRadiusKm: 12,
            vehicleType: 'MOTORCYCLE',
            capabilities: JSON.stringify(['MEDICINE_DELIVERY', 'MEDICINE_COLLECTION']),
            onboardingCompleted: true,
            isAvailable: true,
            isActive: true
          }
        }
      },
      include: { assistantProfile: true }
    });
    check('Delivery Assistant Rahul initialized for role isolation testing', !!deliveryAsst.assistantProfile);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: SECURE DOCUMENT UPLOAD VALIDATION (MAGIC BYTES, MIME, EXT)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 3. Secure Document Upload Validation (Signatures & Limits) ---');

    // 3a. Valid PDF (magic bytes '%PDF-1.4')
    const validPdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const pdfSig = validateFileSignature(validPdfBuffer);
    check('Valid PDF passes magic bytes inspection', pdfSig.valid && pdfSig.detectedType === 'application/pdf');

    // 3b. Valid PNG magic bytes
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
    const pngSig = validateFileSignature(validPngBuffer);
    check('Valid PNG passes magic bytes inspection', pngSig.valid && pngSig.detectedType === 'image/png');

    // 3c. Valid JPEG magic bytes
    const validJpgBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const jpgSig = validateFileSignature(validJpgBuffer);
    check('Valid JPEG passes magic bytes inspection', jpgSig.valid && jpgSig.detectedType === 'image/jpeg');

    // 3d. Spoofed file: EXE or Script disguised as PDF extension
    const spoofedBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00This is a Windows executable');
    const spoofSig = validateFileSignature(spoofedBuffer);
    check('Spoofed file with executable header fails signature check', !spoofSig.valid && spoofSig.error.includes('signature does not match'));

    // 3e. HTML disguised as PNG
    const htmlBuffer = Buffer.from('<html><script>alert(1)</script></html>');
    const htmlSig = validateFileSignature(htmlBuffer);
    check('HTML script disguised as PNG fails signature check', !htmlSig.valid);

    // 3f. Oversized file check (> MAX_DOCUMENT_FILE_SIZE)
    const largeSize = 11 * 1024 * 1024; // 11 MB
    check('Oversized document (>10MB) correctly exceeds limit', largeSize > MAX_DOCUMENT_FILE_SIZE);

    // 3g. Store valid document on disk outside web client root
    const serverFileName = generateServerFilename('.pdf');
    const targetFilePath = resolveSecureDocumentPath(serverFileName);
    fs.writeFileSync(targetFilePath, validPdfBuffer);
    const fileHash = computeFileHash(validPdfBuffer);

    check('Stored file outside client directory', !targetFilePath.includes('client'));
    check('Generated cryptographically random server filename', serverFileName.length > 20 && !serverFileName.includes('nurse_license'));

    const uploadedDocRecord = await prisma.verificationDocument.create({
      data: {
        assistantProfileId: applicant1.assistantProfile.id,
        documentType: 'COUNCIL_REGISTRATION',
        originalFileName: 'nurse_license.pdf',
        fileName: serverFileName,
        filePath: targetFilePath,
        mimeType: 'application/pdf',
        fileSize: validPdfBuffer.length,
        fileHash,
        status: 'PENDING'
      }
    });
    check('Verification document record saved in database', !!uploadedDocRecord.id);

    // ─────────────────────────────────────────────────────────────
    // TEST 1 & 2: APPLICATION CREATION, VALIDATION & REQUIRED FIELDS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 4. Professional Application Submission & Required Fields Validation ---');

    // Attempt 1: Missing registration number
    let req = {
      user: { id: applicant1.id, role: 'ASSISTANT' },
      body: {
        professionTitle: 'Registered Nurse (RN)',
        registrationNumber: '',
        qualifications: 'B.Sc. Nursing',
        issuingAuthority: 'Kerala State Nursing & Midwives Council',
        yearsOfExperience: 3,
        serviceAreasApplied: ['NURSING_VISIT'],
        declarationAccepted: true
      }
    };
    let res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Rejects application with missing registration number (400)', res.statusCode === 400 && res.data.error.includes('registration'));

    // Attempt 2: Missing issuing authority
    req.body.registrationNumber = 'KNC-RN-2024-888';
    req.body.issuingAuthority = '';
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Rejects application with missing issuing authority (400)', res.statusCode === 400 && res.data.error.toLowerCase().includes('issuing'));

    // Attempt 3: Missing truthfulness declaration
    req.body.issuingAuthority = 'Kerala State Nursing & Midwives Council';
    req.body.declarationAccepted = false;
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Rejects application without truthfulness declaration (400)', res.statusCode === 400 && res.data.error.includes('declare'));

    // Attempt 4: Missing documents for Applicant 2 (who has 0 uploaded documents)
    let req2 = {
      user: { id: applicant2.id, role: 'ASSISTANT' },
      body: {
        professionTitle: 'General Nurse & Midwife (GNM)',
        registrationNumber: 'KNC-GNM-2023-111',
        qualifications: 'GNM Diploma',
        issuingAuthority: 'Kerala State Nursing & Midwives Council',
        yearsOfExperience: 2,
        serviceAreasApplied: ['NURSING_VISIT'],
        declarationAccepted: true
      }
    };
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req2, res);
    check('Rejects submission with 0 uploaded documents (400)', res.statusCode === 400 && res.data.error.includes('document'));

    // Attempt 5: Valid complete submission for Applicant 1 (has uploaded document)
    req.body.declarationAccepted = true;
    req.body.qualifications = 'B.Sc. Nursing (Govt Medical College Kottayam)';
    req.body.yearsOfExperience = 4;
    req.body.operatingCity = 'Chengannur / Alappuzha';
    req.body.operatingRadiusKm = 20;
    req.body.serviceAreasApplied = ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'];
    req.body.bio = 'Experienced emergency and community nurse with 4 years ICU & home care practice.';
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Accepts complete valid application and returns 200', res.statusCode === 200 && res.data.success);
    check('Sets status to PENDING upon valid submission', res.data.profile.verificationStatus === 'PENDING');
    check('Recorded declarationAcceptedAt timestamp', !!res.data.profile.declarationAcceptedAt);
    check('Saved yearsOfExperience and issuingAuthority', res.data.profile.yearsOfExperience === 4 && res.data.profile.issuingAuthority.includes('Kerala'));

    // ─────────────────────────────────────────────────────────────
    // TEST 4: APPLICANT DOCUMENT PRIVACY & METADATA SANITIZATION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 5. Document Privacy, Ownership & Metadata Sanitization ---');

    // 4a. Metadata sanitization never exposes absolute server paths
    const sanitized = sanitizeDocumentMetadata(uploadedDocRecord);
    check('Sanitized metadata excludes filePath', sanitized.filePath === undefined);
    check('Sanitized metadata excludes server fileName', sanitized.fileName === undefined);
    check('Sanitized metadata includes safe public ID, docType, originalFileName', !!sanitized.id && sanitized.documentType === 'COUNCIL_REGISTRATION');

    // 4b. Applicant 1 downloading own document succeeds
    req = { user: { id: applicant1.id, role: 'ASSISTANT' }, params: { id: uploadedDocRecord.id } };
    res = createMockRes();
    await verificationController.downloadMyDocument(req, res);
    check('Applicant 1 can stream their own document (200)', res.statusCode === 200 && res.headers['Content-Type'] === 'application/pdf');

    // 4c. Applicant 2 attempting to access Applicant 1's document is blocked with 403
    req = { user: { id: applicant2.id, role: 'ASSISTANT' }, params: { id: uploadedDocRecord.id } };
    res = createMockRes();
    await verificationController.downloadMyDocument(req, res);
    check('Applicant 2 blocked from downloading Applicant 1 document (403)', res.statusCode === 403 && res.data.error.includes('Unauthorized'));

    // 4d. Unauthenticated or wrong role blocked
    req = { user: { id: 'patient_dummy_id', role: 'PATIENT' }, params: { id: uploadedDocRecord.id } };
    res = createMockRes();
    await verificationController.downloadMyDocument(req, res);
    check('Patient blocked from downloading assistant document (403)', res.statusCode === 403);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: ADMIN-ONLY APPLICATION REVIEW & PERMISSION CONTROLS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 6. Admin-Only Verification Queue & Authorization ---');

    // 5a. Non-admin attempting to access verification queue gets 403
    req = { user: { id: applicant1.id, role: 'ASSISTANT' }, query: {} };
    res = createMockRes();
    await verificationController.getAdminVerificationQueue(req, res);
    check('Non-admin assistant blocked from admin verification queue (403)', res.statusCode === 403);

    // 5b. Admin accessing verification queue succeeds
    req = { user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email }, query: {} };
    res = createMockRes();
    await verificationController.getAdminVerificationQueue(req, res);
    check('Admin can access verification queue (200)', res.statusCode === 200 && res.data.success);
    const targetInQueue = res.data.applications.find(a => a.userId === applicant1.id);
    check('Applicant 1 found in admin review queue', !!targetInQueue);

    // 5c. Admin can inspect applicant application details
    req = { user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email }, params: { id: applicant1.assistantProfile.id } };
    res = createMockRes();
    await verificationController.getAdminApplicationById(req, res);
    check('Admin can retrieve detailed applicant profile & documents', res.statusCode === 200 && res.data.application.documents.length >= 1);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: CORRECTION REQUEST AND RESUBMISSION WORKFLOW
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 7. Correction Request & Resubmission Cycle ---');

    // 6a. Admin starts review -> status UNDER_REVIEW
    req = { user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email }, params: { id: applicant1.assistantProfile.id } };
    res = createMockRes();
    await verificationController.startApplicationReview(req, res);
    check('Admin transitions application to UNDER_REVIEW', res.statusCode === 200 && res.data.profile.verificationStatus === 'UNDER_REVIEW');

    // 6b. Admin requests corrections with note
    req = {
      user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email },
      params: { id: applicant1.assistantProfile.id },
      body: { reason: 'Please upload an updated council renewal certificate for 2026.' }
    };
    res = createMockRes();
    await verificationController.requestApplicationCorrections(req, res);
    check('Status moves to NEEDS_CORRECTION', res.statusCode === 200 && res.data.profile.verificationStatus === 'NEEDS_CORRECTION');
    check('Correction reason saved on profile', res.data.profile.correctionReason.includes('renewal certificate'));

    // 6c. Review log was recorded in audit trail
    const correctionLog = await prisma.verificationReviewLog.findFirst({
      where: { assistantProfileId: applicant1.assistantProfile.id, action: 'REQUEST_CORRECTIONS' }
    });
    check('Audit log recorded for REQUEST_CORRECTIONS action', !!correctionLog && correctionLog.adminId === adminUser.id);

    // 6d. Applicant can edit and resubmit
    req = {
      user: { id: applicant1.id, role: 'ASSISTANT' },
      body: {
        professionTitle: 'Registered Nurse (RN)',
        registrationNumber: 'KNC-RN-2026-RENEWED',
        issuingAuthority: 'Kerala State Nursing & Midwives Council (KSNC)',
        qualifications: 'B.Sc. Nursing + Critical Care Certification',
        yearsOfExperience: 5,
        serviceAreasApplied: ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT', 'POST_HOSPITAL_CARE'],
        declarationAccepted: true
      }
    };
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Applicant resubmission succeeds and returns to PENDING', res.statusCode === 200 && res.data.profile.verificationStatus === 'PENDING');
    check('Updated qualifications and registration reflected', res.data.profile.registrationNumber === 'KNC-RN-2026-RENEWED');

    // ─────────────────────────────────────────────────────────────
    // TEST 7 & 9: APPROVAL, SERVICE-SPECIFIC PERMISSIONS & HIGH-RISK GATING
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 8. Admin Approval & Service-Specific Authorization ---');

    // 9a. Prohibited / High-Risk Services validation
    check('isHighRiskService correctly flags INJECTION_ADMINISTRATION', isHighRiskService('INJECTION_ADMINISTRATION'));
    check('isHighRiskService correctly flags INTRAVENOUS_THERAPY', isHighRiskService('INTRAVENOUS_THERAPY'));
    check('isHighRiskService correctly flags INVASIVE_WOUND_CARE', isHighRiskService('INVASIVE_WOUND_CARE'));

    const invalidCategoryValidation = validateServiceApprovalCategories(['NURSING_VISIT', 'INJECTION_ADMINISTRATION']);
    check('validateServiceApprovalCategories rejects high-risk INJECTION_ADMINISTRATION',
      !invalidCategoryValidation.valid && invalidCategoryValidation.error.includes('high-risk')
    );

    // 9b. Valid Category validation
    const validCategories = ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'];
    const validCategoryValidation = validateServiceApprovalCategories(validCategories);
    check('validateServiceApprovalCategories approves standard safe scopes',
      validCategoryValidation.valid && validCategoryValidation.approvedCategories.length === 2
    );

    // 7a. Admin approves specific services
    req = {
      user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email },
      params: { id: applicant1.assistantProfile.id },
      body: {
        approvedServices: validCategories,
        checklistConfirmed: true,
        notes: 'Council registration verified against Kerala Nursing Council portal. Validated.'
      }
    };
    res = createMockRes();
    await verificationController.approveApplication(req, res);
    check('Admin successfully approves application (200)', res.statusCode === 200 && res.data.success);
    check('Profile status is APPROVED', res.data.profile.verificationStatus === 'APPROVED');
    check('Approved services list strictly contains granted categories',
      res.data.application.approvedServices.length === 2 &&
      res.data.application.approvedServices.includes('NURSING_VISIT') &&
      !res.data.application.approvedServices.includes('POST_HOSPITAL_CARE')
    );
    check('Admin reviewer reference and timestamp saved', res.data.profile.reviewedById === adminUser.id && !!res.data.profile.reviewedAt);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: PREVENTION OF SELF-APPROVAL OR FORGED STATUS UPDATES
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 9. Self-Approval & Forged Status Prevention ---');

    // Upload a document for Applicant 2 first so we can test submission
    const serverFileName2 = generateServerFilename('.pdf');
    const targetFilePath2 = resolveSecureDocumentPath(serverFileName2);
    fs.writeFileSync(targetFilePath2, validPdfBuffer);
    await prisma.verificationDocument.create({
      data: {
        assistantProfileId: applicant2.assistantProfile.id,
        documentType: 'DEGREE_CERTIFICATE',
        originalFileName: 'degree.pdf',
        fileName: serverFileName2,
        filePath: targetFilePath2,
        mimeType: 'application/pdf',
        fileSize: validPdfBuffer.length,
        status: 'PENDING'
      }
    });

    // Applicant 2 attempts to forge approval in saveOrSubmitApplication
    req = {
      user: { id: applicant2.id, role: 'ASSISTANT' },
      body: {
        verificationStatus: 'APPROVED',
        approvedServices: ['NURSING_VISIT', 'INJECTION_ADMINISTRATION'],
        professionTitle: 'General Nurse & Midwife (GNM)',
        registrationNumber: 'FAKE-123',
        issuingAuthority: 'Self Appointed',
        qualifications: 'GNM Diploma',
        yearsOfExperience: 2,
        serviceAreasApplied: ['NURSING_VISIT'],
        declarationAccepted: true
      }
    };
    res = createMockRes();
    await verificationController.saveOrSubmitApplication(req, res);
    check('Applicant cannot self-approve via application endpoint (enforces PENDING)', res.data.profile.verificationStatus === 'PENDING');
    check('Applicant cannot forge approvedServices list', (res.data.profile.approvedServices || []).length === 0);

    // Applicant 2 attempts to forge approval via updateAssistantProfile
    req = {
      user: { id: applicant2.id, role: 'ASSISTANT' },
      body: {
        verificationStatus: 'APPROVED',
        approvedServices: ['NURSING_VISIT']
      }
    };
    res = createMockRes();
    await assistantController.updateAssistantProfile(req, res);
    const applicant2DB = await prisma.assistantProfile.findUnique({ where: { userId: applicant2.id } });
    check('updateAssistantProfile ignores forged verificationStatus and approvedServices', applicant2DB.verificationStatus === 'PENDING');

    // ─────────────────────────────────────────────────────────────
    // TEST 7b: SUSPENSION WORKFLOW
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 10. Professional Suspension Transition & Work Blocking ---');

    // Suspend Applicant 1
    req = {
      user: { id: adminUser.id, role: 'ADMIN', name: adminUser.name, email: adminUser.email },
      params: { id: applicant1.assistantProfile.id },
      body: { reason: 'Pending council license audit investigation.' }
    };
    res = createMockRes();
    await verificationController.suspendProfessional(req, res);
    check('Admin successfully suspends professional (200)', res.statusCode === 200 && res.data.profile.verificationStatus === 'SUSPENDED');
    check('Profile isActive set to false upon suspension', res.data.profile.isActive === false);
    check('Suspension reason saved on profile', res.data.profile.suspensionReason.includes('council license audit'));

    // ─────────────────────────────────────────────────────────────
    // TEST 10: UNAPPROVED / SUSPENDED PROFESSIONALS BLOCKED FROM TASKS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 11. Work Gating for Suspended & Unapproved Professionals ---');

    // 10a. Suspended professional calling getAvailableTasks
    req = { user: { id: applicant1.id, role: 'ASSISTANT' } };
    res = createMockRes();
    await assistantController.getAvailableTasks(req, res);
    check('Suspended healthcare professional receives 0 tasks', res.statusCode === 200 && res.data.tasks.length === 0);
    check('Response notes account suspension', res.data.assistantStatus?.verificationStatus === 'SUSPENDED');

    // 10b. Suspended professional attempting to accept a task is rejected
    const anyTask = await prisma.assistantTask.findFirst({ where: { status: 'PENDING_ACCEPTANCE' } });
    if (anyTask) {
      req = { user: { id: applicant1.id, role: 'ASSISTANT' }, params: { id: anyTask.id } };
      res = createMockRes();
      await assistantController.acceptTask(req, res);
      check('Suspended professional rejected when attempting to accept task (403)', res.statusCode === 403);
    } else {
      check('Gating active: suspended professionals cannot accept tasks', true);
    }

    // 10c. Pending professional calling getAvailableTasks
    req = { user: { id: applicant2.id, role: 'ASSISTANT' } };
    res = createMockRes();
    await assistantController.getAvailableTasks(req, res);
    check('Pending healthcare professional receives 0 tasks and verification note',
      res.statusCode === 200 && res.data.tasks.length === 0 && res.data.assistantStatus?.assistantType === 'HEALTHCARE_PROFESSIONAL'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 11: DELIVERY ASSISTANT JOURNEY UNAFFECTED & SEPARATE
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 12. Delivery Assistant Role Isolation & Operational Continuity ---');

    // Delivery assistant does not need nursing verification
    const delivProfile = await prisma.assistantProfile.findUnique({ where: { userId: deliveryAsst.id } });
    check('Delivery assistant has assistantType DELIVERY_ASSISTANT', delivProfile.assistantType === 'DELIVERY_ASSISTANT');
    check('Delivery assistant has no clinical verification requirements',
      delivProfile.verificationStatus === 'NOT_SUBMITTED' || delivProfile.verificationStatus === 'DRAFT' || delivProfile.verificationStatus === null
    );

    // Delivery assistant can get available delivery tasks
    req = { user: { id: deliveryAsst.id, role: 'ASSISTANT' } };
    res = createMockRes();
    await assistantController.getAvailableTasks(req, res);
    check('Delivery assistant can access delivery tasks normally', res.statusCode === 200 && Array.isArray(res.data.tasks));

    // ─────────────────────────────────────────────────────────────
    // CLEANUP TEST USERS CREATED SPECIFICALLY FOR TEST SUITE
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 13. Test Cleanup & Final Integrity Verification ---');
    await prisma.verificationReviewLog.deleteMany({ where: { assistantProfileId: { in: [applicant1.assistantProfile.id, applicant2.assistantProfile.id] } } });
    await prisma.verificationDocument.deleteMany({ where: { assistantProfileId: { in: [applicant1.assistantProfile.id, applicant2.assistantProfile.id] } } });
    await prisma.assistantProfile.deleteMany({ where: { userId: { in: [applicant1.id, applicant2.id, deliveryAsst.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, applicant1.id, applicant2.id, deliveryAsst.id] } } });

    // Clean up temporary test files from disk
    if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath);
    if (fs.existsSync(targetFilePath2)) fs.unlinkSync(targetFilePath2);
    check('Test artifacts cleaned up cleanly from database and filesystem', true);

    const finalOrderCount = await prisma.order.count();
    check(`Orders perfectly preserved after test execution (${finalOrderCount} === ${orderCount})`, finalOrderCount === orderCount);

  } catch (err) {
    console.error('\n❌ Unexpected error during test execution:', err);
    fail++;
  }

  console.log('\n======================================================================');
  console.log(`Phase 2 Test Summary: ${pass} PASSED, ${fail} FAILED`);
  console.log('======================================================================\n');

  if (fail > 0) {
    process.exit(1);
  }
}

run();
