const { calculateDistance } = require('./distance');
const { getReferencePricing, calculateUnitPrice } = require('./referencePricing');

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
 * Distance decay calibrated for Kerala (Chengannur region):
 *   Town-to-town distances: 5–25 km.
 *   Decay: 100 - (distanceKm * 5) → zero score at 20 km.
 *   (Previously: * 15, calibrated for dense Bangalore 1–6 km range.)
 *
 * travelTimeMins is intentionally NOT computed or returned.
 * Haversine distance is straight-line only; ETA claims would be inaccurate.
 */

function verifyClinicalEquivalence(req, invMed) {
  if (!invMed) {
    return {
      isMatch: false,
      reason: 'Dispensary catalogue record lacks clinical medicine details: cannot verify equivalence.'
    };
  }

  // 1. Active ingredient (genericName) verification
  const reqGen = (req.genericName || '').toLowerCase().trim();
  const invGen = (invMed.genericName || '').toLowerCase().trim();
  if (reqGen && invGen) {
    if (reqGen !== invGen) {
      return {
        isMatch: false,
        reason: `Active ingredient mismatch: prescribed "${req.genericName}" vs inventory "${invMed.genericName}". Different ingredients cannot be substituted.`
      };
    }
  } else if (reqGen && !invGen) {
    return {
      isMatch: false,
      reason: `Active ingredient missing in catalogue record: prescribed "${req.genericName}" cannot be verified for clinical equivalence.`
    };
  } else if (!reqGen && invGen) {
    return {
      isMatch: false,
      reason: 'Prescription medicine active ingredient is missing or unverified: cannot assume clinical equivalence.'
    };
  }

  // 2. Strength verification (Gate 3.2 Hardening)
  const reqRawStr = (req.strength || '').trim();
  const invRawStr = (invMed.strength || '').trim();

  if (reqRawStr && invRawStr) {
    const reqStr = reqRawStr.toLowerCase().replace(/\s+/g, '');
    const invStr = invRawStr.toLowerCase().replace(/\s+/g, '');
    if (reqStr !== invStr) {
      return {
        isMatch: false,
        reason: `Strength mismatch: prescribed "${req.strength}" vs inventory "${invMed.strength}". Different strengths are clinically non-equivalent.`
      };
    }
  } else if (reqRawStr && !invRawStr) {
    return {
      isMatch: false,
      reason: `Strength missing in catalogue record: prescribed "${req.strength}" cannot be verified for clinical equivalence.`
    };
  } else if (!reqRawStr && invRawStr) {
    return {
      isMatch: false,
      reason: 'Prescription medicine strength is missing or unverified: cannot assume clinical equivalence.'
    };
  } else if (!reqRawStr && !invRawStr) {
    return {
      isMatch: false,
      reason: 'Medicine strength is missing in both prescription and catalogue records: cannot assume clinical equivalence.'
    };
  }

  // 3. Dosage form verification
  const reqForm = (req.dosageForm || '').toLowerCase().trim();
  const invForm = (invMed.dosageForm || '').toLowerCase().trim();

  if (reqForm && invForm) {
    if (reqForm !== invForm) {
      return {
        isMatch: false,
        reason: `Dosage form mismatch: prescribed "${req.dosageForm}" vs inventory "${invMed.dosageForm}". Different formulations are clinically non-equivalent.`
      };
    }
  } else if (reqForm && !invForm) {
    return {
      isMatch: false,
      reason: `Dosage form missing in catalogue record: prescribed "${req.dosageForm}" cannot be verified for clinical equivalence.`
    };
  } else if (!reqForm && invForm) {
    return {
      isMatch: false,
      reason: 'Prescription dosage form is missing or unverified: cannot assume clinical equivalence.'
    };
  }

  return { isMatch: true, reason: null };
}

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
      const inventoryItem = pharmacy.inventory?.find((inv) => {
        if (req.medicineId && inv.medicineId === req.medicineId) return true;
        const brand = (req.brandName || req.prescribedName || '').trim().toLowerCase();
        if (brand && (inv.medicine?.brandName || '').trim().toLowerCase() === brand) return true;
        return false;
      });

      const availableStock = inventoryItem?.stock ?? null;
      const rawPrice = inventoryItem?.price;

      const medBrand = inventoryItem?.medicine?.brandName || req.brandName || req.prescribedName;
      const medGen = inventoryItem?.medicine?.genericName || req.genericName;
      const ref = getReferencePricing(medBrand, medGen);

      const isStrip = (req.saleUnit || '').toUpperCase().trim() === 'STRIP' || Boolean(req.isStrip);
      const unitsPerPack = req.unitsPerPack || ref?.unitsPerPack || 1;

      let unitPrice = null;
      if (isStrip) {
        if (ref && ref.publishedMrp != null) {
          unitPrice = ref.publishedMrp;
        } else if (rawPrice != null && rawPrice > 0) {
          unitPrice = Number((rawPrice * unitsPerPack).toFixed(2));
        } else if (ref && ref.unitPrice != null) {
          unitPrice = Number((ref.unitPrice * unitsPerPack).toFixed(2));
        }
      } else {
        if (ref && ref.unitPrice != null) {
          unitPrice = ref.unitPrice;
        } else if (rawPrice != null && rawPrice > 0) {
          if (ref?.unitsPerPack && ref.unitsPerPack > 1 && Math.abs(rawPrice - (ref.publishedMrp || 0)) < 0.1) {
            unitPrice = calculateUnitPrice(rawPrice, ref.unitsPerPack);
          } else {
            unitPrice = rawPrice;
          }
        }
      }
      const neededQty = req.quantity || 1;

      // Clinical attribute verification (Gate 3 & Gate 3.2 Hardening):
      // Require exact active ingredient, strength, and dosage form when clinical attributes are present.
      const hasClinicalAttrs = Boolean(req.genericName || req.strength || req.dosageForm || req.prescriptionItemId);
      let isClinicalMismatch = false;
      let mismatchReason = null;

      if (hasClinicalAttrs) {
        const check = verifyClinicalEquivalence(req, inventoryItem?.medicine);
        if (!check.isMatch) {
          isClinicalMismatch = true;
          mismatchReason = check.reason;
        }
      }

      // Authoritative status check:
      // Medicine is available only if inventory record exists with stock > 0, not explicitly OUT_OF_STOCK, and clinically matching.
      const isAvailable = Boolean(
        !isClinicalMismatch &&
        inventoryItem &&
        (inventoryItem.stock != null ? inventoryItem.stock > 0 : inventoryItem.status === 'AVAILABLE') &&
        inventoryItem.status !== 'OUT_OF_STOCK'
      );
      const hasFullQty = isAvailable && (availableStock === null || availableStock >= neededQty);

      // Determine item availability classification
      let itemStatus = 'OUT_OF_STOCK';
      if (isClinicalMismatch) {
        itemStatus = 'CLINICAL_MISMATCH';
      } else if (!inventoryItem) {
        itemStatus = 'UNAVAILABLE';
      } else if (availableStock === null) {
        itemStatus = 'UNKNOWN';
      } else if (inventoryItem.status === 'OUT_OF_STOCK' || availableStock === 0) {
        itemStatus = 'OUT_OF_STOCK';
      } else if (availableStock >= neededQty && inventoryItem.status === 'AVAILABLE') {
        itemStatus = 'AVAILABLE';
      } else if (availableStock > 0 && availableStock < neededQty && inventoryItem.status === 'AVAILABLE') {
        itemStatus = 'INSUFFICIENT_STOCK';
      } else {
        itemStatus = 'UNKNOWN';
      }

      // Exact brand vs generic classification
      let matchClassification = 'EXACT_CATALOGUE_MATCH';
      if (isClinicalMismatch) {
        matchClassification = 'CLINICAL_MISMATCH';
      } else if (inventoryItem?.medicine) {
        const invBrand = (inventoryItem.medicine.brandName || '').toLowerCase().trim();
        const reqBrand = (req.brandName || req.prescribedName || '').toLowerCase().trim();
        if (reqBrand && invBrand === reqBrand) {
          matchClassification = 'EXACT_BRAND_MATCH';
        } else if (req.genericName && inventoryItem.medicine.genericName &&
                   req.genericName.toLowerCase().trim() === inventoryItem.medicine.genericName.toLowerCase().trim()) {
          matchClassification = 'SAME_GENERIC_DIFFERENT_BRAND';
        }
      }

      const itemSubtotal = (unitPrice != null && isAvailable)
        ? Number((unitPrice * neededQty).toFixed(2))
        : null;

      if (isAvailable) {
        matchedItemsCount++;
        if (hasFullQty) fullQtyMatches++;
        if (itemSubtotal != null) {
          totalEstimatedCost += itemSubtotal;
        }
      }

      const pricingUnit = isStrip
        ? 'per strip'
        : (ref?.pricingUnit || (inventoryItem?.medicine?.dosageForm === 'Tablet' ? 'per tablet' : inventoryItem?.medicine?.dosageForm === 'Capsule' ? 'per capsule' : 'per unit'));

      itemStockDetails.push({
        prescriptionItemId: req.prescriptionItemId || null,
        medicineId: req.medicineId,
        prescribedName: req.prescribedName || req.brandName || 'Prescription Medicine',
        medicineName: inventoryItem?.medicine?.brandName || req.brandName || 'Unknown',
        genericName: inventoryItem?.medicine?.genericName || req.genericName || null,
        strength: inventoryItem?.medicine?.strength || req.strength || null,
        dosageForm: inventoryItem?.medicine?.dosageForm || req.dosageForm || null,
        requestedQty: neededQty,
        availableStock,
        unitPrice,
        itemSubtotal,
        pricingUnit,
        saleUnit: isStrip ? 'STRIP' : (req.saleUnit || 'TABLET'),
        packSize: ref?.packSize || req.packSize || (unitsPerPack > 1 ? `Strip of ${unitsPerPack}` : null),
        publishedMrp: ref?.publishedMrp || null,
        unitsPerPack,
        hasVerifiedPrice: unitPrice != null,
        inStock: isAvailable,
        fullStock: hasFullQty,
        status: itemStatus,
        matchClassification,
        mismatchReason: isClinicalMismatch ? mismatchReason : null,
        // Inventory freshness — stockLastUpdated from DB lastUpdated field
        stockLastUpdated: inventoryItem?.lastUpdated ?? null
      });
    });

    const totalRequested = requestedItems.length || 1;
    const availabilityRatio = (fullQtyMatches + (matchedItemsCount - fullQtyMatches) * 0.5) / totalRequested;
    const availabilityScore = Math.round(availabilityRatio * 100);

    // Pricing completeness tracking (Gate 3)
    const inStockItems = itemStockDetails.filter(it => it.inStock);
    const inStockPricedCount = inStockItems.filter(it => it.unitPrice != null).length;
    const unpricedInStockCount = inStockItems.length - inStockPricedCount;
    const isTotalCostComplete = fullQtyMatches === totalRequested && inStockItems.length === totalRequested && unpricedInStockCount === 0 && totalRequested > 0;
    const pricingStatus = isTotalCostComplete ? 'COMPLETE' : (inStockPricedCount > 0 ? 'INCOMPLETE' : 'UNPRICED');
    const pricingNote = isTotalCostComplete
      ? 'Complete verified prescription cost estimate.'
      : (inStockPricedCount > 0
          ? `Estimated subtotal is incomplete: ${unpricedInStockCount} in-stock item(s) have unlisted dispensary prices.`
          : 'Prescription cost is unknown: dispensary has not listed unit prices for these items.');

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
      totalEstimatedCost: inStockPricedCount > 0 ? Number(totalEstimatedCost.toFixed(2)) : null,
      isTotalCostComplete,
      pricingStatus,
      pricingNote,
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

module.exports = {
  rankPharmaciesForMedicines,
  verifyClinicalEquivalence
};
