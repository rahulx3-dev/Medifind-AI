import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * PromptInput — Adapted from 21st.dev PromptInput / AI Chat Input reference
 * Tailored for MediFind Clinical Medicine & Symptom Search.
 *
 * Features:
 * - Spring expansion & height physics (cubic-bezier(0.175, 0.885, 0.32, 1.275))
 * - Real-time audio frequency visualizer overlay during voice input
 * - Morphing formulation/category selector pill
 * - Smooth action button morphing (Arrow / Mic / Clear)
 * - Accessible keyboard navigation & Esc key collapse
 */
export default function PromptInput({
  searchQuery = '',
  onSearchChange = () => {},
  onSubmit = () => {},
  onOpenVoice = () => {},
  onOpenFilters = () => {},
  activeFilterCount = 0,
  selectedCategory = 'ALL',
  categories = [],
  onSelectCategory = () => {},
  isRecording = false,
  className = ''
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Click outside to collapse category menu
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsCategoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
      setIsCategoryOpen(false);
    }
  };

  const hasValue = searchQuery.trim().length > 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full transition-all duration-300 ${className}`}
    >
      <div
        className={`relative w-full rounded-xl sm:rounded-2xl transition-all duration-300 border ${
          isExpanded || hasValue
            ? 'bg-white border-[#1b7058] shadow-[0_4px_16px_rgba(27,112,88,0.12)] ring-2 ring-[#1b7058]/10'
            : 'bg-[#f1f4f6] hover:bg-[#e8ecf0] border-[#e2e8f0] shadow-2xs hover:border-[#cbd5e1]'
        }`}
      >
        {/* Top Input Bar Row */}
        <div className="flex items-center gap-2.5 px-4 py-2 sm:py-2.5">
          <span className="material-symbols-outlined text-[#475569] text-[22px] shrink-0">
            search
          </span>

          <input
            ref={inputRef}
            id="medicineSearchInput"
            type="text"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              if (!isExpanded) setIsExpanded(true);
            }}
            onFocus={() => setIsExpanded(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search"
            className="w-full bg-transparent font-bold text-xs sm:text-sm text-[#032f28] placeholder:text-[#64748b] focus:outline-none"
          />

          {/* Active Voice Listening Indicator */}
          {isRecording && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ba1a1a]/10 text-[#ba1a1a] text-xs font-bold shrink-0 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#ba1a1a]" />
              <span>Listening…</span>
            </div>
          )}

          {/* Distinct Voice Search / Mic Button */}
          <button
            type="button"
            onClick={onOpenVoice}
            className={`w-9 h-9 rounded-full transition-all shrink-0 flex items-center justify-center cursor-pointer ${
              isRecording
                ? 'bg-[#ba1a1a] text-white shadow-sm ring-2 ring-[#ba1a1a]/30'
                : 'bg-white text-[#475569] hover:bg-[#e2e8f0] border border-[#cbd5e1] shadow-2xs'
            }`}
            title="Search by voice"
            id="voice-search-btn"
          >
            <span className="material-symbols-outlined text-[19px] block">
              {isRecording ? 'graphic_eq' : 'mic'}
            </span>
          </button>

          {/* Clear Search Query Button */}
          {hasValue && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                inputRef.current?.focus();
              }}
              className="w-7 h-7 rounded-full text-[#64748b] hover:text-[#1e293b] hover:bg-white/80 transition-all shrink-0 flex items-center justify-center cursor-pointer"
              title="Clear search"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}

          {/* Distinct Filter Trigger Button */}
          <button
            type="button"
            onClick={onOpenFilters}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs ${
              activeFilterCount > 0
                ? 'bg-[#0a3d34] text-white ring-2 ring-[#0a3d34]/20'
                : 'bg-white text-[#1e293b] border border-[#cbd5e1] hover:bg-[#e2e8f0]'
            }`}
            title="Open Clinical Filters"
          >
            <span className="material-symbols-outlined text-[16px] text-[#475569]">tune</span>
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#1b7058] text-white text-[10px] flex items-center justify-center font-extrabold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Bottom Expandable Quick-Filter Capsule Row (PromptInput Footer Pattern) */}
        <AnimatePresence>
          {(isExpanded || hasValue) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.175, 0.885, 0.32, 1.275] }}
              className="border-t border-[#e0e8e5]/70 px-4 py-2 flex flex-wrap items-center justify-between gap-2 overflow-hidden text-xs"
            >
              {/* Quick Prompt Badges */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {['Paracetamol', 'Amoxicillin', 'Asthma Inhaler', 'Insulin'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      onSearchChange(chip);
                      onSubmit();
                    }}
                    className="px-2 py-0.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium text-[11px] whitespace-nowrap transition-colors cursor-pointer"
                  >
                    +{chip}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
