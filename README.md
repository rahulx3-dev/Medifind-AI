# MediFind AI

### Intelligent Prescription-Based Medicine Availability and Emergency Pharmacy Locator System

MediFind AI is a web-based academic software system designed to help patients locate medicines through participating pharmacies using prescription-assisted medicine identification, pharmacy availability search, reservation workflows, and emergency access mechanisms.

The system combines local prescription OCR, patient verification, pharmacy inventory management, medicine reservation, fulfillment workflows, and a non-clinical Medicine Access Assistant service into a unified platform.

> **Academic Project:** MediFind AI is a final-year BTech Computer Science and Engineering project. It is intended for academic demonstration and evaluation and is not a replacement for professional medical advice, diagnosis, prescribing, treatment, or emergency medical services.

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Key Features](#key-features)
- [User Roles](#user-roles)
- [System Workflow](#system-workflow)
- [OCR and Prescription Verification](#ocr-and-prescription-verification)
- [Pharmacy and Medicine Availability](#pharmacy-and-medicine-availability)
- [Medicine Reservation](#medicine-reservation)
- [Medicine Access Assistant](#medicine-access-assistant)
- [Emergency Access Network](#emergency-access-network)
- [Pricing and Payments](#pricing-and-payments)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Testing and Quality](#testing-and-quality)
- [Security and Privacy](#security-and-privacy)
- [Current Limitations](#current-limitations)
- [Future Enhancements](#future-enhancements)
- [Academic Context](#academic-context)
- [Disclaimer](#disclaimer)

---

## Overview

Finding prescribed medicines can become difficult when a patient does not know which nearby pharmacies have the required medicines in stock.

MediFind AI addresses this problem through a workflow that allows a patient to:

1. Upload a prescription.
2. Extract possible medicine names using local OCR.
3. Review and verify the extracted medicines.
4. Search participating pharmacies.
5. Compare medicine availability.
6. Reserve medicines from a selected pharmacy.
7. Track the reservation and fulfillment process.
8. Use supported pickup, pharmacy delivery, or Medicine Access Assistant services.
9. Request restock notifications when a medicine is unavailable.
10. Use an offline SMS fallback for direct pharmacy availability inquiries.

The system provides separate interfaces for patients, pharmacists, Medicine Access Assistants, and administrators.

---

## Problem Statement

Patients may encounter several difficulties when trying to obtain prescribed medicines:

- Handwritten prescriptions can be difficult to read.
- Patients may not know which pharmacy has a particular medicine.
- Medicine availability differs between pharmacies.
- Patients may need assistance physically accessing a pharmacy.
- Emergency medicine availability can be difficult to determine.
- Medicine prices may not be available before visiting a pharmacy.
- Patients who are unable to complete an online workflow may need an offline fallback.

MediFind AI provides a structured software workflow connecting these activities while keeping the patient in control of prescription verification and medicine selection.

---

## Key Features

### Prescription Processing

- Prescription image upload
- Local OCR processing
- Medicine candidate extraction
- Confidence-aware OCR results
- Patient verification and editing
- Manual medicine mapping
- Prescription document integrity screening

### Medicine Discovery

- Medicine catalogue
- Medicine search
- Pharmacy-specific availability
- Availability-based pharmacy ranking
- Location-aware discovery when legitimate coordinates are available
- Availability explanations

### Pharmacy Workflows

- Participating pharmacy profiles
- Pharmacy inventory
- Reservation requests
- Reservation confirmation/rejection
- Inventory restoration after cancellation/rejection
- Pickup workflow
- Pharmacy delivery where supported

### Patient Features

- Patient authentication
- Prescription management
- Medicine search
- Cart
- Pharmacy discovery
- Reservation
- Order tracking
- Saved addresses
- Notifications
- Emergency access
- Restock requests

### Medicine Access Assistant

Patients can request a registered non-clinical Medicine Access Assistant for supported services such as:

- Medicine collection
- Pharmacy visit
- Pharmacy companion
- Medicine delivery assistance
- Digital assistance
- Pharmacy communication
- Restock assistance
- Prescription upload assistance

Assistant services are capability-based and require an explicitly selected assistant.

### Emergency Access

- Emergency pharmacy network
- Restock requests
- Availability notifications
- Offline pharmacy SMS fallback
- Direct telephone fallback

### Administration

- Administrative dashboard
- User management
- Pharmacy management
- Order monitoring
- Emergency workflow monitoring
- Inventory-related administration
- Privacy-aware administrative views

---

## User Roles

### Patient

Patients can:

- Upload prescriptions
- Verify OCR results
- Search medicines
- Find participating pharmacies
- Reserve medicines
- Select fulfillment options
- Track orders
- Manage addresses
- Request Medicine Access Assistant services
- Request restock notifications
- Use emergency fallback workflows

### Pharmacist

Pharmacists can:

- View pharmacy reservations
- Confirm or reject requests
- Manage inventory
- Update medicine availability
- Process pickup workflows
- Manage pharmacy-side order operations

### Medicine Access Assistant

The Medicine Access Assistant is a registered non-clinical assistance role.

Depending on the selected service, an assistant may:

- Visit a pharmacy
- Collect reserved medicine
- Accompany a patient to a pharmacy
- Deliver medicine through the assistance workflow
- Help with digital tasks
- Communicate with a pharmacy
- Assist with restock requests
- Assist with prescription uploading

The Assistant is **not a doctor, pharmacist, or medical professional by default**.

The Assistant does not:

- Diagnose medical conditions
- Prescribe medicines
- Change prescriptions
- Recommend treatments
- Interpret medical conditions
- Administer medication

### Administrator

Administrators can manage and monitor system-level operations while sensitive information is minimized according to role permissions.

---

## System Workflow

### Main Patient Workflow

```text
Prescription Upload
        ↓
Local OCR
        ↓
OCR Medicine Candidates
        ↓
Patient Verification
        ↓
Verified Medicine List
        ↓
Pharmacy Availability Search
        ↓
Pharmacy Ranking
        ↓
Pharmacy Selection
        ↓
Medicine Reservation
        ↓
Pharmacy Confirmation
        ↓
Fulfillment
        ↓
Handover / Completion
```

The OCR output is treated as a suggestion. The patient must verify the medicines before they are used for the main medicine-search and reservation workflow.

---

## OCR and Prescription Verification

MediFind AI uses a local OCR pipeline for prescription processing.

### OCR Pipeline

```text
Prescription Image
        ↓
Document Integrity Screening
        ↓
PaddleOCR
        ↓
Text Extraction
        ↓
Medicine Candidate Detection
        ↓
Confidence Evaluation
        ↓
Patient Verification
        ↓
Verified Medicines
```

The OCR system assists with extracting possible medicine names from prescription images.

OCR results are **not automatically treated as medically correct**.

The patient can:

- Accept detected medicines
- Edit detected medicine names
- Correct OCR mistakes
- Adjust relevant information
- Manually map medicines to the catalogue
- Add catalogue medicines when necessary

Only verified medicines continue into the availability and reservation workflow.

---

## Pharmacy and Medicine Availability

MediFind AI uses a participating-pharmacy network.

The current academic dataset contains participating pharmacy inventory records rather than a universal pharmacy database.

Pharmacy availability is evaluated using available inventory information.

When legitimate pharmacy coordinates are available, geographic distance can be used for discovery and ranking.

The system does not fabricate:

- Pharmacy coordinates
- Travel distance
- ETA
- Delivery routes
- Inventory quantities
- Medicine prices

### Current Participating Pharmacies

The current academic dataset contains:

- **Max Care Pharmacy**
- **Karuna Medicals**

A deactivated test fixture may exist for development/testing purposes but is not treated as an active participating pharmacy.

---

## Medicine Reservation

The reservation workflow is:

```text
Patient
   ↓
Select Pharmacy
   ↓
Reserve Medicine
   ↓
Pharmacy Receives Request
   ↓
Confirm / Reject
   ↓
Inventory Updated
   ↓
Fulfillment
```

Typical reservation states include:

```text
PENDING
CONFIRMED
REJECTED
CANCELLED
READY_FOR_PICKUP
COMPLETED
```

Inventory reserved for a confirmed order is restored when appropriate cancellation or rejection workflows occur.

---

## Medicine Access Assistant

Medicine Access Assistant services are separate from normal pharmacy delivery.

### Pharmacy Delivery

If a participating pharmacy supports delivery, the pharmacy itself fulfills the delivery.

### Medicine Access Assistant

The Assistant is a separate human assistance workflow where a selected assistant performs the requested non-clinical service.

```text
Patient
   ↓
Select Assistant
   ↓
Select Service
   ↓
Confirm Address When Required
   ↓
Assistant Accepts Task
   ↓
Service Execution
   ↓
Delivery / Completion
   ↓
Patient Confirms Handover
```

### Physical Assistant Services

Physical services may require a patient address, including:

- Medicine collection
- Pharmacy visit
- Pharmacy companion
- Medicine delivery assistance
- Restock assistance

### Non-physical Assistant Services

Some services do not require a physical delivery address, such as:

- Digital assistance
- Prescription upload assistance
- Pharmacy communication

The system protects prescription and sensitive medical information according to role and service requirements.

---

## Emergency Access Network

MediFind AI includes an Emergency Access pathway for situations where normal medicine discovery may not be sufficient.

### 1. Pharmacy Network

Searches participating pharmacies with emergency-related availability capabilities.

### 2. Restock Request

If a medicine is currently unavailable, a patient can request a notification when the medicine becomes available.

### 3. Offline Fallback

The system can prepare a direct SMS inquiry to a participating pharmacy.

The SMS is:

- User initiated
- Prepared by the application
- Opened through the device's messaging application
- Sent only after the user confirms it

The SMS does **not** create an online reservation or guarantee medicine availability.

For emergencies, users should contact appropriate emergency services rather than relying solely on the application.

---

## Pricing and Payments

MediFind AI does not fabricate medicine prices.

When a participating pharmacy does not provide a medicine price, the system displays a counter-pricing message such as:

> MRP / counter pricing at pharmacy

In such cases, the patient can continue with the applicable reservation workflow, but online medicine payment is not artificially created for an unknown price.

### Payment

Where supported, the system integrates Razorpay in **TEST MODE** for academic demonstration.

Production payment credentials must never be committed to the repository.

Platform and assistant fees are configuration-driven rather than hardcoded into the application interface.

---

## Technology Stack

### Frontend

- React 19
- React DOM
- Vite
- React Router
- Vanilla CSS
- Context / reducer-based application state

### Frontend Libraries

- Leaflet
- MapLibre GL
- Three.js
- OGL
- Motion
- GSAP
- Lenis
- Lucide React
- Radix UI
- Tailwind Merge
- Class Variance Authority
- Canvas Confetti

### Backend

- Node.js
- Express.js
- Prisma ORM
- SQLite
- JWT authentication
- bcrypt password hashing
- Multer

### OCR

- Python
- PaddleOCR
- PaddlePaddle

### Maps and Location

- Leaflet
- MapLibre GL
- OpenStreetMap
- Browser Geolocation API
- Haversine distance calculation where valid coordinates are available

### Payments

- Razorpay TEST MODE

### Communication

- Server-Sent Events / polling where implemented
- Browser Web Speech API for supported voice-search functionality
- Native SMS fallback through `sms:` links

---

## System Architecture

```text
                    ┌──────────────────────┐
                    │      User Browser    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    React + Vite      │
                    │      Frontend        │
                    └──────────┬───────────┘
                               │ HTTP / SSE
                               ▼
                    ┌──────────────────────┐
                    │   Express Backend    │
                    │ Authentication/RBAC  │
                    │ Orders / Pharmacy    │
                    │ Assistant / Emergency│
                    └───────┬──────┬───────┘
                            │      │
                ┌───────────┘      └─────────────┐
                ▼                                ▼
      ┌──────────────────┐             ┌──────────────────┐
      │ Prisma + SQLite  │             │   Local OCR      │
      │ Application Data │             │     Pipeline     │
      └──────────────────┘             │    PaddleOCR     │
                                       └──────────────────┘
```

---

## Project Structure

```text
Medifind-AI/
│
├── client/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.*
│
├── server/
│   ├── src/
│   ├── prisma/
│   ├── ocr/
│   ├── package.json
│   └── .env.example
│
├── .gitignore
├── README.md
└── project configuration files
```

The exact implementation structure may evolve as development continues.

---

## Local Development

### Prerequisites

Install:

- Git
- Node.js
- npm
- Python
- PaddleOCR/PaddlePaddle-compatible Python environment

### Clone the Repository

```bash
git clone https://github.com/rahulx3-dev/Medifind-AI.git
cd Medifind-AI
```

### Frontend Setup

The frontend is a Vite application.

```bash
cd client
npm install
```

Start the frontend development server:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Run the frontend lint command:

```bash
npm run lint
```

Preview a production frontend build:

```bash
npm run preview
```

### Backend Setup

The backend has its own package configuration and should be installed separately:

```bash
cd ../server
npm install
```

Use the server package scripts and environment configuration provided in the repository to initialize Prisma, configure the database, start the API server, and configure OCR.

### Environment Configuration

Copy the provided environment example:

**PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Linux/macOS:**

```bash
cp .env.example .env
```

Fill in the required local development values.

**Never commit `.env` files.**

### OCR Setup

The OCR pipeline uses a local Python environment.

Install the Python dependencies specified by the OCR configuration in the repository.

PaddleOCR model files and runtime dependencies are intentionally not committed to Git.

---

## Environment Variables

Only variable names are documented here. Never place actual secrets in this README.

Typical server configuration includes:

```text
PORT
DATABASE_URL
JWT_SECRET
CORS_ORIGIN
```

Payment configuration:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
```

Fulfillment configuration:

```text
DELIVERY_FEE_INR
ASSISTANT_SERVICE_FEE_INR
```

Additional OCR and application configuration should be taken from:

```text
server/.env.example
```

---

## Database

MediFind AI currently uses Prisma with SQLite.

```text
Prisma ORM
    ↓
SQLite
```

The database contains application entities including:

- Users
- Medicines
- Pharmacies
- Pharmacy inventory
- Orders
- Order items
- Notifications
- Prescriptions
- Patient addresses
- Assistant profiles
- Assistant tasks
- Restock requests
- Payments
- Order status history

The developer's local SQLite database is **not committed to GitHub**.

A fresh installation should use the project's Prisma migration and seed/initialization mechanisms rather than copying a local database file.

---

## Testing and Quality

MediFind AI has undergone extensive workflow, security, integration, and regression testing during development.

Tested areas include:

- Authentication
- Role authorization
- Prescription processing
- OCR verification
- Pharmacy workflows
- Inventory
- Reservations
- Order lifecycle
- Assistant lifecycle
- Handover verification
- Emergency workflows
- Restock notifications
- Offline SMS fallback
- Payment workflow
- Pricing integrity
- Privacy isolation
- Administrative access
- Responsive UI behavior
- Error and loading states

Testing results should be interpreted in the context of the academic implementation and test environment.

---

## Security and Privacy

MediFind AI implements role-based access controls and ownership checks to protect application data.

Security measures include:

- JWT authentication
- Password hashing with bcrypt
- Role-based authorization
- Ownership validation
- Prescription access protection
- Sensitive-field minimization
- Verification PIN protection
- Patient address protection
- Assistant medical-data isolation
- Authentication checks on protected endpoints
- Secret exclusion through `.gitignore`

Sensitive credentials are stored through environment variables rather than source code.

The project does not claim HIPAA, DPDP, GDPR, government, pharmacy-board, or other regulatory certification.

---

## Current Limitations

### Pharmacy Coverage

The system currently works with a limited participating-pharmacy dataset rather than a nationwide live pharmacy network.

### Pharmacy Delivery

Pharmacy delivery is only available when a participating pharmacy explicitly supports it.

### Pricing

Medicine prices may be unavailable because participating pharmacy inventory data does not necessarily provide pricing information.

### Location

Distance and map-based features depend on legitimate pharmacy coordinates being available.

The system does not fabricate coordinates, travel times, or delivery ETAs.

### OCR

Prescription OCR can make recognition errors, particularly with handwritten prescriptions.

Patient verification is therefore required.

### Emergency Availability

Emergency-capable participating pharmacies may not always be available in the current academic dataset.

---

## Future Enhancements

Potential future improvements include:

- Larger participating-pharmacy network
- Real-time pharmacy inventory synchronization
- Improved prescription OCR
- Multi-dataset medicine recognition
- Expanded location coverage
- Real-time pharmacy delivery tracking
- Additional payment providers
- Larger-scale notification infrastructure
- Production-grade cloud database
- Mobile applications
- Additional accessibility improvements
- Expanded emergency service integrations

These features are considered future work and are not necessarily part of the current implementation.

---

## Academic Context

MediFind AI was developed as a final-year BTech Computer Science and Engineering project.

The project combines:

- Optical Character Recognition
- Web application development
- Database management
- Role-based access control
- Pharmacy inventory management
- Location-aware search
- Reservation workflows
- Emergency access mechanisms
- Human-assisted medicine access

The objective is to demonstrate how these technologies can be combined into a structured medicine-access software system.

---

## Disclaimer

MediFind AI is an academic software system.

Medicine availability, pharmacy participation, pricing, and OCR results may change and must be independently verified.

The system does **not** provide:

- Medical diagnosis
- Prescription generation
- Treatment recommendations
- Dosage modification
- Medical interpretation

The Medicine Access Assistant provides non-clinical assistance only.

For medical emergencies, users should contact appropriate emergency medical services rather than relying solely on this application.

---

## License

No open-source license has currently been specified for this academic project.

All rights reserved unless otherwise stated by the project authors.
