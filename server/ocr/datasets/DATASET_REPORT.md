# MediFind AI — Dataset Engineering & Provenance Report (Phase 2A)
**Project Title:** MediFind AI — Local Prescription Document Understanding & Pharmacy Routing Platform  
**Document Purpose:** Academic Project Guide Review Deliverable — Auxiliary Medicine Reference Lexicon  
**Author:** MediFind AI Engineering Team  
**Date:** October 20, 2026  
**Status:** Phase 2A Complete & Verified  

---

## 1. Executive Summary

In handwritten prescription OCR pipelines, optical character recognition engines frequently extract imperfect character strings (e.g., *"Dalo 650"*, *"Cptixime 200"*, *"Por oprazele 40"*) due to cursive medical handwriting, varied lighting, and camera artifacts. 

MediFind AI previously maintained a strictly bounded catalogue of 50 seeded medicines (`server/ocr/catalog_50.json`). While sufficient for testing, any valid Indian prescription containing medications outside those 50 items was marked as `NOT_IN_CATALOGUE`.

To safely resolve this limitation without contaminating the production database or compromising patient safety, **Phase 2A** implements an offline, versioned **Auxiliary Medicine Reference Lexicon (v1)** consisting of **2,200 curated Indian medicine formulations** derived from the verified open-source **`junioralive/Indian-Medicine-Dataset`** under the **MIT Licence**.

---

## 2. Dataset Provenance & Legal Verification

| Metadata Element | Verification Record |
| :--- | :--- |
| **Dataset Title** | Indian Medicine Dataset |
| **Primary Repository** | `https://github.com/junioralive/Indian-Medicine-Dataset` |
| **Direct Raw Source File** | `https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv` |
| **Curator / Author** | JuniorAlive |
| **Verified Licence** | **MIT Licence** (Copyright © 2024 JuniorAlive) |
| **Licence Text Location** | [`server/ocr/datasets/LICENSE`](./LICENSE) |
| **Attribution Requirement** | Notice of copyright and permission statement preserved |
| **Access & Verification Date** | October 20, 2026 |
| **Original File Size on Disk** | **31,807,827 bytes (31.81 MB)** |
| **Original File Location** | `server/ocr/datasets/source/indian_medicine_data.csv` (Preserved unmodified) |
| **Git Exclusion Strategy** | Explicitly ignored in `.gitignore` (`server/ocr/datasets/source/*.csv`) |

---

## 3. Data Processing & Cleaning Statistics

The raw dataset of **253,973** rows was processed through a deterministic multi-stage filtering script ([`server/scripts/build_auxiliary_lexicon.js`](../scripts/build_auxiliary_lexicon.js)):

| Pipeline Stage | Record Count | Notes |
| :--- | :--- | :--- |
| **Total Raw Source Rows** | `253,973` | Unfiltered web scrape of commercial Indian medicine listings |
| **Discontinued Formulations Excluded** | `7,905` | Removed entries with `Is_discontinued === 'TRUE'` |
| **Non-Allopathic Entries Excluded** | `0` | All raw items in source were classified under allopathic medicines |
| **Missing Composition Excluded** | `0` | All processed records contained valid composition labels |
| **Active Allopathic Candidates** | `246,068` | Active, non-discontinued formulation pool |
| **Unique Formulations After Deduplication** | `241,917` | Deduplicated on normalized `(Brand, Generic, Strength, Form)` |
| **Priority Manufacturer Formulations** | `24,579` | Produced by top 38 verified Indian pharmaceutical companies |
| **Final Curated Lexicon Subset** | **`2,200`** | Cleaned, structured auxiliary reference entries |

### Dosage Form Distribution in Curated Lexicon
- **Tablets:** 1,326 (60.3%)
- **Injections:** 216 (9.8%)
- **Capsules:** 206 (9.4%)
- **Syrups & Liquids:** 139 (6.3%)
- **Oral Suspensions:** 87 (4.0%)
- **Topical Creams & Gels:** 53 (2.4%)
- **Eye & Ear Drops:** 44 (2.0%)
- **Nasal Sprays & Inhalers:** 25 (1.1%)
- **Ointments & Powders:** 7 (0.3%)
- **Other Formulations:** 97 (4.4%)

---

## 4. Retained Data Fields & Schema Definition

Each record in `indian_medicine_lexicon_v1.json` conforms to the following schema:

```json
{
  "lexiconId": "LEX-IND-00001",
  "sourceId": 1,
  "sourceName": "Augmentin 625 Duo Tablet",
  "brandName": "Augmentin 625 Duo",
  "genericName": "Amoxycillin + Clavulanic Acid",
  "activeIngredients": [
    { "ingredient": "Amoxycillin", "strength": "500mg" },
    { "ingredient": "Clavulanic Acid", "strength": "125mg" }
  ],
  "isCombination": true,
  "strength": "500mg + 125mg",
  "dosageForm": "Tablet",
  "manufacturer": "Glaxo SmithKline Pharmaceuticals Ltd",
  "packSizeLabel": "strip of 10 tablets",
  "priceInr": 223.42
}
```

---

## 5. Representative Records Across Therapeutic Categories

| Lexicon ID | Brand Name | Generic Active Ingredient(s) | Strength | Dosage Form | Category / Indications | Manufacturer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LEX-IND-00001** | `Augmentin 625 Duo` | Amoxycillin + Clavulanic Acid | 500mg + 125mg | Tablet | Broad-Spectrum Antibacterial | GlaxoSmithKline |
| **LEX-IND-00002** | `Azithral 500` | Azithromycin | 500mg | Tablet | Macrolide Antibiotic | Alembic Pharma |
| **LEX-IND-00003** | `Ascoril LS` | Ambroxol + Levosalbutamol | 30mg/5ml + 1mg/5ml | Syrup | Respiratory Mucolytic & Bronchodilator | Glenmark Pharma |
| **LEX-IND-00004** | `Allegra 120mg` | Fexofenadine | 120mg | Tablet | Non-sedating Antihistamine | Sanofi India |
| **LEX-IND-00006** | `Allegra-M` | Montelukast + Fexofenadine | 10mg + 120mg | Tablet | Allergy & Asthma Combination | Sanofi India |
| **LEX-IND-00011** | `Aciloc 150` | Ranitidine | 150mg | Tablet | Gastrointestinal H2 Blocker | Cadila Pharma |
| **LEX-IND-00014** | `Augmentin Duo` | Amoxycillin + Clavulanic Acid | 200mg + 28.5mg | Oral Suspension | Pediatric Antibacterial | GlaxoSmithKline |
| **LEX-IND-00021** | `Avil 25` | Pheniramine | 25mg | Tablet | Antiallergic | Sanofi India |
| **LEX-IND-00028** | `Atarax 25mg` | Hydroxyzine | 25mg | Tablet | Antihistamine / Anxiolytic | Dr. Reddy's |

---

## 6. Role in MediFind AI Architecture

```text
                  [Prescription Photo Upload]
                               │
                               ▼
                   [PaddleOCR / PP-OCRv5]
                               │ (Extracts: "Azithral 500 Tab")
                               ▼
            [Tier 1: 50-Medicine Seed Catalogue]
              │
         Found in DB? 
         ├── YES ──► Directly auto-match to seeded pharmacy inventory
         └── NO  ──► Consult [Tier 2: Auxiliary Lexicon (2,200 Entries)]
                       │
                       ▼
                 Match found: "Azithral 500" (Alembic)
                 Generic: "Azithromycin 500mg"
                       │
                       ▼
                 Propose candidate for Patient / Pharmacist Review
                 (Preserves raw OCR string; isConfirmed: false)
```

### Safety Principles Enforced:
1. **Separation of Concerns:** The auxiliary lexicon is an offline read-only lookup table. It cannot alter database inventory, pricing, or checkout totals.
2. **Combination Drug Protection:** Single-ingredient prescriptions never match combination products without explicit textual evidence.
3. **Regex-Strict Strength Enforcement:** Milligrams and frequencies are parsed directly from prescription tokens, never hallucinated from dictionary entries.
4. **Human Verification Invariant:** All OCR proposals require patient confirmation before reservation and pharmacist verification before dispensing.

---

## 7. Deliverable File Verification Checklist

| Deliverable | Path | File Size | Format | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Raw Source Dataset** | [`server/ocr/datasets/source/indian_medicine_data.csv`](./source/indian_medicine_data.csv) | `31,807,827 bytes` | CSV (Uncompressed) | **Verified on disk** |
| **Cleaned Lexicon (JSON)** | [`server/ocr/datasets/lexicon/indian_medicine_lexicon_v1.json`](./lexicon/indian_medicine_lexicon_v1.json) | `1,153,322 bytes` | JSON | **Verified on disk** |
| **Cleaned Lexicon (CSV)** | [`server/ocr/datasets/lexicon/indian_medicine_lexicon_v1.csv`](./lexicon/indian_medicine_lexicon_v1.csv) | `318,416 bytes` | CSV | **Verified on disk** |
| **Metadata & Summary** | [`server/ocr/datasets/lexicon/lexicon_metadata.json`](./lexicon/lexicon_metadata.json) | `1,158 bytes` | JSON | **Verified on disk** |
| **Official MIT Licence** | [`server/ocr/datasets/LICENSE`](./LICENSE) | `1,071 bytes` | Plain Text | **Verified on disk** |
| **Datasets README** | [`server/ocr/datasets/README.md`](./README.md) | `5,234 bytes` | Markdown | **Verified on disk** |
| **Academic Guide Report** | [`server/ocr/datasets/DATASET_REPORT.md`](./DATASET_REPORT.md) | Current document | Markdown | **Verified on disk** |
