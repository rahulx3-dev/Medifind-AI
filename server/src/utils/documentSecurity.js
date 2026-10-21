const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Dedicated, non-public directory outside web client root
const DOCUMENTS_UPLOAD_DIR = path.resolve(__dirname, '../../uploads/verification_docs');
if (!fs.existsSync(DOCUMENTS_UPLOAD_DIR)) {
  fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });
}

// Strictly supported document types & extensions (PDF, JPEG, PNG)
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Validates file magic bytes (file signature) against expected content types.
 * Prevents file-extension spoofing (e.g. an executable renamed to .pdf).
 */
function validateFileSignature(buffer) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'File buffer is too small or corrupt.' };
  }

  // 1. PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: true, detectedType: 'application/pdf', ext: '.pdf' };
  }

  // 2. JPEG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, detectedType: 'image/jpeg', ext: '.jpg' };
  }

  // 3. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { valid: true, detectedType: 'image/png', ext: '.png' };
  }

  return {
    valid: false,
    error: 'File signature does not match authorized formats (PDF, JPEG, or PNG).'
  };
}

/**
 * Compute SHA-256 hash for document audit integrity.
 */
function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generates a collision-resistant, server-controlled filename.
 * Never uses or relies on applicant-supplied filenames.
 */
function generateServerFilename(extension) {
  const ext = extension.toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.pdf';
  const randomToken = crypto.randomBytes(16).toString('hex');
  return `vdoc_${Date.now()}_${randomToken}${safeExt}`;
}

/**
 * Validates that a stored filename resolves strictly within DOCUMENTS_UPLOAD_DIR
 * to prevent directory traversal attacks (e.g. `../../etc/passwd`).
 */
function resolveSecureDocumentPath(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  // Disallow path separators, directory traversal, null bytes, and control characters
  if (
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..') ||
    fileName.includes('\0') ||
    /[\x00-\x1f\x7f]/.test(fileName)
  ) {
    return null;
  }
  const normalizedUploadDir = path.resolve(DOCUMENTS_UPLOAD_DIR);
  const resolved = path.resolve(normalizedUploadDir, fileName);

  // Strict prefix check requiring path separator boundary
  const prefixWithSep = normalizedUploadDir.endsWith(path.sep)
    ? normalizedUploadDir
    : normalizedUploadDir + path.sep;
  if (!resolved.startsWith(prefixWithSep)) {
    return null;
  }

  // If file exists, verify realpath as well to prevent symlink escape
  try {
    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync(resolved);
      const realUploadDir = fs.existsSync(normalizedUploadDir)
        ? fs.realpathSync(normalizedUploadDir)
        : normalizedUploadDir;
      const realPrefix = realUploadDir.endsWith(path.sep)
        ? realUploadDir
        : realUploadDir + path.sep;
      if (!real.startsWith(realPrefix)) {
        return null;
      }
    }
  } catch (e) {
    return null;
  }

  return resolved;
}

/**
 * Safe delete helper.
 */
function safeDeleteDocument(fileName) {
  try {
    const fullPath = resolveSecureDocumentPath(fileName);
    if (fullPath && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error(`safeDeleteDocument error for ${fileName}:`, err.message);
  }
}

/**
 * Strips private server paths, storage locations, and hashes from document objects
 * so private file metadata is never leaked to API consumers.
 */
function sanitizeDocumentMetadata(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    documentType: doc.documentType,
    originalFileName: doc.originalFileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    status: doc.status,
    uploadedAt: doc.uploadedAt
  };
}

module.exports = {
  DOCUMENTS_UPLOAD_DIR,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE,
  validateFileSignature,
  computeFileHash,
  generateServerFilename,
  resolveSecureDocumentPath,
  safeDeleteDocument,
  sanitizeDocumentMetadata
};
