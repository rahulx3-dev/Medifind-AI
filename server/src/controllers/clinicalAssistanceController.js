'use strict';

/**
 * MediFind AI — Clinical Assistance Controller (Gate 7 & Gate 8)
 *
 * Implements the human-operated professional clinical assistance workflow:
 * - Patient concerns in Malayalam, English, or Hindi
 * - Speech or text input with transcript review and editing
 * - Strict preservation of original text and language (no overwriting)
 * - Safe emergency triage with immediate guidance (108/112)
 * - Server-side pharmacy eligibility check and initial 2-pharmacy routing (Gate 8)
 * - Timeout escalation to additional eligible pharmacies (Gate 8)
 * - Authorized pharmacy response workflow and status transitions (Gate 8)
 * - Separation from prescription ordering and delivery assistants
 * - Human-only clinical review: no automated diagnosis or prescribing
 */

const prisma = require('../prisma');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendIdempotentNotification } = require('../utils/notificationDispatcher');
const { calculateDistance } = require('../utils/distance');

const VOICE_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/voice');
if (!fs.existsSync(VOICE_UPLOADS_DIR)) {
  try {
    fs.mkdirSync(VOICE_UPLOADS_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not create voice uploads dir:', e.message);
  }
}

function saveVoiceAudioFile(requestId, voiceAudioBase64) {
  if (!voiceAudioBase64 || typeof voiceAudioBase64 !== 'string') return null;
  try {
    let ext = 'webm';
    let base64Data = voiceAudioBase64;
    const matches = voiceAudioBase64.match(/^data:audio\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (matches) {
      ext = matches[1] || 'webm';
      base64Data = matches[2];
    }
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `clinical_voice_${requestId}_${Date.now()}.${ext}`;
    const filePath = path.join(VOICE_UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return `/api/clinical-assistance/${requestId}/voice`;
  } catch (err) {
    console.error('Error saving clinical voice audio file:', err);
    return null;
  }
}

// Response timeout configuration: 15 minutes default for professional review
const PHARMACY_RESPONSE_TIMEOUT_MINUTES = 15;

// Multilingual emergency detection patterns (Malayalam, Hindi, English)
const EMERGENCY_PATTERNS = [
  // English
  /\b(chest pain|chest tightness|heart attack|cardiac arrest|cannot breathe|can't breathe|breathlessness|shortness of breath|unconscious|fainted|severe bleeding|stroke|seizure|choking|anaphylaxis|poisoning|overdose)\b/i,
  // Malayalam transliterated / keywords
  /(നെഞ്ചുവേദന|ശ്വാസതടസ്സം|ബോധക്ഷയം|രക്തസ്രാവം|ഹൃദയാഘാതം|സ്ട്രോക്ക്|ശ്വാസം മുട്ടൽ|nenju vedana|swasathadam)/i,
  // Hindi transliterated / keywords
  /(सीने में दर्द|सांस लेने में तकलीफ|बेहोश|दिल का दौरा|खून बहना|दौरा|seene mein dard|saans lene me takleef|behosh)/i
];

const EMERGENCY_GUIDANCE_TEXT = 
  '🚨 URGENT CLINICAL NOTICE: Based on the symptoms described, this may require immediate emergency medical care. ' +
  'Please immediately call 108 (Ambulance) or 112 (National Emergency), or proceed to the nearest hospital casualty or emergency department. ' +
  'Do NOT wait for a clinician to respond to this request.';

const VALID_CLINICAL_FOLLOW_UP_STATES = [
  'RESOLVED',
  'NEEDS_MORE_HELP',
  'PURCHASED_ELSEWHERE',
  'NOT_PURCHASED'
];

/**
 * Extracts and strictly validates follow-up state and timestamp from internalNotes
 */
function extractClinicalFollowUpTag(notes) {
  if (!notes || typeof notes !== 'string') {
    return { followUpState: null, followUpRespondedAt: null };
  }
  const m = notes.match(/\[FOLLOW_UP:([A-Z_]+)(?::([^\]]+))?\]/);
  if (!m) {
    return { followUpState: null, followUpRespondedAt: null };
  }
  const state = m[1];
  if (!VALID_CLINICAL_FOLLOW_UP_STATES.includes(state)) {
    return { followUpState: null, followUpRespondedAt: null };
  }
  let respondedAt = null;
  if (m[2]) {
    const parsed = new Date(m[2]);
    if (!isNaN(parsed.getTime())) {
      respondedAt = parsed.toISOString();
    }
  }
  return { followUpState: state, followUpRespondedAt: respondedAt };
}

/**
 * Extracts follow-up status, voice audio URL, and recommended medication metadata from internalNotes
 */
function extractClinicalMetadata(notes, requestId) {
  const followUp = extractClinicalFollowUpTag(notes);
  let recommendedMedicine = null;
  let voiceAudioUrl = null;
  let hasVoiceMessage = false;

  if (notes && typeof notes === 'string') {
    // Extract [RECOMMENDED_MEDICINE:...]
    const medMatch = notes.match(/\[RECOMMENDED_MEDICINE:(\{.*?\})\]/);
    if (medMatch && medMatch[1]) {
      try {
        recommendedMedicine = JSON.parse(medMatch[1]);
      } catch (e) {
        console.warn('Failed to parse recommended medicine metadata:', e.message);
      }
    }

    // Extract [VOICE_AUDIO:...]
    const voiceMatch = notes.match(/\[VOICE_AUDIO:([^\]]+)\]/);
    if (voiceMatch && voiceMatch[1]) {
      hasVoiceMessage = true;
      voiceAudioUrl = voiceMatch[1];
    }
  }

  // Also check if a physical voice file exists on disk
  if (!voiceAudioUrl && requestId && fs.existsSync(VOICE_UPLOADS_DIR)) {
    try {
      const files = fs.readdirSync(VOICE_UPLOADS_DIR).filter(f => f.startsWith(`clinical_voice_${requestId}_`));
      if (files.length > 0) {
        voiceAudioUrl = `/api/clinical-assistance/${requestId}/voice`;
        hasVoiceMessage = true;
      }
    } catch (_) {}
  }

  return {
    followUpState: followUp.followUpState,
    followUpRespondedAt: followUp.followUpRespondedAt,
    recommendedMedicine,
    voiceAudioUrl,
    hasVoiceMessage
  };
}


/**
 * Checks if the text contains acute emergency indicators
 */
function detectEmergencySymptoms(text) {
  if (!text || typeof text !== 'string') return false;
  return EMERGENCY_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Generate human-readable request number: HCA-YYYYMMDD-XXXX
 */
function generateRequestNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `HCA-${dateStr}-${rand}`;
}

/**
 * Gate 8: Determine Eligible Pharmacies
 * Rules:
 *  - Must be an active pharmacy (`isOpen === true`).
 *  - Must be verified (`isVerified === true` and `verificationStatus === 'VERIFIED'`).
 *  - Must have an assigned manager/professional (`managerId` exists).
 *  - Location proximity if coordinates provided; otherwise reliable participating nodes.
 *  - Excludes pharmacies that have already been assigned to this request.
 */
async function findEligiblePharmacies(db, { excludePharmacyIds = [], patientLat, patientLon, limit = 2 } = {}) {
  const pharmacies = await db.pharmacy.findMany({
    where: {
      isOpen: true,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      id: { notIn: excludePharmacyIds }
    },
    include: {
      manager: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    }
  });

  // Strict check: only pharmacies with a valid registered manager/professional are eligible
  const eligibleWithManager = pharmacies.filter(p => p.managerId != null && p.manager != null);

  // Calculate distance if patient coordinates are valid numbers
  const scored = eligibleWithManager.map(p => {
    let distanceKm = 999.9;
    if (patientLat != null && patientLon != null && p.latitude != null && p.longitude != null) {
      distanceKm = calculateDistance(patientLat, patientLon, p.latitude, p.longitude);
    }
    return {
      pharmacy: p,
      distanceKm
    };
  });

  // Sort by distance (if coordinates available) then by rating descending
  scored.sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return (b.pharmacy.rating || 0) - (a.pharmacy.rating || 0);
  });

  return scored.slice(0, limit).map(s => s.pharmacy);
}

/**
 * Route request to eligible pharmacies (Initial dispatch: up to 2 genuine pharmacies; escalation: 1 pharmacy)
 */
async function routeRequestToEligiblePharmacies(db, request, { patientLat, patientLon, round = 1, limit = (round === 1 ? 2 : 1) } = {}) {
  // Check existing assignments to prevent duplicates
  const existingAssignments = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: request.id }
  });
  const assignedIds = existingAssignments.map(a => a.pharmacyId);

  // Safeguard: If this round was already dispatched (or if round 1 retry when already has assignments)
  const roundAssignments = existingAssignments.filter(a => a.round === round);
  if (roundAssignments.length > 0) {
    return {
      success: true,
      dispatchedCount: 0,
      assignedPharmacies: [],
      routingStatus: 'ALREADY_DISPATCHED'
    };
  }

  // If already dispatched in this round or active, avoid duplicate dispatch
  const eligible = await findEligiblePharmacies(db, {
    excludePharmacyIds: assignedIds,
    patientLat,
    patientLon,
    limit
  });

  if (!eligible || eligible.length === 0) {
    return {
      success: true,
      dispatchedCount: 0,
      assignedPharmacies: [],
      routingStatus: assignedIds.length > 0 ? 'PARTIALLY_ROUTED' : 'NO_MATCH_PENDING'
    };
  }

  const newAssignments = [];
  for (const ph of eligible) {
    // Atomic concurrency guard: verify current count in database before inserting
    const currentAssignmentsInRound = await db.clinicalAssistanceAssignment.findMany({
      where: { requestId: request.id, round }
    });
    if (currentAssignmentsInRound.length >= limit) {
      break;
    }

    try {
      const assignment = await db.clinicalAssistanceAssignment.create({
        data: {
          requestId: request.id,
          pharmacyId: ph.id,
          round,
          status: 'ASSIGNED',
          assignedAt: new Date()
        }
      });
      newAssignments.push(assignment);

      // Dispatch idempotent notification to the pharmacy manager/pharmacist
      if (ph.managerId) {
        await sendIdempotentNotification(db, {
          userId: ph.managerId,
          title: `New Clinical Assistance Request: ${request.requestNumber}`,
          message: `A patient has submitted a clinical concern (${request.language.toUpperCase()}). Please review and provide professional advice.`,
          type: 'INFO',
          linkUrl: `/pharmacist?tab=clinical-requests&requestId=${request.id}`,
          dedupWindowMs: 30 * 60 * 1000
        });
      }
    } catch (err) {
      // In case of race condition / unique constraint, ignore duplicate assignment safely
      console.warn(`Assignment for pharmacy ${ph.id} skipped or already exists:`, err.message);
    }
  }

  // Update request status to UNDER_REVIEW if it was SUBMITTED
  if (request.status === 'SUBMITTED' && newAssignments.length > 0) {
    await db.clinicalAssistanceRequest.update({
      where: { id: request.id },
      data: { status: 'UNDER_REVIEW' }
    });
  }

  return {
    success: true,
    dispatchedCount: newAssignments.length,
    assignedPharmacies: eligible.map(p => ({ id: p.id, name: p.name })),
    routingStatus: 'DISPATCHED'
  };
}

/**
 * POST /api/clinical-assistance
 * Submit a human clinical assistance request and perform server-side routing
 */
async function submitClinicalRequest(req, res) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Patients only can submit clinical concerns
    if (userRole !== 'PATIENT') {
      return res.status(403).json({
        success: false,
        error: 'Only patients can submit human clinical assistance requests.'
      });
    }

    const { concernText, language = 'en', inputMethod = 'TEXT', latitude, longitude } = req.body;

    if (!concernText || typeof concernText !== 'string' || !concernText.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please describe your health concern before submitting.'
      });
    }

    const trimmedText = concernText.trim();
    if (trimmedText.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least 5 characters describing your health concern.'
      });
    }

    // Supported languages: 'en' (English), 'ml' (Malayalam), 'hi' (Hindi)
    const validLanguages = ['en', 'ml', 'hi'];
    const selectedLanguage = validLanguages.includes(language.toLowerCase()) ? language.toLowerCase() : 'en';

    // Supported input methods: 'TEXT', 'VOICE'
    const validInputMethods = ['TEXT', 'VOICE'];
    const method = validInputMethods.includes(inputMethod.toUpperCase()) ? inputMethod.toUpperCase() : 'TEXT';

    // Emergency check
    const isEmergency = detectEmergencySymptoms(trimmedText);
    const emergencyGuidance = isEmergency ? EMERGENCY_GUIDANCE_TEXT : null;

    const requestNumber = generateRequestNumber();

    // Create the request in DB
    const request = await prisma.clinicalAssistanceRequest.create({
      data: {
        requestNumber,
        patientId: userId,
        language: selectedLanguage,
        originalText: trimmedText,
        translatedText: null, // Preserved separately if translated by verified service; never fabricated
        inputMethod: method,
        status: 'SUBMITTED',
        isEmergency,
        emergencyGuidance,
        clinicianResponse: null // Never fabricate a response
      }
    });

    // If emergency, send high-priority notification to patient immediately
    if (isEmergency) {
      try {
        await sendIdempotentNotification(prisma, {
          userId,
          title: `🚨 Emergency Medical Guidance: ${requestNumber}`,
          message: EMERGENCY_GUIDANCE_TEXT,
          type: 'EMERGENCY',
          linkUrl: `/healthcare?tab=clinical-assistance&requestId=${request.id}`,
          dedupWindowMs: 60 * 60 * 1000
        });
      } catch (notifErr) {
        console.error('Failed to dispatch emergency notification:', notifErr.message);
      }
    }

    // Gate 8: Route request to up to 2 genuinely eligible participating pharmacies
    const patientLat = typeof latitude === 'number' ? latitude : null;
    const patientLon = typeof longitude === 'number' ? longitude : null;

    let routingResult = { dispatchedCount: 0, assignedPharmacies: [], routingStatus: 'NO_MATCH_PENDING' };
    try {
      routingResult = await routeRequestToEligiblePharmacies(prisma, request, {
        patientLat,
        patientLon,
        round: 1
      });
    } catch (routeErr) {
      console.error('Initial routing failed safely:', routeErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Your health concern has been submitted for review by a qualified healthcare professional.',
      routing: routingResult,
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        language: request.language,
        originalText: request.originalText,
        translatedText: request.translatedText,
        inputMethod: request.inputMethod,
        status: routingResult.dispatchedCount > 0 ? 'UNDER_REVIEW' : request.status,
        isEmergency: request.isEmergency,
        emergencyGuidance: request.emergencyGuidance,
        clinicianResponse: request.clinicianResponse,
        respondedAt: request.respondedAt,
        createdAt: request.createdAt
      }
    });
  } catch (error) {
    console.error('Error submitting clinical assistance request:', error);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while processing your request. Please try again.'
    });
  }
}

/**
 * GET /api/clinical-assistance/my-requests
 * Retrieve all clinical assistance requests for the authenticated patient
 */
async function getPatientClinicalRequests(req, res) {
  try {
    const userId = req.user?.id;
    if (req.user?.role !== 'PATIENT') {
      return res.status(403).json({
        success: false,
        error: 'Only patients can access their clinical assistance history.'
      });
    }

    const requests = await prisma.clinicalAssistanceRequest.findMany({
      where: { patientId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        requestNumber: true,
        language: true,
        originalText: true,
        translatedText: true,
        inputMethod: true,
        status: true,
        isEmergency: true,
        emergencyGuidance: true,
        clinicianResponse: true,
        respondedAt: true,
        internalNotes: true,
        createdAt: true,
        assignments: {
          where: { status: 'RESPONDED' },
          select: {
            pharmacy: {
              select: {
                id: true,
                name: true,
                phone: true,
                address: true
              }
            }
          }
        },
        respondedBy: {
          select: {
            name: true,
            pharmacy: {
              select: {
                id: true,
                name: true,
                phone: true,
                address: true
              }
            },
            assistantProfile: {
              select: {
                professionTitle: true,
                qualifications: true
              }
            }
          }
        }
      }
    });

    const sanitized = requests.map(r => {
      const meta = extractClinicalMetadata(r.internalNotes, r.id);
      const pharmacy = r.assignments?.[0]?.pharmacy || r.respondedBy?.pharmacy || null;
      const { internalNotes, assignments, ...safe } = r;
      return {
        ...safe,
        followUpState: meta.followUpState,
        followUpRespondedAt: meta.followUpRespondedAt,
        voiceAudioUrl: meta.voiceAudioUrl,
        hasVoiceMessage: meta.hasVoiceMessage,
        recommendedMedicine: meta.recommendedMedicine ? {
          ...meta.recommendedMedicine,
          pharmacyId: meta.recommendedMedicine.pharmacyId || pharmacy?.id || null,
          pharmacyName: meta.recommendedMedicine.pharmacyName || pharmacy?.name || 'Local Dispensary'
        } : null,
        respondingPharmacy: pharmacy
      };
    });

    return res.json({
      success: true,
      requests: sanitized
    });
  } catch (error) {
    console.error('Error fetching patient clinical requests:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve clinical assistance requests.'
    });
  }
}

/**
 * Gate 8: GET /api/clinical-assistance/pharmacy-queue
 * Retrieve clinical assistance requests assigned to the authenticated pharmacist's pharmacy
 */
async function getPharmacyClinicalQueue(req, res) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (userRole !== 'PHARMACIST' && userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Only registered pharmacists or administrators can access the pharmacy clinical queue.'
      });
    }

    let pharmacyId = null;
    if (userRole === 'PHARMACIST') {
      const pharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: userId }
      });
      if (!pharmacy) {
        return res.status(404).json({
          success: false,
          error: 'No pharmacy registered for this pharmacist account.'
        });
      }
      pharmacyId = pharmacy.id;
    }

    const whereClause = pharmacyId
      ? { pharmacyId }
      : {}; // Admin sees all assignments

    const assignments = await prisma.clinicalAssistanceAssignment.findMany({
      where: whereClause,
      orderBy: { assignedAt: 'desc' },
      include: {
        request: {
          select: {
            id: true,
            requestNumber: true,
            language: true,
            originalText: true,
            translatedText: true,
            inputMethod: true,
            status: true,
            isEmergency: true,
            emergencyGuidance: true,
            clinicianResponse: true,
            respondedAt: true,
            createdAt: true,
            patient: {
              select: {
                name: true
              }
            }
          }
        },
        pharmacy: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return res.json({
      success: true,
      queue: assignments.map(a => ({
        assignmentId: a.id,
        pharmacyId: a.pharmacyId,
        pharmacyName: a.pharmacy.name,
        assignmentStatus: a.status,
        round: a.round,
        assignedAt: a.assignedAt,
        openedAt: a.openedAt,
        request: a.request
      }))
    });
  } catch (error) {
    console.error('Error fetching pharmacy clinical queue:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve clinical review queue.'
    });
  }
}

/**
 * GET /api/clinical-assistance/:id
 * Retrieve a specific clinical assistance request by ID with strict ownership/role boundaries
 */
async function getClinicalRequestById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Delivery Assistants are strictly forbidden from viewing clinical records
    if (userRole === 'ASSISTANT') {
      return res.status(403).json({
        success: false,
        error: 'Delivery Assistants are not authorized to view clinical review records.'
      });
    }

    const request = await prisma.clinicalAssistanceRequest.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        assignments: {
          include: {
            pharmacy: {
              select: {
                id: true,
                name: true,
                managerId: true
              }
            }
          }
        },
        respondedBy: {
          select: {
            id: true,
            name: true,
            assistantProfile: {
              select: {
                professionTitle: true,
                qualifications: true
              }
            }
          }
        }
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Clinical assistance request not found.'
      });
    }

    // Patient isolation: patients can ONLY view their own requests
    if (userRole === 'PATIENT' && request.patientId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only view your own clinical requests.'
      });
    }

    // Pharmacist authorization check: must belong to an assigned pharmacy or be admin
    if (userRole === 'PHARMACIST') {
      const isAssigned = request.assignments.some(a => a.pharmacy.managerId === userId);
      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. This clinical request is not assigned to your pharmacy.'
        });
      }

      // Mark assignment as OPENED if currently ASSIGNED
      const matchingAssignment = request.assignments.find(a => a.pharmacy.managerId === userId);
      if (matchingAssignment && matchingAssignment.status === 'ASSIGNED') {
        await prisma.clinicalAssistanceAssignment.update({
          where: { id: matchingAssignment.id },
          data: {
            status: 'OPENED',
            openedAt: new Date()
          }
        });
      }
    }

    // Sanitized view: internalNotes stripped for patients
    const isClinicalStaff = ['ADMIN', 'CLINICIAN', 'PHARMACIST'].includes(userRole);
    const meta = extractClinicalMetadata(request.internalNotes, request.id);
    const respondingAssignment = request.assignments.find(a => a.status === 'RESPONDED') || request.assignments[0];
    const respondingPharmacy = respondingAssignment?.pharmacy || null;

    return res.json({
      success: true,
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        language: request.language,
        originalText: request.originalText,
        translatedText: request.translatedText,
        inputMethod: request.inputMethod,
        status: request.status,
        isEmergency: request.isEmergency,
        emergencyGuidance: request.emergencyGuidance,
        clinicianResponse: request.clinicianResponse,
        respondedAt: request.respondedAt,
        respondedBy: request.respondedBy,
        followUpState: meta.followUpState,
        followUpRespondedAt: meta.followUpRespondedAt,
        voiceAudioUrl: meta.voiceAudioUrl,
        hasVoiceMessage: meta.hasVoiceMessage,
        recommendedMedicine: meta.recommendedMedicine ? {
          ...meta.recommendedMedicine,
          pharmacyId: meta.recommendedMedicine.pharmacyId || respondingPharmacy?.id || null,
          pharmacyName: meta.recommendedMedicine.pharmacyName || respondingPharmacy?.name || 'Local Dispensary'
        } : null,
        respondingPharmacy,
        internalNotes: isClinicalStaff ? request.internalNotes : undefined,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching clinical request details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve request details.'
    });
  }
}

/**
 * Core function to evaluate a single request timeout and escalate if needed.
 * Safe across concurrent executions and process restarts.
 */
async function processSingleRequestTimeout(db, requestId) {
  const request = await db.clinicalAssistanceRequest.findUnique({
    where: { id: requestId },
    include: {
      assignments: true
    }
  });

  if (!request) {
    return { success: false, error: 'Clinical assistance request not found.', escalated: false };
  }

  // If request already has a response or is closed, do NOT escalate
  if (['RESPONDED', 'CLOSED', 'CANCELLED'].includes(request.status)) {
    return {
      success: true,
      message: 'Request already responded or resolved; no escalation needed.',
      escalated: false
    };
  }

  // Check if assignments have passed the timeout window
  const now = new Date();
  const timeoutThreshold = new Date(now.getTime() - PHARMACY_RESPONSE_TIMEOUT_MINUTES * 60 * 1000);

  const activeAssignments = request.assignments.filter(a => ['ASSIGNED', 'OPENED'].includes(a.status));
  const hasExpiredAssignments = activeAssignments.some(a => a.assignedAt <= timeoutThreshold);

  if (!hasExpiredAssignments && activeAssignments.length > 0) {
    return {
      success: true,
      message: `Response window of ${PHARMACY_RESPONSE_TIMEOUT_MINUTES} minutes has not expired yet.`,
      escalated: false
    };
  }

  // Mark unanswered older assignments as EXPIRED (not rejected)
  for (const a of activeAssignments) {
    if (a.assignedAt <= timeoutThreshold) {
      await db.clinicalAssistanceAssignment.update({
        where: { id: a.id },
        data: { status: 'EXPIRED' }
      });
    }
  }

  // Escalate to next round of eligible pharmacies
  const currentMaxRound = request.assignments.reduce((max, a) => Math.max(max, a.round), 1);
  const nextRound = currentMaxRound + 1;

  // Concurrency safeguard: check if next round has already been assigned
  const existingInNextRound = await db.clinicalAssistanceAssignment.findMany({
    where: { requestId: request.id, round: nextRound }
  });
  if (existingInNextRound.length >= 1) {
    return {
      success: true,
      message: `Round ${nextRound} already escalated by concurrent process.`,
      escalated: false,
      dispatchedCount: 0
    };
  }

  const escalationResult = await routeRequestToEligiblePharmacies(db, request, {
    round: nextRound,
    limit: 1
  });

  return {
    success: true,
    message: escalationResult.dispatchedCount > 0
      ? `Request escalated to ${escalationResult.dispatchedCount} additional eligible pharmacies.`
      : 'No additional eligible pharmacies available. Request maintained in pending review.',
    escalated: escalationResult.dispatchedCount > 0,
    routing: escalationResult
  };
}

/**
 * Background worker evaluation: checks all active requests under review for timeouts
 */
async function evaluateAllClinicalTimeouts(db) {
  const timeoutThreshold = new Date(Date.now() - PHARMACY_RESPONSE_TIMEOUT_MINUTES * 60 * 1000);

  const candidates = await db.clinicalAssistanceRequest.findMany({
    where: {
      status: 'UNDER_REVIEW'
    },
    include: {
      assignments: true
    }
  });

  const timedOutRequests = candidates.filter(r => {
    return r.assignments.some(
      a => ['ASSIGNED', 'OPENED'].includes(a.status) && a.assignedAt <= timeoutThreshold
    );
  });

  const results = [];
  for (const req of timedOutRequests) {
    try {
      const res = await processSingleRequestTimeout(db, req.id);
      results.push({ requestId: req.id, result: res });
    } catch (err) {
      console.error(`Error escalating request ${req.id} in background:`, err.message);
    }
  }

  return results;
}

/**
 * Gate 8: POST /api/clinical-assistance/:id/escalate
 * Trigger timeout evaluation & expansion to additional eligible pharmacies if unanswered
 */
async function checkAndEscalateTimeout(req, res) {
  try {
    const { id } = req.params;
    const userRole = req.user?.role;

    // Only clinical staff or system trigger can invoke escalation
    if (!['ADMIN', 'PHARMACIST', 'CLINICIAN'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to trigger timeout escalation.'
      });
    }

    const result = await processSingleRequestTimeout(prisma, id);
    if (!result.success && result.error === 'Clinical assistance request not found.') {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('Error evaluating timeout escalation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process timeout escalation.'
    });
  }
}

/**
 * PATCH /api/clinical-assistance/:id/respond
 * Qualified healthcare professional / pharmacist clinical response endpoint
 */
async function respondToClinicalRequest(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Delivery Assistants and Patients are strictly forbidden from clinical review
    if (['PATIENT', 'ASSISTANT'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized. Only qualified healthcare professionals can provide clinical assistance responses.'
      });
    }

    const { clinicianResponse, internalNotes, voiceAudio, recommendedMedicine } = req.body;

    if (!clinicianResponse || typeof clinicianResponse !== 'string' || !clinicianResponse.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Clinical response message is required.'
      });
    }

    const existing = await prisma.clinicalAssistanceRequest.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            pharmacy: true
          }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Clinical assistance request not found.'
      });
    }

    // Role Reconcile & Boundary Check (Item 5):
    // Server-side verification of responding user's identity, professional authorization, and assigned-pharmacy access.
    // Do NOT grant access merely because someone has ADMIN or CLINICIAN role.
    const assigned = existing.assignments.find(a => a.pharmacy && a.pharmacy.managerId === userId);
    if (!assigned) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You must be an authorized healthcare professional managing one of the participating pharmacies assigned to this clinical request. Administrative or clinical roles without active pharmacy assignment cannot respond.'
      });
    }

    // Verify the assigned pharmacy is currently active and verified
    if (assigned.pharmacy && (!assigned.pharmacy.isOpen || !assigned.pharmacy.isVerified || assigned.pharmacy.verificationStatus !== 'VERIFIED')) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. The pharmacy associated with your account is not currently active or verified.'
      });
    }

    const respondingPharmacyId = assigned.pharmacyId;

    // Process Voice Audio attachment if provided
    let voiceUrl = null;
    if (voiceAudio) {
      voiceUrl = saveVoiceAudioFile(id, voiceAudio);
    }

    // Process Recommended Medication attachment if provided
    let appendedNotes = internalNotes ? internalNotes.trim() : (existing.internalNotes || '');
    if (voiceUrl) {
      appendedNotes = appendedNotes.replace(/\[VOICE_AUDIO:[^\]]+\]\s*/g, '').trim();
      appendedNotes = `[VOICE_AUDIO:${voiceUrl}] ${appendedNotes}`.trim();
    }
    let safeMed = null;
    if (recommendedMedicine && typeof recommendedMedicine === 'object') {
      safeMed = {
        medicineId: recommendedMedicine.medicineId || recommendedMedicine.id,
        brandName: recommendedMedicine.brandName || recommendedMedicine.name,
        genericName: recommendedMedicine.genericName || '',
        strength: recommendedMedicine.strength || '',
        dosageForm: recommendedMedicine.dosageForm || 'Tablet',
        price: typeof recommendedMedicine.price === 'number' ? recommendedMedicine.price : (parseFloat(recommendedMedicine.price) || 15),
        quantity: parseInt(recommendedMedicine.quantity, 10) || 1,
        instructions: recommendedMedicine.instructions || 'As advised by dispensing pharmacist',
        pharmacyId: recommendedMedicine.pharmacyId || assigned.pharmacyId,
        pharmacyName: recommendedMedicine.pharmacyName || assigned.pharmacy?.name || 'Local Dispensary'
      };
      appendedNotes = appendedNotes.replace(/\[RECOMMENDED_MEDICINE:\{.*?\}\]\s*/g, '').trim();
      appendedNotes = `[RECOMMENDED_MEDICINE:${JSON.stringify(safeMed)}] ${appendedNotes}`.trim();
    }

    // Update the request with human response
    const updated = await prisma.clinicalAssistanceRequest.update({
      where: { id },
      data: {
        status: 'RESPONDED',
        clinicianResponse: clinicianResponse.trim(),
        respondedById: userId,
        respondedAt: new Date(),
        internalNotes: appendedNotes
      }
    });

    // Update assignment status for responding pharmacy
    if (respondingPharmacyId) {
      await prisma.clinicalAssistanceAssignment.updateMany({
        where: {
          requestId: id,
          pharmacyId: respondingPharmacyId
        },
        data: {
          status: 'RESPONDED',
          respondedAt: new Date()
        }
      });
    }

    // Notify the patient that a professional clinician has responded
    try {
      await sendIdempotentNotification(prisma, {
        userId: existing.patientId,
        title: `Clinical Assistance Response: ${existing.requestNumber}`,
        message: `A healthcare professional has reviewed your health concern and provided advice. Click to view response.`,
        type: 'INFO',
        linkUrl: `/healthcare?tab=clinical-assistance&requestId=${existing.id}`,
        dedupWindowMs: 10 * 60 * 1000
      });
    } catch (notifErr) {
      console.error('Notification dispatch error:', notifErr.message);
    }

    return res.json({
      success: true,
      message: 'Clinical response recorded successfully.',
      request: {
        ...updated,
        voiceAudioUrl: voiceUrl,
        recommendedMedicine: safeMed
      }
    });
  } catch (error) {
    console.error('Error responding to clinical assistance request:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to record clinical response.'
    });
  }
}

/**
 * Gate 9: POST /api/clinical-assistance/:id/follow-up
 * Patient records follow-up outcome after receiving professional clinical advice
 * Allowed outcomes: RESOLVED, NEEDS_MORE_HELP, PURCHASED_ELSEWHERE, NOT_PURCHASED
 */
async function submitClinicalFollowUp(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'PATIENT' && userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Only patients can submit follow-up on their clinical assistance requests.'
      });
    }

    const { followUpState, notes } = req.body || {};

    if (!followUpState || !VALID_CLINICAL_FOLLOW_UP_STATES.includes(followUpState)) {
      return res.status(400).json({
        success: false,
        error: `Invalid follow-up state "${followUpState}". Must be one of: ${VALID_CLINICAL_FOLLOW_UP_STATES.join(', ')}`
      });
    }

    const existing = await prisma.clinicalAssistanceRequest.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            pharmacy: true
          }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Clinical assistance request not found.'
      });
    }

    // Patient isolation check
    if (existing.patientId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You can only submit follow-up for your own clinical requests.'
      });
    }

    // Status transition: RESOLVED closes the inquiry; NEEDS_MORE_HELP sets UNDER_REVIEW
    let newStatus = existing.status;
    if (followUpState === 'RESOLVED') {
      newStatus = 'CLOSED';
    } else if (followUpState === 'NEEDS_MORE_HELP') {
      newStatus = 'UNDER_REVIEW';
    }

    const nowIso = new Date().toISOString();
    const followUpEntry = `[FOLLOW_UP:${followUpState}:${nowIso}]${notes ? ` ${notes.trim()}` : ''}`;
    const cleanedNotes = (existing.internalNotes || '').replace(/\[FOLLOW_UP:[A-Z_]+(?::[^\]]+)?\]\s*/g, '').trim();
    const updatedNotes = `${followUpEntry} ${cleanedNotes}`.trim();

    const updated = await prisma.clinicalAssistanceRequest.update({
      where: { id },
      data: {
        status: newStatus,
        internalNotes: updatedNotes
      }
    });

    // Notify responding pharmacy manager if patient needs more help
    if (followUpState === 'NEEDS_MORE_HELP') {
      try {
        const respondingPharmacistId = existing.respondedById;
        const targetUserId = respondingPharmacistId || (existing.assignments[0]?.pharmacy?.managerId);
        if (targetUserId) {
          await sendIdempotentNotification(prisma, {
            userId: targetUserId,
            title: `Follow-up Inquired: ${existing.requestNumber}`,
            message: `The patient requested additional clinical guidance on Request #${existing.requestNumber}. Please review the inquiry.`,
            type: 'INFO',
            linkUrl: `/pharmacist?tab=clinical-requests&requestId=${existing.id}`,
            dedupWindowMs: 15 * 60 * 1000
          });
        }
      } catch (notifErr) {
        console.warn('Clinical follow-up notification failure ignored safely:', notifErr.message);
      }
    }

    return res.json({
      success: true,
      message: 'Clinical assistance follow-up recorded successfully.',
      followUpState,
      followUpRespondedAt: nowIso,
      request: {
        id: updated.id,
        requestNumber: updated.requestNumber,
        status: updated.status,
        followUpState
      }
    });
  } catch (error) {
    console.error('Error recording clinical assistance follow-up:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to record clinical assistance follow-up.'
    });
  }
}

/**
 * GET /api/clinical-assistance/:id/voice
 * Streams or returns the recorded pharmacist voice guidance for a clinical request
 */
async function getClinicalVoiceAudio(req, res) {
  try {
    const { id } = req.params;
    let filePath = null;
    let ext = 'webm';

    if (fs.existsSync(VOICE_UPLOADS_DIR)) {
      const files = fs.readdirSync(VOICE_UPLOADS_DIR).filter(f => f.startsWith(`clinical_voice_${id}_`));
      if (files.length > 0) {
        const latest = files.sort().reverse()[0];
        filePath = path.join(VOICE_UPLOADS_DIR, latest);
        ext = path.extname(latest).replace('.', '') || 'webm';
      }
    }

    if (!filePath) {
      // Check if internalNotes has base64 data
      const reqDoc = await prisma.clinicalAssistanceRequest.findUnique({
        where: { id },
        select: { internalNotes: true }
      });
      if (reqDoc?.internalNotes) {
        const m = reqDoc.internalNotes.match(/\[VOICE_AUDIO:(data:audio\/([a-zA-Z0-9]+);base64,[^\]]+)\]/);
        if (m && m[1]) {
          const mime = m[2];
          const b64 = m[1].split('base64,')[1];
          const buf = Buffer.from(b64, 'base64');
          res.setHeader('Content-Type', `audio/${mime}`);
          return res.send(buf);
        }
      }
      return res.status(404).json({ success: false, error: 'Voice audio recording not found.' });
    }

    res.setHeader('Content-Type', `audio/${ext}`);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Error streaming voice audio:', err);
    return res.status(500).json({ success: false, error: 'Failed to stream voice audio.' });
  }
}

module.exports = {
  submitClinicalRequest,
  getPatientClinicalRequests,
  getPharmacyClinicalQueue,
  getClinicalRequestById,
  getClinicalVoiceAudio,
  respondToClinicalRequest,
  submitClinicalFollowUp,
  checkAndEscalateTimeout,
  processSingleRequestTimeout,
  evaluateAllClinicalTimeouts,
  findEligiblePharmacies,
  routeRequestToEligiblePharmacies,
  detectEmergencySymptoms,
  extractClinicalFollowUpTag,
  extractClinicalMetadata,
  saveVoiceAudioFile,
  VALID_CLINICAL_FOLLOW_UP_STATES,
  EMERGENCY_GUIDANCE_TEXT,
  PHARMACY_RESPONSE_TIMEOUT_MINUTES
};
