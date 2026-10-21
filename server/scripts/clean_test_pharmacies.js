const { createSafeTestPrismaClient } = require('../src/utils/testDatabaseGuard');

// Explicit test-only authorization gate for destructive cleanup
if (process.env.ALLOW_TEST_DATA_CLEANUP !== 'true') {
  const errMsg = '[CRITICAL REFUSAL] clean_test_pharmacies is a destructive operation. Execution is strictly prohibited unless explicitly authorized via ALLOW_TEST_DATA_CLEANUP=true and validated against a disposable test database.';
  console.error(errMsg);
  const err = new Error(errMsg);
  err.code = 'UNAUTHORIZED_DESTRUCTIVE_CLEANUP';
  throw err;
}

const prisma = createSafeTestPrismaClient();

async function clean() {
  console.log('--- CLEANING STALE TEST PHARMACIES ---');

  const keepNames = [
    'Max Care Pharmacy',
    'Karuna Medicals'
  ];

  // Find all pharmacies to remove
  const stalePharmacies = await prisma.pharmacy.findMany({
    where: {
      name: { notIn: keepNames }
    },
    include: {
      orders: true
    }
  });

  console.log(`Found ${stalePharmacies.length} stale pharmacies to clean up.`);

  for (const p of stalePharmacies) {
    console.log(`Cleaning pharmacy: ${p.name} (${p.id})`);
    
    // 1. Delete restock requests
    await prisma.restockRequest.deleteMany({
      where: { pharmacyId: p.id }
    });

    // 2. Delete orders and child records
    const orderIds = p.orders.map(o => o.id);
    if (orderIds.length > 0) {
      await prisma.assistantTask.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      await prisma.payment.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await prisma.order.deleteMany({
        where: { id: { in: orderIds } }
      });
    }

    // 3. Delete inventory
    await prisma.inventory.deleteMany({
      where: { pharmacyId: p.id }
    });

    // 4. Delete the pharmacy itself
    await prisma.pharmacy.delete({
      where: { id: p.id }
    });

    // 5. If manager exists and is a test user, delete user
    if (p.managerId) {
      try {
        await prisma.user.delete({
          where: { id: p.managerId }
        });
      } catch (err) {
        // manager might still be linked elsewhere or already deleted
      }
    }
  }

  // Ensure Max Care and Karuna Medicals have clean production attributes
  await prisma.pharmacy.updateMany({
    where: { name: 'Max Care Pharmacy' },
    data: {
      isVerified: true,
      verificationStatus: 'VERIFIED',
      dataSource: 'PHARMACY_PROVIDED',
      latitude: null,
      longitude: null,
      licenseNumber: null,
      rating: 0.0
    }
  });

  await prisma.pharmacy.updateMany({
    where: { name: 'Karuna Medicals' },
    data: {
      isVerified: true,
      verificationStatus: 'VERIFIED',
      dataSource: 'PHARMACY_PROVIDED',
      latitude: null,
      longitude: null,
      licenseNumber: null,
      rating: 0.0
    }
  });

  // Check remaining pharmacies
  const remaining = await prisma.pharmacy.findMany({
    select: {
      id: true,
      name: true,
      isVerified: true,
      verificationStatus: true,
      dataSource: true,
      latitude: true,
      longitude: true
    }
  });

  console.log('\n--- REMAINING PHARMACIES IN DATABASE ---');
  console.log(JSON.stringify(remaining, null, 2));

  const participatingCount = remaining.filter(p => p.isVerified && p.verificationStatus === 'VERIFIED').length;
  console.log(`\nVerified Participating Pharmacies Count: ${participatingCount}`);
}

clean()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
