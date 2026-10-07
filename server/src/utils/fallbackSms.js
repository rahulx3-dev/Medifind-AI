/**
 * MediFind AI — Phase 6.1L.9 Offline Fallback SMS Utility
 *
 * Provides safe, client/server shared logic for constructing native browser SMS URIs
 * for direct patient-to-pharmacy inquiries when online server workflows are offline/disrupted.
 *
 * STRICT RULES:
 * 1. NO automatic server-side SMS sending.
 * 2. NO SMS provider APIs (Twilio, AWS SNS, etc.).
 * 3. NO order, reservation, payment, or hold is created from this action.
 * 4. NEVER include prescription images, OCR diagnostics, clinical interpretation,
 *    passwords, tokens, or payment details.
 * 5. Uses the pharmacy's authoritative stored phone number from database.
 * 6. Constructed URI uses standard RFC 5724 format: sms:<phone>?body=<encodedMessage>.
 */

/**
 * Sanitizes phone number to numeric digits or standard international format.
 * Strips out spaces, dashes, parentheses.
 */
function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Validates that text content contains zero sensitive/internal data.
 * Throws or returns sanitized content.
 */
function assertNoSensitiveData(text) {
  if (!text) return;
  const sensitivePatterns = [
    /ocr/i,
    /prescription[_-]?id/i,
    /bearer/i,
    /password/i,
    /token/i,
    /clinical[_-]?interpretation/i,
    /detected[_-]?medicines/i,
    /handover[_-]?pin/i,
    /razorpay/i,
    /amount[_-]?paise/i,
    /secret/i
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      throw new Error(`Security Violation: Sensitive clinical/internal pattern detected: ${pattern}`);
    }
  }
}

/**
 * Builds the plain text message to be pre-filled into the patient's native SMS application.
 *
 * @param {Object} params
 * @param {string} params.medicineName - Requested medicine name
 * @param {number|string} [params.quantity] - Optional requested quantity
 * @param {string} [params.patientName] - Optional patient display name (first name/initial only)
 * @param {string} [params.customNote] - Optional patient note (sanitized)
 * @returns {string} Plain text message
 */
function buildFallbackMessageText({ medicineName, quantity, patientName, customNote }) {
  if (!medicineName || !medicineName.trim()) {
    throw new Error('Medicine name or inquiry context is required');
  }

  // Ensure no clinical leakage in inputs
  assertNoSensitiveData(medicineName);
  if (customNote) assertNoSensitiveData(customNote);

  const cleanMed = medicineName.trim();
  const cleanQty = quantity ? String(quantity).trim() : null;
  const cleanName = patientName ? patientName.trim().split(' ')[0] : 'Patient';

  let msg = `Hello, this is ${cleanName} contacting you via MediFind AI.\n`;
  msg += `Medicine inquiry: ${cleanMed}\n`;
  if (cleanQty) {
    msg += `Quantity needed: ${cleanQty}\n`;
  }
  if (customNote && customNote.trim()) {
    msg += `Note: ${customNote.trim()}\n`;
  }
  msg += `Please reply to confirm availability and normal timing. (Direct offline inquiry — not an online reservation).`;

  // Final sanity check
  assertNoSensitiveData(msg);

  return msg;
}

/**
 * Builds standard RFC 5724 SMS URI:
 * sms:<phone>?body=<encodedMessage>
 *
 * @param {Object} params
 * @param {string} params.phone - Pharmacy telephone number
 * @param {string} params.medicineName - Requested medicine name
 * @param {number|string} [params.quantity] - Quantity
 * @param {string} [params.patientName] - Patient name
 * @param {string} [params.customNote] - Patient custom note
 * @returns {string} Native SMS URI
 */
function buildFallbackSmsUri({ phone, medicineName, quantity, patientName, customNote }) {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) {
    throw new Error('Valid pharmacy phone number is required');
  }

  const messageText = buildFallbackMessageText({ medicineName, quantity, patientName, customNote });
  const encodedBody = encodeURIComponent(messageText);

  return `sms:${cleanPhone}?body=${encodedBody}`;
}

/**
 * Builds standard tel: URI for phone call fallback:
 * tel:<phone>
 *
 * @param {string} phone
 * @returns {string}
 */
function buildFallbackTelUri(phone) {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) {
    throw new Error('Valid pharmacy phone number is required');
  }
  return `tel:${cleanPhone}`;
}

module.exports = {
  sanitizePhoneNumber,
  assertNoSensitiveData,
  buildFallbackMessageText,
  buildFallbackSmsUri,
  buildFallbackTelUri
};
