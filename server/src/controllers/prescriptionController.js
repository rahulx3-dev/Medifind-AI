/**
 * MediFind AI — Prescription Controller (Phase 6.1E.2)
 * Local PaddleOCR / PP-OCRv5 prescription analysis + patient verification pipeline.
 */

const path = require('path');
const fs = require('fs');
const prisma = require('../prisma');
const {
  runOCR,
  processPrescriptionText,
  matchMedicineAgainstCatalog,
  extractMedicineNameFromRow,
  matchMedicineNameAgainstCatalog
} = require('../utils/ocrEngine');
const { screenPrescriptionDocument } = require('../utils/documentScreeningEngine');

// ─── Upload directory ─────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads/prescriptions');

// ─── Academic Sample Prescriptions (for demo/defense presentation) ───────────
const ACADEMIC_SAMPLE_PRESCRIPTIONS = [
  {
    id: "sample-fever-bronchitis",
    title: "1. Respiratory Infection & Fever (Dr. Verma)",
    doctor: "Dr. Alok Verma, MD (Gen Med)",
    diagnosis: "Acute Bronchitis & Viral Fever",
    rawText: `CITY HEALTHCARE CLINIC
Dr. Alok Verma, MD | Reg: KMC-58291
Patient: Rohan Sharma | Date: 12-Sep-2026
Rx:

1. Augmentin 625 Duo - 1 tab twice daily x 5 days

2. Dolo 650 - 1 tab SOS for fever x 3 days

3. Pan 40 - 1 tab before meals x 5 days

Signature: Dr. A. Verma`
  },
  {
    id: "sample-cardiac-emergency",
    title: "2. Acute Cardiac / Emergency (Dr. Mehra)",
    doctor: "Dr. Sunita Mehra, MD, DM (Cardiology)",
    diagnosis: "Unstable Angina & Severe Hypertension",
    rawText: `HEART & VASCULAR INSTITUTE
Dr. Sunita Mehra, MD, DM (Cardiology)
Emergency Prescription
Patient: Rajesh Kumar | Age: 56 | Date: 11-Sep-2026

Rx:
1. Sorbitrate 5 - 1 sublingual tab SOS for acute chest pain
2. Ecosprin 75 - 1 tab once daily after dinner x 30 days
3. Telma 40 - 1 tab once daily morning x 30 days
4. Atorva 10 - 1 tab at bedtime x 30 days

EMERGENCY MEDICINE: Dispense immediately.`
  },
  {
    id: "sample-diabetes-gastric",
    title: "3. Chronic Diabetes & GERD (Dr. Nair)",
    doctor: "Dr. K. S. Nair, MD (Endocrinology)",
    diagnosis: "Type 2 Diabetes Mellitus with Acid Reflux",
    rawText: `APOLLO METABOLIC CLINIC
Dr. K. S. Nair, MD (Endocrinology)
Patient: Sunita Rao | Age: 52 | Date: 09-Sep-2026

Rx:
1. Glycomet 500 SR - 1 tab twice daily with meals x 30 days
2. Januvia 100 - 1 tab once daily morning x 30 days
3. Pantocid DSR - 1 cap once daily before breakfast x 15 days
4. Digene Gel - 2 spoons after food as needed

Review after 1 month with Fasting & PP Blood Sugar.`
  }
];

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Safely delete a file, ignoring errors. */
function safeDelete(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

/**
 * Validate image file signature (magic bytes) to prevent disguised non-image files.
 * Supports JPEG, PNG, and WEBP.
 */
function validateImageMagicBytes(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { valid: true, type: 'jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { valid: true, type: 'png' };
    }
    // WEBP: 'RIFF' at 0-3 and 'WEBP' at 8-11
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return { valid: true, type: 'webp' };
    }

    return { valid: false, reason: 'Invalid file signature: uploaded file is not a genuine image (JPEG, PNG, or WEBP required).' };
  } catch (err) {
    return { valid: false, reason: 'Could not read uploaded file signature.' };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /api/prescriptions/samples
 * Returns the list of academic sample prescriptions (public — for demo/defense).
 */
function getAcademicSamples(req, res) {
  return res.json({
    success: true,
    samples: ACADEMIC_SAMPLE_PRESCRIPTIONS
  });
}

/**
 * POST /api/prescriptions/upload
 * Accepts:
 *   - multipart file field "prescriptionImage" (JPEG/PNG/WEBP, max 10MB)
 *   OR
 *   - body field "sampleId" to use an academic demo prescription text
 *
 * Workflow:
 *   1. Validate uploaded file (MIME type already enforced by multer fileFilter)
 *   2. Validate magic bytes to prevent spoofed/disguised binaries
 *   3. Save prescription record with UPLOADED status
 *   4. Run real Tesseract OCR on the uploaded image
 *      OR use sample text for demo path
 *   5. Extract medicine candidates using fuzzy matching
 *   6. Save DetectedMedicine records
 *   7. Return prescription with detected medicines for patient review
 *
 * IMPORTANT: Never trusts OCR output as final medical truth.
 *            Patient must verify before anything enters the order flow.
 */
async function uploadPrescription(req, res) {
  const uploadedFilePath = req.file ? req.file.path : null;

  try {
    const userId = req.user.id; // Always from authenticated token, never from body

    // ── Determine Source ──────────────────────────────────────────────────────
    const sampleId = req.body.sampleId;
    let rawText = null;
    let fileName = null;
    let filePath = null;
    let ocrConfidence = null;
    let ocrResult = null;
    let usedSample = false;

    if (sampleId) {
      // Academic demo path: use preloaded sample text
      const sample = ACADEMIC_SAMPLE_PRESCRIPTIONS.find(s => s.id === sampleId);
      if (!sample) {
        return res.status(400).json({ success: false, error: 'Invalid sample prescription ID.' });
      }
      rawText = sample.rawText;
      fileName = `${sampleId}.txt`;
      filePath = `samples/${sampleId}.txt`;
      ocrConfidence = 100; // Sample text is exact
      usedSample = true;
    } else if (req.file) {
      // Real image upload path — inspect magic bytes
      const magicCheck = validateImageMagicBytes(req.file.path);
      if (!magicCheck.valid) {
        safeDelete(req.file.path);
        return res.status(415).json({
          success: false,
          error: magicCheck.reason
        });
      }

      fileName = req.file.originalname;
      filePath = req.file.path;
    } else {
      return res.status(400).json({
        success: false,
        error: 'No prescription image uploaded and no sample selected. Please upload a JPEG, PNG, or WEBP image.'
      });
    }

    // ── Create Prescription Record (UPLOADED state) ───────────────────────────
    const prescription = await prisma.prescription.create({
      data: {
        userId,
        originalFileName: fileName,
        filePath: filePath,
        ocrRawText: rawText, // null initially for real uploads
        status: usedSample ? 'PROCESSING' : 'UPLOADED'
      }
    });

    // ── Run OCR (async, but we await in this handler for simplicity) ──────────
    if (!usedSample) {
      // Mark as PROCESSING
      await prisma.prescription.update({
        where: { id: prescription.id },
        data: { status: 'PROCESSING' }
      });

      ocrResult = await runOCR(req.file.path);

      if (!ocrResult.success || !ocrResult.rawText.trim()) {
        await prisma.prescription.update({
          where: { id: prescription.id },
          data: { status: 'FAILED', ocrRawText: ocrResult.error || 'OCR produced no readable text.' }
        });
        return res.status(422).json({
          success: false,
          error: "We couldn't read this prescription clearly. Please upload a clearer image or add medicines manually.",
          prescriptionId: prescription.id,
          ocrText: ''
        });
      }

      rawText = ocrResult.rawText;
      ocrConfidence = ocrResult.confidence;

      // Save OCR result and advance status
      await prisma.prescription.update({
        where: { id: prescription.id },
        data: {
          ocrRawText: rawText,
          status: 'VERIFICATION_REQUIRED'
        }
      });
    } else {
      await prisma.prescription.update({
        where: { id: prescription.id },
        data: { status: 'VERIFICATION_REQUIRED' }
      });
    }

    // ── Extract Medicine Candidates ───────────────────────────────────────────
    const catalog = await prisma.medicine.findMany();
    let detectedItems = [];

    // If python OCR worker produced structured medicineLines with candidate matches:
    if (ocrResult && Array.isArray(ocrResult.medicineLines) && ocrResult.medicineLines.length > 0) {
      detectedItems = ocrResult.medicineLines.map(line => {
        const top = (line.medicineCandidates && line.medicineCandidates[0]) || null;
        const isHighConf = line.confidenceClass === 'HIGH_CONFIDENCE';
        const isNotCatalogue = line.confidenceClass === 'NOT_IN_CATALOGUE';

        return {
          rawName: line.rawLine,
          medicineName: top ? top.medicineName : null,
          matchedMedicineId: top ? top.medicineId : null,
          matchedMedicineName: top ? top.medicineName : null,
          matchedMedicine: top ? {
            id: top.medicineId,
            brandName: top.medicineName,
            genericName: top.genericName,
            strength: top.strength
          } : null,
          confidence: top ? top.matchConfidence : 0.0,
          dosage: line.strength || (top ? top.strength : 'See prescription'),
          frequency: line.rawInstruction || '',
          duration: '',
          quantity: typeof line.quantity === 'number' ? line.quantity : 1,
          extractedQuantity: typeof line.quantity === 'number' ? line.quantity : null,
          isConfirmed: false,
          needsMapping: !isHighConf,
          isNonCatalogue: isNotCatalogue,
          status: isHighConf ? 'AUTO_MATCHED' : (isNotCatalogue ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS'),
          allMatches: line.medicineCandidates || [],
          evidenceSummary: isHighConf
            ? `High confidence match: ${top.medicineName}`
            : (isNotCatalogue
                ? 'Medicine was not found in the 50-medicine catalogue.'
                : 'Ambiguous medicine detected. Please verify or map to catalogue.')
        };
      });
    }

    if (detectedItems.length === 0) {
      detectedItems = processPrescriptionText(rawText, catalog);
    }

    // Save detected medicines in DB (individual creates — SQLite createMany drops FK-referenced
    // items silently in some Prisma versions; sequential creates are reliable)
    for (const item of detectedItems) {
      await prisma.detectedMedicine.create({
        data: {
          prescriptionId: prescription.id,
          rawName: item.rawName,
          matchedMedicineId: item.matchedMedicineId || null,
          matchedMedicineName: item.matchedMedicineName || null,
          confidence: item.confidence,
          dosage: item.dosage || null,
          frequency: item.frequency || null,
          duration: item.duration || null,
          quantity: typeof item.quantity === 'number' ? item.quantity : 1,
          isConfirmed: false,
          needsMapping: item.needsMapping === true,
          evidenceSummary: item.evidenceSummary || null,
          extractedQuantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : null
        }
      });
    }

    // ── Run Prescription Document Integrity & Authenticity Screening ───────────
    const screening = await screenPrescriptionDocument({
      prescriptionId: prescription.id,
      filePath: req.file ? req.file.path : (usedSample ? filePath : null),
      ocrText: rawText,
      ocrConfidence: ocrConfidence,
      detectedMedicines: detectedItems,
      userId: req.user.id
    });

    // ── Fetch full record with detected medicines ──────────────────────────────
    const finalPrescription = await prisma.prescription.findUnique({
      where: { id: prescription.id },
      include: { detectedMedicines: true }
    });

    // Enrich DB records with in-memory fields not stored in DB
    // (status, isNonCatalogue, medicineName, allMatches, matchedMedicine)
    const enrichedMedicines = (finalPrescription.detectedMedicines || []).map((dbItem, i) => {
      const memItem = detectedItems[i] || {};
      return {
        ...dbItem,
        medicineName: memItem.medicineName || null,
        allMatches: memItem.allMatches || null,
        status: memItem.status || (dbItem.needsMapping ? 'NEEDS_MAPPING' : 'AUTO_MATCHED'),
        isNonCatalogue: memItem.isNonCatalogue || false,
        matchedMedicine: memItem.matchedMedicine || null,
        // needsMapping, evidenceSummary, extractedQuantity already in dbItem
      };
    });

    return res.status(201).json({
      success: true,
      message: usedSample
        ? 'Academic sample prescription processed with text extraction.'
        : 'Prescription image processed with real OCR extraction.',
      ocrConfidence,
      candidateCount: detectedItems.filter(d => d.matchedMedicineId).length,
      needsMappingCount: detectedItems.filter(d => d.needsMapping).length,
      prescription: {
        ...finalPrescription,
        detectedMedicines: enrichedMedicines,
        screening
      },
      screening
    });

  } catch (err) {
    // On unexpected error, clean up uploaded file to prevent orphaned files
    safeDelete(uploadedFilePath);
    console.error('uploadPrescription error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process prescription.' });
  }
}

/**
 * PUT /api/prescriptions/:id/verify
 * Patient explicitly verifies the detected medicines after reviewing.
 *
 * Body: { items: [{ id?, matchedMedicineId, matchedMedicineName, quantity, dosage, frequency, duration, isConfirmed }] }
 *
 * Rules:
 *   - Patient can only verify their own prescription
 *   - matchedMedicineId must exist in the medicine catalogue
 *   - quantity must be a positive integer ≤ 500
 *   - New items (manual addition) must have a valid matchedMedicineId from the catalogue
 *   - Verification marks prescription status as VERIFIED
 */
async function verifyDetectedMedicines(req, res) {
  try {
    const { id } = req.params; // prescriptionId
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required and must contain at least one verified medicine.'
      });
    }

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: { detectedMedicines: true }
    });

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    // Authorization: patient can only verify their own prescription
    if (prescription.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only verify your own prescription.' });
    }

    const allRetainedIds = [];

    // Process all submitted items
    for (const item of items) {
      // Validate integer quantity strictly
      const rawQty = item.quantity;
      const numQty = Number(rawQty);
      if (!Number.isInteger(numQty) || numQty < 1 || numQty > 500) {
        return res.status(400).json({
          success: false,
          error: `Invalid quantity "${rawQty}" for "${item.matchedMedicineName || item.rawName || 'item'}". Must be an integer between 1 and 500.`
        });
      }
      const qty = numQty;

      // Validate matchedMedicineId is provided and exists in DB catalogue
      if (!item.matchedMedicineId) {
        return res.status(400).json({
          success: false,
          error: `Please map "${item.rawName || 'detected item'}" to a valid catalogue medicine before verifying.`
        });
      }

      const medExists = await prisma.medicine.findUnique({ where: { id: item.matchedMedicineId } });
      if (!medExists) {
        return res.status(400).json({
          success: false,
          error: `Medicine ID "${item.matchedMedicineId}" does not exist in the catalogue. Please select a valid medicine.`
        });
      }

      if (item.id) {
        // Verify this detected medicine belongs to this prescription
        const dmRecord = prescription.detectedMedicines.find(d => d.id === item.id);
        if (!dmRecord) {
          return res.status(403).json({
            success: false,
            error: `Detected medicine ${item.id} does not belong to this prescription.`
          });
        }

        // Update existing detected medicine
        await prisma.detectedMedicine.update({
          where: { id: item.id },
          data: {
            matchedMedicineId: item.matchedMedicineId,
            matchedMedicineName: medExists.brandName,
            quantity: qty,
            dosage: item.dosage || undefined,
            frequency: item.frequency || undefined,
            duration: item.duration || undefined,
            isConfirmed: true
          }
        });
        allRetainedIds.push(item.id);
      } else {
        // User manually added an extra medicine
        const newDm = await prisma.detectedMedicine.create({
          data: {
            prescriptionId: id,
            rawName: item.rawName || medExists.brandName,
            matchedMedicineId: medExists.id,
            matchedMedicineName: medExists.brandName,
            confidence: 1.0,
            dosage: item.dosage || '1 tablet',
            frequency: item.frequency || 'Once daily',
            duration: item.duration || '5 days',
            quantity: qty,
            isConfirmed: true
          }
        });
        allRetainedIds.push(newDm.id);
      }
    }

    // Clean up any detected medicines that the patient removed (not in allRetainedIds)
    await prisma.detectedMedicine.deleteMany({
      where: {
        prescriptionId: id,
        id: { notIn: allRetainedIds }
      }
    });

    // Mark prescription as VERIFIED
    const updated = await prisma.prescription.update({
      where: { id },
      data: { status: 'VERIFIED' },
      include: { detectedMedicines: true }
    });

    return res.json({
      success: true,
      message: 'Prescription medicines verified successfully.',
      prescription: updated
    });
  } catch (err) {
    console.error('verifyDetectedMedicines error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify detected medicines.' });
  }
}

/**
 * GET /api/prescriptions/:id
 * Get single prescription with enriched detected medicines. Ownership enforced.
 *
 * Re-runs processPrescriptionText on ocrRawText to restore in-memory fields
 * (status, medicineName, allMatches, isNonCatalogue) that are not persisted in DB.
 * This ensures session-restored prescriptions display the same correct match
 * status as immediately after upload.
 */
async function getPrescriptionById(req, res) {
  try {
    const { id } = req.params;

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: { detectedMedicines: true }
    });

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    let isAuthorized = false;
    if (prescription.userId === req.user.id || req.user.role === 'ADMIN') {
      isAuthorized = true;
    } else if (req.user.role === 'PHARMACIST') {
      // A pharmacist can only view a prescription if an order at their pharmacy references it
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      if (managedPharmacy) {
        const orderWithRx = await prisma.order.findFirst({
          where: { prescriptionId: id, pharmacyId: managedPharmacy.id }
        });
        if (orderWithRx) isAuthorized = true;
      }
    }
    // Assistants: NOT authorized to view prescription details (logistics only)

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Unauthorized to view this prescription.' });
    }

    let screening = null;
    if (prescription.screeningResult) {
      try {
        screening = JSON.parse(prescription.screeningResult);
      } catch (_) {}
    }

    // ── Re-enrich detected medicines with in-memory OCR fields ────────────────
    // The DB does not store status, medicineName, allMatches, isNonCatalogue.
    // Re-run processPrescriptionText on ocrRawText to restore these fields,
    // matching exactly what uploadPrescription returns on initial upload.
    let enrichedMedicines = prescription.detectedMedicines || [];
    if (prescription.ocrRawText && enrichedMedicines.length > 0) {
      try {
        const catalog = await prisma.medicine.findMany();
        const freshItems = processPrescriptionText(prescription.ocrRawText, catalog);
        // Match by rawName (primary) or by position (fallback) to re-apply enrichment
        enrichedMedicines = enrichedMedicines.map((dbItem) => {
          // Find the freshly-computed item with the same rawName
          const fresh = freshItems.find(f => f.rawName === dbItem.rawName)
            || freshItems.find(f => (f.medicineName || '').toLowerCase() === (dbItem.matchedMedicineName || '').toLowerCase())
            || null;
          if (fresh) {
            // If the patient has already verified/selected a specific medicine (isConfirmed),
            // preserve their selection — only supplement the missing display fields.
            return {
              ...dbItem,
              medicineName: fresh.medicineName || null,
              // Restore status: if patient confirmed a specific match, honour it;
              // otherwise restore the OCR-engine status.
              status: dbItem.isConfirmed
                ? 'AUTO_MATCHED'
                : (fresh.status || (dbItem.needsMapping ? 'NEEDS_MAPPING' : 'AUTO_MATCHED')),
              isNonCatalogue: fresh.isNonCatalogue || false,
              allMatches: dbItem.isConfirmed ? null : (fresh.allMatches || null),
              matchedMedicine: fresh.matchedMedicine || null,
            };
          }
          // Fallback: derive from DB fields only
          return {
            ...dbItem,
            medicineName: dbItem.matchedMedicineName || null,
            status: dbItem.isConfirmed
              ? 'AUTO_MATCHED'
              : (dbItem.matchedMedicineId ? 'AUTO_MATCHED'
                  : (dbItem.needsMapping
                      ? (dbItem.evidenceSummary?.includes('not available') ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS')
                      : 'AUTO_MATCHED')),
            isNonCatalogue: dbItem.needsMapping && !dbItem.matchedMedicineId &&
              (dbItem.evidenceSummary?.includes('not available') || false),
            allMatches: null,
            matchedMedicine: null,
          };
        });
      } catch (enrichErr) {
        console.error('getPrescriptionById: enrichment error (non-fatal):', enrichErr);
        // Fall back to unenriched DB records — better than crashing
      }
    }

    return res.json({
      success: true,
      prescription: {
        ...prescription,
        detectedMedicines: enrichedMedicines,
        screening
      }
    });
  } catch (err) {
    console.error('getPrescriptionById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve prescription.' });
  }
}

/**
 * GET /api/prescriptions/:id/image
 * Serve prescription image with authentication + ownership check.
 * Patients: own prescriptions only.
 * Pharmacist: only prescriptions linked to orders at their pharmacy.
 * Admin: all.
 * Assistants: denied.
 */
async function getPrescriptionImage(req, res) {
  try {
    const { id } = req.params;

    const prescription = await prisma.prescription.findUnique({ where: { id } });

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    // Authorization
    let isAuthorized = false;
    if (req.user.role === 'ADMIN') {
      isAuthorized = true;
    } else if (prescription.userId === req.user.id) {
      isAuthorized = true;
    } else if (req.user.role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({ where: { managerId: req.user.id } });
      if (managedPharmacy) {
        const orderWithRx = await prisma.order.findFirst({
          where: { prescriptionId: id, pharmacyId: managedPharmacy.id }
        });
        if (orderWithRx) isAuthorized = true;
      }
    }
    // ASSISTANT: never authorized for prescription images

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this prescription image.' });
    }

    // Resolve file path — only serve from the uploads/prescriptions directory
    const filePath = prescription.filePath;
    if (!filePath || filePath.startsWith('samples/')) {
      return res.status(404).json({ success: false, error: 'No image file associated with this prescription.' });
    }

    // Ensure path is absolute and within upload directory
    let absolutePath;
    if (path.isAbsolute(filePath)) {
      absolutePath = filePath;
    } else {
      absolutePath = path.join(UPLOAD_DIR, path.basename(filePath));
    }

    // Security: ensure resolved path stays within uploads/prescriptions
    const resolvedPath = path.resolve(absolutePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return res.status(403).json({ success: false, error: 'Invalid file path.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Prescription image file not found.' });
    }

    // Serve file
    res.sendFile(resolvedPath);
  } catch (err) {
    console.error('getPrescriptionImage error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve prescription image.' });
  }
}

/**
 * GET /api/prescriptions/
 * Get all prescriptions for the authenticated patient.
 */
async function getUserPrescriptions(req, res) {
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: { userId: req.user.id },
      include: { detectedMedicines: true },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      count: prescriptions.length,
      prescriptions
    });
  } catch (err) {
    console.error('getUserPrescriptions error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch user prescriptions.' });
  }
}

/**
 * POST /api/prescriptions/:id/screen-integrity
 * GET /api/prescriptions/:id/screen-integrity
 * Trigger or retrieve prescription document integrity screening.
 * 
 * Access control:
 * - Patient: own prescriptions only.
 * - Pharmacist: only prescriptions linked to orders at their managed pharmacy.
 * - Admin: full access.
 * - Assistant: 403 Forbidden (logistics role cannot see medical/prescription details).
 */
async function screenPrescriptionIntegrity(req, res) {
  try {
    const { id } = req.params;

    // Strict access control: assistants are denied
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Delivery assistants cannot access prescription document details or screening results.'
      });
    }

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: { detectedMedicines: true }
    });

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    let isAuthorized = false;
    if (prescription.userId === req.user.id || req.user.role === 'ADMIN') {
      isAuthorized = true;
    } else if (req.user.role === 'PHARMACIST') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });
      if (managedPharmacy) {
        const orderWithRx = await prisma.order.findFirst({
          where: { prescriptionId: id, pharmacyId: managedPharmacy.id }
        });
        if (orderWithRx) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You do not have permission to view or screen this prescription.'
      });
    }

    // If method is GET and screeningResult is already cached, return cached result
    if (req.method === 'GET' && prescription.screeningResult) {
      try {
        const cached = JSON.parse(prescription.screeningResult);
        return res.json({
          success: true,
          status: cached.status,
          checks: cached.checks,
          requiresManualReview: cached.requiresManualReview,
          summary: cached.summary,
          disclaimer: cached.disclaimer,
          screening: cached
        });
      } catch (_) {}
    }

    // Run / Re-run document integrity screening
    const screening = await screenPrescriptionDocument({
      prescriptionId: prescription.id,
      filePath: prescription.filePath,
      ocrText: prescription.ocrRawText || '',
      ocrConfidence: prescription.status === 'VERIFIED' ? 95 : 85,
      detectedMedicines: prescription.detectedMedicines || [],
      userId: prescription.userId
    });

    return res.json({
      success: true,
      status: screening.status,
      checks: screening.checks,
      requiresManualReview: screening.requiresManualReview,
      summary: screening.summary,
      disclaimer: screening.disclaimer,
      screening
    });
  } catch (err) {
    console.error('screenPrescriptionIntegrity error:', err);
    return res.status(500).json({ success: false, error: 'Failed to screen prescription document integrity.' });
  }
}

module.exports = {
  uploadPrescription,
  verifyDetectedMedicines,
  getPrescriptionById,
  getPrescriptionImage,
  getUserPrescriptions,
  getAcademicSamples,
  screenPrescriptionIntegrity
};
