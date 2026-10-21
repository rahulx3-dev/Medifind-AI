/**
 * MediFind AI — Phase 1, Step 11M: Slice 4 Pharmacy Clarification Controller
 *
 * Implements persistent prescription clarification workflow between pharmacists and patients:
 * 1. POST /api/orders/:id/clarifications — Pharmacist or Admin initiates clarification inquiry.
 * 2. GET  /api/orders/:id/clarifications — Patient, Pharmacist, or Admin views order clarification history.
 * 3. PUT  /api/orders/:id/clarifications/:clarificationId/respond — Patient or Admin responds to pending clarification.
 * 4. PUT  /api/orders/:id/clarifications/:clarificationId/resolve — Pharmacist or Admin resolves clarification inquiry.
 *
 * Safety & Security Guarantees:
 * - Server-side cross-entity validation (Order, Prescription, Pharmacy, Patient, Pharmacist).
 * - Assistant explicitly denied access to all clarification endpoints (HTTP 403).
 * - Orders without prescriptions rejected (schema integrity constraint).
 * - Row locking and atomic transactions prevent duplicate or conflicting submissions.
 * - Non-blocking post-commit notification dispatch (notifications never abort successful DB action).
 * - Zero side effects on Order status, Payment status, Inventory stock, or Prescription verification.
 * - Defensive Prisma Client delegate support with parameterized raw SQL fallback.
 */

'use strict';

const crypto = require('crypto');
const prisma = require('../prisma');
const {
  recordPrescriptionAuditLog,
  extractClientIp,
  supportsPrescriptionAuditLogging
} = require('../utils/prescriptionAuditLogger');

/**
 * POST /api/orders/:id/clarifications
 * Allows PHARMACIST and ADMIN to create a clarification inquiry for an active prescription order.
 */
async function createClarification(req, res) {
  try {
    const { id } = req.params; // orderId
    const { question } = req.body;

    // 1. Explicit Role Authorization Guard
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Assistants cannot initiate prescription clarifications.'
      });
    }

    if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only authorized pharmacists or administrators can initiate a clarification.'
      });
    }

    // 2. Validate Question Text
    const trimmedQuestion = typeof question === 'string' ? question.trim() : '';
    if (trimmedQuestion.length < 5 || trimmedQuestion.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Clarification question must be a trimmed string between 5 and 1000 characters.'
      });
    }

    // 3. Transactional Validation and Persistence
    const createWork = async (tx) => {
      // 3a. Lock order row inside transaction
      let order = null;
      if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = await tx.$queryRawUnsafe(
            `SELECT "id", "userId", "pharmacyId", "prescriptionId", "status", "orderNumber"
             FROM "Order" WHERE "id" = $1 FOR UPDATE`,
            id
          );
          if (rows && rows.length > 0) order = rows[0];
        } catch (_) {}
      }

      if (!order) {
        const orderDelegate = tx.order || (prisma && prisma.order);
        if (orderDelegate && typeof orderDelegate.findUnique === 'function') {
          order = await orderDelegate.findUnique({ where: { id } });
        }
      }

      if (!order) {
        const err = new Error('Order not found.');
        err.statusCode = 404;
        throw err;
      }

      // 3b. Verify nonterminal order status
      const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];
      if (TERMINAL_STATUSES.includes(order.status)) {
        const err = new Error(`Cannot create clarification for order in terminal status "${order.status}".`);
        err.statusCode = 400;
        throw err;
      }

      // 3c. Verify prescription presence and cross-entity relationship
      if (!order.prescriptionId) {
        const err = new Error('Clarification requires an associated prescription. This order does not contain a prescription.');
        err.statusCode = 400;
        throw err;
      }

      let prescription = null;
      if (tx.prescription && typeof tx.prescription.findUnique === 'function') {
        prescription = await tx.prescription.findUnique({ where: { id: order.prescriptionId } });
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rxRows = await tx.$queryRawUnsafe(
            `SELECT "id", "userId", "status" FROM "Prescription" WHERE "id" = $1`,
            order.prescriptionId
          );
          if (rxRows && rxRows.length > 0) prescription = rxRows[0];
        } catch (_) {}
      }
      if (!prescription && prisma && prisma.prescription && typeof prisma.prescription.findUnique === 'function') {
        try {
          prescription = await prisma.prescription.findUnique({ where: { id: order.prescriptionId } });
        } catch (_) {}
      }

      if (!prescription) {
        const err = new Error('Associated prescription not found.');
        err.statusCode = 400;
        throw err;
      }

      if (prescription.userId !== order.userId) {
        const err = new Error('Cross-entity validation failed: Prescription owner does not match order patient.');
        err.statusCode = 400;
        throw err;
      }

      // 3d. Verify Pharmacist manages the order's pharmacy
      let managedPharmacy = null;
      if (req.user.role === 'PHARMACIST') {
        if (tx.pharmacy && typeof tx.pharmacy.findUnique === 'function') {
          managedPharmacy = await tx.pharmacy.findUnique({ where: { managerId: req.user.id } });
        } else if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            const pRows = await tx.$queryRawUnsafe(
              `SELECT "id", "managerId", "name" FROM "Pharmacy" WHERE "managerId" = $1`,
              req.user.id
            );
            if (pRows && pRows.length > 0) managedPharmacy = pRows[0];
          } catch (_) {}
        }
        if (!managedPharmacy && prisma && prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
          try {
            managedPharmacy = await prisma.pharmacy.findUnique({ where: { managerId: req.user.id } });
          } catch (_) {}
        }

        if (!managedPharmacy || managedPharmacy.id !== order.pharmacyId) {
          const err = new Error('Unauthorized: You can only create clarifications for orders fulfilled by your managed pharmacy.');
          err.statusCode = 403;
          throw err;
        }
      } else if (!managedPharmacy) {
        // For admin, load pharmacy name for notifications
        if (tx.pharmacy && typeof tx.pharmacy.findUnique === 'function') {
          managedPharmacy = await tx.pharmacy.findUnique({ where: { id: order.pharmacyId } });
        } else if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            const pRows = await tx.$queryRawUnsafe(`SELECT "id", "name" FROM "Pharmacy" WHERE "id" = $1`, order.pharmacyId);
            if (pRows && pRows.length > 0) managedPharmacy = pRows[0];
          } catch (_) {}
        }
      }

      // 3e. Duplicate active clarification check
      const clarifDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);
      let activeClarif = null;
      if (clarifDelegate && typeof clarifDelegate.findFirst === 'function') {
        activeClarif = await clarifDelegate.findFirst({
          where: {
            orderId: id,
            status: { in: ['PENDING', 'RESPONDED'] }
          }
        });
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const cRows = await tx.$queryRawUnsafe(
            `SELECT "id", "status" FROM "PrescriptionClarification" WHERE "orderId" = $1 AND "status" IN ('PENDING', 'RESPONDED') LIMIT 1`,
            id
          );
          if (cRows && cRows.length > 0) activeClarif = cRows[0];
        } catch (_) {}
      }

      if (activeClarif) {
        const err = new Error('An active clarification inquiry is already open for this order. Please wait for patient response or resolve it before opening a new inquiry.');
        err.statusCode = 409;
        throw err;
      }

      // 3f. Create PrescriptionClarification
      const clarifId = crypto.randomUUID();
      const now = new Date();
      let createdClarification = null;

      if (clarifDelegate && typeof clarifDelegate.create === 'function') {
        createdClarification = await clarifDelegate.create({
          data: {
            id: clarifId,
            orderId: id,
            prescriptionId: order.prescriptionId,
            pharmacyId: order.pharmacyId,
            patientId: order.userId,
            pharmacistId: req.user.id,
            question: trimmedQuestion,
            response: null,
            status: 'PENDING',
            resolvedAt: null,
            createdAt: now,
            updatedAt: now
          }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `INSERT INTO "PrescriptionClarification" (
            "id", "orderId", "prescriptionId", "pharmacyId", "patientId", "pharmacistId",
            "question", "status", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $8)`,
          clarifId,
          id,
          order.prescriptionId,
          order.pharmacyId,
          order.userId,
          req.user.id,
          trimmedQuestion,
          now
        );
        createdClarification = {
          id: clarifId,
          orderId: id,
          prescriptionId: order.prescriptionId,
          pharmacyId: order.pharmacyId,
          patientId: order.userId,
          pharmacistId: req.user.id,
          question: trimmedQuestion,
          response: null,
          status: 'PENDING',
          resolvedAt: null,
          createdAt: now,
          updatedAt: now
        };
      }

      if (prisma.prescriptionAuditLog && !tx.prescriptionAuditLog) {
        tx.prescriptionAuditLog = prisma.prescriptionAuditLog;
      }
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: order.prescriptionId,
          prescriptionIdSnapshot: order.prescriptionId,
          actorId: req.user?.id || null,
          actorRole: req.user?.role || 'UNKNOWN',
          action: 'CLARIFICATION_CREATED',
          details: {
            clarificationId: clarifId,
            orderId: id,
            pharmacyId: order.pharmacyId,
            questionLength: trimmedQuestion.length,
            status: 'PENDING'
          },
          ipAddress: extractClientIp(req)
        });
      }

      return {
        createdClarification,
        order,
        pharmacyName: managedPharmacy?.name || 'Pharmacy'
      };
    };

    let txResult = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      txResult = await prisma.$transaction(async (tx) => {
        if (tx) tx._isTransaction = true;
        return await createWork(tx);
      });
    } else {
      txResult = await createWork(prisma);
    }

    // 4. Non-blocking Post-Commit Notification to Patient
    try {
      if (prisma.notification && typeof prisma.notification.create === 'function') {
        await prisma.notification.create({
          data: {
            userId: txResult.order.userId,
            title: `Clarification Requested: Order #${txResult.order.orderNumber || txResult.order.id}`,
            message: `The pharmacist at ${txResult.pharmacyName} has a question regarding your prescription order. Please review and respond.`,
            type: 'ORDER_STATUS',
            linkUrl: `/orders/${id}`
          }
        });
      }
    } catch (notifErr) {
      console.warn('Clarification creation notification non-blocking warning:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Clarification question submitted to patient.',
      clarification: txResult.createdClarification
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('createClarification error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create clarification.' });
  }
}

/**
 * GET /api/orders/:id/clarifications
 * Allows PATIENT, PHARMACIST, and ADMIN to retrieve clarification history for an order.
 * Strictly denies ASSISTANT.
 */
async function getClarifications(req, res) {
  try {
    const { id } = req.params; // orderId

    // 1. Explicit Role Guard
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Assistants cannot view prescription clarifications.'
      });
    }

    // 2. Fetch Order to verify relationship & authorization
    let order = null;
    const orderDelegate = prisma.order;
    if (orderDelegate && typeof orderDelegate.findUnique === 'function') {
      order = await orderDelegate.findUnique({ where: { id } });
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "id", "userId", "pharmacyId" FROM "Order" WHERE "id" = $1`,
          id
        );
        if (rows && rows.length > 0) order = rows[0];
      } catch (_) {}
    }

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // 3. Authorization Check
    if (req.user.role === 'PATIENT') {
      if (order.userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: You can only view clarifications for your own orders.'
        });
      }
    } else if (req.user.role === 'PHARMACIST') {
      let managedPharmacy = null;
      if (prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
        managedPharmacy = await prisma.pharmacy.findUnique({ where: { managerId: req.user.id } });
      } else if (typeof prisma.$queryRawUnsafe === 'function') {
        try {
          const pRows = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "Pharmacy" WHERE "managerId" = $1`,
            req.user.id
          );
          if (pRows && pRows.length > 0) managedPharmacy = pRows[0];
        } catch (_) {}
      }

      if (!managedPharmacy || managedPharmacy.id !== order.pharmacyId) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: You can only view clarifications for orders at your managed pharmacy.'
        });
      }
    } else if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    // 4. Fetch Clarifications for this order
    let clarifications = [];
    const clarifDelegate = prisma.prescriptionClarification;
    if (clarifDelegate && typeof clarifDelegate.findMany === 'function') {
      clarifications = await clarifDelegate.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' }
      });
    } else if (typeof prisma.$queryRawUnsafe === 'function') {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PrescriptionClarification" WHERE "orderId" = $1 ORDER BY "createdAt" ASC`,
          id
        );
        clarifications = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }

    return res.json({
      success: true,
      clarifications: clarifications || []
    });
  } catch (err) {
    console.error('getClarifications error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve clarifications.' });
  }
}

/**
 * PUT /api/orders/:id/clarifications/:clarificationId/respond
 * Allows PATIENT and ADMIN to submit a response to an active PENDING clarification.
 * Identical duplicate responses return idempotent HTTP 200.
 */
async function respondToClarification(req, res) {
  try {
    const { id, clarificationId } = req.params;
    const { response } = req.body;

    // 1. Role Authorization
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Assistants cannot respond to prescription clarifications.'
      });
    }

    if (req.user.role !== 'PATIENT' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only the patient or an administrator can respond to a clarification.'
      });
    }

    // 2. Validate Response Text
    const trimmedResponse = typeof response === 'string' ? response.trim() : '';
    if (trimmedResponse.length < 2 || trimmedResponse.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Clarification response must be a trimmed string between 2 and 2000 characters.'
      });
    }

    // 3. Transactional Validation and Persistence
    const respondWork = async (tx) => {
      // 3a. Lock clarification row inside transaction
      let clarif = null;
      if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = await tx.$queryRawUnsafe(
            `SELECT c.*, o."orderNumber", o."pharmacyId", o."userId" AS "orderUserId", p."managerId"
             FROM "PrescriptionClarification" c
             JOIN "Order" o ON c."orderId" = o."id"
             JOIN "Pharmacy" p ON c."pharmacyId" = p."id"
             WHERE c."id" = $1 FOR UPDATE OF c`,
            clarificationId
          );
          if (rows && rows.length > 0) clarif = rows[0];
        } catch (_) {}
      }

      if (!clarif) {
        const clarifDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);
        if (clarifDelegate && typeof clarifDelegate.findUnique === 'function') {
          clarif = await clarifDelegate.findUnique({
            where: { id: clarificationId },
            include: { order: true, pharmacy: true }
          });
        }
      }

      if (!clarif) {
        const err = new Error('Clarification not found.');
        err.statusCode = 404;
        throw err;
      }

      if (clarif.orderId !== id) {
        const err = new Error('Clarification does not belong to the specified order.');
        err.statusCode = 400;
        throw err;
      }

      // 3b. Verify Patient Ownership
      const patientOwnerId = clarif.patientId || clarif.orderUserId || (clarif.order && clarif.order.userId);
      if (req.user.role === 'PATIENT' && patientOwnerId !== req.user.id) {
        const err = new Error('Unauthorized: You can only respond to clarifications for your own orders.');
        err.statusCode = 403;
        throw err;
      }

      // 3c. Status check & Idempotent duplicate check
      if (clarif.status !== 'PENDING') {
        if (clarif.status === 'RESPONDED' && clarif.response === trimmedResponse) {
          return { updatedClarification: clarif, isDuplicate: true, clarif };
        }
        const err = new Error(`Cannot respond to clarification in status "${clarif.status}". Clarification must be in PENDING status.`);
        err.statusCode = 409;
        throw err;
      }

      // 3d. Update clarification to RESPONDED
      const now = new Date();
      let updatedClarification = null;
      const clarifDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);

      if (clarifDelegate && typeof clarifDelegate.update === 'function') {
        updatedClarification = await clarifDelegate.update({
          where: { id: clarificationId },
          data: {
            response: trimmedResponse,
            status: 'RESPONDED',
            updatedAt: now
          }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `UPDATE "PrescriptionClarification"
           SET "response" = $1, "status" = 'RESPONDED', "updatedAt" = $2
           WHERE "id" = $3 AND "status" = 'PENDING'`,
          trimmedResponse,
          now,
          clarificationId
        );
        updatedClarification = {
          ...clarif,
          response: trimmedResponse,
          status: 'RESPONDED',
          updatedAt: now
        };
      }

      if (prisma.prescriptionAuditLog && !tx.prescriptionAuditLog) {
        tx.prescriptionAuditLog = prisma.prescriptionAuditLog;
      }
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: clarif.prescriptionId,
          prescriptionIdSnapshot: clarif.prescriptionId,
          actorId: req.user?.id || null,
          actorRole: req.user?.role || 'UNKNOWN',
          action: 'CLARIFICATION_RESPONDED',
          details: {
            clarificationId,
            orderId: clarif.orderId || id,
            pharmacyId: clarif.pharmacyId,
            responseLength: trimmedResponse.length,
            statusTransition: 'PENDING->RESPONDED'
          },
          ipAddress: extractClientIp(req)
        });
      }

      return { updatedClarification, isDuplicate: false, clarif };
    };

    let txResult = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      txResult = await prisma.$transaction(async (tx) => {
        if (tx) tx._isTransaction = true;
        return await respondWork(tx);
      });
    } else {
      txResult = await respondWork(prisma);
    }

    // 4. Non-blocking Post-Commit Notification to Pharmacist
    if (!txResult.isDuplicate) {
      try {
        const pharmacistRecipientId = txResult.clarif.pharmacistId || txResult.clarif.managerId || txResult.clarif.pharmacy?.managerId;
        if (pharmacistRecipientId && prisma.notification && typeof prisma.notification.create === 'function') {
          await prisma.notification.create({
            data: {
              userId: pharmacistRecipientId,
              title: `Clarification Responded: Order #${txResult.clarif.orderNumber || txResult.clarif.orderId}`,
              message: `Patient has replied to your prescription inquiry for Order #${txResult.clarif.orderNumber || txResult.clarif.orderId}.`,
              type: 'ORDER_STATUS',
              linkUrl: `/pharmacist`
            }
          });
        }
      } catch (notifErr) {
        console.warn('Clarification response notification warning:', notifErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: txResult.isDuplicate ? 'Clarification response already recorded.' : 'Response submitted to pharmacy.',
      clarification: txResult.updatedClarification
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('respondToClarification error:', err);
    return res.status(500).json({ success: false, error: 'Failed to submit clarification response.' });
  }
}

/**
 * PUT /api/orders/:id/clarifications/:clarificationId/resolve
 * Allows PHARMACIST and ADMIN to resolve a clarification inquiry.
 * Repeated resolutions return idempotent HTTP 200.
 */
async function resolveClarification(req, res) {
  try {
    const { id, clarificationId } = req.params;

    // 1. Role Authorization
    if (req.user.role === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Assistants cannot resolve prescription clarifications.'
      });
    }

    if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only authorized pharmacists or administrators can resolve a clarification.'
      });
    }

    // 2. Transactional Validation and Persistence
    const resolveWork = async (tx) => {
      // 2a. Lock clarification row inside transaction
      let clarif = null;
      if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = await tx.$queryRawUnsafe(
            `SELECT c.*, o."orderNumber", o."pharmacyId", o."userId" AS "orderUserId", p."name" AS "pharmacyName"
             FROM "PrescriptionClarification" c
             JOIN "Order" o ON c."orderId" = o."id"
             JOIN "Pharmacy" p ON c."pharmacyId" = p."id"
             WHERE c."id" = $1 FOR UPDATE OF c`,
            clarificationId
          );
          if (rows && rows.length > 0) clarif = rows[0];
        } catch (_) {}
      }

      if (!clarif) {
        const clarifDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);
        if (clarifDelegate && typeof clarifDelegate.findUnique === 'function') {
          clarif = await clarifDelegate.findUnique({
            where: { id: clarificationId },
            include: { order: true, pharmacy: true }
          });
        }
      }

      if (!clarif) {
        const err = new Error('Clarification not found.');
        err.statusCode = 404;
        throw err;
      }

      if (clarif.orderId !== id) {
        const err = new Error('Clarification does not belong to the specified order.');
        err.statusCode = 400;
        throw err;
      }

      // 2b. Verify Pharmacist manages the order's pharmacy
      if (req.user.role === 'PHARMACIST') {
        let managedPharmacy = null;
        if (tx.pharmacy && typeof tx.pharmacy.findUnique === 'function') {
          managedPharmacy = await tx.pharmacy.findUnique({ where: { managerId: req.user.id } });
        } else if (typeof tx.$queryRawUnsafe === 'function') {
          try {
            const pRows = await tx.$queryRawUnsafe(
              `SELECT "id" FROM "Pharmacy" WHERE "managerId" = $1`,
              req.user.id
            );
            if (pRows && pRows.length > 0) managedPharmacy = pRows[0];
          } catch (_) {}
        }
        if (!managedPharmacy && prisma && prisma.pharmacy && typeof prisma.pharmacy.findUnique === 'function') {
          try {
            managedPharmacy = await prisma.pharmacy.findUnique({ where: { managerId: req.user.id } });
          } catch (_) {}
        }

        if (!managedPharmacy || managedPharmacy.id !== clarif.pharmacyId) {
          const err = new Error('Unauthorized: You can only resolve clarifications for orders at your managed pharmacy.');
          err.statusCode = 403;
          throw err;
        }
      }

      // 2c. Status check & Idempotent resolution check
      if (clarif.status === 'RESOLVED') {
        return { updatedClarification: clarif, isDuplicate: true, clarif };
      }

      if (clarif.status !== 'RESPONDED' && clarif.status !== 'PENDING') {
        const err = new Error(`Cannot resolve clarification in status "${clarif.status}".`);
        err.statusCode = 409;
        throw err;
      }

      // 2d. Update clarification to RESOLVED
      const now = new Date();
      let updatedClarification = null;
      const clarifDelegate = tx.prescriptionClarification || (prisma && prisma.prescriptionClarification);

      if (clarifDelegate && typeof clarifDelegate.update === 'function') {
        updatedClarification = await clarifDelegate.update({
          where: { id: clarificationId },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            updatedAt: now
          }
        });
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `UPDATE "PrescriptionClarification"
           SET "status" = 'RESOLVED', "resolvedAt" = $1, "updatedAt" = $1
           WHERE "id" = $2`,
          now,
          clarificationId
        );
        updatedClarification = {
          ...clarif,
          status: 'RESOLVED',
          resolvedAt: now,
          updatedAt: now
        };
      }

      if (prisma.prescriptionAuditLog && !tx.prescriptionAuditLog) {
        tx.prescriptionAuditLog = prisma.prescriptionAuditLog;
      }
      if (supportsPrescriptionAuditLogging(tx)) {
        await recordPrescriptionAuditLog(tx, {
          prescriptionId: clarif.prescriptionId,
          prescriptionIdSnapshot: clarif.prescriptionId,
          actorId: req.user?.id || null,
          actorRole: req.user?.role || 'UNKNOWN',
          action: 'CLARIFICATION_RESOLVED',
          details: {
            clarificationId,
            orderId: clarif.orderId || id,
            pharmacyId: clarif.pharmacyId,
            previousStatus: clarif.status,
            statusTransition: `${clarif.status}->RESOLVED`
          },
          ipAddress: extractClientIp(req)
        });
      }

      return { updatedClarification, isDuplicate: false, clarif };
    };

    let txResult = null;
    if (typeof prisma.$transaction === 'function' && !prisma._isTransaction) {
      txResult = await prisma.$transaction(async (tx) => {
        if (tx) tx._isTransaction = true;
        return await resolveWork(tx);
      });
    } else {
      txResult = await resolveWork(prisma);
    }

    // 3. Non-blocking Post-Commit Notification to Patient
    if (!txResult.isDuplicate) {
      try {
        const patientRecipientId = txResult.clarif.patientId || txResult.clarif.orderUserId || txResult.clarif.order?.userId;
        if (patientRecipientId && prisma.notification && typeof prisma.notification.create === 'function') {
          await prisma.notification.create({
            data: {
              userId: patientRecipientId,
              title: `Clarification Resolved: Order #${txResult.clarif.orderNumber || txResult.clarif.orderId}`,
              message: `The pharmacist has marked your prescription clarification as resolved. Order fulfillment will proceed.`,
              type: 'ORDER_STATUS',
              linkUrl: `/orders/${id}`
            }
          });
        }
      } catch (notifErr) {
        console.warn('Clarification resolution notification warning:', notifErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: txResult.isDuplicate ? 'Clarification already marked as resolved.' : 'Clarification resolved successfully.',
      clarification: txResult.updatedClarification
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('resolveClarification error:', err);
    return res.status(500).json({ success: false, error: 'Failed to resolve clarification.' });
  }
}

module.exports = {
  createClarification,
  getClarifications,
  respondToClarification,
  resolveClarification
};
