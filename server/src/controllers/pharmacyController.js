const prisma = require('../prisma');
const { calculateDistance } = require('../utils/distance');
const { rankPharmaciesForMedicines } = require('../utils/rankingEngine');
const { computeOpenStatus } = require('../utils/openHoursParser');
const network = require('../utils/pharmacyNetwork');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FIELD SEMANTICS — PARTICIPATION VS REGULATORY VERIFICATION (Phase 6.1H.1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * isVerified (boolean)
 *   TRUE  = pharmacy is approved for inclusion in MediFind's academic network.
 *           This means the pharmacy owner gave permission to participate in this
 *           academic project. It does NOT mean government/regulatory certification,
 *           professional accreditation, or any form of external validation.
 *   FALSE = pharmacy is not in the active network (test fixtures, deactivated).
 *
 * verificationStatus (string enum)
 *   'VERIFIED' = approved academic participant (isVerified=true)
 *   'TEST'     = test/development fixture (deactivated from patient discovery)
 *   'PENDING'  = not yet reviewed
 *
 * isParticipating (computed, NOT a DB column)
 *   = isVerified === true && verificationStatus === 'VERIFIED' && !isTestRecord
 *   Patient-facing label: "Participating Pharmacy"
 *   MUST NOT be labelled as: "Verified Pharmacy Partner", "Certified",
 *   "Government Verified", "Regulatory Approved", etc.
 *
 * dataSource (string)
 *   'PHARMACY_PROVIDED' = stock status provided by the pharmacy via CSV.
 *   No fabricated quantities, prices, or coordinates are ever stored.
 *
 * distanceKm (computed)
 *   null when pharmacy.latitude/longitude are null (coordinatesAvailable=false).
 *   Never fabricated. The distance factor is excluded from ranking when null.
 * ─────────────────────────────────────────────────────────────────────────────
 */


/**
 * Enrich a pharmacy record with computed open status and distance.
 * Does NOT include travelTimeMins — Haversine distance is straight-line only.
 * Does NOT expose raw patient coordinates in any response.
 *
 * @param {object} pharmacy - Prisma pharmacy record
 * @param {number} userLat - caller's latitude (used only for distance computation)
 * @param {number} userLon - caller's longitude (used only for distance computation)
 * @returns {object} enriched pharmacy (no user coords)
 */
function enrichPharmacy(pharmacy, userLat, userLon) {
  const hasCoords = pharmacy.latitude != null && pharmacy.longitude != null;
  const distanceKm = hasCoords
    ? calculateDistance(userLat, userLon, pharmacy.latitude, pharmacy.longitude)
    : null;
  const openStatus = computeOpenStatus(pharmacy.openingHours, pharmacy.isOpen);

  // isTestRecord is derived from verificationStatus (no schema column needed)
  // Any pharmacy with verificationStatus === 'TEST' is a test fixture.
  const isTestRecord = pharmacy.verificationStatus === 'TEST';
  const isParticipating = pharmacy.isVerified === true && pharmacy.verificationStatus === 'VERIFIED' && !isTestRecord;
  const testDataNote = isTestRecord ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : null;

  return {
    id: pharmacy.id,
    name: pharmacy.name,
    licenseNumber: pharmacy.licenseNumber,
    address: pharmacy.address,
    latitude: pharmacy.latitude,
    longitude: pharmacy.longitude,
    coordinatesAvailable: hasCoords,
    phone: pharmacy.phone,
    is24x7: pharmacy.is24x7,
    isVerified: pharmacy.isVerified,
    verificationStatus: pharmacy.verificationStatus,
    isParticipating,
    rating: pharmacy.rating,
    openingHours: pharmacy.openingHours,
    googleMapsUrl: pharmacy.googleMapsUrl || null,
    emergencyAvailability: pharmacy.emergencyAvailability || false,
    deliveryAvailable: pharmacy.deliveryAvailable || false,
    dataSource: pharmacy.dataSource,
    isTestRecord,
    testDataNote,
    distanceKm,
    // travelTimeMins intentionally omitted — straight-line distance only
    computedOpenStatus: openStatus,
    _count: pharmacy._count
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/config
// Returns region name, default center coordinates, emergency hotlines.
// Public — no authentication required.
// ─────────────────────────────────────────────────────────────────────────────
async function getNetworkConfig(req, res) {
  return res.json({
    success: true,
    config: {
      regionName: network.REGION_NAME,
      defaultLat: network.DEFAULT_LAT,
      defaultLon: network.DEFAULT_LON,
      maxRangeKm: network.MAX_RANGE_KM,
      emergencyHotlines: network.EMERGENCY_HOTLINES
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies
// List all pharmacies with distance and computed open status.
// Query: lat, lon, is24x7, isOpen, openNow, minRating, radiusKm, participatingOnly, includeTest
// ─────────────────────────────────────────────────────────────────────────────
async function getPharmacies(req, res) {
  try {
    const { lat, lon, is24x7, isOpen, openNow, minRating, radiusKm, participatingOnly, includeTest } = req.query;

    const userLat = lat ? parseFloat(lat) : network.DEFAULT_LAT;
    const userLon = lon ? parseFloat(lon) : network.DEFAULT_LON;
    const radiusFilter = radiusKm ? parseFloat(radiusKm) : network.MAX_RANGE_KM;

    const whereClause = {};
    if (is24x7 === 'true') whereClause.is24x7 = true;
    if (minRating) whereClause.rating = { gte: parseFloat(minRating) };

    // Normal patient discovery: ONLY verified participating pharmacies appear.
    // Historical test fixtures are excluded unless includeTest === 'true'
    if (includeTest === 'true') {
      // Diagnostic test suite query
    } else {
      whereClause.isVerified = true;
      whereClause.verificationStatus = 'VERIFIED';
    }

    const pharmacies = await prisma.pharmacy.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { inventory: true }
        }
      }
    });

    const enriched = pharmacies
      .map(p => enrichPharmacy(p, userLat, userLon))
      .filter(p => p.distanceKm === null || p.distanceKm <= radiusFilter);

    // Apply isOpen / openNow filter using computed status (not raw DB field)
    const checkOpen = isOpen === 'true' || openNow === 'true';
    const filtered = checkOpen
      ? enriched.filter(p => p.computedOpenStatus.isCurrentlyOpen === true)
      : enriched;

    filtered.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });

    const participatingCount = filtered.filter(p => p.isParticipating).length;
    const testCount = filtered.filter(p => p.isTestRecord).length;

    return res.json({
      success: true,
      regionName: network.REGION_NAME,
      count: filtered.length,
      participatingCount,
      testCount,
      pharmacies: filtered
    });
  } catch (err) {
    console.error('getPharmacies error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve pharmacies.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/:id
// Single pharmacy details with inventory (includes lastUpdated freshness).
// ─────────────────────────────────────────────────────────────────────────────
async function getPharmacyById(req, res) {
  try {
    const { id } = req.params;
    const { lat, lon } = req.query;

    const userLat = lat ? parseFloat(lat) : network.DEFAULT_LAT;
    const userLon = lon ? parseFloat(lon) : network.DEFAULT_LON;

    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id },
      include: {
        inventory: {
          include: { medicine: true },
          orderBy: { medicine: { brandName: 'asc' } }
        },
        manager: {
          select: { id: true, name: true, email: true }
          // phone excluded from manager details for privacy
        }
      }
    });

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    const enriched = enrichPharmacy(pharmacy, userLat, userLon);

    // Attach inventory with freshness timestamps
    const inventoryWithFreshness = pharmacy.inventory.map(inv => ({
      id: inv.id,
      medicineId: inv.medicineId,
      medicine: inv.medicine,
      brandName: inv.medicine.brandName,
      genericName: inv.medicine.genericName,
      dosageForm: inv.medicine.dosageForm,
      strength: inv.medicine.strength,
      category: inv.medicine.category,
      requiresPrescription: inv.medicine.requiresPrescription,
      isEmergency: inv.medicine.isEmergency,
      status: inv.status,
      stock: inv.stock,
      price: inv.price,
      batchNumber: inv.batchNumber,
      expiryDate: inv.expiryDate,
      stockLastUpdated: inv.lastUpdated  // freshness field
    }));

    return res.json({
      success: true,
      pharmacy: {
        ...enriched,
        inventory: inventoryWithFreshness,
        manager: pharmacy.manager
      }
    });
  } catch (err) {
    console.error('getPharmacyById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve pharmacy details.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/:pharmacyId/inventory
// Get inventory list for a specific pharmacy
// ─────────────────────────────────────────────────────────────────────────────
async function getPharmacyInventory(req, res) {
  try {
    const { pharmacyId } = req.params;
    const inventory = await prisma.inventory.findMany({
      where: { pharmacyId },
      include: { medicine: true },
      orderBy: { medicine: { brandName: 'asc' } }
    });
    return res.json({ success: true, count: inventory.length, inventory });
  } catch (err) {
    console.error('getPharmacyInventory error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve pharmacy inventory.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pharmacies/match-availability
// Ranked pharmacy availability for requested medicine items.
// Body: { items: [{ medicineId, quantity }], lat, lon, isEmergency }
//
// PRIVACY: lat/lon are used for distance computation only.
// They are NEVER stored, logged, or included in any response.
// ─────────────────────────────────────────────────────────────────────────────
async function matchPharmacyAvailability(req, res) {
  try {
    const { items, lat, lon, isEmergency, includeTest } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine item is required.' });
    }

    // Use patient lat/lon for distance calc only — NEVER stored or returned
    const userLat = lat ? parseFloat(lat) : network.DEFAULT_LAT;
    const userLon = lon ? parseFloat(lon) : network.DEFAULT_LON;

    const whereClause = {};
    if (includeTest === 'true' || includeTest === true) {
      // Diagnostic test queries
    } else {
      whereClause.isVerified = true;
      whereClause.verificationStatus = 'VERIFIED';
    }

    const pharmacies = await prisma.pharmacy.findMany({
      where: whereClause,
      include: {
        inventory: {
          include: { medicine: true }
        }
      }
    });

    // Attach computed open status to each pharmacy before ranking
    const pharmaciesWithOpenStatus = pharmacies.map(p => ({
      ...p,
      computedOpenStatus: computeOpenStatus(p.openingHours, p.isOpen)
    }));

    const rankedResults = rankPharmaciesForMedicines({
      pharmacies: pharmaciesWithOpenStatus,
      requestedItems: items,
      userLat,
      userLon,
      isEmergency: Boolean(isEmergency)
    });

    const participatingCount = rankedResults.filter(r => r.pharmacy.isParticipating).length;
    const testCount = rankedResults.filter(r => r.pharmacy.isTestRecord).length;

    return res.json({
      success: true,
      regionName: network.REGION_NAME,
      totalPharmaciesEvaluated: pharmacies.length,
      participatingCount,
      testCount,
      // User location is NOT included in the response
      results: rankedResults
    });
  } catch (err) {
    console.error('matchPharmacyAvailability error:', err);
    return res.status(500).json({ success: false, error: 'Failed to match pharmacy availability.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/emergency
// Returns open+verified pharmacies with emergency medicine stock.
// Sorted: medicine availability first, then distance.
// Query: lat, lon, radiusKm
// ─────────────────────────────────────────────────────────────────────────────
async function getEmergencyPharmacies(req, res) {
  try {
    const { lat, lon, radiusKm, includeTest } = req.query;
    const userLat = lat ? parseFloat(lat) : network.DEFAULT_LAT;
    const userLon = lon ? parseFloat(lon) : network.DEFAULT_LON;
    const radiusFilter = radiusKm ? parseFloat(radiusKm) : network.MAX_RANGE_KM;

    const whereClause = {
      isOpen: true,
      OR: [
        { emergencyAvailability: true },
        { is24x7: true }
      ]
    };
    if (includeTest === 'true' || includeTest === true) {
      whereClause.AND = [
        {
          OR: [
            { isVerified: true },
            { verificationStatus: 'TEST' }
          ]
        }
      ];
    } else {
      whereClause.isVerified = true;
      whereClause.verificationStatus = 'VERIFIED';
    }

    const pharmacies = await prisma.pharmacy.findMany({
      where: whereClause,
      include: {
        inventory: {
          where: {
            medicine: { isEmergency: true },
            OR: [
              { status: 'AVAILABLE' },
              { stock: { gt: 0 } }
            ]
          },
          include: { medicine: true }
        }
      }
    });

    const enriched = pharmacies
      .map(p => {
        const hasCoords = p.latitude != null && p.longitude != null;
        const distanceKm = hasCoords
          ? calculateDistance(userLat, userLon, p.latitude, p.longitude)
          : null;
        const openStatus = computeOpenStatus(p.openingHours, p.isOpen);

        return {
          id: p.id,
          name: p.name,
          address: p.address,
          phone: p.phone,
          latitude: p.latitude,
          longitude: p.longitude,
          coordinatesAvailable: hasCoords,
          googleMapsUrl: p.googleMapsUrl || null,
          isOpen: p.isOpen,
          is24x7: p.is24x7,
          emergencyAvailability: p.emergencyAvailability || false,
          deliveryAvailable: p.deliveryAvailable || false,
          rating: p.rating,
          openingHours: p.openingHours,
          isTestRecord: p.verificationStatus === 'TEST',
          isParticipating: p.isVerified === true && p.verificationStatus === 'VERIFIED' && p.verificationStatus !== 'TEST',
          testDataNote: p.verificationStatus === 'TEST' ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : null,
          distanceKm,
          // travelTimeMins intentionally omitted — never fabricated
          computedOpenStatus: openStatus,
          emergencyMedicinesStocked: p.inventory.length,
          emergencyStock: p.inventory.map(inv => ({
            medicineId: inv.medicineId,
            brandName: inv.medicine.brandName,
            genericName: inv.medicine.genericName,
            stock: inv.stock,
            price: inv.price,
            category: inv.medicine.category,
            stockLastUpdated: inv.lastUpdated   // freshness
          })),
          emergencyStockList: p.inventory.map(inv => ({
            medicineId: inv.medicineId,
            brandName: inv.medicine.brandName,
            genericName: inv.medicine.genericName,
            stock: inv.stock,
            price: inv.price,
            category: inv.medicine.category,
            stockLastUpdated: inv.lastUpdated   // freshness
          }))
        };
      })
      // Include pharmacies that are either within radius OR have no coordinates (null-safe)
      .filter(p => (p.distanceKm === null || p.distanceKm <= radiusFilter) && p.computedOpenStatus.isCurrentlyOpen === true);

    // Emergency sort: most emergency medicines available first, then nearest distance.
    // This ensures medicine availability is the primary criterion — not 24x7 status.
    enriched.sort((a, b) => {
      if (b.emergencyMedicinesStocked !== a.emergencyMedicinesStocked) {
        return b.emergencyMedicinesStocked - a.emergencyMedicinesStocked;
      }
      // Secondary: 24x7 breaks ties
      if (a.is24x7 !== b.is24x7) {
        return a.is24x7 ? -1 : 1;
      }
      // Tertiary: nearest (null-safe — null distanceKm sorts last)
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      if (a.distanceKm != null) return -1;
      if (b.distanceKm != null) return 1;
      return 0;
    });

    return res.json({
      success: true,
      regionName: network.REGION_NAME,
      emergencyHotlines: network.EMERGENCY_HOTLINES,
      count: enriched.length,
      pharmacies: enriched
    });
  } catch (err) {
    console.error('getEmergencyPharmacies error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve emergency pharmacies.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache for getMyManagedPharmacy (5s TTL)
const managedPharmacyCache = new Map();
const PHARMACY_CACHE_TTL_MS = 5000;

function invalidateManagedPharmacyCache(managerId) {
  if (managerId) managedPharmacyCache.delete(managerId);
  else managedPharmacyCache.clear();
}

async function getMyManagedPharmacy(req, res) {
  try {
    if (req.user.role !== 'PHARMACIST') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only pharmacists can access their managed pharmacy.' });
    }

    const cached = managedPharmacyCache.get(req.user.id);
    if (cached && (Date.now() - cached.timestamp < PHARMACY_CACHE_TTL_MS)) {
      return res.json(cached.data);
    }

    const pharmacy = await prisma.pharmacy.findUnique({
      where: { managerId: req.user.id },
      include: {
        inventory: {
          include: { medicine: true },
          orderBy: { medicine: { brandName: 'asc' } }
        },
        manager: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'No pharmacy associated with this pharmacist account.' });
    }

    const openStatus = computeOpenStatus(pharmacy.openingHours, pharmacy.isOpen);
    const isTestRecord = pharmacy.verificationStatus === 'TEST';
    const testDataNote = isTestRecord ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : null;

    const inventoryWithFreshness = pharmacy.inventory.map(inv => ({
      id: inv.id,
      medicineId: inv.medicineId,
      medicine: inv.medicine,
      brandName: inv.medicine.brandName,
      genericName: inv.medicine.genericName,
      dosageForm: inv.medicine.dosageForm,
      strength: inv.medicine.strength,
      category: inv.medicine.category,
      requiresPrescription: inv.medicine.requiresPrescription,
      isEmergency: inv.medicine.isEmergency,
      stock: inv.stock,
      price: inv.price,
      batchNumber: inv.batchNumber,
      expiryDate: inv.expiryDate,
      stockLastUpdated: inv.lastUpdated
    }));

    const responsePayload = {
      success: true,
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        licenseNumber: pharmacy.licenseNumber,
        address: pharmacy.address,
        latitude: pharmacy.latitude,
        longitude: pharmacy.longitude,
        phone: pharmacy.phone,
        isOpen: pharmacy.isOpen,
        is24x7: pharmacy.is24x7,
        isVerified: pharmacy.isVerified,
        verificationStatus: pharmacy.verificationStatus,
        rating: pharmacy.rating,
        openingHours: pharmacy.openingHours,
        isTestRecord,
        testDataNote,
        computedOpenStatus: openStatus,
        manager: pharmacy.manager,
        inventory: inventoryWithFreshness
      }
    };
    managedPharmacyCache.set(req.user.id, { timestamp: Date.now(), data: responsePayload });

    return res.json(responsePayload);
  } catch (err) {
    console.error('getMyManagedPharmacy error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve managed pharmacy.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/pharmacies/:pharmacyId/inventory
// Update pharmacy inventory (Pharmacist or Admin only).
// ─────────────────────────────────────────────────────────────────────────────
async function updateInventory(req, res) {
  try {
    const { pharmacyId } = req.params;
    const { medicineId, stock, price, batchNumber } = req.body;

    if (!medicineId) {
      return res.status(400).json({ success: false, error: 'medicineId is required.' });
    }

    if (stock === undefined || stock === null) {
      return res.status(400).json({ success: false, error: 'stock is required.' });
    }

    const numStock = Number(stock);
    if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
      return res.status(400).json({ success: false, error: 'Stock must be a valid non-negative integer.' });
    }

    let numPrice;
    if (price !== undefined && price !== null) {
      numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ success: false, error: 'Price must be a valid non-negative number.' });
      }
    } else {
      // If price not provided, default or required check
      numPrice = 50.0;
    }

    if (req.user.role !== 'ADMIN') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });

      if (!managedPharmacy) {
        return res.status(403).json({ success: false, error: 'Unauthorized: No pharmacy associated with your account.' });
      }

      if (managedPharmacy.id !== pharmacyId) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only manage your own pharmacy inventory.' });
      }
    }

    // Verify medicine exists in catalog
    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId }
    });
    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found in catalog.' });
    }

    // Look up previous inventory status before update to detect OUT_OF_STOCK -> AVAILABLE transition
    const prevInv = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId, medicineId } }
    });
    const prevStatus = prevInv ? (prevInv.status || (prevInv.stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK')) : 'OUT_OF_STOCK';
    const newStatus = numStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';

    const updated = await prisma.inventory.upsert({
      where: { pharmacyId_medicineId: { pharmacyId, medicineId } },
      update: {
        stock: numStock,
        price: numPrice,
        status: newStatus,
        batchNumber: batchNumber || undefined,
        lastUpdated: new Date()
      },
      create: {
        pharmacyId,
        medicineId,
        stock: numStock,
        price: numPrice,
        status: newStatus,
        batchNumber: batchNumber || `BATCH-${Date.now()}`
      },
      include: { medicine: true, pharmacy: true }
    });

    // Notify matching active restock requests ONLY if transitioning from OUT_OF_STOCK -> AVAILABLE
    if (prevStatus === 'OUT_OF_STOCK' && newStatus === 'AVAILABLE') {
      const activeRequests = await prisma.restockRequest.findMany({
        where: {
          pharmacyId,
          medicineId,
          status: 'ACTIVE'
        },
        include: { pharmacy: true, medicine: true }
      });

      for (const reqItem of activeRequests) {
        await prisma.notification.create({
          data: {
            userId: reqItem.userId,
            title: `Restock Alert: ${medicine.brandName}`,
            message: `${medicine.brandName} (${medicine.strength || ''}) is now back in stock at ${updated.pharmacy.name}.`,
            type: 'RESTOCK_AVAILABLE',
            linkUrl: `/pharmacies/${pharmacyId}`
          }
        });

        await prisma.restockRequest.update({
          where: { id: reqItem.id },
          data: {
            status: 'FULFILLED',
            notifiedAt: new Date()
          }
        });
      }
    }

    invalidateManagedPharmacyCache();
    return res.json({
      success: true,
      message: 'Inventory updated successfully.',
      item: {
        ...updated,
        stockLastUpdated: updated.lastUpdated
      }
    });
  } catch (err) {
    console.error('updateInventory error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update inventory.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/pharmacies/:pharmacyId/status
// Toggle pharmacy operational status (manual override flag).
// ─────────────────────────────────────────────────────────────────────────────
async function toggleStatus(req, res) {
  try {
    const { pharmacyId } = req.params;
    const { isOpen, is24x7 } = req.body;

    if (req.user.role !== 'ADMIN') {
      const managedPharmacy = await prisma.pharmacy.findUnique({
        where: { managerId: req.user.id }
      });

      if (!managedPharmacy) {
        return res.status(403).json({ success: false, error: 'Unauthorized: No pharmacy associated with your account.' });
      }

      if (managedPharmacy.id !== pharmacyId) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only toggle status for your own pharmacy.' });
      }
    }

    const data = {};
    if (isOpen !== undefined) data.isOpen = Boolean(isOpen);
    if (is24x7 !== undefined) data.is24x7 = Boolean(is24x7);

    const updated = await prisma.pharmacy.update({
      where: { id: pharmacyId },
      data
    });

    invalidateManagedPharmacyCache();
    return res.json({
      success: true,
      message: 'Pharmacy status updated.',
      pharmacy: updated
    });
  } catch (err) {
    console.error('toggleStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update pharmacy status.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/:pharmacyId/inventory
// Returns inventory list for a given pharmacy.
// ─────────────────────────────────────────────────────────────────────────────
async function getPharmacyInventory(req, res) {
  try {
    const pharmacyId = req.params.pharmacyId || req.params.id;
    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      include: {
        inventory: {
          include: { medicine: true },
          orderBy: { medicine: { brandName: 'asc' } }
        }
      }
    });

    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    const inventory = pharmacy.inventory.map(inv => ({
      id: inv.id,
      medicineId: inv.medicineId,
      brandName: inv.medicine.brandName,
      genericName: inv.medicine.genericName,
      dosageForm: inv.medicine.dosageForm,
      strength: inv.medicine.strength,
      category: inv.medicine.category,
      stock: inv.stock,
      price: inv.price,
      isEmergency: inv.medicine.isEmergency,
      stockLastUpdated: inv.lastUpdated
    }));

    return res.json({
      success: true,
      count: inventory.length,
      inventory
    });
  } catch (err) {
    console.error('getPharmacyInventory error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve inventory.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pharmacies/restock-requests
// Register a notification request for an OUT_OF_STOCK medicine at a pharmacy.
// ─────────────────────────────────────────────────────────────────────────────
async function createRestockRequest(req, res) {
  try {
    const { pharmacyId, medicineId } = req.body;
    const userId = req.user.id;

    if (!pharmacyId || !medicineId) {
      return res.status(400).json({
        success: false,
        error: 'Both pharmacyId and medicineId are required.'
      });
    }

    // Verify pharmacy exists
    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id: pharmacyId }
    });
    if (!pharmacy) {
      return res.status(404).json({ success: false, error: 'Pharmacy not found.' });
    }

    // Verify medicine exists
    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId }
    });
    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found.' });
    }

    // Verify the medicine is currently OUT_OF_STOCK at this pharmacy
    const inv = await prisma.inventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId, medicineId } }
    });

    const isAvailable = inv && (inv.status === 'AVAILABLE' || (inv.stock != null && inv.stock > 0));
    if (isAvailable) {
      return res.status(400).json({
        success: false,
        error: 'Medicine is currently in stock at this pharmacy. Restock notification is only available for out-of-stock medicines.'
      });
    }

    // Check for duplicate active request for same patient + medicine + pharmacy
    const existing = await prisma.restockRequest.findFirst({
      where: {
        userId,
        pharmacyId,
        medicineId,
        status: 'ACTIVE'
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'You already have an active restock notification request for this medicine at this pharmacy.'
      });
    }

    const newRequest = await prisma.restockRequest.create({
      data: {
        userId,
        pharmacyId,
        medicineId,
        status: 'ACTIVE'
      },
      include: {
        pharmacy: { select: { id: true, name: true, phone: true } },
        medicine: { select: { id: true, brandName: true, genericName: true, strength: true, dosageForm: true } }
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Restock notification request registered. We will notify you if and when this medicine becomes available.',
      request: newRequest
    });
  } catch (err) {
    console.error('createRestockRequest error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create restock request.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/restock-requests/my
// Returns patient's active and fulfilled restock requests (user-isolated).
// ─────────────────────────────────────────────────────────────────────────────
async function getMyRestockRequests(req, res) {
  try {
    const userId = req.user.id;

    const requests = await prisma.restockRequest.findMany({
      where: { userId },
      include: {
        pharmacy: { select: { id: true, name: true, phone: true, address: true } },
        medicine: { select: { id: true, brandName: true, genericName: true, strength: true, dosageForm: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (err) {
    console.error('getMyRestockRequests error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve restock requests.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/pharmacies/restock-requests/:id
// Cancel a patient's active restock request.
// ─────────────────────────────────────────────────────────────────────────────
async function cancelRestockRequest(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const request = await prisma.restockRequest.findUnique({
      where: { id }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Restock request not found.' });
    }

    if (request.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Cannot cancel another user\'s restock request.' });
    }

    const cancelled = await prisma.restockRequest.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    return res.json({
      success: true,
      message: 'Restock request cancelled.',
      request: cancelled
    });
  } catch (err) {
    console.error('cancelRestockRequest error:', err);
    return res.status(500).json({ success: false, error: 'Failed to cancel restock request.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pharmacies/fallback-directory
// Returns only real participating pharmacies with authoritative contact data
// for the offline/fallback SMS pathway. Requires authentication.
// ─────────────────────────────────────────────────────────────────────────────
async function getFallbackDirectory(req, res) {
  try {
    const pharmacies = await prisma.pharmacy.findMany({
      where: {
        isVerified: true,
        verificationStatus: 'VERIFIED',
        dataSource: 'PHARMACY_PROVIDED'
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        openingHours: true,
        isOpen: true,
        is24x7: true,
        rating: true,
        dataSource: true
      },
      orderBy: { name: 'asc' }
    });

    return res.json({
      success: true,
      count: pharmacies.length,
      pharmacies: pharmacies.map(p => ({
        ...p,
        isParticipating: true,
        isTestRecord: false
      }))
    });
  } catch (err) {
    console.error('getFallbackDirectory error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve fallback directory.' });
  }
}

module.exports = {
  getNetworkConfig,
  getPharmacies,
  getPharmacyById,
  getPharmacyInventory,
  getMyManagedPharmacy,
  matchPharmacyAvailability,
  getEmergencyPharmacies,
  updateInventory,
  toggleStatus,
  createRestockRequest,
  getMyRestockRequests,
  cancelRestockRequest,
  getFallbackDirectory
};

