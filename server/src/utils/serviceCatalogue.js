/**
 * MediFind AI — Structured Service Catalogue (Phase 1 Foundation)
 * Defines active delivery services, future healthcare professional categories, and obsolete legacy services.
 * 
 * Clinical services are FUTURE CANDIDATES ONLY: they require administrator review and verified
 * credentials (Phase 2/3) and are STRICTLY NOT BOOKABLE by patients in Phase 1.
 */

// 1. ACTIVE BOOKABLE SERVICES — Fulfilled by Delivery Assistants
const DELIVERY_SERVICE_TYPES = {
  MEDICINE_DELIVERY: {
    id: 'MEDICINE_DELIVERY',
    name: 'Medicine Delivery',
    category: 'DELIVERY',
    roleRequired: 'DELIVERY_ASSISTANT',
    bookable: true,
    requiresClinicalVerification: false,
    icon: 'home_pin',
    description: 'Collect reserved medicines from a participating pharmacy and deliver to the patient with secure PIN handover.',
    baseFee: 80
  },
  MEDICINE_COLLECTION: {
    id: 'MEDICINE_COLLECTION',
    name: 'Medicine Collection',
    category: 'DELIVERY',
    roleRequired: 'DELIVERY_ASSISTANT',
    bookable: true,
    requiresClinicalVerification: false,
    icon: 'medication',
    description: 'Collect patient’s reserved prescription medicine from the pharmacy and bring it to designated handover point.',
    baseFee: 80
  }
};

// 2. CLINICAL SERVICES — Structured categories for Healthcare Professionals (Phase 3 Active Marketplace)
const CLINICAL_SERVICE_TYPES = {
  NURSING_VISIT: {
    id: 'NURSING_VISIT',
    name: 'Nursing Visit',
    category: 'CLINICAL',
    roleRequired: 'HEALTHCARE_PROFESSIONAL',
    bookable: true,
    durationMinutes: 60,
    baseFee: 250,
    requiresPrescription: false,
    requiresClinicalVerification: true,
    requiredCredential: 'Registered Nurse (GNM / BSc Nursing) or licensed practitioner',
    approvedScope: 'In-home patient observation, general wellness evaluation, and basic nursing advice within legal scope.',
    preparationInfo: 'Please have the patient resting in a clean, quiet area with previous medical records or discharge papers ready.',
    consentNotice: 'I understand this nursing visit is for monitoring and wellness observation, not for emergency care or physician diagnosis.',
    disclaimer: 'Does not include diagnosis, prescription, or invasive clinical procedures.',
    icon: 'medical_services'
  },
  VITAL_SIGN_MEASUREMENT: {
    id: 'VITAL_SIGN_MEASUREMENT',
    name: 'Vital-Sign Measurement',
    category: 'CLINICAL',
    roleRequired: 'HEALTHCARE_PROFESSIONAL',
    bookable: true,
    durationMinutes: 30,
    baseFee: 150,
    requiresPrescription: false,
    requiresClinicalVerification: true,
    requiredCredential: 'Registered Nurse / Certified Healthcare Worker',
    approvedScope: 'Recording blood pressure, blood glucose, heart rate, pulse oximetry, and temperature.',
    preparationInfo: 'Ensure patient has been seated quietly for at least 5-10 minutes prior to vital signs assessment. Avoid caffeine or strenuous activity 30 minutes before.',
    consentNotice: 'I acknowledge that vital sign measurements are recorded for monitoring purposes and do not replace emergency clinical assessment.',
    disclaimer: 'Measurements are for monitoring only; emergency conditions must be directed to emergency care.',
    icon: 'vital_signs'
  },
  POST_HOSPITAL_CARE: {
    id: 'POST_HOSPITAL_CARE',
    name: 'Post-Hospital Care Support',
    category: 'CLINICAL',
    roleRequired: 'HEALTHCARE_PROFESSIONAL',
    bookable: true,
    durationMinutes: 90,
    baseFee: 350,
    requiresPrescription: true, // Requires discharge summary or physician follow-up order
    requiresClinicalVerification: true,
    requiredCredential: 'Registered Nurse with post-operative or discharge care experience',
    approvedScope: 'Bedside mobility support, scheduled hydration reminders, and patient recovery monitoring per hospital discharge instructions.',
    preparationInfo: 'A valid hospital discharge summary or physician follow-up instructions must be provided and available during the visit.',
    consentNotice: 'I confirm that a valid hospital discharge summary or physician recommendation exists and will be made available to the visiting nurse.',
    disclaimer: 'Follows discharge summary guidelines; does not modify physician orders.',
    icon: 'local_hospital'
  },
  WOUND_CARE_ASSISTANCE: {
    id: 'WOUND_CARE_ASSISTANCE',
    name: 'Eligible Wound-Care Assistance',
    category: 'CLINICAL',
    roleRequired: 'HEALTHCARE_PROFESSIONAL',
    bookable: true,
    durationMinutes: 45,
    baseFee: 200,
    requiresPrescription: true, // Requires valid clinician order/dressing protocol
    requiresClinicalVerification: true,
    requiredCredential: 'Registered Nurse with aseptic wound dressing certification',
    approvedScope: 'Superficial dressing change and sterile wound cleaning per physician instructions.',
    preparationInfo: 'Prescribing doctor’s wound dressing protocol and prescribed sterile dressing supplies must be available on site.',
    consentNotice: 'I confirm that this wound care service is authorized by a licensed clinician and that superficial dressing materials are available.',
    disclaimer: 'High-risk surgical or deep debridement wounds must be treated in clinical facilities.',
    icon: 'healing'
  },
  HOME_NURSING_SUPPORT: {
    id: 'HOME_NURSING_SUPPORT',
    name: 'Home Nursing Support',
    category: 'CLINICAL',
    roleRequired: 'HEALTHCARE_PROFESSIONAL',
    bookable: true,
    durationMinutes: 120,
    baseFee: 400,
    requiresPrescription: false,
    requiresClinicalVerification: true,
    requiredCredential: 'Registered Nurse / Aux Nurse Midwife (ANM / GNM)',
    approvedScope: 'Elderly care assistance, palliative comfort measures, and mobility aid.',
    preparationInfo: 'Comfortable seating or bed arrangement, clean drinking water, and standard assistance guidelines.',
    consentNotice: 'I understand this service is for non-prescriptive, supportive home nursing and elderly assistance only.',
    disclaimer: 'Non-prescriptive care only.',
    icon: 'health_and_safety'
  }
};

// Backward-compatible alias
const FUTURE_CLINICAL_SERVICE_TYPES = CLINICAL_SERVICE_TYPES;

// 3. OBSOLETE GENERIC NON-CLINICAL CATEGORIES (Section 7)
// Removed from patient booking. Preserved ONLY for historical order/task display.
const OBSOLETE_SERVICE_TYPES = {
  DIGITAL_ASSISTANCE: {
    id: 'DIGITAL_ASSISTANCE',
    name: 'Digital Assistance',
    category: 'OBSOLETE',
    isObsolete: true,
    bookable: false,
    reason: 'Generic digital assistance is not a physical, human-performed service.'
  },
  PRESCRIPTION_ASSISTANCE: {
    id: 'PRESCRIPTION_ASSISTANCE',
    name: 'Prescription Upload Assistance',
    category: 'OBSOLETE',
    isObsolete: true,
    bookable: false,
    reason: 'Separately bookable prescription upload is redundant with app OCR upload.'
  },
  PHARMACY_COMMS: {
    id: 'PHARMACY_COMMS',
    name: 'Pharmacy Communication',
    category: 'OBSOLETE',
    isObsolete: true,
    bookable: false,
    reason: 'Generic communication is automated through pharmacy notifications and SMS.'
  },
  RESTOCK_ASSISTANCE: {
    id: 'RESTOCK_ASSISTANCE',
    name: 'Restock Assistance',
    category: 'OBSOLETE',
    isObsolete: true,
    bookable: false,
    reason: 'Emergency restock is handled through the dedicated Emergency Access Network.'
  }
};

// 4. EXPLICITLY PROHIBITED / HIGH-RISK CLINICAL PROCEDURES (Section 6)
// These services CANNOT be approved or activated merely by adding them to a list.
const HIGH_RISK_CLINICAL_SERVICES = {
  INJECTION_ADMINISTRATION: {
    id: 'INJECTION_ADMINISTRATION',
    name: 'Injection Administration',
    category: 'HIGH_RISK_PROHIBITED',
    isProhibited: true,
    reason: 'Invasive parenteral medication administration requires direct physician supervision and emergency anaphylaxis management.'
  },
  INTRAVENOUS_THERAPY: {
    id: 'INTRAVENOUS_THERAPY',
    name: 'Intravenous (IV) Infusion Therapy',
    category: 'HIGH_RISK_PROHIBITED',
    isProhibited: true,
    reason: 'Intravenous cannulation and fluid infusions carry severe risks of circulatory overload, phlebitis, and infection.'
  },
  INVASIVE_WOUND_CARE: {
    id: 'INVASIVE_WOUND_CARE',
    name: 'Invasive Wound Debridement',
    category: 'HIGH_RISK_PROHIBITED',
    isProhibited: true,
    reason: 'Deep surgical wound debridement must be performed in clinical healthcare facilities with surgical sterile fields.'
  },
  MEDICATION_PRESCRIPTION: {
    id: 'MEDICATION_PRESCRIPTION',
    name: 'Drug Prescribing & Dosing Modification',
    category: 'HIGH_RISK_PROHIBITED',
    isProhibited: true,
    reason: 'Prescribing medications or altering pharmaceutical dosages is restricted by law to registered medical practitioners.'
  }
};

// 5. SUPPORTED HEALTHCARE PROFESSIONS
const SUPPORTED_HEALTHCARE_PROFESSIONS = [
  'Registered Nurse (RN)',
  'General Nurse & Midwife (GNM)',
  'Auxiliary Nurse Midwife (ANM)',
  'Clinical Care Nurse',
  'Physical Therapy Assistant',
  'Certified Healthcare Assistant'
];

// 6. SUPPORTED VERIFICATION DOCUMENT TYPES
const SUPPORTED_DOCUMENT_TYPES = {
  REGISTRATION_CERTIFICATE: {
    id: 'REGISTRATION_CERTIFICATE',
    name: 'State Nursing / Healthcare Council Registration Certificate',
    required: true,
    description: 'Official certificate from Kerala Nurses and Midwives Council (KNMC), Indian Nursing Council (INC), or equivalent state registration board.'
  },
  DEGREE_CERTIFICATE: {
    id: 'DEGREE_CERTIFICATE',
    name: 'Nursing / Healthcare Degree or Diploma Certificate',
    required: true,
    description: 'Recognized academic certificate (B.Sc Nursing, Post Basic B.Sc, GNM, or ANM diploma).'
  },
  ID_PROOF: {
    id: 'ID_PROOF',
    name: 'Government Photo ID Proof',
    required: true,
    description: 'Valid official government identification (Voter ID, Passport, or Driving Licence) to verify applicant identity without mandating Aadhaar.'
  },
  EXPERIENCE_CERTIFICATE: {
    id: 'EXPERIENCE_CERTIFICATE',
    name: 'Clinical Experience Certificate / Hospital Letter',
    required: false,
    description: 'Letter of clinical employment or hospital ward experience demonstrating practical background.'
  }
};

// 7. APPLICATION LIFECYCLE STATUSES
const APPLICATION_STATUSES = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEEDS_CORRECTION: 'NEEDS_CORRECTION',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

// All known service types for backward-compatible parsing and schema integrity
const ALL_KNOWN_SERVICE_TYPES = [
  ...Object.keys(DELIVERY_SERVICE_TYPES),
  ...Object.keys(FUTURE_CLINICAL_SERVICE_TYPES),
  ...Object.keys(OBSOLETE_SERVICE_TYPES),
  'PHARMACY_VISIT',
  'PHARMACY_COMPANION'
];

/**
 * Check if a clinical service is actively bookable by patients
 */
function isBookableClinicalService(serviceType) {
  if (!serviceType) return false;
  return Boolean(CLINICAL_SERVICE_TYPES[serviceType]?.bookable);
}

/**
 * Check if a service is actively bookable by patients (delivery or clinical)
 */
function isBookableService(serviceType) {
  if (!serviceType) return false;
  return Boolean(DELIVERY_SERVICE_TYPES[serviceType]?.bookable || CLINICAL_SERVICE_TYPES[serviceType]?.bookable);
}

/**
 * Check if a service is obsolete/deprecated for new bookings
 */
function isObsoleteService(serviceType) {
  if (!serviceType) return false;
  return Boolean(OBSOLETE_SERVICE_TYPES[serviceType]);
}

/**
 * Check if a service is a supported candidate clinical category
 */
function isClinicalService(serviceType) {
  if (!serviceType) return false;
  return Boolean(CLINICAL_SERVICE_TYPES[serviceType]);
}

/**
 * Check if a service is explicitly high-risk or prohibited
 */
function isHighRiskService(serviceType) {
  if (!serviceType) return false;
  return Boolean(HIGH_RISK_CLINICAL_SERVICES[serviceType]);
}

function isDeliveryService(serviceType) {
  if (!serviceType) return false;
  return Boolean(DELIVERY_SERVICE_TYPES[serviceType]);
}

/**
 * Validates a list of service categories for administrator approval.
 * Rejects high-risk, obsolete, or unknown categories.
 */
function validateServiceApprovalCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { valid: false, error: 'At least one service category must be selected for approval.' };
  }

  const approvedList = [];
  for (const cat of categories) {
    if (isHighRiskService(cat)) {
      return {
        valid: false,
        error: `Category '${cat}' is high-risk or prohibited (${HIGH_RISK_CLINICAL_SERVICES[cat].name}) and cannot be approved.`
      };
    }
    if (isObsoleteService(cat)) {
      return {
        valid: false,
        error: `Category '${cat}' is obsolete and cannot be approved.`
      };
    }
    if (!CLINICAL_SERVICE_TYPES[cat] && !DELIVERY_SERVICE_TYPES[cat]) {
      return {
        valid: false,
        error: `Category '${cat}' is not a recognized service category.`
      };
    }
    approvedList.push(cat);
  }

  return { valid: true, approvedCategories: [...new Set(approvedList)] };
}

module.exports = {
  DELIVERY_SERVICE_TYPES,
  CLINICAL_SERVICE_TYPES,
  FUTURE_CLINICAL_SERVICE_TYPES,
  HIGH_RISK_CLINICAL_SERVICES,
  OBSOLETE_SERVICE_TYPES,
  SUPPORTED_HEALTHCARE_PROFESSIONS,
  SUPPORTED_DOCUMENT_TYPES,
  APPLICATION_STATUSES,
  ALL_KNOWN_SERVICE_TYPES,
  SERVICE_CATALOGUE: {
    ...DELIVERY_SERVICE_TYPES,
    ...CLINICAL_SERVICE_TYPES,
    ...OBSOLETE_SERVICE_TYPES
  },
  isBookableService,
  isBookableClinicalService,
  isObsoleteService,
  isClinicalService,
  isHighRiskService,
  isDeliveryService,
  validateServiceApprovalCategories
};

