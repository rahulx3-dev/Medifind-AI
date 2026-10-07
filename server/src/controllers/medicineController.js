const prisma = require('../prisma');

// Search medicines catalog
async function searchMedicines(req, res) {
  try {
    const { query, q, search, category, emergencyOnly } = req.query;
    const searchTerm = (query || q || search || '').trim();

    const whereClause = {};

    if (searchTerm !== '') {
      whereClause.OR = [
        { brandName: { contains: searchTerm } },
        { genericName: { contains: searchTerm } },
        { category: { contains: searchTerm } },
        { commonUses: { contains: searchTerm } }
      ];
    }

    if (category && category !== 'ALL') {
      whereClause.category = { contains: category };
    }

    if (emergencyOnly === 'true') {
      whereClause.isEmergency = true;
    }

    const medicines = await prisma.medicine.findMany({
      where: whereClause,
      orderBy: { brandName: 'asc' },
      take: 60
    });

    return res.json({
      success: true,
      count: medicines.length,
      medicines
    });
  } catch (err) {
    console.error('searchMedicines error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search medicines.' });
  }
}

// Get single medicine details with alternative options
async function getMedicineById(req, res) {
  try {
    const { id } = req.params;

    const medicine = await prisma.medicine.findUnique({
      where: { id },
      include: {
        inventoryItems: {
          where: {
            pharmacy: {
              isVerified: true,
              verificationStatus: 'VERIFIED'
            }
          },
          include: {
            pharmacy: {
              select: {
                id: true,
                name: true,
                address: true,
                latitude: true,
                longitude: true,
                phone: true,
                isOpen: true,
                is24x7: true,
                rating: true
              }
            }
          }
        }
      }
    });

    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found.' });
    }

    // Parse alternative generics if saved as JSON
    let parsedAlternatives = [];
    if (medicine.alternativeGenerics) {
      try {
        parsedAlternatives = JSON.parse(medicine.alternativeGenerics);
      } catch (e) {
        parsedAlternatives = medicine.alternativeGenerics.split(',').map(s => s.trim());
      }
    }

    return res.json({
      success: true,
      medicine: {
        ...medicine,
        alternativeGenericsList: parsedAlternatives
      }
    });
  } catch (err) {
    console.error('getMedicineById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch medicine details.' });
  }
}

// Get distinct categories
async function getCategories(req, res) {
  try {
    const medicines = await prisma.medicine.findMany({
      select: { category: true }
    });

    const categories = Array.from(new Set(medicines.map(m => m.category).filter(Boolean))).sort();

    return res.json({
      success: true,
      categories
    });
  } catch (err) {
    console.error('getCategories error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve categories.' });
  }
}

// Get emergency critical medicines
async function getEmergencyMedicines(req, res) {
  try {
    const emergencyMeds = await prisma.medicine.findMany({
      where: { isEmergency: true },
      orderBy: { brandName: 'asc' }
    });

    return res.json({
      success: true,
      count: emergencyMeds.length,
      medicines: emergencyMeds
    });
  } catch (err) {
    console.error('getEmergencyMedicines error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve emergency medicines.' });
  }
}

module.exports = {
  searchMedicines,
  getMedicineById,
  getCategories,
  getEmergencyMedicines
};
