import React, { useState, useEffect, useRef } from 'react';
import VoicePoweredOrb from './VoicePoweredOrb';

const SPEECH_TIPS = [
  'Try: "Paracetamol 500mg tablets"',
  'Try: "Amoxicillin antibiotic"',
  'Try: "Metformin for diabetes"',
  'Try: "Blood pressure medicine"',
  'Try: "Dolo 650 fever tablets"',
  'Try: "Insulin injection"',
];

export default function VoiceSearchModal({ isOpen, onClose, onResult }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [unsupportedBrowser, setUnsupportedBrowser] = useState(false);
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
      return;
    }

    setTranscript('');
    setInterimText('');
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
      if (e.error === 'not-allowed') setPermissionDenied(true);
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

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(3, 15, 12, 0.72)', backdropFilter: 'blur(18px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Voice Search"
    >
      <div
        className="relative w-full max-w-sm mx-auto flex flex-col items-center gap-0 rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(46,104,93,0.12) 100%)',
          border: '1px solid rgba(161,207,197,0.2)',
          boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="w-full flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#a6cfc5' }}>mic</span>
            <span className="text-xs font-bold tracking-wider uppercase" style={{ color: '#a6cfc5' }}>
              Voice Medicine Search
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
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

        {/* Transcript display */}
        <div className="w-full px-5 min-h-[56px] flex items-center justify-center">
          {status === 'done' && transcript ? (
            <div className="w-full rounded-2xl px-4 py-3 text-center" style={{ background: 'rgba(46,104,93,0.25)', border: '1px solid rgba(46,104,93,0.4)' }}>
              <p className="text-sm font-bold" style={{ color: '#b0ecdd' }}>{transcript}</p>
            </div>
          ) : (listening && interimText) ? (
            <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>
              "{interimText}…"
            </p>
          ) : (
            <p className="text-xs text-center transition-all" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {unsupportedBrowser
                ? '⚠ Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.'
                : permissionDenied
                ? '⚠ Microphone access was denied. Please allow in browser settings.'
                : SPEECH_TIPS[tipIndex]}
            </p>
          )}
        </div>

        {/* Status text */}
        <div className="flex items-center gap-1.5 mb-1 h-6">
          {listening && (
            <>
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: voiceDetected ? '#10b981' : '#a6cfc5',
                  boxShadow: voiceDetected ? '0 0 8px #10b981' : 'none',
                  animation: 'voiceDot 0.8s ease-in-out infinite',
                  transition: 'all 0.15s',
                }}
              />
              <span className="text-xs font-semibold" style={{ color: voiceDetected ? '#10b981' : 'rgba(166,207,197,0.7)' }}>
                {voiceDetected ? 'Voice detected…' : 'Listening…'}
              </span>
            </>
          )}
          {status === 'done' && (
            <span className="text-xs font-semibold" style={{ color: '#b0ecdd' }}>
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
                className="flex-1 h-11 rounded-2xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Retry
              </button>
              <button
                onClick={handleUseResult}
                className="flex-[2] h-11 rounded-2xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all"
                style={{ background: 'linear-gradient(135deg, #2e685d, #032f28)', color: '#fff', boxShadow: '0 4px 16px rgba(46,104,93,0.4)' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <span className="material-symbols-outlined text-[16px]">search</span>
                Search this
              </button>
            </div>
          ) : (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={permissionDenied || unsupportedBrowser}
              className="w-full h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              style={listening
                ? { background: 'rgba(186,26,26,0.2)', color: '#ff8875', border: '1px solid rgba(186,26,26,0.35)' }
                : { background: 'linear-gradient(135deg, #2e685d, #1e453e)', color: '#fff', boxShadow: '0 4px 20px rgba(46,104,93,0.45)', opacity: (permissionDenied || unsupportedBrowser) ? '0.5' : '1' }
              }
            >
              <span className="material-symbols-outlined text-[20px]">
                {listening ? 'stop_circle' : 'mic'}
              </span>
              {listening ? 'Stop Recording' : 'Tap to Speak'}
            </button>
          )}

          {/* Language hint */}
          <p className="text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
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
}
