/**
 * MediFind AI — Phase 6.1L.9 Offline Fallback SMS Utility (Client)
 *
 * Provides client-side helpers for constructing native browser SMS URIs
 * for direct patient-to-pharmacy inquiries when online server workflows are offline/disrupted.
 *
 * STRICT RULES:
 * 1. NO automatic SMS sending.
 * 2. NO SMS provider APIs (Twilio, AWS SNS, etc.).
 * 3. NO order, reservation, payment, or hold is created from this action.
 * 4. NEVER include prescription images, OCR diagnostics, clinical interpretation,
 *    passwords, tokens, or payment details.
 * 5. Uses the pharmacy's authoritative stored phone number from database.
 * 6. Constructed URI uses standard RFC 5724 format: sms:<phone>?body=<encodedMessage>.
 */

export function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/[^\d+]/g, '');
}

export function assertNoSensitiveData(text) {
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
      throw new Error(`Security Violation: Sensitive clinical/internal pattern detected`);
    }
  }
}

export function buildFallbackMessageText({ medicineName, quantity, patientName, customNote }) {
  if (!medicineName || !medicineName.trim()) {
    throw new Error('Medicine name or inquiry context is required');
  }

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

  assertNoSensitiveData(msg);
  return msg;
}

export function buildFallbackSmsUri({ phone, medicineName, quantity, patientName, customNote }) {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) {
    throw new Error('Valid pharmacy phone number is required');
  }

  const messageText = buildFallbackMessageText({ medicineName, quantity, patientName, customNote });
  const encodedBody = encodeURIComponent(messageText);

  return `sms:${cleanPhone}?body=${encodedBody}`;
}

export function buildFallbackTelUri(phone) {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) {
    throw new Error('Valid pharmacy phone number is required');
  }
  return `tel:${cleanPhone}`;
}
