import React, { useState, useEffect, useRef, useCallback } from 'react';
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
function isReserveIntent(t) {
  const l = t.toLowerCase();
  return (l.includes('reserve')||l.includes('book')||l.includes('reservation')||l.includes('hold'))
    && (l.includes('pharmacy')||l.includes('medicine')||l.includes('at'));
}
function isCartCheckIntent(t) {
  const l = t.toLowerCase();
  return l.includes('cart')||l.includes('my medicines')||l.includes('show cart')||l.includes('view cart')||l.includes('my list');
}
function isCheckoutIntent(t) {
  const l = t.toLowerCase();
  return (l.includes('checkout')||l.includes('check out')||l.includes('proceed')||
          l.includes('confirm order')||l.includes('place order')||l.includes('go to pharmacy'))
    && !l.includes('track');
}

function detectIntent(text) {
  if (!text || !text.trim()) return null;
  const lower = text.toLowerCase().trim();
  if (/^(hi|hello|hey|namaste|good morning|good evening|good afternoon|hola)\b/.test(lower))
    return { id: 'greeting', action: 'greeting' };
  if (isAddToCartIntent(text))    return { id: 'add_to_cart',   action: 'add_to_cart' };
  if (isCallPharmacyIntent(text)) return { id: 'call_pharmacy', action: 'call_pharmacy' };
  if (isReserveIntent(text))      return { id: 'reserve',       action: 'reserve' };
  if (isCartCheckIntent(text))    return { id: 'view_cart',     action: 'view_cart' };
  if (isCheckoutIntent(text))     return { id: 'checkout',      action: 'checkout' };
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
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mb-0.5"
          style={{ background: 'linear-gradient(135deg,#1a6651,#0a3d2e)' }}>
          <span className="text-white text-xs font-black" style={{ fontFamily: 'monospace' }}>M</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5 max-w-[82%]">
        <div className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
          style={isUser
            ? { background:'linear-gradient(135deg,#1a5c4a,#0d3d29)', color:'#e0fff5', borderBottomRightRadius:4 }
            : { background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.88)', border:'1px solid rgba(255,255,255,0.09)', borderBottomLeftRadius:4 }
          }>
          {message.text}
        </div>
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {message.actions.map((action, i) => (
              <button key={i} onClick={() => onActionClick?.(action)}
                className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                style={{
                  background: action.primary ? 'linear-gradient(135deg,#16a36a,#0c6e47)' : 'rgba(255,255,255,0.08)',
                  color: action.primary ? '#fff' : 'rgba(154,237,209,0.9)',
                  border: action.primary ? 'none' : '1px solid rgba(154,237,209,0.2)',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.82'; }}
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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0"
      style={{ background:'rgba(22,163,106,0.12)', border:'1px solid rgba(22,163,106,0.25)', color:'#9aedd1' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,163,106,0.24)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(22,163,106,0.12)'; }}>
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
      {label}
    </button>
  );
}

function RobotIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="15" y1="2" x2="15" y2="6" stroke="#9aedd1" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="15" cy="1.5" r="1.5" fill="#16a36a"/>
      <rect x="5" y="6" width="20" height="16" rx="4" fill="#9aedd1" fillOpacity="0.12" stroke="#9aedd1" strokeWidth="1.5"/>
      <circle cx="10.5" cy="13" r="2.5" fill="#9aedd1"/>
      <circle cx="19.5" cy="13" r="2.5" fill="#9aedd1"/>
      <circle cx="11" cy="12.5" r="1" fill="#050f0b"/>
      <circle cx="20" cy="12.5" r="1" fill="#050f0b"/>
      <path d="M10 18 Q15 21 20 18" stroke="#9aedd1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      <rect x="10" y="23" width="10" height="4" rx="2" fill="#9aedd1" fillOpacity="0.25" stroke="#9aedd1" strokeWidth="1"/>
      <circle cx="13" cy="25" r="0.8" fill="#16a36a"/>
      <circle cx="15" cy="25" r="0.8" fill="#16a36a"/>
      <circle cx="17" cy="25" r="0.8" fill="#16a36a"/>
    </svg>
  );
}

function CartBadge({ count }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
      style={{ background:'#16a36a', color:'#fff' }}>
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

  const processUserInput = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    addUserMessage(clean);
    setInterimText('');
    const intent = detectIntent(clean);

    if (!intent) { addMediMessage(FALLBACK_RESPONSES[Math.floor(Math.random()*FALLBACK_RESPONSES.length)]); return; }
    if (intent.action === 'greeting') { addMediMessage(GREETINGS[Math.floor(Math.random()*GREETINGS.length)]); return; }
    if (intent.action === 'help')     { addMediMessage(HELP_RESPONSE); return; }

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
      if (cart.length === 0) {
        addMediMessage('Your cart is empty! Add some medicines first.', true,
          [{ label:'Browse Medicines', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]);
      } else {
        addMediMessage(`You have ${cart.length} item${cart.length>1?'s':''} in your cart. Proceed to Pharmacy Discovery?`, true,
          [
            { label:'Proceed to Pharmacies', icon:'local_pharmacy', type:'proceed_to_pharmacies', primary:true },
            { label:'View Cart First',        icon:'shopping_cart',  type:'show_cart' },
          ]
        );
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

    if (intent.action === 'reserve') {
      const cart = selectedMedicines || [];
      if (cart.length === 0) {
        addMediMessage('To reserve medicines, add them to your cart first, then say "reserve at pharmacy"!', true,
          [{ label:'Browse Medicines', icon:'medication', type:'navigate_tab', tab:'medicines', primary:true }]);
      } else {
        const cartNames = cart.slice(0,3).map(m=>m.brandName).join(', ');
        const more = cart.length > 3 ? ` +${cart.length-3} more` : '';
        addMediMessage(`I will help you reserve: ${cartNames}${more}\n\nTaking you to Pharmacy Discovery to find stock and complete your reservation.`, true,
          [
            { label:'Find & Reserve', icon:'bookmark_add',   type:'proceed_to_pharmacies', primary:true },
            { label:'View Cart',      icon:'shopping_cart',  type:'show_cart' },
            { label:'Call Pharmacy',  icon:'call',           type:'call_pharmacy_list' },
          ]
        );
      }
      return;
    }

    if (intent.action === 'navigate') {
      if (!ALLOWED_TABS.includes(intent.tab)) { addMediMessage('Sorry, that section is not available for your account role.'); return; }
      addMediMessage(intent.reply || ('Navigating to ' + intent.label + '...'));
      setTimeout(() => { onNavigate?.(intent.tab); setIsOpen(false); }, 1400);
    }
  }, [handleActionClick, selectedMedicines, fetchNearbyPharmacies, ALLOWED_TABS, onNavigate]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Floating Button */}
      <div className="fixed z-[190]" style={{ bottom:28, right:24 }}>
        {!isOpen && showPulse && (
          <div className="absolute bottom-full right-0 mb-3 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap pointer-events-none"
            style={{ background:'linear-gradient(135deg,#050f0b,#0d3d29)', color:'#9aedd1', boxShadow:'0 4px 16px rgba(0,0,0,0.7)', animation:'mediTooltipIn 0.3s ease-out' }}>
            Hi! I am Medi
            <div className="absolute bottom-[-5px] right-5 w-2.5 h-2.5 rotate-45" style={{ background:'#0d3d29' }}/>
          </div>
        )}
        {!isOpen && showPulse && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{ animation:'mediButtonPulse 2.2s ease-in-out infinite' }}/>
        )}
        <div className="relative">
          <button id="medi-assistant-btn" onClick={() => setIsOpen(true)}
            className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl"
            style={{ background:'linear-gradient(145deg,#16a36a,#030a07)', boxShadow:'0 8px 32px rgba(22,163,106,0.45),0 2px 8px rgba(0,0,0,0.5)', transition:'transform 0.18s ease' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            title="Talk to Medi — Your AI Health Assistant" aria-label="Open Medi AI Assistant">
            <RobotIcon size={30}/>
          </button>
          {cartCount > 0 && !isOpen && <CartBadge count={cartCount} />}
        </div>
      </div>

      {/* Modal Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-[195] flex items-end sm:items-end sm:justify-end sm:pr-6 sm:pb-24"
          style={{ pointerEvents:'none' }}>
          <div className="absolute inset-0"
            style={{ background:'rgba(0,0,0,0.78)', backdropFilter:'blur(8px)', pointerEvents:'auto' }}
            onClick={handleClose}/>

          {/* Panel — pure black */}
          <div className="relative w-full sm:w-[390px] flex flex-col overflow-hidden"
            style={{
              maxHeight:'92vh', height:660, borderRadius:'24px 24px 0 0',
              background:'#000000',
              border:'1px solid rgba(22,163,106,0.18)',
              boxShadow:'0 -20px 80px rgba(0,0,0,0.95),0 0 0 1px rgba(22,163,106,0.07)',
              pointerEvents:'auto', animation:'mediPanelIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
            }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 shrink-0"
              style={{ borderBottom:'1px solid rgba(255,255,255,0.06)', background:'#000' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background:'linear-gradient(135deg,#16a36a,#050f0b)', border:'2px solid rgba(154,237,209,0.2)' }}>
                <RobotIcon size={20}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black" style={{ color:'#9aedd1', letterSpacing:'0.02em' }}>Medi</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background:'rgba(22,163,106,0.18)', color:'#16a36a', border:'1px solid rgba(22,163,106,0.3)' }}>
                    AI Assistant
                  </span>
                </div>
                <p className="text-[11px] truncate" style={{ color:'rgba(154,237,209,0.38)' }}>
                  {isListening ? 'Listening...' : loadingPharmacies ? 'Finding pharmacies...' : 'Your MediFind health guide'}
                </p>
              </div>
              {cartCount > 0 && (
                <button onClick={() => handleActionClick({ type:'show_cart' })}
                  className="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background:'rgba(22,163,106,0.15)', border:'1px solid rgba(22,163,106,0.3)' }}
                  title="View cart">
                  <span className="material-symbols-outlined text-[16px]" style={{ color:'#9aedd1' }}>shopping_cart</span>
                  <CartBadge count={cartCount} />
                </button>
              )}
              <button onClick={handleClose}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0"
                style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.4)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Voice Orb */}
            <div className="flex flex-col items-center py-3 px-5 gap-2 shrink-0"
              style={{ borderBottom:'1px solid rgba(255,255,255,0.05)', background:'#000' }}>
              <div className="relative w-28 h-28 rounded-full" style={{ background:'#050a08' }}>
                {isListening && (
                  <>
                    <div className="absolute inset-[-10px] rounded-full pointer-events-none"
                      style={{ border:'2px solid rgba(22,163,106,0.35)', animation:'mediOrbRing1 1.8s ease-in-out infinite' }}/>
                    <div className="absolute inset-[-20px] rounded-full pointer-events-none"
                      style={{ border:'1px solid rgba(22,163,106,0.18)', animation:'mediOrbRing2 1.8s ease-in-out infinite 0.35s' }}/>
                  </>
                )}
                <VoicePoweredOrb hue={0} enableVoiceControl={orbActive} voiceSensitivity={2.0}
                  maxRotationSpeed={1.5} maxHoverIntensity={1.0} onVoiceDetected={setVoiceDetected}
                  className="w-full h-full rounded-full overflow-hidden"/>
                <button onClick={handleMicToggle} disabled={permissionDenied}
                  className="absolute inset-0 rounded-full flex items-center justify-center"
                  style={{ background:isListening?'rgba(186,26,26,0.12)':'transparent', opacity:permissionDenied?0.4:1, transition:'background 0.2s' }}
                  title={isListening?'Stop listening':'Tap to speak'}>
                  <span className="material-symbols-outlined text-4xl"
                    style={{ color:isListening?'#ff6b6b':'rgba(255,255,255,0.5)', textShadow:'0 2px 12px rgba(0,0,0,0.8)' }}>
                    {isListening ? 'stop_circle' : 'mic'}
                  </span>
                </button>
              </div>
              <div className="h-6 flex items-center justify-center w-full">
                {isListening && interimText ? (
                  <p className="text-sm text-center italic" style={{ color:'rgba(154,237,209,0.7)' }}>{interimText}...</p>
                ) : isListening ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full"
                      style={{ background:voiceDetected?'#16a36a':'#5a8a78', boxShadow:voiceDetected?'0 0 8px #16a36a':'none', animation:'voiceDot 0.8s ease-in-out infinite' }}/>
                    <span className="text-xs font-semibold" style={{ color:voiceDetected?'#16a36a':'rgba(154,237,209,0.5)' }}>
                      {voiceDetected ? 'Voice detected...' : 'Listening...'}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color:'rgba(154,237,209,0.27)' }}>Tap orb to speak or type below</p>
                )}
              </div>
            </div>

            {/* Chat */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
              style={{ scrollbarWidth:'none', background:'#000' }}>
              {messages.map(msg => (
                <ChatBubble key={msg.id} message={msg} onActionClick={handleActionClick}/>
              ))}
              {isTyping && (
                <div className="flex gap-2 items-end">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background:'linear-gradient(135deg,#1a6651,#0a3d2e)' }}>
                    <span className="text-white text-xs font-black" style={{ fontFamily:'monospace' }}>M</span>
                  </div>
                  <div className="px-3.5 py-3 rounded-2xl flex gap-1 items-center"
                    style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)', borderBottomLeftRadius:4 }}>
                    {[0,1,2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full"
                        style={{ background:'rgba(154,237,209,0.5)', animation:'mediTyping 1.2s ease-in-out infinite '+(i*0.2)+'s' }}/>
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Quick pills */}
            <div className="px-4 py-2 flex gap-2 overflow-x-auto shrink-0"
              style={{ scrollbarWidth:'none', borderTop:'1px solid rgba(255,255,255,0.05)', background:'#000' }}>
              {QUICK_SUGGESTIONS.map(s => (
                <QuickPill key={s.label} label={s.label} icon={s.icon} onClick={() => processUserInput(s.text)}/>
              ))}
            </div>

            {/* Text input */}
            <form onSubmit={handleTextSubmit} className="flex items-center gap-2 px-4 pb-6 pt-2 shrink-0"
              style={{ background:'#000' }}>
              <input type="text" value={inputText} onChange={e => setInputText(e.target.value)}
                placeholder="Type medicine name or question..."
                className="flex-1 h-10 px-4 rounded-full text-sm focus:outline-none"
                style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(22,163,106,0.2)', color:'rgba(255,255,255,0.85)' }}/>
              <button type="submit" disabled={!inputText.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0"
                style={{ background:inputText.trim()?'linear-gradient(135deg,#16a36a,#0c6e47)':'rgba(255,255,255,0.06)',
                  color:inputText.trim()?'#fff':'rgba(255,255,255,0.2)' }}>
                <span className="material-symbols-outlined text-[18px]">send</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes mediButtonPulse {
          0%   { box-shadow: 0 0 0 0 rgba(22,163,106,0.65); }
          70%  { box-shadow: 0 0 0 20px rgba(22,163,106,0); }
          100% { box-shadow: 0 0 0 0 rgba(22,163,106,0); }
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
      `}</style>
    </>
  );
}
