import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  calculateRotatedDimensions,
  getCombinedRotation,
  applySharpening
} from '../utils/imageEnhancement';

export {
  calculateRotatedDimensions,
  getCombinedRotation,
  applySharpening
};

/**
 * ImageCropperModal
 * Interactive, high-precision image cropping, fine-angle deskewing & sharpening modal for prescription photos.
 * Uses native HTML5 canvas and pointer events with zero external dependencies.
 */
export default function ImageCropperModal({
  isOpen,
  imageSrc,
  fileName = 'prescription_photo.jpg',
  onClose,
  onCropComplete
}) {
  const containerRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imgObj, setImgObj] = useState(null);

  // Enhancement States
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270 degrees
  const [fineAngle, setFineAngle] = useState(0); // -10.0 to +10.0 degrees (fine deskew)
  const [sharpen, setSharpen] = useState(0); // 0 to 100% real convolution sharpening
  const [brightness, setBrightness] = useState(100); // 70 to 160%
  const [contrast, setContrast] = useState(100); // 70 to 180%

  // Dimensions of the scaled display canvas within container
  const [displayDim, setDisplayDim] = useState({ width: 0, height: 0, scale: 1 });

  // Crop rect in displayed pixels: { x, y, width, height }
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null); // 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, crop: { x: 0, y: 0, width: 0, height: 0 } });
  const prevCoarseRotationRef = useRef(rotation);

  // Load image whenever imageSrc changes
  useEffect(() => {
    if (!isOpen || !imageSrc) {
      setImageLoaded(false);
      setImgObj(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImgObj(img);
      setImageLoaded(true);
    };
    img.src = imageSrc;
  }, [isOpen, imageSrc]);

  // Compute unclipped rotated display size and manage crop box
  const computeLayout = useCallback(() => {
    if (!imgObj || !containerRef.current) return;

    const container = containerRef.current;
    const maxW = container.clientWidth ? Math.max(280, container.clientWidth - 32) : 600;
    const maxH = 420;

    const totalAngle = getCombinedRotation(rotation, fineAngle);
    const { width: naturalW, height: naturalH } = calculateRotatedDimensions(
      imgObj.naturalWidth,
      imgObj.naturalHeight,
      totalAngle
    );

    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    setDisplayDim({ width, height, scale, naturalW, naturalH });

    const coarseChanged = prevCoarseRotationRef.current !== rotation;
    prevCoarseRotationRef.current = rotation;

    setCrop(prevCrop => {
      // Re-initialize default 5% inset if crop is not set or coarse 90° rotation changed
      if (!prevCrop.width || !prevCrop.height || coarseChanged) {
        const insetX = Math.round(width * 0.05);
        const insetY = Math.round(height * 0.05);
        return {
          x: insetX,
          y: insetY,
          width: Math.max(50, width - insetX * 2),
          height: Math.max(50, height - insetY * 2)
        };
      }

      // Smoothly clamp existing crop box to stay within updated canvas bounds during fine deskew
      const clampedW = Math.min(prevCrop.width, width);
      const clampedH = Math.min(prevCrop.height, height);
      const clampedX = Math.min(Math.max(0, prevCrop.x), width - clampedW);
      const clampedY = Math.min(Math.max(0, prevCrop.y), height - clampedH);

      return {
        x: clampedX,
        y: clampedY,
        width: Math.max(50, clampedW),
        height: Math.max(50, clampedH)
      };
    });
  }, [imgObj, rotation, fineAngle]);

  useEffect(() => {
    if (imageLoaded) {
      computeLayout();
    }
  }, [imageLoaded, computeLayout]);

  // Render preview canvas immediately whenever image, rotation, deskew, filters, or sharpening change
  useEffect(() => {
    if (!previewCanvasRef.current || !imgObj || !imageLoaded || displayDim.width === 0) return;

    const canvas = previewCanvasRef.current;
    canvas.width = displayDim.width;
    canvas.height = displayDim.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (brightness !== 100 || contrast !== 100) {
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    }

    const totalAngle = getCombinedRotation(rotation, fineAngle);
    const rad = (totalAngle * Math.PI) / 180;

    // Center and rotate image within unclipped preview canvas
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);

    const scaledW = imgObj.naturalWidth * displayDim.scale;
    const scaledH = imgObj.naturalHeight * displayDim.scale;
    ctx.drawImage(imgObj, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();

    // Apply real-time preview sharpening if strength > 0
    if (sharpen > 0) {
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        applySharpening(imgData, sharpen);
        ctx.putImageData(imgData, 0, 0);
      } catch (err) {
        // Cross-origin image fallback: silently ignore canvas read errors in preview
      }
    }
  }, [imgObj, imageLoaded, displayDim, rotation, fineAngle, brightness, contrast, sharpen]);

  // Pointer event handlers for interactive dragging
  const handlePointerDown = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragMode(mode);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      crop: { ...crop }
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const initial = dragStartRef.current.crop;
      const { width: maxW, height: maxH } = displayDim;
      const minSize = 50;

      let nextX = initial.x;
      let nextY = initial.y;
      let nextW = initial.width;
      let nextH = initial.height;

      switch (dragMode) {
        case 'move':
          nextX = Math.min(Math.max(0, initial.x + dx), maxW - initial.width);
          nextY = Math.min(Math.max(0, initial.y + dy), maxH - initial.height);
          break;

        case 'se': // Bottom-right corner
          nextW = Math.min(Math.max(minSize, initial.width + dx), maxW - initial.x);
          nextH = Math.min(Math.max(minSize, initial.height + dy), maxH - initial.y);
          break;

        case 'sw': // Bottom-left corner
          {
            const targetX = Math.max(0, Math.min(initial.x + dx, initial.x + initial.width - minSize));
            nextW = initial.width + (initial.x - targetX);
            nextX = targetX;
            nextH = Math.min(Math.max(minSize, initial.height + dy), maxH - initial.y);
          }
          break;

        case 'ne': // Top-right corner
          {
            const targetY = Math.max(0, Math.min(initial.y + dy, initial.y + initial.height - minSize));
            nextH = initial.height + (initial.y - targetY);
            nextY = targetY;
            nextW = Math.min(Math.max(minSize, initial.width + dx), maxW - initial.x);
          }
          break;

        case 'nw': // Top-left corner
          {
            const targetX = Math.max(0, Math.min(initial.x + dx, initial.x + initial.width - minSize));
            const targetY = Math.max(0, Math.min(initial.y + dy, initial.y + initial.height - minSize));
            nextW = initial.width + (initial.x - targetX);
            nextH = initial.height + (initial.y - targetY);
            nextX = targetX;
            nextY = targetY;
          }
          break;

        case 'n': // Top edge
          {
            const targetY = Math.max(0, Math.min(initial.y + dy, initial.y + initial.height - minSize));
            nextH = initial.height + (initial.y - targetY);
            nextY = targetY;
          }
          break;

        case 's': // Bottom edge
          nextH = Math.min(Math.max(minSize, initial.height + dy), maxH - initial.y);
          break;

        case 'w': // Left edge
          {
            const targetX = Math.max(0, Math.min(initial.x + dx, initial.x + initial.width - minSize));
            nextW = initial.width + (initial.x - targetX);
            nextX = targetX;
          }
          break;

        case 'e': // Right edge
          nextW = Math.min(Math.max(minSize, initial.width + dx), maxW - initial.x);
          break;

        default:
          break;
      }

      setCrop({
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.round(nextW),
        height: Math.round(nextH)
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, dragMode, displayDim]);

  // Handle 90° Coarse Rotate
  const handleRotate90 = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  // Reset to full view and default enhancement
  const handleReset = () => {
    setRotation(0);
    setFineAngle(0);
    setSharpen(0);
    setBrightness(100);
    setContrast(100);
    if (displayDim.width > 0) {
      setCrop({
        x: 0,
        y: 0,
        width: displayDim.width,
        height: displayDim.height
      });
    }
  };

  // Optimize readability preset (sharpens handwriting and boosts contrast against light paper)
  const handleOptimizeReadability = () => {
    setBrightness(105);
    setContrast(135);
    setSharpen(30);
  };

  // Execute unclipped rotation, crop, filter, sharpening and output Blob / File
  const handleApplyCrop = () => {
    if (!imgObj || !imageLoaded) return;

    const totalAngle = getCombinedRotation(rotation, fineAngle);
    const { width: rotW, height: rotH } = calculateRotatedDimensions(
      imgObj.naturalWidth,
      imgObj.naturalHeight,
      totalAngle
    );

    // Full-resolution source canvas with unclipped expanded bounds
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = rotW;
    sourceCanvas.height = rotH;
    const sCtx = sourceCanvas.getContext('2d');
    if (!sCtx) return;

    sCtx.save();
    sCtx.translate(rotW / 2, rotH / 2);
    sCtx.rotate((totalAngle * Math.PI) / 180);
    sCtx.drawImage(
      imgObj,
      -imgObj.naturalWidth / 2,
      -imgObj.naturalHeight / 2,
      imgObj.naturalWidth,
      imgObj.naturalHeight
    );
    sCtx.restore();

    // Map display pixel coordinates back to full natural resolution
    const scaleFactor = displayDim.scale || 1;
    const cropX = Math.max(0, Math.min(rotW - 1, Math.round(crop.x / scaleFactor)));
    const cropY = Math.max(0, Math.min(rotH - 1, Math.round(crop.y / scaleFactor)));
    const cropW = Math.max(1, Math.min(rotW - cropX, Math.round(crop.width / scaleFactor)));
    const cropH = Math.max(1, Math.min(rotH - cropY, Math.round(crop.height / scaleFactor)));

    // Create final cropped canvas
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cropW;
    finalCanvas.height = cropH;
    const fCtx = finalCanvas.getContext('2d');
    if (!fCtx) return;

    // Apply brightness and contrast enhancement
    if (brightness !== 100 || contrast !== 100) {
      fCtx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    }

    fCtx.drawImage(
      sourceCanvas,
      cropX, cropY, cropW, cropH,
      0, 0, cropW, cropH
    );
    fCtx.filter = 'none';

    // Apply real pixel-level sharpening before export
    if (sharpen > 0) {
      try {
        const imageData = fCtx.getImageData(0, 0, cropW, cropH);
        applySharpening(imageData, sharpen);
        fCtx.putImageData(imageData, 0, 0);
      } catch (err) {
        console.warn('Canvas pixel sharpening bypassed due to security context:', err);
      }
    }

    finalCanvas.toBlob(blob => {
      if (!blob) return;
      const cleanName = fileName.replace(/\.[^/.]+$/, "") + "_enhanced.jpg";
      const croppedFile = new File([blob], cleanName, { type: 'image/jpeg' });
      const croppedUrl = URL.createObjectURL(blob);
      if (onCropComplete) {
        onCropComplete(blob, croppedFile, croppedUrl, {
          rotation,
          fineAngle,
          totalRotation: totalAngle,
          crop: { x: cropX, y: cropY, width: cropW, height: cropH },
          brightness,
          contrast,
          sharpen
        });
      }
      onClose();
    }, 'image/jpeg', 0.95);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Crop and Deskew Prescription Photo"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-surface-container-lowest rounded-3xl p-5 sm:p-6 shadow-2xl border border-outline-variant/30 flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-container">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-base">crop</span>
            </span>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-primary">Crop & Enhance Prescription Photo</h3>
              <p className="text-[11px] text-on-surface-variant">
                Fine-tune angle deskewing, crop margins, and sharpen handwriting for clearer medical review.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Workspace Canvas Container */}
        <div
          ref={containerRef}
          className="relative w-full min-h-[340px] max-h-[460px] bg-black/90 rounded-2xl flex items-center justify-center overflow-hidden select-none p-2"
        >
          {imageLoaded && displayDim.width > 0 ? (
            <div
              className="relative"
              style={{
                width: displayDim.width,
                height: displayDim.height
              }}
            >
              {/* Underlying Rotated Canvas Preview */}
              <canvas
                ref={previewCanvasRef}
                width={displayDim.width}
                height={displayDim.height}
                className="select-none pointer-events-none rounded-lg"
                style={{
                  width: displayDim.width,
                  height: displayDim.height
                }}
              />

              {/* Dimmed Surrounding Overlay (using box-shadow trick) */}
              <div
                style={{
                  position: 'absolute',
                  left: crop.x,
                  top: crop.y,
                  width: crop.width,
                  height: crop.height,
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'none'
                }}
              />

              {/* Active Crop Box */}
              <div
                onPointerDown={e => handlePointerDown(e, 'move')}
                style={{
                  position: 'absolute',
                  left: crop.x,
                  top: crop.y,
                  width: crop.width,
                  height: crop.height,
                  cursor: 'move',
                  border: '2px solid #2DD4BF',
                  boxSizing: 'border-box'
                }}
                className="group select-none"
              >
                {/* Rule of Thirds Grid Lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                  <div className="border-r border-b border-white/50" />
                  <div className="border-r border-b border-white/50" />
                  <div className="border-b border-white/50" />
                  <div className="border-r border-b border-white/50" />
                  <div className="border-r border-b border-white/50" />
                  <div className="border-b border-white/50" />
                  <div className="border-r border-b border-white/50" />
                  <div className="border-r border-b border-white/50" />
                  <div />
                </div>

                {/* 4 Corner Handles */}
                <div
                  onPointerDown={e => handlePointerDown(e, 'nw')}
                  className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-[#006A60] rounded-sm cursor-nwse-resize shadow-md"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 'ne')}
                  className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-[#006A60] rounded-sm cursor-nesw-resize shadow-md"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 'sw')}
                  className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-[#006A60] rounded-sm cursor-nesw-resize shadow-md"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 'se')}
                  className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-[#006A60] rounded-sm cursor-nwse-resize shadow-md"
                />

                {/* 4 Edge Handles */}
                <div
                  onPointerDown={e => handlePointerDown(e, 'n')}
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 bg-white/90 border border-[#006A60] rounded-sm cursor-ns-resize shadow-xs"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 's')}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-3 bg-white/90 border border-[#006A60] rounded-sm cursor-ns-resize shadow-xs"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 'w')}
                  className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-8 bg-white/90 border border-[#006A60] rounded-sm cursor-ew-resize shadow-xs"
                />
                <div
                  onPointerDown={e => handlePointerDown(e, 'e')}
                  className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-8 bg-white/90 border border-[#006A60] rounded-sm cursor-ew-resize shadow-xs"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-white/70 gap-2">
              <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
              <span className="text-xs">Preparing prescription image for cropping...</span>
            </div>
          )}
        </div>

        {/* Enhancement Controls Bar (Rotation, Deskew, Sharpening, Brightness, Contrast) */}
        <div className="flex flex-col gap-2.5 p-3 rounded-2xl bg-surface-container-low border border-outline-variant/30 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRotate90}
                className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
                title="Rotate image 90 degrees clockwise"
              >
                <span className="material-symbols-outlined text-sm">rotate_right</span>
                <span>Rotate 90°</span>
              </button>
              <button
                type="button"
                onClick={handleOptimizeReadability}
                className="px-3 py-1.5 rounded-full bg-secondary-container hover:bg-secondary/20 text-on-secondary-container font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
                title="Apply optimal sharpening, contrast, and exposure for handwritten prescription readability"
              >
                <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                <span>Optimize Readability</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
                title="Reset all adjustments, deskew angle, and crop to original"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span>
                <span>Reset All</span>
              </button>
            </div>

            <div className="text-[11px] text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-secondary">tune</span>
              <span>Crop, Deskew & Enhancement Tools</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-surface-container">
            {/* Fine-Angle Deskew Slider (-10° to +10°) */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-primary w-18 shrink-0 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">straighten</span>
                Deskew:
              </span>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.5"
                value={fineAngle}
                onChange={e => setFineAngle(Number(e.target.value))}
                className="w-full accent-primary h-1.5 bg-surface-container-high rounded-lg cursor-pointer"
                aria-label="Fine-angle deskew rotation from -10 to +10 degrees"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] font-mono text-on-surface-variant w-11 text-right">
                  {fineAngle > 0 ? `+${fineAngle.toFixed(1)}°` : `${fineAngle.toFixed(1)}°`}
                </span>
                {fineAngle !== 0 && (
                  <button
                    type="button"
                    onClick={() => setFineAngle(0)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-surface-container hover:bg-surface-container-high text-primary font-bold transition-colors"
                    title="Reset deskew to 0°"
                  >
                    0°
                  </button>
                )}
              </div>
            </div>

            {/* Real Sharpening Slider (0% to 100%) */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-primary w-18 shrink-0 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">filter_hdr</span>
                Sharpen:
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={sharpen}
                onChange={e => setSharpen(Number(e.target.value))}
                className="w-full accent-primary h-1.5 bg-surface-container-high rounded-lg cursor-pointer"
                aria-label="Pixel sharpening intensity from 0 to 100 percent"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] font-mono text-on-surface-variant w-11 text-right">
                  {sharpen}%
                </span>
                {sharpen !== 0 && (
                  <button
                    type="button"
                    onClick={() => setSharpen(0)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-surface-container hover:bg-surface-container-high text-primary font-bold transition-colors"
                    title="Reset sharpening to 0%"
                  >
                    0%
                  </button>
                )}
              </div>
            </div>

            {/* Contrast Slider */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-primary w-18 shrink-0 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">contrast</span>
                Contrast:
              </span>
              <input
                type="range"
                min="70"
                max="180"
                value={contrast}
                onChange={e => setContrast(Number(e.target.value))}
                className="w-full accent-primary h-1.5 bg-surface-container-high rounded-lg cursor-pointer"
                aria-label="Image contrast adjustment"
              />
              <span className="text-[11px] font-mono text-on-surface-variant w-11 text-right shrink-0">{contrast}%</span>
            </div>

            {/* Brightness Slider */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-primary w-18 shrink-0 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">brightness_medium</span>
                Bright:
              </span>
              <input
                type="range"
                min="70"
                max="160"
                value={brightness}
                onChange={e => setBrightness(Number(e.target.value))}
                className="w-full accent-primary h-1.5 bg-surface-container-high rounded-lg cursor-pointer"
                aria-label="Image brightness adjustment"
              />
              <span className="text-[11px] font-mono text-on-surface-variant w-9 text-right shrink-0">{brightness}%</span>
            </div>
          </div>
        </div>

        {/* Clinical Disclaimer Banner */}
        <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-2">
          <span className="material-symbols-outlined text-xs text-amber-600 shrink-0">verified_user</span>
          <span>Enhancement improves visual clarity for review, but does not guarantee OCR accuracy. Original photo is always preserved.</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-surface-container">
          <div className="text-[11px] text-on-surface-variant">
            Saves as a new version under this prescription.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-bold text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyCrop}
              className="px-5 py-2 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">check</span>
              <span>Apply & Save Version</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
