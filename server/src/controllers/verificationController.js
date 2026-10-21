const path = require('path');
const fs = require('fs');
const prisma = require('../prisma');
const {
  DOCUMENTS_UPLOAD_DIR,
  validateFileSignature,
  computeFileHash,
  generateServerFilename,
  resolveSecureDocumentPath,
  safeDeleteDocument,
  sanitizeDocumentMetadata,
  MAX_DOCUMENT_FILE_SIZE,
  ALLOWED_EXTENSIONS
} = require('../utils/documentSecurity');
const {
  FUTURE_CLINICAL_SERVICE_TYPES,
  DELIVERY_SERVICE_TYPES,
  HIGH_RISK_CLINICAL_SERVICES,
  SUPPORTED_DOCUMENT_TYPES,
  SUPPORTED_HEALTHCARE_PROFESSIONS,
  APPLICATION_STATUSES,
  validateServiceApprovalCategories,
  isHighRiskService
} = require('../utils/serviceCatalogue');

/**
 * Helper to parse JSON or comma-delimited strings safely.
 */
function parseJsonArray(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Format complete professional application response for applicant and admin.
 */
function formatApplicationPayload(profile, user, documents = [], reviewLogs = []) {
  const serviceAreasApplied = parseJsonArray(profile.serviceAreasApplied);
  const approvedServices = parseJsonArray(profile.approvedServices);

  return {
    id: profile.id,
    userId: user?.id || profile.userId,
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    role: user?.role || 'ASSISTANT',
    assistantType: profile.assistantType,
    onboardingCompleted: profile.onboardingCompleted,
    onboardingStep: profile.onboardingStep,

    // Professional Profile Data
    professionTitle: profile.professionTitle || null,
    registrationNumber: profile.registrationNumber || null,
    qualifications: profile.qualifications || null,
    issuingAuthority: profile.issuingAuthority || null,
    yearsOfExperience: profile.yearsOfExperience != null ? profile.yearsOfExperience : null,
    operatingCity: profile.operatingCity || 'Chengannur',
    operatingRadiusKm: profile.operatingRadiusKm != null ? profile.operatingRadiusKm : 10,
    bio: profile.bio || '',

    // Clinical Services
    serviceAreasApplied,
    approvedServices,

    // Lifecycle Status
    verificationStatus: profile.verificationStatus || APPLICATION_STATUSES.DRAFT,
    verificationNotes: profile.verificationNotes || null,
    rejectionReason: profile.rejectionReason || null,
    correctionReason: profile.correctionReason || null,
    suspensionReason: profile.suspensionReason || null,

    // Declaration & Timestamps
    declarationAccepted: Boolean(profile.declarationAccepted),
    declarationAcceptedAt: profile.declarationAcceptedAt || null,
    submittedAt: profile.submittedAt || null,
    reviewedAt: profile.reviewedAt || null,
    reviewedById: profile.reviewedById || null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,

    // Documents and Audit Logs (Sanitized)
    documents: (documents || []).map(sanitizeDocumentMetadata),
    reviewLogs: (reviewLogs || []).map(log => ({
      id: log.id,
      action: log.action,
      previousStatus: log.previousStatus,
      newStatus: log.newStatus,
      reason: log.reason,
      approvedServices: parseJsonArray(log.approvedServices),
      adminName: log.adminName,
      createdAt: log.createdAt
    }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICANT WORKFLOWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/assistant/application
 * Returns current professional application, uploaded documents, and review history.
 */
async function getMyApplication(req, res) {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        assistantProfile: {
          include: {
            documents: { orderBy: { uploadedAt: 'desc' } },
            reviewLogs: { orderBy: { createdAt: 'desc' } }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (!user.assistantProfile) {
      return res.status(404).json({ success: false, error: 'Assistant profile not initialized.' });
    }

    const profile = user.assistantProfile;
    return res.json({
      success: true,
      application: formatApplicationPayload(profile, user, profile.documents, profile.reviewLogs),
      supportedDocumentTypes: SUPPORTED_DOCUMENT_TYPES,
      supportedProfessions: SUPPORTED_HEALTHCARE_PROFESSIONS,
      candidateClinicalServices: FUTURE_CLINICAL_SERVICE_TYPES
    });
  } catch (err) {
    console.error('getMyApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve application details.' });
  }
}

/**
 * POST /api/assistant/application
 * Drafts or submits professional application with strict server-side validation.
 *
 * Rules:
 * - isDraft: true -> saves partial state as DRAFT.
 * - Submission (isDraft: false / omitted):
 *   - Requires professionTitle, registrationNumber, qualifications, issuingAuthority,
 *     yearsOfExperience, operatingCity, serviceAreasApplied, declarationAccepted = true.
 *   - Requires at least 1 uploaded document.
 *   - Transitions status strictly to PENDING.
 *   - Applicant CANNOT set their own verificationStatus to APPROVED or change reviewer fields.
 */
async function saveOrSubmitApplication(req, res) {
  try {
    const userId = req.user.id;
    const {
      professionTitle,
      registrationNumber,
      qualifications,
      issuingAuthority,
      yearsOfExperience,
      operatingCity,
      operatingRadiusKm,
      serviceAreasApplied,
      bio,
      declarationAccepted,
      isDraft = false
    } = req.body;

    // Security check: Ignore any client attempts to forge verificationStatus, reviewedBy, or approvedServices
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { assistantProfile: { include: { documents: true } } }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    let profile = user.assistantProfile;
    if (!profile) {
      profile = await prisma.assistantProfile.create({
        data: {
          userId,
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          onboardingStep: 'PROFESSIONAL_APPLICATION',
          verificationStatus: APPLICATION_STATUSES.DRAFT
        },
        include: { documents: true }
      });
    }

    // Gating: If application is already APPROVED, UNDER_REVIEW, or SUSPENDED, prevent direct editing without correction request
    if (profile.verificationStatus === APPLICATION_STATUSES.APPROVED) {
      return res.status(400).json({
        success: false,
        error: 'Your application is already APPROVED. Modifications require administrator authorization.'
      });
    }
    if (profile.verificationStatus === APPLICATION_STATUSES.UNDER_REVIEW) {
      return res.status(400).json({
        success: false,
        error: 'Your application is currently UNDER_REVIEW by administrators. Edits are locked until review concludes.'
      });
    }
    if (profile.verificationStatus === APPLICATION_STATUSES.SUSPENDED) {
      return res.status(400).json({
        success: false,
        error: `Your account is currently SUSPENDED (${profile.suspensionReason || 'Administrator suspension in effect'}). Application edits and resubmissions are locked.`
      });
    }

    // DRAFT saving mode
    if (isDraft) {
      const draftUpdate = {
        assistantType: 'HEALTHCARE_PROFESSIONAL',
        onboardingStep: 'PROFESSIONAL_APPLICATION',
        verificationStatus: profile.verificationStatus === APPLICATION_STATUSES.NEEDS_CORRECTION
          ? APPLICATION_STATUSES.NEEDS_CORRECTION
          : APPLICATION_STATUSES.DRAFT,
        professionTitle: professionTitle ? String(professionTitle).trim() : profile.professionTitle,
        registrationNumber: registrationNumber ? String(registrationNumber).trim() : profile.registrationNumber,
        qualifications: qualifications ? String(qualifications).trim() : profile.qualifications,
        issuingAuthority: issuingAuthority ? String(issuingAuthority).trim() : profile.issuingAuthority,
        yearsOfExperience: yearsOfExperience !== undefined ? parseInt(yearsOfExperience, 10) || null : profile.yearsOfExperience,
        operatingCity: operatingCity ? String(operatingCity).trim() : profile.operatingCity,
        operatingRadiusKm: operatingRadiusKm ? parseFloat(operatingRadiusKm) || profile.operatingRadiusKm : profile.operatingRadiusKm,
        bio: bio !== undefined ? String(bio).trim() : profile.bio
      };

      if (serviceAreasApplied) {
        draftUpdate.serviceAreasApplied = JSON.stringify(parseJsonArray(serviceAreasApplied));
      }

      const updated = await prisma.assistantProfile.update({
        where: { id: profile.id },
        data: draftUpdate,
        include: { documents: true, reviewLogs: true }
      });

      return res.json({
        success: true,
        message: 'Application draft saved successfully.',
        application: formatApplicationPayload(updated, user, updated.documents, updated.reviewLogs)
      });
    }

    // FULL SUBMISSION VALIDATION
    if (!professionTitle || !String(professionTitle).trim()) {
      return res.status(400).json({ success: false, error: 'Professional category / title is required.' });
    }
    if (!registrationNumber || !String(registrationNumber).trim()) {
      return res.status(400).json({ success: false, error: 'Professional council registration or license number is required.' });
    }
    if (!qualifications || !String(qualifications).trim()) {
      return res.status(400).json({ success: false, error: 'Qualifications and relevant training details are required.' });
    }
    if (!issuingAuthority || !String(issuingAuthority).trim()) {
      return res.status(400).json({ success: false, error: 'Issuing regulatory authority or nursing council is required.' });
    }
    const parsedYears = parseInt(yearsOfExperience, 10);
    if (isNaN(parsedYears) || parsedYears < 0 || parsedYears > 60) {
      return res.status(400).json({ success: false, error: 'Years of clinical experience must be a valid number between 0 and 60.' });
    }

    // Clinical services validation
    const candidateKeys = Object.keys(FUTURE_CLINICAL_SERVICE_TYPES);
    const parsedServices = parseJsonArray(serviceAreasApplied).filter(s => candidateKeys.includes(s));
    if (parsedServices.length === 0) {
      return res.status(400).json({
        success: false,
        error: `Please select at least one supported clinical service category. Supported options: ${candidateKeys.join(', ')}`
      });
    }

    // Check prohibited services
    for (const s of parseJsonArray(serviceAreasApplied)) {
      if (isHighRiskService(s)) {
        return res.status(400).json({
          success: false,
          error: `Service '${s}' is a prohibited high-risk procedure and cannot be requested.`
        });
      }
    }

    // Declaration requirement
    if (declarationAccepted !== true && declarationAccepted !== 'true') {
      return res.status(400).json({
        success: false,
        error: 'You must declare that all supplied professional information and certificates are true and accurate.'
      });
    }

    // Verification Document check
    const currentDocs = profile.documents || [];
    if (currentDocs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please upload at least one required verification document (e.g., Council Registration Certificate).'
      });
    }

    // Check radius
    let parsedRadius = profile.operatingRadiusKm || 10.0;
    if (operatingRadiusKm !== undefined) {
      const r = parseFloat(operatingRadiusKm);
      if (!isNaN(r) && r >= 1 && r <= 50) {
        parsedRadius = r;
      }
    }

    // Execute submission in a transaction with audit log
    const prevStatus = profile.verificationStatus;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.assistantProfile.update({
        where: { id: profile.id },
        data: {
          assistantType: 'HEALTHCARE_PROFESSIONAL',
          onboardingStep: 'COMPLETED',
          onboardingCompleted: true,
          professionTitle: String(professionTitle).trim(),
          registrationNumber: String(registrationNumber).trim(),
          qualifications: String(qualifications).trim(),
          issuingAuthority: String(issuingAuthority).trim(),
          yearsOfExperience: parsedYears,
          operatingCity: operatingCity ? String(operatingCity).trim() : 'Chengannur',
          operatingRadiusKm: parsedRadius,
          serviceAreasApplied: JSON.stringify(parsedServices),
          bio: bio ? String(bio).trim() : profile.bio,
          declarationAccepted: true,
          declarationAcceptedAt: now,
          verificationStatus: APPLICATION_STATUSES.PENDING,
          correctionReason: null, // Clear past correction request upon new submission
          submittedAt: now,
          capabilities: '' // Strictly no active capabilities until approved
        },
        include: { documents: true, reviewLogs: true }
      });

      // Create Audit Log
      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: profile.id,
          adminId: userId,
          adminName: user.name,
          adminEmail: user.email,
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.PENDING,
          action: prevStatus === APPLICATION_STATUSES.NEEDS_CORRECTION ? 'RESUBMIT' : 'SUBMIT_APPLICATION',
          reason: 'Applicant submitted complete professional application with declaration.'
        }
      });

      return updated;
    });

    return res.json({
      success: true,
      message: 'Professional application submitted successfully! Your application is now PENDING administrator review.',
      profile: result,
      application: formatApplicationPayload(result, user, result.documents, result.reviewLogs)
    });
  } catch (err) {
    console.error('saveOrSubmitApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process professional application.' });
  }
}

/**
 * POST /api/assistant/documents
 * Securely uploads a supporting document (PDF, JPEG, PNG).
 * Server validates MIME, file extension, magic numbers, and calculates SHA-256 hash.
 * Stores outside public directory with server-controlled filename.
 */
async function uploadVerificationDocument(req, res) {
  try {
    const userId = req.user.id;
    const { documentType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No document file was uploaded.' });
    }

    if (!documentType || !SUPPORTED_DOCUMENT_TYPES[documentType]) {
      return res.status(400).json({
        success: false,
        error: `Invalid document type. Must be one of: ${Object.keys(SUPPORTED_DOCUMENT_TYPES).join(', ')}`
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { assistantProfile: true }
    });

    if (!user || !user.assistantProfile) {
      return res.status(404).json({ success: false, error: 'Assistant profile not found.' });
    }

    const profile = user.assistantProfile;

    // Disallow modifying documents when under active review, approved, or suspended
    if (
      profile.verificationStatus === APPLICATION_STATUSES.UNDER_REVIEW ||
      profile.verificationStatus === APPLICATION_STATUSES.APPROVED ||
      profile.verificationStatus === APPLICATION_STATUSES.SUSPENDED
    ) {
      return res.status(400).json({
        success: false,
        error: `Cannot upload documents while application status is ${profile.verificationStatus}.`
      });
    }

    // Validate buffer / file signature
    const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
    if (!buffer) {
      return res.status(400).json({ success: false, error: 'Could not read uploaded file content.' });
    }

    const sigResult = validateFileSignature(buffer);
    if (!sigResult.valid) {
      // Clean up temp file if disk storage was used
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ success: false, error: sigResult.error });
    }

    // Verify extension matches
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ success: false, error: 'File extension not authorized. Only PDF, JPEG, and PNG allowed.' });
    }

    // Generate server-controlled filename and target path
    const serverFileName = generateServerFilename(ext);
    const targetPath = resolveSecureDocumentPath(serverFileName);
    if (!targetPath) {
      return res.status(500).json({ success: false, error: 'Failed to generate secure storage path.' });
    }

    // Write file securely to DOCUMENTS_UPLOAD_DIR
    fs.writeFileSync(targetPath, buffer);

    // Compute hash
    const fileHash = computeFileHash(buffer);

    let documentRecord;
    try {
      // Save DB record
      documentRecord = await prisma.verificationDocument.create({
        data: {
          assistantProfileId: profile.id,
          documentType,
          originalFileName: path.basename(file.originalname),
          fileName: serverFileName,
          filePath: serverFileName, // Storing only filename, not sensitive system path
          fileSize: buffer.length,
          mimeType: sigResult.detectedType,
          fileHash,
          status: 'PENDING'
        }
      });
    } catch (dbErr) {
      // Clean up written file immediately if database insertion fails to prevent orphaned files
      if (fs.existsSync(targetPath)) {
        try { fs.unlinkSync(targetPath); } catch (e) {}
      }
      throw dbErr;
    }

    // Clean up temporary multer file if applicable
    if (file.path && fs.existsSync(file.path) && file.path !== targetPath) {
      try { fs.unlinkSync(file.path); } catch (e) {}
    }

    return res.status(201).json({
      success: true,
      message: 'Verification document uploaded successfully.',
      document: sanitizeDocumentMetadata(documentRecord)
    });
  } catch (err) {
    console.error('uploadVerificationDocument error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload verification document.' });
  }
}

/**
 * DELETE /api/assistant/documents/:id
 * Removes an uploaded document in DRAFT or NEEDS_CORRECTION state.
 */
async function deleteVerificationDocument(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const doc = await prisma.verificationDocument.findUnique({
      where: { id },
      include: { assistantProfile: true }
    });

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    // Authorization: Must belong to requesting assistant or admin
    if (doc.assistantProfile.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized to delete this document.' });
    }

    // Strict status gating: documents can only be deleted during DRAFT or NEEDS_CORRECTION
    const status = doc.assistantProfile.verificationStatus;
    if (
      status === APPLICATION_STATUSES.PENDING ||
      status === APPLICATION_STATUSES.UNDER_REVIEW ||
      status === APPLICATION_STATUSES.APPROVED ||
      status === APPLICATION_STATUSES.SUSPENDED
    ) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete document while application is ${status}. Documents can only be modified in DRAFT or NEEDS_CORRECTION state.`
      });
    }

    // Delete DB record first to prevent inconsistent database state if query fails
    await prisma.verificationDocument.delete({ where: { id } });

    // Delete disk file
    safeDeleteDocument(doc.fileName);

    return res.json({
      success: true,
      message: 'Document removed successfully.'
    });
  } catch (err) {
    console.error('deleteVerificationDocument error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete document.' });
  }
}

/**
 * GET /api/assistant/documents/:id
 * Secure download/streaming of applicant's own document.
 */
async function downloadMyDocument(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const doc = await prisma.verificationDocument.findUnique({
      where: { id },
      include: { assistantProfile: true }
    });

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    // Authorization: Owner or Admin
    if (doc.assistantProfile.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this document.' });
    }

    const filePath = resolveSecureDocumentPath(doc.fileName);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Document file not found on disk.' });
    }

    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalFileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  } catch (err) {
    console.error('downloadMyDocument error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve document.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMINISTRATOR WORKFLOWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/verifications
 * Returns application queue with filters (status, search).
 */
async function getAdminVerificationQueue(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { status, search } = req.query;

    const where = {
      assistantType: 'HEALTHCARE_PROFESSIONAL'
    };

    if (status && status !== 'ALL' && APPLICATION_STATUSES[status]) {
      where.verificationStatus = status;
    }

    const profiles = await prisma.assistantProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        reviewLogs: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    let filtered = profiles;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = profiles.filter(p => {
        return (
          p.user?.name?.toLowerCase().includes(q) ||
          p.user?.email?.toLowerCase().includes(q) ||
          p.registrationNumber?.toLowerCase().includes(q) ||
          p.professionTitle?.toLowerCase().includes(q)
        );
      });
    }

    const applications = filtered.map(p => formatApplicationPayload(p, p.user, p.documents, p.reviewLogs));

    return res.json({
      success: true,
      count: applications.length,
      applications
    });
  } catch (err) {
    console.error('getAdminVerificationQueue error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve verification queue.' });
  }
}

/**
 * GET /api/admin/verifications/:id
 * Single detailed application view with documents and audit history.
 */
async function getAdminApplicationById(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        reviewLogs: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Professional application not found.' });
    }

    return res.json({
      success: true,
      application: formatApplicationPayload(profile, profile.user, profile.documents, profile.reviewLogs)
    });
  } catch (err) {
    console.error('getAdminApplicationById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve application details.' });
  }
}

/**
 * POST /api/admin/verifications/:id/start-review
 * Transitions PENDING application to UNDER_REVIEW.
 */
async function startApplicationReview(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const adminId = req.user.id;

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    if (profile.verificationStatus !== APPLICATION_STATUSES.PENDING && profile.verificationStatus !== APPLICATION_STATUSES.NEEDS_CORRECTION) {
      return res.status(400).json({
        success: false,
        error: `Only PENDING or RESUBMITTED applications can be moved to review. Current status: ${profile.verificationStatus}.`
      });
    }

    const prevStatus = profile.verificationStatus;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || (current.verificationStatus !== APPLICATION_STATUSES.PENDING && current.verificationStatus !== APPLICATION_STATUSES.NEEDS_CORRECTION)) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot start review on application currently in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.UNDER_REVIEW,
          reviewedById: adminId,
          reviewedAt: now
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.UNDER_REVIEW,
          action: 'START_REVIEW',
          reason: 'Administrator began formal verification of credentials and certificates.'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: 'Application moved to UNDER_REVIEW.',
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('startApplicationReview error:', err);
    return res.status(500).json({ success: false, error: 'Failed to start review.' });
  }
}

/**
 * POST /api/admin/verifications/:id/request-corrections
 * Requests corrections with mandatory reason. Transitions to NEEDS_CORRECTION.
 */
async function requestApplicationCorrections(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason || !String(reason).trim() || String(reason).trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'A specific explanation (at least 5 characters) is required when requesting corrections.'
      });
    }

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    if (profile.verificationStatus !== APPLICATION_STATUSES.PENDING && profile.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW) {
      return res.status(400).json({
        success: false,
        error: `Only PENDING or UNDER_REVIEW applications can have corrections requested. Current status: ${profile.verificationStatus}.`
      });
    }

    const prevStatus = profile.verificationStatus;
    const now = new Date();
    const cleanReason = String(reason).trim();

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || (current.verificationStatus !== APPLICATION_STATUSES.PENDING && current.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW)) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot request corrections on application in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.NEEDS_CORRECTION,
          correctionReason: cleanReason,
          reviewedById: adminId,
          reviewedAt: now
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.NEEDS_CORRECTION,
          action: 'REQUEST_CORRECTIONS',
          reason: cleanReason
        }
      });

      // Notify the applicant
      await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'Corrections Requested for Professional Application',
          message: `Administrator requested corrections: ${cleanReason}`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: 'Correction request dispatched to applicant.',
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('requestApplicationCorrections error:', err);
    return res.status(500).json({ success: false, error: 'Failed to request corrections.' });
  }
}

/**
 * POST /api/admin/verifications/:id/approve
 * Approves application with service-specific category selection.
 * Requires administrator checklist decision confirmation, records admin, timestamp, and audit trail.
 */
async function approveApplication(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const { approvedServices, notes, reviewChecklist, checklistConfirmed } = req.body;
    const adminId = req.user.id;

    // Strict validation of individually approved service categories
    const validation = validateServiceApprovalCategories(approvedServices);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    // Server-side enforcement of admin review checklist criteria
    const isChecklistValid = (
      checklistConfirmed === true ||
      (
        reviewChecklist &&
        typeof reviewChecklist === 'object' &&
        reviewChecklist.idVerified === true &&
        reviewChecklist.councilActive === true &&
        reviewChecklist.qualificationValid === true &&
        reviewChecklist.scopeAppropriate === true
      )
    );

    if (!isChecklistValid) {
      return res.status(400).json({
        success: false,
        error: 'Administrator review checklist confirmation is required. All 4 verification criteria (government ID, active council registration, authenticated qualifications, and scope appropriateness) must be checked before approval.'
      });
    }

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    // Only applications in PENDING or UNDER_REVIEW can be approved
    if (profile.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW && profile.verificationStatus !== APPLICATION_STATUSES.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Only applications in PENDING or UNDER_REVIEW status can be approved. Current status: ${profile.verificationStatus}.`
      });
    }

    if (profile.documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot approve an application that has zero supporting documents uploaded.'
      });
    }

    const prevStatus = profile.verificationStatus;
    const now = new Date();
    const approvedCategoriesList = validation.approvedCategories;
    const checklistDecisionSummary = 'Checklist Confirmed: [ID Verified, Council Registration Active, Qualifications Authenticated, Clinical Scope Appropriate].';
    const auditReason = notes ? `${String(notes).trim()} | ${checklistDecisionSummary}` : checklistDecisionSummary;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || (current.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW && current.verificationStatus !== APPLICATION_STATUSES.PENDING)) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot approve application in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.APPROVED,
          approvedServices: JSON.stringify(approvedCategoriesList),
          capabilities: approvedCategoriesList.join(','),
          reviewedById: adminId,
          reviewedAt: now,
          rejectionReason: null,
          correctionReason: null,
          suspensionReason: null
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      // Mark documents as VERIFIED
      await tx.verificationDocument.updateMany({
        where: { assistantProfileId: id },
        data: { status: 'VERIFIED' }
      });

      // Audit Log
      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.APPROVED,
          action: 'APPROVE',
          reason: auditReason,
          approvedServices: JSON.stringify(approvedCategoriesList)
        }
      });

      // Notify the applicant
      await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'Professional Application Approved!',
          message: `Your professional credentials have been verified. Approved services: ${approvedCategoriesList.join(', ')}.`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: `Professional application approved with ${approvedCategoriesList.length} service categories.`,
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('approveApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to approve application.' });
  }
}

/**
 * POST /api/admin/verifications/:id/reject
 * Rejects application with required explanation visible to applicant.
 */
async function rejectApplication(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason || !String(reason).trim() || String(reason).trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'A clear explanation (at least 5 characters) is required when rejecting an application.'
      });
    }

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    if (profile.verificationStatus !== APPLICATION_STATUSES.PENDING && profile.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW) {
      return res.status(400).json({
        success: false,
        error: `Only PENDING or UNDER_REVIEW applications can be rejected. Current status: ${profile.verificationStatus}.`
      });
    }

    const prevStatus = profile.verificationStatus;
    const cleanReason = String(reason).trim();
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || (current.verificationStatus !== APPLICATION_STATUSES.PENDING && current.verificationStatus !== APPLICATION_STATUSES.UNDER_REVIEW)) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot reject application in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.REJECTED,
          rejectionReason: cleanReason,
          approvedServices: null,
          capabilities: '',
          reviewedById: adminId,
          reviewedAt: now
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      // Update documents to REJECTED
      await tx.verificationDocument.updateMany({
        where: { assistantProfileId: id },
        data: { status: 'REJECTED' }
      });

      // Audit Log
      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.REJECTED,
          action: 'REJECT',
          reason: cleanReason
        }
      });

      // Notify the applicant
      await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'Professional Application Update: Rejected',
          message: `Your professional application was not approved. Reason: ${cleanReason}`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: 'Application marked as REJECTED.',
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('rejectApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to reject application.' });
  }
}

/**
 * POST /api/admin/verifications/:id/suspend
 * Suspends an approved professional with mandatory reason.
 * Revokes capabilities and active status immediately.
 */
async function suspendProfessional(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason || !String(reason).trim() || String(reason).trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'A suspension reason (at least 5 characters) is required.'
      });
    }

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    // Only APPROVED professionals can be suspended
    if (profile.verificationStatus !== APPLICATION_STATUSES.APPROVED) {
      return res.status(400).json({
        success: false,
        error: `Only APPROVED healthcare professionals can be suspended. Current status: ${profile.verificationStatus}.`
      });
    }

    const prevStatus = profile.verificationStatus;
    const cleanReason = String(reason).trim();
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || current.verificationStatus !== APPLICATION_STATUSES.APPROVED) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot suspend account in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.SUSPENDED,
          suspensionReason: cleanReason,
          isActive: false,
          isAvailable: false,
          capabilities: '',
          reviewedById: adminId,
          reviewedAt: now
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      // Audit Log
      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.SUSPENDED,
          action: 'SUSPEND',
          reason: cleanReason
        }
      });

      // Notify the applicant
      await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'Professional Account Suspended',
          message: `Your professional account has been suspended: ${cleanReason}. Healthcare services disabled.`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: 'Professional account suspended.',
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('suspendProfessional error:', err);
    return res.status(500).json({ success: false, error: 'Failed to suspend professional.' });
  }
}

/**
 * POST /api/admin/verifications/:id/restore
 * Restores a suspended professional account with mandatory explanation.
 * Reinstates active capabilities from previously approved services.
 */
async function restoreProfessional(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason || !String(reason).trim() || String(reason).trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'A specific explanation (at least 5 characters) is required when restoring a suspended account.'
      });
    }

    const profile = await prisma.assistantProfile.findUnique({
      where: { id },
      include: { user: true, documents: true, reviewLogs: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    if (profile.verificationStatus !== APPLICATION_STATUSES.SUSPENDED) {
      return res.status(400).json({
        success: false,
        error: `Only SUSPENDED healthcare professionals can have access restored. Current status: ${profile.verificationStatus}.`
      });
    }

    const prevStatus = profile.verificationStatus;
    const cleanReason = String(reason).trim();
    const now = new Date();
    const restoredServices = parseJsonArray(profile.approvedServices);

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProfile.findUnique({ where: { id } });
      if (!current || current.verificationStatus !== APPLICATION_STATUSES.SUSPENDED) {
        throw new Error(`CONCURRENT_CONFLICT: Cannot restore account in status ${current?.verificationStatus}.`);
      }

      const p = await tx.assistantProfile.update({
        where: { id },
        data: {
          verificationStatus: APPLICATION_STATUSES.APPROVED,
          suspensionReason: null,
          isActive: true,
          isAvailable: true,
          capabilities: restoredServices.join(','),
          reviewedById: adminId,
          reviewedAt: now
        },
        include: { user: true, documents: true, reviewLogs: true }
      });

      // Audit Log
      await tx.verificationReviewLog.create({
        data: {
          assistantProfileId: id,
          adminId,
          adminName: req.user.name || 'Administrator',
          adminEmail: req.user.email || '',
          previousStatus: prevStatus,
          newStatus: APPLICATION_STATUSES.APPROVED,
          action: 'RESTORE_ACCESS',
          reason: cleanReason,
          approvedServices: JSON.stringify(restoredServices)
        }
      });

      // Notify the applicant
      await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'Professional Account Restored',
          message: `Your professional account access has been restored: ${cleanReason}. Approved services active: ${restoredServices.join(', ')}.`,
          type: 'ASSISTANT',
          linkUrl: '/assistant-portal'
        }
      });

      return p;
    });

    return res.json({
      success: true,
      message: 'Professional account restored successfully.',
      profile: updated,
      application: formatApplicationPayload(updated, updated.user, updated.documents, updated.reviewLogs)
    });
  } catch (err) {
    if (err.message && err.message.startsWith('CONCURRENT_CONFLICT:')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('restoreProfessional error:', err);
    return res.status(500).json({ success: false, error: 'Failed to restore professional account.' });
  }
}

/**
 * GET /api/admin/verifications/documents/:docId
 * Secure streaming of verification document for authenticated administrators.
 */
async function downloadAdminDocument(req, res) {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Admin access required.' });
    }
    const { docId } = req.params;

    const doc = await prisma.verificationDocument.findUnique({
      where: { id: docId }
    });

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    const filePath = resolveSecureDocumentPath(doc.fileName);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Document file not found on disk.' });
    }

    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalFileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  } catch (err) {
    console.error('downloadAdminDocument error:', err);
    return res.status(500).json({ success: false, error: 'Failed to stream document.' });
  }
}

module.exports = {
  getMyApplication,
  saveOrSubmitApplication,
  uploadVerificationDocument,
  deleteVerificationDocument,
  downloadMyDocument,
  getAdminVerificationQueue,
  getAdminApplicationById,
  startApplicationReview,
  requestApplicationCorrections,
  approveApplication,
  rejectApplication,
  suspendProfessional,
  restoreProfessional,
  downloadAdminDocument
};
