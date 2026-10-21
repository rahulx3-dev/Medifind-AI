const { createSafeTestPrismaClient } = require('../src/utils/testDatabaseGuard');

// Explicit test-only authorization gate for destructive pharmacy removal
if (process.env.ALLOW_TEST_DATA_CLEANUP !== 'true') {
  const errMsg = '[CRITICAL REFUSAL] delete_alappuzha_test_pharmacy is a destructive operation. Execution is strictly prohibited unless explicitly authorized via ALLOW_TEST_DATA_CLEANUP=true and validated against a disposable test database.';
  console.error(errMsg);
  const err = new Error(errMsg);
  err.code = 'UNAUTHORIZED_DESTRUCTIVE_CLEANUP';
  throw err;
}

const prisma = createSafeTestPrismaClient();

async function deleteAlappuzhaTestPharmacy() {
  console.log('--- Removing [TEST] Alappuzha Town Area Pharmacy ---');

  const testPharm = await prisma.pharmacy.findFirst({
    where: {
      OR: [
        { name: { contains: 'Alappuzha' } },
        { licenseNumber: 'TEST-KL-ALP-003' }
      ]
    }
  });

  if (!testPharm) {
    console.log('Pharmacy already removed or not found.');
    return;
  }

  console.log(`Found: ${testPharm.name} (ID: ${testPharm.id}, Manager: ${testPharm.managerId})`);

  await prisma.$transaction(async (tx) => {
    // 1. Delete restock requests if any
    await tx.restockRequest.deleteMany({
      where: { pharmacyId: testPharm.id }
    });

    // 2. Delete inventory if any
    await tx.inventory.deleteMany({
      where: { pharmacyId: testPharm.id }
    });

    // 3. Delete pharmacy
    await tx.pharmacy.delete({
      where: { id: testPharm.id }
    });

    // 4. Delete dummy test pharmacist user if exists
    if (testPharm.managerId) {
      await tx.user.delete({
        where: { id: testPharm.managerId }
      });
      console.log(`Deleted associated dummy pharmacist user ID: ${testPharm.managerId}`);
    }
  });

  console.log('Successfully deleted [TEST] Alappuzha Town Area Pharmacy from database.');

  const remainingPharmacies = await prisma.pharmacy.findMany({
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      verificationStatus: true,
      isVerified: true,
      isOpen: true,
      manager: {
        select: {
          email: true,
          name: true
        }
      }
    }
  });

  console.log('\nRemaining Active Network Pharmacies:');
  console.log(JSON.stringify(remainingPharmacies, null, 2));

  const remainingUsers = await prisma.user.count();
  console.log(`\nRemaining Users in Database: ${remainingUsers}`);
}

deleteAlappuzhaTestPharmacy()
  .catch((err) => {
    console.error('Error deleting test pharmacy:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
