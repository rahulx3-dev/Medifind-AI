# MediFind AI — Local Prescription OCR & Document Understanding Pipeline (Phase 6.1E.3)

> **Phase Status:** Phase 6.1E.3 — RESOLVED & VALIDATED (Live Local PaddleOCR Operational on Windows CPU)  
> **Tesseract Status:** DECOMMISSIONED from production flow (see §Tesseract Decommission below)

---

## Important Disclaimers

> **OCR is assistive extraction only. It is NOT a medical decision system.**  
> Patient verification is mandatory before any OCR result enters the pharmacy or order workflow.  
> The MediFind catalogue is the sole authoritative source for medicine identities.  
> Handwriting accuracy is not guaranteed. Ambiguous results are always surfaced for patient review.  
> No cloud OCR service is used. All processing is 100% local.  
> Qwen-VL is an optional local model. It is disabled by default.

---

## Overview

This directory contains the **completely LOCAL** prescription OCR and document-understanding pipeline for MediFind AI. It was introduced in Phase 6.1E.1, hardened in Phase 6.1E.2, and resolved for local CPU runtime compatibility in Phase 6.1E.3.

### What it does
- Accepts a local prescription image (JPEG/PNG/WEBP).
- Performs multi-stage layout analysis, text recognition, medicine candidate extraction, and catalogue matching — entirely on-device on CPU.
- Returns a structured JSON result to the Node.js server.
- The patient then reviews and confirms every detected medicine in the Verification Modal before any order or pharmacy search proceeds.

### What it does NOT do
- It does not diagnose.
- It does not prescribe.
- It does not infer dosage, duration, or treatment frequency beyond what is explicitly written.
- It does not create Medicine records in the database.
- It does not verify prescriptions (patient verification is the only accepted authority).
- It does not contact any cloud API.

---

## Local Runtime Compatibility & Resolution (Phase 6.1E.3)

### Original Blocker
The Phase 6.1E.2 report identified:
`PaddlePaddle 3.3.1 / Windows CPU / Python 3.13 oneDNN PIR issue: PaddleOCR returns zero text blocks on this configuration.`

### Root Cause
PaddleOCR 3.7.0 (via PaddleX 3.x) invokes the experimental **PIR (Program Intermediate Representation)** execution engine introduced in PaddlePaddle 3.x. When running on Windows CPU with oneDNN (formerly MKL-DNN), the operator converter at `paddle\fluid\framework\new_executor\instruction\onednn\onednn_instruction.cc:118` throws:
```
(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]
```
This caused PaddleOCR to fail silently during the prediction pass, resulting in zero detected text blocks on Windows CPU machines.

### The Solution
A dedicated virtual environment was established at `server/ocr/.venv` using **PaddleOCR 2.10.0** and **PaddlePaddle 3.0.0** (with `setuptools` and `numpy 2.5.3`).
- **Why this works:** PaddleOCR 2.10.0 uses the stable legacy Paddle C++ inference engine (`paddle.inference.Config`), which does NOT invoke the PIR executor and avoids the `ConvertPirAttribute2RuntimeAttribute` oneDNN instruction bug on Windows CPU.
- **Performance:** CPU inference runs with high accuracy in ~0.5s to 5s per prescription image.
- **Node Integration:** `server/src/utils/pythonOcrBridge.js` automatically auto-detects `server/ocr/.venv/Scripts/python.exe` (Windows) or `server/ocr/.venv/bin/python` (Unix) if `PYTHON_EXECUTABLE` is not explicitly set in the environment.

### Verified Runtime Environment
| Component | Verified Specification |
|---|---|
| **Python Version** | Python 3.13.2 (64-bit Windows AMD64) |
| **Virtual Environment** | `server/ocr/.venv/` |
| **PaddlePaddle** | `3.0.0` |
| **PaddleOCR** | `2.10.0` |
| **PaddleX** | Not required (bypasses PIR engine on CPU) |
| **Models** | PP-OCRv4 (`en_PP-OCRv3_det_infer`, `en_PP-OCRv4_rec_infer`, `ch_ppocr_mobile_v2.0_cls_infer`) |
| **OS** | Windows 10/11 (AMD64) |
| **Hardware** | Intel/AMD CPU (CPU-only execution) |

---

## Authoritative Architecture

```
Prescription Image (Authenticated Patient Upload)
     │
     ▼
1. HTTP & Auth Guard
   - JWT authentication enforced before any file is accepted
   - Patient ownership validated; cross-patient access blocked
     │
     ▼
2. Multer / MIME Validation
   - Accepts: image/jpeg, image/png, image/webp only
   - Unexpected field names rejected with HTTP 415
     │
     ▼
3. Magic-Byte Validation
   - File header bytes verified (FFD8FFE0 for JPEG, 89504E47 for PNG, etc.)
   - Spoofed MIME types are rejected before processing begins
     │
     ▼
4. Python OCR Worker Bridge (pythonOcrBridge.js)
   - Auto-resolves to server/ocr/.venv/Scripts/python.exe (or custom PYTHON_EXECUTABLE)
   - child_process.spawn() with shell: false  ← no shell injection possible
   - Argument vector (imagePath, --catalog path) passed safely
   - 5 MB stdout ceiling enforced
   - 30-second execution timeout with SIGKILL on breach
   - stderr captured, bounded, and sanitized before any logging
     │
     ▼
5. ocr_worker.py — LOCAL Python Execution
   │
   ├── 5a. Image Validation & Preprocessing (Pillow / OpenCV)
   │       - Validates dimensions, file size, format
   │       - Gentle contrast normalization (1.10×) preserving handwriting strokes
   │       - EXIF orientation normalization
   │       - Quality warnings generated for low-resolution or extreme aspect-ratio images
   │
   ├── 5b. Document Layout Analysis (Spatial Bounding-Box Segmentation)
   │       - Classifies text regions: HEADER, PATIENT_INFO, MEDICINE_SECTION, FOOTER
   │       - Clinic/doctor header lines → EXCLUDED from medicine matching
   │       - Patient metadata lines → EXCLUDED from medicine matching
   │       - Only MEDICINE_SECTION blocks proceed to matching
   │
   ├── 5c. Primary OCR Recognition (PaddleOCR / PP-OCRv4 via 2.x API)
   │       - Detection: en_PP-OCRv3_det_infer
   │       - Recognition: en_PP-OCRv4_rec_infer
   │       - Direction Classifier: ch_ppocr_mobile_v2.0_cls_infer
   │       - All models pre-downloaded and cached locally under ~/.paddleocr/whl/
   │       - PaddleOCR failure → returns safe {success: false} state; never calls Tesseract
   │
   ├── 5d. Medicine Line Reconstruction
   │       - Fragments grouped into horizontal lines using vertical bounding-box overlap
   │       - Reading order: top-to-bottom, left-to-right
   │       - Merges adjacent text blocks within the same horizontal band
   │
   ├── 5e. Deterministic Text Normalization
   │       - Lowercase & trim
   │       - Unit normalization: "MG" → "mg", "M.G." → "mg", "mgs" → "mg"
   │       - Common OCR digit-letter confusion: "65O" → "650", "4O" → "40"
   │       - Handwriting currency confusions: "€50" → "650"
   │       - Stop-word removal (tab, capsule, od, bd, tds, etc.)
   │
   ├── 5f. Authoritative 50-Medicine Catalogue Matching
   │       - Source: catalog_50.json (generated from seedData.js)
   │       - Strategies:
   │         1. Exact brand name & root brand match → matchScore: 1.0
   │         2. Generic name similarity (Levenshtein, salt-stripped)
   │         3. Alias/alternativeGenerics matching
   │         4. Strength value bonus (+0.10 when strength matches)
   │       - Confidence classes:
   │         ┌──────────────────────┬───────────────────────────────────────────┐
   │         │ HIGH_CONFIDENCE      │ Top score ≥ 0.78 AND gap from 2nd ≥ 0.08 │
   │         │ AMBIGUOUS            │ Top score ≥ 0.60 (close competitors)      │
   │         │ NOT_IN_CATALOGUE     │ No candidate ≥ 0.50                       │
   │         │ UNREADABLE           │ PaddleOCR returned zero text blocks       │
   │         └──────────────────────┴───────────────────────────────────────────┘
   │       - OCR confidence and match confidence are SEPARATE fields
   │       - Match score is a Levenshtein/similarity heuristic, NOT a medical probability
   │       - OCR cannot create new Medicine records under any condition
   │
   ├── 5g. Optional medSpaCy Supporting Layer (disabled by default)
   │       - Activated by: OCR_ENABLE_MEDSPACY=true
   │       - Role: strength & unit extraction from explicitly written text only
   │       - NEVER creates medicine identities
   │       - NEVER infers dosage, duration, or missing information
   │       - Unknown values remain null
   │
   └── 5h. Optional Local Qwen-VL Second Pass (disabled by default)
           - Activated by: OCR_ENABLE_QWEN_FALLBACK=true
           - Requires: local Ollama running at OLLAMA_BASE_URL
           - Role: secondary evidence for AMBIGUOUS or NOT_IN_CATALOGUE lines only
           - Qwen agrees → confidence upgraded (if similarity > 0.85 with PaddleOCR top candidate)
           - Qwen disagrees or unavailable → no effect; worker continues safely
           - NEVER creates medicine records
           - NEVER overrides catalogue authority
           - NEVER overrides patient verification requirement
           - NEVER diagnoses, prescribes, or invents dosage/frequency/duration
     │
     ▼
6. Structured JSON → Node.js Express Controller (prescriptionController.js)
   - DetectedMedicine records created with isConfirmed: false (ALWAYS)
   - matchedMedicineId linked to existing Medicine records only
   - OCR cannot call prisma.medicine.create() — only prisma.medicine.findMany()
     │
     ▼
7. Prescription Document Integrity & Authenticity Screening (documentScreeningEngine.js)
   - Quality, readability, structure, and submission-history checks
   - Results: NO_OBVIOUS_ISSUES | NEEDS_MANUAL_REVIEW | POTENTIALLY_SUSPICIOUS | UNABLE_TO_ASSESS
   - No automated screening result claims authenticity
   - Mandatory disclaimer appended to all screening outputs
     │
     ▼
8. Patient Verification UI (Mandatory)
   - Patient reviews every detected medicine in the Verification Modal
   - Patient confirms or manually maps each item
   - Prescription status → VERIFIED only after patient confirmation
   - Orders cannot be created from unverified prescriptions (HTTP 400 enforced)
```

---

## Installation & Setup

### 1. Set Up the Dedicated Virtual Environment
From the `server` directory:
```powershell
# Create dedicated venv in server/ocr/.venv
python -m venv ocr/.venv

# Install setuptools and required wheels
ocr/.venv/Scripts/python.exe -m pip install --upgrade pip
ocr/.venv/Scripts/python.exe -m pip install setuptools
ocr/.venv/Scripts/python.exe -m pip install "paddleocr==2.10.0" "paddlepaddle==3.0.0" "Pillow>=10.0.0" "opencv-python>=4.8.0"
```

### 2. Verify Installation
```powershell
ocr/.venv/Scripts/python.exe -c "import paddle, paddleocr; print('Paddle:', paddle.__version__, '| PaddleOCR:', paddleocr.__version__)"
```
Expected output:
```
Paddle: 3.0.0 | PaddleOCR: 2.10.0
```

### 3. Run Actual OCR Smoke Test
```powershell
ocr/.venv/Scripts/python.exe ocr/ocr_worker.py test_fixtures/test_prescription_dolo.jpg
```
Expected output:
- Diagnostics to `stderr` (`[MediFind-OCR] Detected PaddleOCR API version: 2.x`, `PaddleOCR recognized 2 text blocks`)
- Pure JSON to `stdout` containing:
  - `"success": true`
  - `"engine": { "primary": "PaddleOCR / PP-OCRv4 (2.x API)" }`
  - `"rawText": "Rx: Dolo 650\n1 tab twice daily"`
  - `"medicineCandidates": [ { "medicineName": "Dolo 650", "matchConfidence": 1.0 } ]`
  - `"confidenceClass": "HIGH_CONFIDENCE"`
  - `"requiresPatientVerification": true`

---

## Catalogue Synchronization

### Source of Truth
`server/prisma/seedData.js` → `medicinesData` array

This is the **single authoritative source** for the 50-medicine MediFind catalogue. The Prisma database is seeded from this file.

### Generated OCR Snapshot
`server/ocr/catalog_50.json` is a **runtime snapshot** generated from `seedData.js`.

> ⚠️ **Do NOT edit `catalog_50.json` manually.** It will be overwritten by the sync script.

### Synchronization Script
```bash
# Check whether catalog_50.json is in sync with seedData.js (no writes):
node server/ocr/sync_catalog_50.js --check

# Regenerate catalog_50.json from seedData.js:
node server/ocr/sync_catalog_50.js
```

---

## Tesseract Decommission (Phase 6.1E.2 & 6.1E.3)

**Tesseract has been completely removed from the automatic production flow.**

### Invariants:
1. **No Silent Fallback:** If PaddleOCR encounters an unreadable image or error, the system returns a safe `{ success: false }` or UNREADABLE state. It **never** falls back to Tesseract.
2. **Lazy Execution Only:** Tesseract is never required at the global scope; it is only loaded if `PRESCRIPTION_OCR_ENGINE=tesseract` is explicitly set by a developer for legacy test reproduction.
3. **Production Guard:** `PRESCRIPTION_OCR_ENGINE` defaults to `'paddle'`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PRESCRIPTION_OCR_ENGINE` | `paddle` | **Production: must be `paddle`.** Set `tesseract` ONLY for developer/historical-test override. |
| `PYTHON_EXECUTABLE` | Auto-detected: `ocr/.venv/Scripts/python.exe` (Win) | Path to local Python binary. Automatically falls back to dedicated venv if present. |
| `OCR_TIMEOUT_MS` | `30000` | Worker execution timeout in ms. Process killed on breach. |
| `OCR_ENABLE_QWEN_FALLBACK` | `false` | Enable optional local Ollama Qwen-VL second pass. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint. |
| `OLLAMA_VISION_MODEL` | `qwen2.5-vl` | Ollama vision model tag. |
| `OCR_ENABLE_MEDSPACY` | `false` | Enable optional medSpaCy clinical entity extraction. |

---

## Test Suites

| Test File | Tests | Coverage | Status |
|---|---|---|---|
| `test_phase6_1e3_ocr_runtime.js` | 20 | Live PaddleOCR execution, model initialization, layout, Dolo 650 matching, multi-medicine, header exclusion, unreadable safety, Node bridge, performance | ✅ 20/20 PASSED |
| `test_phase6_1e2_ocr_hardening.js` | 38 | Catalogue sync, Tesseract isolation, OCR safety, confidence, layout, Qwen, medSpaCy, security, UI regressions | ✅ 38/38 PASSED |
| `test_phase6_1e1_ocr.js` | 32 | Python worker input bounds, timeouts, crashes, layout, patient verification, auth | ✅ 32/32 PASSED |
| `test_prescription_screening.js` | 23 | Screening engine accuracy, access control, privacy | ✅ 23/23 PASSED |
| `test_ocr_upload_regression.js` | 4 | Multer field validation, OCR pipeline, sample demo | ✅ 4/4 PASSED |
| `test_e2e.js` | 7 | Full patient flow from login to prescription OCR to order completion | ✅ 7/7 PASSED |

Run all OCR verification suites:
```bash
cd server
node test_phase6_1e3_ocr_runtime.js
node test_phase6_1e2_ocr_hardening.js
node test_phase6_1e1_ocr.js
node test_prescription_screening.js
node test_ocr_upload_regression.js
node test_e2e.js
```
