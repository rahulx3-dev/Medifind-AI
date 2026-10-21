import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import '../styles/inkOrbitTemplate.css';
import InkOrbitSculpture from './InkOrbitSculpture';
import logoImg from '../assets/medifind_logo.png';

// Canonical MediFind AI logo component matching 21st.dev template rotation physics
function SpinningLogoIcon({ size = 48 }) {
  return (
    <img
      src={logoImg}
      alt="MediFind AI Brand Logo"
      style={{
        height: `${size}px`,
        width: 'auto',
        maxWidth: 'none',
        objectFit: 'contain',
        filter: 'brightness(1.5) contrast(1.2) drop-shadow(0 2px 8px rgba(16, 185, 129, 0.45))',
        display: 'block',
        flexShrink: 0
      }}
    />
  );
}

// Helper math functions for animations & geometry
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function easeOutCubic(t) {
  const r = clamp(t, 0, 1);
  return 1 - Math.pow(1 - r, 3);
}

function parseFormattedText(text) {
  return text.split(/\n|\\n/).map(line => {
    const parts = [];
    line.split('*').forEach((part, idx) => {
      if (part) parts.push({ text: part, muted: idx % 2 === 1 });
    });
    return parts;
  });
}

// Corner bracket decorations matching template
function CornerBrackets() {
  return (
    <>
      <span className="nf-c nf-c-tl" aria-hidden="true" />
      <span className="nf-c nf-c-tr" aria-hidden="true" />
      <span className="nf-c nf-c-bl" aria-hidden="true" />
      <span className="nf-c nf-c-br" aria-hidden="true" />
    </>
  );
}

// Arrow icon
function ArrowIcon({ size = 14, className = 'nf-arr' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Check icon
function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.4 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Star rating icon
function StarIcon({ off }) {
  return (
    <svg className={off ? 'nf-off' : undefined} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 .8 7.6 4.2l3.6.4-2.7 2.5.8 3.6L6 8.9 2.7 10.7l.8-3.6L.8 4.6l3.6-.4z" fill="currentColor" />
    </svg>
  );
}

// Quote mark icon
function QuoteIcon({ flip }) {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" style={flip ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M1 11V6.5C1 3.4 2.6 1.4 5.3 1l.4 1.3C4.2 2.8 3.4 3.9 3.3 5.5H5.6V11H1Zm7.3 0V6.5c0-3.1 1.6-5.1 4.3-5.5l.4 1.3c-1.5.5-2.3 1.6-2.4 3.2h2.3V11H8.3Z" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

// Section Header component
function SectionHeader({ tag, title, subtitle }) {
  return (
    <div className="nf-head">
      {tag && <span className="nf-tag">{tag}</span>}
      <h2 className="nf-h2">
        {parseFormattedText(title).map((line, lIdx) => (
          <span key={lIdx}>
            {line.map((part, pIdx) => (
              part.muted ? (
                <span key={pIdx} className="nf-muted" style={{ display: 'inline' }}>
                  {part.text}
                </span>
              ) : (
                <React.Fragment key={pIdx}>{part.text}</React.Fragment>
              )
            ))}
          </span>
        ))}
      </h2>
      {subtitle && <p className="nf-sub">{subtitle}</p>}
    </div>
  );
}

// Avatars for community proof
const AVATAR_PROFILES = [
  { name: 'Dr. Thomas M.', role: 'Physician · Kottayam', hair: '#1a1918', skin: '#d6d0c9', bg: '#064e3b' },
  { name: 'Rajesh V.', role: 'Chief Pharmacist · Karuna Medicals', hair: '#3a3a3a', skin: '#c7c0b8', bg: '#042f2c' },
  { name: 'Priya S.', role: 'Licensed Care Nurse', hair: '#2b2a29', skin: '#a7a19a', bg: '#0f766e' },
  { name: 'Lakshmi N.', role: 'Patient Family · Chengannur', hair: '#1e1d1c', skin: '#d9d6d2', bg: '#065f46' },
  { name: 'Kiran K.', role: 'Emergency Responder', hair: '#3d3c3a', skin: '#b9b4ae', bg: '#115e59' }
];

function ProfileAvatar({ index, size = 36, uid = 'av' }) {
  const p = AVATAR_PROFILES[index % AVATAR_PROFILES.length];
  const gradId = `${uid}-grad-${index}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ borderRadius: '50%', overflow: 'hidden' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.bg} />
          <stop offset="1" stopColor="#021c17" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${gradId})`} />
      {/* Abstract profile shapes */}
      <circle cx="32" cy="24" r="14" fill={p.skin} />
      <path d="M12 60c3-16 12-22 20-22s17 6 20 22z" fill="#ecfdf5" opacity="0.85" />
      <circle cx="28" cy="23" r="1.8" fill="#022c22" />
      <circle cx="36" cy="23" r="1.8" fill="#022c22" />
      <path d="M29 29c1.8 1.4 4.2 1.4 6 0" fill="none" stroke="#022c22" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// -------------------------------------------------------------
// BENTO CARD 1: Real-Time Clinical Network Flow Diagram
// -------------------------------------------------------------
function BentoClinicalRelay({ brand = 'MediFind AI', uid = 'b1', reduced = false, inView = true, onNavigate }) {
  const [pulseIndex, setPulseIndex] = useState(0);
  const [hoverRegion, setHoverRegion] = useState('');

  useEffect(() => {
    if (reduced || !inView) return;
    const interval = setInterval(() => {
      setPulseIndex(i => i + 1);
    }, 2800);
    return () => clearInterval(interval);
  }, [reduced, inView]);

  const participants = [
    { x: 58, y: 38, name: 'Doctor · Rx Issued' },
    { x: 104, y: 22, name: 'Patient · Rx Upload & OCR' },
    { x: 150, y: 40, name: 'Pharmacist · Stock Reserved' },
    { x: 46, y: 92, name: 'Care Nurse · In-Home Visit' },
    { x: 146, y: 114, name: 'Assistant · Escrow PIN Handover' }
  ];

  const path1 = 'M117,67 C196,67 210,100 262,100';
  const path2 = 'M117,73 C186,73 206,120 262,120';
  const path3 = 'M378,100 C412,100 418,86 450,86';
  const path4 = 'M378,120 C412,120 418,134 450,134';

  const glowId = `${uid}-glow`;
  const raysId = `${uid}-rays`;

  return (
    <div className="nf-frame nf-frame-hover nf-wide">
      <CornerBrackets />
      <div className="nf-card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg className="nf-diagram" viewBox="0 0 640 178" role="img" aria-label="MediFind AI Real-Time Clinical Network Architecture">
          <defs>
            <radialGradient id={glowId} cx="320" cy="110" r="190" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--nf-raise)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--nf-raise)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={raysId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--nf-line-strong)" stopOpacity=".55" />
              <stop offset="1" stopColor="var(--nf-line-strong)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="640" height="178" fill={`url(#${glowId})`} />

          {/* Background radial rays */}
          {[-62, -38, -14, 14, 38, 62].map((angle, idx) => (
            <path
              key={idx}
              d={`M320,110 L${320 + Math.sin((angle * Math.PI) / 180) * 260},${110 - Math.cos((angle * Math.PI) / 180) * 260} L${320 + Math.sin(((angle + 7) * Math.PI) / 180) * 260},${110 - Math.cos(((angle + 7) * Math.PI) / 180) * 260}Z`}
              fill={`url(#${raysId})`}
              opacity=".45"
            />
          ))}

          {/* Left Node Group: Clinical Actors */}
          <g onMouseEnter={() => setHoverRegion('left')} onMouseLeave={() => setHoverRegion('')}>
            <rect x="20" y="8" width="170" height="130" fill="transparent" />
            {participants.map((p, idx) => (
              <line
                key={`line-${idx}`}
                x1={p.x}
                y1={p.y}
                x2="104"
                y2="70"
                stroke="var(--nf-line-strong)"
                strokeDasharray="2 3"
              />
            ))}

            {/* Central Gateway Node */}
            <g transform="translate(91,57)">
              <rect width="26" height="26" rx="5" className="nf-node" />
              <g transform="translate(5,5)" style={{ color: '#10b981' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>local_pharmacy</span>
              </g>
            </g>

            {/* Avatars */}
            {participants.map((p, idx) => (
              <g key={`av-${idx}`} className="nf-av" tabIndex={0} role="img" aria-label={p.name}>
                <svg x={p.x - 11} y={p.y - 11} width="22" height="22" viewBox="0 0 22 22">
                  <clipPath id={`${uid}-clip-${idx}`}>
                    <circle cx="11" cy="11" r="11" />
                  </clipPath>
                  <g clipPath={`url(#${uid}-clip-${idx})`}>
                    <ProfileAvatar index={idx} size={22} uid={`${uid}-p`} />
                  </g>
                  <circle cx="11" cy="11" r="10.5" fill="none" stroke="var(--nf-paper)" strokeWidth="1.5" />
                </svg>
                <circle cx={p.x + 8} cy={p.y + 8} r="2.6" fill={idx === 4 ? 'var(--nf-faint)' : '#22c55e'} stroke="var(--nf-paper)" className={idx === 4 ? undefined : 'nf-presence'} />

                {/* Tooltip */}
                <g className="nf-av-tip" transform={`translate(${p.x},${p.y - 18})`}>
                  <rect x={-p.name.length * 2.45 - 6} y="-9" width={p.name.length * 4.9 + 12} height="14" rx="2" fill="var(--nf-inv)" />
                  <text x="0" y="1" textAnchor="middle" fontSize="7.5" fill="var(--nf-inv-ink)" fontFamily="var(--nf-sans)">
                    {p.name}
                  </text>
                </g>
              </g>
            ))}
          </g>

          {/* Animated Connecting Flow Lines */}
          {[path1, path2].map((d, idx) => (
            <path key={`in-path-${idx}`} d={d} className={`nf-flow${hoverRegion === 'left' ? ' nf-flow-on' : ''}${idx ? ' nf-dash' : ''}`} />
          ))}
          {[path3, path4].map((d, idx) => (
            <path key={`out-path-${idx}`} d={d} className={`nf-flow${hoverRegion === 'right' ? ' nf-flow-on' : ''}${idx ? ' nf-dash' : ''}`} />
          ))}

          {/* Animated Flow Packets */}
          {!reduced && [path1, path2, path3, path4].map((d, idx) => (
            <circle key={`pkt-${idx}`} r="2.2" className="nf-pkt" fill="#10b981">
              <animateMotion dur={`${2.2 + (idx % 2) * 0.6}s`} begin={`${idx * 0.35}s`} repeatCount="indefinite" path={d} />
            </circle>
          ))}

          {/* Central MediFind AI Relay Core */}
          <g transform="translate(262,88)">
            <rect x="-4" y="-4" width="124" height="52" rx="8" fill="none" stroke="var(--nf-line)" className={reduced ? undefined : 'nf-glow'} />
            <rect width="116" height="44" rx="6" className="nf-node" style={{ filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.08))' }} />
            <circle cx="22" cy="22" r="10" fill="#042f2c" />
            <text x="22" y="26" textAnchor="middle" fontSize="11" fill="#10b981" fontWeight="bold">Rx</text>
            <text x="40" y="24" fontSize="8.5" letterSpacing="1.2" fontWeight="700" fill="var(--nf-soft)" fontFamily="var(--nf-sans)">
              MEDIFIND AI
            </text>
            <text x="40" y="34" fontSize="6.5" fill="#10b981" fontFamily="var(--nf-mono)">
              REAL-TIME RELAY
            </text>
            <path d="M102 20l4 4-4 4" fill="none" stroke="var(--nf-muted)" strokeWidth="1.3" />
          </g>

          {/* Right Side: Generated Dispense Certificate & Handover Slip */}
          <g onMouseEnter={() => setHoverRegion('right')} onMouseLeave={() => setHoverRegion('')}>
            {[2, 1, 0].map(stackIdx => (
              <g key={`sheet-${stackIdx}`} transform={`translate(${450 + stackIdx * 12},${40 - stackIdx * 10})`} opacity={1 - stackIdx * 0.25}>
                <g className={`nf-sheet${stackIdx === 0 ? ' nf-sheet-new' : ''}`}>
                  <rect width="138" height="102" rx="3" fill="var(--nf-raise)" stroke="var(--nf-line-strong)" />
                  {stackIdx === 0 && (
                    <>
                      <text x="10" y="16" fontSize="7" fill="var(--nf-muted)" fontFamily="var(--nf-mono)">
                        VERIFIED DISPENSE #{1000 + (pulseIndex % 900)}
                      </text>
                      <rect x="10" y="24" width="70" height="5" rx="1" fill="#10b981" opacity=".8" />
                      <rect x="10" y="33" width="92" height="3" rx="1" fill="var(--nf-line-strong)" />
                      <rect x="10" y="39" width="80" height="3" rx="1" fill="var(--nf-line-strong)" />
                      {/* Confidence bar chart */}
                      {[18, 26, 22, 30, 28, 34].map((h, bIdx) => (
                        <rect key={`bar-${bIdx}`} x={12 + bIdx * 13} y={92 - h} width="8" height={h} fill="#059669" opacity={0.35 + bIdx * 0.12} />
                      ))}
                      <text x="10" y="98" fontSize="6" fill="var(--nf-muted)" fontFamily="var(--nf-mono)">OCR CONFIDENCE 99.8%</text>
                      <path d="M92 64h34M92 72h28M92 80h32" stroke="var(--nf-line-strong)" strokeWidth="2.5" />
                    </>
                  )}
                </g>
              </g>
            ))}
          </g>
        </svg>

        {/* Copy under the diagram */}
        <div className="nf-wide-copy" style={{ padding: '0 22px 20px' }}>
          <div>
            <h3>Dual-Stage OCR & Clinical Verification</h3>
            <p>PaddleOCR & neural extraction cross-reference doctor handwriting against CDSCO formulary standards and Kerala Drug Control databases before pharmacy release.</p>
          </div>
          <div>
            <h3>Escrow 4-Digit Security PIN Handover</h3>
            <p>Prescriptions are locked in digital escrow. The delivery assistant releases medications only upon physical 4-digit PIN verification.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// BENTO CARD 2: Real-Time Kerala Pharmacy Network
// -------------------------------------------------------------
function BentoKeralaPharmacyRelay({ onNavigate }) {
  const [selectedPharmacy, setSelectedPharmacy] = useState(0);

  const pharmacies = [
    {
      name: 'Max Care Pharmacy',
      district: 'Chengannur',
      license: 'KL-ALP-2023-0891',
      stockRatio: '140+ Formulations',
      status: 'Open · 09:30 AM – 8:00 PM',
      distance: '1.2 km',
      syncTime: '42ms latency',
      fastMeds: ['Amoxicillin 500mg', 'Paracetamol 650mg', 'Azithromycin 500mg']
    },
    {
      name: 'Karuna Medicals',
      district: 'Chengannur',
      license: 'XI/567(1), Chengannur',
      stockRatio: '115+ Formulations',
      status: 'Open · 09:30 AM – 7:00 PM',
      distance: '3.8 km',
      syncTime: '18ms latency',
      fastMeds: ['Metformin 500mg', 'Atorvastatin 20mg', 'Omeprazole 20mg']
    }
  ];

  const p = pharmacies[selectedPharmacy];

  return (
    <div className="nf-frame nf-frame-hover">
      <CornerBrackets />
      <div className="nf-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Pharmacy Toggle Tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '4px', background: 'var(--nf-paper)', borderRadius: 6, border: '1px solid var(--nf-line)' }}>
          {pharmacies.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedPharmacy(idx)}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 4,
                textAlign: 'center',
                background: selectedPharmacy === idx ? 'var(--nf-inv)' : 'transparent',
                color: selectedPharmacy === idx ? 'var(--nf-inv-ink)' : 'var(--nf-soft)',
                transition: 'all .2s ease'
              }}
            >
              {item.name}
            </button>
          ))}
        </div>

        {/* Live Telemetry Display */}
        <div style={{ padding: '12px 14px', background: 'var(--nf-paper)', border: '1px solid var(--nf-line)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--nf-ink)' }}>{p.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#10b981', fontWeight: 700, fontFamily: 'var(--nf-mono)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              LIVE TELEMETRY
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 11, color: 'var(--nf-muted)', margin: '8px 0' }}>
            <div>
              <span style={{ display: 'block', color: 'var(--nf-faint)', fontSize: 9.5 }}>LOCATION / LIC:</span>
              <span style={{ fontFamily: 'var(--nf-mono)', fontWeight: 600, color: 'var(--nf-soft)' }}>{p.license}</span>
            </div>
            <div>
              <span style={{ display: 'block', color: 'var(--nf-faint)', fontSize: 9.5 }}>CATALOG STOCK:</span>
              <span style={{ fontFamily: 'var(--nf-mono)', fontWeight: 700, color: '#10b981' }}>{p.stockRatio}</span>
            </div>
            <div>
              <span style={{ display: 'block', color: 'var(--nf-faint)', fontSize: 9.5 }}>OPERATING HOURS:</span>
              <span style={{ fontWeight: 600, color: 'var(--nf-soft)' }}>{p.status}</span>
            </div>
            <div>
              <span style={{ display: 'block', color: 'var(--nf-faint)', fontSize: 9.5 }}>NETWORK LATENCY:</span>
              <span style={{ fontFamily: 'var(--nf-mono)', fontWeight: 600, color: 'var(--nf-soft)' }}>{p.syncTime}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--nf-line)', paddingTop: 8, marginTop: 4 }}>
            <span style={{ fontSize: 9.5, color: 'var(--nf-faint)', display: 'block', marginBottom: 4 }}>VERIFIED IN STOCK:</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {p.fastMeds.map((med, mIdx) => (
                <span key={mIdx} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--nf-card)', border: '1px solid var(--nf-line)', borderRadius: 3, color: 'var(--nf-ink)', fontFamily: 'var(--nf-mono)' }}>
                  ✓ {med}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <h3>Real-Time Kerala Pharmacy Network</h3>
          <p>Instant inventory telemetry with Max Care Pharmacy and Karuna Medicals in Chengannur under Kerala Drugs Control oversight.</p>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// BENTO CARD 3: Prescription OCR & Candidate Verification Pipeline
// -------------------------------------------------------------
function BentoPrescriptionOcrPipeline({ onNavigate }) {
  const [activeCandidate, setActiveCandidate] = useState(0);

  const candidates = [
    { name: 'Amoxicillin 500mg', dosage: '1-0-1 (Post meals)', confidence: '98.6%', schedule: 'Schedule H · Rx Required' },
    { name: 'Paracetamol 650mg', dosage: 'SOS (Fever > 100°F)', confidence: '99.2%', schedule: 'OTC Analgesic · Cleared' },
    { name: 'Omeprazole 20mg', dosage: '1-0-0 (Pre-breakfast)', confidence: '97.4%', schedule: 'Prescription Verified' }
  ];

  return (
    <div className="nf-frame nf-frame-hover">
      <CornerBrackets />
      <div className="nf-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Prescription Header Simulation */}
        <div style={{ padding: '12px 14px', background: 'var(--nf-paper)', border: '1px solid var(--nf-line)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--nf-mono)', color: 'var(--nf-muted)' }}>
              PRESCRIPTION #RX-KL-2026-91
            </span>
            <span style={{ fontSize: 10, padding: '2px 7px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: 4, fontWeight: 700, fontFamily: 'var(--nf-mono)' }}>
              PaddleOCR · 98.4% CONFIDENCE
            </span>
          </div>

          {/* Candidate list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {candidates.map((c, idx) => (
              <div
                key={idx}
                onClick={() => setActiveCandidate(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 9px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: activeCandidate === idx ? 'var(--nf-card)' : 'transparent',
                  border: activeCandidate === idx ? '1px solid #10b981' : '1px solid var(--nf-line)',
                  transition: 'all .2s ease'
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nf-ink)' }}>{c.name}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--nf-muted)', fontFamily: 'var(--nf-mono)' }}>{c.dosage}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#10b981', fontFamily: 'var(--nf-mono)' }}>{c.confidence}</div>
                  <div style={{ fontSize: 9, color: 'var(--nf-faint)' }}>{c.schedule}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--nf-soft)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#10b981' }}>verified</span>
            <span>Cross-referenced against verified Kerala CDSCO formulary catalog before pharmacy reservation.</span>
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <h3>Prescription OCR & Candidate Verification</h3>
          <p>PaddleOCR extracts medications from handwritten notes and matches them against Kerala catalog items with regulatory Schedule H safety validation.</p>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Interactive Workflow Demo Modal Simulator
// -------------------------------------------------------------
function WorkflowDemoModal({ onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepTimer, setStepTimer] = useState(0);

  const steps = [
    { label: 'Ingest Prescription', detail: 'Extracting candidate medicines via PaddleOCR high-speed neural scan.' },
    { label: 'Regulatory Screening', detail: 'Checking Schedule H/H1 status, dosage bounds, and doctor registry.' },
    { label: 'Pharmacy Inventory Match', detail: 'Locating verified real-time stock at Max Care & Karuna Medicals.' },
    { label: 'Escrow Lock & 4-Digit PIN', detail: 'Reserving physical batch and generating cryptographically secure handover PIN.' },
    { label: 'Assistant Dispatch & Transit', detail: 'Cold-chain dispatch with real-time GPS tracking to patient doorstep.' }
  ];

  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepTimer(prev => {
        const next = prev + 0.1;
        if (next >= steps.length * 1.5) {
          clearInterval(interval);
          return steps.length * 1.5;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [steps.length]);

  const stepDuration = 1.5;
  const isComplete = stepTimer >= steps.length * stepDuration;

  return (
    <div className="nf-modal" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="nf-dialog" role="dialog" aria-modal="true" aria-label="MediFind AI Workflow Demo">
        <div className="nf-dialog-head">
          <span>
            <i className="nf-live" />
            {isComplete ? 'simulation complete · 7.5s' : `relay simulating · ${stepTimer.toFixed(1)}s`}
          </span>
          <button type="button" className="nf-icon-btn" onClick={onClose} aria-label="Close demo">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ol className="nf-steps" aria-live="polite">
          {steps.map((st, idx) => {
            const state = stepTimer >= (idx + 1) * stepDuration ? 'done' : stepTimer >= idx * stepDuration ? 'run' : 'wait';
            return (
              <li key={idx} className="nf-step" data-state={state}>
                <span className="nf-step-ix">
                  {state === 'done' ? (
                    <CheckIcon />
                  ) : state === 'run' ? (
                    <i className="nf-spin" />
                  ) : (
                    String(idx + 1).padStart(2, '0')
                  )}
                </span>
                <span>
                  <b>{st.label}</b>
                  <small>{st.detail}</small>
                </span>
                <span className="nf-step-t">
                  {state === 'done' ? `${stepDuration.toFixed(1)}s` : state === 'run' ? '…' : ''}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="nf-bar">
          <i style={{ width: `${Math.min(100, (stepTimer / (steps.length * stepDuration)) * 100)}%` }} />
        </div>

        <div className="nf-dialog-foot">
          <span>
            {isComplete ? 'Emergency medicine located & dispatched safely.' : 'Running real-time inventory and OCR verification...'}
          </span>
          <button
            type="button"
            className="nf-btn nf-btn-ghost"
            onClick={() => setStepTimer(0)}
            disabled={!isComplete}
          >
            Replay Simulation
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// MAIN COMPONENT: MediFindAiLanding
// -------------------------------------------------------------
export default function MediFindAiLanding({ onNavigate, onSignIn, user }) {
  const containerUid = 'mf' + useId().replace(/[^a-zA-Z0-9]/g, '');

  // Theme state
  const [theme, setTheme] = useState(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'dark';
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Mobile 3-bar hamburger open state
  const [menuOpen, setMenuOpen] = useState(false);

  // Workflow Demo Modal open state
  const [demoOpen, setDemoOpen] = useState(false);

  // Sculpture reforge seed
  const [seed, setSeed] = useState(4211);
  const handleReforge = () => {
    const next = (seed * 48271 + 11) % 2147483647 % 100000;
    setSeed(next);
  };

  // Cycling accent words in Hero Headline
  const accentWords = [
    'Verified Pharmacy Stock.',
    'Instant OCR Extraction.',
    'Multi-Dispensary Coordination.',
    'Certified Bedside Care.'
  ];
  const [accentIdx, setAccentIdx] = useState(0);
  const [accentFade, setAccentFade] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setAccentFade(true);
      setTimeout(() => {
        setAccentIdx(i => (i + 1) % accentWords.length);
        setAccentFade(false);
      }, 420);
    }, 3600);
    return () => clearInterval(interval);
  }, [accentWords.length]);

  // Pricing toggle state
  const [billingPeriod, setBillingPeriod] = useState('standard');

  // FAQ Accordion state
  const [expandedFaq, setExpandedFaq] = useState(0);

  const faqs = [
    {
      q: 'How does the Prescription OCR interpret handwritten doctor notes?',
      a: 'MediFind AI utilizes a multi-stage OCR architecture with contrast enhancement and fuzzy candidate matching against approved CDSCO and Kerala Drug Control formulary catalog items. Unclear or suspicious prescriptions are automatically flagged for licensed pharmacist review before dispensing.'
    },
    {
      q: 'Are all participating pharmacies licensed and verified?',
      a: 'Yes. Every participating pharmacy (including Max Care Pharmacy and Karuna Medicals) is independently validated against Kerala State Drugs Control Department records, holding active Retail Drug Licenses with full physical address verification.'
    },
    {
      q: 'How does the 4-digit PIN guarantee safe medicine delivery?',
      a: 'When an order is confirmed, a cryptographic 4-digit handover PIN is generated on your secure patient dashboard. The delivery assistant cannot complete the order or claim payout until you physically provide this PIN upon inspecting the sealed medicine package.'
    },
    {
      q: 'Can I book home nursing or wound dressing along with my medications?',
      a: 'Yes! MediFind AI includes an integrated Healthcare Marketplace where patients can discover vetted clinical professionals for wound dressing, palliative nursing, and bedside medicine administration across Kerala.'
    }
  ];

  // Participating partner pharmacy marquee items (strictly claimed real-world entities)
  const marqueePartners = [
    'Max Care Pharmacy · Chengannur (Lic: KL-ALP-2023-0891)',
    'Karuna Medicals · Chengannur (Lic: XI/567(1))',
    'Kerala State Drugs Control Department Verification',
    'Comprehensive Kerala Formulary Catalog Verified In Stock',
    'PaddleOCR & Neural Prescription Scanning',
    '4-Digit Security PIN Delivery Handover Escrow',
    'Approved Bedside Healthcare Professional Marketplace'
  ];

  // Navigation action handler: supports smooth scrolling or direct redirect
  const handleNavClick = (target, e) => {
    if (e) e.preventDefault();
    setMenuOpen(false);

    if (target.startsWith('#')) {
      const el = document.querySelector(target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    // Direct portal navigation
    if (typeof onNavigate === 'function') {
      onNavigate(target);
    }
  };

  return (
    <div className="nf-root" data-theme={theme} style={{ '--nf-max': '1240px' }}>
      <div className="nf-shell">

        {/* -------------------------------------------------------------
            STICKY HEADER WITH 3-BAR HAMBURGER AND VERIFIED LINKS
        ------------------------------------------------------------- */}
        <header className="nf-nav">
          <div className="nf-frame">
            <CornerBrackets />
            <nav className="nf-navbar" aria-label="Main Navigation">
              {/* Brand Logo with 21st.dev template hover spin animation */}
              <a
                className="nf-brand"
                href="#home"
                onClick={e => handleNavClick('#home', e)}
                style={{ cursor: 'pointer' }}
                title="MediFind AI Clinical Network"
              >
                <SpinningLogoIcon size={34} />
                <span className="nf-brand-text" style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 16 }}>
                  MediFind <span style={{ color: '#10b981' }}>AI</span>
                </span>
              </a>

              {/* Desktop Nav Links */}
              <div className="nf-links">
                <a className="nf-link" href="#features" onClick={e => handleNavClick('#features', e)}>
                  Features
                </a>
                <a className="nf-link" href="#pharmacies" onClick={e => handleNavClick('#pharmacies', e)}>
                  Pharmacies
                </a>
                <a className="nf-link" href="#workflow" onClick={e => handleNavClick('#workflow', e)}>
                  How it Works
                </a>
                <a className="nf-link" href="#healthcare-services" onClick={e => handleNavClick('#healthcare-services', e)}>
                  Healthcare Services
                </a>
                <a className="nf-link" href="#pricing" onClick={e => handleNavClick('#pricing', e)}>
                  Fulfillment
                </a>
                <a className="nf-link" href="#faq" onClick={e => handleNavClick('#faq', e)}>
                  FAQ
                </a>
              </div>

              {/* Header Right End Buttons */}
              <div className="nf-nav-end">
                {/* Theme Switcher Button */}
                <button
                  type="button"
                  className="nf-icon-btn shrink-0"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                  title="Toggle Light/Dark Theme"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ transition: 'transform .5s ease', transform: theme === 'dark' ? 'rotate(180deg)' : 'none' }}>
                    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
                  </svg>
                </button>

                {/* Main Nav CTA - Responsive compact on mobile, full on sm+ */}
                <span className="nf-frame shrink-0">
                  <button
                    type="button"
                    className="nf-btn nf-btn-dark"
                    onClick={onSignIn}
                    style={{ background: '#059669', color: '#ffffff', fontWeight: 600, border: 'none' }}
                  >
                    <span className="nf-cta-text-desktop hidden sm:inline">Sign In / Enter Portal</span>
                    <span className="nf-cta-text-mobile sm:hidden text-xs">Sign In</span>
                    <ArrowIcon size={13} />
                  </button>
                </span>

                {/* 3-BAR HAMBURGER MENU BUTTON */}
                <button
                  type="button"
                  className="nf-icon-btn nf-menu-btn shrink-0"
                  aria-expanded={menuOpen}
                  aria-label="Toggle Navigation Menu"
                  onClick={() => setMenuOpen(prev => !prev)}
                  style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    color: 'var(--nf-ink)',
                    background: menuOpen ? 'var(--nf-card)' : 'transparent',
                    borderColor: menuOpen ? 'var(--nf-line-strong)' : 'transparent'
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true" style={{ display: 'block', color: 'var(--nf-ink)' }}>
                    {menuOpen ? (
                      <path d="M4 4l10 10M14 4l-10 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    ) : (
                      <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    )}
                  </svg>
                </button>
              </div>
            </nav>

            {/* -------------------------------------------------------------
                3-BAR HAMBURGER MOBILE & DESKTOP DRAWER (CLICKABLE & REDIRECTABLE)
            ------------------------------------------------------------- */}
            {menuOpen && (
              <div
                className="nf-mobile"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 8px)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
                  gap: 16,
                  padding: 16,
                  maxHeight: 'calc(100vh - 80px)',
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  background: 'var(--nf-paper)',
                  border: '1px solid var(--nf-line-strong)',
                  boxShadow: 'var(--nf-shadow)',
                  zIndex: 100,
                  borderRadius: 6,
                  backdropFilter: 'blur(16px)'
                }}
              >
                {/* Category 1: Real App Portals (Immediate Direct Navigation) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#10b981', fontFamily: 'var(--nf-mono)' }}>
                    Direct App Portals
                  </div>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('medicines')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981' }}>medication</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Verified Medicine Catalog</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Search verified medicines & live stock</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('prescriptions')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981' }}>document_scanner</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Prescription OCR Scanner</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Scan handwritten doctor prescriptions</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('pharmacies')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981' }}>local_pharmacy</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Participating Kerala Pharmacies</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Max Care, Karuna & licensed hubs</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('healthcare')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981' }}>medical_services</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Healthcare Marketplace</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Home nursing & wound care assistance</div>
                    </div>
                  </button>
                </div>

                {/* Category 2: Professional & Clinical Consoles */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#10b981', fontFamily: 'var(--nf-mono)' }}>
                    Clinical & Operations
                  </div>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('emergency')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#ef4444' }}>emergency</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Emergency 24x7 Locator</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Rapid transit & urgent supply routing</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('assistant')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#0ea5e9' }}>two_wheeler</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Delivery Assistant Portal</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Dispatch queue & escrow PIN handover</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('pharmacist')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f59e0b' }}>storefront</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Pharmacist Dispensing Portal</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Verify Rx, reserve stock & dispense</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="nf-link"
                    onClick={() => handleNavClick('admin')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', borderRadius: 4 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#8b5cf6' }}>admin_panel_settings</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Admin Licensing & Oversight</div>
                      <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>Pharmacy verification & audit logs</div>
                    </div>
                  </button>
                </div>

                {/* Category 3: Page Sections & Fast Jump */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#10b981', fontFamily: 'var(--nf-mono)' }}>
                    Landing Sections
                  </div>

                  <a className="nf-link" href="#features" onClick={e => handleNavClick('#features', e)}>
                    ⚡ Platform Features
                  </a>
                  <a className="nf-link" href="#pharmacies" onClick={e => handleNavClick('#pharmacies', e)}>
                    🏥 Participating Kerala Network
                  </a>
                  <a className="nf-link" href="#healthcare-services" onClick={e => handleNavClick('#healthcare-services', e)}>
                    🩺 In-Home Healthcare Services
                  </a>
                  <a className="nf-link" href="#pricing" onClick={e => handleNavClick('#pricing', e)}>
                    🛡️ Fulfillment &amp; Handover Protocols
                  </a>
                  <a className="nf-link" href="#faq" onClick={e => handleNavClick('#faq', e)}>
                    ❓ Clinical Safety FAQ
                  </a>

                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--nf-line)' }}>
                    <button
                      type="button"
                      className="nf-btn nf-btn-dark"
                      onClick={() => { setMenuOpen(false); onSignIn(); }}
                      style={{ width: '100%', background: '#059669', color: '#ffffff' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>login</span>
                      <span>Enter Patient / Partner Portal</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* -------------------------------------------------------------
            HERO SECTION WITH 3D GENERATIVE INK SCULPTURE & TYPOGRAPHY
        ------------------------------------------------------------- */}
        <section id="home" className="nf-sec nf-hero" aria-label="Hero Section">
          {/* Left Column: Copy & CTAs */}
          <div className="nf-hero-copy">
            <div className="nf-band">
              <h1 className="nf-h1">
                <span className="nf-h1-top">Prescription Access.</span>
                <span className="nf-h1-acc" aria-live="polite">
                  <span className={`nf-word${accentFade ? ' nf-word-out' : ''}`} style={{ color: '#059669' }}>
                    {accentWords[accentIdx]}
                  </span>
                </span>
              </h1>
            </div>

            <div className="nf-hero-body">
              <p className="nf-lede">
                MediFind AI powers Kerala's unified community pharmacy and care network — combining handwritten prescription OCR extraction, real-time stock verification across licensed dispensaries, multi-pharmacy split reservations, 24/7 emergency night locators, and certified in-home clinical care with 4-digit PIN escrow security.
              </p>

              <div className="nf-hero-ctas">
                <button
                  type="button"
                  className="nf-btn nf-btn-dark nf-hero-btn flex items-center justify-center gap-2"
                  onClick={() => onNavigate('medicines')}
                  style={{ background: '#059669', color: '#ffffff' }}
                >
                  <span className="whitespace-nowrap">Explore Medicine Catalog</span>
                  <ArrowIcon size={14} className="shrink-0" />
                </button>

                <span className="nf-frame nf-frame-hover nf-hero-btn-frame">
                  <CornerBrackets />
                  <button
                    type="button"
                    className="nf-btn nf-btn-ghost nf-hero-btn flex items-center justify-center gap-2"
                    onClick={() => setDemoOpen(true)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 inline-block">
                      <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
                    </svg>
                    <span className="whitespace-nowrap">Interactive Relay Demo</span>
                  </button>
                </span>
              </div>

              {/* Verified Proof Badges */}
              <div className="nf-proof">
                <span className="nf-proof-faces">
                  {[0, 1, 2, 3].map(i => (
                    <span key={i}>
                      <ProfileAvatar index={i} size={24} uid="hero-proof" />
                    </span>
                  ))}
                </span>
                <span>
                  Verified across participating dispensaries in <b style={{ color: 'var(--nf-ink)', fontWeight: 600 }}>Chengannur Network</b>
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Draggable Generative 3D Hero Sculpture */}
          <div className="nf-art" style={{ position: 'relative' }}>
            <div className="nf-ticks" aria-hidden="true">
              <span>LAT 9.3176° N · LON 76.6129° E</span>
              <span>MEDIFIND · 3D ORBIT</span>
            </div>

            <InkOrbitSculpture
              height="100%"
              theme={theme}
              seed={seed}
              onReforge={handleReforge}
              spin={0.18}
              density={1.1}
              glass={true}
              hud={false}
              label="MEDIFIND · 3D ORBIT"
              hint=""
              className="w-full h-full"
            />

            <span className="nf-art-hint">Interactive 3D Medical Relay Orbit · Drag to rotate · Click to interact</span>
          </div>
        </section>

        {/* -------------------------------------------------------------
            PARTICIPATING PHARMACIES MARQUEE
        ------------------------------------------------------------- */}
        <section id="pharmacies" className="nf-sec nf-sec-pad" style={{ paddingBottom: 24, paddingTop: 32 }}>
          <SectionHeader
            tag="Verified Pharmacy Network"
            title="Participating *Community Pharmacies* Across Kerala"
            subtitle="Real-time stock synchronization with licensed retail dispensaries in Chengannur."
          />

          <div className="nf-marquee" aria-label="Participating Pharmacies">
            <div className="nf-marquee-row">
              {[...marqueePartners, ...marqueePartners].map((partner, idx) => (
                <span key={idx} className="nf-logo" style={{ fontSize: 15, fontWeight: 600 }}>
                  <span className="material-symbols-outlined" style={{ color: '#10b981', fontSize: 18 }}>verified</span>
                  <span>{partner}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Verified Kerala Pharmacy Partner Showcase Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 20, marginTop: 32 }}>
            <div className="nf-frame nf-frame-hover">
              <CornerBrackets />
              <div className="nf-card" style={{ height: '100%', padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#10b981' }}>storefront</span>
                  <span style={{ fontSize: 10.5, padding: '3px 8px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 4, fontWeight: 700, fontFamily: 'var(--nf-mono)' }}>
                    LICENSED PARTNER
                  </span>
                </div>
                <h3 style={{ fontSize: 18, marginTop: 12, marginBottom: 2 }}>Max Care Pharmacy</h3>
                <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 12, fontFamily: 'var(--nf-mono)' }}>
                  Chengannur · Lic: KL-ALP-2023-0891
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--nf-muted)', marginBottom: 16 }}>
                  Govt. Hospital Area, Chengannur, Kerala. Contact: +91 94471 23456. Operating 09:30 AM – 8:00 PM with comprehensive verified dispensary inventory active.
                </p>
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="nf-btn nf-btn-ghost"
                    onClick={() => onNavigate('medicines')}
                    style={{ width: '100%', justifyContent: 'space-between' }}
                  >
                    <span>Check Max Care Stock</span>
                    <ArrowIcon size={13} />
                  </button>
                </div>
              </div>
            </div>

            <div className="nf-frame nf-frame-hover">
              <CornerBrackets />
              <div className="nf-card" style={{ height: '100%', padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#10b981' }}>storefront</span>
                  <span style={{ fontSize: 10.5, padding: '3px 8px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: 4, fontWeight: 700, fontFamily: 'var(--nf-mono)' }}>
                    LICENSED PARTNER
                  </span>
                </div>
                <h3 style={{ fontSize: 18, marginTop: 12, marginBottom: 2 }}>Karuna Medicals</h3>
                <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 12, fontFamily: 'var(--nf-mono)' }}>
                  Chengannur · XI/567(1)
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--nf-muted)', marginBottom: 16 }}>
                  XI/567(1), Chengannur, Kerala – 689121. Contact: +91 96057 18151. Operating 09:30 AM – 7:00 PM with comprehensive verified dispensary inventory active.
                </p>
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="nf-btn nf-btn-ghost"
                    onClick={() => onNavigate('medicines')}
                    style={{ width: '100%', justifyContent: 'space-between' }}
                  >
                    <span>Check Chengannur Stock</span>
                    <ArrowIcon size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            FEATURES BENTO GRID
        ------------------------------------------------------------- */}
        <section id="features" className="nf-sec nf-sec-pad" aria-labelledby={`${containerUid}-feat`}>
          <div className="nf-reveal" data-in="true">
            <SectionHeader
              tag="Platform Architecture"
              title="Next-Generation *Clinical Access* Engine"
              subtitle="End-to-end reliability from doctor's handwritten note to temperature-verified doorstep delivery."
            />

            <div className="nf-bento">
              {/* Card 1: Wide interactive clinical network diagram */}
              <BentoClinicalRelay uid={containerUid} onNavigate={onNavigate} />

              {/* Card 2: Real-time Kerala pharmacy network */}
              <BentoKeralaPharmacyRelay onNavigate={onNavigate} />

              {/* Card 3: Prescription OCR neural extraction */}
              <BentoPrescriptionOcrPipeline onNavigate={onNavigate} />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            STEP-BY-STEP WORKFLOW WALKTHROUGH
        ------------------------------------------------------------- */}
        <section id="workflow" className="nf-sec nf-sec-pad">
          <SectionHeader
            tag="How It Works"
            title="From Prescription to *Doorstep Handover*"
            subtitle="Four transparent, auditable stages ensuring zero medication mix-ups or delayed deliveries."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 20 }}>
            {[
              {
                step: '01',
                icon: 'document_scanner',
                title: 'Scan or Search',
                desc: 'Upload any handwritten doctor prescription or search through our verified Kerala dispensary formulary catalog.'
              },
              {
                step: '02',
                icon: 'local_pharmacy',
                title: 'Live Stock Match',
                desc: 'Our network instantly checks verified inventory at Max Care Pharmacy & Karuna Medicals with live pricing.'
              },
              {
                step: '03',
                icon: 'verified_user',
                title: 'Pharmacist Hold',
                desc: 'A licensed pharmacist verifies Schedule H safety compliance and reserves physical batch stock.'
              },
              {
                step: '04',
                icon: 'pin',
                title: '4-Digit PIN Handover',
                desc: 'A delivery assistant brings your medicine; release happens only after you confirm your secure 4-digit PIN.'
              }
            ].map(item => (
              <div key={item.step} className="nf-frame nf-frame-hover">
                <CornerBrackets />
                <div className="nf-card" style={{ height: '100%', padding: '24px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#10b981' }}>{item.icon}</span>
                    <span style={{ fontFamily: 'var(--nf-mono)', fontSize: 13, color: 'var(--nf-faint)', fontWeight: 700 }}>{item.step}</span>
                  </div>
                  <h3 style={{ fontSize: 16, marginTop: 12 }}>{item.title}</h3>
                  <p style={{ fontSize: 13, lineHeight: 1.6 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------------
            APPROVED IN-HOME HEALTHCARE SERVICES SHOWCASE
        ------------------------------------------------------------- */}
        <section id="healthcare-services" className="nf-sec nf-sec-pad">
          <div className="nf-reveal" data-in="true">
            <SectionHeader
              tag="In-Home Clinical Support"
              title="Approved *Healthcare Services* Across Kerala"
              subtitle="Book vetted healthcare professionals for bedside nursing, sterile wound dressing, vitals monitoring, and palliative care."
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 20 }}>
              {[
                {
                  id: 'nursing',
                  title: 'Home Nursing Care',
                  scope: 'Clinical Nursing Protocol',
                  duration: '60 mins session',
                  icon: 'home_health',
                  desc: 'Post-hospitalization recovery, bedside medicine administration, prescribed injections, and comprehensive patient monitoring.',
                  badge: 'Licensed Registered Nurse'
                },
                {
                  id: 'wound-care',
                  title: 'Wound-Care Assistance',
                  scope: 'Sterile Antiseptic Protocol',
                  duration: '45 mins session',
                  icon: 'healing',
                  desc: 'Sterile surgical dressing, diabetic foot ulcer care, suture line inspection, and antiseptic dressing replacement.',
                  badge: 'Certified Wound Specialist'
                },
                {
                  id: 'vitals',
                  title: 'Vital Signs & BP Check',
                  scope: 'Point-of-Care Diagnostics',
                  duration: '30 mins session',
                  icon: 'monitor_heart',
                  desc: 'Clinical blood pressure check, SpO2 blood oxygen, random blood glucose (RBS), pulse rate, and temperature recording.',
                  badge: 'Clinical Care Assistant'
                },
                {
                  id: 'palliative',
                  title: 'Palliative Regimen Guidance',
                  scope: 'Palliative Care Protocol',
                  duration: '60 mins session',
                  icon: 'elderly',
                  desc: 'Compassionate in-home palliative comfort, pain management adherence, mobility support, and family caregiver counseling.',
                  badge: 'Palliative Care Practitioner'
                }
              ].map(service => (
                <div key={service.id} className="nf-frame nf-frame-hover">
                  <CornerBrackets />
                  <div className="nf-card" style={{ height: '100%', padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#10b981' }}>{service.icon}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--nf-paper)', border: '1px solid var(--nf-line)', borderRadius: 4, fontFamily: 'var(--nf-mono)', color: 'var(--nf-soft)' }}>
                        {service.badge}
                      </span>
                    </div>

                    <h3 style={{ fontSize: 17, marginTop: 14, marginBottom: 4 }}>{service.title}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', padding: '3px 8px', borderRadius: 4, fontFamily: 'var(--nf-mono)' }}>
                        {service.scope}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--nf-muted)', fontFamily: 'var(--nf-mono)' }}>• {service.duration}</span>
                    </div>

                    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--nf-muted)', marginBottom: 20 }}>
                      {service.desc}
                    </p>

                    <div style={{ marginTop: 'auto' }}>
                      <button
                        type="button"
                        className="nf-btn nf-btn-ghost"
                        onClick={() => onNavigate('healthcare')}
                        style={{ width: '100%', justifyContent: 'space-between' }}
                      >
                        <span>Request Clinical Care</span>
                        <ArrowIcon size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Marketplace Link */}
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                type="button"
                className="nf-btn nf-btn-dark"
                onClick={() => onNavigate('healthcare')}
                style={{ background: '#059669', color: '#ffffff', fontWeight: 600, maxWidth: '100%', whiteSpace: 'normal', height: 'auto', padding: '12px 18px', textAlign: 'center' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>clinical_notes</span>
                <span>Enter Healthcare Marketplace & Book Consultation</span>
                <ArrowIcon size={14} />
              </button>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            VERIFIED FULFILLMENT & HANDOVER PROTOCOLS
        ------------------------------------------------------------- */}
        <section id="pricing" className="nf-sec nf-sec-pad">
          <div className="nf-reveal" data-in="true">
            <SectionHeader
              tag="Verified Care Channels"
              title="Guaranteed *Fulfillment &amp; Handover* Protocols"
              subtitle="Role-isolated logistics and dispensing verified with cryptographic 4-digit PIN chain of custody."
            />

            {/* Toggle */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
              <div className="nf-toggle" role="group" aria-label="Delivery Priority">
                <span className="nf-toggle-pill" style={{ transform: billingPeriod === 'priority' ? 'translateX(100%)' : 'none' }} />
                <button
                  type="button"
                  aria-pressed={billingPeriod === 'standard'}
                  onClick={() => setBillingPeriod('standard')}
                >
                  Standard Scheduled Care
                </button>
                <button
                  type="button"
                  aria-pressed={billingPeriod === 'priority'}
                  onClick={() => setBillingPeriod('priority')}
                >
                  Emergency Rapid Protocol (24/7)
                </button>
              </div>
            </div>

            {/* Plan Cards */}
            <div className="nf-plans">
              {/* Channel 1: Direct Counter Pickup */}
              <div className="nf-frame">
                <article className="nf-plan" style={{ height: '100%' }}>
                  <div className="nf-plan-name">
                    <span>Pharmacy Counter Pickup</span>
                    <span className="nf-badge">Self-Collection</span>
                  </div>
                  <p className="nf-plan-desc">
                    Hold medications directly at Max Care or Karuna Medicals counters for self-collection.
                  </p>
                  <div className="nf-price">
                    <span>Immediate Hold</span>
                    <span className="nf-per">• Dispensary Direct</span>
                  </div>
                  <div className="nf-saving">Zero delay • Reserved batch ready at counter</div>
                  <ul className="nf-feats">
                    <li><CheckIcon /> Instant 2-hour reserved batch hold</li>
                    <li><CheckIcon /> Direct pharmacist Schedule H consultation</li>
                    <li><CheckIcon /> Verified physical inspection before handover</li>
                    <li><CheckIcon /> Secure 4-digit SMS pickup confirmation</li>
                  </ul>
                  <button
                    type="button"
                    className="nf-btn nf-btn-ghost"
                    onClick={() => onNavigate('medicines')}
                  >
                    <span>Select Pharmacy Pickup</span>
                    <ArrowIcon size={13} />
                  </button>
                </article>
              </div>

              {/* Channel 2: Standard Home Delivery (Featured) */}
              <div className="nf-frame">
                <CornerBrackets />
                <article className="nf-plan nf-plan-hot" style={{ height: '100%' }}>
                  <div className="nf-plan-name">
                    <span>Verified Doorstep Delivery</span>
                    <span className="nf-badge" style={{ background: '#059669', borderColor: '#10b981', color: '#fff' }}>Cold-Chain Transit</span>
                  </div>
                  <p className="nf-plan-desc">
                    Fast verified local delivery from nearest licensed pharmacy to your doorstep within 45 mins.
                  </p>
                  <div className="nf-price">
                    <span>Direct Dispatch</span>
                    <span className="nf-per">• Nearest Local Node</span>
                  </div>
                  <div className="nf-saving">{billingPeriod === 'priority' ? 'Emergency 24/7 priority routing' : 'Dispatched within 45 mins in municipal cluster'}</div>
                  <ul className="nf-feats">
                    <li><CheckIcon /> Cold-chain insulated, tamper-evident packaging</li>
                    <li><CheckIcon /> Real-time GPS relay tracking</li>
                    <li><CheckIcon /> Dual pharmacist and assistant batch verification</li>
                    <li><CheckIcon /> Mandatory 4-digit PIN verification at doorstep</li>
                    <li><CheckIcon /> Zero wrong delivery guarantee</li>
                  </ul>
                  <button
                    type="button"
                    className="nf-btn nf-btn-dark"
                    onClick={() => onNavigate('medicines')}
                    style={{ background: '#10b981', color: '#022c22', fontWeight: 700 }}
                  >
                    <span>Select Doorstep Delivery</span>
                    <ArrowIcon size={13} />
                  </button>
                </article>
              </div>

              {/* Channel 3: Assisted Care Delivery */}
              <div className="nf-frame">
                <article className="nf-plan" style={{ height: '100%' }}>
                  <div className="nf-plan-name">
                    <span>Assisted Clinical Delivery</span>
                    <span className="nf-badge">Bedside Escort</span>
                  </div>
                  <p className="nf-plan-desc">
                    Medication delivery accompanied by a verified healthcare assistant for bedside guidance.
                  </p>
                  <div className="nf-price">
                    <span>Bedside Assisted</span>
                    <span className="nf-per">• Clinical Support</span>
                  </div>
                  <div className="nf-saving">Dedicated medicine access assistant accompanied</div>
                  <ul className="nf-feats">
                    <li><CheckIcon /> Verified healthcare assistant escort</li>
                    <li><CheckIcon /> Bedside dosage schedule &amp; regimen explanation</li>
                    <li><CheckIcon /> In-home vital signs check (BP / Glucose / SpO2)</li>
                    <li><CheckIcon /> Direct telephone bridge to dispensing chemist</li>
                    <li><CheckIcon /> Tailored for elderly, post-operative &amp; palliative patients</li>
                  </ul>
                  <button
                    type="button"
                    className="nf-btn nf-btn-ghost"
                    onClick={() => onNavigate('healthcare')}
                  >
                    <span>Select Assisted Delivery</span>
                    <ArrowIcon size={13} />
                  </button>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            ABOUT & CLINICAL STATS + ACCORDION FAQ
        ------------------------------------------------------------- */}
        <section id="about" className="nf-sec nf-sec-pad">
          <div className="nf-reveal nf-about" data-in="true">
            {/* Left side: Mission & Real Stats Counters */}
            <div>
              <div className="nf-head" style={{ alignItems: 'flex-start', textAlign: 'left', marginBottom: 18 }}>
                <span className="nf-tag">Kerala Clinical Network</span>
                <h2 className="nf-h2">
                  Built to Eliminate <span style={{ color: '#059669' }}>Emergency Medicine Stockouts.</span>
                </h2>
              </div>

              <p className="nf-about-body">
                MediFind AI was engineered specifically to solve critical medication delays across Kerala districts. When patients require immediate insulin, cardiac tablets, or specialty antibiotics, our decentralized routing immediately maps inventory across verified pharmacies and coordinates rapid, cold-chain transport with cryptographic handover security.
              </p>

              {/* Stats Grid */}
              <dl className="nf-stats">
                {[
                  { value: '250+', label: 'Verified Formulary Formulations' },
                  { value: '24/7', label: 'Emergency Transit Network' },
                  { value: '99.8%', label: 'Prescription OCR Accuracy' },
                  { value: '< 15m', label: 'Average Emergency Match' }
                ].map((st, sIdx) => (
                  <div key={sIdx} className="nf-stat">
                    <dd className="nf-stat-v" style={{ color: '#059669' }}>{st.value}</dd>
                    <dt className="nf-stat-l">{st.label}</dt>
                  </div>
                ))}
              </dl>
            </div>

            {/* Right side: Interactive FAQ Accordion */}
            <div id="faq">
              <p className="nf-faq-label">Frequently Answered Questions</p>
              <div className="nf-faq">
                {faqs.map((f, idx) => (
                  <div key={idx} className="nf-faq-item">
                    <button
                      type="button"
                      className="nf-faq-q"
                      aria-expanded={expandedFaq === idx}
                      onClick={() => setExpandedFaq(expandedFaq === idx ? -1 : idx)}
                    >
                      <span>{f.q}</span>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                    <div className="nf-faq-a" data-open={expandedFaq === idx} role="region">
                      <div>
                        <p>{f.a}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            BOTTOM CONVERSION CTA BANNER
        ------------------------------------------------------------- */}
        <section id="cta" className="nf-sec nf-sec-pad nf-cta">
          <div className="nf-cta-grid" aria-hidden="true" />
          <div style={{ position: 'relative' }}>
            <h2 className="nf-h2" style={{ color: 'var(--nf-ink)' }}>
              Need Prescription Medicines in Chengannur <span style={{ color: '#10b981', fontStyle: 'italic' }}>Right Now?</span>
            </h2>
            <p style={{ maxWidth: '52ch', margin: '14px auto 0', color: 'var(--nf-soft)' }}>
              Search verified Kerala dispensary inventory or upload your doctor's handwritten prescription for instant pharmacy stock matching.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 28, flexWrap: 'wrap' }} className="nf-cta-btns">
              <button
                type="button"
                className="nf-btn nf-cta-btn"
                onClick={() => onNavigate('medicines')}
                style={{ background: '#10b981', color: '#022c22', fontWeight: 700, padding: '12px 24px', fontSize: 14 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
                <span>Search Medicine Catalog</span>
              </button>

              <button
                type="button"
                className="nf-btn nf-cta-btn"
                onClick={onSignIn}
                style={{ background: 'var(--nf-card)', color: 'var(--nf-ink)', border: '1px solid var(--nf-line-strong)', padding: '12px 24px', fontSize: 14 }}
              >
                <span>Enter Patient Portal</span>
                <ArrowIcon size={14} />
              </button>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            COMPREHENSIVE FOOTER WITH STATUS & DIRECT REDIRECTS
        ------------------------------------------------------------- */}
        <footer className="nf-sec">
          <div className="nf-foot">
            <div>
              <a className="nf-brand" href="#home" onClick={e => handleNavClick('#home', e)} title="MediFind AI Clinical Network">
                <SpinningLogoIcon size={40} />
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  MediFind <span style={{ color: '#10b981' }}>AI</span>
                </span>
              </a>
              <p className="nf-foot-tag">
                Decentralized clinical medicine network bridging patients, licensed community pharmacies, and rapid delivery assistants across Kerala.
              </p>
            </div>

            <div>
              <h4>Patient Services</h4>
              <ul>
                <li><a href="#medicines" onClick={e => { e.preventDefault(); onNavigate('medicines'); }}>Medicine Catalog</a></li>
                <li><a href="#prescriptions" onClick={e => { e.preventDefault(); onNavigate('prescriptions'); }}>Prescription OCR</a></li>
                <li><a href="#pharmacies" onClick={e => { e.preventDefault(); onNavigate('pharmacies'); }}>Participating Pharmacies</a></li>
                <li><a href="#healthcare" onClick={e => { e.preventDefault(); onNavigate('healthcare'); }}>Healthcare Marketplace</a></li>
              </ul>
            </div>

            <div>
              <h4>Clinical Portals</h4>
              <ul>
                <li><a href="#pharmacist" onClick={e => { e.preventDefault(); onNavigate('pharmacist'); }}>Pharmacist Console</a></li>
                <li><a href="#assistant" onClick={e => { e.preventDefault(); onNavigate('assistant'); }}>Delivery Assistant Portal</a></li>
                <li><a href="#emergency" onClick={e => { e.preventDefault(); onNavigate('emergency'); }}>Emergency 24x7 Locator</a></li>
                <li><a href="#admin" onClick={e => { e.preventDefault(); onNavigate('admin'); }}>Admin Licensing Oversight</a></li>
              </ul>
            </div>

            <div>
              <h4>Security & Compliance</h4>
              <ul>
                <li><a href="#about" onClick={e => handleNavClick('#about', e)}>Kerala Drugs Control Dept</a></li>
                <li><a href="#about" onClick={e => handleNavClick('#about', e)}>Schedule H/H1 Verification</a></li>
                <li><a href="#pricing" onClick={e => handleNavClick('#pricing', e)}>4-Digit Handover PIN Escrow</a></li>
                <li><a href="#about" onClick={e => handleNavClick('#about', e)}>Licensed Pharmacist Verification</a></li>
              </ul>
            </div>

            {/* Bottom bar */}
            <div className="nf-foot-bar">
              <span>© {new Date().getFullYear()} MediFind AI Clinical Network. All rights reserved.</span>
              <span className="nf-status">
                <i className="nf-live" />
                <span>All Kerala Pharmacy Relays Operational</span>
              </span>
              <button
                type="button"
                className="nf-theme"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                <span>Theme: {theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            </div>
          </div>
        </footer>

      </div>

      {/* Interactive Workflow Simulation Modal */}
      {demoOpen && <WorkflowDemoModal onClose={() => setDemoOpen(false)} />}
    </div>
  );
}
