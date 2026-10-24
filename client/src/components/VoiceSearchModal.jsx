import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import VoicePoweredOrb from './VoicePoweredOrb';

const SPEECH_TIPS = [
  'Try: "Paracetamol 500mg tablets"',
  'Try: "Amoxicillin antibiotic"',
  'Try: "Metformin for diabetes"',
  'Try: "Blood pressure medicine"',
  'Try: "Dolo 650 fever tablets"',
  'Try: "Insulin injection"',
];

export default function VoiceSearchModal({ isOpen, onClose, onResult, onFallbackToText }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [unsupportedBrowser, setUnsupportedBrowser] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'processing' | 'done'
  const recognitionRef = useRef(null);
  const tipTimerRef = useRef(null);

  // Cycle tips
  useEffect(() => {
    if (!isOpen) return;
    tipTimerRef.current = setInterval(() => {
      setTipIndex(i => (i + 1) % SPEECH_TIPS.length);
    }, 2800);
    return () => clearInterval(tipTimerRef.current);
  }, [isOpen]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setTranscript('');
      setInterimText('');
      setStatus('idle');
      setListening(false);
      setPermissionDenied(false);
      setUnsupportedBrowser(false);
      setErrorMessage(null);
      setVoiceDetected(false);
    } else {
      stopListening();
    }
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopListening();
  }, []);

  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    setListening(false);
    setStatus(prev => prev === 'listening' ? 'idle' : prev);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setUnsupportedBrowser(true);
      setErrorMessage('Web Speech API is not supported in this browser. Please use Google Chrome, Edge, or text search below.');
      return;
    }

    setTranscript('');
    setInterimText('');
    setErrorMessage(null);
    setStatus('listening');
    setListening(true);

    const rec = new SpeechRecognition();
    recognitionRef.current = rec;
    rec.lang = 'en-IN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim) setInterimText(interim);
      if (final) {
        setTranscript(final.trim());
        setInterimText('');
        setStatus('done');
      }
    };

    rec.onerror = (e) => {
      const err = e.error;
      if (err === 'not-allowed' || err === 'permission-denied') {
        setPermissionDenied(true);
        setErrorMessage('Microphone access was denied. Please allow microphone permission in your browser settings, or use normal text search below.');
      } else if (err === 'no-speech') {
        setErrorMessage('No voice input was detected. Tap to try speaking again, or type your medicine name below.');
      } else if (err === 'audio-capture') {
        setErrorMessage('No microphone device found or microphone is unavailable. Please use text search.');
      } else if (err === 'network') {
        setErrorMessage('Network connection error during voice recognition. Please use normal text search.');
      } else {
        setErrorMessage(`Voice search error (${err || 'unknown'}). You can use normal text search below.`);
      }
      setListening(false);
      setStatus('idle');
    };

    rec.onend = () => {
      setListening(false);
      if (status !== 'done') setStatus(t => t === 'listening' ? 'idle' : t);
    };

    try {
      rec.start();
    } catch (e) {
      setErrorMessage('Could not initialize voice recording. Please use text search.');
      setListening(false);
      setStatus('idle');
    }
  };

  const handleUseResult = () => {
    if (transcript) {
      onResult(transcript);
      onClose();
    }
  };

  const handleRetry = () => {
    setTranscript('');
    setInterimText('');
    setStatus('idle');
    setListening(false);
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-on-surface/50 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Voice Search"
    >
      <div
        className="relative w-full max-w-sm mx-auto flex flex-col items-center gap-0 rounded-3xl overflow-hidden bg-surface-container-lowest border border-outline-variant/30 shadow-[0_24px_50px_-12px_rgba(3,47,40,0.25)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="w-full flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-secondary">mic</span>
            <span className="text-xs font-bold tracking-wider uppercase text-primary">
              Voice Medicine Search
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface cursor-pointer"
            aria-label="Close voice search"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Orb */}
        <div className="w-52 h-52 relative mx-auto my-2">
          <VoicePoweredOrb
            hue={140}
            enableVoiceControl={listening}
            voiceSensitivity={2.0}
            maxRotationSpeed={1.4}
            maxHoverIntensity={0.9}
            onVoiceDetected={setVoiceDetected}
            className="rounded-full overflow-hidden"
          />

          {/* Pulse ring when listening */}
          {listening && (
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                boxShadow: voiceDetected
                  ? '0 0 0 8px rgba(46,104,93,0.35), 0 0 0 16px rgba(46,104,93,0.15)'
                  : '0 0 0 4px rgba(166,207,197,0.2)',
                transition: 'box-shadow 0.15s ease',
                animation: 'voicePulse 1.6s ease-in-out infinite',
              }}
            />
          )}

          {/* Status overlay on orb */}
          {status === 'idle' && !listening && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <span
                  className="material-symbols-outlined text-5xl"
                  style={{ color: 'rgba(255,255,255,0.35)', display: 'block' }}
                >
                  mic
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Transcript or error display */}
        <div className="w-full px-5 min-h-[56px] flex items-center justify-center">
          {errorMessage ? (
            <div className="w-full rounded-2xl px-3.5 py-2.5 text-center bg-rose-950/40 border border-rose-500/30">
              <p className="text-xs text-rose-300 font-medium leading-relaxed">
                {errorMessage}
              </p>
            </div>
          ) : status === 'done' && transcript ? (
            <div className="w-full rounded-2xl px-4 py-3 text-center bg-[#ecfdf7] border border-[#b0ecdd]">
              <p className="text-sm font-bold text-[#032f28]">{transcript}</p>
            </div>
          ) : (listening && interimText) ? (
            <p className="text-sm text-center text-[#2e685d] italic">
              "{interimText}…"
            </p>
          ) : (
            <p className="text-xs text-center text-on-surface-variant transition-all font-medium">
              {SPEECH_TIPS[tipIndex]}
            </p>
          )}
        </div>

        {/* Status text */}
        <div className="flex items-center gap-1.5 mb-1 h-6">
          {listening && (
            <>
              <span
                className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_8px_#059669] animate-pulse"
              />
              <span className="text-xs font-bold text-[#032f28]">
                {voiceDetected ? 'Voice detected…' : 'Listening…'}
              </span>
            </>
          )}
          {status === 'done' && (
            <span className="text-xs font-bold text-secondary">
              ✓ Captured
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="w-full px-5 pb-6 pt-2 flex flex-col gap-2.5">
          {status === 'done' && transcript ? (
            <div className="flex gap-2.5">
              <button
                onClick={handleRetry}
                className="flex-1 h-11 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-surface-container hover:bg-surface-container-high text-primary border border-outline-variant/30 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Retry
              </button>
              <button
                onClick={handleUseResult}
                className="flex-[2] h-11 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-primary hover:bg-primary-container text-white shadow-md cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">search</span>
                Search this
              </button>
            </div>
          ) : (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={permissionDenied || unsupportedBrowser}
              className={`w-full h-12 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm ${
                listening
                  ? 'bg-rose-50 text-rose-700 border border-rose-300'
                  : 'bg-primary hover:bg-primary-container text-white'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {listening ? 'stop_circle' : 'mic'}
              </span>
              {listening ? 'Stop Recording' : 'Tap to Speak'}
            </button>
          )}

          {/* Fallback button to preserve normal text search if microphone fails or user prefers typing */}
          <button
            type="button"
            onClick={() => {
              stopListening();
              onClose();
              if (onFallbackToText) onFallbackToText();
            }}
            className="w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer text-secondary hover:bg-surface-container border border-outline-variant/40"
          >
            <span className="material-symbols-outlined text-sm">edit_note</span>
            <span>Use Normal Text Search Instead</span>
          </button>

          {/* Language hint */}
          <p className="text-center text-[10px] text-on-surface-variant">
            Supports English (India) • Speak medicine name, symptom, or category
          </p>
        </div>
      </div>

      <style>{`
        @keyframes voicePulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
        @keyframes voiceDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );

  return typeof document !== 'undefined'
    ? ReactDOM.createPortal(modalContent, document.body)
    : modalContent;
}
