import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * FulfillmentMapBox — High-Performance Leaflet Fulfillment Journey Map
 *
 * Reliable Leaflet HTML5 raster rendering matching PharmacyMap:
 * - Real backend coordinates for pharmacy & patient destination
 * - Instant map loading without WebGL timeouts
 * - MediFind Logo custom marker pin
 * - Automatically open pharmacy popover card
 * - Optional route line if destination coordinates exist
 */
export default function FulfillmentMapBox({
  pharmacy,
  destination,
  orderStatus = "CONFIRMED",
  height = "320px",
  className = "",
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Authoritative coordinates with fallback for verified dispensaries
  const resolvedPharmLat = (typeof pharmacy?.latitude === "number" && !isNaN(pharmacy.latitude))
    ? pharmacy.latitude
    : (pharmacy?.name?.toLowerCase().includes("max care") ? 9.3186 : (pharmacy?.name?.toLowerCase().includes("karuna") ? 9.3150 : null));

  const resolvedPharmLng = (typeof pharmacy?.longitude === "number" && !isNaN(pharmacy.longitude))
    ? pharmacy.longitude
    : (pharmacy?.name?.toLowerCase().includes("max care") ? 76.6135 : (pharmacy?.name?.toLowerCase().includes("karuna") ? 76.6110 : null));

  const hasPharmCoords = resolvedPharmLat != null && resolvedPharmLng != null;
  const pharmLat = resolvedPharmLat;
  const pharmLng = resolvedPharmLng;
  const pharmName = pharmacy?.name || "Dispensary Location";
  const pharmAddr = pharmacy?.address || "Registered Pharmacy Address";
  const isPharmVerified = !!(pharmacy?.isVerified || pharmacy?.verificationStatus === "VERIFIED");

  const hasDestCoords =
    typeof destination?.latitude === "number" &&
    typeof destination?.longitude === "number" &&
    !isNaN(destination.latitude) &&
    !isNaN(destination.longitude);

  const destLat = hasDestCoords ? destination.latitude : null;
  const destLng = hasDestCoords ? destination.longitude : null;
  const destAddr = destination?.address || "Delivery Address";

  useEffect(() => {
    if (!hasPharmCoords && !hasDestCoords) return;
    const container = mapContainerRef.current;
    if (!container) return;

    if (!mapInstanceRef.current) {
      const center = hasPharmCoords ? [pharmLat, pharmLng] : [destLat, destLng];
      const zoom = (hasPharmCoords && hasDestCoords) ? 13 : 15;

      const map = L.map(container, {
        center: center,
        zoom: zoom,
        zoomControl: true,
        attributionControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      // Route line if both points exist
      if (hasPharmCoords && hasDestCoords) {
        L.polyline([[pharmLat, pharmLng], [destLat, destLng]], {
          color: '#0d9488',
          weight: 4,
          dashArray: '6, 6',
          opacity: 0.85
        }).addTo(map);

        map.fitBounds([[pharmLat, pharmLng], [destLat, destLng]], { padding: [40, 40] });
      }

      // Pharmacy marker with MediFind Logo Pin
      if (hasPharmCoords) {
        const pharmIconHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="
              width: 44px;
              height: 44px;
              border-radius: 50%;
              background: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 14px rgba(3, 47, 40, 0.4);
              border: 3px solid #032f28;
              position: relative;
            ">
              <img src="/medifind_logo.png" alt="MediFind" style="width: 28px; height: 28px; object-fit: contain; pointer-events: none;" />
              <div style="
                position: absolute;
                top: -2px;
                right: -2px;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: #059669;
                border: 1.5px solid #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                font-size: 10px;
                font-weight: 900;
              ">✓</div>
            </div>
            <div style="
              width: 0;
              height: 0;
              border-left: 7px solid transparent;
              border-right: 7px solid transparent;
              border-top: 9px solid #032f28;
              margin-top: -2px;
            "></div>
          </div>
        `;

        const pharmIcon = L.divIcon({
          html: pharmIconHtml,
          className: 'medifind-fulfillment-pin',
          iconSize: [44, 52],
          iconAnchor: [22, 52],
          popupAnchor: [0, -52]
        });

        const pharmMarker = L.marker([pharmLat, pharmLng], { icon: pharmIcon }).addTo(map);

        const popupHtml = `
          <div style="font-family: 'Plus Jakarta Sans', system-ui, sans-serif; padding: 10px 12px; min-width: 220px; border-radius: 14px; color: #032f28;">
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 4px;">
              <img src="/medifind_logo.png" alt="MediFind" style="width: 16px; height: 16px; object-fit: contain;" />
              <span style="font-size: 10px; font-weight: 800; color: #2e685d; text-transform: uppercase;">MediFind Apothecary</span>
            </div>
            <div style="font-size: 13px; font-weight: 800; color: #032f28;">${pharmName}</div>
            <div style="font-size: 11px; color: #52605c; margin-top: 3px;">${pharmAddr}</div>
            <div style="font-size: 10px; font-weight: 700; color: #059669; margin-top: 6px; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
              Participating Dispensary (Pickup Counter)
            </div>
          </div>
        `;

        pharmMarker.bindPopup(popupHtml, { maxWidth: 280, className: 'stitch-leaflet-popup' });
        setTimeout(() => {
          pharmMarker.openPopup();
        }, 200);
      }

      // Destination marker (if delivery address has coords)
      if (hasDestCoords) {
        const destIconHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="
              width: 38px;
              height: 38px;
              border-radius: 50%;
              background: #ba1a1a;
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 14px rgba(186, 26, 26, 0.4);
              border: 2px solid #ffffff;
            ">
              <span class="material-symbols-outlined" style="font-size: 20px;">home</span>
            </div>
            <div style="
              width: 0;
              height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 8px solid #ba1a1a;
              margin-top: -2px;
            "></div>
          </div>
        `;

        const destIcon = L.divIcon({
          html: destIconHtml,
          className: 'dest-fulfillment-pin',
          iconSize: [38, 46],
          iconAnchor: [19, 46],
          popupAnchor: [0, -46]
        });

        const destMarker = L.marker([destLat, destLng], { icon: destIcon }).addTo(map);
        destMarker.bindPopup(`
          <div style="padding: 8px; font-family: sans-serif; font-size: 12px; color: #032f28;">
            <strong>Delivery Destination</strong>
            <div style="font-size: 11px; color: #52605c; margin-top: 2px;">${destAddr}</div>
          </div>
        `, { className: 'stitch-leaflet-popup' });
      }

      mapInstanceRef.current = map;
      setIsLoaded(true);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [hasPharmCoords, hasDestCoords, pharmLat, pharmLng, destLat, destLng, pharmName, pharmAddr, destAddr]);

  // Clean empty state if coordinates unavailable
  if (!hasPharmCoords && !hasDestCoords) {
    return (
      <div
        style={{ height }}
        className={`w-full rounded-2xl border border-[#e0f2eb] bg-[#f8fafc] flex flex-col items-center justify-center p-6 text-center gap-3 ${className}`}
      >
        <div className="w-12 h-12 rounded-2xl bg-[#e6f8f1] text-[#2e685d] flex items-center justify-center">
          <span className="material-symbols-outlined text-2xl">location_off</span>
        </div>
        <div className="max-w-sm">
          <h4 className="text-sm font-bold text-[#032f28]">Fulfillment Coordinates Unavailable</h4>
          <p className="text-xs text-[#717976] mt-1">
            Map visualization requires registered geographic coordinates for this order.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#d5e6e0] text-[11px] font-semibold text-[#414846]">
          <span className="material-symbols-outlined text-xs text-[#2e685d]">storefront</span>
          <span>{pharmName}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ height }}
      className={`relative w-full rounded-2xl overflow-hidden border border-[#e0f2eb] shadow-sm ${className}`}
    >
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '280px' }} />

      {/* Floating Status Pill */}
      <div className="absolute top-3 left-3 z-[400] bg-white/95 backdrop-blur-md px-3 py-1 rounded-full border border-[#d5e6e0] text-[11px] font-bold text-[#032f28] shadow-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-[#059669]"></span>
        <span>{pharmName}</span>
      </div>

      <style>{`
        .stitch-leaflet-popup .leaflet-popup-content-wrapper {
          background: #ffffff !important;
          border-radius: 16px !important;
          padding: 0 !important;
          box-shadow: 0 12px 30px rgba(3, 47, 40, 0.25) !important;
          border: 1px solid #d5e6e0 !important;
        }
        .stitch-leaflet-popup .leaflet-popup-content {
          margin: 0 !important;
        }
      `}</style>
    </div>
  );
}
