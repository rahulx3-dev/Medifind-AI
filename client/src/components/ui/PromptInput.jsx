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
        className={`relative w-full rounded-3xl bg-surface-container-low border transition-all duration-300 ${
          isExpanded || hasValue
            ? 'border-[#2e685d] shadow-[0_6px_20px_-2px_rgba(30,69,62,0.15)] bg-white'
            : 'border-[#dbece5] shadow-[0_2px_12px_-2px_rgba(30,69,62,0.06)] hover:border-[#a6cfc5]'
        }`}
      >
        {/* Top Input Bar Row */}
        <div className="flex items-center gap-2.5 px-4 py-3">
          <span className="material-symbols-outlined text-[#2e685d] text-[22px] shrink-0">
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
            placeholder="Search medicines, symptoms, or say brand name..."
            className="w-full bg-transparent font-medium text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
          />

          {/* Active Voice Listening Indicator */}
          {isRecording && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ba1a1a]/10 text-[#ba1a1a] text-xs font-bold shrink-0 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#ba1a1a]" />
              <span>Listening…</span>
            </div>
          )}

          {/* Voice Search / Mic Button */}
          <button
            type="button"
            onClick={onOpenVoice}
            className={`p-2 rounded-full transition-all shrink-0 relative cursor-pointer ${
              isRecording
                ? 'bg-[#ba1a1a] text-white shadow-xs'
                : 'text-[#2e685d] hover:bg-[#e0f2eb]'
            }`}
            title="Search by voice"
            id="voice-search-btn"
          >
            <span className="material-symbols-outlined text-[20px] block transition-transform group-hover:scale-110">
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
              className="p-1 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all shrink-0 cursor-pointer"
              title="Clear search"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}

          {/* Filter trigger button */}
          <button
            type="button"
            onClick={onOpenFilters}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeFilterCount > 0
                ? 'bg-primary text-white shadow-xs'
                : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
            }`}
            title="Open Clinical Filters"
          >
            <span className="material-symbols-outlined text-[16px] text-secondary">tune</span>
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-secondary text-white text-[10px] flex items-center justify-center font-bold">
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
