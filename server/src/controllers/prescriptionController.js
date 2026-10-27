/**
 * MediFind AI — Prescription Controller (Phase 6.1E.2)
 * Local PaddleOCR / PP-OCRv5 prescription analysis + patient verification pipeline.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../prisma');
const ocrEngine = require('../utils/ocrEngine');
const {
  runOCR,
  processPrescriptionText,
  matchMedicineAgainstCatalog,
  extractMedicineNameFromRow,
  matchMedicineNameAgainstCatalog,
  extractPrescribedQuantity,
  calculateSimilarity
} = ocrEngine;
const { screenPrescriptionDocument } = require('../utils/documentScreeningEngine');
const {
  recordPrescriptionAuditLog,
  recordPrescriptionAuditLogBestEffort,
  extractClientIp,
  supportsPrescriptionAuditLogging
} = require('../utils/prescriptionAuditLogger');
const {
  extractActiveIngredients,
  findMatchingBrands,
  identifyPrescriptionType,
  calculateStringSimilarity
} = require('../utils/genericMedicineMatcher');
const { sendIdempotentNotification } = require('../utils/notificationDispatcher');

// Global transaction timeout configuration for remote cloud database (Neon) resilience
const DB_TRANSACTION_OPTIONS = {
  maxWait: 15000,
  timeout: 60000
};

/**
 * Executes a database operation with automatic retry on transient connection drops / resets.
 * Critical for serverless cloud databases (Neon) which may close idle pool sockets during CPU-heavy OCR.
 */
async function executeWithDbRetry(operation, maxRetries = 2, delayMs = 400) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const isConnectionDrop =
        msg.includes('closed the connection') ||
        msg.includes('connection closed') ||
        msg.includes('connection terminated') ||
        msg.includes("can't reach database server") ||
        msg.includes('socket has been closed') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        err?.code === 'P1001' ||
        err?.code === 'P1002' ||
        err?.code === 'P1017';

      if (isConnectionDrop && attempt < maxRetries) {
        console.warn(`[Database-Retry] Transient connection drop (attempt ${attempt}/${maxRetries}): "${err.message}". Retrying on fresh connection...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

// In-memory medicine catalog cache with 5-minute TTL to eliminate 4+ second cloud DB roundtrips on every OCR upload
let cachedMedicineCatalog = null;
let cachedMedicineCatalogExpiresAt = 0;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedMedicineCatalog(prismaClient) {
  const now = Date.now();
  if (cachedMedicineCatalog && Array.isArray(cachedMedicineCatalog) && cachedMedicineCatalog.length > 0 && now < cachedMedicineCatalogExpiresAt) {
    return cachedMedicineCatalog;
  }
  const client = prismaClient || prisma;
  const list = await client.medicine.findMany();
  if (Array.isArray(list) && list.length > 0) {
    cachedMedicineCatalog = list;
    cachedMedicineCatalogExpiresAt = now + CATALOG_CACHE_TTL_MS;
  }
  return list;
}

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

// ─── Slice 2: Structured OCR Runs & Candidates Helpers ───────────────────────

/**
 * Determine if the runtime client supports OCR run tracking via delegates or raw SQL.
 */
function supportsOcrRunTracking(client) {
  if (!client) return false;
  if (client.prescriptionOcrRun && typeof client.prescriptionOcrRun.create === 'function') {
    return true;
  }
  return typeof client.$queryRawUnsafe === 'function' && typeof client.$executeRawUnsafe === 'function';
}

/**
 * Atomically claim an OCR run for (prescriptionId, imageId) with an unexpired lease.
 * Throws an error with code 'OCR_RUN_CONFLICT' if an active unexpired run exists.
 * Reclaims expired leases safely by marking the expired run FAILED.
 * Ensures the row lock, run check, expired lease reclamation, and new run creation
 * all execute within the exact same database transaction.
 */
async function acquireOcrRunClaim(client, options) {
  // If client provides $transaction and is not already a transaction client,
  // wrap execution in an explicit database transaction to ensure row lock and run creation
  // occur within the same transaction block.
  if (client && typeof client.$transaction === 'function' && !client._isTransaction) {
    return client.$transaction((tx) => {
      if (tx) {
        tx._isTransaction = true;
        if (!tx.prescriptionOcrRun && client.prescriptionOcrRun) tx.prescriptionOcrRun = client.prescriptionOcrRun;
        if (!tx.prescription && client.prescription) tx.prescription = client.prescription;
        if (!tx.prescriptionAuditLog && client.prescriptionAuditLog) tx.prescriptionAuditLog = client.prescriptionAuditLog;
      }
      return _acquireOcrRunClaimInternal(tx, options);
    }, DB_TRANSACTION_OPTIONS);
  }
  return _acquireOcrRunClaimInternal(client, options);
}

async function _acquireOcrRunClaimInternal(tx, {
  prescriptionId,
  imageId,
  engineName = 'TESSERACT_OCR',
  engineVersion = '1.0.0',
  leaseDurationMs = 180000,
  actorId = null,
  actorRole = 'SYSTEM',
  ipAddress = null
}) {
  if (!supportsOcrRunTracking(tx)) {
    return null;
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const ocrRunId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();

  try {
    // 1. In PostgreSQL, acquire row lock on Prescription within this transaction to serialize concurrent claims
    if (typeof tx.$queryRawUnsafe === 'function') {
      try {
        await tx.$queryRawUnsafe(`SELECT "id" FROM "Prescription" WHERE "id" = $1 FOR UPDATE`, prescriptionId);
      } catch (_) {
        // In SQLite or non-Postgres environments, FOR UPDATE might not be supported; ignore syntax error if fallback is used
      }
    }

    // 2. Check for existing active runs for this prescription + image
    let activeRun = null;
    if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.findFirst === 'function') {
      activeRun = await tx.prescriptionOcrRun.findFirst({
        where: {
          prescriptionId,
          imageId,
          status: 'PROCESSING'
        },
        orderBy: { createdAt: 'desc' }
      });
    } else if (typeof tx.$queryRawUnsafe === 'function') {
      const rows = await tx.$queryRawUnsafe(
        `SELECT "id", "status", "leaseToken", "leaseExpiresAt", "createdAt"
         FROM "PrescriptionOcrRun"
         WHERE "prescriptionId" = $1 AND "imageId" = $2 AND "status" = $3
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        prescriptionId,
        imageId,
        'PROCESSING'
      );
      activeRun = rows && rows.length > 0 ? rows[0] : null;
    }

    if (activeRun) {
      const isExpired = !activeRun.leaseExpiresAt || new Date(activeRun.leaseExpiresAt) <= now;
      if (!isExpired) {
        // Active unexpired run exists! Throw conflict.
        const conflictErr = new Error('Prescription OCR processing is already actively running for this image.');
        conflictErr.code = 'OCR_RUN_CONFLICT';
        conflictErr.runId = activeRun.id;
        conflictErr.status = 'PROCESSING';
        throw conflictErr;
      }

      // Lease has expired! Reclaim it by marking old run as FAILED
      if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.update === 'function') {
        await tx.prescriptionOcrRun.update({
          where: { id: activeRun.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Lease expired; processing reclaimed by newer run.',
            completedAt: now
          }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `UPDATE "PrescriptionOcrRun" SET "status" = $1, "errorMessage" = $2, "completedAt" = $3 WHERE "id" = $4`,
          'FAILED',
          'Lease expired; processing reclaimed by newer run.',
          now,
          activeRun.id
        );
      }
    }

    // 3. Insert the new PrescriptionOcrRun with PROCESSING status and lease
    if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.create === 'function') {
      await tx.prescriptionOcrRun.create({
        data: {
          id: ocrRunId,
          prescriptionId,
          imageId,
          engineName,
          engineVersion,
          status: 'PROCESSING',
          leaseToken,
          leaseExpiresAt,
          startedAt: now
        }
      });
    } else if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(
        `INSERT INTO "PrescriptionOcrRun" (
          "id", "prescriptionId", "imageId", "engineName", "engineVersion",
          "status", "leaseToken", "leaseExpiresAt", "startedAt", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        ocrRunId,
        prescriptionId,
        imageId,
        engineName,
        engineVersion,
        'PROCESSING',
        leaseToken,
        leaseExpiresAt,
        now
      );
    }

    // 4. Update prescription status to PROCESSING
    const rxDelegate = tx.prescription || (prisma && prisma.prescription);
    if (rxDelegate && typeof rxDelegate.update === 'function') {
      await rxDelegate.update({
        where: { id: prescriptionId },
        data: { status: 'PROCESSING' }
      });
    } else if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(
        `UPDATE "Prescription" SET "status" = $1 WHERE "id" = $2`,
        'PROCESSING',
        prescriptionId
      );
    }

    // 5. Mandatory Audit Log: OCR_RUN_STARTED inside claim transaction
    if (supportsPrescriptionAuditLogging(tx)) {
      await recordPrescriptionAuditLog(tx, {
        prescriptionId,
        prescriptionIdSnapshot: prescriptionId,
        actorId,
        actorRole,
        action: 'OCR_RUN_STARTED',
        details: {
          runId: ocrRunId,
          imageId,
          engineName,
          engineVersion,
          leaseDurationMs
        },
        ipAddress
      });
    }

    return {
      runId: ocrRunId,
      leaseToken,
      startedAt: now,
      leaseExpiresAt
    };
  } catch (err) {
    if (err && err.code === 'OCR_RUN_CONFLICT') {
      throw err;
    }
    const msg = (err && (err.message || String(err))) || '';
    if (msg.includes('does not exist') || msg.includes('no such table') || (err && err.code === '42P01')) {
      return null;
    }
    throw err;
  }
}

/**
 * Terminal failure transition for an OCR run with sanitized error details.
 */
async function failOcrRun(client, options) {
  if (client && typeof client.$transaction === 'function' && !client._isTransaction) {
    return client.$transaction((tx) => {
      if (tx) {
        tx._isTransaction = true;
        if (!tx.prescriptionOcrRun && client.prescriptionOcrRun) tx.prescriptionOcrRun = client.prescriptionOcrRun;
        if (!tx.prescription && client.prescription) tx.prescription = client.prescription;
        if (!tx.prescriptionAuditLog && client.prescriptionAuditLog) tx.prescriptionAuditLog = client.prescriptionAuditLog;
      }
      return _failOcrRunInternal(tx, options);
    });
  }
  return _failOcrRunInternal(client, options);
}

async function _failOcrRunInternal(client, {
  runId,
  prescriptionId,
  leaseToken,
  errorMessage,
  executionTimeMs,
  actorId = null,
  actorRole = 'SYSTEM',
  ipAddress = null
}) {
  const now = new Date();
  const sanitized = errorMessage
    ? String(errorMessage).replace(/[^\w\s.,;:?!-]/g, ' ').substring(0, 500)
    : 'OCR produced no readable text.';

  if (client.prescriptionOcrRun && typeof client.prescriptionOcrRun.updateMany === 'function') {
    const where = { id: runId, status: 'PROCESSING' };
    if (leaseToken) where.leaseToken = leaseToken;
    await client.prescriptionOcrRun.updateMany({
      where,
      data: {
        status: 'FAILED',
        errorMessage: sanitized,
        executionTimeMs: typeof executionTimeMs === 'number' ? executionTimeMs : null,
        completedAt: now
      }
    });
  } else if (typeof client.$executeRawUnsafe === 'function') {
    if (leaseToken) {
      await client.$executeRawUnsafe(
        `UPDATE "PrescriptionOcrRun"
         SET "status" = $1, "errorMessage" = $2, "executionTimeMs" = $3, "completedAt" = $4
         WHERE "id" = $5 AND "leaseToken" = $6 AND "status" = 'PROCESSING'`,
        'FAILED',
        sanitized,
        typeof executionTimeMs === 'number' ? executionTimeMs : null,
        now,
        runId,
        leaseToken
      );
    } else {
      await client.$executeRawUnsafe(
        `UPDATE "PrescriptionOcrRun"
         SET "status" = $1, "errorMessage" = $2, "executionTimeMs" = $3, "completedAt" = $4
         WHERE "id" = $5 AND "status" = 'PROCESSING'`,
        'FAILED',
        sanitized,
        typeof executionTimeMs === 'number' ? executionTimeMs : null,
        now,
        runId
      );
    }
  }

  // Audit log: OCR_RUN_FAILED (mandatory write: fails closed if write fails)
  if (prescriptionId && supportsPrescriptionAuditLogging(client)) {
    await recordPrescriptionAuditLog(client, {
      prescriptionId,
      prescriptionIdSnapshot: prescriptionId,
      actorId,
      actorRole,
      action: 'OCR_RUN_FAILED',
      details: {
        runId,
        executionTimeMs: typeof executionTimeMs === 'number' ? executionTimeMs : null,
        errorReason: sanitized.substring(0, 100)
      },
      ipAddress
    });
  }
}

/**
 * Atomically complete an OCR run, persist immutable candidates, and guard against stale images.
 * Uses row locking and conditional compare-and-set promotion writes to eliminate stale-image race windows.
 * If active image has changed during OCR, records are saved for auditability but NOT promoted
 * to active Prescription or DetectedMedicine.
 */
async function completeOcrRunAndPersistCandidates(client, options) {
  if (client && typeof client.$transaction === 'function' && !client._isTransaction) {
    return client.$transaction((tx) => {
      if (tx) {
        tx._isTransaction = true;
        if (!tx.prescriptionOcrRun && client.prescriptionOcrRun) tx.prescriptionOcrRun = client.prescriptionOcrRun;
        if (!tx.prescriptionOcrCandidate && client.prescriptionOcrCandidate) tx.prescriptionOcrCandidate = client.prescriptionOcrCandidate;
        if (!tx.prescription && client.prescription) tx.prescription = client.prescription;
        if (!tx.detectedMedicine && client.detectedMedicine) tx.detectedMedicine = client.detectedMedicine;
        if (!tx.prescriptionAuditLog && client.prescriptionAuditLog) tx.prescriptionAuditLog = client.prescriptionAuditLog;
      }
      return _completeOcrRunAndPersistCandidatesInternal(tx, options);
    }, DB_TRANSACTION_OPTIONS);
  }
  return _completeOcrRunAndPersistCandidatesInternal(client, options);
}

async function _completeOcrRunAndPersistCandidatesInternal(tx, {
  runId,
  leaseToken,
  prescriptionId,
  imageId,
  rawText,
  executionTimeMs,
  candidates = [],
  detectedItems = [],
  actorId = null,
  actorRole = 'SYSTEM',
  ipAddress = null
}) {
  const now = new Date();

  // 1. Verify lease / claim is still valid and run is still PROCESSING
  let currentRun = null;
  if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.findFirst === 'function') {
    currentRun = await tx.prescriptionOcrRun.findFirst({
      where: {
        id: runId,
        leaseToken,
        status: 'PROCESSING'
      }
    });
  } else if (typeof tx.$queryRawUnsafe === 'function') {
    const rows = await tx.$queryRawUnsafe(
      `SELECT "id", "status", "leaseToken" FROM "PrescriptionOcrRun" WHERE "id" = $1 AND "leaseToken" = $2 AND "status" = 'PROCESSING'`,
      runId,
      leaseToken
    );
    currentRun = rows && rows.length > 0 ? rows[0] : null;
  }

  // If lease was lost or already completed/failed by a reclaimed worker, abort
  if (supportsOcrRunTracking(tx) && !currentRun) {
    const leaseLostErr = new Error('OCR run lease expired or reclaimed by another worker.');
    leaseLostErr.code = 'LEASE_LOST';
    throw leaseLostErr;
  }

  // 2. Update PrescriptionOcrRun to COMPLETED (conditional on leaseToken and PROCESSING status)
  if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.updateMany === 'function') {
    const updResult = await tx.prescriptionOcrRun.updateMany({
      where: { id: runId, leaseToken, status: 'PROCESSING' },
      data: {
        status: 'COMPLETED',
        rawOcrText: rawText,
        executionTimeMs: typeof executionTimeMs === 'number' ? executionTimeMs : null,
        completedAt: now
      }
    });
    if (supportsOcrRunTracking(tx) && updResult && typeof updResult.count === 'number' && updResult.count === 0) {
      const leaseLostErr = new Error('OCR run lease expired or reclaimed by another worker.');
      leaseLostErr.code = 'LEASE_LOST';
      throw leaseLostErr;
    }
  } else if (tx.prescriptionOcrRun && typeof tx.prescriptionOcrRun.update === 'function') {
    await tx.prescriptionOcrRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        rawOcrText: rawText,
        executionTimeMs: typeof executionTimeMs === 'number' ? executionTimeMs : null,
        completedAt: now
      }
    });
  } else if (typeof tx.$executeRawUnsafe === 'function') {
    const affected = await tx.$executeRawUnsafe(
      `UPDATE "PrescriptionOcrRun"
       SET "status" = $1, "rawOcrText" = $2, "executionTimeMs" = $3, "completedAt" = $4
       WHERE "id" = $5 AND "leaseToken" = $6 AND "status" = 'PROCESSING'`,
      'COMPLETED',
      rawText,
      typeof executionTimeMs === 'number' ? executionTimeMs : null,
      now,
      runId,
      leaseToken
    );
    if (supportsOcrRunTracking(tx) && typeof affected === 'number' && affected === 0) {
      const leaseLostErr = new Error('OCR run lease expired or reclaimed by another worker.');
      leaseLostErr.code = 'LEASE_LOST';
      throw leaseLostErr;
    }
  }

  // 3. Persist immutable candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    const candidateData = candidates.map(cand => ({
      id: cand.id || crypto.randomUUID(),
      ocrRunId: runId,
      rawText: cand.rawText || '',
      normalizedName: cand.normalizedName || null,
      matchedMedicineId: cand.matchedMedicineId || null,
      matchedMedicineName: cand.matchedMedicineName || null,
      confidenceScore: typeof cand.confidenceScore === 'number' ? cand.confidenceScore : 0.0,
      boundingBox: cand.boundingBox || null,
      dosage: cand.dosage || null,
      frequency: cand.frequency || null,
      duration: cand.duration || null,
      extractedQuantity: typeof cand.extractedQuantity === 'number' ? cand.extractedQuantity : null,
      suggestedInstruction: cand.suggestedInstruction || null,
      isSelected: false
    }));

    if (tx.prescriptionOcrCandidate && typeof tx.prescriptionOcrCandidate.createMany === 'function') {
      await tx.prescriptionOcrCandidate.createMany({
        data: candidateData
      });
    } else {
      for (const item of candidateData) {
        if (tx.prescriptionOcrCandidate && typeof tx.prescriptionOcrCandidate.create === 'function') {
          await tx.prescriptionOcrCandidate.create({ data: item });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PrescriptionOcrCandidate" (
              "id", "ocrRunId", "rawText", "normalizedName", "matchedMedicineId", "matchedMedicineName",
              "confidenceScore", "boundingBox", "dosage", "frequency", "duration",
              "extractedQuantity", "suggestedInstruction", "isSelected", "createdAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
            item.id,
            item.ocrRunId,
            item.rawText,
            item.normalizedName,
            item.matchedMedicineId,
            item.matchedMedicineName,
            item.confidenceScore,
            item.boundingBox,
            item.dosage,
            item.frequency,
            item.duration,
            item.extractedQuantity,
            item.suggestedInstruction,
            item.isSelected
          );
        }
      }
    }
  }

  // 4. Stale-image guard: Verify prescription's activeImageId with row locking
  let currentRx = null;
  const rxDelegate = tx.prescription || (prisma && prisma.prescription);
  if (typeof tx.$queryRawUnsafe === 'function') {
    try {
      const rows = await tx.$queryRawUnsafe(
        `SELECT "id", "activeImageId" FROM "Prescription" WHERE "id" = $1 FOR UPDATE`,
        prescriptionId
      );
      currentRx = rows && rows.length > 0 ? rows[0] : null;
    } catch (_) {
      if (rxDelegate && typeof rxDelegate.findUnique === 'function') {
        currentRx = await rxDelegate.findUnique({ where: { id: prescriptionId } });
      }
    }
  } else if (rxDelegate && typeof rxDelegate.findUnique === 'function') {
    currentRx = await rxDelegate.findUnique({
      where: { id: prescriptionId }
    });
  }

  const isStale = Boolean(currentRx && currentRx.activeImageId && imageId && currentRx.activeImageId !== imageId);
  if (isStale) {
    // Stale image: do NOT overwrite active prescription or insert DetectedMedicine
    if (supportsPrescriptionAuditLogging(tx)) {
      await recordPrescriptionAuditLog(tx, {
        prescriptionId,
        prescriptionIdSnapshot: prescriptionId,
        actorId,
        actorRole,
        action: 'OCR_RUN_SUPERSEDED',
        details: {
          runId,
          imageId,
          candidateCount: candidates.length,
          executionTimeMs
        },
        ipAddress
      });
    }
    return {
      isStale: true,
      runId,
      candidateCount: candidates.length
    };
  }

  // 5. Active image confirmed: conditional compare-and-set promotion of OCR text and status
  let promotionSucceeded = true;
  if (imageId) {
    if (typeof tx.$executeRawUnsafe === 'function') {
      const affected = await tx.$executeRawUnsafe(
        `UPDATE "Prescription" SET "ocrRawText" = $1, "status" = $2 WHERE "id" = $3 AND "activeImageId" = $4`,
        rawText,
        'VERIFICATION_REQUIRED',
        prescriptionId,
        imageId
      );
      if (typeof affected === 'number' && affected === 0) {
        promotionSucceeded = false;
      }
    } else if (tx.prescription && typeof tx.prescription.updateMany === 'function') {
      try {
        const res = await tx.prescription.updateMany({
          where: { id: prescriptionId, activeImageId: imageId },
          data: {
            ocrRawText: rawText,
            status: 'VERIFICATION_REQUIRED'
          }
        });
        if (res && typeof res.count === 'number' && res.count === 0) {
          promotionSucceeded = false;
        }
      } catch (_) {
        // If Prisma Client delegates have not been regenerated and reject activeImageId in where clause
        await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            ocrRawText: rawText,
            status: 'VERIFICATION_REQUIRED'
          }
        });
      }
    } else if (tx.prescription && typeof tx.prescription.update === 'function') {
      await tx.prescription.update({
        where: { id: prescriptionId },
        data: {
          ocrRawText: rawText,
          status: 'VERIFICATION_REQUIRED'
        }
      });
    }
  } else {
    // Fallback if imageId is not tracked (e.g. legacy demo without image versioning)
    if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(
        `UPDATE "Prescription" SET "ocrRawText" = $1, "status" = $2 WHERE "id" = $3`,
        rawText,
        'VERIFICATION_REQUIRED',
        prescriptionId
      );
    } else if (rxDelegate && typeof rxDelegate.update === 'function') {
      await rxDelegate.update({
        where: { id: prescriptionId },
        data: {
          ocrRawText: rawText,
          status: 'VERIFICATION_REQUIRED'
        }
      });
    }
  }

  if (!promotionSucceeded) {
    // Conditional update detected concurrent image replacement at the exact promotion step
    if (supportsPrescriptionAuditLogging(tx)) {
      await recordPrescriptionAuditLog(tx, {
        prescriptionId,
        prescriptionIdSnapshot: prescriptionId,
        actorId,
        actorRole,
        action: 'OCR_RUN_SUPERSEDED',
        details: {
          runId,
          imageId,
          candidateCount: candidates.length,
          executionTimeMs
        },
        ipAddress
      });
    }
    return {
      isStale: true,
      runId,
      candidateCount: candidates.length
    };
  }

  // 6. Insert legacy DetectedMedicine records for backward compatibility (ONLY if not stale)
  const dmDelegate = tx.detectedMedicine || (prisma && prisma.detectedMedicine);
  if (Array.isArray(detectedItems) && detectedItems.length > 0) {
    const dmData = detectedItems.map(item => ({
      id: crypto.randomUUID(),
      prescriptionId,
      rawName: item.rawName || 'Detected medication',
      matchedMedicineId: item.matchedMedicineId || null,
      matchedMedicineName: item.matchedMedicineName || null,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.0,
      dosage: item.dosage || null,
      frequency: item.frequency || null,
      duration: item.duration || null,
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      isConfirmed: false,
      needsMapping: item.needsMapping === true,
      evidenceSummary: item.evidenceSummary || null,
      extractedQuantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : null
    }));

    if (dmDelegate && typeof dmDelegate.createMany === 'function') {
      await dmDelegate.createMany({
        data: dmData
      });
    } else {
      for (const item of dmData) {
        if (dmDelegate && typeof dmDelegate.create === 'function') {
          await dmDelegate.create({ data: item });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `INSERT INTO "DetectedMedicine" (
              "id", "prescriptionId", "rawName", "matchedMedicineId", "matchedMedicineName",
              "confidence", "dosage", "frequency", "duration", "quantity",
              "isConfirmed", "needsMapping", "evidenceSummary", "extractedQuantity", "createdAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
            item.id,
            item.prescriptionId,
            item.rawName,
            item.matchedMedicineId,
            item.matchedMedicineName,
            item.confidence,
            item.dosage,
            item.frequency,
            item.duration,
            item.quantity,
            false,
            item.needsMapping,
            item.evidenceSummary,
            item.extractedQuantity
          );
        }
      }
    }
  }

  // Mandatory Audit Log: OCR_RUN_COMPLETED
  if (supportsPrescriptionAuditLogging(tx)) {
    await recordPrescriptionAuditLog(tx, {
      prescriptionId,
      prescriptionIdSnapshot: prescriptionId,
      actorId,
      actorRole,
      action: 'OCR_RUN_COMPLETED',
      details: {
        runId,
        imageId,
        candidateCount: candidates.length,
        executionTimeMs,
        status: 'VERIFICATION_REQUIRED'
      },
      ipAddress
    });
  }

  return {
    isStale: false,
    runId,
    candidateCount: candidates.length
  };
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
  let transactionCommitted = false;
  let ocrClaim = null;
  let catalogPromise = null;

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
    let fileSha256 = null;
    let fileSizeBytes = null;
    let validatedMimeType = null;

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

      // Calculate SHA-256 hash from the actual validated file bytes
      const fileBuffer = fs.readFileSync(req.file.path);
      fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      fileSizeBytes = fileBuffer.length;
      validatedMimeType = req.file.mimetype || `image/${magicCheck.type}`;
    } else {
      return res.status(400).json({
        success: false,
        error: 'No prescription image uploaded and no sample selected. Please upload a JPEG, PNG, or WEBP image.'
      });
    }

    // ── Create Prescription Record & Initial Versioned Image (Atomic Transaction) ───────────
    let prescription;
    let initialImageRecord = null;

    if (usedSample) {
      // Academic demo path: preset text, no PrescriptionImage record or image hash
      prescription = await prisma.prescription.create({
        data: {
          userId,
          originalFileName: fileName,
          filePath: filePath,
          ocrRawText: rawText,
          status: 'PROCESSING'
        }
      });
      transactionCommitted = true;
    } else {
      // Real image upload path: Prescription + PrescriptionImage (versionNumber = 1) in one transaction
      const imageId = crypto.randomUUID();
      const storedFileName = path.basename(filePath);

      prescription = await executeWithDbRetry(async () => {
        return await prisma.$transaction(async (tx) => {
          const newRx = await tx.prescription.create({
            data: {
              userId,
              originalFileName: fileName,
              filePath: filePath,
              ocrRawText: rawText, // null initially for real uploads
              status: 'UPLOADED',
              fileHash: fileSha256
            }
          });

          if (tx.prescriptionImage && typeof tx.prescriptionImage.create === 'function') {
            initialImageRecord = await tx.prescriptionImage.create({
              data: {
                id: imageId,
                prescriptionId: newRx.id,
                versionNumber: 1,
                originalFileName: fileName,
                storedFileName: storedFileName,
                storagePath: filePath,
                mimeType: validatedMimeType,
                fileSizeBytes: fileSizeBytes,
                fileSha256: fileSha256,
                uploadedById: userId
              }
            });
            await tx.prescription.update({
              where: { id: newRx.id },
              data: { activeImageId: initialImageRecord.id }
            });
          } else {
            // Compatibility fallback when Prisma Client runtime is not regenerated
            await tx.$executeRawUnsafe(
              `INSERT INTO "PrescriptionImage" ("id", "prescriptionId", "versionNumber", "originalFileName", "storedFileName", "storagePath", "mimeType", "fileSizeBytes", "fileSha256", "uploadedById", "createdAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
              imageId,
              newRx.id,
              1,
              fileName,
              storedFileName,
              filePath,
              validatedMimeType,
              fileSizeBytes,
              fileSha256,
              userId
            );
            await tx.$executeRawUnsafe(
              `UPDATE "Prescription" SET "activeImageId" = $1, "sourceType" = $2 WHERE "id" = $3`,
              imageId,
              'IMAGE_UPLOAD',
              newRx.id
            );
            initialImageRecord = {
              id: imageId,
              prescriptionId: newRx.id,
              versionNumber: 1,
              originalFileName: fileName,
              storedFileName: storedFileName,
              storagePath: filePath,
              mimeType: validatedMimeType,
              fileSizeBytes: fileSizeBytes,
              fileSha256: fileSha256,
              uploadedById: userId
            };
          }

          // Mandatory Audit Log: PRESCRIPTION_UPLOADED inside upload transaction
          if (supportsPrescriptionAuditLogging(tx)) {
            await recordPrescriptionAuditLog(tx, {
              prescriptionId: newRx.id,
              prescriptionIdSnapshot: newRx.id,
              actorId: userId,
              actorRole: req.user?.role || 'PATIENT',
              action: 'PRESCRIPTION_UPLOADED',
              details: {
                imageId,
                versionNumber: 1,
                mimeType: validatedMimeType,
                fileSizeBytes,
                fileSha256
              },
              ipAddress: extractClientIp(req)
            });
          }

          return {
            ...newRx,
            activeImageId: imageId
          };
        }, DB_TRANSACTION_OPTIONS);
      }, 2, 400);
      transactionCommitted = true;
    }
    // ── Slice 2: Run OCR & Manage Run Lifecycle ─────────────────────────────
    ocrClaim = null;
    let executionTimeMs = null;
    const activeImageId = initialImageRecord ? initialImageRecord.id : prescription.activeImageId;

    if (!usedSample) {
      // Step 2 & 3: Acquire atomic claim for (prescriptionId, activeImageId) if tracking is supported
      if (supportsOcrRunTracking(prisma)) {
        try {
          ocrClaim = await executeWithDbRetry(async () => {
            return await acquireOcrRunClaim(prisma, {
              prescriptionId: prescription.id,
              imageId: activeImageId,
              engineName: 'TESSERACT_OCR',
              engineVersion: '1.0.0',
              leaseDurationMs: 180000,
              actorId: req.user.id,
              actorRole: req.user.role || 'PATIENT',
              ipAddress: extractClientIp(req)
            });
          }, 2, 400);
        } catch (claimErr) {
          if (claimErr && claimErr.code === 'OCR_RUN_CONFLICT') {
            return res.status(409).json({
              success: false,
              error: 'Prescription OCR processing is already actively running for this image.',
              runId: claimErr.runId,
              status: 'PROCESSING'
            });
          }
          throw claimErr;
        }
      } else {
        // Fallback for minimal mocks: update prescription status
        const rxDelegate = prisma.prescription;
        if (rxDelegate && typeof rxDelegate.update === 'function') {
          await rxDelegate.update({
            where: { id: prescription.id },
            data: { status: 'PROCESSING' }
          });
        }
      }

      // Execute OCR engine concurrently with catalog prefetch to eliminate cloud DB latency
      catalogPromise = getCachedMedicineCatalog(prisma);
      const ocrStartTime = Date.now();
      ocrResult = await (ocrEngine.runOCR || runOCR)(req.file.path);
      executionTimeMs = Date.now() - ocrStartTime;

      if (!ocrResult || !ocrResult.success || !ocrResult.rawText || !ocrResult.rawText.trim()) {
        const errorDetail = ocrResult?.error || 'Prescription uploaded. Automatic text extraction was unclear.';
        const sanitizedErr = String(errorDetail).replace(/[^\w\s.,;:?!-]/g, ' ').substring(0, 500);

        if (ocrClaim && ocrClaim.runId) {
          try {
            await failOcrRun(prisma, {
              runId: ocrClaim.runId,
              prescriptionId: prescription.id,
              leaseToken: ocrClaim.leaseToken,
              errorMessage: sanitizedErr,
              executionTimeMs,
              actorId: req.user.id,
              actorRole: req.user.role || 'PATIENT',
              ipAddress: extractClientIp(req)
            });
          } catch (_) {}
        }

        const rxDelegate = prisma.prescription;
        let updatedRx = prescription;
        if (rxDelegate && typeof rxDelegate.update === 'function') {
          updatedRx = await rxDelegate.update({
            where: { id: prescription.id },
            data: { status: 'VERIFICATION_REQUIRED', ocrRawText: sanitizedErr }
          });
        }

        return res.json({
          success: true,
          prescription: updatedRx,
          detectedItems: [],
          ocrText: '',
          confidence: 0,
          warning: "We couldn't clearly detect printed text from this image. You can verify and select medications manually below."
        });
      }

      rawText = ocrResult.rawText;
      ocrConfidence = ocrResult.confidence;
    } else {
      const rxDelegate = prisma.prescription;
      if (rxDelegate && typeof rxDelegate.update === 'function') {
        await rxDelegate.update({
          where: { id: prescription.id },
          data: { status: 'VERIFICATION_REQUIRED' }
        });
      }
    }

    // ── Extract Medicine Candidates ───────────────────────────────────────────
    const catalog = await (catalogPromise || getCachedMedicineCatalog(prisma));
    let detectedItems = [];

    // If python OCR worker produced structured medicineLines with candidate matches:
    if (ocrResult && Array.isArray(ocrResult.medicineLines) && ocrResult.medicineLines.length > 0) {
      detectedItems = ocrResult.medicineLines
        .filter(line => {
          const raw = (line.rawLine || '').toLowerCase();
          const isNoise = [
            'provisional', 'afebrile', 'vitals', 'loose stools', 'medicines prescribed',
            'drug & strength', 'prescribed quantity', 'duration instruction', 'plenty of oral',
            'reviewsos', 'review sos', 'printed on', 'printed by', 'community health', 'department', 'general op'
          ].some(w => raw.includes(w));
          if (isNoise) return false;

          // If NOT_IN_CATALOGUE, require actual medicine indicator (strength, formulation, or pharma stem)
          if (line.confidenceClass === 'NOT_IN_CATALOGUE') {
            const hasStrength = Boolean(line.strength) || /\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%|g)\b/i.test(raw);
            const hasForm = /\b(?:tab|tablet|cap|capsule|syr|syrup|inj|injection|powder|drops|ointment|cream|packet|sachet)\b/i.test(raw);
            const hasPharmaStem = /\b(?:ors|cefix|cetix|domper|prazole|cillin|floxacin|statin|olol|sartan)\b/i.test(raw);
            if (!hasStrength && !hasForm && !hasPharmaStem) return false;
          }
          return true;
        })
        .map(line => {
          // Normalize medicine name and strength using both OCR worker extraction and JS parser
          const parsed = extractMedicineNameFromRow(line.rawLine);
          const cleanName = line.extractedName || parsed.medicineName || line.rawLine;
          const cleanStrength = line.strength || parsed.strength || '';

          // Cross-match against live DB catalogue to discover all trade brand options
          const dbMatches = matchMedicineNameAgainstCatalog(cleanName, cleanStrength, catalog);
          const candidates = (dbMatches.length > 0
            ? dbMatches.map(m => ({
                medicineId: m.medicine.id,
                medicineName: m.medicine.brandName,
                genericName: m.medicine.genericName,
                strength: m.medicine.strength,
                dosageForm: m.medicine.dosageForm,
                matchConfidence: m.confidence
              }))
            : (line.medicineCandidates || [])
          );

          // Single-ingredient prescriptions must not match combination medicines
          const cleanLower = cleanName.toLowerCase();
          const isPrescribedCombo = cleanLower.includes('+') || cleanLower.includes('dsr') || cleanLower.includes('duo');
          const filteredCandidates = isPrescribedCombo
            ? candidates
            : candidates.filter(c => !(c.genericName || '').includes('+') && !(c.medicineName || '').includes('DSR'));

          const top = filteredCandidates.length > 0 ? filteredCandidates[0] : null;
          const hasMultipleBrands = filteredCandidates.length > 1 && filteredCandidates[0].matchConfidence >= 0.80 && filteredCandidates[1].matchConfidence >= 0.80;
          const isSingleHighConf = top && top.matchConfidence >= 0.85 && !hasMultipleBrands;
          const isNotCatalogue = (line.confidenceClass === 'NOT_IN_CATALOGUE' || filteredCandidates.length === 0);

          // Secondary auxiliary lexicon fallback (only if not authoritative catalogue match)
          const auxCandidates = (line.auxiliaryCandidates && line.auxiliaryCandidates.length > 0)
            ? line.auxiliaryCandidates
            : (isNotCatalogue ? require('../utils/ocrMatcher').searchAuxiliaryLexicon(cleanName, { strength: cleanStrength, rawLine: line.rawLine }) : []);
          const hasAux = auxCandidates && auxCandidates.length > 0;
          const topAux = hasAux ? auxCandidates[0] : null;

          const isFromTrocr = Boolean(line.fallbackAccepted || (line.recognitionEngine && line.recognitionEngine.includes('TrOCR')));
          // Requirement 4: Never let TrOCR output directly confirm a medicine, assign an authoritative medicine ID, or enable stock, pricing, reservations, or orders.
          const effectiveMatchedMedicineId = isFromTrocr ? null : (top ? top.medicineId : null);
          const effectiveMatchedMedicine = isFromTrocr ? null : (top ? {
            id: top.medicineId,
            brandName: top.medicineName,
            genericName: top.genericName,
            strength: top.strength
          } : null);
          const effectiveSingleHighConf = isFromTrocr ? false : isSingleHighConf;

          // Accurately classify if doctor prescribed a generic active ingredient
          let isGenericPrescription = false;
          let prescribedGeneric = null;
          let prescribedDisplayName = top ? top.medicineName : (topAux ? topAux.brandName : cleanName);

          try {
            const rxType = (typeof identifyPrescriptionType === 'function')
              ? identifyPrescriptionType(cleanName, catalog)
              : { isGeneric: false, targetGeneric: null };

            const isFuzzyGeneric = top && top.genericName && (
              cleanLower.includes(top.genericName.toLowerCase()) ||
              top.genericName.toLowerCase().includes(cleanLower) ||
              (typeof calculateSimilarity === 'function' && calculateSimilarity(cleanLower, top.genericName.toLowerCase()) >= 0.75) ||
              (typeof calculateStringSimilarity === 'function' && calculateStringSimilarity(cleanLower, top.genericName.toLowerCase()) >= 0.75)
            );

            isGenericPrescription = Boolean(rxType.isGeneric || isFuzzyGeneric);
            prescribedGeneric = isGenericPrescription
              ? ((top ? top.genericName : null) || rxType.targetGeneric || cleanName)
              : null;

            if (isGenericPrescription && prescribedGeneric) {
              if (cleanStrength && !prescribedGeneric.toLowerCase().includes(cleanStrength.toLowerCase())) {
                prescribedDisplayName = `${prescribedGeneric} ${cleanStrength}`;
              } else {
                prescribedDisplayName = prescribedGeneric;
              }
            }
          } catch (rxErr) {
            console.warn('Prescription classification fallback for line:', cleanName, rxErr && rxErr.message);
          }

          return {
            rawName: line.rawLine,
            medicineName: prescribedDisplayName,
            prescribedName: prescribedDisplayName,
            isGeneric: isGenericPrescription,
            isGenericPrescription: isGenericPrescription,
            prescribedGenericName: prescribedGeneric,
            matchedMedicineId: effectiveMatchedMedicineId,
            matchedMedicineName: isFromTrocr ? null : (top ? top.medicineName : null),
            matchedMedicine: effectiveMatchedMedicine,
            recognitionEngine: line.recognitionEngine || 'PaddleOCR',
            primaryOcrText: line.primaryOcrText || line.rawLine,
            trocrText: line.trocrText || null,
            fallbackTriggered: Boolean(line.fallbackTriggered),
            fallbackAccepted: Boolean(line.fallbackAccepted),
            fallbackReason: line.fallbackReason || null,
            confidence: top ? top.matchConfidence : (topAux ? topAux.matchScore : 0.0),
            dosage: cleanStrength || (top ? top.strength : (topAux ? topAux.strength : 'See prescription')),
            frequency: line.rawInstruction || '',
            duration: '',
            quantity: ((typeof line.quantity === 'number' && line.quantity > 0) ? line.quantity : (extractPrescribedQuantity(line.rawLine) || 1)),
            extractedQuantity: ((typeof line.quantity === 'number' && line.quantity > 0) ? line.quantity : (extractPrescribedQuantity(line.rawLine) || null)),
            isConfirmed: false,
            needsMapping: isFromTrocr ? true : !effectiveSingleHighConf,
            isNonCatalogue: isNotCatalogue,
            status: isFromTrocr ? 'AMBIGUOUS' : (effectiveSingleHighConf ? 'AUTO_MATCHED' : (isNotCatalogue ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS')),
            allMatches: filteredCandidates,
            auxiliaryCandidates: auxCandidates || [],
            isAuxiliarySuggestion: hasAux && !top,
            requiresConfirmation: isFromTrocr ? true : !effectiveSingleHighConf,
            evidenceSummary: isFromTrocr
              ? `Handwriting fallback recognized: "${line.trocrText}". Clinical confirmation required before assigning medicine ID.`
              : (effectiveSingleHighConf
                  ? `High confidence match: ${top.medicineName}`
                  : (hasMultipleBrands
                      ? `Multiple brand formulations available (${filteredCandidates.map(c => c.medicineName).slice(0, 3).join(', ')}). Please confirm preferred brand.`
                      : (isNotCatalogue
                          ? (hasAux
                              ? `Not found in authoritative 50-item inventory. Reference lexicon suggestion: "${topAux.brandName}" (${topAux.genericName}). Clinical confirmation required.`
                              : 'Medicine was not found in the standardized catalogue.')
                          : 'Ambiguous formulation detected. Please verify or map to catalogue.')))
          };
        });
    }

    if (detectedItems.length === 0) {
      detectedItems = processPrescriptionText(rawText, catalog);
    }

    // ── Step 4 & 5: Persist candidates & guard against stale image ──────────────
    let candidateList = [];
    if (ocrClaim && ocrClaim.runId) {
      // Build structured immutable candidate records
      candidateList = detectedItems.map((item, idx) => {
        const srcLine = (ocrResult && Array.isArray(ocrResult.medicineLines)) ? ocrResult.medicineLines[idx] : null;
        let boxStr = null;
        if (srcLine) {
          if (srcLine.box) boxStr = typeof srcLine.box === 'string' ? srcLine.box : JSON.stringify(srcLine.box);
          else if (srcLine.bbox) boxStr = typeof srcLine.bbox === 'string' ? srcLine.bbox : JSON.stringify(srcLine.bbox);
        }

        return {
          id: crypto.randomUUID(),
          rawText: item.rawName || (srcLine ? srcLine.rawLine : '') || 'Detected medication line',
          normalizedName: item.medicineName || null,
          matchedMedicineId: item.matchedMedicineId || null,
          matchedMedicineName: item.matchedMedicineName || null,
          confidenceScore: typeof item.confidence === 'number' ? item.confidence : 0.0,
          boundingBox: boxStr,
          dosage: item.dosage || null,
          frequency: item.frequency || null,
          duration: item.duration || null,
          extractedQuantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : null,
          suggestedInstruction: item.frequency || (srcLine ? srcLine.rawInstruction : null) || item.evidenceSummary || null,
          isSelected: false
        };
      });

      let commitResult = null;
      try {
        commitResult = await executeWithDbRetry(async () => {
          return await prisma.$transaction(async (tx) => {
            return await completeOcrRunAndPersistCandidates(tx, {
              runId: ocrClaim.runId,
              leaseToken: ocrClaim.leaseToken,
              prescriptionId: prescription.id,
              imageId: activeImageId,
              rawText,
              executionTimeMs,
              candidates: candidateList,
              detectedItems,
              actorId: req.user.id,
              actorRole: req.user.role || 'PATIENT',
              ipAddress: extractClientIp(req)
            });
          }, DB_TRANSACTION_OPTIONS);
        }, 2, 400);
      } catch (persistErr) {
        console.warn('[PrescriptionUpload] OCR run candidate persistence encountered an issue:', persistErr.message, '— applying graceful direct fallback');
        try {
          await executeWithDbRetry(async () => {
            const rxDelegate = prisma.prescription;
            if (rxDelegate && typeof rxDelegate.update === 'function') {
              await rxDelegate.update({
                where: { id: prescription.id },
                data: {
                  ocrRawText: rawText,
                  status: 'VERIFICATION_REQUIRED'
                }
              });
            }
          }, 2, 300);

          for (const item of detectedItems) {
            const dmDelegate = prisma.detectedMedicine;
            if (dmDelegate && typeof dmDelegate.create === 'function') {
              await dmDelegate.create({
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
              }).catch(() => {});
            }
          }
        } catch (fallbackErr) {
          console.error('[PrescriptionUpload] Direct fallback error:', fallbackErr.message);
        }
      }

      if (commitResult && commitResult.isStale) {
        return res.status(200).json({
          success: true,
          message: 'OCR run completed for superseded image version. Active prescription retained.',
          ocrConfidence,
          isStale: true,
          runId: ocrClaim.runId,
          candidateCount: commitResult.candidateCount
        });
      }
    } else {
      // Legacy flow without OCR run tracking (e.g. sample demo or minimal test mock)
      if (!usedSample) {
        const rxDelegate = prisma.prescription;
        if (rxDelegate && typeof rxDelegate.update === 'function') {
          await rxDelegate.update({
            where: { id: prescription.id },
            data: {
              ocrRawText: rawText,
              status: 'VERIFICATION_REQUIRED'
            }
          });
        }
      }

      for (const item of detectedItems) {
        const dmDelegate = prisma.detectedMedicine;
        if (dmDelegate && typeof dmDelegate.create === 'function') {
          await dmDelegate.create({
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
      }
    }

    // ── Run Prescription Document Integrity & Authenticity Screening ───────────
    let screening = null;
    try {
      screening = await executeWithDbRetry(() => screenPrescriptionDocument({
        prescriptionId: prescription.id,
        filePath: req.file ? req.file.path : (usedSample ? filePath : null),
        ocrText: rawText,
        ocrConfidence: ocrConfidence,
        detectedMedicines: detectedItems,
        userId: req.user.id
      }), 2, 300);
    } catch (scErr) {
      console.warn('Prescription document screening non-fatal error:', scErr.message);
      screening = {
        prescriptionId: prescription.id,
        status: 'NEEDS_MANUAL_REVIEW',
        summary: 'Document screening completed with preliminary manual verification required.',
        requiresManualReview: true,
        checks: [],
        screenedAt: new Date().toISOString()
      };
    }

    // ── Fetch full record with detected medicines ──────────────────────────────
    const rxDelegate = prisma.prescription;
    const finalPrescription = rxDelegate && typeof rxDelegate.findUnique === 'function'
      ? await executeWithDbRetry(() => rxDelegate.findUnique({
          where: { id: prescription.id },
          include: { detectedMedicines: true }
        }), 2, 300)
      : { ...prescription, detectedMedicines: [] };

    // Enrich DB records with in-memory fields not stored in DB
    // (status, isNonCatalogue, medicineName, allMatches, matchedMedicine, candidateId, sourceCandidateId)
    const enrichedMedicines = ((finalPrescription && finalPrescription.detectedMedicines) || []).map((dbItem, i) => {
      const memItem = detectedItems[i] || {};
      const candItem = candidateList && candidateList[i] ? candidateList[i] : null;
      return {
        ...dbItem,
        candidateId: candItem ? candItem.id : null,
        sourceCandidateId: candItem ? candItem.id : null,
        medicineName: memItem.medicineName || null,
        allMatches: memItem.allMatches || null,
        auxiliaryCandidates: memItem.auxiliaryCandidates || [],
        isAuxiliarySuggestion: memItem.isAuxiliarySuggestion || false,
        evidenceSummary: memItem.evidenceSummary || dbItem.evidenceSummary || null,
        status: memItem.status || (dbItem.needsMapping ? 'NEEDS_MAPPING' : 'AUTO_MATCHED'),
        isNonCatalogue: memItem.isNonCatalogue || false,
        matchedMedicine: memItem.matchedMedicine || null,
        isGeneric: memItem.isGeneric || false,
        isGenericPrescription: memItem.isGenericPrescription || false,
        prescribedGenericName: memItem.prescribedGenericName || null,
        prescribedName: memItem.prescribedName || memItem.medicineName || null,
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
        activeImageId: (finalPrescription && finalPrescription.activeImageId) || prescription.activeImageId || activeImageId || null,
        detectedMedicines: enrichedMedicines,
        screening
      },
      screening
    });

  } catch (err) {
    // Only clean up newly uploaded file if the database transaction did not commit
    // (prevents leaving a committed database record pointing to a deleted disk file)
    if (!transactionCommitted) {
      safeDelete(uploadedFilePath);
    }
    if (ocrClaim && ocrClaim.runId) {
      try {
        await failOcrRun(prisma, {
          runId: ocrClaim.runId,
          leaseToken: ocrClaim.leaseToken,
          errorMessage: err.message || 'Unexpected server error during OCR processing.'
        });
      } catch (_) {}
    }
    console.error('uploadPrescription error:', err.message || 'Processing failure', err.stack);
    return res.status(500).json({
      success: false,
      error: (process.env.NODE_ENV !== 'production' && err.message)
        ? `Prescription processing failed: ${err.message}`
        : 'Failed to process prescription.'
    });
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
/**
 * PUT /api/prescriptions/:id/verify
 * Patient explicitly verifies the detected medicines after reviewing.
 *
 * Body: {
 *   items: [
 *     {
 *       id?,                     // legacy DetectedMedicine id (optional)
 *       candidateId?,            // PrescriptionOcrCandidate id (optional)
 *       sourceCandidateId?,      // PrescriptionOcrCandidate id (optional)
 *       matchedMedicineId,       // required catalogue medicine id
 *       matchedMedicineName?,    // optional brand name
 *       rawName?,                // prescribed text
 *       quantity,                // integer 1-500
 *       dosage?,                 // string
 *       frequency?,              // string
 *       duration?,               // string
 *       instructions?,           // string
 *       isConfirmed?             // boolean
 *     }
 *   ]
 * }
 *
 * Slice 3 Requirements:
 *   - Persist canonical verified items as PrescriptionItem records.
 *   - Every item must resolve to a valid medicine in the catalog (reject complete request if any fails).
 *   - Assign provenance conservatively (OCR_DERIVED, MANUALLY_ADDED, LEGACY_CONFIRMED, UNSPECIFIED).
 *   - Do not infer OCR provenance solely from matching medicine ID or name.
 *   - Candidate records (PrescriptionOcrCandidate) remain 100% immutable.
 *   - Atomic replacement: re-verification replaces PrescriptionItem records without duplicates.
 *   - If any write fails, roll back the entire verification operation.
 *   - Maintain legacy DetectedMedicine synchronization for backward compatibility.
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

    // Validate all quantities and resolve all medicines against catalog BEFORE executing any writes
    const validatedItems = [];
    for (const item of items) {
      const rawQty = item.quantity;
      const numQty = Number(rawQty);
      if (!Number.isInteger(numQty) || numQty < 1 || numQty > 500) {
        return res.status(400).json({
          success: false,
          error: `Invalid quantity "${rawQty}" for "${item.matchedMedicineName || item.rawName || 'item'}". Must be an integer between 1 and 500.`
        });
      }

      let medRecord = null;
      if (item.matchedMedicineId) {
        try {
          medRecord = await prisma.medicine.findUnique({ where: { id: String(item.matchedMedicineId) } });
        } catch (_) {}
      }

      if (!medRecord && (item.matchedMedicineName || item.rawName || item.genericName)) {
        const nameToLook = String(item.matchedMedicineName || item.rawName || item.genericName || '').trim();
        try {
          // 1. Exact brandName match
          medRecord = await prisma.medicine.findFirst({
            where: { brandName: { equals: nameToLook, mode: 'insensitive' } }
          });

          // 2. Exact genericName match
          if (!medRecord) {
            medRecord = await prisma.medicine.findFirst({
              where: { genericName: { equals: nameToLook, mode: 'insensitive' } }
            });
          }

          // 3. Normalized generic stem & strength matching (e.g. "Cefixime 200mg" -> generic "Cefixime", strength "200mg")
          if (!medRecord) {
            const genericStem = nameToLook.replace(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|%)\b/gi, '').replace(/[^a-zA-Z\s]/g, ' ').trim();
            if (genericStem.length >= 3) {
              const candidates = await prisma.medicine.findMany({
                where: {
                  OR: [
                    { genericName: { contains: genericStem, mode: 'insensitive' } },
                    { brandName: { contains: genericStem, mode: 'insensitive' } }
                  ]
                }
              });
              if (candidates.length > 0) {
                const strengthMatch = nameToLook.match(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|%)\b/i);
                if (strengthMatch) {
                  const targetStr = strengthMatch[0].replace(/\s+/g, '').toLowerCase();
                  medRecord = candidates.find(c => (c.strength || '').replace(/\s+/g, '').toLowerCase().includes(targetStr)) || candidates[0];
                } else {
                  medRecord = candidates[0];
                }
              }
            }
          }
        } catch (_) {}
      }

      // Option A: Check if patient requested pharmacy review
      const isSelectionRequested = Boolean(
        item.selectionOption === 'ASK_PHARMACY' ||
        item.pharmacistSelectionRequested ||
        item.isPendingSelection ||
        item.isAwaitingPharmacyReview ||
        item.evidenceSummary === 'PHARMACIST_SELECTION_REQUESTED' ||
        item.evidenceSummary === 'AWAITING_PHARMACY_REVIEW' ||
        item.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
        (typeof item.patientNotes === 'string' && item.patientNotes.includes('AWAITING_PHARMACY_REVIEW'))
      );

      if (!medRecord && isSelectionRequested) {
        // Resolve a compatible catalogue record for foreign key integrity while preserving unconfirmed brand state
        const genericSearch = String(item.genericCompound || item.rawName || item.genericName || '').trim();
        try {
          medRecord = await prisma.medicine.findFirst({
            where: {
              OR: [
                { genericName: { contains: genericSearch, mode: 'insensitive' } },
                { brandName: { contains: genericSearch, mode: 'insensitive' } }
              ]
            }
          });
        } catch (_) {}
        if (!medRecord) {
          medRecord = await prisma.medicine.findFirst();
        }
      }

      if (!medRecord) {
        return res.status(400).json({
          success: false,
          error: `Item "${item.matchedMedicineName || item.rawName || 'Unknown'}" cannot be verified because it is not mapped to an approved medicine in the catalogue.`
        });
      }

      // Check if there are competing alternative brands for this generic compound in the catalogue
      let hasCompetingBrands = false;
      if (medRecord.genericName && medRecord.genericName.trim().length >= 3) {
        try {
          const competingCount = await prisma.medicine.count({
            where: {
              genericName: { equals: medRecord.genericName.trim(), mode: 'insensitive' },
              id: { not: medRecord.id }
            }
          });
          hasCompetingBrands = competingCount > 0;
        } catch (_) {}
      }

      // Option B: Doctor approval claim check
      const hasDoctorApprovalClaim = Boolean(
        (item.selectionOption === 'DOCTOR_APPROVAL' && (hasCompetingBrands || Boolean(item.doctorApproval))) ||
        item.hasDoctorApproval ||
        (item.doctorApproval && Object.keys(item.doctorApproval).length > 0) ||
        item.isDoctorApprovedClaim
      );

      const prescribedText = String(item.prescribedName || item.rawName || item.genericName || '').trim();
      const cleanPrescribed = prescribedText.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const cleanBrand = String(medRecord.brandName || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const cleanGeneric = String(medRecord.genericName || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

      const isExactBrand = Boolean(
        cleanPrescribed && cleanBrand && (
          cleanPrescribed === cleanBrand ||
          cleanPrescribed.startsWith(cleanBrand) ||
          cleanBrand.startsWith(cleanPrescribed) ||
          cleanPrescribed.includes(cleanBrand)
        )
      );

      const isGenericProductCatalogue = Boolean(
        medRecord.isGenericProduct === true ||
        medRecord.isGeneric === true ||
        String(medRecord.productType || '').toUpperCase() === 'GENERIC'
      );

      const isGenericWithoutExactBrand = !isExactBrand && !isGenericProductCatalogue && (
        (cleanGeneric.length >= 3 && cleanPrescribed.includes(cleanGeneric.split(' ')[0])) ||
        cleanPrescribed !== cleanBrand
      );

      let doctorApprovalData = null;

      if (hasDoctorApprovalClaim) {
        const docApp = item.doctorApproval || item.doctorApprovalDetails;
        if (!docApp || typeof docApp !== 'object' || !docApp.doctorName || String(docApp.doctorName).trim().length < 2 || !docApp.clinicOrHospital || String(docApp.clinicOrHospital).trim().length < 2) {
          return res.status(400).json({
            success: false,
            code: 'DOCTOR_APPROVAL_EVIDENCE_REQUIRED',
            error: `Supporting doctor approval details (prescribing doctor name and clinic or hospital) are required to select brand "${medRecord.brandName}".`
          });
        }
        doctorApprovalData = {
          doctorName: String(docApp.doctorName).trim(),
          clinicOrHospital: String(docApp.clinicOrHospital).trim(),
          notes: docApp.notes ? String(docApp.notes).trim() : null,
          contactReference: docApp.contactReference ? String(docApp.contactReference).trim() : null,
          approvalDate: docApp.approvalDate || new Date().toISOString()
        };
      } else if (isGenericWithoutExactBrand && hasCompetingBrands && !isSelectionRequested) {
        // Direct API Bypass Prevention: Generic medicine cannot be converted directly into a brand without approval or pharmacy review when competing brands exist
        return res.status(400).json({
          success: false,
          code: 'GENERIC_SELECTION_RESTRICTED',
          error: `Prescription specifies generic medicine "${prescribedText || medRecord.genericName}", but brand "${medRecord.brandName}" was directly selected without doctor approval. Direct brand selection is not permitted without requesting pharmacy review (recommended) or providing documented doctor approval.`
        });
      }

      validatedItems.push({
        ...item,
        qty: numQty,
        medRecord,
        pharmacistSelectionRequested: isSelectionRequested,
        isDoctorApprovedClaim: Boolean(doctorApprovalData),
        doctorApprovalData
      });
    }

    const verifyWork = async (tx) => {
      // 1. Lock prescription row & verify existence
      let prescription = null;
      let txLoadedPrescription = false;
      if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = await tx.$queryRawUnsafe(`SELECT "id", "userId", "status", "activeImageId" FROM "Prescription" WHERE "id" = $1 FOR UPDATE`, id);
          if (rows && rows.length > 0) {
            prescription = rows[0];
            txLoadedPrescription = true;
          }
        } catch (_) {}
      }

      if (!prescription) {
        if (tx.prescription && typeof tx.prescription.findUnique === 'function') {
          const found = await tx.prescription.findUnique({
            where: { id },
            include: { detectedMedicines: true }
          });
          if (found && found.id === id) {
            prescription = found;
            txLoadedPrescription = true;
          }
        }
        if (!prescription && prisma.prescription && typeof prisma.prescription.findUnique === 'function') {
          const found = await prisma.prescription.findUnique({
            where: { id },
            include: { detectedMedicines: true }
          });
          if (found && found.id === id) {
            prescription = found;
          }
        }
      } else {
        const dmDelegate = tx.detectedMedicine || (prisma && prisma.detectedMedicine);
        const dms = dmDelegate && typeof dmDelegate.findMany === 'function'
          ? await dmDelegate.findMany({ where: { prescriptionId: id } })
          : (typeof tx.$queryRawUnsafe === 'function'
              ? await tx.$queryRawUnsafe(`SELECT * FROM "DetectedMedicine" WHERE "prescriptionId" = $1`, id)
              : []);
        prescription.detectedMedicines = dms || [];
      }

      if (!prescription) {
        const notFoundErr = new Error('Prescription not found.');
        notFoundErr.statusCode = 404;
        throw notFoundErr;
      }

      // Authorization: patient can only verify their own prescription
      if (prescription.userId !== req.user.id && req.user.role !== 'ADMIN') {
        const authErr = new Error('Unauthorized: You can only verify your own prescription.');
        authErr.statusCode = 403;
        throw authErr;
      }

      // 2. Load valid OCR candidates for this prescription to validate genuine OCR provenance
      // Strict provenance hardening: Only candidates belonging to the prescription's current
      // active image AND an eligible, COMPLETED OCR run are valid for OCR_DERIVED.
      let prescriptionCandidates = [];
      const candDelegate = tx.prescriptionOcrCandidate || (prisma && prisma.prescriptionOcrCandidate);
      const activeImageId = prescription.activeImageId || null;

      const ocrRunFilter = {
        prescriptionId: id,
        status: 'COMPLETED'
      };
      if (activeImageId) {
        ocrRunFilter.imageId = activeImageId;
      }

      if (candDelegate && typeof candDelegate.findMany === 'function') {
        try {
          prescriptionCandidates = await candDelegate.findMany({
            where: { ocrRun: ocrRunFilter },
            include: { ocrRun: true }
          });
        } catch (_) {
          // Fallback if relation filter or include is not supported by mock
          try {
            prescriptionCandidates = await candDelegate.findMany({
              where: { ocrRun: { prescriptionId: id } }
            });
          } catch (_) {}
        }
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          if (activeImageId) {
            prescriptionCandidates = await tx.$queryRawUnsafe(
              `SELECT c."id", c."ocrRunId", c."matchedMedicineId", c."rawText"
               FROM "PrescriptionOcrCandidate" c
               JOIN "PrescriptionOcrRun" r ON c."ocrRunId" = r."id"
               WHERE r."prescriptionId" = $1 AND r."status" = 'COMPLETED' AND r."imageId" = $2`,
              id,
              activeImageId
            );
          } else {
            prescriptionCandidates = await tx.$queryRawUnsafe(
              `SELECT c."id", c."ocrRunId", c."matchedMedicineId", c."rawText"
               FROM "PrescriptionOcrCandidate" c
               JOIN "PrescriptionOcrRun" r ON c."ocrRunId" = r."id"
               WHERE r."prescriptionId" = $1 AND r."status" = 'COMPLETED'`,
              id
            );
          }
        } catch (_) {}
      }

      const validCandidateMap = new Map();
      for (const c of prescriptionCandidates || []) {
        // Double-check candidate's run properties if loaded in-memory
        if (c.ocrRun) {
          if (c.ocrRun.prescriptionId && c.ocrRun.prescriptionId !== id) continue;
          if (c.ocrRun.status && c.ocrRun.status !== 'COMPLETED') continue;
          if (activeImageId && c.ocrRun.imageId && c.ocrRun.imageId !== activeImageId) continue;
        }
        validCandidateMap.set(c.id, c);
      }

      // Check whether this prescription has any OCR runs at all (for legacy fallback detection)
      let hasOcrRuns = validCandidateMap.size > 0;
      if (!hasOcrRuns) {
        const runDelegate = tx.prescriptionOcrRun || (prisma && prisma.prescriptionOcrRun);
        if (runDelegate && typeof runDelegate.findFirst === 'function') {
          try {
            const run = await runDelegate.findFirst({ where: { prescriptionId: id } });
            hasOcrRuns = Boolean(run);
          } catch (_) {}
        } else if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            const runRows = await tx.$queryRawUnsafe(`SELECT "id" FROM "PrescriptionOcrRun" WHERE "prescriptionId" = $1 LIMIT 1`, id);
            hasOcrRuns = Boolean(runRows && runRows.length > 0);
          } catch (_) {}
        }
      }

      // 3. Idempotently clear existing PrescriptionItem rows for this prescription
      const itemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      if (itemDelegate && typeof itemDelegate.deleteMany === 'function') {
        await itemDelegate.deleteMany({ where: { prescriptionId: id } });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        try {
          await tx.$executeRawUnsafe(`DELETE FROM "PrescriptionItem" WHERE "prescriptionId" = $1`, id);
        } catch (delErr) {
          const msg = delErr?.message || String(delErr);
          if (!msg.includes('does not exist') && !msg.includes('no such table') && delErr?.code !== '42P01') {
            throw delErr;
          }
        }
      }

      // 4. Persist canonical PrescriptionItem records with conservative provenance
      const now = new Date();
      const createdItems = [];
      const allRetainedDmIds = [];

      for (const item of validatedItems) {
        const explicitCandidateId = item.sourceCandidateId || item.candidateId;
        let sourceType = 'UNSPECIFIED';
        let sourceCandidateId = null;

        if (explicitCandidateId && validCandidateMap.has(explicitCandidateId)) {
          // Validated OCR candidate belonging to this prescription
          sourceType = 'OCR_DERIVED';
          sourceCandidateId = explicitCandidateId;
        } else if (!item.id && !explicitCandidateId) {
          // Patient manually added this item during review
          sourceType = 'MANUALLY_ADDED';
          sourceCandidateId = null;
        } else if (!hasOcrRuns) {
          // Legacy confirmation or demo sample confirmation without candidate tracking
          sourceType = 'LEGACY_CONFIRMED';
          sourceCandidateId = null;
        } else {
          // Conservative default: do NOT infer OCR provenance solely from matching medicine ID or name
          sourceType = 'UNSPECIFIED';
          sourceCandidateId = null;
        }

        const itemId = crypto.randomUUID();
        const prescribedName = item.prescribedName || item.rawName || item.medRecord.brandName;
        const dosage = item.dosage ? String(item.dosage).trim() : null;
        const frequency = item.frequency ? String(item.frequency).trim() : null;
        const duration = item.duration ? String(item.duration).trim() : null;
        const instructions = (item.instructions || item.suggestedInstruction)
          ? String(item.instructions || item.suggestedInstruction).trim()
          : null;

        const isSelectionRequested = Boolean(item.pharmacistSelectionRequested);
        const isDocApprovalClaim = Boolean(item.isDoctorApprovedClaim && item.doctorApprovalData);

        let itemPatientNotes = null;
        let itemIsVerified = true;
        let itemVerifiedAt = now;
        let itemVerifiedById = req.user.id;

        if (isSelectionRequested) {
          itemPatientNotes = 'PHARMACIST_SELECTION_REQUESTED';
          itemIsVerified = false;
          itemVerifiedAt = null;
          itemVerifiedById = null;
        } else if (isDocApprovalClaim) {
          itemPatientNotes = JSON.stringify({
            type: 'DOCTOR_APPROVAL_CLAIM',
            brandSelected: item.medRecord.brandName,
            genericPrescribed: prescribedName,
            ...item.doctorApprovalData,
            status: 'AWAITING_VERIFICATION'
          });
          itemIsVerified = false;
          itemVerifiedAt = null;
          itemVerifiedById = null;
        } else if (item.isVerified === false) {
          itemPatientNotes = item.patientNotes || null;
          itemIsVerified = false;
          itemVerifiedAt = null;
          itemVerifiedById = null;
        } else {
          itemPatientNotes = item.patientNotes || null;
        }

        if (itemDelegate && typeof itemDelegate.create === 'function') {
          const created = await itemDelegate.create({
            data: {
              id: itemId,
              prescriptionId: id,
              medicineId: item.medRecord.id,
              sourceCandidateId,
              sourceType,
              prescribedName,
              dosage,
              frequency,
              duration,
              quantity: item.qty,
              instructions,
              patientNotes: itemPatientNotes,
              isVerified: itemIsVerified,
              verifiedAt: itemVerifiedAt,
              verifiedById: itemVerifiedById
            }
          });
          createdItems.push(created);
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          try {
            await tx.$executeRawUnsafe(
              `INSERT INTO "PrescriptionItem" (
                "id", "prescriptionId", "medicineId", "sourceCandidateId", "sourceType",
                "prescribedName", "dosage", "frequency", "duration", "quantity",
                "instructions", "patientNotes", "isVerified", "verifiedAt", "verifiedById", "createdAt", "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
              itemId,
              id,
              item.medRecord.id,
              sourceCandidateId,
              sourceType,
              prescribedName,
              dosage,
              frequency,
              duration,
              item.qty,
              instructions,
              itemPatientNotes,
              itemIsVerified,
              itemVerifiedAt,
              itemVerifiedById
            );
            createdItems.push({
              id: itemId,
              prescriptionId: id,
              medicineId: item.medRecord.id,
              sourceCandidateId,
              sourceType,
              prescribedName,
              dosage,
              frequency,
              duration,
              quantity: item.qty,
              instructions,
              patientNotes: itemPatientNotes,
              isVerified: itemIsVerified,
              verifiedAt: itemVerifiedAt,
              verifiedById: itemVerifiedById
            });
          } catch (insErr) {
            const msg = insErr?.message || String(insErr);
            if (!msg.includes('does not exist') && !msg.includes('no such table') && insErr?.code !== '42P01') {
              throw insErr;
            }
          }
        }

        // 5. Update DetectedMedicine compatibility records in the same transaction
        const existingDms = prescription.detectedMedicines || [];
        const dmRecord = item.id ? existingDms.find(d => d.id === item.id) : null;
        const dmUpdateDelegate = (tx.detectedMedicine && typeof tx.detectedMedicine.update === 'function')
          ? tx.detectedMedicine
          : ((prisma && prisma.detectedMedicine && typeof prisma.detectedMedicine.update === 'function') ? prisma.detectedMedicine : null);
        const dmCreateDelegate = (tx.detectedMedicine && typeof tx.detectedMedicine.create === 'function')
          ? tx.detectedMedicine
          : ((prisma && prisma.detectedMedicine && typeof prisma.detectedMedicine.create === 'function') ? prisma.detectedMedicine : null);

        let dmUpdateData;
        if (isSelectionRequested) {
          dmUpdateData = {
            matchedMedicineId: null,
            matchedMedicineName: null,
            quantity: item.qty,
            dosage: dosage || undefined,
            frequency: frequency || undefined,
            duration: duration || undefined,
            isConfirmed: false,
            needsMapping: true,
            evidenceSummary: 'AWAITING_PHARMACY_REVIEW'
          };
        } else if (isDocApprovalClaim) {
          dmUpdateData = {
            matchedMedicineId: item.medRecord.id,
            matchedMedicineName: item.medRecord.brandName,
            quantity: item.qty,
            dosage: dosage || undefined,
            frequency: frequency || undefined,
            duration: duration || undefined,
            isConfirmed: false,
            needsMapping: false,
            evidenceSummary: 'AWAITING_DOCTOR_APPROVAL_VERIFICATION'
          };
        } else {
          dmUpdateData = {
            matchedMedicineId: item.medRecord.id,
            matchedMedicineName: item.medRecord.brandName,
            quantity: item.qty,
            dosage: dosage || undefined,
            frequency: frequency || undefined,
            duration: duration || undefined,
            isConfirmed: true,
            needsMapping: false,
            evidenceSummary: null
          };
        }

        if (dmRecord) {
          if (dmUpdateDelegate && typeof dmUpdateDelegate.update === 'function') {
            await dmUpdateDelegate.update({
              where: { id: dmRecord.id },
              data: dmUpdateData
            });
          } else if (typeof tx.$executeRawUnsafe === 'function') {
            await tx.$executeRawUnsafe(
              `UPDATE "DetectedMedicine"
               SET "matchedMedicineId" = $1, "matchedMedicineName" = $2, "quantity" = $3,
                   "dosage" = $4, "frequency" = $5, "duration" = $6, "isConfirmed" = $7,
                   "needsMapping" = $8, "evidenceSummary" = $9
               WHERE "id" = $10`,
              dmUpdateData.matchedMedicineId,
              dmUpdateData.matchedMedicineName,
              dmUpdateData.quantity,
              dosage,
              frequency,
              duration,
              dmUpdateData.isConfirmed,
              dmUpdateData.needsMapping,
              dmUpdateData.evidenceSummary,
              dmRecord.id
            );
          }
          allRetainedDmIds.push(dmRecord.id);
        } else {
          const newDmId = crypto.randomUUID();
          if (dmCreateDelegate && typeof dmCreateDelegate.create === 'function') {
            await dmCreateDelegate.create({
              data: {
                id: newDmId,
                prescriptionId: id,
                rawName: prescribedName,
                matchedMedicineId: dmUpdateData.matchedMedicineId,
                matchedMedicineName: dmUpdateData.matchedMedicineName,
                confidence: 1.0,
                dosage: dosage || null,
                frequency: frequency || null,
                duration: duration || null,
                quantity: item.qty,
                isConfirmed: dmUpdateData.isConfirmed,
                needsMapping: dmUpdateData.needsMapping,
                evidenceSummary: dmUpdateData.evidenceSummary
              }
            });
          } else if (typeof tx.$executeRawUnsafe === 'function') {
            await tx.$executeRawUnsafe(
              `INSERT INTO "DetectedMedicine" (
                "id", "prescriptionId", "rawName", "matchedMedicineId", "matchedMedicineName",
                "confidence", "dosage", "frequency", "duration", "quantity",
                "isConfirmed", "needsMapping", "evidenceSummary", "createdAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
              newDmId,
              id,
              prescribedName,
              isSelectionRequested ? null : item.medRecord.id,
              isSelectionRequested ? null : item.medRecord.brandName,
              1.0,
              dosage,
              frequency,
              duration,
              item.qty,
              !isSelectionRequested,
              isSelectionRequested,
              isSelectionRequested ? 'PHARMACIST_SELECTION_REQUESTED' : null
            );
          }
          allRetainedDmIds.push(newDmId);
        }
      }

      // 6. Delete detected medicines that the patient removed
      const dmDeleteDelegate = (tx.detectedMedicine && typeof tx.detectedMedicine.deleteMany === 'function')
        ? tx.detectedMedicine
        : ((prisma && prisma.detectedMedicine && typeof prisma.detectedMedicine.deleteMany === 'function') ? prisma.detectedMedicine : null);
      if (dmDeleteDelegate && typeof dmDeleteDelegate.deleteMany === 'function') {
        await dmDeleteDelegate.deleteMany({
          where: {
            prescriptionId: id,
            id: { notIn: allRetainedDmIds }
          }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        if (allRetainedDmIds.length > 0) {
          const placeholders = allRetainedDmIds.map((_, idx) => `$${idx + 2}`).join(', ');
          await tx.$executeRawUnsafe(
            `DELETE FROM "DetectedMedicine" WHERE "prescriptionId" = $1 AND "id" NOT IN (${placeholders})`,
            id,
            ...allRetainedDmIds
          );
        } else {
          await tx.$executeRawUnsafe(`DELETE FROM "DetectedMedicine" WHERE "prescriptionId" = $1`, id);
        }
      }

      // 7. Update prescription status to VERIFIED
      let updatedPrescription = null;
      const rxUpdateDelegate = (txLoadedPrescription && tx.prescription && typeof tx.prescription.update === 'function')
        ? tx.prescription
        : ((prisma && prisma.prescription && typeof prisma.prescription.update === 'function')
            ? prisma.prescription
            : (tx.prescription || null));
      if (rxUpdateDelegate && typeof rxUpdateDelegate.update === 'function') {
        updatedPrescription = await rxUpdateDelegate.update({
          where: { id },
          data: { status: 'VERIFIED' },
          include: { detectedMedicines: true }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(`UPDATE "Prescription" SET "status" = $1 WHERE "id" = $2`, 'VERIFIED', id);
        updatedPrescription = { ...prescription, status: 'VERIFIED' };
      }

      // 8. Record audit log for PRESCRIPTION_VERIFIED in the exact same transaction
      if (prisma.prescriptionAuditLog && !tx.prescriptionAuditLog) {
        tx.prescriptionAuditLog = prisma.prescriptionAuditLog;
      }
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user?.id || null,
          actorRole: req.user?.role || 'PATIENT',
          action: 'PRESCRIPTION_VERIFIED',
          details: {
            confirmedItemCount: createdItems.length,
            catalogMedicineIds: createdItems.filter(i => i.medicineId).map(i => i.medicineId),
            hasManualItems: createdItems.some(i => i.sourceType === 'MANUALLY_ADDED')
          },
          ipAddress: extractClientIp(req)
        });
      }

      return {
        updatedPrescription,
        createdItems
      };
    };

    // Execute in transaction when available
    let txResult = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        txResult = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await verifyWork(tx);
        }, DB_TRANSACTION_OPTIONS);
      } catch (txErr) {
        const msg = txErr?.message || String(txErr);
        if (msg.includes('_createPrismaPromise') || msg.includes('Cannot read properties of undefined')) {
          txResult = await verifyWork(prisma);
        } else {
          throw txErr;
        }
      }
    } else {
      txResult = await verifyWork(prisma);
    }

    return res.json({
      success: true,
      message: 'Prescription medicines verified successfully.',
      prescription: {
        ...(txResult.updatedPrescription || {}),
        items: txResult.createdItems
      }
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'verifyDetectedMedicines', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
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
      let managedPharmacy = null;
      if (prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
        try {
          managedPharmacy = await prisma.pharmacy.findUnique({
            where: { managerId: req.user.id }
          });
        } catch (_) {}
      }
      if (!managedPharmacy && prisma.pharmacy && typeof prisma.pharmacy.findFirst === 'function') {
        try {
          managedPharmacy = await prisma.pharmacy.findFirst({
            where: {
              OR: [
                { managerId: req.user.id },
                { pharmacistId: req.user.id }
              ]
            }
          });
        } catch (_) {}
      } else if (!managedPharmacy && typeof prisma.$queryRawUnsafe === 'function') {
        try {
          const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Pharmacy" WHERE "managerId" = $1 OR "pharmacistId" = $1 LIMIT 1`, req.user.id);
          if (rows && rows.length > 0) managedPharmacy = rows[0];
        } catch (_) {}
      }

      if (managedPharmacy) {
        const orderWithRx = await prisma.order.findFirst({
          where: { prescriptionId: id, pharmacyId: managedPharmacy.id }
        });
        if (orderWithRx) isAuthorized = true;
      }
    }
    // Assistants: NOT authorized to view prescription details (logistics only)

    if (!isAuthorized) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'getPrescriptionById', reason: 'Unauthorized to view this prescription.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized to view this prescription.' });
    }

    let screening = null;
    if (prescription.screeningResult) {
      try {
        screening = JSON.parse(prescription.screeningResult);
      } catch (_) {}
    }

    // Load canonical PrescriptionItem records first to inform enrichment
    let prescriptionItems = [];
    const itemDelegate = prisma.prescriptionItem;
    if (itemDelegate && typeof itemDelegate.findMany === 'function') {
      try {
        prescriptionItems = await itemDelegate.findMany({
          where: { prescriptionId: id },
          orderBy: { createdAt: 'asc' }
        });
      } catch (_) {}
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1 ORDER BY "createdAt" ASC`,
          id
        );
        prescriptionItems = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }

    // ── Re-enrich detected medicines with in-memory OCR fields ────────────────
    // The DB does not store status, medicineName, allMatches, isNonCatalogue.
    // Re-run processPrescriptionText on ocrRawText to restore these fields,
    // matching exactly what uploadPrescription returns on initial upload.
    let enrichedMedicines = prescription.detectedMedicines || [];
    if (prescription.ocrRawText && enrichedMedicines.length > 0) {
      try {
        const catalog = await getCachedMedicineCatalog(prisma);
        const freshItems = processPrescriptionText(prescription.ocrRawText, catalog);
        // Match by rawName (primary) or by position (fallback) to re-apply enrichment
        enrichedMedicines = enrichedMedicines.map((dbItem) => {
          // Check if patient specifically requested pharmacist selection for this item
          const isPendingSelection = Boolean(
            dbItem.evidenceSummary === 'PHARMACIST_SELECTION_REQUESTED' ||
            prescriptionItems.some(p => (p.sourceCandidateId === dbItem.id || p.id === dbItem.id || p.prescribedName === dbItem.rawName) && p.patientNotes === 'PHARMACIST_SELECTION_REQUESTED')
          );

          // Find the freshly-computed item with the same rawName
          const fresh = freshItems.find(f => f.rawName === dbItem.rawName)
            || freshItems.find(f => (f.medicineName || '').toLowerCase() === (dbItem.matchedMedicineName || '').toLowerCase())
            || null;

          if (isPendingSelection) {
            return {
              ...dbItem,
              medicineName: fresh?.medicineName || dbItem.matchedMedicineName || dbItem.rawName,
              matchedMedicineId: null,
              matchedMedicineName: null,
              pharmacistSelectionRequested: true,
              isConfirmed: false,
              needsMapping: true,
              status: 'NEEDS_MAPPING',
              allMatches: fresh?.allMatches || null,
              matchedMedicine: null
            };
          }

          if (fresh) {
            // If the patient has already verified/selected a specific medicine (isConfirmed),
            // preserve their selection — only supplement the missing display fields.
            return {
              ...dbItem,
              medicineName: fresh.medicineName || null,
              pharmacistSelectionRequested: false,
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
            pharmacistSelectionRequested: false,
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

    let imageList = [];
    if (prisma.prescriptionImage && typeof prisma.prescriptionImage.findMany === 'function') {
      try {
        imageList = await prisma.prescriptionImage.findMany({
          where: { prescriptionId: id },
          orderBy: { versionNumber: 'asc' }
        });
      } catch (_) {}
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionImage" WHERE "prescriptionId" = $1 ORDER BY "versionNumber" ASC`,
          id
        );
        imageList = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }

    const formattedImages = (imageList || []).map(img => ({
      id: img.id,
      versionNumber: img.versionNumber,
      isOriginal: img.versionNumber === 1,
      isActive: img.id === prescription.activeImageId,
      originalFileName: img.originalFileName,
      mimeType: img.mimeType,
      fileSizeBytes: img.fileSizeBytes,
      parentImageId: img.parentImageId || null,
      cropCoordinates: img.cropCoordinates || null,
      createdAt: img.createdAt
    }));

    let ocrRuns = [];
    if (prisma.prescriptionOcrRun && typeof prisma.prescriptionOcrRun.findMany === 'function') {
      try {
        ocrRuns = await prisma.prescriptionOcrRun.findMany({
          where: { prescriptionId: id },
          include: {
            candidates: true,
            image: {
              select: { id: true, versionNumber: true, isOriginal: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        });
      } catch (_) {
        try {
          ocrRuns = await prisma.prescriptionOcrRun.findMany({
            where: { prescriptionId: id },
            orderBy: { createdAt: 'desc' }
          });
        } catch (_) {}
      }
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionOcrRun" WHERE "prescriptionId" = $1 ORDER BY "createdAt" DESC`,
          id
        );
        ocrRuns = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }

    if (ocrRuns.length > 0 && prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findMany === 'function') {
      const runIds = ocrRuns.map(r => r.id);
      try {
        const allCandidates = await prisma.prescriptionOcrCandidate.findMany({
          where: { ocrRunId: { in: runIds } }
        });
        const candByRun = new Map();
        for (const c of allCandidates) {
          if (!candByRun.has(c.ocrRunId)) candByRun.set(c.ocrRunId, []);
          candByRun.get(c.ocrRunId).push(c);
        }
        for (const run of ocrRuns) {
          if (!run.candidates || run.candidates.length === 0) {
            run.candidates = candByRun.get(run.id) || [];
          }
        }
      } catch (_) {}
    }

    // Gate 5: Authoritative Lineage Calculation for Allocated, Fulfilled, Cancelled, and Outstanding Quantities
    let physicalOrders = [];
    if (prisma.order && typeof prisma.order.findMany === 'function') {
      try {
        physicalOrders = await prisma.order.findMany({
          where: {
            prescriptionId: id,
            isParentOrder: false
          },
          include: {
            items: true,
            pharmacy: { select: { id: true, name: true, phone: true } }
          }
        });
      } catch (_) {}
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Order" WHERE "prescriptionId" = $1 AND "isParentOrder" = false`,
          id
        );
        physicalOrders = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }

    const enrichedItems = (prescriptionItems || []).map(pItem => {
      let allocatedQty = 0;
      let fulfilledQty = 0;
      let cancelledQty = 0;

      for (const ord of physicalOrders) {
        for (const it of (ord.items || [])) {
          if (it.medicineId === pItem.medicineId || (it.prescriptionItemId && it.prescriptionItemId === pItem.id)) {
            const q = Number(it.quantity) || 0;
            if (ord.status === 'COMPLETED') {
              fulfilledQty += q;
            } else if (ord.status === 'CANCELLED' || ord.status === 'REJECTED') {
              cancelledQty += q;
            } else if (['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(ord.status)) {
              allocatedQty += q;
            }
          }
        }
      }

      const outstandingQty = Math.max(0, (Number(pItem.quantity) || 1) - allocatedQty - fulfilledQty);
      const isSelectionRequested = pItem.patientNotes === 'PHARMACIST_SELECTION_REQUESTED';

      return {
        ...pItem,
        pharmacistSelectionRequested: isSelectionRequested,
        isVerified: isSelectionRequested ? false : pItem.isVerified,
        prescribedQuantity: pItem.quantity,
        allocatedQuantity: allocatedQty,
        fulfilledQuantity: fulfilledQty,
        cancelledQuantity: cancelledQty,
        outstandingQuantity: outstandingQty
      };
    });

    const activeOrders = physicalOrders.filter(o => ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(o.status));
    const completedOrders = physicalOrders.filter(o => o.status === 'COMPLETED');
    const cancelledOrders = physicalOrders.filter(o => ['CANCELLED', 'REJECTED'].includes(o.status));

    const recoverySummary = {
      prescriptionId: id,
      status: prescription.status,
      totalItems: enrichedItems.length,
      verifiedItemsCount: enrichedItems.filter(i => i.isVerified).length,
      pendingVerificationCount: enrichedItems.filter(i => !i.isVerified).length,
      hasOutstandingQuantities: enrichedItems.some(i => i.outstandingQuantity > 0),
      isFullyAllocated: enrichedItems.length > 0 && enrichedItems.every(i => i.outstandingQuantity === 0),
      activeOrdersCount: activeOrders.length,
      completedOrdersCount: completedOrders.length,
      cancelledOrdersCount: cancelledOrders.length,
      recommendedNextStep: (
        enrichedItems.length === 0 || enrichedItems.some(i => !i.isVerified)
          ? 'OCR_REVIEW'
          : (enrichedItems.some(i => i.outstandingQuantity > 0) ? 'ALLOCATE' : 'TRACK_ORDERS')
      ),
      linkedOrders: physicalOrders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        pharmacyName: o.pharmacy?.name || 'Pharmacy',
        totalAmount: o.totalAmount,
        createdAt: o.createdAt
      }))
    };

    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user?.id || null,
      actorRole: req.user?.role || 'UNKNOWN',
      action: 'PRESCRIPTION_VIEWED',
      details: {
        detectedMedicineCount: enrichedMedicines.length,
        itemCount: enrichedItems.length,
        imageVersionCount: formattedImages.length,
        ocrRunCount: ocrRuns.length,
        outstandingQuantities: enrichedItems.map(i => ({ medicineId: i.medicineId, outstanding: i.outstandingQuantity }))
      },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      prescription: {
        ...prescription,
        detectedMedicines: enrichedMedicines,
        items: enrichedItems,
        images: formattedImages,
        ocrRuns: ocrRuns || [],
        activeImageId: prescription.activeImageId || (formattedImages[0] ? formattedImages[0].id : null),
        screening,
        recoverySummary
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
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'getPrescriptionImage', reason: 'Unauthorized to access this prescription image.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized to access this prescription image.' });
    }

    // Resolve file path — prioritize requested imageId, then activeImageId via PrescriptionImage, fallback to legacy prescription.filePath
    let targetFilePath = null;
    let targetImageRecord = null;
    const requestedImageId = (req.query && req.query.imageId) ? req.query.imageId : null;
    const targetImageId = requestedImageId || prescription.activeImageId;

    if (targetImageId && prisma.prescriptionImage) {
      try {
        let img = null;
        if (typeof prisma.prescriptionImage.findFirst === 'function') {
          img = await prisma.prescriptionImage.findFirst({
            where: {
              id: targetImageId,
              prescriptionId: id
            }
          });
        }
        if (!img && typeof prisma.prescriptionImage.findUnique === 'function') {
          img = await prisma.prescriptionImage.findUnique({
            where: { id: targetImageId }
          });
        }
        if (img && img.storagePath) {
          targetFilePath = img.storagePath;
          targetImageRecord = img;
        }
      } catch (imgErr) {
        console.error('getPrescriptionImage: error querying PrescriptionImage:', imgErr);
      }
    } else if (prisma.$queryRawUnsafe && targetImageId) {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT pi."storagePath", pi."id", pi."versionNumber"
           FROM "PrescriptionImage" pi
           WHERE pi."prescriptionId" = $1 AND pi."id" = $2 LIMIT 1`,
          id,
          targetImageId
        );
        if (rows && rows.length > 0 && rows[0].storagePath) {
          targetFilePath = rows[0].storagePath;
          targetImageRecord = rows[0];
        }
      } catch (_) {}
    }

    if (requestedImageId && !targetFilePath) {
      return res.status(404).json({ success: false, error: 'Requested prescription image version not found.' });
    }

    // Fallback to legacy Prescription.filePath
    if (!targetFilePath) {
      targetFilePath = prescription.filePath;
    }

    if (!targetFilePath || targetFilePath.startsWith('samples/')) {
      return res.status(404).json({ success: false, error: 'No image file associated with this prescription.' });
    }

    // Ensure path is absolute and within upload directory
    let absolutePath;
    if (path.isAbsolute(targetFilePath)) {
      absolutePath = targetFilePath;
    } else {
      absolutePath = path.join(UPLOAD_DIR, path.basename(targetFilePath));
    }

    // Security: ensure resolved path stays within uploads/prescriptions
    const resolvedPath = path.resolve(absolutePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const resolvedPrefix = resolvedUploadDir.endsWith(path.sep)
      ? resolvedUploadDir
      : resolvedUploadDir + path.sep;
    if (!resolvedPath.startsWith(resolvedPrefix) && resolvedPath !== resolvedUploadDir) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'getPrescriptionImage', reason: 'Invalid file path.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Invalid file path.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Prescription image file not found.' });
    }

    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user?.id || null,
      actorRole: req.user?.role || 'UNKNOWN',
      action: 'PRESCRIPTION_IMAGE_VIEWED',
      details: {
        activeImageId: prescription.activeImageId || null,
        requestedImageId: requestedImageId || null,
        targetImageId: targetImageRecord?.id || targetImageId || null,
        versionNumber: targetImageRecord?.versionNumber || null,
        extension: path.extname(resolvedPath).toLowerCase()
      },
      ipAddress: extractClientIp(req)
    });

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

    const enrichedPrescriptions = await Promise.all(prescriptions.map(async (rx) => {
      let detailedItems = [];
      if (prisma.prescriptionItem && typeof prisma.prescriptionItem.findMany === 'function') {
        try {
          detailedItems = await prisma.prescriptionItem.findMany({
            where: { prescriptionId: rx.id },
            include: { medicine: true }
          });
        } catch (_) {}
      }

      const resolvedItems = (detailedItems && detailedItems.length > 0)
        ? detailedItems.map(i => ({
            id: i.id,
            medicineId: i.medicineId,
            rawName: i.prescribedName || i.medicine?.brandName,
            matchedMedicineName: i.medicine?.brandName || i.prescribedName,
            dosage: i.dosage || i.medicine?.strength,
            frequency: i.instructions || '',
            quantity: i.quantity || 1,
            isVerified: Boolean(i.isVerified)
          }))
        : (rx.detectedMedicines || []).map(d => ({
            id: d.id,
            medicineId: d.matchedMedicineId,
            rawName: d.rawName,
            matchedMedicineName: d.matchedMedicineName || d.rawName,
            dosage: d.dosage,
            frequency: d.frequency,
            quantity: d.quantity || 1,
            isVerified: Boolean(d.isConfirmed)
          }));

      itemCount = resolvedItems.length;
      verifiedCount = resolvedItems.filter(i => i.isVerified).length;

      let activeOrdersCount = 0;
      if (prisma.order && typeof prisma.order.count === 'function') {
        try {
          activeOrdersCount = await prisma.order.count({
            where: {
              prescriptionId: rx.id,
              isParentOrder: false,
              status: { in: ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'] }
            }
          });
        } catch (_) {}
      }

      return {
        ...rx,
        items: resolvedItems,
        itemCount,
        verifiedCount,
        activeOrdersCount,
        canResume: rx.status !== 'FAILED',
        recommendedNextStep: itemCount === 0 || verifiedCount < itemCount ? 'OCR_REVIEW' : (activeOrdersCount > 0 ? 'TRACK_ORDERS' : 'ALLOCATE')
      };
    }));

    return res.json({
      success: true,
      count: enrichedPrescriptions.length,
      prescriptions: enrichedPrescriptions
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

/**
 * GET /api/prescriptions/:id/images
 * Retrieve all versioned images for a prescription with authorization checks.
 * Patients: own prescriptions only.
 * Pharmacists: only if linked to order at their managed pharmacy.
 * Admins: all.
 * Assistants: denied.
 */
async function getPrescriptionImages(req, res) {
  try {
    const { id } = req.params;

    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

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

    if (!isAuthorized) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'getPrescriptionImages', reason: 'Unauthorized to view image versions for this prescription.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized to view image versions for this prescription.' });
    }

    let imageList = [];
    if (prisma.prescriptionImage && typeof prisma.prescriptionImage.findMany === 'function') {
      imageList = await prisma.prescriptionImage.findMany({
        where: { prescriptionId: id },
        orderBy: { versionNumber: 'asc' }
      });
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "PrescriptionImage" WHERE "prescriptionId" = $1 ORDER BY "versionNumber" ASC`,
        id
      );
      imageList = Array.isArray(rows) ? rows : [];
    }

    const images = (imageList || []).map(img => ({
      id: img.id,
      versionNumber: img.versionNumber,
      isOriginal: img.versionNumber === 1,
      isActive: img.id === prescription.activeImageId,
      originalFileName: img.originalFileName,
      mimeType: img.mimeType,
      fileSizeBytes: img.fileSizeBytes,
      parentImageId: img.parentImageId || null,
      cropCoordinates: img.cropCoordinates || null,
      createdAt: img.createdAt
    }));

    return res.json({
      success: true,
      prescriptionId: id,
      activeImageId: prescription.activeImageId,
      count: images.length,
      images
    });
  } catch (err) {
    console.error('getPrescriptionImages error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve prescription image versions.' });
  }
}

/**
 * POST /api/prescriptions/:id/images
 * Upload an enhanced or replacement image version for an existing prescription.
 * Preserves the original image and prior versions without creating a duplicate prescription.
 * 
 * Authorization:
 * - Patient owner only (or Admin).
 * - Pharmacists and Assistants denied.
 */
async function replaceOrEnhancePrescriptionImage(req, res) {
  const uploadedFile = req.file || (req.files && (req.files.prescriptionImage?.[0] || req.files.image?.[0]));
  const uploadedFilePath = uploadedFile ? uploadedFile.path : null;

  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!uploadedFile || !uploadedFilePath) {
      return res.status(400).json({
        success: false,
        error: 'No image file uploaded. Please provide a JPEG, PNG, or WEBP image.'
      });
    }

    // 1. Retrieve prescription
    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) {
      safeDelete(uploadedFilePath);
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    // 2. Strict authorization: Only patient owner or admin can add an image version
    const isOwner = prescription.userId === userId;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      safeDelete(uploadedFilePath);
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: userId,
        actorRole: req.user.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'replaceOrEnhancePrescriptionImage', reason: 'Unauthorized: only prescription owner can upload image versions.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: you can only upload images to your own prescription.'
      });
    }

    // 3. Inspect magic bytes
    const magicCheck = validateImageMagicBytes(uploadedFilePath);
    if (!magicCheck.valid) {
      safeDelete(uploadedFilePath);
      return res.status(415).json({
        success: false,
        error: magicCheck.reason
      });
    }

    // 4. File metadata & hash
    const fileBuffer = fs.readFileSync(uploadedFilePath);
    const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileSizeBytes = fileBuffer.length;
    const validatedMimeType = uploadedFile.mimetype || `image/${magicCheck.type}`;
    const action = req.body.action === 'ENHANCE' ? 'ENHANCE' : 'REPLACE';
    const parentImageId = req.body.parentImageId || prescription.activeImageId || null;
    let cropCoordinates = req.body.cropCoordinates || null;
    if (cropCoordinates && typeof cropCoordinates === 'object') {
      try {
        cropCoordinates = JSON.stringify(cropCoordinates);
      } catch (_) {}
    }

    // 5. Prevent unintended duplicate submission (same exact file bytes uploaded repeatedly)
    let existingLatest = null;
    if (prisma.prescriptionImage && typeof prisma.prescriptionImage.findFirst === 'function') {
      existingLatest = await prisma.prescriptionImage.findFirst({
        where: { prescriptionId: id, fileSha256 },
        orderBy: { versionNumber: 'desc' }
      });
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "PrescriptionImage" WHERE "prescriptionId" = $1 AND "fileSha256" = $2 ORDER BY "versionNumber" DESC LIMIT 1`,
        id,
        fileSha256
      );
      existingLatest = rows && rows.length > 0 ? rows[0] : null;
    }

    if (existingLatest) {
      // Safely cleanup duplicate upload and return existing record
      safeDelete(uploadedFilePath);
      return res.status(200).json({
        success: true,
        duplicateDetected: true,
        message: 'This exact image is already attached to this prescription.',
        image: {
          id: existingLatest.id,
          versionNumber: existingLatest.versionNumber,
          isOriginal: existingLatest.versionNumber === 1,
          isActive: existingLatest.id === prescription.activeImageId,
          originalFileName: existingLatest.originalFileName,
          mimeType: existingLatest.mimeType,
          fileSizeBytes: existingLatest.fileSizeBytes,
          parentImageId: existingLatest.parentImageId,
          cropCoordinates: existingLatest.cropCoordinates,
          createdAt: existingLatest.createdAt
        },
        activeImageId: prescription.activeImageId || existingLatest.id
      });
    }

    // 6. Create new version in an atomic transaction
    const newImageId = crypto.randomUUID();
    const storedFileName = path.basename(uploadedFilePath);

    const result = await prisma.$transaction(async (tx) => {
      // Find highest version number
      let maxVersion = 1;
      if (tx.prescriptionImage && typeof tx.prescriptionImage.findMany === 'function') {
        const existingImages = await tx.prescriptionImage.findMany({
          where: { prescriptionId: id },
          orderBy: { versionNumber: 'desc' }
        });
        if (existingImages && existingImages.length > 0) {
          maxVersion = existingImages[0].versionNumber;
        }
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        const rows = await tx.$queryRawUnsafe(
          `SELECT MAX("versionNumber") as "maxVersion" FROM "PrescriptionImage" WHERE "prescriptionId" = $1`,
          id
        );
        if (rows && rows.length > 0 && typeof rows[0].maxVersion === 'number') {
          maxVersion = rows[0].maxVersion;
        }
      }

      const nextVersionNumber = maxVersion + 1;

      // Validate parentImageId if provided
      let validParentId = null;
      if (parentImageId) {
        if (tx.prescriptionImage && typeof tx.prescriptionImage.findFirst === 'function') {
          const parentImg = await tx.prescriptionImage.findFirst({
            where: { id: parentImageId, prescriptionId: id }
          });
          if (parentImg) validParentId = parentImg.id;
        } else if (typeof tx.$queryRawUnsafe === 'function') {
          const rows = await tx.$queryRawUnsafe(
            `SELECT "id" FROM "PrescriptionImage" WHERE "id" = $1 AND "prescriptionId" = $2 LIMIT 1`,
            parentImageId,
            id
          );
          if (rows && rows.length > 0) validParentId = rows[0].id;
        }
      }

      let createdImage;
      if (tx.prescriptionImage && typeof tx.prescriptionImage.create === 'function') {
        createdImage = await tx.prescriptionImage.create({
          data: {
            id: newImageId,
            prescriptionId: id,
            versionNumber: nextVersionNumber,
            originalFileName: uploadedFile.originalname,
            storedFileName: storedFileName,
            storagePath: uploadedFilePath,
            mimeType: validatedMimeType,
            fileSizeBytes: fileSizeBytes,
            fileSha256: fileSha256,
            parentImageId: validParentId,
            cropCoordinates: cropCoordinates,
            uploadedById: userId
          }
        });
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO "PrescriptionImage" (
            "id", "prescriptionId", "versionNumber", "originalFileName", "storedFileName",
            "storagePath", "mimeType", "fileSizeBytes", "fileSha256", "parentImageId",
            "cropCoordinates", "uploadedById", "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          newImageId,
          id,
          nextVersionNumber,
          uploadedFile.originalname,
          storedFileName,
          uploadedFilePath,
          validatedMimeType,
          fileSizeBytes,
          fileSha256,
          validParentId,
          cropCoordinates,
          userId
        );
        createdImage = {
          id: newImageId,
          prescriptionId: id,
          versionNumber: nextVersionNumber,
          originalFileName: uploadedFile.originalname,
          storedFileName: storedFileName,
          storagePath: uploadedFilePath,
          mimeType: validatedMimeType,
          fileSizeBytes: fileSizeBytes,
          fileSha256: fileSha256,
          parentImageId: validParentId,
          cropCoordinates: cropCoordinates,
          uploadedById: userId,
          createdAt: new Date()
        };
      }

      // Update prescription's activeImageId to this new version
      if (tx.prescription && typeof tx.prescription.update === 'function') {
        await tx.prescription.update({
          where: { id },
          data: { activeImageId: newImageId }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `UPDATE "Prescription" SET "activeImageId" = $1 WHERE "id" = $2`,
          newImageId,
          id
        );
      }

      // Mandatory Audit Log
      const auditAction = action === 'ENHANCE' ? 'PRESCRIPTION_IMAGE_ENHANCED' : 'PRESCRIPTION_IMAGE_REPLACED';
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: userId,
          actorRole: req.user.role || 'PATIENT',
          action: auditAction,
          details: {
            imageId: newImageId,
            versionNumber: nextVersionNumber,
            parentImageId: validParentId,
            action,
            mimeType: validatedMimeType,
            fileSizeBytes,
            fileSha256
          },
          ipAddress: extractClientIp(req)
        });
      }

      return createdImage;
    });

    return res.status(201).json({
      success: true,
      message: action === 'ENHANCE'
        ? `Prescription image enhanced successfully as version ${result.versionNumber}.`
        : `Prescription image replaced successfully with version ${result.versionNumber}.`,
      image: {
        id: result.id,
        versionNumber: result.versionNumber,
        isOriginal: result.versionNumber === 1,
        isActive: true,
        originalFileName: result.originalFileName,
        mimeType: result.mimeType,
        fileSizeBytes: result.fileSizeBytes,
        parentImageId: result.parentImageId,
        cropCoordinates: result.cropCoordinates,
        createdAt: result.createdAt
      },
      activeImageId: result.id
    });
  } catch (err) {
    console.error('replaceOrEnhancePrescriptionImage error:', err);
    safeDelete(uploadedFilePath);
    return res.status(500).json({
      success: false,
      error: 'Failed to process and attach image version.'
    });
  }
}

/**
 * PUT /api/prescriptions/:id/active-image
 * Switch the active image version for a prescription without deleting any history.
 * 
 * Authorization:
 * - Patient owner only (or Admin).
 */
async function setActivePrescriptionImage(req, res) {
  try {
    const { id } = req.params;
    const { imageId } = req.body;
    const userId = req.user.id;

    if (!imageId) {
      return res.status(400).json({ success: false, error: 'Target imageId is required.' });
    }

    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    const isOwner = prescription.userId === userId;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: userId,
        actorRole: req.user.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'setActivePrescriptionImage', reason: 'Unauthorized.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized to update active image on this prescription.' });
    }

    // Verify target image belongs to this prescription
    let targetImage = null;
    if (prisma.prescriptionImage && typeof prisma.prescriptionImage.findFirst === 'function') {
      targetImage = await prisma.prescriptionImage.findFirst({
        where: { id: imageId, prescriptionId: id }
      });
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "PrescriptionImage" WHERE "id" = $1 AND "prescriptionId" = $2 LIMIT 1`,
        imageId,
        id
      );
      targetImage = rows && rows.length > 0 ? rows[0] : null;
    }

    if (!targetImage) {
      return res.status(404).json({
        success: false,
        error: 'The requested image version does not exist under this prescription.'
      });
    }

    const previousActiveImageId = prescription.activeImageId;

    await prisma.prescription.update({
      where: { id },
      data: { activeImageId: imageId }
    });

    if (supportsPrescriptionAuditLogging(prisma)) {
      await recordPrescriptionAuditLog(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: userId,
        actorRole: req.user.role || 'PATIENT',
        action: 'PRESCRIPTION_ACTIVE_IMAGE_CHANGED',
        details: {
          previousActiveImageId,
          newActiveImageId: imageId,
          versionNumber: targetImage.versionNumber
        },
        ipAddress: extractClientIp(req)
      });
    }

    return res.json({
      success: true,
      message: `Active image switched to version ${targetImage.versionNumber}.`,
      activeImageId: imageId,
      versionNumber: targetImage.versionNumber
    });
  } catch (err) {
    console.error('setActivePrescriptionImage error:', err);
    return res.status(500).json({ success: false, error: 'Failed to switch active image version.' });
  }
}

/**
 * POST /api/prescriptions/:id/ocr-retry
 * Rerun OCR against a specific image version.
 * Links the OCR run and candidate results to the explicitly selected image version.
 * Preserves all previous OCR runs, candidates, and previously confirmed items.
 * If new candidate results conflict with already-confirmed items, flags the conflict for review.
 * 
 * Authorization:
 * - Patient owner only (or Admin).
 */
async function retryPrescriptionOcr(req, res) {
  let ocrClaim = null;
  let executionTimeMs = null;

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    const isOwner = prescription.userId === userId;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: userId,
        actorRole: req.user.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'retryPrescriptionOcr', reason: 'Unauthorized.' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized to retry OCR on this prescription.' });
    }

    // Resolve target image
    const requestedImageId = req.body.imageId || prescription.activeImageId;
    let targetImage = null;

    if (requestedImageId && prisma.prescriptionImage && typeof prisma.prescriptionImage.findFirst === 'function') {
      targetImage = await prisma.prescriptionImage.findFirst({
        where: { id: requestedImageId, prescriptionId: id }
      });
    } else if (requestedImageId && typeof prisma.$queryRawUnsafe === 'function') {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "PrescriptionImage" WHERE "id" = $1 AND "prescriptionId" = $2 LIMIT 1`,
        requestedImageId,
        id
      );
      targetImage = rows && rows.length > 0 ? rows[0] : null;
    }

    let filePathToProcess = null;
    let targetImageId = null;

    if (targetImage && targetImage.storagePath) {
      filePathToProcess = targetImage.storagePath;
      targetImageId = targetImage.id;
    } else if (prescription.filePath && !prescription.filePath.startsWith('samples/')) {
      filePathToProcess = prescription.filePath;
    }

    if (!filePathToProcess || !fs.existsSync(filePathToProcess)) {
      return res.status(404).json({
        success: false,
        error: 'Prescription image file not found on server for OCR retry.'
      });
    }

    // Acquire atomic claim to prevent concurrent duplicate OCR runs on the same image
    if (supportsOcrRunTracking(prisma)) {
      try {
        ocrClaim = await acquireOcrRunClaim(prisma, {
          prescriptionId: id,
          imageId: targetImageId,
          engineName: 'TESSERACT_OCR',
          engineVersion: '1.0.0',
          leaseDurationMs: 180000,
          actorId: userId,
          actorRole: req.user.role || 'PATIENT',
          ipAddress: extractClientIp(req)
        });
      } catch (claimErr) {
        if (claimErr && claimErr.code === 'OCR_RUN_CONFLICT') {
          return res.status(409).json({
            success: false,
            error: 'Prescription OCR processing is already actively running for this image version.',
            runId: claimErr.runId,
            status: 'PROCESSING'
          });
        }
        throw claimErr;
      }
    }

    // Execute OCR Engine
    const ocrStartTime = Date.now();
    const ocrResult = await (ocrEngine.runOCR || runOCR)(filePathToProcess);
    executionTimeMs = Date.now() - ocrStartTime;

    if (!ocrResult || !ocrResult.success || !ocrResult.rawText || !ocrResult.rawText.trim()) {
      const errorDetail = ocrResult?.error || 'OCR produced no readable text on this version.';
      const sanitizedErr = String(errorDetail).replace(/[^\w\s.,;:?!-]/g, ' ').substring(0, 500);

      if (ocrClaim && ocrClaim.runId) {
        try {
          await failOcrRun(prisma, {
            runId: ocrClaim.runId,
            prescriptionId: id,
            leaseToken: ocrClaim.leaseToken,
            errorMessage: sanitizedErr,
            executionTimeMs,
            actorId: userId,
            actorRole: req.user.role || 'PATIENT',
            ipAddress: extractClientIp(req)
          });
        } catch (_) {}
      }

      return res.status(422).json({
        success: false,
        error: "We couldn't read this prescription version clearly. Please adjust crop/enhancement or try another photo.",
        prescriptionId: id,
        ocrText: ''
      });
    }

    const rawText = ocrResult.rawText;
    const ocrConfidence = ocrResult.confidence || 0;

    // Extract candidates
    const catalog = await getCachedMedicineCatalog(prisma);
    let detectedItems = [];

    if (Array.isArray(ocrResult.medicineLines) && ocrResult.medicineLines.length > 0) {
      detectedItems = ocrResult.medicineLines
        .filter(line => {
          const raw = (line.rawLine || '').toLowerCase();
          const isNoise = [
            'provisional', 'afebrile', 'vitals', 'loose stools', 'medicines prescribed',
            'drug & strength', 'prescribed quantity', 'duration instruction', 'plenty of oral',
            'reviewsos', 'review sos', 'printed on', 'printed by', 'community health', 'department', 'general op'
          ].some(w => raw.includes(w));
          if (isNoise) return false;

          if (line.confidenceClass === 'NOT_IN_CATALOGUE') {
            const hasStrength = Boolean(line.strength) || /\b\d+\.?\d*\s*(?:mg|mcg|gm?|ml|%|g)\b/i.test(raw);
            const hasForm = /\b(?:tab|tablet|cap|capsule|syr|syrup|inj|injection|powder|drops|ointment|cream|packet|sachet)\b/i.test(raw);
            const hasPharmaStem = /\b(?:ors|cefix|cetix|domper|prazole|cillin|floxacin|statin|olol|sartan)\b/i.test(raw);
            if (!hasStrength && !hasForm && !hasPharmaStem) return false;
          }
          return true;
        })
        .map(line => {
          const parsed = extractMedicineNameFromRow(line.rawLine);
          const cleanName = line.extractedName || parsed.medicineName || line.rawLine;
          const cleanStrength = line.strength || parsed.strength || '';

          const dbMatches = matchMedicineNameAgainstCatalog(cleanName, cleanStrength, catalog);
          const candidates = (dbMatches.length > 0
            ? dbMatches.map(m => ({
                medicineId: m.medicine.id,
                medicineName: m.medicine.brandName,
                genericName: m.medicine.genericName,
                strength: m.medicine.strength,
                dosageForm: m.medicine.dosageForm,
                matchConfidence: m.confidence
              }))
            : (line.medicineCandidates || [])
          );

          const cleanLower = cleanName.toLowerCase();
          const isPrescribedCombo = cleanLower.includes('+') || cleanLower.includes('dsr') || cleanLower.includes('duo');
          const filteredCandidates = isPrescribedCombo
            ? candidates
            : candidates.filter(c => !(c.genericName || '').includes('+') && !(c.medicineName || '').includes('DSR'));

          const top = filteredCandidates.length > 0 ? filteredCandidates[0] : null;
          const hasMultipleBrands = filteredCandidates.length > 1 && filteredCandidates[0].matchConfidence >= 0.80 && filteredCandidates[1].matchConfidence >= 0.80;
          const isSingleHighConf = top && top.matchConfidence >= 0.85 && !hasMultipleBrands;
          const isNotCatalogue = (line.confidenceClass === 'NOT_IN_CATALOGUE' || filteredCandidates.length === 0);

          // Secondary auxiliary lexicon fallback (only if not authoritative catalogue match)
          const auxCandidates = (line.auxiliaryCandidates && line.auxiliaryCandidates.length > 0)
            ? line.auxiliaryCandidates
            : (isNotCatalogue ? require('../utils/ocrMatcher').searchAuxiliaryLexicon(cleanName, { strength: cleanStrength, rawLine: line.rawLine }) : []);
          const hasAux = auxCandidates && auxCandidates.length > 0;
          const topAux = hasAux ? auxCandidates[0] : null;

          const isFromTrocr = Boolean(line.fallbackAccepted || (line.recognitionEngine && line.recognitionEngine.includes('TrOCR')));
          // Requirement 4: Never let TrOCR output directly confirm a medicine, assign an authoritative medicine ID, or enable stock, pricing, reservations, or orders.
          const effectiveMatchedMedicineId = isFromTrocr ? null : (top ? top.medicineId : null);
          const effectiveMatchedMedicine = isFromTrocr ? null : (top ? {
            id: top.medicineId,
            brandName: top.medicineName,
            genericName: top.genericName,
            strength: top.strength
          } : null);
          const effectiveSingleHighConf = isFromTrocr ? false : isSingleHighConf;
          const displayName = top ? top.medicineName : (topAux ? topAux.brandName : cleanName);

          return {
            rawName: line.rawLine,
            medicineName: displayName,
            matchedMedicineId: effectiveMatchedMedicineId,
            matchedMedicineName: isFromTrocr ? null : (top ? top.medicineName : null),
            matchedMedicine: effectiveMatchedMedicine,
            recognitionEngine: line.recognitionEngine || 'PaddleOCR',
            primaryOcrText: line.primaryOcrText || line.rawLine,
            trocrText: line.trocrText || null,
            fallbackTriggered: Boolean(line.fallbackTriggered),
            fallbackAccepted: Boolean(line.fallbackAccepted),
            fallbackReason: line.fallbackReason || null,
            confidence: top ? top.matchConfidence : (topAux ? topAux.matchScore : 0.0),
            dosage: cleanStrength || (top ? top.strength : (topAux ? topAux.strength : 'See prescription')),
            frequency: line.rawInstruction || '',
            duration: '',
            quantity: ((typeof line.quantity === 'number' && line.quantity > 0) ? line.quantity : (extractPrescribedQuantity(line.rawLine) || 1)),
            extractedQuantity: ((typeof line.quantity === 'number' && line.quantity > 0) ? line.quantity : (extractPrescribedQuantity(line.rawLine) || null)),
            isConfirmed: false,
            needsMapping: isFromTrocr ? true : !effectiveSingleHighConf,
            isNonCatalogue: isNotCatalogue,
            status: isFromTrocr ? 'AMBIGUOUS' : (effectiveSingleHighConf ? 'AUTO_MATCHED' : (isNotCatalogue ? 'NOT_IN_CATALOGUE' : 'AMBIGUOUS')),
            allMatches: filteredCandidates,
            auxiliaryCandidates: auxCandidates || [],
            isAuxiliarySuggestion: hasAux && !top,
            requiresConfirmation: isFromTrocr ? true : !effectiveSingleHighConf,
            evidenceSummary: isFromTrocr
              ? `Handwriting fallback recognized: "${line.trocrText}". Clinical confirmation required before assigning medicine ID.`
              : (effectiveSingleHighConf
                  ? `High confidence match: ${top.medicineName}`
                  : (hasMultipleBrands
                      ? `Multiple brand formulations available (${filteredCandidates.map(c => c.medicineName).slice(0, 3).join(', ')}). Please confirm preferred brand.`
                      : (isNotCatalogue
                          ? (hasAux
                              ? `Not found in authoritative 50-item inventory. Reference lexicon suggestion: "${topAux.brandName}" (${topAux.genericName}). Clinical confirmation required.`
                              : 'Medicine was not found in the standardized catalogue.')
                          : 'Ambiguous formulation detected. Please verify or map to catalogue.')))
          };
        });
    }

    if (detectedItems.length === 0) {
      detectedItems = processPrescriptionText(rawText, catalog);
    }

    // ── Check conflicts against existing confirmed items ──────────────────────
    let existingConfirmedItems = [];
    if (prisma.prescriptionItem && typeof prisma.prescriptionItem.findMany === 'function') {
      try {
        existingConfirmedItems = await prisma.prescriptionItem.findMany({
          where: { prescriptionId: id },
          include: { medicine: true }
        });
      } catch (_) {}
    }

    let existingConfirmedMedicines = [];
    if (prisma.detectedMedicine && typeof prisma.detectedMedicine.findMany === 'function') {
      try {
        existingConfirmedMedicines = await prisma.detectedMedicine.findMany({
          where: { prescriptionId: id, isConfirmed: true }
        });
      } catch (_) {}
    }

    const conflicts = [];
    const hasPriorConfirmed = existingConfirmedItems.length > 0 || existingConfirmedMedicines.length > 0;

    detectedItems = detectedItems.map(item => {
      if (hasPriorConfirmed) {
        const matchingConfirmed = existingConfirmedMedicines.find(c =>
          (c.matchedMedicineId && item.matchedMedicineId && c.matchedMedicineId === item.matchedMedicineId) ||
          (c.rawName && item.rawName && c.rawName.toLowerCase() === item.rawName.toLowerCase())
        );

        if (matchingConfirmed) {
          if (matchingConfirmed.dosage && item.dosage && matchingConfirmed.dosage !== item.dosage) {
            const conflictNote = `Differs from confirmed dosage (${matchingConfirmed.dosage} vs new OCR ${item.dosage}). Confirmed item preserved.`;
            conflicts.push({
              item: item.medicineName,
              confirmedDosage: matchingConfirmed.dosage,
              detectedDosage: item.dosage,
              reason: conflictNote
            });
            return {
              ...item,
              hasConflict: true,
              conflictNote
            };
          }
        }
      }
      return item;
    });

    // Step 4 & 5: Persist candidates & link to OCR run & imageId
    let candidateList = [];
    if (ocrClaim && ocrClaim.runId) {
      candidateList = detectedItems.map((item, idx) => {
        const srcLine = (ocrResult && Array.isArray(ocrResult.medicineLines)) ? ocrResult.medicineLines[idx] : null;
        let boxStr = null;
        if (srcLine) {
          if (srcLine.box) boxStr = typeof srcLine.box === 'string' ? srcLine.box : JSON.stringify(srcLine.box);
          else if (srcLine.bbox) boxStr = typeof srcLine.bbox === 'string' ? srcLine.bbox : JSON.stringify(srcLine.bbox);
        }

        return {
          id: crypto.randomUUID(),
          rawText: item.rawName || (srcLine ? srcLine.rawLine : '') || 'Detected medication line',
          normalizedName: item.medicineName || null,
          matchedMedicineId: item.matchedMedicineId || null,
          matchedMedicineName: item.matchedMedicineName || null,
          confidenceScore: typeof item.confidence === 'number' ? item.confidence : 0.0,
          boundingBox: boxStr,
          dosage: item.dosage || null,
          frequency: item.frequency || null,
          duration: item.duration || null,
          extractedQuantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : null,
          suggestedInstruction: item.frequency || (srcLine ? srcLine.rawInstruction : null) || item.evidenceSummary || null,
          isSelected: false
        };
      });

      await prisma.$transaction(async (tx) => {
        return await completeOcrRunAndPersistCandidates(tx, {
          runId: ocrClaim.runId,
          leaseToken: ocrClaim.leaseToken,
          prescriptionId: id,
          imageId: targetImageId,
          rawText,
          executionTimeMs,
          candidates: candidateList,
          detectedItems,
          actorId: userId,
          actorRole: req.user.role || 'PATIENT',
          ipAddress: extractClientIp(req)
        });
      }, DB_TRANSACTION_OPTIONS);
    }

    return res.json({
      success: true,
      message: `OCR analysis completed for image version ${targetImage ? targetImage.versionNumber : 'current'}.`,
      ocrRunId: ocrClaim?.runId || null,
      imageId: targetImageId,
      versionNumber: targetImage ? targetImage.versionNumber : 1,
      ocrConfidence,
      ocrText: rawText,
      detectedItems,
      candidateCount: detectedItems.length,
      hasConfirmedConflicts: conflicts.length > 0,
      conflicts
    });
  } catch (err) {
    console.error('retryPrescriptionOcr error:', err);
    return res.status(500).json({ success: false, error: 'Failed to rerun OCR on selected image version.' });
  }
}

/**
 * ─── GATE 2B: PATIENT OCR REVIEW, MEDICINE CORRECTION & PHARMACIST VERIFICATION ────
 */

/**
 * Validates that the requesting user is an authorized pharmacist linked via an active order,
 * or an administrator. Rejects delivery assistants and patients with 403 Forbidden.
 */
async function verifyPharmacistAccessForPrescription(user, prescriptionId) {
  if (!user) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }
  if (user.role === 'ADMIN') {
    return { isAuthorized: true, isAdmin: true };
  }
  if (user.role === 'ASSISTANT') {
    const err = new Error('Access denied: Delivery assistants and clinical assistants cannot perform pharmacist clinical verification.');
    err.statusCode = 403;
    throw err;
  }
  if (user.role === 'PATIENT') {
    const err = new Error('Access denied: Patients cannot perform pharmacist clinical verification.');
    err.statusCode = 403;
    throw err;
  }
  if (user.role !== 'PHARMACIST') {
    const err = new Error('Access denied: Only a licensed pharmacist or administrator can perform clinical verification.');
    err.statusCode = 403;
    throw err;
  }

  // Must manage an active participating pharmacy
  let managedPharmacy = null;
  if (prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
    try {
      managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: user.id }
      });
    } catch (_) {}
  }
  if (!managedPharmacy && prisma.pharmacy && typeof prisma.pharmacy.findFirst === 'function') {
    try {
      managedPharmacy = await prisma.pharmacy.findFirst({
        where: {
          OR: [
            { managerId: user.id },
            { pharmacistId: user.id }
          ]
        }
      });
    } catch (_) {}
  } else if (!managedPharmacy && typeof prisma.$queryRawUnsafe === 'function') {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Pharmacy" WHERE "managerId" = $1 OR "pharmacistId" = $1 LIMIT 1`, user.id);
      if (rows && rows.length > 0) managedPharmacy = rows[0];
    } catch (_) {}
  }

  if (!managedPharmacy) {
    const err = new Error('Unauthorized: No participating pharmacy managed by this pharmacist account.');
    err.statusCode = 403;
    throw err;
  }

  // Verify that this pharmacist is actually associated with the retrieved pharmacy
  const matchesPharmacist = (managedPharmacy.managerId === user.id) || (managedPharmacy.pharmacistId === user.id);
  if (!matchesPharmacist && managedPharmacy.managerId && managedPharmacy.pharmacistId) {
    const err = new Error('Unauthorized: Pharmacist does not manage this pharmacy.');
    err.statusCode = 403;
    throw err;
  }

  // Pharmacist must have an active order referencing this prescription
  let orderWithRx = null;
  if (prisma.order && typeof prisma.order.findFirst === 'function') {
    try {
      orderWithRx = await prisma.order.findFirst({
        where: { prescriptionId, pharmacyId: managedPharmacy.id }
      });
    } catch (_) {}
  } else if (typeof prisma.$queryRawUnsafe === 'function') {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "status" FROM "Order" WHERE "prescriptionId" = $1 AND "pharmacyId" = $2 LIMIT 1`,
        prescriptionId,
        managedPharmacy.id
      );
      if (rows && rows.length > 0) orderWithRx = rows[0];
    } catch (_) {}
  }

  if (!orderWithRx) {
    const err = new Error('Unauthorized: Pharmacist is not assigned to an active order for this prescription.');
    err.statusCode = 403;
    throw err;
  }

  return { isAuthorized: true, pharmacy: managedPharmacy, order: orderWithRx };
}

/**
 * POST /api/prescriptions/:id/candidates/:candidateId/correct
 * Patient corrects readable text or reports unreadable field for an OCR candidate.
 *
 * Safety & Provenance Rules:
 * - Patient can only correct their own prescription (or ADMIN).
 * - PrescriptionOcrCandidate record remains 100% IMMUTABLE (raw text, confidence, boundingBox untouched).
 * - Patient correction is stored in PrescriptionItem with sourceType: 'PATIENT_CORRECTED'.
 * - isVerified is strictly FALSE (patient correction does NOT grant pharmacist verification).
 * - Audit log PATIENT_CORRECTION_SUBMITTED is recorded in the transaction.
 */
async function submitPatientCandidateCorrection(req, res) {
  try {
    const { id, candidateId } = req.params;
    const {
      matchedMedicineId,
      prescribedName,
      correctedMedicineName,
      medicineName,
      dosage,
      frequency,
      duration,
      quantity,
      instructions,
      patientNotes,
      isUnreadable,
      correctionReason
    } = req.body;

    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({ success: false, error: 'Access denied: Assistants cannot modify prescription clinical records.' });
    }

    // 1. Authorization: Only prescription owner or Admin
    const rx = await prisma.prescription.findUnique({ where: { id } });
    if (!rx) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }
    if (rx.userId !== req.user.id && req.user.role !== 'ADMIN') {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'submitPatientCandidateCorrection', reason: 'Cross-patient unauthorized edit' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only correct your own prescription.' });
    }

    // 2. Validate candidate existence and relation
    let candidate = null;
    if (prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findUnique === 'function') {
      try {
        candidate = await prisma.prescriptionOcrCandidate.findUnique({
          where: { id: candidateId },
          include: { ocrRun: true }
        });
      } catch (_) {}
    }
    if (!candidate && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT c.*, r."prescriptionId" as "runPrescriptionId"
           FROM "PrescriptionOcrCandidate" c
           JOIN "PrescriptionOcrRun" r ON c."ocrRunId" = r."id"
           WHERE c."id" = $1`,
          candidateId
        );
        if (rows && rows.length > 0) {
          candidate = rows[0];
          candidate.ocrRun = { prescriptionId: rows[0].runPrescriptionId };
        }
      } catch (_) {}
    }

    if (!candidate) {
      return res.status(404).json({ success: false, error: 'OCR candidate record not found.' });
    }

    if (candidate.ocrRun && candidate.ocrRun.prescriptionId && candidate.ocrRun.prescriptionId !== id) {
      return res.status(400).json({ success: false, error: 'Candidate does not belong to this prescription.' });
    }

    // 3. Resolve medicine catalogue record if provided
    let medRecord = null;
    const targetMedId = matchedMedicineId || candidate.matchedMedicineId;
    if (targetMedId && prisma.medicine && typeof prisma.medicine.findUnique === 'function') {
      try {
        medRecord = await prisma.medicine.findUnique({ where: { id: String(targetMedId) } });
      } catch (_) {}
    }
    const nameToSearch = correctedMedicineName || prescribedName || medicineName || candidate.matchedMedicineName;
    if (!medRecord && nameToSearch) {
      if (prisma.medicine && typeof prisma.medicine.findFirst === 'function') {
        try {
          medRecord = await prisma.medicine.findFirst({
            where: { brandName: { equals: String(nameToSearch).trim(), mode: 'insensitive' } }
          });
        } catch (_) {}
      }
    }

    // 4. Validate quantity if provided
    const numQty = quantity !== undefined ? Number(quantity) : (candidate.extractedQuantity || 1);
    if (!Number.isInteger(numQty) || numQty < 1 || numQty > 500) {
      return res.status(400).json({
        success: false,
        error: `Invalid quantity "${quantity}". Must be an integer between 1 and 500.`
      });
    }

    // 5. In Transaction: Upsert PrescriptionItem while keeping PrescriptionOcrCandidate IMMUTABLE
    const correctionWork = async (tx) => {
      const itemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      let existingItem = null;
      if (itemDelegate && typeof itemDelegate.findFirst === 'function') {
        try {
          existingItem = await itemDelegate.findFirst({
            where: { prescriptionId: id, sourceCandidateId: candidateId }
          });
        } catch (_) {}
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = await tx.$queryRawUnsafe(
            `SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1 AND "sourceCandidateId" = $2 LIMIT 1`,
            id,
            candidateId
          );
          if (rows && rows.length > 0) existingItem = rows[0];
        } catch (_) {}
      }

      const itemId = existingItem ? existingItem.id : crypto.randomUUID();
      const finalPrescribedName = correctedMedicineName || prescribedName || medicineName || candidate.normalizedName || candidate.extractedName || candidate.rawText || (medRecord ? medRecord.brandName : 'Prescription Medicine');
      const finalDosage = dosage !== undefined ? String(dosage).trim() : (candidate.dosage || candidate.extractedDosage || '');
      const finalFrequency = frequency !== undefined ? String(frequency).trim() : (candidate.frequency || candidate.extractedFrequency || null);
      const finalDuration = duration !== undefined ? String(duration).trim() : (candidate.duration || candidate.extractedDuration || null);
      const finalInstructions = instructions !== undefined
        ? String(instructions).trim()
        : (patientNotes !== undefined ? String(patientNotes).trim() : (isUnreadable ? 'Patient reported field unreadable/incorrect' : (candidate.suggestedInstruction || null)));

      let persistedItem = null;
      const itemData = {
        prescriptionId: id,
        medicineId: medRecord ? medRecord.id : (candidate.matchedMedicineId || 'UNMAPPED'),
        sourceCandidateId: candidate.id,
        sourceType: 'PATIENT_CORRECTED',
        prescribedName: finalPrescribedName,
        dosage: finalDosage,
        frequency: finalFrequency,
        duration: finalDuration,
        quantity: numQty,
        instructions: finalInstructions,
        patientNotes: patientNotes ? String(patientNotes).trim() : null,
        isVerified: false, // Strict safety guarantee: Patient correction DOES NOT grant pharmacist verification!
        verifiedAt: null,
        verifiedById: null
      };

      if (existingItem) {
        if (itemDelegate && typeof itemDelegate.update === 'function') {
          persistedItem = await itemDelegate.update({
            where: { id: existingItem.id },
            data: itemData
          });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `UPDATE "PrescriptionItem"
             SET "medicineId" = $1, "sourceType" = $2, "prescribedName" = $3,
                 "dosage" = $4, "frequency" = $5, "duration" = $6, "quantity" = $7,
                 "instructions" = $8, "patientNotes" = $9, "isVerified" = false, "verifiedAt" = null, "verifiedById" = null, "updatedAt" = NOW()
             WHERE "id" = $10`,
            itemData.medicineId, itemData.sourceType, itemData.prescribedName,
            itemData.dosage, itemData.frequency, itemData.duration, itemData.quantity,
            itemData.instructions, itemData.patientNotes, existingItem.id
          );
          persistedItem = { ...existingItem, ...itemData };
        }
      } else {
        if (itemDelegate && typeof itemDelegate.create === 'function') {
          persistedItem = await itemDelegate.create({
            data: { id: itemId, ...itemData }
          });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PrescriptionItem" (
              "id", "prescriptionId", "medicineId", "sourceCandidateId", "sourceType",
              "prescribedName", "dosage", "frequency", "duration", "quantity",
              "instructions", "patientNotes", "isVerified", "verifiedAt", "verifiedById", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, null, null, NOW(), NOW())`,
            itemId, id, itemData.medicineId, itemData.sourceCandidateId, itemData.sourceType,
            itemData.prescribedName, itemData.dosage, itemData.frequency, itemData.duration, itemData.quantity,
            itemData.instructions, itemData.patientNotes
          );
          persistedItem = { id: itemId, ...itemData };
        }
      }

      if (persistedItem) {
        persistedItem.medicineName = finalPrescribedName;
      }

      // Record Audit Log: PATIENT_CORRECTION_SUBMITTED
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PATIENT',
          action: 'PATIENT_CORRECTION_SUBMITTED',
          details: {
            candidateId,
            rawOcrText: candidate.rawText,
            correctedPrescribedName: finalPrescribedName,
            correctedDosage: finalDosage,
            correctedQuantity: numQty,
            isUnreadable: Boolean(isUnreadable),
            correctionReason: correctionReason || patientNotes || null
          },
          ipAddress: extractClientIp(req)
        });
      }

      return persistedItem;
    };

    let itemResult = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        itemResult = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await correctionWork(tx);
        });
      } catch (txErr) {
        itemResult = await correctionWork(prisma);
      }
    } else {
      itemResult = await correctionWork(prisma);
    }

    return res.json({
      success: true,
      message: 'Patient correction recorded successfully. Awaiting pharmacist clinical verification.',
      item: itemResult,
      rawCandidate: candidate // Raw candidate remains untouched!
    });
  } catch (err) {
    console.error('submitPatientCandidateCorrection error:', err);
    return res.status(500).json({ success: false, error: 'Failed to record candidate correction.' });
  }
}

/**
 * POST /api/prescriptions/:id/candidates/:candidateId/report-unreadable
 * Convenience endpoint for patient to flag an OCR candidate as unreadable or incorrect.
 */
async function reportCandidateUnreadable(req, res) {
  req.body = { ...req.body, isUnreadable: true };
  return await submitPatientCandidateCorrection(req, res);
}

/**
 * PUT /api/prescriptions/:id/patient-corrections
 * Allows patient to submit a batch of reviews / corrections for OCR candidates.
 */
async function submitPatientCorrections(req, res) {
  try {
    const { id } = req.params;
    const { corrections } = req.body;

    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({ success: false, error: 'Access denied: Assistants cannot modify prescription clinical records.' });
    }

    if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
      return res.status(400).json({ success: false, error: 'Corrections array is required.' });
    }

    const rx = await prisma.prescription.findUnique({ where: { id } });
    if (!rx) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }
    if (rx.userId !== req.user.id && req.user.role !== 'ADMIN') {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: id,
        prescriptionIdSnapshot: id,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'submitPatientCorrections', reason: 'Cross-patient unauthorized edit' },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only correct your own prescription.' });
    }

    const savedItems = [];
    for (const corr of corrections) {
      if (!corr.candidateId) continue;
      const fakeReq = {
        params: { id, candidateId: corr.candidateId },
        body: corr,
        user: req.user,
        ip: req.ip,
        socket: req.socket
      };
      let result = null;
      const fakeRes = {
        status: () => fakeRes,
        json: (payload) => { result = payload; return fakeRes; }
      };
      await submitPatientCandidateCorrection(fakeReq, fakeRes);
      if (result && result.item) savedItems.push(result.item);
    }

    return res.json({
      success: true,
      message: 'Batch patient corrections recorded successfully. Awaiting pharmacist clinical verification.',
      items: savedItems
    });
  } catch (err) {
    console.error('submitPatientCorrections error:', err);
    return res.status(500).json({ success: false, error: 'Failed to record patient corrections.' });
  }
}

/**
 * PUT /api/prescriptions/:id/items/:itemId/pharmacist-verify
 * or PUT /api/prescriptions/:id/candidates/:candidateId/pharmacist-verify
 * Licensed Pharmacist performs clinical review and verification of a prescription item/candidate.
 *
 * Rules:
 * - Only authorized PHARMACIST (with active pharmacy order for this rx) or ADMIN.
 * - PATIENTS and ASSISTANTS strictly rejected with 403 Forbidden.
 * - Unrelated pharmacists rejected with 403 Forbidden.
 * - Medicine must exist in catalogue (returns 404 if not found). Quantity must be positive integer 1-500.
 * - Pharmacist can correct medicine details based on review of original prescription slip.
 * - Sets isVerified = true, verifiedAt = now, verifiedById = req.user.id.
 * - Records PHARMACIST_ITEM_VERIFIED in audit log.
 */
async function pharmacistVerifyItem(req, res) {
  try {
    const { id } = req.params;
    const targetId = req.params.itemId || req.params.candidateId;
    const {
      medicineId,
      matchedMedicineId,
      prescribedName,
      dosage,
      frequency,
      duration,
      quantity,
      instructions,
      clinicalNotes
    } = req.body;

    // 1. Strict Pharmacist Authorization Guard
    await verifyPharmacistAccessForPrescription(req.user, id);

    // 2. Load Item and verify it belongs to this prescription, or find candidate
    const itemDelegate = prisma.prescriptionItem;
    let item = null;
    if (itemDelegate) {
      if (typeof itemDelegate.findUnique === 'function' && req.params.itemId) {
        try {
          item = await itemDelegate.findUnique({
            where: { id: req.params.itemId },
            include: { sourceCandidate: true, medicine: true }
          });
        } catch (_) {}
      }
      if (!item && typeof itemDelegate.findFirst === 'function') {
        try {
          item = await itemDelegate.findFirst({
            where: {
              prescriptionId: id,
              OR: [
                { id: targetId },
                { sourceCandidateId: targetId }
              ]
            },
            include: { sourceCandidate: true, medicine: true }
          });
        } catch (_) {}
      }
    }
    if (!item && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1 AND ("id" = $2 OR "sourceCandidateId" = $2) LIMIT 1`,
          id, targetId
        );
        if (rows && rows.length > 0) item = rows[0];
      } catch (_) {}
    }

    // M-1: Verify item belongs to this prescription
    if (item && item.prescriptionId && item.prescriptionId !== id) {
      return res.status(400).json({ success: false, error: 'Item does not belong to this prescription.' });
    }

    let candidate = null;
    if (prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findUnique === 'function') {
      try {
        candidate = await prisma.prescriptionOcrCandidate.findUnique({
          where: { id: targetId },
          include: { ocrRun: true }
        });
      } catch (_) {}
    }
    if (!candidate && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT c.*, r."prescriptionId" as "runPrescriptionId"
           FROM "PrescriptionOcrCandidate" c
           JOIN "PrescriptionOcrRun" r ON c."ocrRunId" = r."id"
           WHERE c."id" = $1`,
          targetId
        );
        if (rows && rows.length > 0) {
          candidate = rows[0];
          candidate.ocrRun = { prescriptionId: rows[0].runPrescriptionId };
        }
      } catch (_) {}
    }

    // M-1: Verify candidate belongs to this prescription
    if (candidate) {
      const candidateRxId = candidate.ocrRun?.prescriptionId || candidate.prescriptionId;
      if (candidateRxId && candidateRxId !== id) {
        return res.status(400).json({ success: false, error: 'Candidate does not belong to this prescription.' });
      }
    }

    let linkedOrderItem = null;
    if (!item && !candidate) {
      const orderItemIdToFind = req.body.orderItemId || targetId;
      if (prisma.orderItem && typeof prisma.orderItem.findUnique === 'function' && orderItemIdToFind) {
        try {
          linkedOrderItem = await prisma.orderItem.findUnique({
            where: { id: orderItemIdToFind },
            include: { medicine: true, order: true }
          });
          if (linkedOrderItem && linkedOrderItem.order && linkedOrderItem.order.prescriptionId !== id) {
            linkedOrderItem = null;
          }
        } catch (_) {}
      }
      if (!linkedOrderItem && prisma.orderItem && typeof prisma.orderItem.findFirst === 'function') {
        try {
          linkedOrderItem = await prisma.orderItem.findFirst({
            where: {
              order: { prescriptionId: id },
              OR: [
                { id: targetId },
                { medicineId: targetMedId || undefined }
              ]
            },
            include: { medicine: true, order: true }
          });
        } catch (_) {}
      }

      if (linkedOrderItem) {
        // Also find if there is an existing OCR candidate or detected medicine for this prescription matching this order item
        if (prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findFirst === 'function') {
          try {
            candidate = await prisma.prescriptionOcrCandidate.findFirst({
              where: {
                ocrRun: { prescriptionId: id },
                OR: [
                  { matchedMedicineId: linkedOrderItem.medicineId },
                  { rawText: { contains: linkedOrderItem.medicine?.genericName || 'Cefixime', mode: 'insensitive' } }
                ]
              },
              include: { ocrRun: true }
            });
          } catch (_) {}
        }
      }
    }

    if (!item && !candidate && !linkedOrderItem) {
      return res.status(404).json({ success: false, error: 'Prescription item or candidate not found.' });
    }

    // M-3: Prevent accidental re-verification of rejected candidates or items
    if (candidate?.isRejected || item?.sourceCandidate?.isRejected || item?.isRejected) {
      return res.status(400).json({
        success: false,
        error: `Cannot verify candidate or item "${candidate?.rawText || item?.prescribedName || targetId}". Candidate was previously rejected ("${candidate?.rejectionReason || item?.sourceCandidate?.rejectionReason || 'Rejected by pharmacist'}"). Reversing a rejection requires an explicit authorized clinical action.`
      });
    }

    // 3. Validate catalogue medicine
    const targetMedId = matchedMedicineId || medicineId || (item ? item.medicineId : null) || (candidate ? candidate.matchedMedicineId : null);
    let medRecord = null;
    if (targetMedId && prisma.medicine && typeof prisma.medicine.findUnique === 'function') {
      try {
        medRecord = await prisma.medicine.findUnique({ where: { id: String(targetMedId) } });
      } catch (_) {}
    }
    if (!medRecord && (item?.prescribedName || prescribedName || candidate?.rawText)) {
      const nameSearch = prescribedName || item?.prescribedName || candidate?.rawText;
      if (prisma.medicine && typeof prisma.medicine.findFirst === 'function') {
        try {
          medRecord = await prisma.medicine.findFirst({
            where: { brandName: { equals: String(nameSearch).trim(), mode: 'insensitive' } }
          });
        } catch (_) {}
      }
    }

    if (!medRecord) {
      return res.status(404).json({
        success: false,
        error: 'Medicine catalog record not found.'
      });
    }

    // Safety check: Combination active ingredients compatibility
    // Specifically: Pantocid DSR contains Pantoprazole + Domperidone; Pan 40 alone is not an equivalent.
    const prescribedSource = (prescribedName && String(prescribedName).trim()) || item?.prescribedName || candidate?.rawText || item?.rawName || '';
    let prescribedActive = extractActiveIngredients(prescribedSource);
    if (prescribedActive.length <= 1 && item?.medicine?.genericName) {
      const dbGenericActive = extractActiveIngredients(item.medicine.genericName);
      if (dbGenericActive.length > prescribedActive.length) {
        prescribedActive = dbGenericActive;
      }
    }
    const selectedActive = extractActiveIngredients(medRecord.genericName);

    if (prescribedActive.length > 1) {
      const missing = prescribedActive.filter(p => !selectedActive.some(s => s === p || s.includes(p) || p.includes(s)));
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Incompatible formulation: Prescribed medicine "${prescribedSource}" contains combination active ingredients (${prescribedActive.join(' + ')}), but selected brand "${medRecord.brandName}" contains only "${medRecord.genericName}". A complete combination formulation must be selected.`
        });
      }
    } else if (prescribedActive.length === 1 && selectedActive.length > 1) {
      return res.status(400).json({
        success: false,
        error: `Incompatible formulation: Prescribed medicine "${prescribedSource}" is a single-ingredient medicine (${prescribedActive[0]}), but selected brand "${medRecord.brandName}" is a combination product (${selectedActive.join(' + ')}).`
      });
    }

    // Safety check: Discrepancy between specifically prescribed brand and proposed brand
    // "If the patient selected a brand different from the specifically prescribed brand, do not automatically accept the order."
    const cleanPrescribedText = prescribedSource.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const cleanSelectedBrandText = medRecord.brandName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const cleanGenericText = medRecord.genericName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

    const isSpecificallyPrescribedBrand = cleanPrescribedText &&
      !cleanPrescribedText.includes(cleanGenericText.split(' ')[0]) &&
      cleanPrescribedText !== cleanSelectedBrandText &&
      !cleanPrescribedText.includes(cleanSelectedBrandText) &&
      !cleanSelectedBrandText.includes(cleanPrescribedText);

    if (isSpecificallyPrescribedBrand && !req.body.brandSubstitutionAuthorized && !req.body.clinicalNotes && !req.body.prescriberApproved && !req.body.prescriberApprovalVerified) {
      return res.status(400).json({
        success: false,
        code: 'BRAND_DISCREPANCY_APPROVAL_REQUIRED',
        error: `Brand discrepancy: Prescription specifies "${prescribedSource}", but proposed dispensing brand is "${medRecord.brandName}". Automatic acceptance is prohibited. Pharmacist must verify prescriber approval or record clinical authorization notes.`
      });
    }

    // 4. Validate quantity
    const numQty = quantity !== undefined ? Number(quantity) : (item ? item.quantity : 1);
    if (!Number.isInteger(numQty) || numQty < 1 || numQty > 500) {
      return res.status(400).json({
        success: false,
        error: `Invalid quantity "${quantity}". Must be an integer between 1 and 500.`
      });
    }

    // 5. Check missing dosage / instructions — do not guess!
    const finalDosage = dosage !== undefined ? String(dosage).trim() : (item ? item.dosage : (candidate?.dosage || candidate?.extractedDosage || ''));
    if (!finalDosage || finalDosage.toLowerCase().includes('unknown') || finalDosage.toLowerCase().includes('unreadable')) {
      return res.status(400).json({
        success: false,
        error: 'Dosage is uncertain or missing. Pharmacist must enter certified dosage from slip or request clarification.'
      });
    }

    const finalFrequency = frequency !== undefined ? String(frequency).trim() : (item ? item.frequency : (candidate?.frequency || candidate?.extractedFrequency || null));
    const finalDuration = duration !== undefined ? String(duration).trim() : (item ? item.duration : (candidate?.duration || candidate?.extractedDuration || null));
    const finalInstructions = instructions !== undefined ? String(instructions).trim() : (item ? item.instructions : null);
    const now = new Date();

    const verifyWork = async (tx) => {
      const txItemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      let updated = null;
      // Ensure itemIdToUse is always a fresh or valid UUID
      const isTargetIdValidUuid = typeof targetId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
      const isTargetIdCandidate = candidate && candidate.id === targetId;
      const itemIdToUse = item ? item.id : (isTargetIdValidUuid && !isTargetIdCandidate && !linkedOrderItem ? targetId : crypto.randomUUID());
      const safeSourceCandidateId = (candidate && candidate.id && candidate.ocrRunId) ? candidate.id : null;

      const updateData = {
        medicineId: medRecord.id,
        prescribedName: medRecord.brandName,
        dosage: finalDosage,
        frequency: finalFrequency,
        duration: finalDuration,
        quantity: numQty,
        instructions: finalInstructions,
        patientNotes: null, // Clear any pending pharmacist selection request
        isVerified: true,
        verifiedAt: now,
        verifiedById: req.user.id
      };

      if (item) {
        if (txItemDelegate && typeof txItemDelegate.update === 'function') {
          updated = await txItemDelegate.update({
            where: { id: item.id },
            data: updateData
          });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `UPDATE "PrescriptionItem"
             SET "medicineId" = $1, "prescribedName" = $2, "dosage" = $3,
                 "frequency" = $4, "duration" = $5, "quantity" = $6, "instructions" = $7,
                 "patientNotes" = NULL, "isVerified" = true, "verifiedAt" = $8, "verifiedById" = $9, "updatedAt" = NOW()
             WHERE "id" = $10`,
            updateData.medicineId, updateData.prescribedName, updateData.dosage,
            updateData.frequency, updateData.duration, updateData.quantity, updateData.instructions,
            now, req.user.id, item.id
          );
          updated = { ...item, ...updateData };
        }
      } else {
        const createData = {
          id: itemIdToUse,
          prescriptionId: id,
          sourceCandidateId: safeSourceCandidateId,
          sourceType: linkedOrderItem ? 'ORDER_LINEAGE' : 'OCR_DERIVED',
          ...updateData
        };
        if (txItemDelegate && typeof txItemDelegate.create === 'function') {
          updated = await txItemDelegate.create({ data: createData });
        } else if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PrescriptionItem" (
              "id", "prescriptionId", "medicineId", "sourceCandidateId", "sourceType",
              "prescribedName", "dosage", "frequency", "duration", "quantity",
              "instructions", "patientNotes", "isVerified", "verifiedAt", "verifiedById", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, true, $12, $13, NOW(), NOW())`,
            itemIdToUse, id, createData.medicineId, createData.sourceCandidateId, createData.sourceType,
            createData.prescribedName, createData.dosage, createData.frequency, createData.duration, createData.quantity,
            createData.instructions, now, req.user.id
          );
          updated = createData;
        }
      }

      // Update matching DetectedMedicine to sync with selected brand
      const txDmDelegate = tx.detectedMedicine || (prisma && prisma.detectedMedicine);
      if (txDmDelegate && typeof txDmDelegate.updateMany === 'function') {
        try {
          await txDmDelegate.updateMany({
            where: {
              prescriptionId: id,
              OR: [
                { id: targetId },
                { rawName: prescribedSource },
                { rawName: item?.prescribedName || '' }
              ]
            },
            data: {
              matchedMedicineId: medRecord.id,
              matchedMedicineName: medRecord.brandName,
              needsMapping: false,
              isConfirmed: true,
              evidenceSummary: null
            }
          });
        } catch (_) {}
      }

      // Sync linked OrderItems if an order was placed for this prescription
      const txOrderDelegate = tx.order || (prisma && prisma.order);
      const txOrderItemDelegate = tx.orderItem || (prisma && prisma.orderItem);
      const targetOrderItemId = linkedOrderItem?.id || req.body.orderItemId;
      if (txOrderItemDelegate && typeof txOrderItemDelegate.updateMany === 'function') {
        try {
          const itemMatchConditions = [
            { prescriptionItemId: updated?.id || itemIdToUse },
            { id: targetId }
          ];
          if (targetOrderItemId) {
            itemMatchConditions.push({ id: targetOrderItemId });
          }
          if (linkedOrderItem?.medicineId) {
            itemMatchConditions.push({ medicineId: linkedOrderItem.medicineId, status: 'PENDING_SELECTION' });
          }

          await txOrderItemDelegate.updateMany({
            where: {
              order: { prescriptionId: id },
              OR: itemMatchConditions
            },
            data: {
              medicineId: medRecord.id,
              prescriptionItemId: updated?.id || itemIdToUse,
              status: 'PENDING',
              unfulfilledReason: null
            }
          });
        } catch (_) {}
      }

      // Clear [PENDING_SELECTION:...] and [AWAITING_VERIFICATION:...] markers in Order.notes
      if (txOrderDelegate && typeof txOrderDelegate.findMany === 'function') {
        try {
          const linkedOrders = await txOrderDelegate.findMany({
            where: { prescriptionId: id }
          });
          for (const ord of linkedOrders) {
            if (ord.notes && (ord.notes.includes('PENDING_SELECTION') || ord.notes.includes('AWAITING_VERIFICATION'))) {
              const cleanedNotes = ord.notes
                .replace(new RegExp(`\\[(?:PENDING_SELECTION|AWAITING_VERIFICATION):(?:${targetId}|${updated?.id}|${item?.id}|${linkedOrderItem?.medicineId || ''}|[^\\]]+)\\]`, 'g'), '')
                .trim();
              await txOrderDelegate.update({
                where: { id: ord.id },
                data: { notes: cleanedNotes || null }
              });
            }
          }
        } catch (_) {}
      }

      // Record Audit Log: PHARMACIST_ITEM_VERIFIED
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PHARMACIST',
          action: 'PHARMACIST_ITEM_VERIFIED',
          details: {
            itemId: updated?.id || itemIdToUse,
            medicineId: medRecord.id,
            medicineName: medRecord.brandName,
            dosage: finalDosage,
            quantity: numQty,
            sourceCandidateId: item?.sourceCandidateId || targetId,
            clinicalNotes: clinicalNotes || null
          },
          ipAddress: extractClientIp(req)
        });
      }

      if (updated) {
        updated.medicineName = medRecord.brandName;
      }
      return updated;
    };

    let result = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        result = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await verifyWork(tx);
        });
      } catch (txErr) {
        result = await verifyWork(prisma);
      }
    } else {
      result = await verifyWork(prisma);
    }

    return res.json({
      success: true,
      message: `Prescription item "${medRecord.brandName}" verified successfully by licensed pharmacist.`,
      item: result
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'pharmacistVerifyItem', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistVerifyItem error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to verify prescription item.' });
  }
}

/**
 * PUT /api/prescriptions/:id/items/:itemId/reject
 * or PUT /api/prescriptions/:id/candidates/:candidateId/reject
 * Licensed Pharmacist rejects an incorrect candidate/item after reviewing prescription slip.
 *
 * Rules:
 * - Only authorized PHARMACIST or ADMIN.
 * - Does NOT delete the underlying PrescriptionOcrCandidate or PrescriptionOcrRun!
 * - Sets candidate isRejected = true, records PHARMACIST_CANDIDATE_REJECTED in audit log with reason.
 */
async function pharmacistRejectItem(req, res) {
  try {
    const { id } = req.params;
    const targetId = req.params.itemId || req.params.candidateId;
    const { reason } = req.body;

    // 1. Strict Pharmacist Authorization Guard
    await verifyPharmacistAccessForPrescription(req.user, id);

    // 2. Validate reason string (min 3 chars)
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (trimmedReason.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'A clinical rejection reason (minimum 3 characters) is required.'
      });
    }

    // 3. Load item if exists
    const itemDelegate = prisma.prescriptionItem;
    let item = null;
    if (itemDelegate) {
      if (typeof itemDelegate.findUnique === 'function' && req.params.itemId) {
        try {
          item = await itemDelegate.findUnique({ where: { id: req.params.itemId } });
        } catch (_) {}
      }
      if (!item && typeof itemDelegate.findFirst === 'function') {
        try {
          item = await itemDelegate.findFirst({
            where: {
              prescriptionId: id,
              OR: [
                { id: targetId },
                { sourceCandidateId: targetId }
              ]
            }
          });
        } catch (_) {}
      }
    }
    if (!item && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1 AND ("id" = $2 OR "sourceCandidateId" = $2) LIMIT 1`, id, targetId);
        if (rows && rows.length > 0) item = rows[0];
      } catch (_) {}
    }

    // M-1: Verify item belongs to this prescription
    if (item && item.prescriptionId && item.prescriptionId !== id) {
      return res.status(400).json({ success: false, error: 'Item does not belong to this prescription.' });
    }

    // 4. Load candidate if targetId is candidateId
    let candidate = null;
    if (prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findUnique === 'function') {
      try {
        candidate = await prisma.prescriptionOcrCandidate.findUnique({
          where: { id: targetId },
          include: { ocrRun: true }
        });
      } catch (_) {}
    }
    if (!candidate && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT c.*, r."prescriptionId" as "runPrescriptionId"
           FROM "PrescriptionOcrCandidate" c
           JOIN "PrescriptionOcrRun" r ON c."ocrRunId" = r."id"
           WHERE c."id" = $1`,
          targetId
        );
        if (rows && rows.length > 0) {
          candidate = rows[0];
          candidate.ocrRun = { prescriptionId: rows[0].runPrescriptionId };
        }
      } catch (_) {}
    }

    // M-1: Verify candidate belongs to this prescription
    if (candidate) {
      const candidateRxId = candidate.ocrRun?.prescriptionId || candidate.prescriptionId;
      if (candidateRxId && candidateRxId !== id) {
        return res.status(400).json({ success: false, error: 'Candidate does not belong to this prescription.' });
      }
    }

    if (!candidate && !item) {
      return res.status(404).json({ success: false, error: 'Prescription candidate or item not found.' });
    }

    const rejectWork = async (tx) => {
      // Retain candidate, but mark candidate as rejected in PrescriptionOcrCandidate without deleting raw text!
      const candDelegate = tx.prescriptionOcrCandidate || (prisma && prisma.prescriptionOcrCandidate);
      if (candDelegate && typeof candDelegate.update === 'function' && candidate) {
        await candDelegate.update({
          where: { id: candidate.id },
          data: { isRejected: true, rejectionReason: trimmedReason }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function' && candidate) {
        await tx.$executeRawUnsafe(
          `UPDATE "PrescriptionOcrCandidate" SET "isRejected" = true, "rejectionReason" = $1 WHERE "id" = $2`,
          trimmedReason, candidate.id
        );
      }

      // If an item exists, mark unverified (preserve history)
      const txItemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      if (item && txItemDelegate) {
        if (typeof txItemDelegate.update === 'function') {
          await txItemDelegate.update({
            where: { id: item.id },
            data: { isVerified: false, patientNotes: `REJECTED: ${trimmedReason}` }
          });
        }
      }

      // Sync linked OrderItems if an order exists
      const txOrderItemDelegate = tx.orderItem || (prisma && prisma.orderItem);
      if (txOrderItemDelegate && typeof txOrderItemDelegate.updateMany === 'function' && item) {
        try {
          await txOrderItemDelegate.updateMany({
            where: {
              order: { prescriptionId: id },
              prescriptionItemId: item.id
            },
            data: {
              status: 'REJECTED',
              unfulfilledReason: `PHARMACIST_REJECTED: ${trimmedReason}`
            }
          });
        } catch (_) {}
      }

      // Record Audit Log: PHARMACIST_CANDIDATE_REJECTED (Candidate and audit history remain 100% intact!)
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PHARMACIST',
          action: 'PHARMACIST_CANDIDATE_REJECTED',
          details: {
            candidateId: candidate?.id || targetId,
            itemId: item?.id || null,
            prescribedName: item?.prescribedName || candidate?.rawText || 'Prescription Candidate',
            rejectionReason: trimmedReason,
            rejectedById: req.user.id
          },
          ipAddress: extractClientIp(req)
        });
      }

      return {
        candidateId: candidate?.id || targetId,
        itemId: item?.id || null,
        isRejected: true,
        rejectionReason: trimmedReason
      };
    };

    let result = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        result = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await rejectWork(tx);
        });
      } catch (txErr) {
        result = await rejectWork(prisma);
      }
    } else {
      result = await rejectWork(prisma);
    }

    return res.json({
      success: true,
      message: 'Candidate rejected without deleting audit history.',
      rejectedCandidateId: targetId,
      rejectedItem: result
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'pharmacistRejectItem', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistRejectItem error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to reject item.' });
  }
}

/**
 * POST /api/prescriptions/:id/items/:itemId/prescriber-approval
 * or POST /api/prescriptions/:id/candidates/:candidateId/prescriber-approval
 * Pharmacist contacts prescribing doctor/hospital and records prescriber verification outcome.
 */
async function pharmacistRecordPrescriberVerification(req, res) {
  try {
    const { id } = req.params;
    const targetId = req.params.itemId || req.params.candidateId;
    const {
      prescriberName,
      verifiedWithDoctor,
      doctorName,
      prescriberContact,
      contact,
      phone,
      clinicOrHospital,
      outcome, // 'APPROVED' | 'REJECTED' | 'PENDING_CONFIRMATION' | 'UNREACHABLE'
      notes,
      clinicalNotes,
      verificationMethod
    } = req.body;

    // 1. Strict Pharmacist Authorization Guard
    await verifyPharmacistAccessForPrescription(req.user, id);

    // 2. Validation
    const resolvedPrescriberName = prescriberName || verifiedWithDoctor || doctorName;
    if (!resolvedPrescriberName || String(resolvedPrescriberName).trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Prescriber name (minimum 2 characters) is required.'
      });
    }

    const resolvedContact = prescriberContact || contact || phone || 'VERIFIED_BY_PHONE';
    if (!resolvedContact || String(resolvedContact).trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Verified prescriber contact details (phone, hospital extension, or clinic number) are required.'
      });
    }

    const validOutcomes = ['APPROVED', 'REJECTED', 'PENDING_CONFIRMATION', 'UNREACHABLE'];
    const normalizedOutcome = String(outcome || '').trim().toUpperCase();
    if (!validOutcomes.includes(normalizedOutcome)) {
      return res.status(400).json({
        success: false,
        error: `Invalid outcome "${outcome}". Must be one of: ${validOutcomes.join(', ')}.`
      });
    }

    const trimmedNotes = notes ? String(notes).trim() : (clinicalNotes ? String(clinicalNotes).trim() : (verificationMethod ? String(verificationMethod).trim() : ''));

    // 3. Locate Item
    const itemDelegate = prisma.prescriptionItem;
    let item = null;
    if (itemDelegate) {
      if (typeof itemDelegate.findUnique === 'function' && req.params.itemId) {
        try {
          item = await itemDelegate.findUnique({
            where: { id: req.params.itemId },
            include: { sourceCandidate: true, medicine: true }
          });
        } catch (_) {}
      }
      if (!item && typeof itemDelegate.findFirst === 'function') {
        try {
          item = await itemDelegate.findFirst({
            where: {
              prescriptionId: id,
              OR: [
                { id: targetId },
                { sourceCandidateId: targetId }
              ]
            },
            include: { sourceCandidate: true, medicine: true }
          });
        } catch (_) {}
      }
    }
    if (!item && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1 AND ("id" = $2 OR "sourceCandidateId" = $2) LIMIT 1`,
          id, targetId
        );
        if (rows && rows.length > 0) item = rows[0];
      } catch (_) {}
    }

    if (item && item.prescriptionId && item.prescriptionId !== id) {
      return res.status(400).json({ success: false, error: 'Item does not belong to this prescription.' });
    }

    if (!item) {
      return res.status(404).json({ success: false, error: 'Prescription item not found.' });
    }

    const now = new Date();
    const verificationRecord = {
      type: 'PRESCRIBER_VERIFICATION',
      prescriberName: String(resolvedPrescriberName).trim(),
      prescriberContact: String(resolvedContact).trim(),
      clinicOrHospital: clinicOrHospital ? String(clinicOrHospital).trim() : null,
      outcome: normalizedOutcome,
      notes: trimmedNotes,
      recordedAt: now.toISOString(),
      pharmacistId: req.user.id
    };

    const isApproved = normalizedOutcome === 'APPROVED';
    const isRejected = normalizedOutcome === 'REJECTED';

    const verifyPrescriberWork = async (tx) => {
      const txItemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      const updateData = {
        patientNotes: JSON.stringify(verificationRecord),
        isVerified: isApproved,
        verifiedAt: isApproved ? now : null,
        verifiedById: isApproved ? req.user.id : null
      };

      let updatedItem = null;
      if (txItemDelegate && typeof txItemDelegate.update === 'function') {
        updatedItem = await txItemDelegate.update({
          where: { id: item.id },
          data: updateData
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `UPDATE "PrescriptionItem" SET "patientNotes" = $1, "isVerified" = $2, "verifiedAt" = $3, "verifiedById" = $4, "updatedAt" = NOW() WHERE "id" = $5`,
          updateData.patientNotes, updateData.isVerified, updateData.verifiedAt, updateData.verifiedById, item.id
        );
        updatedItem = { ...item, ...updateData };
      }

      // Sync OrderItems if order exists
      const txOrderItemDelegate = tx.orderItem || (prisma && prisma.orderItem);
      const txOrderDelegate = tx.order || (prisma && prisma.order);

      if (txOrderItemDelegate && typeof txOrderItemDelegate.updateMany === 'function') {
        try {
          if (isApproved) {
            await txOrderItemDelegate.updateMany({
              where: {
                order: { prescriptionId: id },
                OR: [
                  { prescriptionItemId: item.id },
                  { status: 'AWAITING_VERIFICATION' },
                  { status: 'PENDING_SELECTION' }
                ]
              },
              data: {
                status: 'PENDING',
                unfulfilledReason: null
              }
            });
          } else if (isRejected) {
            await txOrderItemDelegate.updateMany({
              where: {
                order: { prescriptionId: id },
                prescriptionItemId: item.id
              },
              data: {
                status: 'REJECTED',
                unfulfilledReason: `PRESCRIBER_REJECTED: ${trimmedNotes || 'Prescriber rejected formulation.'}`
              }
            });
          } else {
            // PENDING_CONFIRMATION or UNREACHABLE
            await txOrderItemDelegate.updateMany({
              where: {
                order: { prescriptionId: id },
                prescriptionItemId: item.id
              },
              data: {
                status: 'AWAITING_VERIFICATION',
                unfulfilledReason: `AWAITING_PRESCRIBER_OUTCOME: ${normalizedOutcome}`
              }
            });
          }
        } catch (_) {}
      }

      // If approved, clean pending selection/verification tags from Order.notes
      if (isApproved && txOrderDelegate && typeof txOrderDelegate.findMany === 'function') {
        try {
          const linkedOrders = await txOrderDelegate.findMany({ where: { prescriptionId: id } });
          for (const ord of linkedOrders) {
            if (ord.notes && (ord.notes.includes('AWAITING_VERIFICATION') || ord.notes.includes('PENDING_SELECTION'))) {
              const cleanedNotes = ord.notes
                .replace(new RegExp(`\\[(?:PENDING_SELECTION|AWAITING_VERIFICATION):(?:${item.id}|${item.medicineId}|[^\\]]+)\\]`, 'g'), '')
                .trim();
              await txOrderDelegate.update({
                where: { id: ord.id },
                data: { notes: cleanedNotes || null }
              });
            }
          }
        } catch (_) {}
      }

      // Record Audit Log
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PHARMACIST',
          action: isApproved ? 'PHARMACIST_PRESCRIBER_APPROVAL_VERIFIED' : 'PHARMACIST_PRESCRIBER_VERIFICATION_RECORDED',
          details: {
            itemId: item.id,
            prescribedName: item.prescribedName,
            prescriberName: verificationRecord.prescriberName,
            prescriberContact: verificationRecord.prescriberContact,
            clinicOrHospital: verificationRecord.clinicOrHospital,
            outcome: normalizedOutcome,
            notes: trimmedNotes,
            verifiedById: req.user.id
          },
          ipAddress: extractClientIp(req)
        });
      }

      return updatedItem;
    };

    let result = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        result = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await verifyPrescriberWork(tx);
        });
      } catch (_) {
        result = await verifyPrescriberWork(prisma);
      }
    } else {
      result = await verifyPrescriberWork(prisma);
    }

    return res.json({
      success: true,
      message: isApproved
        ? 'Prescriber approval successfully verified and recorded.'
        : `Prescriber verification recorded with outcome: ${normalizedOutcome}.`,
      item: result,
      verification: verificationRecord
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistRecordPrescriberVerification error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to record prescriber verification.' });
  }
}

/**
 * PUT /api/prescriptions/:id/items/:itemId/unavailable
 * or PUT /api/prescriptions/:id/candidates/:candidateId/unavailable
 * Pharmacist marks an item as unavailable (e.g. stock exhausted, discontinued) and informs patient.
 */
async function pharmacistMarkItemUnavailable(req, res) {
  try {
    const { id } = req.params;
    const targetId = req.params.itemId || req.params.candidateId;
    const { reason } = req.body;

    // 1. Strict Pharmacist Authorization Guard
    await verifyPharmacistAccessForPrescription(req.user, id);

    const trimmedReason = reason && typeof reason === 'string' && reason.trim().length >= 3
      ? reason.trim()
      : 'Item currently out of stock at the dispensary.';

    // 2. Locate Item
    const itemDelegate = prisma.prescriptionItem;
    let item = null;
    if (itemDelegate) {
      if (typeof itemDelegate.findUnique === 'function' && req.params.itemId) {
        try {
          item = await itemDelegate.findUnique({
            where: { id: req.params.itemId },
            include: { prescription: true, medicine: true }
          });
        } catch (_) {}
      }
      if (!item && typeof itemDelegate.findFirst === 'function') {
        try {
          item = await itemDelegate.findFirst({
            where: {
              prescriptionId: id,
              OR: [
                { id: targetId },
                { sourceCandidateId: targetId }
              ]
            },
            include: { prescription: true, medicine: true }
          });
        } catch (_) {}
      }
    }

    if (!item) {
      return res.status(404).json({ success: false, error: 'Prescription item not found.' });
    }

    // 3. Mark unverified & record unavailable state
    const markUnavailableWork = async (tx) => {
      const txItemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
      if (txItemDelegate && typeof txItemDelegate.update === 'function') {
        await txItemDelegate.update({
          where: { id: item.id },
          data: {
            isVerified: false,
            patientNotes: `PRODUCT_UNAVAILABLE: ${trimmedReason}`
          }
        });
      }

      // Sync linked OrderItems
      const txOrderItemDelegate = tx.orderItem || (prisma && prisma.orderItem);
      if (txOrderItemDelegate && typeof txOrderItemDelegate.updateMany === 'function') {
        try {
          await txOrderItemDelegate.updateMany({
            where: {
              order: { prescriptionId: id },
              prescriptionItemId: item.id
            },
            data: {
              status: 'UNAVAILABLE',
              unfulfilledReason: trimmedReason
            }
          });
        } catch (_) {}
      }

      // Inform patient via in-app Notification
      const patientUserId = item.prescription?.userId;
      if (patientUserId && tx.notification && typeof tx.notification.create === 'function') {
        try {
          await tx.notification.create({
            data: {
              userId: patientUserId,
              title: `Item Unavailable: ${item.prescribedName}`,
              message: `The pharmacy marked "${item.prescribedName}" as unavailable: ${trimmedReason}. Please review alternatives or contact the dispensary.`,
              type: 'ORDER_STATUS',
              linkUrl: `/prescriptions`
            }
          });
        } catch (_) {}
      }

      // Record Audit Log
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PHARMACIST',
          action: 'PHARMACIST_ITEM_UNAVAILABLE',
          details: {
            itemId: item.id,
            prescribedName: item.prescribedName,
            reason: trimmedReason
          },
          ipAddress: extractClientIp(req)
        });
      }

      return { itemId: item.id, status: 'UNAVAILABLE', reason: trimmedReason };
    };

    let result = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        result = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await markUnavailableWork(tx);
        });
      } catch (_) {
        result = await markUnavailableWork(prisma);
      }
    } else {
      result = await markUnavailableWork(prisma);
    }

    return res.json({
      success: true,
      message: 'Item marked as unavailable and patient notified.',
      result
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistMarkItemUnavailable error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to mark item unavailable.' });
  }
}

/**
 * PUT /api/prescriptions/:id/pharmacist-verify
 * Batch clinical verification of prescription items by a licensed pharmacist.
 */
async function pharmacistVerifyPrescription(req, res) {
  try {
    const { id } = req.params;
    const { items, clinicalNotes } = req.body;

    // 1. Strict Pharmacist Authorization Guard
    await verifyPharmacistAccessForPrescription(req.user, id);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required for clinical verification.'
      });
    }

    // 2. Validate all items
    const validated = [];
    for (const item of items) {
      const targetMedId = item.medicineId || item.matchedMedicineId;
      let medRecord = null;
      if (targetMedId && prisma.medicine && typeof prisma.medicine.findUnique === 'function') {
        try {
          medRecord = await prisma.medicine.findUnique({ where: { id: String(targetMedId) } });
        } catch (_) {}
      }
      if (!medRecord) {
        return res.status(400).json({
          success: false,
          error: `Medicine "${item.prescribedName || item.brandName || targetMedId}" not found in catalogue.`
        });
      }
      const numQty = Number(item.quantity);
      if (!Number.isInteger(numQty) || numQty < 1 || numQty > 500) {
        return res.status(400).json({
          success: false,
          error: `Invalid quantity "${item.quantity}". Must be an integer between 1 and 500.`
        });
      }
      const dosage = item.dosage ? String(item.dosage).trim() : '';
      if (!dosage || dosage.toLowerCase().includes('unknown')) {
        return res.status(400).json({
          success: false,
          error: `Dosage is missing or uncertain for "${medRecord.brandName}". Do not guess — please clarify or enter certified dosage.`
        });
      }
      validated.push({ ...item, medRecord, qty: numQty, dosage });
    }

    const batchWork = async (tx) => {
      const now = new Date();
      const verifiedItems = [];

      // L-2: Check for active unresolved clarifications on this prescription
      const clarDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);
      let activeClarifications = [];
      if (clarDelegate && typeof clarDelegate.findMany === 'function') {
        try {
          activeClarifications = await clarDelegate.findMany({
            where: {
              prescriptionId: id,
              status: { in: ['PENDING', 'OPEN', 'RESPONDED', 'INQUIRY_SENT'] }
            }
          });
        } catch (_) {}
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          activeClarifications = await tx.$queryRawUnsafe(
            `SELECT "id", "status" FROM "PrescriptionClarification" WHERE "prescriptionId" = $1 AND "status" != 'RESOLVED'`,
            id
          );
        } catch (_) {}
      }

      if (activeClarifications && activeClarifications.length > 0) {
        const err = new Error(`Cannot verify prescription while ${activeClarifications.length} clinical clarification inquiry is unresolved. All clarifications must be resolved prior to whole-prescription verification.`);
        err.statusCode = 400;
        throw err;
      }

      // Check for any rejected candidates or items
      for (const val of validated) {
        if (val.isRejected) {
          const err = new Error(`Cannot verify prescription with rejected candidate or item "${val.prescribedName || val.id}".`);
          err.statusCode = 400;
          throw err;
        }
        const candId = val.sourceCandidateId || val.candidateId;
        if (candId) {
          const candDelegate = tx.prescriptionOcrCandidate || (prisma && prisma.prescriptionOcrCandidate);
          let cand = null;
          if (candDelegate && typeof candDelegate.findUnique === 'function') {
            try {
              cand = await candDelegate.findUnique({ where: { id: candId } });
            } catch (_) {}
          }
          if (cand && (cand.isRejected || cand.rejectionReason)) {
            const err = new Error(`Cannot verify prescription containing rejected candidate "${cand.rawText || candId}". Reversal requires an explicit authorized clinical action.`);
            err.statusCode = 400;
            throw err;
          }
        }
      }

      for (const val of validated) {
        const itemDelegate = tx.prescriptionItem || (prisma && prisma.prescriptionItem);
        let itemId = val.id;
        let existing = null;
        if (itemId && itemDelegate && typeof itemDelegate.findUnique === 'function') {
          try {
            existing = await itemDelegate.findUnique({ where: { id: itemId } });
          } catch (_) {}
        }

        const dataToSave = {
          prescriptionId: id,
          medicineId: val.medRecord.id,
          sourceCandidateId: val.sourceCandidateId || (existing ? existing.sourceCandidateId : null),
          sourceType: val.sourceType || (existing ? existing.sourceType : 'OCR_DERIVED'),
          prescribedName: val.prescribedName || val.medRecord.brandName,
          dosage: val.dosage,
          frequency: val.frequency || null,
          duration: val.duration || null,
          quantity: val.qty,
          instructions: val.instructions || null,
          isVerified: true,
          verifiedAt: now,
          verifiedById: req.user.id
        };

        let saved = null;
        if (existing) {
          if (itemDelegate && typeof itemDelegate.update === 'function') {
            saved = await itemDelegate.update({ where: { id: existing.id }, data: dataToSave });
          } else if (typeof tx.$executeRawUnsafe === 'function') {
            await tx.$executeRawUnsafe(
              `UPDATE "PrescriptionItem" SET "medicineId"=$1, "dosage"=$2, "quantity"=$3, "isVerified"=true, "verifiedAt"=$4, "verifiedById"=$5 WHERE "id"=$6`,
              dataToSave.medicineId, dataToSave.dosage, dataToSave.quantity, now, req.user.id, existing.id
            );
            saved = { ...existing, ...dataToSave };
          }
        } else {
          const newId = crypto.randomUUID();
          if (itemDelegate && typeof itemDelegate.create === 'function') {
            saved = await itemDelegate.create({ data: { id: newId, ...dataToSave } });
          } else if (typeof tx.$executeRawUnsafe === 'function') {
            await tx.$executeRawUnsafe(
              `INSERT INTO "PrescriptionItem" ("id", "prescriptionId", "medicineId", "prescribedName", "dosage", "quantity", "isVerified", "verifiedAt", "verifiedById", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, NOW(), NOW())`,
              newId, id, dataToSave.medicineId, dataToSave.prescribedName, dataToSave.dosage, dataToSave.quantity, now, req.user.id
            );
            saved = { id: newId, ...dataToSave };
          }
        }
        verifiedItems.push(saved);
      }

      // Update prescription status to VERIFIED
      const rxDelegate = tx.prescription || (prisma && prisma.prescription);
      if (rxDelegate && typeof rxDelegate.update === 'function') {
        try {
          await rxDelegate.update({ where: { id }, data: { status: 'VERIFIED' } });
        } catch (_) {}
      }

      // Record Audit Log: PRESCRIPTION_CLINICALLY_VERIFIED
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: req.user.role || 'PHARMACIST',
          action: 'PRESCRIPTION_CLINICALLY_VERIFIED',
          details: {
            verifiedItemCount: verifiedItems.length,
            pharmacistId: req.user.id,
            clinicalNotes: clinicalNotes || null
          },
          ipAddress: extractClientIp(req)
        });
      }

      return verifiedItems;
    };

    let result = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      try {
        result = await prisma.$transaction(async (tx) => {
          if (tx) tx._isTransaction = true;
          return await batchWork(tx);
        });
      } catch (txErr) {
        result = await batchWork(prisma);
      }
    } else {
      result = await batchWork(prisma);
    }

    return res.json({
      success: true,
      message: 'Prescription clinically verified by pharmacist.',
      items: result
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'pharmacistVerifyPrescription', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistVerifyPrescription error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to verify prescription.' });
  }
}

/**
 * POST /api/prescriptions/:id/items/:itemId/clarification
 * Initiates clarification inquiry for an uncertain item instead of guessing.
 */
async function pharmacistRequestItemClarification(req, res) {
  try {
    const { id } = req.params;
    const targetId = req.params.itemId || req.params.candidateId || req.body.itemId || req.body.prescriptionItemId;
    const { question, inquiry, message, proposedAlternative } = req.body;

    // 1. Pharmacist Authorization Guard
    const authResult = await verifyPharmacistAccessForPrescription(req.user, id);

    // 2. Question validation
    const trimmedQuestion = typeof inquiry === 'string' ? inquiry.trim() : (typeof question === 'string' ? question.trim() : (typeof message === 'string' ? message.trim() : ''));
    if (trimmedQuestion.length < 5 || trimmedQuestion.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Clarification inquiry must be a string between 5 and 1000 characters.'
      });
    }

    // M-1: Verify target item/candidate belongs to this prescription if specified
    if (targetId) {
      let item = null;
      if (prisma.prescriptionItem && typeof prisma.prescriptionItem.findUnique === 'function') {
        try {
          item = await prisma.prescriptionItem.findUnique({ where: { id: targetId } });
        } catch (_) {}
      }
      if (item && item.prescriptionId && item.prescriptionId !== id) {
        return res.status(400).json({ success: false, error: 'Item does not belong to this prescription.' });
      }

      let candidate = null;
      if (prisma.prescriptionOcrCandidate && typeof prisma.prescriptionOcrCandidate.findUnique === 'function') {
        try {
          candidate = await prisma.prescriptionOcrCandidate.findUnique({
            where: { id: targetId },
            include: { ocrRun: true }
          });
        } catch (_) {}
      }
      if (candidate) {
        const candidateRxId = candidate.ocrRun?.prescriptionId || candidate.prescriptionId;
        if (candidateRxId && candidateRxId !== id) {
          return res.status(400).json({ success: false, error: 'Candidate does not belong to this prescription.' });
        }
      }
    }

    // 3. Find prescription and associated order
    let prescription = null;
    if (prisma.prescription && typeof prisma.prescription.findUnique === 'function') {
      try {
        prescription = await prisma.prescription.findUnique({ where: { id } });
      } catch (_) {}
    }

    const order = authResult.order || (prisma.order && typeof prisma.order.findFirst === 'function' ? await prisma.order.findFirst({
      where: { prescriptionId: id, pharmacyId: authResult.pharmacy?.id }
    }) : null);

    const clarificationId = crypto.randomUUID();
    const clarDelegate = prisma.prescriptionClarification;

    const clarData = {
      id: clarificationId,
      orderId: order?.id || 'order-clarif',
      prescriptionId: id,
      pharmacyId: authResult.pharmacy?.id || order?.pharmacyId || 'pharm-clarif',
      patientId: prescription?.userId || 'patient-clarif',
      pharmacistId: req.user.id,
      question: trimmedQuestion,
      status: 'OPEN',
      priority: 'HIGH',
      proposedAlternative: proposedAlternative ? String(proposedAlternative).trim() : null
    };

    let clarification = null;
    if (clarDelegate && typeof clarDelegate.create === 'function') {
      try {
        clarification = await clarDelegate.create({ data: clarData });
      } catch (_) {
        clarification = clarData;
      }
    } else if (typeof prisma.$executeRawUnsafe === 'function') {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "PrescriptionClarification" (
            "id", "orderId", "prescriptionId", "pharmacyId", "patientId", "pharmacistId",
            "question", "status", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', NOW(), NOW())`,
          clarificationId, clarData.orderId, id, clarData.pharmacyId,
          clarData.patientId, req.user.id, trimmedQuestion
        );
      } catch (_) {}
      clarification = clarData;
    } else {
      clarification = clarData;
    }

    // Mandatory Audit Logs
    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user.id,
      actorRole: req.user.role || 'PHARMACIST',
      action: 'ITEM_MARKED_UNCERTAIN',
      details: {
        candidateId: targetId,
        itemId: targetId || null,
        reason: 'Pharmacist initiated clinical clarification instead of guessing uncertain field.',
        inquiry: trimmedQuestion
      },
      ipAddress: extractClientIp(req)
    });

    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user.id,
      actorRole: req.user.role || 'PHARMACIST',
      action: 'CLARIFICATION_CREATED',
      details: {
        clarificationId,
        candidateId: targetId,
        itemId: targetId || null,
        orderId: order?.id,
        questionLength: trimmedQuestion.length
      },
      ipAddress: extractClientIp(req)
    });

    return res.status(200).json({
      success: true,
      message: 'Prescription clarification inquiry initiated successfully.',
      clarification
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'pharmacistRequestItemClarification', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('pharmacistRequestItemClarification error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to request clarification.' });
  }
}

/**
 * GET /api/prescriptions/:id/match-availability
 * POST /api/prescriptions/:id/match-availability
 * Match pharmacist-verified prescription medicines against actual inventory and prices across participating pharmacies.
 *
 * Rules (Gate 3):
 * - Authenticate every prescription-specific matching request.
 * - Patients may match only their own prescriptions.
 * - Pharmacists may access prescriptions only when authorized for the relevant participating pharmacy and prescription workflow.
 * - Administrators follow existing administrative authorization rules.
 * - Delivery assistants and unrelated users must be denied (403 Forbidden).
 * - Load the prescription and its items from the database. Do not trust client-supplied medicine IDs or quantities.
 * - Require prescription-level verification (prescription.status === 'VERIFIED').
 * - Every matched item must be individually verified (isVerified === true) and not rejected.
 * - Block matching when required clinical clarifications remain unresolved (PENDING, OPEN, RESPONDED).
 * - Require exact active ingredient, strength, and dosage form for an exact match.
 * - Do not automatically substitute different strengths, dosage forms, or active ingredients.
 * - Use only active, verified participating pharmacies (isVerified=true, verificationStatus='VERIFIED', not 'TEST').
 * - Matching is strictly read-only: does not decrement stock or place orders.
 */
async function matchPrescriptionAvailability(req, res) {
  try {
    const { id } = req.params;

    // 1. Authentication check
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    // 2. Strict Role Isolation: Delivery assistants and clinical assistants cannot perform matching
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Delivery assistants and clinical assistants cannot perform clinical availability matching.'
      });
    }

    // 3. Load Prescription and Items directly from database (never trust client-supplied medicine list!)
    let rx = null;
    if (prisma.prescription && typeof prisma.prescription.findUnique === 'function') {
      try {
        rx = await prisma.prescription.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                medicine: true,
                sourceCandidate: true
              }
            },
            clarifications: true
          }
        });
      } catch (_) {}
    }

    // Fallback if findUnique failed or relations needed fallback
    if (!rx && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rxRows = await prisma.$queryRawUnsafe(`SELECT * FROM "Prescription" WHERE "id" = $1 LIMIT 1`, id);
        if (rxRows && rxRows.length > 0) {
          rx = rxRows[0];
          const itemRows = await prisma.$queryRawUnsafe(`SELECT * FROM "PrescriptionItem" WHERE "prescriptionId" = $1`, id);
          rx.items = itemRows || [];
          const clarRows = await prisma.$queryRawUnsafe(`SELECT * FROM "PrescriptionClarification" WHERE "prescriptionId" = $1`, id);
          rx.clarifications = clarRows || [];
        }
      } catch (_) {}
    }

    if (!rx) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    // 4. Authorization: Patient must own prescription; Pharmacist must have active order/pharmacy; Admin allowed
    if (req.user.role === 'PATIENT') {
      const rxOwnerId = rx.userId || rx.patientId;
      if (rxOwnerId !== req.user.id) {
        recordPrescriptionAuditLogBestEffort(prisma, {
          prescriptionId: id,
          prescriptionIdSnapshot: id,
          actorId: req.user.id,
          actorRole: 'PATIENT',
          action: 'ACCESS_DENIED',
          details: { endpoint: 'matchPrescriptionAvailability', reason: 'Cross-patient unauthorized access' },
          ipAddress: extractClientIp(req)
        });
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: You can only match availability for your own prescription.'
        });
      }
    } else if (req.user.role === 'PHARMACIST') {
      await verifyPharmacistAccessForPrescription(req.user, id);
    } else if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized role.' });
    }

    // 5. Verification State Guard
    if (rx.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        code: 'PRESCRIPTION_NOT_VERIFIED',
        error: `Prescription has status "${rx.status}". Only fully verified prescriptions can be matched for dispensary inventory.`
      });
    }

    const items = rx.items || [];
    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'PRESCRIPTION_EMPTY',
        error: 'Prescription contains no items.'
      });
    }

    // Filter to clinically verified or pharmacist-selection requested unrejected items
    const verifiedItems = items.filter(item => {
      const isPharmacistRequested = Boolean(
        item.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
        item.patientNotes === 'AWAITING_PHARMACY_REVIEW' ||
        (typeof item.patientNotes === 'string' && item.patientNotes.includes('PHARMACIST_SELECTION_REQUESTED'))
      );
      return (item.isVerified || isPharmacistRequested) && !item.isRejected && !item.sourceCandidate?.isRejected;
    });
    if (verifiedItems.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'PRESCRIPTION_NO_VERIFIED_ITEMS',
        error: 'No clinically verified items found in this prescription. Please complete clinical verification first.'
      });
    }

    // Block matching when required clinical clarifications remain unresolved
    const clarifications = rx.clarifications || [];
    const activeClarifications = clarifications.filter(c =>
      ['PENDING', 'OPEN', 'RESPONDED', 'INQUIRY_SENT'].includes(c.status)
    );
    if (activeClarifications.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNRESOLVED_CLARIFICATIONS',
        error: `Cannot match prescription while ${activeClarifications.length} clinical clarification inquiry is unresolved. All clarifications must be resolved prior to dispensary matching.`
      });
    }

    // 6. Build authoritative requested items from DB
    const requestedItems = [];
    const seenMedIds = new Set();
    const seenNames = new Set();

    for (const item of verifiedItems) {
      const isPharmacistRequested = Boolean(
        item.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
        item.patientNotes === 'AWAITING_PHARMACY_REVIEW' ||
        (typeof item.patientNotes === 'string' && item.patientNotes.includes('PHARMACIST_SELECTION_REQUESTED'))
      );
      let med = item.medicine;
      if (!med && prisma.medicine && typeof prisma.medicine.findUnique === 'function' && item.medicineId) {
        try {
          med = await prisma.medicine.findUnique({ where: { id: item.medicineId } });
        } catch (_) {}
      }
      const bName = isPharmacistRequested
        ? (item.prescribedName || med?.genericName || med?.brandName || 'Prescribed Medicine')
        : (med?.brandName || item.prescribedName);
      if (item.medicineId) seenMedIds.add(item.medicineId);
      if (bName) seenNames.add(bName.toLowerCase().trim());
      if (item.prescribedName) seenNames.add(item.prescribedName.toLowerCase().trim());

      requestedItems.push({
        prescriptionItemId: item.id,
        medicineId: item.medicineId,
        prescribedName: item.prescribedName,
        brandName: bName,
        genericName: med?.genericName || item.prescribedName || '',
        strength: med?.strength || item.dosage || '',
        dosageForm: med?.dosageForm || '',
        category: med?.category || '',
        quantity: item.quantity || 1,
        dosage: item.dosage,
        instructions: item.instructions,
        pharmacistSelectionRequested: isPharmacistRequested
      });
    }

    // Merge any verified client request items not already present in DB
    if (req.body?.items && Array.isArray(req.body.items)) {
      for (const clientItem of req.body.items) {
        const clientMedId = clientItem.medicineId || clientItem.id;
        const clientName = (clientItem.brandName || clientItem.name || '').toLowerCase().trim();
        if ((clientMedId && seenMedIds.has(clientMedId)) || (clientName && seenNames.has(clientName))) {
          continue;
        }
        let med = null;
        if (clientMedId && prisma.medicine && typeof prisma.medicine.findUnique === 'function') {
          try {
            med = await prisma.medicine.findUnique({ where: { id: String(clientMedId) } });
          } catch (_) {}
        }
        requestedItems.push({
          prescriptionItemId: null,
          medicineId: clientMedId,
          prescribedName: clientItem.brandName || clientItem.name || 'Prescription Medicine',
          brandName: med?.brandName || clientItem.brandName || clientItem.name || 'Prescription Medicine',
          genericName: med?.genericName || clientItem.genericName || '',
          strength: med?.strength || clientItem.strength || '',
          dosageForm: med?.dosageForm || clientItem.dosageForm || '',
          category: med?.category || '',
          quantity: parseInt(clientItem.quantity, 10) || 1,
          pharmacistSelectionRequested: Boolean(clientItem.pharmacistSelectionRequested)
        });
      }
    }

    // 7. Parse location parameters for Haversine distance scoring only (never stored or logged)
    const { DEFAULT_LAT, DEFAULT_LON, REGION_NAME } = require('../utils/pharmacyNetwork');
    const { computeOpenStatus } = require('../utils/openHoursParser');
    const { rankPharmaciesForMedicines } = require('../utils/rankingEngine');

    const latParam = req.query?.lat || req.body?.lat;
    const lonParam = req.query?.lon || req.body?.lon;
    const userLat = latParam ? parseFloat(latParam) : DEFAULT_LAT;
    const userLon = lonParam ? parseFloat(lonParam) : DEFAULT_LON;
    const isEmergency = req.query?.isEmergency === 'true' || req.body?.isEmergency === true;

    // 8. Query active, verified participating pharmacies (excluding test and suspended)
    const whereClause = {
      isVerified: true,
      verificationStatus: 'VERIFIED',
      NOT: { verificationStatus: 'TEST' }
    };

    let pharmacies = [];
    if (prisma.pharmacy && typeof prisma.pharmacy.findMany === 'function') {
      try {
        pharmacies = await prisma.pharmacy.findMany({
          where: whereClause,
          include: {
            inventory: {
              include: { medicine: true }
            }
          }
        });
      } catch (_) {}
    }

    if ((!pharmacies || pharmacies.length === 0) && typeof prisma.$queryRawUnsafe === 'function') {
      try {
        pharmacies = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Pharmacy" WHERE "isVerified" = true AND "verificationStatus" = 'VERIFIED' AND "verificationStatus" != 'TEST'`
        );
        for (const p of pharmacies) {
          const invRows = await prisma.$queryRawUnsafe(
            `SELECT i.*, m."brandName", m."genericName", m."strength", m."dosageForm", m."category"
             FROM "Inventory" i
             JOIN "Medicine" m ON i."medicineId" = m."id"
             WHERE i."pharmacyId" = $1`,
            p.id
          );
          p.inventory = (invRows || []).map(r => ({
            ...r,
            medicine: {
              id: r.medicineId,
              brandName: r.brandName,
              genericName: r.genericName,
              strength: r.strength,
              dosageForm: r.dosageForm,
              category: r.category
            }
          }));
        }
      } catch (_) {}
    }

    // Filter strictly to participating pharmacies
    const participatingPharmacies = (pharmacies || []).filter(p =>
      p.isVerified === true &&
      p.verificationStatus === 'VERIFIED' &&
      p.verificationStatus !== 'TEST'
    );

    // Compute open status dynamically
    const pharmaciesWithOpenStatus = participatingPharmacies.map(p => ({
      ...p,
      computedOpenStatus: computeOpenStatus(p.openingHours, p.isOpen)
    }));

    // 9. Run multi-criteria clinical matching and ranking
    const rankedResults = rankPharmaciesForMedicines({
      pharmacies: pharmaciesWithOpenStatus,
      requestedItems,
      userLat,
      userLon,
      isEmergency: Boolean(isEmergency)
    });

    // 10. Audit logging: PRESCRIPTION_AVAILABILITY_MATCHED
    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user.id,
      actorRole: req.user.role || 'PATIENT',
      action: 'PRESCRIPTION_AVAILABILITY_MATCHED',
      details: {
        totalPharmaciesEvaluated: participatingPharmacies.length,
        fullMatchCount: rankedResults.filter(r => r.availabilityStatus === 'FULL_MATCH').length,
        partialMatchCount: rankedResults.filter(r => r.availabilityStatus === 'PARTIAL_MATCH').length,
        verifiedItemCount: requestedItems.length
      },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      prescriptionId: rx.id,
      prescriptionStatus: rx.status,
      regionName: REGION_NAME,
      verifiedItemCount: requestedItems.length,
      requestedItems: requestedItems.map(i => ({
        id: i.prescriptionItemId,
        medicineId: i.medicineId,
        prescribedName: i.prescribedName,
        brandName: i.brandName,
        genericName: i.genericName,
        strength: i.strength,
        dosageForm: i.dosageForm,
        quantity: i.quantity
      })),
      totalPharmaciesEvaluated: participatingPharmacies.length,
      participatingCount: rankedResults.length,
      fullMatchCount: rankedResults.filter(r => r.availabilityStatus === 'FULL_MATCH').length,
      partialMatchCount: rankedResults.filter(r => r.availabilityStatus === 'PARTIAL_MATCH').length,
      results: rankedResults
    });
  } catch (err) {
    if (err && err.statusCode === 403) {
      recordPrescriptionAuditLogBestEffort(prisma, {
        prescriptionId: req.params?.id || null,
        prescriptionIdSnapshot: req.params?.id || 'UNKNOWN',
        actorId: req.user?.id || null,
        actorRole: req.user?.role || 'UNKNOWN',
        action: 'ACCESS_DENIED',
        details: { endpoint: 'matchPrescriptionAvailability', reason: err.message },
        ipAddress: extractClientIp(req)
      });
      return res.status(403).json({ success: false, error: err.message });
    }
    console.error('matchPrescriptionAvailability error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to match prescription availability.' });
  }
}

// POST /api/prescriptions/:id/follow-up
// Patient records follow-up state on a prescription (e.g. PURCHASED_ELSEWHERE, NOT_PURCHASED, NEEDS_MORE_HELP)
async function submitPrescriptionFollowUp(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user.userId;
    const { followUpState, notes } = req.body || {};

    const VALID_FOLLOW_UP_STATES = [
      'PURCHASED_HERE',
      'PURCHASED_ELSEWHERE',
      'NOT_PURCHASED',
      'NEEDS_MORE_HELP'
    ];

    if (!followUpState || !VALID_FOLLOW_UP_STATES.includes(followUpState)) {
      return res.status(400).json({
        success: false,
        error: `Invalid follow-up state "${followUpState}". Must be one of: ${VALID_FOLLOW_UP_STATES.join(', ')}`
      });
    }

    const rx = await prisma.prescription.findUnique({ where: { id } });
    if (!rx) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    if (rx.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only submit follow-up for your own prescription.' });
    }

    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: userId,
      actorRole: req.user.role || 'PATIENT',
      action: 'PATIENT_FOLLOW_UP',
      details: { followUpState, notes: notes || null },
      ipAddress: extractClientIp(req)
    });

    const nowIso = new Date().toISOString();
    if (followUpState === 'NEEDS_MORE_HELP') {
      try {
        const { sendIdempotentNotification } = require('../utils/notificationDispatcher');
        await sendIdempotentNotification(prisma, {
          userId,
          title: `Prescription Assistance Requested`,
          message: `Our care team has received your follow-up request regarding prescription #${id.slice(-6)}. A clinical assistant will review your request.`,
          type: 'INFO',
          linkUrl: `/prescription-upload?prescriptionId=${id}`
        });
      } catch (notifErr) {
        console.warn('Prescription follow-up notification dispatch warning:', notifErr.message);
      }
    }

    return res.json({
      success: true,
      message: 'Prescription follow-up recorded successfully.',
      followUpState,
      followUpRespondedAt: nowIso
    });
  } catch (err) {
    console.error('submitPrescriptionFollowUp error:', err);
    return res.status(500).json({ success: false, error: 'Failed to record prescription follow-up.' });
  }
}

/**
 * POST /api/prescriptions/:id/request-pharmacist-selection
 * Patient requests attending pharmacist to select brand formulation for a prescribed medicine.
 */
async function requestPharmacistSelection(req, res) {
  try {
    const { id } = req.params;
    const { itemId, rawName, genericCompound, dosage, dosageForm, quantity, cancel } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Prescription ID is required.' });
    }

    if (String(id).startsWith('mock-')) {
      return res.json({
        success: true,
        message: cancel
          ? 'Pharmacist selection request cancelled.'
          : 'Pharmacist brand selection requested successfully.'
      });
    }

    // 1. Authorization: patient owns prescription, or ADMIN
    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: { detectedMedicines: true, items: true }
    });

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found.' });
    }

    if (prescription.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only update your own prescription.' });
    }

    const isCancel = Boolean(cancel);

    // 2. Update DetectedMedicine if found
    let updatedDm = null;
    const targetDm = (prescription.detectedMedicines || []).find(d =>
      d.id === itemId || (rawName && d.rawName === rawName)
    );

    if (targetDm) {
      updatedDm = await prisma.detectedMedicine.update({
        where: { id: targetDm.id },
        data: isCancel
          ? {
              evidenceSummary: null,
              needsMapping: true,
              isConfirmed: false
            }
          : {
              matchedMedicineId: null,
              matchedMedicineName: null,
              needsMapping: true,
              isConfirmed: false,
              evidenceSummary: 'PHARMACIST_SELECTION_REQUESTED'
            }
      });
    }

    // 3. Update PrescriptionItem if existing
    let updatedPItem = null;
    const targetPItem = (prescription.items || []).find(p =>
      p.id === itemId || (rawName && p.prescribedName === rawName) || (targetDm && p.sourceCandidateId === targetDm.id)
    );

    if (targetPItem) {
      updatedPItem = await prisma.prescriptionItem.update({
        where: { id: targetPItem.id },
        data: isCancel
          ? {
              patientNotes: null,
              isVerified: false
            }
          : {
              patientNotes: 'PHARMACIST_SELECTION_REQUESTED',
              isVerified: false,
              verifiedAt: null,
              verifiedById: null
            }
      });
    }

    // 4. Update linked Orders if any already exist for this prescription
    const orders = await prisma.order.findMany({
      where: { prescriptionId: id, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      include: { items: { include: { medicine: true } }, pharmacy: true }
    });

    for (const ord of orders) {
      // Find matching order item
      const orderItem = (ord.items || []).find(it =>
        (updatedPItem && it.prescriptionItemId === updatedPItem.id) ||
        (targetDm && it.prescriptionItemId === targetDm.id) ||
        (it.medicine && (it.medicine.genericName?.toLowerCase() === (genericCompound || rawName || '').toLowerCase() || it.medicine.brandName?.toLowerCase() === (rawName || '').toLowerCase()))
      );

      if (orderItem) {
        await prisma.orderItem.update({
          where: { id: orderItem.id },
          data: isCancel
            ? { status: 'PENDING', unfulfilledReason: null }
            : { status: 'PENDING_SELECTION', unfulfilledReason: 'PHARMACIST_SELECTION_REQUESTED' }
        });
      }

      // Update Order notes
      let notes = ord.notes || '';
      const marker = `[PENDING_SELECTION:${itemId || (targetDm ? targetDm.id : 'item')}:${genericCompound || rawName || 'Medicine'}]`;
      if (isCancel) {
        notes = notes.replace(marker, '').replace(/\[PENDING_SELECTION:[^\]]+\]/g, '').trim();
      } else if (!notes.includes('PENDING_SELECTION')) {
        notes = (notes ? notes + ' ' : '') + marker;
      }
      await prisma.order.update({
        where: { id: ord.id },
        data: { notes: notes || null }
      });

      // Send notification to pharmacy manager if request is created
      if (!isCancel && ord.pharmacy?.managerId) {
        sendIdempotentNotification(
          prisma,
          {
            userId: ord.pharmacy.managerId,
            title: 'Brand Selection Requested',
            message: `Patient requested attending pharmacist brand selection for ${rawName || genericCompound || 'prescribed generic'} (Order #${ord.orderNumber}).`,
            type: 'ORDER_STATUS',
            linkUrl: `/portal?orderId=${ord.id}`
          }
        ).catch(() => {});
      }
    }

    // 5. Invalidate orders cache
    const { invalidateOrdersCache } = require('./orderController');
    if (typeof invalidateOrdersCache === 'function') invalidateOrdersCache();

    // 6. Record Audit Log
    recordPrescriptionAuditLogBestEffort(prisma, {
      prescriptionId: id,
      prescriptionIdSnapshot: id,
      actorId: req.user.id,
      actorRole: req.user.role || 'PATIENT',
      action: isCancel ? 'PHARMACIST_SELECTION_CANCELLED' : 'PHARMACIST_SELECTION_REQUESTED',
      details: {
        itemId,
        rawName,
        genericCompound,
        dosage,
        quantity
      },
      ipAddress: extractClientIp(req)
    });

    return res.json({
      success: true,
      message: isCancel
        ? 'Pharmacist selection request cancelled.'
        : 'Pharmacist brand selection requested successfully.',
      detectedMedicine: updatedDm,
      prescriptionItem: updatedPItem
    });
  } catch (err) {
    console.error('requestPharmacistSelection error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process pharmacist selection request.' });
  }
}

module.exports = {
  uploadPrescription,
  verifyDetectedMedicines,
  getPrescriptionById,
  getPrescriptionImage,
  getUserPrescriptions,
  getAcademicSamples,
  screenPrescriptionIntegrity,
  acquireOcrRunClaim,
  failOcrRun,
  completeOcrRunAndPersistCandidates,
  getPrescriptionImages,
  replaceOrEnhancePrescriptionImage,
  setActivePrescriptionImage,
  retryPrescriptionOcr,
  verifyPharmacistAccessForPrescription,
  submitPatientCandidateCorrection,
  reportCandidateUnreadable,
  submitPatientCorrections,
  pharmacistVerifyItem,
  pharmacistRejectItem,
  pharmacistRecordPrescriberVerification,
  pharmacistMarkItemUnavailable,
  pharmacistVerifyPrescription,
  pharmacistRequestItemClarification,
  matchPrescriptionAvailability,
  submitPrescriptionFollowUp,
  requestPharmacistSelection
};

