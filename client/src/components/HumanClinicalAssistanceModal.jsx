import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import VoicePoweredOrb from './VoicePoweredOrb';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', speechCode: 'en-IN', flag: '🇬🇧' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', speechCode: 'ml-IN', flag: '🇮🇳' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', speechCode: 'hi-IN', flag: '🇮🇳' },
];

const EMERGENCY_KEYWORDS = [
  'chest pain', 'heart attack', 'shortness of breath', 'cannot breathe', "can't breathe",
  'unconscious', 'fainted', 'severe bleeding', 'stroke', 'seizure', 'choking',
  'നെഞ്ചുവേദന', 'ശ്വാസതടസ്സം', 'ബോധക്ഷയം', 'രക്തസ്രാവം', 'ഹൃദയാഘാതം', 'സ്ട്രോക്ക്',
  'सीने में दर्द', 'सांस लेने में तकलीफ', 'बेहोश', 'दिल का दौरा', 'खून बहना'
];

export default function HumanClinicalAssistanceModal({ isOpen, onClose, onRequestSubmitted }) {
  const [language, setLanguage] = useState('en');
  const [concernText, setConcernText] = useState('');
  const [inputMethod, setInputMethod] = useState('TEXT');
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasEmergencyIndicators, setHasEmergencyIndicators] = useState(false);

  const recognitionRef = useRef(null);

  // Check for critical emergency keywords in real-time
  useEffect(() => {
    const lower = concernText.toLowerCase();
    const hasEmergency = EMERGENCY_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
    setHasEmergencyIndicators(hasEmergency);
  }, [concernText]);

  // Clean up speech recognition on close or unmount
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      setSubmissionSuccess(null);
      setErrorMessage('');
      setConcernText('');
      setSpeechError(null);
      setInterimTranscript('');
    }
    return () => {
      stopListening();
    };
  }, [isOpen]);

  const currentLangConfig = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore stop error
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError('Web Speech API is not supported in this browser. You can type your health concern in the text field.');
      return;
    }

    setSpeechError(null);
    setInterimTranscript('');
    setIsListening(true);
    setInputMethod('VOICE');

    try {
      const rec = new SpeechRecognition();
      recognitionRef.current = rec;
      rec.lang = currentLangConfig.speechCode;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        if (final) {
          setConcernText(prev => (prev ? prev + ' ' + final.trim() : final.trim()));
          setInterimTranscript('');
        }
      };

      rec.onerror = (e) => {
        console.warn('Speech recognition error event:', e.error);
        if (e.error === 'not-allowed') {
          setSpeechError('Microphone permission was denied. Please allow microphone access or type your concern below.');
        } else if (e.error === 'no-speech') {
          // No speech detected, prompt gracefully
          setSpeechError('No speech was detected. Please try speaking again or use keyboard typing.');
        } else if (e.error === 'network') {
          setSpeechError('Speech network service unavailable. You can type your concern directly.');
        } else {
          setSpeechError(`Voice input error (${e.error}). You can continue by typing.`);
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
      };

      rec.start();
    } catch (err) {
      console.error('Failed to initialize speech recognition:', err);
      setSpeechError('Could not start speech recognition. Please type your concern.');
      setIsListening(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!concernText || concernText.trim().length < 5) {
      setErrorMessage('Please describe your health concern in at least 5 characters.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch('/api/clinical-assistance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          concernText: concernText.trim(),
          language,
          inputMethod
        })
      });

      const data = await res.json();
      if (data.success) {
        setSubmissionSuccess(data.request);
        if (onRequestSubmitted) {
          onRequestSubmitted(data.request);
        }
      } else {
        setErrorMessage(data.error || 'Failed to submit clinical request.');
      }
    } catch (err) {
      console.error('Submission error:', err);
      setErrorMessage('Network error submitting request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(3, 15, 12, 0.76)', backdropFilter: 'blur(16px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Human Clinical Assistance"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-emerald-100 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header with Professional Clinical Disclaimer */}
        <div className="bg-gradient-to-r from-[#032f28] to-[#1e453e] px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              <span className="material-symbols-outlined text-emerald-300 text-2xl">clinical_notes</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white leading-tight">Human Clinical Assistance</h2>
                <span className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full">
                  Professional Workflow
                </span>
              </div>
              <p className="text-xs text-emerald-200/80">
                Operated by qualified healthcare professionals • Not an automated chatbot or diagnostic system
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all"
            aria-label="Close dialog"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-5">
          {submissionSuccess ? (
            /* Submission Confirmation Card */
            <div className="space-y-4 py-2">
              <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-2xl">check_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#032f28]">Request Submitted for Human Clinical Review</h3>
                  <p className="text-xs text-gray-600 mt-1">
                    Your health concern has been safely recorded and forwarded to a qualified healthcare professional.
                  </p>
                  <div className="mt-3 inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-emerald-200 text-xs font-semibold text-[#032f28]">
                    <span>Reference Number:</span>
                    <strong className="text-emerald-700 tracking-wider">{submissionSuccess.requestNumber}</strong>
                  </div>
                </div>
              </div>

              {/* Status Transparency */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-xs text-gray-700 space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                  <span className="font-semibold text-gray-600">Review Status:</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    SUBMITTED (Awaiting Human Professional Review)
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Submitted Language:</span>
                  <span className="font-bold uppercase text-gray-700">{submissionSuccess.language} ({submissionSuccess.inputMethod})</span>
                </div>
                <div className="pt-2">
                  <span className="text-gray-500 block mb-1">Preserved Original Concern:</span>
                  <p className="italic bg-white p-3 rounded-xl border border-gray-200 text-gray-800 text-xs leading-relaxed">
                    "{submissionSuccess.originalText}"
                  </p>
                </div>
              </div>

              {/* Immediate Emergency Notice if detected */}
              {submissionSuccess.isEmergency && (
                <div className="bg-red-50 border border-red-300 rounded-2xl p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600 text-2xl shrink-0 mt-0.5">e911_emergency</span>
                  <div className="text-xs text-red-900 leading-relaxed">
                    <strong className="block text-sm font-bold text-red-700 mb-1">🚨 Immediate Urgent-Care Guidance</strong>
                    {submissionSuccess.emergencyGuidance}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 bg-[#032f28] hover:bg-[#1e453e] text-white text-xs font-bold rounded-xl transition-all shadow-md"
                >
                  Done & Return to Portal
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Emergency Banner Alert */}
              {hasEmergencyIndicators && (
                <div className="bg-red-50 border border-red-300 rounded-2xl p-4 flex items-start gap-3 animate-pulse">
                  <span className="material-symbols-outlined text-red-600 text-2xl shrink-0 mt-0.5">crisis_alert</span>
                  <div className="text-xs text-red-900 leading-relaxed">
                    <strong className="block text-xs font-bold text-red-700 mb-0.5">Immediate Emergency Safety Warning:</strong>
                    The symptoms you described may be life-threatening. If you are experiencing acute distress, chest pain, or severe breathlessness, please call <strong>108 / 112</strong> or go to the nearest emergency casualty ward immediately. Do NOT delay medical care while waiting for a clinician.
                  </div>
                </div>
              )}

              {/* Language Selection Bar */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Select Language for Concern (മലയാളം / English / हिन्दी)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => setLanguage(lang.code)}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        language === lang.code
                          ? 'border-[#032f28] bg-[#032f28] text-white shadow-sm'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-sm">{lang.flag}</span>
                      <span>{lang.native}</span>
                      <span className="text-[10px] opacity-75">({lang.label})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Input Section with Real-Time Feedback */}
              <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#032f28] text-white'
                  }`}>
                    <span className="material-symbols-outlined text-xl">
                      {isListening ? 'mic' : 'mic_none'}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#032f28]">
                      {isListening ? `Listening in ${currentLangConfig.native} (${currentLangConfig.label})...` : 'Voice Input in Chosen Language'}
                    </h4>
                    <p className="text-[11px] text-gray-600">
                      Speak clearly into your microphone; you can review and correct transcription mistakes below.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={isListening ? stopListening : startListening}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                    isListening
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-[#2e685d] hover:bg-[#1e453e] text-white'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">
                    {isListening ? 'stop_circle' : 'keyboard_voice'}
                  </span>
                  <span>{isListening ? 'Stop Speaking' : 'Tap to Speak'}</span>
                </button>
              </div>

              {/* Speech Error / Fallback Notice */}
              {speechError && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-800">
                  <span className="material-symbols-outlined text-amber-600 text-base shrink-0">info</span>
                  <div className="leading-relaxed">
                    <strong>Voice input note:</strong> {speechError}
                  </div>
                </div>
              )}

              {/* Interim Live Transcript Indicator */}
              {interimTranscript && (
                <div className="p-3 bg-emerald-100/50 rounded-xl border border-emerald-200 text-xs italic text-emerald-900 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
                  <span>Hearing: "{interimTranscript}..."</span>
                </div>
              )}

              {/* Text Description & Transcript Review Area */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="clinical-concern-text" className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Describe Health Concern (Review & Edit Transcript)
                  </label>
                  <span className="text-[11px] text-gray-500">
                    Original text is preserved without alterations
                  </span>
                </div>
                <textarea
                  id="clinical-concern-text"
                  rows={4}
                  value={concernText}
                  onChange={(e) => setConcernText(e.target.value)}
                  placeholder={
                    language === 'ml'
                      ? 'നിങ്ങളുടെ ആരോഗ്യ പ്രശ്നം ഇവിടെ വിശദീകരിക്കുക (ഉദാ: കഴിഞ്ഞ 2 ദിവസമായി പനിയും തൊണ്ടവേദനയും ഉണ്ട്)...'
                      : language === 'hi'
                      ? 'अपनी स्वास्थ्य समस्या यहाँ लिखें (उदा: पिछले 2 दिनों से बुखार और गले में दर्द है)...'
                      : 'Describe your symptoms or health concern here (e.g., experiencing fever and throat irritation for 2 days)...'
                  }
                  className="w-full text-xs sm:text-sm p-3.5 rounded-2xl border border-gray-300 focus:border-[#032f28] focus:ring-1 focus:ring-[#032f28] outline-none text-gray-800 leading-relaxed transition-all shadow-inner bg-white"
                />
              </div>

              {/* Safety Disclaimers */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 space-y-2 text-[11px] text-gray-600 leading-normal">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-emerald-700 text-base shrink-0">verified_user</span>
                  <span>
                    <strong>Clinical Safety Rule:</strong> MediFind AI does not generate automatic diagnoses or prescriptions. A human registered nurse or clinical healthcare professional reviews every submission.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-emerald-700 text-base shrink-0">lock</span>
                  <span>
                    <strong>Privacy & Confidentiality:</strong> Your clinical inquiry is private to you and attending healthcare professionals. Delivery Assistants do not have access to clinical notes.
                  </span>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
                  {errorMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !concernText.trim()}
                  className="px-6 py-2.5 rounded-xl bg-[#032f28] hover:bg-[#1e453e] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md"
                >
                  {submitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting for Clinical Review...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">send</span>
                      <span>Submit for Human Review</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== 'undefined'
    ? ReactDOM.createPortal(modalContent, document.body)
    : modalContent;
}
