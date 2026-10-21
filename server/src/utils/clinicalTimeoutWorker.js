'use strict';

/**
 * MediFind AI — Clinical Assistance Timeout Background Worker (Gate 8)
 *
 * Automatically monitors unresponded ClinicalAssistanceRequest assignments
 * and escalates to additional eligible pharmacies after the 15-minute response window.
 *
 * Safe across process restarts, retries, and concurrent workers.
 */

const prisma = require('../prisma');
const {
  evaluateAllClinicalTimeouts,
  processSingleRequestTimeout,
  PHARMACY_RESPONSE_TIMEOUT_MINUTES
} = require('../controllers/clinicalAssistanceController');

let workerTimer = null;
let isEvaluating = false;

/**
 * Start the periodic background worker to evaluate clinical assistance timeouts
 * @param {Object} db - Database client (defaults to Prisma)
 * @param {number} intervalMs - Polling interval in ms (defaults to 60,000ms / 1 min)
 */
function startClinicalTimeoutWorker(db = prisma, intervalMs = 60000) {
  if (workerTimer) {
    return workerTimer;
  }

  async function tick() {
    if (isEvaluating) return;
    isEvaluating = true;
    try {
      await evaluateAllClinicalTimeouts(db);
    } catch (err) {
      console.error('Clinical timeout background worker error:', err.message);
    } finally {
      isEvaluating = false;
    }
  }

  workerTimer = setInterval(tick, intervalMs);
  if (workerTimer && workerTimer.unref) {
    workerTimer.unref(); // Ensure background timer doesn't prevent graceful process exit
  }

  return workerTimer;
}

/**
 * Stop the background worker cleanly (useful during testing or server shutdown)
 */
function stopClinicalTimeoutWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

module.exports = {
  startClinicalTimeoutWorker,
  stopClinicalTimeoutWorker,
  evaluateAllClinicalTimeouts,
  processSingleRequestTimeout,
  PHARMACY_RESPONSE_TIMEOUT_MINUTES
};
