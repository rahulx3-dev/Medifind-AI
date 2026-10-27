const prisma = require('./src/prisma');

async function migrateAndDelete() {
  const targetPharmacy = await prisma.pharmacy.findFirst({
    where: { name: 'Karuna Medicals' }
  });

  if (!targetPharmacy) {
    throw new Error('Karuna Medicals not found in DB!');
  }

  const fakePharms = await prisma.pharmacy.findMany({
    where: { name: { in: ['MediFind Kerala Hub Pharmacy (24x7)', 'Competitor Dispensary B'] } }
  });

  console.log(`Found ${fakePharms.length} fake pharmacies to migrate and remove.`);

  for (const fake of fakePharms) {
    console.log(`Processing: ${fake.name} (${fake.id})`);

    // 1. Move orders to Karuna Medicals so historical data is preserved
    const updatedOrders = await prisma.order.updateMany({
      where: { pharmacyId: fake.id },
      data: { pharmacyId: targetPharmacy.id }
    });
    console.log(`  Reassigned ${updatedOrders.count} orders to Karuna Medicals`);

    // 2. Remove inventory records of the fake pharmacy
    const delInv = await prisma.inventory.deleteMany({
      where: { pharmacyId: fake.id }
    });
    console.log(`  Deleted ${delInv.count} fake inventory records`);

    // 3. Delete the fake pharmacy record
    await prisma.pharmacy.delete({
      where: { id: fake.id }
    });
    console.log(`  Deleted pharmacy ${fake.name}`);
  }

  const remaining = await prisma.pharmacy.findMany({
    select: { id: true, name: true, phone: true }
  });
  console.log('Remaining Active Pharmacies in DB:', remaining);
}

migrateAndDelete()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
