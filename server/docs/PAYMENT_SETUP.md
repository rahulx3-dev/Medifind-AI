# MediFind AI — Phase 5.5 Payment & Checkout Setup Guide

> **ACADEMIC & DEMONSTRATION USE ONLY**  
> Never use live payment credentials or real money. Always operate in **Razorpay Test Mode**.

---

## 1. Overview

Phase 5.5 introduces a complete, backend-controlled payment and fulfillment billing workflow for MediFind AI without altering the existing order state machine or compromising Phase 1–5 privacy guarantees.

### Intended Flow:
1. Patient uploads & verifies prescription
2. Patient selects medicines & requests reservation at a chosen pharmacy
3. Pharmacy reviews & **confirms availability** (Order status: `CONFIRMED`)
4. Patient opens **Checkout** (`/checkout/:orderId`)
5. Patient selects **Fulfillment Method** (`PICKUP`, `DELIVERY`, or `ASSISTANT_DELIVERY`)
6. Backend calculates authoritative billing from snapshot prices + fulfillment fee
7. Patient initiates payment via **Razorpay Test Mode**
8. Backend verifies payment signature server-side
9. Payment status becomes `PAID`
10. Fulfillment progression is unlocked (e.g., `AssistantTask` becomes `AVAILABLE` for `ASSISTANT_DELIVERY`)

---

## 2. Environment Configuration

Add the following environment variables to `server/.env`:

```env
# Razorpay Test Credentials (Server-only)
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourKeySecretHere

# Configurable Fulfillment Fees (in INR)
DELIVERY_FEE_INR=50
ASSISTANT_DELIVERY_FEE_INR=80
```

### Obtaining Razorpay Test Credentials:
1. Sign up / Log in to [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Switch to **Test Mode** (toggle in the header or sidebar).
3. Navigate to **Account & Settings** → **API Keys**.
4. Generate Test API Key (`Key Id` and `Key Secret`).
5. Copy `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` into `server/.env`.

---

## 3. Security Rules Enforced

- **Server-Side Secret Isolation:** `RAZORPAY_KEY_SECRET` is strictly server-side and never returned in any API response or logged.
- **Server-Calculated Billing:** Order total is computed on the backend using the confirmed `OrderItem` unit prices snapshot + configured fulfillment fee. Frontend amount parameters are strictly ignored.
- **Server-Side Verification:** Razorpay signature (`crypto.createHmac('sha256', secret)`) is validated server-side. Frontend "success" callbacks are never trusted alone.
- **No Card/Sensitive Data Stored:** No card numbers, CVVs, expiry dates, or UPI PINs are ever requested, processed, or persisted.
- **No Offline Payment Queuing:** Payment creation, verification, and retry endpoints are excluded from the offline action queue. Payment strictly requires live internet connectivity.
- **Payment & Order Separation:** Payment status (`PENDING`, `PAID`, `FAILED`, `REFUNDED`) is stored in the `Payment` model and does not overwrite or corrupt the `Order` state machine (`PENDING`, `CONFIRMED`, `READY_FOR_PICKUP`, `COMPLETED`, `REJECTED`, `CANCELLED`).

---

## 4. Behavior When Credentials Are Not Configured

If `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` are not set in the environment:
- The server **does not crash**.
- The checkout summary continues to return the calculated billing totals.
- When attempting to initiate payment, the backend gracefully returns HTTP `503 Service Unavailable`:
  ```json
  {
    "success": false,
    "error": "Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server environment variables to enable online payments.",
    "configurationRequired": true
  }
  ```
- The frontend UI displays an informative alert explaining that test gateway credentials must be configured in `server/.env` to complete online payment.

---

## 5. Running the Phase 5.5 Test Suite

To run all 50 automated Phase 5.5 payment assertions:

```bash
cd server
node test_phase5_5_payment.js
```

### Running the Full Regression Suite:
```bash
# Phase 1: Security & RBAC (25 assertions)
node test_phase1_security.js

# Phase 2: OCR & Prescription Verification (25 assertions)
node test_phase2_ocr.js

# Phase 3: Kerala Network & Pharmacy Discovery (25 assertions)
node test_phase3_network.js

# Phase 4: Roles, Inventory & State Machine (37 assertions)
node test_phase4_roles.js

# Phase 5: Functional Completion & Offline Reliability (42 assertions)
node test_phase5_functional.js

# End-to-End System Flow
node test_e2e.js

# Phase 5.5: Payment, Checkout & Billing (50 assertions)
node test_phase5_5_payment.js
```
