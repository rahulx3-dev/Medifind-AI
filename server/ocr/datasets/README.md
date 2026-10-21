# MediFind AI — Auxiliary Medicine Reference Lexicon (v1 & v2)

This directory houses the offline auxiliary medicine reference dataset used to enhance handwritten prescription optical character recognition (OCR) candidate proposal in MediFind AI.

---

## 1. Provenance & Source Metadata

- **Dataset Name:** Indian Medicine Dataset (Curated Release)
- **Source Repository:** [https://github.com/junioralive/Indian-Medicine-Dataset](https://github.com/junioralive/Indian-Medicine-Dataset)
- **Direct Raw Data Source:** [https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv](https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv)
- **Author / Curator:** JuniorAlive
- **Access & Download Date:** October 20, 2026
- **Licence:** **MIT Licence** (Permissive open source; full licence text included in [`LICENSE`](./LICENSE))
- **Attribution Notice:**
  > Copyright (c) 2024 JuniorAlive. Licensed under the MIT License. Data provided "as is" without warranty.

---

## 2. Dataset Architecture & Storage Layout

```text
server/ocr/datasets/
├── LICENSE                                # Official MIT Licence text
├── README.md                              # Dataset documentation and provenance (this file)
├── DATASET_REPORT.md                      # Phase 2A original dataset report
├── DATASET_REPORT_V2.md                   # Phase 2C corrected curation and validation report
├── source/
│   └── indian_medicine_data.csv           # Original downloaded dataset (253,973 rows, 31.81 MB) [gitignored]
└── lexicon/
    ├── indian_medicine_lexicon_v1.json    # Initial reference lexicon (v1) [preserved]
    ├── indian_medicine_lexicon_v1.csv     # Spreadsheet companion (v1) [preserved]
    ├── lexicon_metadata.json              # Initial metadata summary (v1)
    ├── indian_medicine_lexicon_v2.json    # Corrected stratified A–Z lexicon (2,205 entries, 1.48 MB)
    ├── indian_medicine_lexicon_v2.csv     # Corrected CSV companion (2,205 rows, 420 KB)
    └── lexicon_metadata_v2.json           # Detailed v2 metadata and audit metrics
```

---

## 3. Curation Evolutions & Defect Corrections (v1 vs v2)

Following the comprehensive Phase 2B data-quality audit, Phase 2C implemented critical dataset preparation corrections via [`server/scripts/build_auxiliary_lexicon.js`](../../scripts/build_auxiliary_lexicon.js):

| Defect / Feature | Phase 2A (v1 Lexicon) | Phase 2C (v2 Lexicon - Corrected) |
| :--- | :--- | :--- |
| **Alphabetical Sampling** | Defective `slice(0, 2200)`: 97.3% starting with 'A' (2,141 entries), 0% for letters C–Z. | **Deterministic Stratified Sampling:** 84–85 records for every letter A–Z + numeric (0-9) prefixes. Uniform, balanced distribution. |
| **Common Brands** | Absent or missing because C–Z letters were excluded (*Crocin*, *Dolo*, *Combiflam*, *Pan*, *Telma*, etc. missing). | **Guaranteed Inclusion:** *Crocin* (3), *Dolo* (10), *Combiflam* (2), *Glycomet* (12), *Pan* (22), *Telma* (63), *Voveran* (7) verified. |
| **Non-Numeric Descriptors** | Treated `Plain`, `Liposomal`, `Natural Micronized`, `NA` as numeric strengths. | **Separated Descriptors:** Retained as ingredient modifiers (e.g. `Doxorubicin (Liposomal)`), while numeric strength is parsed or marked unknown. |
| **Missing / Unknown Strengths** | Unspecified strengths were either dropped or populated with `NA`. | **Verified vs Unknown Flagging:** Numeric strength inferred unambiguously from product name where safe; otherwise marked `null` with `strengthReviewRequired: true`. |
| **Dosage Form Classification** | Missing patterns for *Infusion*, *Lotion*, *Topical Solution*, *Respule*, resulting in generic "Other". | **Expanded Classification:** Explicit patterns for `Infusion` (81), `Lotion` (82), `Topical Solution` (67), `Respule` (46), `Oral Solution` (73). |
| **Regulatory Screening** | No regulatory screening; prohibited drugs (Cisapride, pediatric Nimesulide) appeared without warnings. | **CDSCO Section 26A Governance:** Screened against official Gazette notifications (G.S.R. 82(E), G.S.R. 889(E)). Prohibited items flagged `PROHIBITED` with `isEligibleForMatching: false`. |

---

## 4. Retained Data Fields (v2 Schema)

Each record in `indian_medicine_lexicon_v2.json` contains:

```json
{
  "lexiconId": "LEX-IND-V2-00271",
  "sourceId": 58235,
  "sourceName": "Dolo 650 Tablet",
  "brandName": "Dolo 650",
  "genericName": "Paracetamol",
  "activeIngredients": [
    {
      "ingredient": "Paracetamol",
      "strength": "650mg",
      "rawComposition": "Paracetamol (650mg)",
      "strengthSource": "composition",
      "strengthReviewRequired": false
    }
  ],
  "isCombination": false,
  "strength": "650mg",
  "strengthVerified": true,
  "strengthReviewRequired": false,
  "dosageForm": "Tablet",
  "manufacturer": "Micro Labs Ltd",
  "packSizeLabel": "strip of 15 tablets",
  "priceInr": 34.27,
  "regulatoryStatus": "STANDARD_ALLOPATHIC",
  "isEligibleForMatching": true,
  "regulatoryDetails": {
    "status": "STANDARD_ALLOPATHIC",
    "reason": null,
    "reference": "CDSCO Approved Allopathic List / National Formulary of India",
    "sourceUrl": "https://cdsco.gov.in",
    "verificationDate": "2026-10-20"
  }
}
```

---

## 5. System Safety & Architectural Constraints

- **Strict Dataset Boundaries:**
  - `server/ocr/catalog_50.json` is preserved completely unmodified (authoritative 50 seed medicines).
  - Production database `Medicine` table is unmodified (no bulk inserts).
  - Raw downloaded CSV (`server/ocr/datasets/source/indian_medicine_data.csv`) is preserved unmodified.
  - Initial v1 lexicon files (`indian_medicine_lexicon_v1.json` & `.csv`) are preserved for auditability.
- **OCR Proposal Governance:**
  - Candidates marked `isEligibleForMatching: false` (e.g. `PROHIBITED` under CDSCO Section 26A or `REVIEW_REQUIRED`) are strictly excluded from candidate suggestions.
  - OCR candidate suggestions are read-only proposals; they do not alter pharmacist prescription review or inventory workflows.

---

## 6. Validation Suite

The dataset is validated by a dedicated 23-assertion test suite:
```bash
node server/test_auxiliary_medicine_lexicon_v2.js
```
The suite confirms A–Z sampling uniformity, zero duplicate IDs, absence of text descriptors in numeric strength, combination ingredient integrity, expanded dosage form classifications, common medicine coverage, and CDSCO compliance.
