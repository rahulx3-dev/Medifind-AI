import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * AuthenticatedPrescriptionImage
 * Reliably loads, caches, and displays authenticated prescription images
 * using Bearer JWT authorization and safe Object URL lifecycle management.
 * 
 * Handles:
 * - Proper Authorization: Bearer headers
 * - Loading indicator / skeleton
 * - Clear error states (401 session expired, 403 restricted access, 404 not found)
 * - Safe object URL creation and revocation without early disposal
 * - Fallback to local preview / persistent data URL during new upload
 */
export default function AuthenticatedPrescriptionImage({
  prescriptionId,
  imageId = null,
  fallbackSrc = null,
  alt = 'Prescription document',
  className = '',
  style = {},
  rotation = 0,
  onClick = null,
  title = '',
  showEnlargeHint = false,
  customEmptyState = null,
  onImageLoaded = null
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  // Keep ref to active object URL for cleanup
  const activeBlobUrlRef = useRef(null);
  const abortControllerRef = useRef(null);

  const fetchImage = useCallback(async () => {
    // If no prescriptionId or mock prescription, use fallbackSrc if provided
    if (!prescriptionId || String(prescriptionId).startsWith('mock-')) {
      if (fallbackSrc) {
        setBlobUrl(fallbackSrc);
        setError(null);
        setErrorCode(null);
      } else {
        setBlobUrl(null);
      }
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('medifind_token');
    if (!token && !fallbackSrc) {
      setError('Please log in to view this prescription document.');
      setErrorCode(401);
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setErrorCode(null);

    const queryParams = new URLSearchParams();
    if (imageId) queryParams.set('imageId', imageId);
    if (token) queryParams.set('token', token);
    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const endpoint = `/api/prescriptions/${prescriptionId}/image${queryString}`;

    try {
      const res = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal
      });

      if (!res.ok) {
        setErrorCode(res.status);
        if (res.status === 401) {
          setError('Session expired or access token required. Please log in.');
        } else if (res.status === 403) {
          setError('Permission restricted: Prescription image access is restricted to the prescription owner or assigned pharmacy orders.');
        } else if (res.status === 404) {
          setError('Prescription image file not found on server.');
        } else {
          setError(`Unable to load image (HTTP ${res.status}).`);
        }
        setLoading(false);
        return;
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Received empty image content.');
      }

      const newUrl = URL.createObjectURL(blob);

      // Clean up previous blob URL if any
      if (activeBlobUrlRef.current && activeBlobUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      activeBlobUrlRef.current = newUrl;
      setBlobUrl(newUrl);
      setLoading(false);

      if (onImageLoaded) {
        onImageLoaded(newUrl);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('AuthenticatedPrescriptionImage load error:', err);
      // If we have a local fallbackSrc, gracefully use it
      if (fallbackSrc) {
        setBlobUrl(fallbackSrc);
        setError(null);
      } else {
        setError('Network error loading prescription image.');
        setErrorCode(0);
      }
      setLoading(false);
    }
  }, [prescriptionId, imageId, fallbackSrc, onImageLoaded]);

  useEffect(() => {
    fetchImage();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchImage]);

  // Clean up object URL when component completely unmounts
  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current && activeBlobUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  const displaySrc = blobUrl || fallbackSrc;

  // 1. Loading State
  if (loading && !displaySrc) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center p-6 bg-surface-container-low/70 rounded-2xl border border-outline-variant/30 min-h-[220px] ${className}`}
        style={style}
      >
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-secondary animate-spin">
            progress_activity
          </span>
          <div className="flex flex-col items-center text-center">
            <span className="text-xs font-bold text-primary">Loading Prescription Scan</span>
            <span className="text-[11px] text-on-surface-variant mt-0.5">
              Retrieving encrypted document stream...
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Error State
  if (error && !displaySrc) {
    const isForbidden = errorCode === 403;
    const isNotFound = errorCode === 404;

    return (
      <div
        className={`relative flex flex-col items-center justify-center p-5 bg-surface-container-low rounded-2xl border ${
          isForbidden ? 'border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/20' : 'border-outline-variant/40'
        } min-h-[200px] text-center ${className}`}
        style={style}
      >
        <div className="flex flex-col items-center gap-2 max-w-sm">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isForbidden ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-surface-container-high text-on-surface-variant'
          }`}>
            <span className="material-symbols-outlined text-xl">
              {isForbidden ? 'lock_person' : isNotFound ? 'broken_image' : 'error'}
            </span>
          </div>

          <span className="text-xs font-bold text-primary">
            {isForbidden ? 'Clinical Access Restricted' : isNotFound ? 'Document Not Found' : 'Preview Unavailable'}
          </span>

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            {error}
          </p>

          {!isForbidden && (
            <button
              type="button"
              onClick={fetchImage}
              className="mt-2 px-3 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container-highest text-primary text-xs font-bold transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              <span>Retry Load</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. Empty / No Document
  if (!displaySrc) {
    if (customEmptyState) return customEmptyState;
    return (
      <div
        className={`relative flex flex-col items-center justify-center p-6 bg-surface-container-low rounded-2xl border border-outline-variant/30 min-h-[200px] text-center ${className}`}
        style={style}
      >
        <span className="material-symbols-outlined text-3xl text-outline mb-1">
          description
        </span>
        <span className="text-xs font-semibold text-on-surface-variant">
          No prescription document attached
        </span>
      </div>
    );
  }

  // 4. Successful Display
  const imageStyles = {
    ...style,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transition: 'transform 0.3s ease'
  };

  return (
    <div
      onClick={onClick}
      title={title || (onClick ? 'Click to view full screen' : alt)}
      className={`relative group overflow-hidden select-none ${onClick ? 'cursor-zoom-in' : ''}`}
    >
      <img
        src={displaySrc}
        alt={alt}
        className={className}
        style={imageStyles}
        onError={() => {
          // If the image fails to decode or load
          if (errorCode !== 403) {
            setError('Image decoding failed.');
          }
        }}
      />

      {loading && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex items-center justify-center">
          <span className="material-symbols-outlined text-xl text-white animate-spin">
            progress_activity
          </span>
        </div>
      )}

      {showEnlargeHint && onClick && (
        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="material-symbols-outlined text-xs">zoom_in</span>
          <span>Click to enlarge</span>
        </div>
      )}
    </div>
  );
}
