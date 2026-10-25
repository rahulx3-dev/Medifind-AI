import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * RadialOrbitalTimeline — Adapted from 21st.dev RadialOrbitalTimeline reference
 * Strictly driven by real MediFind Backend Order & AssistantTask states.
 *
 * Backend Order States (Prisma schema & orderController.js):
 * - PENDING: Order placed, awaiting dispensary review
 * - CONFIRMED: Pharmacist accepted order & reserved inventory
 * - READY_FOR_PICKUP: Items packaged & staged at counter
 * - COMPLETED: Verification PIN validated & medicine released
 * (Terminal: CANCELLED, REJECTED)
 *
 * Backend AssistantTask States (assistantController.js):
 * - AVAILABLE -> ACCEPTED -> COLLECTING -> IN_TRANSIT -> DELIVERED -> CONFIRMED
 */

const ORDER_STAGES = [
  {
    id: 1,
    key: 'PENDING',
    title: 'Order Submitted',
    desc: 'Order placed by patient and queued for dispensary review',
    icon: 'receipt_long',
    category: 'Intake'
  },
  {
    id: 2,
    key: 'CONFIRMED',
    title: 'Prescription Confirmed',
    desc: 'Pharmacist confirmed prescription and reserved stock buffer',
    icon: 'verified',
    category: 'Verification'
  },
  {
    id: 3,
    key: 'READY_FOR_PICKUP',
    title: 'Ready for Collection',
    desc: 'Medications staged and packaged at dispensary counter',
    icon: 'inventory_2',
    category: 'Staging'
  },
  {
    id: 4,
    key: 'COMPLETED',
    title: 'Handover Completed',
    desc: 'Verification PIN confirmed and medications dispensed',
    icon: 'check_circle',
    category: 'Dispensary'
  }
];

const ASSISTANT_STAGES = [
  {
    id: 1,
    key: 'AVAILABLE',
    title: 'Task Queued',
    desc: 'Fulfillment task available for delivery assistant acceptance',
    icon: 'assignment_turned_in',
    category: 'Dispatch'
  },
  {
    id: 2,
    key: 'ACCEPTED',
    title: 'Assistant Assigned',
    desc: 'Delivery assistant assigned and on the way to pharmacy',
    icon: 'person_pin_circle',
    category: 'Assignment'
  },
  {
    id: 3,
    key: 'COLLECTING',
    title: 'Dispensary Collection',
    desc: 'Assistant collecting packaged medication from pharmacy',
    icon: 'storefront',
    category: 'Collection'
  },
  {
    id: 4,
    key: 'IN_TRANSIT',
    title: 'On the Way',
    desc: 'Active transit to patient delivery address',
    icon: 'local_shipping',
    category: 'Transit'
  },
  {
    id: 5,
    key: 'DELIVERED',
    title: 'Package Arrived',
    desc: 'Assistant arrived at destination delivery address',
    icon: 'home_pin',
    category: 'Delivery'
  },
  {
    id: 6,
    key: 'CONFIRMED',
    title: 'Handover Verified',
    desc: '4-digit handover PIN verified and custody transferred',
    icon: 'verified_user',
    category: 'Verification'
  }
];

export default function RadialOrbitalTimeline({
  orderStatus = 'CONFIRMED',
  assistantTaskStatus = null,
  isAssistantDelivery = false,
  steps = null,
  onStepSelect = () => {},
  className = ''
}) {
  const isDelivery = isAssistantDelivery || !!assistantTaskStatus;
  const rawStages = steps || (isDelivery ? ASSISTANT_STAGES : ORDER_STAGES);

  // Compute completed status based on real state machine hierarchy
  const ORDER_ORDER = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COMPLETED'];
  const ASSISTANT_ORDER = ['AVAILABLE', 'ACCEPTED', 'COLLECTING', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];

  const normalizedAssistantStatus = assistantTaskStatus === 'ASSIGNED' ? 'AVAILABLE' : (assistantTaskStatus || 'AVAILABLE');
  const activeIndex = isDelivery
    ? ASSISTANT_ORDER.indexOf(normalizedAssistantStatus)
    : ORDER_ORDER.indexOf(orderStatus || 'PENDING');

  const timelineData = rawStages.map((stage, idx) => {
    const isCompleted = idx <= activeIndex && activeIndex !== -1;
    const isCurrent = idx === activeIndex;
    return {
      ...stage,
      status: isCompleted ? 'completed' : 'pending',
      isCurrent
    };
  });

  const currentStepId = (() => {
    const active = timelineData.find(s => s.isCurrent);
    if (active) return active.id;
    const firstPending = timelineData.find(s => s.status !== 'completed');
    return firstPending ? firstPending.id : timelineData[timelineData.length - 1].id;
  })();

  const [selectedId, setSelectedId] = useState(currentStepId);
  const [viewMode, setViewMode] = useState('orbital');
  const [rotationAngle, setRotationAngle] = useState(0);
  const [hoveredId, setHoveredId] = useState(null);

  // Respect reduced motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(media.matches);
    const listener = (e) => setPrefersReducedMotion(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // Update selected ID when props change
  useEffect(() => {
    setSelectedId(currentStepId);
  }, [currentStepId]);

  // Auto slow rotation — pause when hovering a node or if reduced-motion is active
  useEffect(() => {
    if (viewMode !== 'orbital' || hoveredId !== null || prefersReducedMotion) return;
    const interval = setInterval(() => {
      setRotationAngle(prev => (prev + 0.3) % 360);
    }, 60);
    return () => clearInterval(interval);
  }, [viewMode, hoveredId, prefersReducedMotion]);

  const selectedStep = timelineData.find(s => s.id === selectedId) || timelineData[0];

  return (
    <div className={`w-full bg-[#f8fafc] rounded-3xl p-5 border border-[#e0f2eb] shadow-sm flex flex-col gap-4 ${className}`}>
      
      {/* ─── Header & View Switcher ──────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#e0f2eb]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#b0ecdd] text-[#032f28] flex items-center justify-center">
            <span className="material-symbols-outlined text-base">radar</span>
          </div>
          <div>
            <h4 className="text-sm font-bold text-[#032f28] leading-tight">
              Fulfillment Journey Dynamics
            </h4>
            <span className="text-[11px] text-[#717976]">
              {isDelivery ? 'Assisted delivery stage progression' : 'Dispensary order stage progression'}
            </span>
          </div>
        </div>

        {/* View Mode Toggle Button */}
        <div className="flex items-center bg-[#e6f8f1] p-1 rounded-full border border-[#d5e6e0]">
          <button
            type="button"
            onClick={() => setViewMode('orbital')}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
              viewMode === 'orbital'
                ? 'bg-[#032f28] text-white shadow-xs'
                : 'text-[#2e685d] hover:text-[#032f28]'
            }`}
          >
            Orbital View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('linear')}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
              viewMode === 'linear'
                ? 'bg-[#032f28] text-white shadow-xs'
                : 'text-[#2e685d] hover:text-[#032f28]'
            }`}
          >
            Timeline View
          </button>
        </div>
      </div>

      {/* ─── Stage Visualization Stage ───────────────────────────── */}
      {viewMode === 'orbital' ? (
        <div className="relative w-full h-[320px] flex items-center justify-center overflow-hidden select-none">
          
          {/* Guide rings */}
          <div className="absolute w-[240px] h-[240px] rounded-full border border-dashed border-[#a6cfc5]/50" />
          <div className="absolute w-[150px] h-[150px] rounded-full border border-[#d5e6e0]/70" />

          {/* Center Hub — shows current step number */}
          <div className="relative z-10 w-[84px] h-[84px] rounded-full bg-gradient-to-br from-[#032f28] to-[#2e685d] text-white flex flex-col items-center justify-center text-center shadow-xl border-2 border-white">
            <span className="material-symbols-outlined text-[#80FF72]" style={{fontSize:20}}>hub</span>
            <span className="text-[8px] font-mono font-bold uppercase tracking-wider mt-0.5 text-[#a6cfc5]">Stage</span>
            <span className="text-sm font-extrabold leading-none">{selectedId}/{timelineData.length}</span>
          </div>

          {/* Orbiting Stage Nodes */}
          {timelineData.map((step, idx) => {
            const total = timelineData.length;
            const currentAngle = ((idx / total) * 360 + (prefersReducedMotion ? 0 : rotationAngle)) * (Math.PI / 180);
            const radius = 118;
            const x = Math.cos(currentAngle) * radius;
            const y = Math.sin(currentAngle) * radius;
            const isSelected = selectedId === step.id;
            const isCompleted = step.status === 'completed';
            const isCurrent = step.isCurrent;
            const isHovered = hoveredId === step.id;

            return (
              <div
                key={step.id}
                style={{ transform: `translate(${x}px, ${y}px)` }}
                className="absolute z-20 flex flex-col items-center"
              >
                {/* Step node button */}
                <motion.button
                  type="button"
                  onMouseEnter={() => setHoveredId(step.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => { setSelectedId(step.id); onStepSelect(step); }}
                  whileTap={{ scale: prefersReducedMotion ? 1 : 0.92 }}
                  className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg cursor-pointer border-2 transition-all duration-200 ${
                    isSelected
                      ? 'bg-[#10b981] text-white border-white scale-110'
                      : isCompleted
                      ? 'bg-[#032f28] text-white border-white hover:scale-105'
                      : 'bg-white text-[#717976] border-[#d5e6e0] hover:scale-105 hover:border-[#a6cfc5]'
                  }`}
                  title={step.title}
                >
                  <span className="material-symbols-outlined" style={{fontSize:20}}>{step.icon}</span>

                  {/* Step number badge */}
                  <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center border-2 border-white shadow-sm ${
                    isSelected ? 'bg-white text-[#10b981]'
                    : isCompleted ? 'bg-[#10b981] text-white'
                    : 'bg-[#e6f8f1] text-[#717976]'
                  }`}>
                    {step.id}
                  </span>

                  {/* Pulse ring on current (active) step */}
                  {isCurrent && !prefersReducedMotion && (
                    <span className="absolute inset-[-6px] rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
                  )}
                  {isSelected && (
                    <span className="absolute inset-[-5px] rounded-full border-2 border-emerald-300/70 pointer-events-none" />
                  )}
                </motion.button>

                {/* Floating label — shows for selected or hovered node */}
                <AnimatePresence>
                  {(isSelected || isHovered) && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="absolute pointer-events-none"
                      style={{ top: '100%', marginTop: 6, whiteSpace: 'nowrap' }}
                    >
                      <div className={`px-2 py-1 rounded-lg text-[10px] font-bold shadow-md border ${
                        isSelected
                          ? 'bg-[#032f28] text-white border-[#032f28]'
                          : 'bg-white text-[#032f28] border-[#d5e6e0]'
                      }`}>
                        {step.title}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

      ) : (
        /* Linear Timeline View */
        <div className={`grid grid-cols-1 sm:grid-cols-${timelineData.length} gap-2.5`}>
          {timelineData.map((step) => {
            const isSelected = selectedId === step.id;
            const isCompleted = step.status === 'completed';

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  setSelectedId(step.id);
                  onStepSelect(step);
                }}
                className={`p-3 rounded-2xl text-left border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  isSelected
                    ? 'bg-[#032f28] text-white border-[#032f28] shadow-md'
                    : 'bg-white hover:bg-[#e6f8f1] border-[#e0f2eb]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    isSelected ? 'bg-white/20 text-white' : isCompleted ? 'bg-[#b0ecdd] text-[#032f28]' : 'bg-[#f1f5f9] text-[#717976]'
                  }`}>
                    {step.id}
                  </span>
                  <span className="material-symbols-outlined text-base">
                    {isCompleted ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold truncate">{step.title}</div>
                  <div className={`text-[10px] mt-0.5 truncate ${isSelected ? 'text-[#a6cfc5]' : 'text-[#717976]'}`}>
                    {step.category}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Selected Stage Detail Drawer / Card ─────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedStep.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="p-3.5 bg-white rounded-2xl border border-[#e0f2eb] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#e6f8f1] text-[#2e685d] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-xl">{selectedStep.icon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[#032f28] text-sm">{selectedStep.title}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  selectedStep.status === 'completed'
                    ? 'bg-[#b0ecdd] text-[#032f28]'
                    : 'bg-[#f1f5f9] text-[#717976]'
                }`}>
                  {selectedStep.status === 'completed' ? 'Confirmed' : 'Pending'}
                </span>
              </div>
              <p className="text-[#414846] text-xs mt-0.5 leading-snug">
                {selectedStep.desc}
              </p>
            </div>
          </div>

          <div className="sm:text-right shrink-0">
            <span className="text-[10px] font-mono text-[#717976] block">Category: {selectedStep.category}</span>
            <span className="text-[11px] font-bold text-[#2e685d]">Stage {selectedStep.id} of {timelineData.length}</span>
          </div>
        </motion.div>
      </AnimatePresence>

    </div>
  );
}
