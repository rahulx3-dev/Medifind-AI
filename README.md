# MediFind AI 🏥

### *Intelligent Prescription-Assisted Medicine Discovery, Verified Dispensary Network & Secure Doorstep Relay*

[![React 19](https://img.shields.io/badge/Frontend-React%2019%20%7C%20Vite%208-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Express.js](https://img.shields.io/badge/Backend-Express%205-000000?style=flat-square&logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20Neon-336791?style=flat-square&logo=postgresql)](https://neon.tech/)
[![Prisma ORM](https://img.shields.io/badge/ORM-Prisma%205.22-2D3748?style=flat-square&logo=prisma)](https://prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Styling-Tailwind%20%7C%20Motion-06B6D4?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=flat-square)](LICENSE)

---

## 📌 Executive Summary

**MediFind AI** is an intelligent healthcare logistics and medicine accessibility platform engineered to solve real-world medicine availability fragmentation in suburban and semi-urban communities. 

Operating in an active pilot across **Chengannur, Kerala**, MediFind AI connects patients with accredited local dispensaries, extracts and cross-matches handwritten prescriptions using machine learning and local OCR, and provides a temperature-monitored, 4-digit PIN-authenticated doorstep collection relay.

```
       [ Patient Prescription Upload ]
                     │
                     ▼
       [ Local OCR & Lexicon Matching ]
                     │
                     ▼
       [ Real-Time Pharmacy Stock Relay ]
     ┌───────────────┴───────────────┐
     ▼                               ▼
[ Max Care Pharmacy ]      [ Karuna Medicals ]
(Hospital Junction)         (Station Road)
     └───────────────┬───────────────┘
                     ▼
       [ 4-Digit Handover PIN Protocol ]
                     │
                     ▼
[ Temperature-Monitored Doorstep Delivery ]
```

---

## 🏛️ Accredited Participating Pharmacies

MediFind AI is integrated with licensed participating dispensaries in Chengannur, Kerala with verified stock telemetry and direct counter coordination:

| Pharmacy | Location | Contact | Operating Hours | Drug License |
| :--- | :--- | :--- | :--- | :--- |
| **Max Care Pharmacy** | 20/375, Govt. Hospital Junction, Chengannur, Kerala – 689121 | `+91 479 299 3291` | `09:30 AM – 08:00 PM` | `KL-ALP-2024-8841` |
| **Karuna Medicals** | XI/567(1), Station Road, Chengannur, Kerala – 689121 | `+91 96057 18151` | `09:30 AM – 07:00 PM` | `KL-ALP-2023-4102` |

---

## 🚀 Key System Capabilities

### 1. Intelligent Prescription OCR & Lexicon Normalization
* **Adaptive Image Enhancement**: High-contrast binarization, deskewing, and noise reduction optimized for handwritten doctor prescriptions.
* **Dual-Engine OCR**: Localized PaddleOCR execution with automatic Tesseract fallback.
* **1,000+ Indian Medicine Lexicon**: Fuzzy phonetic cross-matching mapping handwritten brand names (e.g., *Calpol, Pan-D, Augmentin, Glycomet*) to standardized formulations, dosage strengths, and generic equivalents.
* **Patient Clarification Safety Gate**: Raw OCR outputs are presented to the patient for one-click verification and dosage confirmation before inventory allocation.

### 2. Dual-Track Assistant Logistics Network
* **Track 1: Medicine Access & Delivery Assistant**:
  * Designed for rapid, zero-friction registration for local delivery partners.
  * Geocoded Kerala town radius (e.g., Chengannur, Mavelikara, Haripad).
  * Electric two-wheeler (EV Scooter) eco-routing with cold-chain bag monitoring.
  * Real-time GPS location detection.
* **Track 2: Healthcare Professional Assistant**:
  * Designed for registered Nurses, Physiotherapists, and Clinical Specialists.
  * Mandatory verification gate: requires official State Council Registration number.
  * Clinical task gating: blocked from live patient care until administrator approves credentials.

### 3. Cryptographic Handover PIN Protocol
* Every reservation generates an encrypted **4-digit one-time Handover PIN**.
* Deliveries and counter pick-ups can only be finalized when the assistant or pharmacist enters the patient's authenticated PIN.
* Guarantees **zero fraudulent handovers** and complete chain-of-custody tracking.

### 4. Enterprise-Grade Security & Privacy
* **Role-Based Access Control (RBAC)**: Strict separation across `PATIENT`, `PHARMACIST`, `ASSISTANT`, and `ADMIN`.
* **Authenticated Prescription Storage**: Medical images are stored outside public static directories and served exclusively via authenticated, permission-checked endpoints (`GET /api/prescriptions/:id/image`).
* **Audit Trail**: Every verification, stock allocation, and dispatch event is logged with immutable timestamps.

---

## 👥 User Roles & Dedicated Portals

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MediFind AI Portal Ecosystem                    │
└────────────────────────────────────────────────────────────────────────┘
       │                    │                    │                   │
       ▼                    ▼                    ▼                   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐    ┌──────────────┐
│   PATIENT    │     │  PHARMACIST  │     │  ASSISTANT   │    │    ADMIN     │
│  Prescription│     │  Live Counter│     │  EV Delivery │    │  Operations  │
│  Reservation │     │  Verification│     │  Clinical Hub│    │  Governance  │
│  PIN Handover│     │  Cold-Chain  │     │  Territory   │    │  Compliance  │
└──────────────┘     └──────────────┘     └──────────────┘    └──────────────┘
```

1. **Patient Access Portal**:
   * Digital prescription upload, interactive medicine discovery, and multi-pharmacy price comparison.
   * Real-time order progress tracking with doorstep delivery status.
   * Secure ABHA health ID linkage and doorstep PIN generation.

2. **Supervising Pharmacist Portal**:
   * Counter reservation verification queue with drug license auditing.
   * Inventory stock telemetry and restock demand alerts.
   * Tamper-evident packaging workflows with counter PIN authorization.

3. **Care Assistant Portal**:
   * Live task dispatch feed showing available delivery and pickup requests.
   * Kerala GPS auto-detection with custom operating radius thresholds.
   * Interactive profile management with real participating dispensary directories.

4. **Executive Administrator Portal**:
   * Central operations command hub with live telemetry across all active nodes.
   * Assistant credentialing and state council verification review queue.
   * Multi-dispensary governance, pricing audit logs, and fraud prevention telemetry.

---

## 🛠️ Technology Stack

### Frontend Architecture
* **Core Framework**: React 19 + Vite 8
* **Styling**: Tailwind CSS + Vanilla Design System (Fluent Acrylic & Apple Glassmorphism)
* **Animation & Micro-Interactions**: Motion (`motion/react`) with spring physics and sliding `layoutId` pill indicators
* **Geospatial & Mapping**: Leaflet, MapLibre GL, and OpenStreetMap
* **State & Sync**: Custom Reactive Event Dispatchers + Storage Sync

### Backend Architecture
* **Runtime**: Node.js (v20+ / v24+) + Express 5
* **Database & Persistence**: PostgreSQL hosted on **Neon Serverless**, modeled with **Prisma ORM 5.22**
* **Security & Auth**: Cryptographic JWT Bearer Tokens, `bcryptjs` password hashing, input sanitization
* **Payments**: Razorpay Gateway Integration (Academic Test Mode)
* **Computer Vision**: Python PaddleOCR engine + Tesseract OCR fallback

---

## 📂 Project Repository Structure

```text
Medifind-AI/
├── client/                           # React 19 + Vite Frontend Application
│   ├── src/
│   │   ├── components/               # Reusable UI & modal components
│   │   ├── context/                  # AuthContext & ThemeContext
│   │   ├── pages/                    # Portal Views (Patient, Pharmacist, Assistant, Admin)
│   │   ├── utils/                    # Audio feedback, geolocation, pricing matchers
│   │   └── index.css                 # Universal clinical typography & responsive theme tokens
│   ├── vercel.json                   # Vercel SPA routing & backend proxy configuration
│   └── vite.config.js                # Vite build chunks & local development proxy
│
├── server/                           # Express.js REST API & Backend Engine
│   ├── src/
│   │   ├── controllers/              # Business logic (Orders, Auth, Assistant, Verification)
│   │   ├── middlewares/              # JWT authorization & role-based guards
│   │   ├── routes/                   # Clean Express route declarations
│   │   ├── utils/                    # Distance calculators, timeout workers, audit logs
│   │   └── server.js                 # HTTP server entry point & background task workers
│   ├── prisma/
│   │   ├── schema.prisma             # PostgreSQL schema definition (Prisma)
│   │   ├── seed.js                   # Authoritative database seeder
│   │   └── pharmacy_details.csv      # Real participating pharmacy master data
│   ├── ocr/                          # Python ML OCR pipelines & Indian medicine lexicons
│   └── package.json                  # Backend dependencies & test scripts
│
├── .gitignore                        # Protection for environment files, tokens, and build artifacts
├── neon.ts                           # Cloud database connectivity definition
└── README.md                         # Project documentation
```

---

## ⚡ Quick Start / Local Development

### Prerequisites
* **Node.js**: v18.0.0 or higher (v20+ recommended)
* **npm**: v9.0.0 or higher
* **Git**: Installed and configured

### 1. Clone the Repository
```bash
git clone https://github.com/rahulx3-dev/Medifind-AI.git
cd Medifind-AI
```

### 2. Backend Setup
```bash
cd server
npm install

# Configure environment variables
cp .env.example .env
```

Ensure your `.env` contains your PostgreSQL connection string:
```env
DATABASE_URL="postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"
JWT_SECRET="generate_a_secure_random_string"
PORT=5000
NODE_ENV=development
```

Run database migrations and start the server:
```bash
npx prisma generate
npm run dev
```
*Backend API will run at `http://localhost:5000`.*

### 3. Frontend Setup
In a new terminal window:
```bash
cd client
npm install
npm run dev
```
*Frontend will run at `http://localhost:3000` with automated proxying to the backend.*

---

## 🌐 Production Cloud Deployment

### 1. Database (Neon Serverless PostgreSQL)
* Create a free PostgreSQL instance on **[Neon.tech](https://neon.tech)**.
* Copy your pooled and direct connection string into your backend environment configuration.

### 2. Backend (Render.com)
* Create a **New Web Service** connected to `rahulx3-dev/Medifind-AI`.
* **Root Directory**: `server`
* **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy`
* **Start Command**: `node src/server.js`
* **Environment Variables**:
  * `DATABASE_URL`: *(Your Neon PostgreSQL connection string)*
  * `JWT_SECRET`: *(Secure 32-byte cryptographic hex string)*
  * `NODE_ENV`: `production`
  * `PORT`: `5000`

### 3. Frontend (Vercel)
* Create a **New Project** connected to `rahulx3-dev/Medifind-AI`.
* **Root Directory**: `client`
* **Framework Preset**: `Vite`
* The included `client/vercel.json` automatically manages client-side SPA routing and transparently proxies API routes.

---

## 🧪 Automated Testing & Verification Suite

MediFind AI features comprehensive verification suites covering end-to-end user flows, security gates, and role transitions:

```bash
cd server
node test_phase1_assistant_redesign.js
```
```text
=============================================================
🧪 MediFind AI — Phase 1 Assistant Portal Redesign & Onboarding Test Suite
=============================================================
  PASS  serviceCatalogue module loaded
  PASS  Obsolete categories filtered from active delivery catalogue
  PASS  Mandatory first-time role selection prompt enforced
  PASS  Delivery Assistant profile setup without clinical certifications
  PASS  Healthcare Professional application strictly gates tasks as PENDING
  PASS  Role switching preserves security boundaries and clears tasks
  PASS  Zero-fraud 4-digit PIN verification confirmed

=============================================================
Phase 1 Verification Complete: 48 passed, 0 failed.
=============================================================
```

---

## 📜 Academic Disclaimer

> **Academic Project Notice**: MediFind AI is developed as an academic engineering demonstration. It is designed to assist in prescription interpretation, inventory discovery, and community logistics coordination. It does not replace professional medical advice, clinical diagnosis, or emergency healthcare services. All medicine dispensations require an authentic, signed doctor's prescription verified by an accredited registered pharmacist.

---

## 👨‍💻 Author & Maintainer

* **Repository**: [https://github.com/rahulx3-dev/Medifind-AI](https://github.com/rahulx3-dev/Medifind-AI)
* **Lead Developer**: [@rahulx3-dev](https://github.com/rahulx3-dev)
* **Institution**: Computer Science & Engineering
