import React, { useState, useEffect } from 'react';

/**
 * OfflineBanner — Stitch Clinical Sage Offline Status Banner
 */
export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cachedCount, setCachedCount] = useState(50);
  const [showHotlines, setShowHotlines] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowHotlines(false);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Fetch and cache offline bundle in localStorage
    async function syncOfflineBundle() {
      try {
        const res = await fetch('/api/analytics/offline-catalog');
        const data = await res.json();
        if (data.success) {
          localStorage.setItem('medifind_offline_bundle', JSON.stringify(data));
          setCachedCount(data.datasetSize || 50);
        }
      } catch (err) {
        const cached = localStorage.getItem('medifind_offline_bundle');
        if (cached) {
          const parsed = JSON.parse(cached);
          setCachedCount(parsed.datasetSize || 50);
        }
      }
    }

    syncOfflineBundle();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const hotlines = [
    { service: 'National Emergency (Police/Fire/Ambulance)', number: '112' },
    { service: 'Kerala Ambulance (EMRI)', number: '108' },
    { service: 'Kerala Health Helpline', number: '1056' },
    { service: 'AYUSH / Health Helpline (toll-free)', number: '1800-599-0019' }
  ];

  if (isOnline) return null;

  return (
    <div className="mb-6 animate-in fade-in duration-200">
      <div className="bg-[#ffdad6] border border-[#ffb4ab] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm text-[#410002]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#ba1a1a] text-white flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">wifi_off</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight">Offline Mode Engaged</span>
            <span className="text-xs text-[#5b1414] leading-relaxed">
              Operating from local offline pharmacopeia cache ({cachedCount} medicines loaded). Reservations, orders, and payments require live connectivity.
            </span>
          </div>
        </div>

        <button
          onClick={() => setShowHotlines(!showHotlines)}
          className="px-4 py-2 rounded-full bg-[#ba1a1a] hover:bg-[#93000a] text-white text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
        >
          <span className="material-symbols-outlined text-sm">phone_in_talk</span>
          <span>{showHotlines ? 'Hide Hotlines' : 'Emergency Hotlines'}</span>
        </button>
      </div>

      {showHotlines && (
        <div className="mt-3 bg-surface-container-lowest rounded-2xl p-4 sm:p-5 border border-outline-variant/30 shadow-sm animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-wider text-tertiary">
            <span className="material-symbols-outlined text-base">emergency</span>
            <span>24/7 Verified Emergency Dispatch Hotlines</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {hotlines.map(h => (
              <a
                key={h.service}
                href={`tel:${h.number}`}
                className="p-3 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/20 flex flex-col justify-between transition-colors group"
              >
                <span className="text-[11px] text-on-surface-variant line-clamp-2">{h.service}</span>
                <span className="text-base font-extrabold text-primary group-hover:text-secondary mt-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">call</span>
                  {h.number}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
