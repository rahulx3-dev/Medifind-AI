/**
 * Final Publish & Presentation Data Cleanup Script
 *
 * Safely removes test orders, order items, tasks, order payments, and disposable test accounts
 * while preserving:
 * - 50 medicine catalogue records
 * - 100 inventory records
 * - 2 real participating pharmacies
 * - 1 deactivated test fixture
 * - Core demo users and pharmacy managers
 * - Assistant profiles and capabilities
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runCleanup() {
  console.log('=== FINAL MEDIFIND AI DATA CLEANUP + PUBLISH PREPARATION ===\n');

  // 1. Delete Order-owned and related test records
  const deletedHistory = await prisma.orderStatusHistory.deleteMany({});
  console.log(`- Deleted OrderStatusHistory records: ${deletedHistory.count}`);

  const deletedItems = await prisma.orderItem.deleteMany({});
  console.log(`- Deleted OrderItem records: ${deletedItems.count}`);

  const deletedPayments = await prisma.payment.deleteMany({});
  console.log(`- Deleted Payment transaction records: ${deletedPayments.count}`);

  const deletedTasks = await prisma.assistantTask.deleteMany({});
  console.log(`- Deleted AssistantTask records: ${deletedTasks.count}`);

  const deletedOrders = await prisma.order.deleteMany({});
  console.log(`- Deleted Order records: ${deletedOrders.count}`);

  // 2. Delete order-related notifications
  const deletedOrderNotifs = await prisma.notification.deleteMany({
    where: {
      type: { in: ['ORDER', 'ORDER_STATUS', 'ASSISTANT'] }
    }
  });
  console.log(`- Deleted order/assistant notification records: ${deletedOrderNotifs.count}`);

  // 3. Identify and clean disposable test users
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const disposableUsers = allUsers.filter(u =>
    u.email.includes('_179') ||
    u.email.endsWith('@test.com') ||
    u.email.endsWith('@medifind.test') ||
    u.email.startsWith('sec-') ||
    u.email.startsWith('patient2_') ||
    u.email.includes('noaddr_') ||
    u.email.startsWith('testpatient_')
  );
  const disposableIds = disposableUsers.map(u => u.id);
  console.log(`- Identified disposable test accounts: ${disposableIds.length}`);

  if (disposableIds.length > 0) {
    // Delete dependent records of disposable users
    await prisma.notification.deleteMany({ where: { userId: { in: disposableIds } } });
    await prisma.restockRequest.deleteMany({ where: { userId: { in: disposableIds } } });
    await prisma.patientAddress.deleteMany({ where: { userId: { in: disposableIds } } });
    
    // Delete detected medicines before prescriptions
    const rxList = await prisma.prescription.findMany({
      where: { userId: { in: disposableIds } },
      select: { id: true }
    });
    const rxIds = rxList.map(r => r.id);
    if (rxIds.length > 0) {
      await prisma.detectedMedicine.deleteMany({ where: { prescriptionId: { in: rxIds } } });
      await prisma.prescription.deleteMany({ where: { id: { in: rxIds } } });
    }

    await prisma.assistantProfile.deleteMany({ where: { userId: { in: disposableIds } } });
    const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: disposableIds } } });
    console.log(`- Removed disposable test users: ${deletedUsers.count}`);
  }

  // 4. Ensure core demo Assistant profile has full capabilities enabled
  const coreAssistant = await prisma.user.findFirst({
    where: { email: 'assistant@medifind.com' }
  });
  if (coreAssistant) {
    await prisma.assistantProfile.upsert({
      where: { userId: coreAssistant.id },
      update: {
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT,DIGITAL_ASSISTANCE,MEDICINE_COLLECTION,PHARMACY_COMMS,RESTOCK_ASSISTANCE,PRESCRIPTION_ASSISTANCE,PHARMACY_COMPANION'
      },
      create: {
        userId: coreAssistant.id,
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,PHARMACY_VISIT,DIGITAL_ASSISTANCE,MEDICINE_COLLECTION,PHARMACY_COMMS,RESTOCK_ASSISTANCE,PRESCRIPTION_ASSISTANCE,PHARMACY_COMPANION'
      }
    });
    console.log('- Core demo assistant profile verified with full service capabilities.');
  }

  // 5. Verify database integrity counts
  const remainingOrders = await prisma.order.count();
  const remainingOrderItems = await prisma.orderItem.count();
  const remainingTasks = await prisma.assistantTask.count();
  const remainingMedicines = await prisma.medicine.count();
  const remainingInventory = await prisma.inventory.count();
  const allPharmacies = await prisma.pharmacy.findMany();
  const realPharmacies = allPharmacies.filter(p => p.isVerified && p.verificationStatus === 'VERIFIED');
  const testFixtures = allPharmacies.filter(p => p.verificationStatus === 'TEST');
  const remainingUsers = await prisma.user.count();

  console.log('\n--- INTEGRITY VERIFICATION ---');
  console.log(`Orders: ${remainingOrders} (expected: 0)`);
  console.log(`OrderItems: ${remainingOrderItems} (expected: 0)`);
  console.log(`AssistantTasks: ${remainingTasks} (expected: 0)`);
  console.log(`Medicines: ${remainingMedicines} (expected: 50)`);
  console.log(`Inventory: ${remainingInventory} (expected: 100)`);
  console.log(`Real Participating Pharmacies: ${realPharmacies.length} (expected: 2)`);
  console.log(`Deactivated Test Fixture: ${testFixtures.length} (expected: 1)`);
  console.log(`Remaining Core Users: ${remainingUsers}`);

  if (
    remainingOrders === 0 &&
    remainingOrderItems === 0 &&
    remainingTasks === 0 &&
    remainingMedicines === 50 &&
    remainingInventory === 100 &&
    realPharmacies.length === 2 &&
    testFixtures.length === 1
  ) {
    console.log('\n✅ ALL INTEGRITY CRITERIA PASSED.');
  } else {
    console.error('\n❌ INTEGRITY CRITERIA MISMATCH.');
    process.exit(1);
  }

  process.exit(0);
}

runCleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
