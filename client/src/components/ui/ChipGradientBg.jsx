import React from 'react';

/**
 * 5 Exact FeralUI Generative Shape Gradient Form Studies (feralui.dev/gradients):
 * 1. Celtics (soft-clover) - 4-Leaf Organic Clover (Upload prescription)
 * 2. Full circle (soft-orbit) - Glowing Sunset Orb on Sleek Dark (Emergency pharmacy)
 * 3. Endless return (soft-ring) - Violet Arching Donut Ring (Home healthcare)
 * 4. Room to rise (soft-arch) - Lime-to-Cyan Rising Arch (Clinical tele-help)
 * 5. Squared away (soft-square) - Tilted Lime/Aqua Geometric Square (Track & reorder)
 */

export const SHAPE_CONFIGS = {
  // 1. Celtics (soft-clover) - Fresh Sprout & Emerald Clover
  celtics: {
    id: 'celtics',
    name: 'Celtics (soft-clover)',
    width: 613.685,
    height: 613.685,
    path: 'M 292.181 321.504 C -97.393 711.078 711.078 711.078 321.504 321.504 C 711.079 711.078 711.079 -97.393 321.504 292.181 C 711.079 -97.394 -97.393 -97.394 292.181 292.181 C -97.394 -97.394 -97.394 711.078 292.181 321.504 Z',
    stops: [
      { offset: '0%', color: '#f0fdf4' },
      { offset: '25%', color: '#9ee89a' },
      { offset: '55%', color: '#3fbf63' },
      { offset: '80%', color: '#007a33' },
      { offset: '100%', color: '#044d22' }
    ],
    gradCoords: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
    bg: '#ffffff',
    blur: 8,
    opacity: 0.95,
    style: {
      position: 'absolute',
      right: '-25px',
      top: '-20px',
      width: '185px',
      height: '185px',
      transform: 'rotate(5deg)'
    }
  },

  // 2. Full circle (soft-orbit) - Medical Emergency Coral & Rose Orb
  'full-circle': {
    id: 'full-circle',
    name: 'Full circle (soft-orbit)',
    width: 677.604,
    height: 677.604,
    path: 'M 677.604 338.802 C 677.604 525.917 525.917 677.604 338.802 677.604 C 151.687 677.604 0 525.917 0 338.802 C 0 151.687 151.687 0 338.802 0 C 525.917 0 677.604 151.687 677.604 338.802 Z',
    stops: [
      { offset: '0%', color: '#ffe4e6' },
      { offset: '30%', color: '#fb7185' },
      { offset: '65%', color: '#f43f5e' },
      { offset: '100%', color: '#e11d48' }
    ],
    gradCoords: { x1: '0%', y1: '50%', x2: '100%', y2: '50%' },
    bg: '#ffffff',
    blur: 8,
    opacity: 0.95,
    style: {
      position: 'absolute',
      right: '-45px',
      top: '50%',
      width: '210px',
      height: '210px',
      transform: 'translateY(-50%)'
    }
  },

  // 3. Endless return (soft-ring) - Violet Donut Ring
  'endless-return': {
    id: 'endless-return',
    name: 'Endless return (soft-ring)',
    width: 512.657,
    height: 512.657,
    path: 'M 121.188 256.329 C 121.188 181.693 181.693 121.189 256.328 121.189 C 330.964 121.189 391.469 181.693 391.469 256.329 C 391.469 330.964 330.965 391.469 256.328 391.469 C 181.693 391.469 121.188 330.965 121.188 256.329 Z M 0 256.329 C 0 397.895 114.762 512.657 256.328 512.657 C 397.894 512.657 512.657 397.895 512.657 256.329 C 512.657 114.763 397.894 0 256.328 0 C 114.762 0 0 114.763 0 256.329 Z',
    stops: [
      { offset: '0%', color: '#fcf9ff' },
      { offset: '25%', color: '#e9c7ff' },
      { offset: '55%', color: '#b875e8' },
      { offset: '82%', color: '#665ed2' },
      { offset: '100%', color: '#263a82' }
    ],
    gradCoords: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
    bg: '#ffffff',
    blur: 8,
    opacity: 0.95,
    style: {
      position: 'absolute',
      right: '-32px',
      bottom: '-32px',
      width: '190px',
      height: '190px'
    }
  },

  // 4. Room to rise (soft-arch) - Rising Lime-to-Cyan Arch
  'room-to-rise': {
    id: 'room-to-rise',
    name: 'Room to rise (soft-arch)',
    width: 670.315,
    height: 360.304,
    path: 'M 511.857 360.304 C 511.857 255.394 432.746 170.347 335.157 170.347 C 237.569 170.347 158.457 255.394 158.457 360.304 L 0 360.304 C 0 161.314 150.055 0 335.157 0 C 520.259 0 670.315 161.314 670.315 360.304 L 511.857 360.304 Z',
    stops: [
      { offset: '0%', color: '#e9ff95' },
      { offset: '35%', color: '#59e39c' },
      { offset: '70%', color: '#1ec9d8' },
      { offset: '100%', color: '#2874f0' }
    ],
    gradCoords: { x1: '0%', y1: '50%', x2: '100%', y2: '50%' },
    bg: '#ffffff',
    blur: 7,
    opacity: 0.95,
    style: {
      position: 'absolute',
      right: '-5px',
      bottom: '-4px',
      width: '195px',
      height: '105px'
    }
  },

  // 5. Squared away (soft-square) - Logistics Sky & Sapphire Square
  'squared-away': {
    id: 'squared-away',
    name: 'Squared away (soft-square)',
    width: 542.942,
    height: 542.942,
    path: 'M 0 0 L 542.942 0 L 542.942 542.942 L 0 542.942 L 0 0 Z',
    stops: [
      { offset: '0%', color: '#e0f2fe' },
      { offset: '30%', color: '#7dd3fc' },
      { offset: '65%', color: '#38bdf8' },
      { offset: '100%', color: '#0284c7' }
    ],
    gradCoords: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
    bg: '#ffffff',
    blur: 7,
    opacity: 0.95,
    style: {
      position: 'absolute',
      right: '-18px',
      bottom: '-28px',
      width: '145px',
      height: '145px',
      transform: 'rotate(8deg)'
    }
  }
};

// Aliases for compatibility
SHAPE_CONFIGS['clover'] = SHAPE_CONFIGS.celtics;
SHAPE_CONFIGS['mint'] = SHAPE_CONFIGS.celtics;

SHAPE_CONFIGS['orbit'] = SHAPE_CONFIGS['full-circle'];
SHAPE_CONFIGS['coral'] = SHAPE_CONFIGS['full-circle'];
SHAPE_CONFIGS['scallop'] = SHAPE_CONFIGS['full-circle'];

SHAPE_CONFIGS['ring'] = SHAPE_CONFIGS['endless-return'];
SHAPE_CONFIGS['lavender'] = SHAPE_CONFIGS['endless-return'];

SHAPE_CONFIGS['arch'] = SHAPE_CONFIGS['room-to-rise'];
SHAPE_CONFIGS['azure'] = SHAPE_CONFIGS['room-to-rise'];

SHAPE_CONFIGS['square'] = SHAPE_CONFIGS['squared-away'];
SHAPE_CONFIGS['sky'] = SHAPE_CONFIGS['squared-away'];

export default function ChipGradientBg({ presetKey = 'celtics' }) {
  const config = SHAPE_CONFIGS[presetKey] || SHAPE_CONFIGS.celtics;
  const gradId = `shape-grad-${config.id}`;
  const filterId = `shape-diffuse-${config.id}`;

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden rounded-2xl z-0 select-none">
      {/* 1. Full-bleed background color filling 100% of the chip box */}
      <div
        className="absolute inset-0 w-full h-full pointer-events-none dark:hidden"
        style={{ backgroundColor: config.bg }}
      />

      {/* 2. The exact vector shape from feralui.dev with feathered blur */}
      <svg
        className="pointer-events-none transition-transform duration-500 ease-out group-hover:scale-105"
        style={{
          ...config.style,
          filter: `blur(${config.blur}px)`
        }}
        viewBox={`0 0 ${config.width} ${config.height}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id={gradId}
            x1={config.gradCoords.x1}
            y1={config.gradCoords.y1}
            x2={config.gradCoords.x2}
            y2={config.gradCoords.y2}
          >
            {config.stops.map((stop, index) => (
              <stop key={index} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>

        {/* The clean, unmistakable geometric silhouette */}
        <path
          d={config.path}
          fill={`url(#${gradId})`}
          opacity={config.opacity}
        />
      </svg>
    </div>
  );
}
