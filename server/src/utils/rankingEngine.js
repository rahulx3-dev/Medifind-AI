const { calculateDistance } = require('./distance');

/**
 * MediFind AI — Explainable Multi-Criteria Pharmacy Ranking Engine
 *
 * Scoring weights (when coordinates ARE available):
 *   Availability (45%) → Medicine availability is ALWAYS the primary factor.
 *   Distance    (30%) → Straight-line Haversine distance only; no travel time claims.
 *   Operational (15%) → Computed open/closed status + 24x7 bonus.
 *   Price       (10%) → Heuristic baseline.
 *
 * When coordinates are UNAVAILABLE (coordinatesAvailable=false):
 *   distanceKm stays null — no distance is fabricated.
 *   The distance factor (30%) is EXCLUDED from the total score.
 *   Remaining weights are renormalised: Avail 64%, Operational 21%, Price 14%.
 *   A pharmacy with unknown location MUST NOT outrank one with known distance
 *   merely due to an invented proximity score.
 *
 * Emergency mode: the same weights apply. Availability (45%) already places
 * medicine stock as the primary criterion. 24x7 status contributes to the
 * operationalScore (15%) and does NOT override medicine availability.
 *
 * Distance decay calibrated for Kerala (Chengannur/Alappuzha region):
 *   Town-to-town distances: 5–25 km.
 *   Decay: 100 - (distanceKm * 5) → zero score at 20 km.
 *   (Previously: * 15, calibrated for dense Bangalore 1–6 km range.)
 *
 * travelTimeMins is intentionally NOT computed or returned.
 * Haversine distance is straight-line only; ETA claims would be inaccurate.
 */

function rankPharmaciesForMedicines({
  pharmacies,
  requestedItems,   // Array of { medicineId, quantity }
  userLat,
  userLon,
  isEmergency = false
}) {
  if (!pharmacies || pharmacies.length === 0) return [];

  const ranked = pharmacies.map((pharmacy) => {
    // 1. Distance (straight-line Haversine only — no travel time)
    const hasCoords = pharmacy.latitude != null && pharmacy.longitude != null;
    const distanceKm = hasCoords
      ? calculateDistance(userLat, userLon, pharmacy.latitude, pharmacy.longitude)
      : null;

    // 2. Stock Availability
    let matchedItemsCount = 0;
    let fullQtyMatches = 0;
    let totalEstimatedCost = 0;
    const itemStockDetails = [];

    requestedItems.forEach((req) => {
      const inventoryItem = pharmacy.inventory?.find(
        (inv) => inv.medicineId === req.medicineId
      );

      const availableStock = inventoryItem?.stock ?? null;
      const unitPrice = inventoryItem?.price ?? null;
      const neededQty = req.quantity || 1;

      // Authoritative status check:
      // Real participating pharmacy inventory has status = 'AVAILABLE' or 'OUT_OF_STOCK'
      const isAvailable = inventoryItem?.status === 'AVAILABLE' ||
        (inventoryItem?.status !== 'OUT_OF_STOCK' && (inventoryItem?.stock || 0) > 0);
      const hasFullQty = isAvailable && (availableStock === null || availableStock >= neededQty);

      if (isAvailable) {
        matchedItemsCount++;
        if (hasFullQty) fullQtyMatches++;
        if (unitPrice != null) {
          totalEstimatedCost += unitPrice * neededQty;
        }
      }

      itemStockDetails.push({
        medicineId: req.medicineId,
        medicineName: inventoryItem?.medicine?.brandName || req.brandName || 'Unknown',
        requestedQty: neededQty,
        availableStock,
        unitPrice,
        inStock: isAvailable,
        fullStock: hasFullQty,
        status: inventoryItem?.status || (isAvailable ? 'AVAILABLE' : 'OUT_OF_STOCK'),
        // Inventory freshness — stockLastUpdated from DB lastUpdated field
        stockLastUpdated: inventoryItem?.lastUpdated ?? null
      });
    });

    const totalRequested = requestedItems.length || 1;
    const availabilityRatio = (fullQtyMatches + (matchedItemsCount - fullQtyMatches) * 0.5) / totalRequested;
    const availabilityScore = Math.round(availabilityRatio * 100);

    // 3. Proximity Score — Kerala-calibrated decay (* 5 instead of * 15)
    // IMPORTANT: When coordinates are unavailable, distanceKm stays null.
    // We do NOT fabricate a distance or award an artificial proximity score.
    // An unknown distance must not behave like a proximity advantage.
    const distanceScore = distanceKm !== null
      ? Math.max(0, Math.round(100 - (distanceKm * 5)))
      : null; // null = distance factor excluded from scoring

    // 4. Operational Score — computed open status takes precedence over raw DB field
    const computedOpen = pharmacy.computedOpenStatus?.isCurrentlyOpen;
    const isEffectivelyOpen = computedOpen !== null ? computedOpen : pharmacy.isOpen;

    let operationalScore = 0;
    if (isEmergency) {
      // Emergency: 24x7 verified open pharmacies score highest operationally.
      // However, this only contributes 15% — availability (45%) still dominates.
      if (pharmacy.is24x7 && isEffectivelyOpen) {
        operationalScore = 100;
      } else if (isEffectivelyOpen) {
        operationalScore = 70;
      } else {
        operationalScore = 10;
      }
    } else {
      if (isEffectivelyOpen) {
        const ratingBonus = (pharmacy.rating && pharmacy.rating > 0) ? (pharmacy.rating / 5.0) * 30 : 0;
        operationalScore = Math.round(70 + ratingBonus);
      } else {
        operationalScore = 10;
      }
    }

    // 5. Price Score (heuristic baseline)
    const priceScore = 80;

    // Weighted Total:
    // When distance IS known:   Availability 45%, Distance 30%, Operational 15%, Price 10%
    // When distance is UNKNOWN: Availability 64%, Operational 21%, Price 14%  (30% weight redistributed proportionally)
    // Rationale: unknown distance MUST NOT confer a proximity advantage.
    let totalScore;
    if (distanceScore !== null) {
      totalScore = Math.round(
        availabilityScore * 0.45 +
        distanceScore    * 0.30 +
        operationalScore * 0.15 +
        priceScore       * 0.10
      );
    } else {
      // Redistribute the 30% distance weight proportionally among remaining factors
      // Original non-distance weights: Avail 45, Op 15, Price 10 → sum 70
      // Renormalised: Avail 45/70≈0.643, Op 15/70≈0.214, Price 10/70≈0.143
      totalScore = Math.round(
        availabilityScore * (45 / 70) +
        operationalScore  * (15 / 70) +
        priceScore        * (10 / 70)
      );
    }

    // Human-readable explanation
    const reasons = [];
    if (fullQtyMatches === totalRequested) {
      reasons.push(`Complete match (${fullQtyMatches}/${totalRequested} medicines in stock)`);
    } else if (matchedItemsCount > 0) {
      reasons.push(`Partial match (${matchedItemsCount}/${totalRequested} available)`);
    } else {
      reasons.push(`Out of stock for requested items`);
    }

    if (distanceKm !== null) {
      reasons.push(`${distanceKm} km away`);
    } else {
      reasons.push('Location: Chengannur');
    }

    if (pharmacy.computedOpenStatus?.isCurrentlyOpen === true) {
      reasons.push(pharmacy.is24x7 ? '24/7 Emergency Pharmacy' : `Open now (${pharmacy.openingHours})`);
    } else if (pharmacy.computedOpenStatus?.isCurrentlyOpen === false) {
      reasons.push('Closed now');
    } else {
      reasons.push(`Hours: ${pharmacy.openingHours || 'Not available'}`);
    }

    if (pharmacy.rating && pharmacy.rating > 0) reasons.push(`Rating ${pharmacy.rating}★`);

    const availabilityStatus =
      fullQtyMatches === totalRequested
        ? 'FULL_MATCH'
        : matchedItemsCount > 0
        ? 'PARTIAL_MATCH'
        : 'OUT_OF_STOCK';

    return {
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        address: pharmacy.address,
        latitude: pharmacy.latitude,
        longitude: pharmacy.longitude,
        coordinatesAvailable: hasCoords,
        googleMapsUrl: pharmacy.googleMapsUrl || null,
        phone: pharmacy.phone,
        isVerified: pharmacy.isVerified,
        verificationStatus: pharmacy.verificationStatus,
        isParticipating: pharmacy.isVerified === true && pharmacy.verificationStatus === 'VERIFIED' && pharmacy.verificationStatus !== 'TEST',
        is24x7: pharmacy.is24x7,
        rating: pharmacy.rating,
        openingHours: pharmacy.openingHours,
        isTestRecord: pharmacy.verificationStatus === 'TEST',
        testDataNote: pharmacy.verificationStatus === 'TEST' ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : null,
        computedOpenStatus: pharmacy.computedOpenStatus
        // travelTimeMins intentionally omitted
      },
      distanceKm,
      // travelTimeMins intentionally omitted
      availabilityStatus,
      matchedItemsCount,
      totalRequested,
      totalEstimatedCost: Number(totalEstimatedCost.toFixed(2)),
      itemStockDetails,
      availability: itemStockDetails,
      scores: {
        availabilityScore,
        distanceScore,          // null when coordinates unavailable — not fabricated
        operationalScore,
        priceScore,
        totalScore,
        coordinatesUsedForRanking: distanceScore !== null
      },
      explanation: reasons.join(' • ')
    };
  });

  // Sort: highest totalScore first; ties broken by distance (nearest first, null-safe)
  ranked.sort((a, b) => {
    if (b.scores.totalScore !== a.scores.totalScore) {
      return b.scores.totalScore - a.scores.totalScore;
    }
    // Tie-break: known distance beats unknown; between two known, nearest wins
    if (a.distanceKm != null && b.distanceKm != null) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm != null) return -1; // a has known distance → ranked higher
    if (b.distanceKm != null) return 1;  // b has known distance → ranked higher
    return 0; // both unknown → preserve stable insertion order
  });

  return ranked;
}

module.exports = { rankPharmaciesForMedicines };
