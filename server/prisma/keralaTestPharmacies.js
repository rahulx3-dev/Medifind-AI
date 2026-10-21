/**
 * MediFind AI — Kerala Test Pharmacy Fixtures
 *
 * STATUS: TEST DATA — NONE OF THESE ARE PARTICIPATING PHARMACIES
 *
 * These are synthetic test records created for system development and testing only.
 * Coordinates are approximate town-center locations.
 * License numbers, phone numbers, ratings, and opening hours are fabricated.
 * No real pharmacy, pharmacist, or business is represented or implied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO ADD REAL APPROVED PHARMACIES:
 * Create a separate file `approvedPharmacies.js` (or import from a CSV/JSON)
 * using the IDENTICAL field structure below.
 * Then in seed.js, change:
 *   const { keralaTestPharmacies } = require('./keralaTestPharmacies');
 * to:
 *   const { approvedPharmacies } = require('./approvedPharmacies');
 * No other code changes are required.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Required fields for production import:
 *   name, licenseNumber, address, latitude, longitude, phone,
 *   isOpen, is24x7, isVerified, verificationStatus, rating,
 *   openingHours, managerEmail, isTestRecord, testDataNote
 */

const keralaTestPharmacies = [
  // ──────────────────────────────────────────────────────────────
  // TEST PHARMACY 1 — Chengannur town center area
  // Approximate coordinates only. NOT a real pharmacy location.
  // ──────────────────────────────────────────────────────────────
  {
    name: '[TEST] Chengannur Area Medical Store',
    licenseNumber: 'TEST-KL-CNG-001',            // NOT a real license number
    address: 'Chengannur Town Area, Alappuzha District, Kerala 689121 [TEST RECORD]',
    latitude: 9.3200,                             // Approximate town center
    longitude: 76.6160,
    phone: 'CONTACT-NOT-AVAILABLE',               // NOT a real phone number
    isOpen: true,                                 // Manual override flag
    is24x7: false,
    isVerified: false,
    verificationStatus: 'TEST',
    rating: 0.0,                                  // No real rating assigned
    openingHours: '9:00 AM - 9:00 PM',           // Synthetic — not verified
    managerEmail: 'pharmacist1@medifind.com',
    isTestRecord: true,
    testDataNote: 'TEST DATA — NOT A PARTICIPATING PHARMACY'
  },

  // ──────────────────────────────────────────────────────────────
  // TEST PHARMACY 2 — Haripad town area
  // Approximate coordinates only. NOT a real pharmacy location.
  // ──────────────────────────────────────────────────────────────
  {
    name: '[TEST] Haripad Area Pharmacy',
    licenseNumber: 'TEST-KL-HRP-002',            // NOT a real license number
    address: 'Haripad Town Area, Alappuzha District, Kerala 690514 [TEST RECORD]',
    latitude: 9.2350,
    longitude: 76.4700,
    phone: 'CONTACT-NOT-AVAILABLE',               // NOT a real phone number
    isOpen: true,
    is24x7: false,
    isVerified: false,
    verificationStatus: 'TEST',
    rating: 0.0,
    openingHours: '8:00 AM - 8:00 PM',           // Synthetic — not verified
    managerEmail: 'pharmacist2@medifind.com',
    isTestRecord: true,
    testDataNote: 'TEST DATA — NOT A PARTICIPATING PHARMACY'
  }
];

module.exports = { keralaTestPharmacies };
