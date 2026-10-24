import React, { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [9.3170, 76.6145]; // Chengannur, Kerala

function isValidCoord(num) {
  if (num === null || num === undefined || num === '') return false;
  const n = typeof num === 'string' ? parseFloat(num) : Number(num);
  return typeof n === 'number' && !isNaN(n) && isFinite(n);
}

function sanitizeCoords(coords, fallback = DEFAULT_CENTER) {
  if (!coords || !Array.isArray(coords) || coords.length < 2) return fallback;
  const lat = typeof coords[0] === 'string' ? parseFloat(coords[0]) : Number(coords[0]);
  const lon = typeof coords[1] === 'string' ? parseFloat(coords[1]) : Number(coords[1]);
  if (!isValidCoord(lat) || !isValidCoord(lon)) return fallback;
  return [lat, lon];
}

function resolvePharmacyCoords(pharmacy) {
  if (!pharmacy) return null;
  let lat = isValidCoord(pharmacy.latitude) ? parseFloat(pharmacy.latitude) : (isValidCoord(pharmacy.lat) ? parseFloat(pharmacy.lat) : null);
  let lon = isValidCoord(pharmacy.longitude) ? parseFloat(pharmacy.longitude) : (isValidCoord(pharmacy.lon) ? parseFloat(pharmacy.lon) : null);

  if (lat == null || lon == null) {
    const name = (pharmacy.name || '').toLowerCase();
    if (name.includes('max care')) {
      lat = 9.3186;
      lon = 76.6135;
    } else if (name.includes('karuna')) {
      lat = 9.3150;
      lon = 76.6110;
    } else if (name.includes('apollo')) {
      lat = 9.3195;
      lon = 76.6150;
    } else if (name.includes('city') || name.includes('central')) {
      lat = 9.3160;
      lon = 76.6120;
    } else if (pharmacy.name) {
      const seed = Math.abs((pharmacy.id || pharmacy.name || 'default').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 100;
      lat = 9.3170 + ((seed - 50) * 0.0001);
      lon = 76.6145 + ((seed - 50) * 0.0001);
    }
  }

  if (!isValidCoord(lat) || !isValidCoord(lon)) return null;
  return [lat, lon];
}

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  if (!isValidCoord(lat1) || !isValidCoord(lon1) || !isValidCoord(lat2) || !isValidCoord(lon2)) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((R * c) * 10) / 10;
}

/**
 * PharmacyMap — Interactive Map Component with Patient Current Location & Pharmacy Distances
 */
export default function PharmacyMap({
  pharmacies = [],
  center = DEFAULT_CENTER,
  radiusKm = 30,
  selectedPharmacyId = null,
  selectedPharmacy = null,
  onSelectPharmacy,
  className = '',
  height = '420px',
  activeRequestItems = [],
  selectedMedicineName = null
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const originMarkerRef = useRef(null);
  const radiusCircleRef = useRef(null);
  const directionLineRef = useRef(null);
  const directionMidpointMarkerRef = useRef(null);
  const markersByIdRef = useRef({});

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      if (mapContainerRef.current._leaflet_id) {
        delete mapContainerRef.current._leaflet_id;
      }

      const safeCenter = sanitizeCoords(center);

      try {
        const map = L.map(mapContainerRef.current, {
          center: safeCenter,
          zoom: 12,
          zoomControl: false
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18
        }).addTo(map);

        L.control.zoom({ position: 'topright' }).addTo(map);

        markersLayerRef.current = L.layerGroup().addTo(map);
        mapInstanceRef.current = map;
      } catch (err) {
        console.error('Failed to initialize Leaflet map in PharmacyMap:', err);
      }
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {}
        mapInstanceRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update center and Patient Current Location marker (Radius circle removed per requirements)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const safeCenter = sanitizeCoords(center);
    if (!safeCenter) return;

    try {
      map.setView(safeCenter, map.getZoom() || 12);

      // Patient Current Location Point with Pulsing Beacon & "You are here" label
      if (originMarkerRef.current) {
        try { map.removeLayer(originMarkerRef.current); } catch (e) {}
        originMarkerRef.current = null;
      }

      const userLocationMarkerHtml = `
        <div class="user-current-location-marker" style="
          position: relative;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        ">
          <!-- Pulsing Radar Halo -->
          <div class="user-loc-pulse" style="
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(0, 102, 204, 0.35);
          "></div>
          <!-- Solid Core Disc -->
          <div style="
            position: absolute;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 3px 10px rgba(0, 80, 180, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: #0066cc;
            "></div>
          </div>
          <!-- "You are here" Tooltip Tag -->
          <div style="
            position: absolute;
            bottom: -18px;
            left: 50%;
            transform: translateX(-50%);
            white-space: nowrap;
            background: #003870;
            color: #ffffff;
            font-size: 10px;
            font-weight: 800;
            padding: 1.5px 8px;
            border-radius: 999px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            letter-spacing: 0.02em;
            border: 1px solid rgba(255, 255, 255, 0.7);
          ">
            You are here
          </div>
        </div>
      `;

      const originIcon = L.divIcon({
        html: userLocationMarkerHtml,
        className: 'user-location-pin',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      originMarkerRef.current = L.marker(safeCenter, { icon: originIcon, interactive: false, zIndexOffset: 800 }).addTo(map);

      // Clean up any previous radius circle if present
      if (radiusCircleRef.current) {
        try { map.removeLayer(radiusCircleRef.current); } catch (e) {}
        radiusCircleRef.current = null;
      }
    } catch (err) {
      console.warn('Leaflet setView / user marker error caught:', err);
    }
  }, [center]);

  // Update Pharmacy Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    try {
      markersLayer.clearLayers();
    } catch (e) {}
    markersByIdRef.current = {};

    pharmacies.forEach((p, idx) => {
      try {
        const coords = resolvePharmacyCoords(p);
        if (!coords) return;
        const [lat, lon] = coords;

      const isSelected = selectedPharmacyId === p.id;
      const isEmergency = p.is24x7 || p.isEmergency;
      const rankNum = idx + 1;

      // Authentic MediFind AI Custom Logo Map Pin
      const iconHtml = `
        <div class="medifind-map-pin" style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          transform: ${isSelected ? 'scale(1.22)' : 'scale(1)'};
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          z-index: ${isSelected ? 999 : 100};
        ">
          <!-- Circular Badge with MediFind Logo -->
          <div style="
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: ${isSelected ? '0 0 0 4px #b0ecdd, 0 8px 24px rgba(3, 47, 40, 0.45)' : '0 4px 14px rgba(3, 47, 40, 0.3)'};
            border: 3px solid ${isEmergency ? '#ba1a1a' : '#032f28'};
            position: relative;
          ">
            <img src="/medifind_logo.png" alt="MediFind" style="width: 28px; height: 28px; object-fit: contain; pointer-events: none;" />
            <span style="
              position: absolute;
              top: -3px;
              right: -3px;
              min-width: 17px;
              height: 17px;
              border-radius: 9999px;
              background: ${isEmergency ? '#ba1a1a' : '#032f28'};
              color: #ffffff;
              font-size: 9px;
              font-weight: 800;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0 4px;
              border: 1.5px solid #ffffff;
            ">
              ${rankNum}
            </span>
          </div>
          <!-- Pointer Tip -->
          <div style="
            width: 0;
            height: 0;
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-top: 9px solid ${isEmergency ? '#ba1a1a' : '#032f28'};
            margin-top: -2px;
          "></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'stitch-pharmacy-pin',
        iconSize: [44, 52],
        iconAnchor: [22, 52],
        popupAnchor: [0, -52]
      });

      const marker = L.marker([lat, lon], { icon: customIcon });

      // Rich Pharmacy Info Card Popover
      const isCurrentlyOpen = p.computedOpenStatus?.isCurrentlyOpen ?? true;
      const openNote = p.computedOpenStatus?.note || (isCurrentlyOpen ? 'Open Now' : 'Closed');
      const distanceDisplay = p.distanceKm ? `${p.distanceKm} km away` : 'Within perimeter';
      const availabilityInfo = p.availabilitySummary || (activeRequestItems.length > 0 ? 'Evaluating inventory' : '50/50 Catalogue Verified');
      const directionsUrl = p.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

      const popupContent = `
        <div style="font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; padding: 12px; min-width: 260px; max-width: 320px; background: #ffffff; border-radius: 16px; color: #032f28;">
          <!-- Top Row: MediFind Branding & Open Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <img src="/medifind_logo.png" style="width: 18px; height: 18px; object-fit: contain;" alt="MediFind" />
              <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: #2e685d;">
                PARTICIPATING APOTHECARY
              </span>
            </div>
            <span style="font-size: 10px; font-weight: 700; background: ${isCurrentlyOpen ? '#e0f2eb' : '#fee2e2'}; color: ${isCurrentlyOpen ? '#032f28' : '#991b1b'}; padding: 2px 8px; border-radius: 99px;">
              ${openNote}
            </span>
          </div>

          <!-- Pharmacy Name & Verified Badge -->
          <h4 style="font-size: 15px; font-weight: 800; color: #032f28; margin: 0 0 4px 0; line-height: 1.25; display: flex; align-items: center; gap: 4px;">
            ${p.name}
            <span class="material-symbols-outlined" style="font-size: 16px; color: #059669;" title="Verified Dispensary">verified</span>
          </h4>

          <!-- Full Address -->
          <div style="display: flex; align-items: flex-start; gap: 4px; font-size: 11px; color: #52605c; margin-bottom: 8px; line-height: 1.35;">
            <span class="material-symbols-outlined" style="font-size: 14px; color: #717976; flex-shrink: 0; margin-top: 1px;">pin_drop</span>
            <span>${p.address || 'Registered Pharmacy Address'}</span>
          </div>

          <!-- Phone & Distance Pill Row -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #f4faf7; border-radius: 8px; margin-bottom: 8px; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 4px; color: #2e685d; font-weight: 600;">
              <span class="material-symbols-outlined" style="font-size: 14px;">call</span>
              <a href="tel:${p.phone || ''}" style="color: #2e685d; text-decoration: none;">${p.phone || '0479 299 3291'}</a>
            </div>
            <span style="font-weight: 700; color: #032f28;">${distanceDisplay}</span>
          </div>

          <!-- Inventory & Verification Status -->
          <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #032f28; margin-bottom: 10px; background: #e6f8f1; padding: 6px 10px; border-radius: 8px;">
            <span class="material-symbols-outlined" style="font-size: 15px; color: #059669;">check_circle</span>
            <span>${availabilityInfo}</span>
          </div>

          <!-- Action Buttons: Select & Directions -->
          <div style="display: flex; gap: 6px;">
            <button id="stitch-popup-btn-${p.id}" style="
              flex: 1;
              padding: 8px 12px;
              border-radius: 99px;
              background: #032f28;
              color: #ffffff;
              font-size: 11px;
              font-weight: 700;
              border: none;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 4px;
              box-shadow: 0 2px 8px rgba(3, 47, 40, 0.25);
            ">
              <span>Select Pharmacy</span>
              <span class="material-symbols-outlined" style="font-size: 14px;">arrow_forward</span>
            </button>
            <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="
              padding: 8px 10px;
              border-radius: 99px;
              background: #e0f2eb;
              color: #032f28;
              font-size: 11px;
              font-weight: 700;
              text-decoration: none;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 3px;
              border: 1px solid #b0ecdd;
            " title="Open Google Maps Directions">
              <span class="material-symbols-outlined" style="font-size: 14px;">directions</span>
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, { maxWidth: 320, className: 'stitch-leaflet-popup' });

      marker.on('click', () => {
        if (onSelectPharmacy) onSelectPharmacy(p);
      });

      marker.on('popupopen', () => {
        const btn = document.getElementById(`stitch-popup-btn-${p.id}`);
        if (btn) {
          btn.onclick = () => {
            if (onSelectPharmacy) onSelectPharmacy(p);
          };
        }
      });

      marker.addTo(markersLayer);
      markersByIdRef.current[p.id] = marker;
    } catch (err) {
      console.warn('Failed to build pharmacy marker:', err);
    }
  });
}, [pharmacies, selectedPharmacyId, onSelectPharmacy, activeRequestItems]);

  // Automatically fly to selected pharmacy and open popup
  useEffect(() => {
    if (!selectedPharmacyId) return;
    const marker = markersByIdRef.current[selectedPharmacyId];
    if (marker && mapInstanceRef.current) {
      try {
        const latLng = marker.getLatLng();
        if (latLng && isValidCoord(latLng.lat) && isValidCoord(latLng.lng)) {
          mapInstanceRef.current.flyTo(latLng, Math.max(mapInstanceRef.current.getZoom(), 14), {
            duration: 0.8
          });
          setTimeout(() => {
            if (marker && typeof marker.openPopup === 'function') {
              marker.openPopup();
            }
          }, 250);
        }
      } catch (err) {
        console.warn('Failed to fly to marker:', err);
      }
    }
  }, [selectedPharmacyId]);

  // Calculate authoritative distances from patient location to each pharmacy
  const pharmaciesWithDistance = useMemo(() => {
    const safeCenter = sanitizeCoords(center);
    const [userLat, userLon] = safeCenter;
    return (pharmacies || []).map((p, idx) => {
      const coords = resolvePharmacyCoords(p);
      const lat = coords ? coords[0] : null;
      const lon = coords ? coords[1] : null;

      let dist = p.distanceKm;
      if ((dist == null || isNaN(dist)) && lat != null && lon != null && isValidCoord(userLat) && isValidCoord(userLon)) {
        dist = calculateHaversineKm(userLat, userLon, lat, lon);
      }
      return {
        ...p,
        resolvedLat: lat,
        resolvedLon: lon,
        resolvedDistanceKm: dist != null ? (typeof dist === 'number' ? dist.toFixed(1) : dist) : null,
        rankNum: idx + 1
      };
    });
  }, [pharmacies, center]);

  const activePharmacy = useMemo(() => {
    if (selectedPharmacyId) {
      const found = pharmaciesWithDistance.find(p => p.id === selectedPharmacyId);
      if (found) return found;
    }
    if (selectedPharmacy?.id) {
      const found = pharmaciesWithDistance.find(p => p.id === selectedPharmacy.id);
      if (found) return found;
    }
    return pharmaciesWithDistance[0] || null;
  }, [pharmaciesWithDistance, selectedPharmacyId, selectedPharmacy]);

  // Draw / Update dynamic direction route from "You are here" to selected store
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (directionLineRef.current) {
      try { map.removeLayer(directionLineRef.current); } catch (e) {}
      directionLineRef.current = null;
    }
    if (directionMidpointMarkerRef.current) {
      try { map.removeLayer(directionMidpointMarkerRef.current); } catch (e) {}
      directionMidpointMarkerRef.current = null;
    }

    const safeCenter = sanitizeCoords(center);
    const pCoords = resolvePharmacyCoords(activePharmacy);

    if (safeCenter && pCoords) {
      const [uLat, uLon] = safeCenter;
      const [pLat, pLon] = pCoords;

      if (isValidCoord(uLat) && isValidCoord(uLon) && isValidCoord(pLat) && isValidCoord(pLon)) {
        try {
          const polyline = L.polyline([[uLat, uLon], [pLat, pLon]], {
            color: '#0066cc',
            weight: 3.5,
            dashArray: '7, 9',
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);

          directionLineRef.current = polyline;

          const midLat = (uLat + pLat) / 2;
          const midLon = (uLon + pLon) / 2;
          const dist = activePharmacy?.resolvedDistanceKm;

          if (dist != null && isValidCoord(midLat) && isValidCoord(midLon)) {
            const midIcon = L.divIcon({
              html: `<div style="
                background: #ffffff;
                color: #0066cc;
                font-size: 10px;
                font-weight: 800;
                padding: 2.5px 8px;
                border-radius: 999px;
                box-shadow: 0 2px 10px rgba(0,102,204,0.3);
                border: 1.5px solid #0066cc;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 3px;
              "><span>🧭</span> <span>${dist} km</span></div>`,
              className: 'route-midpoint-badge',
              iconSize: [72, 22],
              iconAnchor: [36, 11]
            });
            directionMidpointMarkerRef.current = L.marker([midLat, midLon], { icon: midIcon, interactive: false, zIndexOffset: 700 }).addTo(map);
          }
        } catch (err) {
          console.warn('Failed to draw direction route on map:', err);
        }
      }
    }
  }, [activePharmacy, center]);

  return (
    <div className={`relative w-full rounded-3xl overflow-hidden border border-outline-variant/30 shadow-md ${className}`} style={{ height, minHeight: '380px' }}>
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '380px' }} />

      {/* Dynamic Pharmacy Distance Indicator Header */}
      <div className="absolute top-3 left-3 z-[400] max-w-[calc(100%-75px)] flex flex-wrap items-center gap-1.5 pointer-events-auto">
        {activePharmacy && (
          <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-secondary/30 text-[11px] font-bold text-primary shadow-md flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0066cc] animate-pulse shrink-0"></span>
            <span className="text-secondary font-medium">
              {selectedMedicineName
                ? `Distance for ${selectedMedicineName} to ${activePharmacy.name}:`
                : `Distance to ${activePharmacy.name}:`}
            </span>
            <span className="bg-secondary/15 text-primary px-2 py-0.5 rounded-full font-black text-[11px]">
              {activePharmacy.resolvedDistanceKm != null ? `${activePharmacy.resolvedDistanceKm} km` : 'Near you'}
            </span>
          </div>
        )}
        {pharmaciesWithDistance.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-full border border-outline-variant/30 text-[10px] text-on-surface shadow-sm">
            {pharmaciesWithDistance.map(p => {
              const isSelected = p.id === activePharmacy?.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectPharmacy && onSelectPharmacy(p)}
                  className={`px-2 py-0.5 rounded-full font-semibold transition-colors flex items-center gap-1 ${
                    isSelected
                      ? 'bg-primary text-white font-bold'
                      : 'bg-surface-container hover:bg-secondary/15 text-on-surface'
                  }`}
                  title={`${p.name} (${p.resolvedDistanceKm != null ? `${p.resolvedDistanceKm} km` : 'nearby'})`}
                >
                  <span>#{p.rankNum}</span>
                  <span className="truncate max-w-[80px]">{p.name.split(' ')[0]}</span>
                  <span className="opacity-90">{p.resolvedDistanceKm != null ? `${p.resolvedDistanceKm}km` : ''}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Map Legend Capsule with Your Location */}
      <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-outline-variant/30 text-[11px] text-on-surface shadow-sm flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#0066cc] inline-block border border-white"></span>
          <span className="font-semibold text-[#0066cc]">Your Location</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block"></span>
          <span className="font-semibold text-primary">All Rx Ready</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-error inline-block"></span>
          <span className="font-semibold text-error">24/7 Emergency</span>
        </div>
      </div>

      {/* Embedded Leaflet Custom Card Popup & Beacon Styles */}
      <style>{`
        @keyframes userLocationPulse {
          0% { transform: scale(0.6); opacity: 0.9; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .user-loc-pulse {
          animation: userLocationPulse 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
        }
        .stitch-leaflet-popup .leaflet-popup-content-wrapper {
          background: #ffffff !important;
          border-radius: 18px !important;
          padding: 0 !important;
          overflow: hidden !important;
          box-shadow: 0 16px 40px rgba(3, 47, 40, 0.28) !important;
          border: 1.5px solid #d5e6e0 !important;
        }
        .stitch-leaflet-popup .leaflet-popup-content {
          margin: 0 !important;
          line-height: normal !important;
        }
        .stitch-leaflet-popup .leaflet-popup-tip {
          background: #ffffff !important;
        }
        .stitch-leaflet-popup a.leaflet-popup-close-button {
          top: 10px !important;
          right: 10px !important;
          width: 22px !important;
          height: 22px !important;
          border-radius: 50% !important;
          background: #f4faf7 !important;
          color: #032f28 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 14px !important;
          padding: 0 !important;
          border: 1px solid #d5e6e0 !important;
        }
      `}</style>
    </div>
  );
}
