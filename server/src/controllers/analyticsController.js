const prisma = require('../prisma');

// Platform-wide metrics for Admin Dashboard
async function getAdminMetrics(req, res) {
  try {
    const totalMedicines = await prisma.medicine.count();
    const emergencyMedicines = await prisma.medicine.count({ where: { isEmergency: true } });
    const totalPharmacies = await prisma.pharmacy.count({ where: { isVerified: true, verificationStatus: 'VERIFIED' } });
    const open24x7Pharmacies = await prisma.pharmacy.count({ where: { is24x7: true, isVerified: true, verificationStatus: 'VERIFIED' } });
    const totalOrders = await prisma.order.count();
    const pendingOrders = await prisma.order.count({ where: { status: 'PENDING' } });
    const completedOrders = await prisma.order.count({ where: { status: 'COMPLETED' } });
    const totalPrescriptions = await prisma.prescription.count();

    // Low stock items across all pharmacies (stock <= 10 as per Stitch buffer threshold)
    const lowStockItems = await prisma.inventory.findMany({
      where: { stock: { lte: 10 } },
      include: {
        medicine: true,
        pharmacy: { select: { id: true, name: true } }
      },
      take: 20
    });

    // Medicines by category breakdown
    const allMeds = await prisma.medicine.findMany({ select: { category: true } });
    const categoryCount = {};
    allMeds.forEach(m => {
      categoryCount[m.category] = (categoryCount[m.category] || 0) + 1;
    });

    return res.json({
      success: true,
      metrics: {
        totalMedicines,
        emergencyMedicines,
        totalPharmacies,
        open24x7Pharmacies,
        totalOrders,
        pendingOrders,
        completedOrders,
        totalPrescriptions,
        lowStockCount: lowStockItems.length,
        lowStockItems,
        categoryDistribution: categoryCount
      }
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
