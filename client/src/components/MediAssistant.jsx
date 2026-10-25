import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import VoicePoweredOrb from './VoicePoweredOrb';

/* ─── Intent engine ─────────────────────────────────────────────────────── */
const INTENTS = [
  {
    id: 'medicines',
    keywords: ['medicine','medicines','drug','drugs','tablet','capsule','search','find medicine',
      'paracetamol','amoxicillin','metformin','insulin','dolo','antibiotic','syrup',
      'prescription medicine','buy medicine','lookup medicine','check medicine'],
    action: 'navigate', tab: 'medicines', label: 'Medicine Search', icon: 'medication',
    reply: 'Taking you to Medicine Search where you can find and order medicines.',
  },
  {
    id: 'prescription',
    keywords: ['prescription','upload prescription','doctor prescription','rx','prescribe',
      'scan prescription','ocr','prescription upload','upload my prescription'],
    action: 'navigate', tab: 'prescription', label: 'Prescription Upload', icon: 'receipt_long',
    reply: 'Opening Prescription Upload so you can scan or upload your prescription.',
  },
  {
    id: 'pharmacies',
    keywords: ['pharmacy','pharmacies','medical shop','chemist','dispensary','find pharmacy',
      'nearby pharmacy','local pharmacy','medicine shop','drug store'],
    action: 'navigate', tab: 'pharmacies', label: 'Find Pharmacies', icon: 'local_pharmacy',
    reply: 'Opening Pharmacy Discovery to help you find pharmacies near you.',
  },
  {
    id: 'emergency',
    keywords: ['emergency','urgent','sos','ambulance','critical','emergency pharmacy',
      'duty pharmacy','night pharmacy','24 hour','emergency locator','help urgent'],
    action: 'navigate', tab: 'emergency', label: 'Emergency Locator', icon: 'emergency',
    reply: 'Going to Emergency Locator to find duty pharmacies and emergency services.',
  },
  {
    id: 'orders',
    keywords: ['order','orders','track order','my order','order status','where is my order',
      'delivery','tracking','shipment','order tracking','check order'],
    action: 'navigate', tab: 'orders', label: 'Order Tracking', icon: 'package_2',
    reply: 'Taking you to Order Tracking to check your medicine delivery status.',
  },
  {
    id: 'profile',
    keywords: ['profile','my profile','account','settings','edit profile','my account',
      'personal details','change name','change password','update profile'],
    action: 'navigate', tab: 'profile', label: 'My Profile', icon: 'person',
    reply: 'Opening your profile page. You can view and edit your details there.',
  },
  {
    id: 'help_general',
    keywords: ['help','how','what can you do','guide','assist','tutorial','features',
      'what is','what does','explain','show me','tell me'],
    action: 'help', label: 'Help', icon: 'help', reply: null,
  },
];

const HELP_RESPONSE =
  "I am Medi, your MediFind AI assistant!\n\nHere is what I can do:\n" +
  "  Find medicines: say 'find paracetamol'\n" +
  "  Add to cart: say 'add dolo 650 to cart'\n" +
  "  Upload prescription: say 'upload my prescription'\n" +
  "  Find pharmacies: say 'pharmacy near me'\n" +
  "  Call pharmacy: say 'call pharmacy'\n" +
  "  Reserve medicines: say 'reserve at pharmacy'\n" +
  "  Emergency: say 'emergency pharmacy'\n" +
  "  Track orders: say 'track my order'\n\n" +
  "Just speak naturally and I will guide you!";

const GREETINGS = [
  'Hello! I am Medi, your health assistant. How can I help you today?',
  'Hi there! Medi here. I can help you find medicines, call pharmacies, or place orders!',
  "Hey! I am Medi. Say something like 'add Paracetamol to cart' or 'call pharmacy'.",
];

const FALLBACK_RESPONSES = [
  "I am not sure I understood that. Try: 'add Paracetamol to cart' or 'find pharmacy'.",
  "Hmm, I did not catch that. Try: 'search medicine', 'call pharmacy', or 'track my order'.",
  "Sorry, could not understand. Try: 'order medicine' or 'reserve at pharmacy'.",
];

/* ─── Medicine extraction ───────────────────────────────────────────────── */
const COMMON_MEDICINES = [
  'paracetamol','dolo','crocin','combiflam','ibuprofen','aspirin','amoxicillin',
  'azithromycin','metformin','insulin','omeprazole','pantoprazole','cetirizine',
  'loratadine','atorvastatin','metoprolol','amlodipine','losartan','lisinopril',
  'levothyroxine','prednisolone','dexamethasone','ranitidine','ondansetron',
  'domperidone','metoclopramide','loperamide','albendazole','ivermectin',
  'hydroxychloroquine','montelukast','salbutamol','budesonide','fluticasone',
  'fexofenadine','diphenhydramine','chlorpheniramine','vitamin c','vitamin d',
  'vitamin b12','multivitamin','calcium','iron','folic acid','zinc','magnesium',
  'omega 3','antacid','digene','gelusil','eno','lactulose','bisacodyl','senna',
  'psyllium','isabgol',
];

function extractMedicinesFromText(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const med of COMMON_MEDICINES) {
    if (lower.includes(med)) found.push(med.charAt(0).toUpperCase() + med.slice(1));
  }
  return [...new Set(found)];
}

function isAddToCartIntent(t) {
  const l = t.toLowerCase();
  return ['add','order','buy','get','want','need','purchase','put','cart','list'].some(k => l.includes(k))
    && extractMedicinesFromText(t).length > 0;
}
function isCallPharmacyIntent(t) {
  const l = t.toLowerCase();
  return (l.includes('call')||l.includes('phone')||l.includes('ring')||l.includes('dial')||l.includes('contact'))
    && (l.includes('pharmacy')||l.includes('chemist')||l.includes('medical'));
}
function isDirectReservationCommand(t) {
  const l = t.toLowerCase();
  const hasAction = ['reserve', 'book', 'hold', 'checkout', 'check out', 'buy', 'order'].some(k => l.includes(k));
  const hasTarget = ['nearest', 'any', 'pharmacy', 'chemist', 'dispensary', 'that medicine', 'this medicine', 'store'].some(k => l.includes(k));
  return hasAction && (hasTarget || l.includes('in ') || l.includes('at '));
}

function detectIntent(text) {
  if (!text || !text.trim()) return null;
  const lower = text.toLowerCase().trim();
  if (/^(hi|hello|hey|namaste|good morning|good evening|good afternoon|hola)\b/.test(lower))
    return { id: 'greeting', action: 'greeting' };
  if (isDirectReservationCommand(text)) return { id: 'direct_reservation', action: 'direct_reservation', rawText: text };
  if (isAddToCartIntent(text))    return { id: 'add_to_cart',   action: 'add_to_cart' };
  if (isCallPharmacyIntent(text)) return { id: 'call_pharmacy', action: 'call_pharmacy' };
  if (isReserveIntent(text))      return { id: 'direct_reservation', action: 'direct_reservation', rawText: text };
  if (isCartCheckIntent(text))    return { id: 'view_cart',     action: 'view_cart' };
  if (isCheckoutIntent(text))     return { id: 'checkout',      action: 'checkout', rawText: text };
  let best = null, bestScore = 0;
  for (const intent of INTENTS) {
    let score = 0;
    for (const kw of intent.keywords) if (lower.includes(kw)) score += kw.split(' ').length;
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return bestScore > 0 ? best : null;
}

/* ─── Speech recognition hook ──────────────────────────────────────────── */
function useSpeechRecognition({ onResult, onInterim, onEnd, onError }) {
  const recognitionRef = useRef(null);
  const start = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError?.('not_supported'); return; }
    try {
      if (recognitionRef.current) recognitionRef.current.stop();
      const rec = new SR();
      rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t; else interim += t;
        }
        if (interim) onInterim?.(interim);
        if (final) onResult?.(final.trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') onError?.('permission_denied');
        else onError?.('recognition_error');
      };
      rec.onend = () => { recognitionRef.current = null; onEnd?.(); };
      rec.start(); recognitionRef.current = rec;
    } catch (e) { console.error(e); onError?.('recognition_error'); }
  };
  const stop = () => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(_){} recognitionRef.current = null; }
  };
  return { start, stop };
}

/* ─── ChatBubble ────────────────────────────────────────────────────────── */
function ChatBubble({ message, onActionClick }) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex gap-2 items-end flex-row-reverse' : 'flex gap-2 items-end flex-row'}
      style={{ animation: 'mediBubbleIn 0.25s ease-out' }}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mb-0.5 shadow-xs"
          style={{ background: 'linear-gradient(135deg, #9CB080, #738a59)', border: '1.5px solid #9CB080' }}>
          <span className="text-[#032f28] text-xs font-black" style={{ fontFamily: 'monospace' }}>M</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5 max-w-[82%]">
        <div className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
          style={isUser
            ? { background: 'linear-gradient(135deg, #9CB080, #7a945d)', color: '#ffffff', border: '1px solid #738a59', borderBottomRightRadius: 4, boxShadow: '0 2px 8px rgba(156,176,128,0.3)' }
            : { background: '#ffffff', color: '#032f28', border: '1.5px solid #9CB080', borderBottomLeftRadius: 4, boxShadow: '0 2px 8px rgba(3,47,40,0.06)' }
          }>
          {message.text}
        </div>
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {message.actions.map((action, i) => (
              <button key={i} onClick={() => onActionClick?.(action)}
                className="px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer shadow-xs"
                style={{
                  background: action.primary ? 'linear-gradient(135deg, #9CB080, #7b965e)' : '#ffffff',
                  color: action.primary ? '#ffffff' : '#032f28',
                  border: action.primary ? 'none' : '1.5px solid #9CB080',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}>
                {action.icon && <span className="material-symbols-outlined text-[12px] align-middle mr-1">{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickPill({ label, icon, onClick }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer shadow-2xs"
      style={{ background: '#ffffff', border: '1.5px solid #9CB080', color: '#032f28' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#9CB080'; e.currentTarget.style.color = '#ffffff'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#032f28'; }}>
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
      {label}
    </button>
  );
}

function RobotFaceBot({ isListening = false, isHovered = false, size = 64 }) {
  return (
    <div
      className="relative select-none filter drop-shadow-md transition-transform duration-300"
      style={{
        width: size,
        height: size * 1.05,
        animation: 'botFloat 3s ease-in-out infinite'
      }}
    >
      <svg
        viewBox="0 0 100 105"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible"
      >
        {/* Sparkle rays (visible on hover / listening, exactly from uploaded right illustration) */}
        <g
          className="transition-opacity duration-300"
          style={{ opacity: (isHovered || isListening) ? 1 : 0 }}
        >
          <line x1="86" y1="28" x2="90" y2="28" stroke="#184e68" strokeWidth="2.8" strokeLinecap="round" />
          <line x1="83" y1="21" x2="87" y2="17" stroke="#184e68" strokeWidth="2.8" strokeLinecap="round" />
          <line x1="82" y1="35" x2="86" y2="39" stroke="#184e68" strokeWidth="2.8" strokeLinecap="round" />
        </g>

        {/* Lower torso / collar */}
        <path
          d="M 23 54 C 23 79, 77 79, 77 54 C 77 76, 68 86, 50 86 C 32 86, 23 76, 23 54 Z"
          fill="#d5e3ea"
          stroke="#184e68"
          strokeWidth="3.6"
          strokeLinejoin="round"
        />
        {/* White tummy patch */}
        <path
          d="M 33 65 C 33 80, 67 80, 67 65 C 67 79, 60 85, 50 85 C 40 85, 33 79, 33 65 Z"
          fill="#ffffff"
          stroke="#184e68"
          strokeWidth="3.2"
        />

        {/* Side Ear bumps (left & right) */}
        <rect
          x="10" y="38" width="12" height="22" rx="6"
          fill="#ffffff" stroke="#184e68" strokeWidth="3.6"
        />
        <rect
          x="78" y="38" width="12" height="22" rx="6"
          fill="#ffffff" stroke="#184e68" strokeWidth="3.6"
        />

        {/* Antenna Stem & Circle */}
        <line x1="50" y1="20" x2="50" y2="9" stroke="#184e68" strokeWidth="3.6" strokeLinecap="round" />
        <circle
          cx="50" cy="8" r="5.5"
          fill={isListening ? '#34d399' : '#ffffff'}
          stroke="#184e68"
          strokeWidth="3.6"
          className="transition-colors duration-300"
        />

        {/* Main Head Helmet (Rounded Stadium Outer Shell) */}
        <rect
          x="16" y="19" width="68" height="52" rx="26"
          fill="#ffffff" stroke="#184e68" strokeWidth="3.8"
        />

        {/* Inner Visor Screen (Light Cyan/Mint) */}
        <rect
          x="23" y="26" width="54" height="38" rx="17"
          fill="#dff5ed" stroke="#184e68" strokeWidth="3.6"
        />

        {/* Eyes (Blinking Animation) */}
        <g style={{ transformOrigin: '50% 42%', animation: 'botBlink 4s infinite' }}>
          <circle cx="37" cy="42" r="4.3" fill="#184e68" />
          <circle cx="63" cy="42" r="4.3" fill="#184e68" />
        </g>

        {/* Mouth (Idle Smile vs Active/Hovered Cheerful Mouth with Tongue) */}
        {(isHovered || isListening) ? (
          /* Cheerful Open Mouth with Pink Tongue (from right robot image) */
          <g>
            <path
              d="M 43 49 C 43 57, 57 57, 57 49 Z"
              fill="#184e68"
            />
            <path
              d="M 46 53 C 48 56, 52 56, 54 53 Z"
              fill="#f26d85"
            />
          </g>
        ) : (
          /* Gentle Resting Smile (from left robot image) */
          <path
            d="M 44 49 Q 50 54 56 49"
            stroke="#184e68" strokeWidth="3.4" strokeLinecap="round" fill="none"
          />
        )}
      </svg>
    </div>
  );
}

function CartBadge({ count }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
      style={{ background:'#9CB080', color:'#032f28' }}>
      {count > 9 ? '9+' : count}
    </span>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function MediAssistant({
  onNavigate,
  userRole = 'PATIENT',
  selectedMedicines = [],
  onAddToRequest,
  onProceedToPharmacies,
}) {
  const [isOpen, setIsOpen]                     = useState(false);
  const [isListening, setIsListening]           = useState(false);
  const [interimText, setInterimText]           = useState('');
  const [voiceDetected, setVoiceDetected]       = useState(false);
  const [messages, setMessages]                 = useState([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [orbActive, setOrbActive]               = useState(false);
  const [isTyping, setIsTyping]                 = useState(false);
  const [inputText, setInputText]               = useState('');
  const [showPulse, setShowPulse]               = useState(true);
  const [nearbyPharmacies, setNearbyPharmacies] = useState([]);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [isBotHovered, setIsBotHovered]         = useState(false);

  const chatEndRef = useRef(null);
  const openedOnce = useRef(false);

  const ALLOWED_TABS = userRole === 'PATIENT'
    ? ['medicines','prescription','pharmacies','emergency','orders','profile']
    : ['profile'];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, isTyping]);
  useEffect(() => { const t = setTimeout(() => setShowPulse(false), 8000); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (isOpen && !openedOnce.current) {
      openedOnce.current = true;
      addMediMessage(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], false);
    }
  }, [isOpen]);

  const addUserMessage = (text) => setMessages(prev => [...prev, { role:'user', text, id:Date.now() }]);

  const addMediMessage = (text, delay = true, actions = null) => {
    if (!delay) { setMessages(prev => [...prev, { role:'medi', text, id:Date.now(), actions }]); return; }
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, { role:'medi', text, id:Date.now(), actions }]);
    }, 700 + Math.random() * 400);
  };

  const fetchNearbyPharmacies = useCallback(async () => {
    if (nearbyPharmacies.length > 0) return nearbyPharmacies;
    setLoadingPharmacies(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch('/api/pharmacies?lat=9.3200&lon=76.6160&radius=15', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      const list = data.pharmacies || data.data || [];
      setNearbyPharmacies(list); setLoadingPharmacies(false); return list;
    } catch (e) { setLoadingPharmacies(false); return []; }
  }, [nearbyPharmacies]);

  const searchMedicineCatalog = useCallback(async (query) => {
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`/api/medicines?search=${encodeURIComponent(query)}&limit=3`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      return data.medicines || data.data || [];
    } catch (e) { return []; }
  }, []);

  const handleActionClick = useCallback(async (action) => {
    switch (action.type) {

      case 'add_medicines_to_cart': {
        const medicines = action.medicines || [];
        if (!onAddToRequest) {
          addMediMessage('Let me take you to Medicine Search to add medicines there.');
          setTimeout(() => { onNavigate?.('medicines'); setIsOpen(false); }, 1200);
          return;
        }
        let added = 0;
        for (const med of medicines) {
          const results = await searchMedicineCatalog(med.name);
          if (results.length > 0) { onAddToRequest(results[0], med.qty || 1); added++; }
        }
        if (added > 0) {
          addMediMessage(
            `Added ${added} medicine${added > 1 ? 's' : ''} to your cart!\n\nWhat would you like to do next?`,
            true,
            [
              { label:'Find Pharmacies', icon:'local_pharmacy', type:'proceed_to_pharmacies', primary:true },
              { label:'Reserve & Order', icon:'bookmark_add',   type:'proceed_to_pharmacies' },
              { label:'View Cart',       icon:'shopping_cart',  type:'show_cart' },
            ]
          );
        } else {
          addMediMessage(
            'Could not find those medicines in the catalog. Opening Medicine Search so you can find them manually.',
            true,
            [{ label:'Open Medicine Search', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]
          );
        }
        break;
      }

      case 'navigate_tab': {
        const tab = action.tab;
        if (!ALLOWED_TABS.includes(tab)) { addMediMessage('Sorry, that section is not available for your account role.'); return; }
        addMediMessage(`Opening ${action.label || tab}...`);
        setTimeout(() => { onNavigate?.(tab); setIsOpen(false); }, 1000);
        break;
      }

      case 'proceed_to_pharmacies': {
        addMediMessage('Taking you to Pharmacy Discovery to find stock and reserve your medicines!', true, null);
        setTimeout(() => { onProceedToPharmacies?.(); onNavigate?.('pharmacies'); setIsOpen(false); }, 1200);
        break;
      }

      case 'call_pharmacy_list': {
        const pharmacies = await fetchNearbyPharmacies();
        if (pharmacies.length === 0) {
          addMediMessage('Could not find nearby pharmacies right now.\n\nEmergency numbers:\n\n112 — National Emergency\n108 — Kerala Ambulance\n1056 — Kerala Health Helpline');
          return;
        }
        const top = pharmacies.slice(0, 4);
        const lines = top.map((p, i) => `${i+1}. ${p.name||p.businessName} — ${p.phone||p.phoneNumber||'N/A'}`).join('\n');
        addMediMessage(`Nearby pharmacies:\n\n${lines}\n\nTap to call directly:`, true,
          top.map(p => ({ label:`Call ${p.name||p.businessName}`, icon:'call', type:'initiate_call', phone:p.phone||p.phoneNumber||p.contact }))
        );
        break;
      }

      case 'initiate_call': {
        if (action.phone && action.phone !== 'N/A') {
          window.open(`tel:${action.phone}`, '_self');
          addMediMessage(`Calling ${action.phone}...`);
        } else {
          addMediMessage('Phone number not available for this pharmacy.');
        }
        break;
      }

      case 'show_cart': {
        const cart = selectedMedicines || [];
        if (cart.length === 0) {
          addMediMessage('Your medicine cart is empty.\n\nSay "Add Paracetamol to cart" or browse Medicine Search.', true,
            [{ label:'Browse Medicines', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]);
        } else {
          const cartSummary = cart.map(m => {
            const p = Number(m.unitPrice != null ? m.unitPrice : (m.price != null ? m.price : 0));
            return `- ${m.brandName} x${m.quantity}${p > 0 ? ` — Rs.${(p * m.quantity).toFixed(0)}` : ' (Dispensary pricing)'}`;
          }).join('\n');
          const total = cart.reduce((s, m) => {
            const p = Number(m.unitPrice != null ? m.unitPrice : (m.price != null ? m.price : 0));
            return s + (p * m.quantity);
          }, 0);
          addMediMessage(`Your Cart (${cart.length} item${cart.length > 1 ? 's' : ''}):\n\n${cartSummary}${total > 0 ? `\n\nEstimated Total: Rs.${total.toFixed(0)}` : '\n\nPricing confirmed at dispensary'}`, true,
            [
              { label:'Proceed to Pharmacies', icon:'local_pharmacy', type:'proceed_to_pharmacies', primary:true },
              { label:'Edit Cart',             icon:'edit',           type:'navigate_tab', tab:'medicines' },
            ]
          );
        }
        break;
      }

      case 'cancel':
        addMediMessage('No problem! Is there anything else I can help you with?');
        break;

      default: break;
    }
  }, [onAddToRequest, onNavigate, onProceedToPharmacies, selectedMedicines, fetchNearbyPharmacies, searchMedicineCatalog, ALLOWED_TABS]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDirectReservation = useCallback(async (text) => {
    setIsTyping(true);
    const lower = text.toLowerCase();

    // 1. Identify medicines: named in voice/text or currently in cart
    const mentionedMeds = extractMedicinesFromText(text);
    let targetItems = [];

    if (mentionedMeds.length > 0) {
      for (const medName of mentionedMeds) {
        const results = await searchMedicineCatalog(medName);
        if (results.length > 0) {
          const med = results[0];
          targetItems.push({
            medicineId: med.id,
            brandName: med.brandName,
            genericName: med.genericName,
            strength: med.strength,
            quantity: 1,
            price: med.price != null ? Number(med.price) : 0,
            unitPrice: med.unitPrice != null ? Number(med.unitPrice) : (med.price != null ? Number(med.price) : 0),
            dosageForm: med.dosageForm
          });
          if (onAddToRequest) {
            onAddToRequest(med, 1);
          }
        }
      }
    }

    // If no explicit medicine named in text, use items currently in the cart
    if (targetItems.length === 0 && selectedMedicines && selectedMedicines.length > 0) {
      targetItems = selectedMedicines.map(m => ({
        medicineId: m.medicineId || m.id,
        brandName: m.brandName || 'Medicine',
        genericName: m.genericName || '',
        strength: m.strength || '',
        quantity: m.quantity || 1,
        price: m.price != null ? Number(m.price) : 0,
        unitPrice: m.unitPrice != null ? Number(m.unitPrice) : (m.price != null ? Number(m.price) : 0),
        dosageForm: m.dosageForm
      }));
    }

    // Fallback: if user asked to reserve "that medicine" but cart is empty, fetch top verified medicine
    if (targetItems.length === 0) {
      const defaultCatalog = await searchMedicineCatalog('');
      if (defaultCatalog.length > 0) {
        const topMed = defaultCatalog[0];
        targetItems.push({
          medicineId: topMed.id,
          brandName: topMed.brandName,
          genericName: topMed.genericName,
          strength: topMed.strength,
          quantity: 1,
          price: topMed.price != null ? Number(topMed.price) : 0,
          unitPrice: topMed.unitPrice != null ? Number(topMed.unitPrice) : (topMed.price != null ? Number(topMed.price) : 0),
          dosageForm: topMed.dosageForm
        });
        if (onAddToRequest) {
          onAddToRequest(topMed, 1);
        }
      }
    }

    if (targetItems.length === 0) {
      setIsTyping(false);
      addMediMessage(
        'Please specify which medicine you would like to reserve (e.g., "Reserve Paracetamol in nearest pharmacy") or browse the catalogue first.',
        true,
        [{ label: 'Browse Medicines', icon: 'medication', type: 'navigate_tab', tab: 'medicines', primary: true }]
      );
      return;
    }

    // 2. Fetch pharmacies and automatically select target dispensary
    const pharmacies = await fetchNearbyPharmacies();
    if (!pharmacies || pharmacies.length === 0) {
      setIsTyping(false);
      addMediMessage('Could not find nearby pharmacies right now. Please try again or check emergency options.');
      return;
    }

    const sorted = [...pharmacies].sort((a, b) => {
      const distA = a.distance != null ? Number(a.distance) : 999;
      const distB = b.distance != null ? Number(b.distance) : 999;
      return distA - distB;
    });

    let selectedPharmacy = sorted[0]; // Nearest dispensary by default
    if (lower.includes('any')) {
      selectedPharmacy = sorted.find(p => p.isOpen) || sorted[0];
    } else {
      const named = sorted.find(p => {
        const pName = (p.name || p.businessName || '').toLowerCase();
        return pName && lower.includes(pName);
      });
      if (named) selectedPharmacy = named;
    }

    // 3. Normalize items and write reservation state to sessionStorage
    const normalizedItems = targetItems.map(i => ({
      medicineId: i.medicineId,
      brandName: i.brandName || 'Medicine',
      genericName: i.genericName || '',
      strength: i.strength || '',
      quantity: i.quantity || 1,
      price: i.price != null ? Number(i.price) : 0,
      unitPrice: i.unitPrice != null ? Number(i.unitPrice) : (i.price != null ? Number(i.price) : 0),
      pricingUnit: i.pricingUnit || 'per unit'
    }));

    const reservationPayload = {
      stage: 'confirm',
      pharmacy: selectedPharmacy,
      items: normalizedItems
    };

    try {
      sessionStorage.setItem('medifind_pending_reservation_flow', JSON.stringify(reservationPayload));
    } catch (_) {}

    window.dispatchEvent(new CustomEvent('medifind_open_reservation', {
      detail: reservationPayload
    }));

    const pharmName = selectedPharmacy.name || selectedPharmacy.businessName || 'Nearest Pharmacy';
    const distText = selectedPharmacy.distance != null ? ` (${selectedPharmacy.distance.toFixed(1)} km away)` : '';
    const medSummary = normalizedItems.map(m => m.brandName).join(', ');

    setIsTyping(false);
    addMediMessage(
      `Selected ${pharmName}${distText}.\n\nOpening checkout directly for ${medSummary}...`,
      false
    );

    // Direct automated checkout navigation
    setTimeout(() => {
      onProceedToPharmacies?.();
      onNavigate?.('pharmacies');
      setIsOpen(false);
    }, 1100);
  }, [selectedMedicines, fetchNearbyPharmacies, searchMedicineCatalog, onAddToRequest, onNavigate, onProceedToPharmacies]);

  const processUserInput = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    addUserMessage(clean);
    setInterimText('');
    const intent = detectIntent(clean);

    if (!intent) { addMediMessage(FALLBACK_RESPONSES[Math.floor(Math.random()*FALLBACK_RESPONSES.length)]); return; }
    if (intent.action === 'greeting') { addMediMessage(GREETINGS[Math.floor(Math.random()*GREETINGS.length)]); return; }
    if (intent.action === 'help')     { addMediMessage(HELP_RESPONSE); return; }

    if (intent.action === 'direct_reservation' || intent.action === 'reserve') {
      handleDirectReservation(clean);
      return;
    }

    if (intent.action === 'add_to_cart') {
      const meds = extractMedicinesFromText(clean);
      if (meds.length === 0) {
        addMediMessage('Which medicine would you like to add? Tell me the name(s) and I will add them to your cart!', true,
          [{ label:'Browse Medicines', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]);
        return;
      }
      addMediMessage(`I found these medicines:\n\n${meds.map(m=>`- ${m}`).join('\n')}\n\nShall I add them to your cart?`, true,
        [
          { label:'Add to Cart', icon:'add_shopping_cart', type:'add_medicines_to_cart', primary:true, medicines:meds.map(m=>({name:m,qty:1})) },
          { label:'Cancel',      icon:'close',             type:'cancel' },
        ]
      );
      return;
    }

    if (intent.action === 'view_cart') { handleActionClick({ type:'show_cart' }); return; }

    if (intent.action === 'checkout') {
      const cart = selectedMedicines || [];
      if (cart.length > 0) {
        handleDirectReservation(clean);
      } else {
        addMediMessage('Your cart is empty! Add some medicines first or say "Reserve Paracetamol in nearest pharmacy".', true,
          [{ label:'Browse Medicines', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]);
      }
      return;
    }

    if (intent.action === 'call_pharmacy') {
      setIsTyping(true);
      const pharmacies = await fetchNearbyPharmacies();
      setIsTyping(false);
      if (pharmacies.length === 0) {
        setMessages(prev => [...prev, {
          role:'medi', id:Date.now(),
          text:'Could not find nearby pharmacies right now.\n\nEmergency numbers:\n\n112 — National Emergency\n108 — Kerala Ambulance (EMRI)\n1056 — Kerala Health Helpline',
          actions:[
            { label:'Call 112', icon:'call', type:'initiate_call', phone:'112' },
            { label:'Call 108', icon:'call', type:'initiate_call', phone:'108' },
          ]
        }]);
        return;
      }
      const top = pharmacies.slice(0, 4);
      const lines = top.map((p,i) => `${i+1}. ${p.name||p.businessName}\n   Tel: ${p.phone||p.phoneNumber||'N/A'}`).join('\n\n');
      setMessages(prev => [...prev, {
        role:'medi', id:Date.now(),
        text:`Nearby pharmacies you can call:\n\n${lines}\n\nTap a button to call directly:`,
        actions:top.map(p => ({ label:`Call ${p.name||p.businessName}`, icon:'call', type:'initiate_call', phone:p.phone||p.phoneNumber||p.contact }))
      }]);
      return;
    }

    if (intent.action === 'navigate') {
      if (!ALLOWED_TABS.includes(intent.tab)) { addMediMessage('Sorry, that section is not available for your account role.'); return; }
      addMediMessage(intent.reply || ('Navigating to ' + intent.label + '...'));
      setTimeout(() => { onNavigate?.(intent.tab); setIsOpen(false); }, 1400);
    }
  }, [handleActionClick, selectedMedicines, fetchNearbyPharmacies, ALLOWED_TABS, onNavigate, handleDirectReservation]);

  const { start: startSpeech, stop: stopSpeech } = useSpeechRecognition({
    onResult:  (text) => { setIsListening(false); setOrbActive(false); processUserInput(text); },
    onInterim: (text) => setInterimText(text),
    onEnd:     ()     => { setIsListening(false); setOrbActive(false); },
    onError:   (type) => {
      setIsListening(false); setOrbActive(false);
      if (type === 'permission_denied') { setPermissionDenied(true); addMediMessage('Microphone permission was denied. Please type your question below.'); }
      else if (type === 'not_supported') addMediMessage('Voice input is not supported in this browser. Please type below.');
      else addMediMessage('Voice recognition had an error. Please try again or type your question.');
    },
  });

  const handleMicToggle = () => {
    if (isListening) { stopSpeech(); setIsListening(false); setOrbActive(false); }
    else { setPermissionDenied(false); setInterimText(''); setIsListening(true); setOrbActive(true); startSpeech(); }
  };

  const handleTextSubmit = (e) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    processUserInput(inputText); setInputText('');
  };

  const handleClose = () => { stopSpeech(); setIsListening(false); setOrbActive(false); setInterimText(''); setIsOpen(false); };

  const cartCount = selectedMedicines?.length || 0;

  const QUICK_SUGGESTIONS = userRole === 'PATIENT'
    ? [
        { label:'My Cart',       icon:'shopping_cart',  text:'show my cart' },
        { label:'Add Medicine',  icon:'add_circle',     text:'add paracetamol to cart' },
        { label:'Call Pharmacy', icon:'call',           text:'call pharmacy' },
        { label:'Reserve',       icon:'bookmark_add',   text:'reserve at pharmacy' },
        { label:'Find Pharmacy', icon:'local_pharmacy', text:'find pharmacy' },
        { label:'Emergency',     icon:'emergency',      text:'emergency help' },
        { label:'My Orders',     icon:'package_2',      text:'track my order' },
      ]
    : [
        { label:'My Profile', icon:'person', text:'open profile' },
        { label:'Help',       icon:'help',   text:'help me' },
      ];

  return (
    <>
      {/* Floating Robot Buddy Button (Exact Robot Face Shape & Animation from uploaded image) */}
      <div
        className="fixed z-[190] transition-all duration-300"
        style={{
          bottom: selectedMedicines.length > 0 ? 84 : 20,
          right: 20
        }}
      >
        {!isOpen && showPulse && (
          <div className="absolute bottom-full right-0 mb-3 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap pointer-events-none"
            style={{
              background: '#E8F5E9',
              color: '#032f28',
              border: '2px solid #9CB080',
              boxShadow: '0 4px 16px rgba(156, 176, 128, 0.35)',
              animation: 'mediTooltipIn 0.3s ease-out'
            }}>
            Hi! I am Medi AI
            <div className="absolute bottom-[-6px] right-6 w-2.5 h-2.5 rotate-45" style={{ background: '#E8F5E9', borderRight: '2px solid #9CB080', borderBottom: '2px solid #9CB080' }}/>
          </div>
        )}
        <div className="relative">
          <button
            id="medi-assistant-btn"
            onClick={() => setIsOpen(true)}
            onMouseEnter={() => setIsBotHovered(true)}
            onMouseLeave={() => setIsBotHovered(false)}
            className="p-0 bg-transparent border-none cursor-pointer focus:outline-none transition-transform active:scale-95 group"
            title="Chat with Medi AI — Clinical Health Assistant"
            aria-label="Open Medi AI Assistant"
          >
            <RobotFaceBot isListening={isListening} isHovered={isBotHovered} size={64} />
          </button>

          {cartCount > 0 && !isOpen && (
            <span
              className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold shadow-md pointer-events-none"
              style={{ background: '#9CB080', color: '#032f28', border: '1.5px solid #E8F5E9' }}
            >
              {cartCount}
            </span>
          )}
        </div>
      </div>

      {/* Modal Panel - Portaled to document.body and constrained to viewport */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:justify-end sm:p-6"
          style={{ pointerEvents:'none' }}>
          <div className="absolute inset-0"
            style={{ background:'rgba(3, 47, 40, 0.45)', backdropFilter:'blur(8px)', pointerEvents:'auto' }}
            onClick={handleClose}/>

          {/* Panel */}
          <div className="relative w-full sm:w-[400px] flex flex-col overflow-hidden shadow-2xl"
            style={{
              maxHeight: 'calc(100dvh - 32px)',
              height: 'min(640px, calc(100dvh - 32px))',
              borderRadius: '24px',
              background: '#E8F5E9',
              border: '1.5px solid #9CB080',
              boxShadow: '0 20px 60px rgba(3,47,40,0.25), 0 0 0 1px #9CB080',
              pointerEvents: 'auto',
              animation: 'mediPanelIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
            }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3.5 shrink-0"
              style={{ borderBottom:'1px solid rgba(156, 176, 128, 0.4)', background:'#E8F5E9' }}>
              <div className="shrink-0">
                <RobotFaceBot isListening={isListening} isHovered={false} size={38} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-wide" style={{ color: '#032f28' }}>Medi Assistant</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background:'rgba(156, 176, 128, 0.25)', color:'#2b441c', border:'1px solid #9CB080' }}>
                    AI Clinical
                  </span>
                </div>
                <p className="text-[11px] truncate font-medium" style={{ color: '#3e5831' }}>
                  {isListening ? 'Listening...' : loadingPharmacies ? 'Finding pharmacies...' : 'Your clinical prescription assistant'}
                </p>
              </div>
              {cartCount > 0 && (
                <button onClick={() => handleActionClick({ type:'show_cart' })}
                  className="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-all"
                  style={{ background:'rgba(156, 176, 128, 0.25)', border:'1.5px solid #9CB080' }}
                  title="View cart">
                  <span className="material-symbols-outlined text-[16px]" style={{ color:'#032f28' }}>shopping_cart</span>
                  <CartBadge count={cartCount} />
                </button>
              )}
              <button onClick={handleClose}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer"
                style={{ background:'rgba(156, 176, 128, 0.2)', color:'#032f28' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#9CB080'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(156, 176, 128, 0.2)'; e.currentTarget.style.color = '#032f28'; }}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Voice Orb */}
            <div className="flex flex-col items-center py-3 px-5 gap-2 shrink-0"
              style={{ borderBottom:'1px solid rgba(156, 176, 128, 0.3)', background:'#E8F5E9' }}>
              <div className="relative w-28 h-28 rounded-full" style={{ background:'#dbeee0' }}>
                {isListening && (
                  <>
                    <div className="absolute inset-[-10px] rounded-full pointer-events-none"
                      style={{ border:'2px solid rgba(156, 176, 128, 0.65)', animation:'mediOrbRing1 1.8s ease-in-out infinite' }}/>
                    <div className="absolute inset-[-20px] rounded-full pointer-events-none"
                      style={{ border:'1px solid rgba(156, 176, 128, 0.45)', animation:'mediOrbRing2 1.8s ease-in-out infinite 0.35s' }}/>
                  </>
                )}
                <VoicePoweredOrb hue={0} enableVoiceControl={orbActive} voiceSensitivity={2.0}
                  maxRotationSpeed={1.5} maxHoverIntensity={1.0} onVoiceDetected={setVoiceDetected}
                  className="w-full h-full rounded-full overflow-hidden"/>
                <button onClick={handleMicToggle} disabled={permissionDenied}
                  className="absolute inset-0 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background:isListening?'rgba(186,26,26,0.12)':'transparent', opacity:permissionDenied?0.4:1, transition:'background 0.2s' }}
                  title={isListening?'Stop listening':'Tap to speak'}>
                  <span className="material-symbols-outlined text-4xl"
                    style={{ color:isListening?'#d32f2f':'#032f28', textShadow:'0 2px 8px rgba(255,255,255,0.7)' }}>
                    {isListening ? 'stop_circle' : 'mic'}
                  </span>
                </button>
              </div>
              <div className="h-6 flex items-center justify-center w-full">
                {isListening && interimText ? (
                  <p className="text-sm text-center italic font-semibold" style={{ color:'#032f28' }}>{interimText}...</p>
                ) : isListening ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full"
                      style={{ background:voiceDetected?'#9CB080':'#5c7546', boxShadow:voiceDetected?'0 0 8px #9CB080':'none', animation:'voiceDot 0.8s ease-in-out infinite' }}/>
                    <span className="text-xs font-semibold" style={{ color:voiceDetected?'#032f28':'#49663b' }}>
                      {voiceDetected ? 'Voice detected...' : 'Listening...'}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs font-medium" style={{ color:'#49663b' }}>Tap orb to speak or type below</p>
                )}
              </div>
            </div>

            {/* Chat */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
              style={{ scrollbarWidth:'none', background:'#E8F5E9' }}>
              {messages.map(msg => (
                <ChatBubble key={msg.id} message={msg} onActionClick={handleActionClick}/>
              ))}
              {isTyping && (
                <div className="flex gap-2 items-end">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-xs"
                    style={{ background:'linear-gradient(135deg, #9CB080, #738a59)', border: '1.5px solid #9CB080' }}>
                    <span className="text-[#032f28] text-xs font-black" style={{ fontFamily:'monospace' }}>M</span>
                  </div>
                  <div className="px-3.5 py-3 rounded-2xl flex gap-1 items-center shadow-xs"
                    style={{ background:'#ffffff', border:'1.5px solid #9CB080', borderBottomLeftRadius:4 }}>
                    {[0,1,2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full"
                        style={{ background:'#9CB080', animation:'mediTyping 1.2s ease-in-out infinite '+(i*0.2)+'s' }}/>
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Quick pills */}
            <div className="px-4 py-2 flex gap-2 overflow-x-auto shrink-0"
              style={{ scrollbarWidth:'none', borderTop:'1px solid rgba(156, 176, 128, 0.35)', background:'#E8F5E9' }}>
              {QUICK_SUGGESTIONS.map(s => (
                <QuickPill key={s.label} label={s.label} icon={s.icon} onClick={() => processUserInput(s.text)}/>
              ))}
            </div>

            {/* Text input */}
            <form onSubmit={handleTextSubmit} className="flex items-center gap-2 px-4 pb-6 pt-2 shrink-0"
              style={{ background:'#E8F5E9' }}>
              <input type="text" value={inputText} onChange={e => setInputText(e.target.value)}
                placeholder="Type medicine name or question..."
                className="flex-1 h-10 px-4 rounded-full text-sm focus:outline-none shadow-xs"
                style={{ background:'#ffffff', border:'1.5px solid #9CB080', color:'#032f28' }}/>
              <button type="submit" disabled={!inputText.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-xs"
                style={{ background:inputText.trim()?'linear-gradient(135deg, #9CB080, #7d9660)':'rgba(156, 176, 128, 0.35)',
                  color:inputText.trim()?'#ffffff':'rgba(3, 47, 40, 0.35)' }}>
                <span className="material-symbols-outlined text-[18px]">send</span>
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Animations */}
      <style>{`
        @keyframes mediButtonPulse {
          0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.45); }
          70%  { box-shadow: 0 0 0 14px rgba(52,211,153,0); }
          100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
        }
        @keyframes mediPanelIn {
          from { transform: translateY(60px) scale(0.96); opacity: 0; }
          to   { transform: translateY(0)    scale(1);    opacity: 1; }
        }
        @keyframes mediBubbleIn {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        @keyframes mediTooltipIn {
          from { transform: translateY(6px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        @keyframes mediOrbRing1 {
          0%,100% { transform: scale(1);    opacity: 0.7;  }
          50%     { transform: scale(1.1);  opacity: 0.25; }
        }
        @keyframes mediOrbRing2 {
          0%,100% { transform: scale(1);    opacity: 0.4;  }
          50%     { transform: scale(1.18); opacity: 0.1;  }
        }
        @keyframes mediTyping {
          0%,60%,100% { transform: translateY(0); }
          30%          { transform: translateY(-5px); }
        }
        @keyframes voiceDot {
          0%,100% { opacity: 1;   }
          50%     { opacity: 0.3; }
        }
        @keyframes botFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-5px); }
        }
        @keyframes botBlink {
          0%, 90%, 100% { transform: scaleY(1); }
          95%           { transform: scaleY(0.1); }
        }
      `}</style>
    </>
  );
}
