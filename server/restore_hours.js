const prisma = require('./src/prisma');

async function restoreHours() {
  await prisma.pharmacy.updateMany({
    where: { name: 'Max Care Pharmacy' },
    data: { openingHours: '09:30–20:00', is24x7: false, isOpen: true }
  });
  await prisma.pharmacy.updateMany({
    where: { name: 'Karuna Medicals' },
    data: { openingHours: '09:30–19:00', is24x7: false, isOpen: true }
  });
  console.log('Restored authentic opening hours for both pharmacies:');
  const pharms = await prisma.pharmacy.findMany({ select: { name: true, openingHours: true, is24x7: true } });
  console.log(JSON.stringify(pharms, null, 2));
}

restoreHours().finally(() => prisma.$disconnect());
