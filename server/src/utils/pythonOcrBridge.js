/**
 * MediFind AI — Python OCR Worker Bridge (Phase 6.1E.1)
 * Safely invokes local Python OCR worker (PaddleOCR/PP-OCRv5 + PP-Structure layout pipeline)
 * via child_process.spawn without shell interpolation.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Default configurations
const DEFAULT_TIMEOUT_MS = 25000; // 25s ceiling to prevent proxy 502 Bad Gateway timeouts
const MAX_STDOUT_BYTES = 5 * 1024 * 1024; // 5 MB ceiling
const WORKER_SCRIPT_PATH = path.join(__dirname, '../../ocr/ocr_worker.py');
const CATALOG_PATH = path.join(__dirname, '../../ocr/catalog_50.json');
const LEXICON_PATH = path.join(__dirname, '../../ocr/datasets/lexicon/indian_medicine_lexicon_v2.json');

/**
 * Returns the configured Python executable path.
 * Checks process.env.PYTHON_EXECUTABLE first, then platform default.
 */
function getPythonExecutable() {
  if (process.env.PYTHON_EXECUTABLE) {
    return process.env.PYTHON_EXECUTABLE;
  }
  // Check for local dedicated virtual environment in server/ocr/.venv
  const venvPythonWin = path.join(__dirname, '../../ocr/.venv/Scripts/python.exe');
  const venvPythonPosix = path.join(__dirname, '../../ocr/.venv/bin/python');
  if (process.platform === 'win32' && fs.existsSync(venvPythonWin)) {
    return venvPythonWin;
  } else if (process.platform !== 'win32' && fs.existsSync(venvPythonPosix)) {
    return venvPythonPosix;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Detects whether local PaddleOCR environment is available and operational.
 * Returns false on cloud hosting (Render, etc.) where .venv is not deployed to prevent 502/OOM errors.
 */
function isPaddleAvailable() {
  if (process.env.PYTHON_EXECUTABLE) {
    return fs.existsSync(process.env.PYTHON_EXECUTABLE);
  }
  const venvPythonWin = path.join(__dirname, '../../ocr/.venv/Scripts/python.exe');
  const venvPythonPosix = path.join(__dirname, '../../ocr/.venv/bin/python');

  // If a dedicated virtual environment exists on the filesystem, use it
  if (process.platform === 'win32' && fs.existsSync(venvPythonWin)) {
    return true;
  }
  if (process.platform !== 'win32' && fs.existsSync(venvPythonPosix)) {
    return true;
  }

  // If explicitly enabled via cloud environment variable
  if (process.env.ENABLE_CLOUD_PADDLE === 'true') {
    return true;
  }

  // Default fallback: disable on Render free tier if no venv was built
  if (process.env.RENDER === 'true') {
    return false;
  }

  return false;
}

/**
 * Spawns the local Python OCR worker with strict argument arrays and error boundaries.
 *
 * @param {string} imagePath - Absolute path to the prescription image
 * @param {object} options - Custom execution options
 * @returns {Promise<object>} Structured OCR result from Python worker
 */
function executePythonOCRWorker(imagePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!imagePath || typeof imagePath !== 'string') {
      return reject(new Error('Invalid image path provided for OCR analysis.'));
    }

    if (!fs.existsSync(imagePath)) {
      return reject(new Error(`Prescription image file not found: ${path.basename(imagePath)}`));
    }

    const pythonBin = options.pythonExecutable || getPythonExecutable();
    const timeoutMs = options.timeoutMs || parseInt(process.env.OCR_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
    const workerScript = options.workerScriptPath || WORKER_SCRIPT_PATH;
    const catalogPath = options.catalogPath || CATALOG_PATH;
    const lexiconPath = options.lexiconPath || LEXICON_PATH;

    if (!fs.existsSync(workerScript)) {
      return reject(new Error('OCR worker script (ocr_worker.py) not found.'));
    }

    // Build argument array — ZERO shell interpolation
    const args = [workerScript, imagePath];

    if (fs.existsSync(catalogPath)) {
      args.push('--catalog', catalogPath);
    }

    if (fs.existsSync(lexiconPath)) {
      args.push('--lexicon', lexiconPath);
    }

    if (process.env.OCR_ENABLE_QWEN_FALLBACK === 'true' || options.enableOllama) {
      args.push('--enable-ollama');
      if (process.env.OLLAMA_BASE_URL) {
        args.push('--ollama-url', process.env.OLLAMA_BASE_URL);
      }
      if (process.env.OLLAMA_VISION_MODEL) {
        args.push('--ollama-model', process.env.OLLAMA_VISION_MODEL);
      }
    }

    if (process.env.OCR_ENABLE_MEDSPACY === 'true' || options.enableMedspacy) {
      args.push('--enable-medspacy');
    }

    if (process.env.OCR_ENABLE_TROCR === 'true' || options.enableTrocr) {
      args.push('--enable-trocr');
      if (process.env.TROCR_MODEL_NAME || options.trocrModel) {
        args.push('--trocr-model', process.env.TROCR_MODEL_NAME || options.trocrModel);
      }
    }

    let stdoutData = '';
    let stderrData = '';
    let stdoutBytes = 0;
    let isTerminated = false;

    // Spawn child process without shell
    const child = spawn(pythonBin, args, {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });

    // Timeout guard
    const timer = setTimeout(() => {
      isTerminated = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      reject(new Error(`OCR worker timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        isTerminated = true;
        clearTimeout(timer);
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        return reject(new Error('OCR worker exceeded maximum output size limit (5MB).'));
      }
      stdoutData += chunk.toString('utf-8');
    });

    child.stderr.on('data', (chunk) => {
      // Diagnostic logging only — keep safe and bounded
      const str = chunk.toString('utf-8');
      stderrData += str;
      // Emit to parent stderr if in development/test mode
      if (process.env.NODE_ENV !== 'production') {
        process.stderr.write(str);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (isTerminated) return;
      if (err.code === 'ENOENT') {
        reject(new Error(`Configured Python executable not found: "${pythonBin}". Please check PYTHON_EXECUTABLE.`));
      } else {
        reject(new Error(`Failed to spawn Python OCR worker: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (isTerminated) return;

      const trimmedStdout = stdoutData.trim();

      if (code !== 0) {
        // Attempt to parse structured error JSON from stdout if worker emitted one
        try {
          const parsedErr = JSON.parse(trimmedStdout);
          if (parsedErr && parsedErr.error) {
            return reject(new Error(parsedErr.error));
          }
        } catch (_) {}

        const cleanStderr = stderrData.trim().split('\n').pop() || `Process exited with code ${code}`;
        return reject(new Error(`OCR worker crashed: ${cleanStderr}`));
      }

      try {
        const result = JSON.parse(trimmedStdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Malformed JSON output from OCR worker: ${parseErr.message}`));
      }
    });
  });
}

module.exports = {
  executePythonOCRWorker,
  getPythonExecutable,
  isPaddleAvailable
};
