const prisma = require('./src/prisma');

async function main() {
  const pharmacies = await prisma.pharmacy.findMany({
    include: {
      manager: true,
      _count: { select: { inventory: true, orders: true } }
    }
  });
  console.log('Pharmacies in DB:', JSON.stringify(pharmacies.map(p => ({
    id: p.id,
    name: p.name,
    isVerified: p.isVerified,
    verificationStatus: p.verificationStatus,
    licenseNumber: p.licenseNumber,
    address: p.address,
    lat: p.latitude,
    lng: p.longitude,
    phone: p.phone,
    managerEmail: p.manager?.email,
    inventoryCount: p._count.inventory,
    ordersCount: p._count.orders,
    isOpen: p.isOpen,
    is24x7: p.is24x7,
    openingHours: p.openingHours
  })), null, 2));
}

main().finally(() => prisma.$disconnect());
