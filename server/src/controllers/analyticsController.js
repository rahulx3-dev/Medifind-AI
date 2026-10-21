const prisma = require('../prisma');

let cachedMetrics = null;
let lastMetricsFetch = 0;
const METRICS_CACHE_TTL_MS = 8000;

// Platform-wide metrics for Admin Dashboard
async function getAdminMetrics(req, res) {
  try {
    const now = Date.now();
    if (cachedMetrics && (now - lastMetricsFetch) < METRICS_CACHE_TTL_MS) {
      return res.json({ success: true, metrics: cachedMetrics });
    }

    const totalMedicines = await prisma.medicine.count();
    const emergencyMedicines = await prisma.medicine.count({ where: { isEmergency: true } });
    const totalPharmacies = await prisma.pharmacy.count({ where: { isVerified: true, verificationStatus: 'VERIFIED' } });
    const open24x7Pharmacies = await prisma.pharmacy.count({ where: { is24x7: true, isVerified: true, verificationStatus: 'VERIFIED' } });
    const totalOrders = await prisma.order.count();
    const pendingOrders = await prisma.order.count({ where: { status: 'PENDING' } });
    const readyOrders = await prisma.order.count({ where: { status: 'READY_FOR_PICKUP' } });
    const confirmedOrders = await prisma.order.count({ where: { status: 'CONFIRMED' } });
    const completedOrders = await prisma.order.count({ where: { status: 'COMPLETED' } });
    const totalPrescriptions = await prisma.prescription.count();

    // Total registered users across platform
    const totalUsers = await prisma.user.count();
    const patientUsers = await prisma.user.count({ where: { role: 'PATIENT' } });
    const pharmacistUsers = await prisma.user.count({ where: { role: 'PHARMACIST' } });
    const assistantUsers = await prisma.user.count({ where: { role: 'ASSISTANT' } });

    // Low stock items across all pharmacies (stock <= 10 as per buffer threshold)
    const lowStockCount = await prisma.inventory.count({
      where: { stock: { lte: 10 } }
    });

    const lowStockItems = await prisma.inventory.findMany({
      where: { stock: { lte: 10 } },
      include: {
        medicine: true,
        pharmacy: { select: { id: true, name: true } }
      },
      orderBy: { stock: 'asc' },
      take: 20
    });

    // Medicines by category breakdown
    const allMeds = await prisma.medicine.findMany({ select: { category: true } });
    const categoryCount = {};
    allMeds.forEach(m => {
      categoryCount[m.category] = (categoryCount[m.category] || 0) + 1;
    });

    const fulfillmentRate = totalOrders > 0
      ? Number(((completedOrders / totalOrders) * 100).toFixed(1))
      : 100;

    const metricsResult = {
      totalMedicines,
      emergencyMedicines,
      totalPharmacies,
      open24x7Pharmacies,
      totalOrders,
      pendingOrders,
      readyOrders,
      confirmedOrders,
      completedOrders,
      fulfillmentRate,
      totalPrescriptions,
      totalUsers,
      userBreakdown: {
        patients: patientUsers,
        pharmacists: pharmacistUsers,
        assistants: assistantUsers
      },
      lowStockCount,
      lowStockItems,
      categoryDistribution: categoryCount
    };

    cachedMetrics = metricsResult;
    lastMetricsFetch = Date.now();

    return res.json({
      success: true,
      metrics: metricsResult
    });
  } catch (err) {
    console.error('getAdminMetrics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate metrics.' });
  }
}

const network = require('../utils/pharmacyNetwork');

// Offline fallback catalog bundle:
// Exports full 50-medicine academic dataset + 5 pharmacies + emergency contacts
// for client IndexedDB / localStorage offline caching
async function getOfflineCatalogBundle(req, res) {
  try {
    const medicines = await prisma.medicine.findMany({
      orderBy: { brandName: 'asc' }
    });

    // Offline bundle: only real participating pharmacies (not deactivated test fixtures).
    // coordinatesAvailable clearly indicates whether lat/lon is authoritative or null.
    const rawPharmacies = await prisma.pharmacy.findMany({
      where: {
        isVerified: true,
        verificationStatus: 'VERIFIED'
      },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phone: true,
        is24x7: true,
        openingHours: true,
        rating: true,
        googleMapsUrl: true,
        dataSource: true
      }
    });

    // Add coordinatesAvailable and isParticipating so offline clients can render correctly.
    // Do NOT fabricate missing coordinates.
    const pharmacies = rawPharmacies.map(p => ({
      ...p,
      coordinatesAvailable: p.latitude != null && p.longitude != null,
      isParticipating: true   // All records in this bundle are real participating pharmacies
    }));

    const emergencyHotlines = network.EMERGENCY_HOTLINES.map(h => ({
      service: h.desc,
      number: h.dialable,
      label: h.label
    }));

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      version: '1.0.0-academic',
      datasetSize: medicines.length,
      pharmacyCount: pharmacies.length,
      emergencyHotlines,
      medicines,
      pharmacies
    });
  } catch (err) {
    console.error('getOfflineCatalogBundle error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate offline bundle.' });
  }
}

module.exports = {
  getAdminMetrics,
  getOfflineCatalogBundle
};
