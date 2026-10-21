<div align="center">

# 🏥 MediFind AI
### Intelligent Prescription-Assisted Medicine Discovery, Dispensary Availability & Secure Doorstep Relay

**Department of Computer Science and Engineering**  
**Providence College of Engineering, Chengannur, Kerala**

---

[![React 19](https://img.shields.io/badge/Frontend-React%2019%20%7C%20Vite%208-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Express.js](https://img.shields.io/badge/Backend-Express%205-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20Neon-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Prisma ORM](https://img.shields.io/badge/ORM-Prisma%205.22-2D3748?style=for-the-badge&logo=prisma)](https://prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Styling-Tailwind%20%7C%20Motion-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-48%2F48%20Passing-success?style=for-the-badge)](server/test_phase1_assistant_redesign.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)

<br />

<p align="center">
  <b>A full-stack, distributed healthcare platform designed to eliminate medicine availability fragmentation through local prescription OCR, multi-pharmacy inventory telemetry, and authenticated 4-digit PIN doorstep delivery.</b>
</p>

</div>

---

## 📑 Table of Contents

1. [Overview & Problem Statement](#overview--problem-statement)
2. [Pilot Territory & Participating Pharmacies](#pilot-territory--participating-pharmacies)
3. [System Architecture](#system-architecture)
4. [Key Features](#key-features)
5. [Portals & Role Specifications](#portals--role-specifications)
   - [Patient Access Portal](#1-patient-access-portal)
   - [Supervising Pharmacist Portal](#2-supervising-pharmacist-portal)
   - [Care Assistant Portal (Dual Tracks)](#3-care-assistant-portal)
   - [Executive Administrator Portal](#4-executive-administrator-portal)
6. [OCR & Indian Medicine Lexicon Pipeline](#ocr--indian-medicine-lexicon-pipeline)
7. [Cryptographic PIN Handover Protocol](#cryptographic-pin-handover-protocol)
8. [Database Schema (Prisma ORM)](#database-schema-prisma-orm)
9. [REST API Specification](#rest-api-specification)
10. [Local Development Setup](#local-development-setup)
11. [Environment Variables](#environment-variables)
12. [Cloud Production Deployment (Vercel + Render + Neon)](#cloud-production-deployment-vercel--render--neon)
13. [Automated Testing & Quality Assurance](#automated-testing--quality-assurance)
14. [Security, Privacy & RBAC Guardrails](#security-privacy--rbac-guardrails)
15. [Academic Context & Institution](#academic-context--institution)

---

## <a id="overview--problem-statement"></a> 🎯 Overview & Problem Statement

### The Problem
In suburban and tier-2/tier-3 communities across Kerala, finding prescribed medications remains a major hurdle for elderly, chronically ill, and rural patients:
* **Inventory Opacity**: Patients frequently travel to 3 or 4 pharmacies in person before discovering where required medications (e.g., cardiac drugs, insulin, pediatric antibiotics) are in stock.
* **Prescription Legibility**: Handwritten clinical scripts are notoriously difficult for patients to decipher, often leading to delayed treatment or incorrect purchases.
* **Physical Mobility Constraints**: Elderly patients, postpartum mothers, or individuals without immediate personal transit struggle to reach dispensaries during active operating hours.
* **Lack of Chain-of-Custody**: Generic third-party delivery options lack temperature-controlled handling and anti-fraud identity verification for scheduled medicines.

### The MediFind AI Solution
**MediFind AI** provides a unified, HIPAA-aware, zero-trust medicine accessibility platform:
* **Prescription Vision AI**: Scans doctor prescriptions using a localized, dual-engine ML OCR pipeline backed by an auxiliary lexicon of 1,000+ Indian medicine formulations.
* **Telemetry Discovery**: Cross-matches verified medicines in real time against live inventory at accredited participating pharmacies.
* **Dual-Track Assistant Dispatch**: Coordinates certified local delivery partners (Track 1) and registered healthcare clinicians (Track 2) for rapid doorstep handovers.
* **Zero-Leakage PIN Verification**: Guarantees medicines are released only upon cryptographic 4-digit PIN matching at the patient's doorstep.

---

## <a id="pilot-territory--participating-pharmacies"></a> 📍 Pilot Territory & Participating Pharmacies

MediFind AI is piloted across **Chengannur Taluk, Alappuzha District, Kerala, India**. The platform is connected to **two officially licensed, participating dispensaries**:

```
                       ┌──────────────────────────────────────────────┐
                       │           Chengannur Taluk Central           │
                       │           (Alappuzha Dist, Kerala)           │
                       └──────────────────────┬───────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
     ┌─────────────────────────────────┐             ┌─────────────────────────────────┐
     │       Max Care Pharmacy         │             │        Karuna Medicals          │
     ├─────────────────────────────────┤             ├─────────────────────────────────┤
     │ Govt. Hospital Junction         │             │ Private Bus Stand, Station Road │
     │ Chengannur, Kerala – 689121     │             │ Chengannur, Kerala – 689121     │
     │ 📞 +91 479 299 3291             │             │ 📞 +91 96057 18151             │
     │ ⏰ 09:30 AM – 08:00 PM          │             │ ⏰ 09:30 AM – 07:00 PM          │
     │ 📜 License: KL-ALP-2024-8841    │             │ 📜 License: KL-ALP-2023-4102    │
     │ ❄️ Cold-Chain Biologics Hub     │             │ ⚡ Emergency Reserve Dispensary  │
     └─────────────────────────────────┘             └─────────────────────────────────┘
```

---

## <a id="system-architecture"></a> 🏗️ System Architecture

MediFind AI implements an asynchronous, client-server architecture with clean layer separation:

```mermaid
graph TD
    subgraph ClientLayer ["Client Layer (React 19 + Vite 8)"]
        UI[Tailwind & Fluent Glassmorphism UI]
        Motion[Motion Spring Physics & LayoutId Tabs]
        Maps[Leaflet & MapLibre GL]
        AuthCtx[Auth & RBAC Session State]
    end

    subgraph ProxyGateway ["Routing & Proxy Gateway"]
        Vercel[Vercel SPA Edge /vercel.json]
    end

    subgraph ServerLayer ["Backend Core (Express 5 + Node.js)"]
        Router[Express Modular Router]
        AuthGuard[JWT Cryptographic Middleware]
        OCREngine[Python ML PaddleOCR / Tesseract Bridge]
        DistCalc[Haversine Distance & Route Estimator]
        Worker[Background Clinical Timeout Daemon]
    end

    subgraph DataLayer ["Data & Persistence Layer"]
        Prisma[Prisma ORM 5.22]
        Neon[(Neon Cloud Serverless PostgreSQL)]
        Storage[Secure Private Prescription Vault]
    end

    UI --> Vercel
    Vercel --> Router
    Router --> AuthGuard
    AuthGuard --> OCREngine
    AuthGuard --> DistCalc
    Router --> Prisma
    Worker --> Prisma
    Prisma --> Neon
    Router --> Storage
```

---

## <a id="key-features"></a> ✨ Key Features

| Category | Feature | Description |
| :--- | :--- | :--- |
| **Prescription Vision** | **Adaptive Image Enhancement** | Auto-deskews, normalizes contrast, and removes scanning artifacts from photos. |
| | **Dual-Engine OCR** | Executes high-precision PaddleOCR with dynamic Tesseract.js fallback. |
| | **Indian Medicine Lexicon** | Fuzzy matching against 1,000+ formulations (brand names, generics, strengths). |
| | **Patient Verification Gate** | Patients audit and confirm detected medicines before allocating inventory. |
| **Dispensary Discovery**| **Real-Time Telemetry** | Queries live stock quantities from Max Care Pharmacy and Karuna Medicals. |
| | **Geocoded Kerala Radius** | Calculates true Haversine radial distance from Chengannur central anchor hub. |
| | **Split-Order Routing** | Automatically routes multi-item orders across dispensaries if one is out of stock. |
| **Fulfillment & Relay** | **Dual Assistant Tracks** | Distinct pathways for Delivery Logistics vs. Verified Healthcare Professionals. |
| | **4-Digit Handover PIN** | Time-limited cryptographic PIN prevents medication handoff to wrong individuals. |
| | **EV Scooter Dispatch** | Tailored for two-wheeler rapid urban relay with cold-chain bag compliance. |
| **Governance & Safety** | **Strict RBAC Security** | Granular cryptographic guards distinguishing Patient, Pharmacist, Assistant, and Admin. |
| | **Private Image Vault** | Prescription scans are barred from static folders; served only via signed tokens. |
| | **Admin Audit Logging** | Immutable event ledger tracking every status change, allocation, and verification. |

---

## <a id="portals--role-specifications"></a> 👥 Portals & Role Specifications

### 1. Patient Access Portal
* **Prescription Upload & Review**: Upload prescriptions, trigger image enhancement, and verify extracted items with one-click dosage adjustments.
* **Interactive Pharmacy Comparison**: Compare prices, distance, stock levels, and available pickup or delivery slots between Max Care Pharmacy and Karuna Medicals.
* **Live Order Tracking**: Interactive step-by-step order journey: *Reserved → Pharmacist Verified → Assistant Dispatched → Doorstep Handover*.
* **Digital PIN Security**: Reveals the private 4-digit PIN required to receive medication.

### 2. Supervising Pharmacist Portal
* **Dispensary Work Queue**: Receive incoming orders and clinical review requests.
* **Prescription Authenticity Audit**: View high-resolution authenticated prescription images with side-by-side medicine extraction lists.
* **Stock Telemetry Control**: Update stock counts, flag shortages, and authorize counter releases.
* **Tamper-Evident Packaging Verification**: Confirm physical packaging and validate PIN handovers.

### 3. Care Assistant Portal
```
                  ┌──────────────────────────────────────────────┐
                  │       Assistant Registration Gateway         │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│ Track 1: Delivery Assistant     │             │ Track 2: Clinical Professional  │
├─────────────────────────────────┤             ├─────────────────────────────────┤
│ • Zero clinical certification   │             │ • Mandatory Council Reg. Number │
│ • Instant identity verification │             │ • Strict PENDING gating         │
│ • Local EV Scooter route relay  │             │ • Nursing, Vitals & Clinical    │
│ • 4-Digit Doorstep PIN Handover │             │ • Requires Admin Authorization  │
└─────────────────────────────────┘             └─────────────────────────────────┘
```
* **Track 1 (Medicine Access & Delivery Assistant)**: Open to community couriers. Focuses on rapid local transit, cold-chain handling, and PIN-secured handovers.
* **Track 2 (Healthcare Professional Assistant)**: For certified nurses, clinicians, and physiotherapists. Tasks remain strictly gated in `PENDING` status until verified by the platform admin.
* **GPS Territory Selector**: Auto-detects Kerala coordinates with quick town presets (*Chengannur, Mavelikara, Haripad, Thiruvalla*).
* **Interactive Profile**: View operational hub, transit mode, and direct contact tools for participating dispensaries.

### 4. Executive Administrator Portal
* **Operations Command Dashboard**: Live telemetry metrics displaying order counts, active relay tasks, and platform uptime.
* **Verification Queue**: Audit and approve/reject pending healthcare professional credentials and council license numbers.
* **Dispensary Governance**: Oversee partner pharmacy stock compliance, operational hours, and pricing integrity.
* **System Activity & Audit Logs**: Detailed chronological ledger of every platform action.

---

## <a id="ocr--indian-medicine-lexicon-pipeline"></a> 🔍 OCR & Indian Medicine Lexicon Pipeline

```
Raw Prescription Photo
         │
         ▼
[ Step 1: Pre-Processing ] ────────► Grayscale conversion, Otsu binarization, deskewing
         │
         ▼
[ Step 2: ML Feature Extraction ] ──► PaddleOCR text line segmentation & bounding boxes
         │
         ▼
[ Step 3: Dual-Engine Fallback ] ───► Tesseract.js fallback for low-confidence blocks
         │
         ▼
[ Step 4: Lexicon Fuzzy Match ] ────► Levenshtein & phonetic lookup across 1,000+ formulations
         │
         ▼
[ Step 5: Dosage & Strength ] ──────► Regex tokenization (e.g., 500mg, 10ml, O.D., B.D.)
         │
         ▼
[ Step 6: Patient Review Gate ] ────► Patient confirms candidate items before inventory reservation
```

---

## <a id="cryptographic-pin-handover-protocol"></a> 🔐 Cryptographic PIN Handover Protocol

To prevent lost packages, misdeliveries, or medication theft, MediFind AI utilizes an encrypted **4-Digit OTP/PIN Handover Protocol**:

1. **Generation**: Upon order placement, the server creates a cryptographically random 4-digit code tied to the order ID.
2. **Patient Storage**: Only the authenticated patient can view this PIN in their Order Tracking dashboard.
3. **Execution**:
   * For **Doorstep Delivery**: The assistant arrives at the patient's home and requests the 4-digit PIN. The assistant inputs the PIN into their portal.
   * For **Counter Pickup**: The patient presents their PIN to the supervising pharmacist at Max Care Pharmacy or Karuna Medicals.
4. **Validation**: The backend matches the hash in constant time. If valid, status transitions to `COMPLETED`; otherwise, release is prohibited.

---

## <a id="database-schema-prisma-orm"></a> 🗄️ Database Schema (Prisma ORM)

The database runs on **Neon PostgreSQL** via Prisma. Key core relational models:

```prisma
model User {
  id               String            @id @default(uuid())
  email            String            @unique
  password         String
  name             String
  phone            String?
  role             String            @default("PATIENT") // PATIENT, PHARMACIST, ASSISTANT, ADMIN
  createdAt        DateTime          @default(now())
  pharmacy         Pharmacy?
  orders           Order[]
  assistantTasks   AssistantTask[]
  prescriptions    Prescription[]
  assistantProfile AssistantProfile?
}

model Pharmacy {
  id             String      @id @default(uuid())
  name           String
  address        String
  phone          String
  operatingHours String
  licenseNumber  String
  latitude       Float?
  longitude      Float?
  isVerified     Boolean     @default(true)
  inventory      Inventory[]
  orders         Order[]
}

model AssistantProfile {
  id             String    @id @default(uuid())
  userId         String    @unique
  user           User      @relation(fields: [userId], references: [id])
  assistantType  String    // DELIVERY_ASSISTANT or HEALTHCARE_PROFESSIONAL
  operatingCity  String    @default("Chengannur, Kerala")
  operatingRadiusKm Int    @default(15)
  vehicleType    String    @default("Electric Two-Wheeler (EV Scooter)")
  verificationStatus String @default("PENDING") // PENDING or APPROVED
  councilRegNumber   String?
  onboardingCompleted Boolean @default(false)
}

model Order {
  id             String          @id @default(uuid())
  patientId      String
  pharmacyId     String
  status         String          // PENDING, CONFIRMED, DISPATCHED, COMPLETED, CANCELLED
  handoverPin    String          // 4-digit security code
  fulfillmentType String        // PICKUP, PHARMACY_DELIVERY, ASSISTANT_DELIVERY
  items          OrderItem[]
  createdAt      DateTime        @default(now())
}
```

---

## <a id="rest-api-specification"></a> 📡 REST API Specification

### Authentication & Profiles
| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new patient or assistant account |
| `POST` | `/api/auth/login` | Public | Authenticate user & issue JWT bearer token |
| `GET` | `/api/auth/me` | Authenticated | Retrieve current session and role metadata |
| `PUT` | `/api/auth/profile` | Authenticated | Update display name, phone, and contact details |

### Prescriptions & OCR
| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/prescriptions/upload` | `PATIENT` | Upload prescription image for enhancement & OCR |
| `GET` | `/api/prescriptions/:id/image` | `PATIENT`, `PHARMACIST`, `ADMIN` | Secure streaming of prescription image scan |
| `POST` | `/api/prescriptions/verify` | `PATIENT` | Confirm verified medicines list extracted from script |

### Pharmacies & Inventory
| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/pharmacies` | Public | Retrieve participating accredited dispensaries |
| `POST` | `/api/pharmacies/match-availability` | Public | Check stock availability across Chengannur dispensaries |
| `GET` | `/api/pharmacies/my-pharmacy` | `PHARMACIST` | Get managing pharmacist's inventory and orders |

### Orders & PIN Verification
| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | `PATIENT` | Place medicine reservation with selected fulfillment type |
| `GET` | `/api/orders` | Authenticated | List orders filtered by patient, pharmacy, or assistant |
| `PUT` | `/api/orders/:id/verify-pin` | `PHARMACIST`, `ASSISTANT` | Submit 4-digit PIN to finalize handover release |

### Assistant & Verification Operations
| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/assistant/profile` | `ASSISTANT` | Get live assistant verification status & track |
| `POST` | `/api/assistant/role-selection` | `ASSISTANT` | Select Delivery Assistant vs. Healthcare Professional |
| `GET` | `/api/assistant/available` | `ASSISTANT` | Get available tasks within geocoded operating radius |
| `POST` | `/api/admin/verifications/:id/approve` | `ADMIN` | Approve healthcare professional council license |

---

## <a id="local-development-setup"></a> 💻 Local Development Setup

### 1. Prerequisites
* **Node.js**: `v20.0.0+` or `v24.0.0+`
* **npm**: `v10.0.0+`
* **Git**: Installed
* **PostgreSQL Database**: Free cloud instance from [Neon.tech](https://neon.tech)

### 2. Clone Repository
```bash
git clone https://github.com/rahulx3-dev/Medifind-AI.git
cd Medifind-AI
```

### 3. Server Setup
```bash
cd server
npm install

# Create environment file from example
cp .env.example .env
```
Edit `server/.env` with your Neon database URL and JWT secret:
```env
DATABASE_URL="postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"
JWT_SECRET="e4a91b8d72f9c836015b3c4e8a71920394857b6a1e2f3d4c5b6a7b8c9d0e1f2a"
PORT=5000
NODE_ENV=development
```

Run database migrations and start server:
```bash
npx prisma generate
npm run dev
```
*(Server will start on `http://localhost:5000`)*

### 4. Client Setup
Open a separate terminal window:
```bash
cd client
npm install
npm run dev
```
*(Client will start on `http://localhost:3000` with automated proxy to port 5000)*

---

## <a id="environment-variables"></a> ⚙️ Environment Variables

### Backend (`server/.env`)
| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string | `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require` |
| `JWT_SECRET` | **Yes** | 32-byte cryptographic secret for token signing | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | No | Port Express listens on (Default: `5000`) | `5000` |
| `NODE_ENV` | No | Runtime environment (`development` / `production`) | `production` |
| `RAZORPAY_KEY_ID` | Optional | Razorpay Test Key for checkout testing | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | Optional | Razorpay Test Secret | `...` |

---

## <a id="cloud-production-deployment-vercel--render--neon"></a> 🚀 Cloud Production Deployment (Vercel + Render + Neon)

```
[User Browser]
      │
      ▼
[Vercel Global CDN] ──────────► Serves React 19 Frontend (client/)
      │  (Rewrites /api)
      ▼
[Render Web Service] ─────────► Runs Express.js REST API (server/)
      │
      ▼
[Neon Serverless DB] ─────────► Cloud PostgreSQL Database
```

### 1. Database (Neon Serverless PostgreSQL)
1. Sign up on **[Neon.tech](https://neon.tech)** and create a project (`neondb`).
2. Copy your **Pooled connection string**.

### 2. Backend API (Render.com)
1. Sign up on **[Render.com](https://render.com)** and connect your GitHub repo.
2. Select **New Web Service**:
   * **Root Directory**: `server`
   * **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy`
   * **Start Command**: `node src/server.js`
   * **Instance Type**: `Free`
3. Add **Environment Variables**:
   * `DATABASE_URL` = *(Your Neon connection string)*
   * `JWT_SECRET` = *(Your generated 64-char random hex)*
   * `NODE_ENV` = `production`
   * `PORT` = `5000`
4. Deploy! Your backend URL will be: `https://medifind-backend.onrender.com`.

### 3. Frontend Web App (Vercel)
1. Sign up on **[Vercel.com](https://vercel.com)** and import `rahulx3-dev/Medifind-AI`.
2. Configure project:
   * **Framework Preset**: `Vite`
   * **Root Directory**: Click edit and select **`client`**
   * **Build Command**: `npm run build`
   * **Output Directory**: `dist`
3. Click **Deploy**! Vercel serves the application with the included `client/vercel.json` proxying API calls cleanly without CORS issues.

---

## <a id="automated-testing--quality-assurance"></a> 🧪 Automated Testing & Quality Assurance

MediFind AI features comprehensive automated regression suites:

```bash
cd server
node test_phase1_assistant_redesign.js
```

### Test Suite Output (48/48 Passing)
```text
=============================================================
🧪 MediFind AI — Phase 1 Assistant Portal Redesign & Onboarding Test Suite
=============================================================

--- 1. Service Catalogue Structure & Obsolete Category Audit ---
  PASS  serviceCatalogue module loaded
  PASS  Obsolete category DIGITAL_ASSISTANCE marked obsolete
  PASS  Obsolete category PRESCRIPTION_ASSISTANCE marked obsolete
  PASS  Active category MEDICINE_DELIVERY is marked active delivery
  PASS  Candidate category NURSING_VISIT is marked clinical

--- 2. Assistant Registration & Mandatory First-Time Role Selection ---
  PASS  User registered with role ASSISTANT
  PASS  AssistantProfile created with assistantType null
  PASS  getAssistantProfile returns onboardingStep: ROLE_SELECTION

--- 3. Delivery Assistant Role Selection & Simple Profile Setup ---
  PASS  Role selection endpoint returns 200 for DELIVERY_ASSISTANT
  PASS  Default capabilities populated with medicine delivery
  PASS  Delivery profile requires NO professional registration number

--- 4. Healthcare Professional Application & PENDING Status Gating ---
  PASS  Role persisted as HEALTHCARE_PROFESSIONAL
  PASS  Default verificationStatus is strictly PENDING
  PASS  Council registration number stored securely

--- 5. Security Gating: Pending Healthcare Professional Blocked From Tasks ---
  PASS  Pending healthcare professional receives 0 available delivery tasks
  PASS  Response notifies professional that verification is PENDING

--- 6. Explicit Role Switching & Security Preservation ---
  PASS  Switching from Professional to Delivery Assistant succeeds
  PASS  Delivery capabilities restored on track switch

=============================================================
Phase 1 Verification Complete: 48 passed, 0 failed.
=============================================================
```

---

## <a id="security-privacy--rbac-guardrails"></a> 🛡️ Security, Privacy & RBAC Guardrails

* **Zero-Leakage Handover PIN**: Prevents medicine misplacement; releases medication only upon patient-authenticated 4-digit PIN verification.
* **Non-Public Prescription Vault**: All uploaded scans are excluded from static public web directories. File streams require authenticated HTTP GET with user or dispensary ownership verification.
* **Input Sanitization**: Built-in express-validator schemas protecting all search, order, and profile mutation endpoints.
* **Constant-Time Password Comparison**: Passwords hashed with `bcryptjs` (salt rounds: 10).

---

## <a id="academic-context--institution"></a> 🎓 Academic Context & Institution

* **Project**: Final Year B.Tech Capstone Project
* **Institution**: **Providence College of Engineering, Chengannur**
* **Department**: Department of Computer Science & Engineering
* **Author / Developer**: [@rahulx3-dev](https://github.com/rahulx3-dev)
* **Pilot Location**: Chengannur, Alappuzha District, Kerala, India
* **Participating Community Dispensaries**:
  * **Max Care Pharmacy** (Govt. Hospital Junction, Chengannur)
  * **Karuna Medicals** (Near Private Bus Stand, Station Road, Chengannur)

> **Academic Notice**: MediFind AI was developed as a final-year B.Tech Computer Science and Engineering project at Providence College of Engineering, Chengannur. It is intended for research, academic evaluation, and community healthcare logistics innovation. It does not replace certified medical consultation, prescribing physicians, or emergency dispatch services. All medicine disbursements require an authentic, signed prescription verified by a licensed pharmacist.

---

<div align="center">
  <sub>Developed at <b>Providence College of Engineering, Chengannur</b> • Built with ❤️ for accessible healthcare logistics in Kerala.</sub>
</div>
