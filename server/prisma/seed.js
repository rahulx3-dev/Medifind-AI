const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// Medicine catalogue — NOT modified by Phase 3
const { medicinesData } = require('./seedData');

// ─────────────────────────────────────────────────────────────────────────────
// PHARMACY DATA SOURCE CONFIGURATION
//
// Currently using TEST fixtures (no real participating pharmacies).
// To switch to approved real pharmacies:
//   1. Create approvedPharmacies.js with the identical field structure
//   2. Change the require below to: require('./approvedPharmacies')
//   3. No other code changes are required.
// ─────────────────────────────────────────────────────────────────────────────
const { keralaTestPharmacies: pharmaciesData } = require('./keralaTestPharmacies');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 MediFind AI — Initializing Seed Database...');
  console.log('');
  console.log('⚠️  PHARMACY DATA SOURCE: TEST FIXTURES');
  console.log('   The pharmacy records being seeded are TEST DATA only.');
  console.log('   None of them represent real participating pharmacies.');
  console.log('   See prisma/keralaTestPharmacies.js for details.');
  console.log('');

  // Clean existing tables in reverse dependency order
  await prisma.notification.deleteMany();
  await prisma.assistantTask.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.detectedMedicine.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Patient User
  const patient = await prisma.user.create({
    data: {
      email: 'patient@medifind.com',
      password: passwordHash,
      name: 'Rohan Sharma',
      phone: '+91-98765-43210',
      role: 'PATIENT'
    }
  });

  // 2. Create Assistant User
  const assistant = await prisma.user.create({
    data: {
      email: 'assistant@medifind.com',
      password: passwordHash,
      name: 'Kavita Patel (Access Assistant)',
      phone: '+91-98765-11223',
      role: 'ASSISTANT'
    }
  });

  // 3. Create Admin User
  const admin = await prisma.user.create({
    data: {
      email: 'admin@medifind.com',
      password: passwordHash,
      name: 'MediFind System Admin',
      phone: '+91-98765-99887',
      role: 'ADMIN'
    }
  });

  // 4. Create Test Pharmacist Managers and their Test Pharmacies
  // All records are TEST DATA — see keralaTestPharmacies.js
  const createdPharmacies = [];
  for (let i = 0; i < pharmaciesData.length; i++) {
    const pData = pharmaciesData[i];

    const pharmacist = await prisma.user.create({
      data: {
        email: pData.managerEmail,
        password: passwordHash,
        name: `Test Pharmacist ${i + 1} (${pData.name})`,
        phone: 'CONTACT-NOT-AVAILABLE',
        role: 'PHARMACIST'
      }
    });

    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: pData.name,
        licenseNumber: pData.licenseNumber,
        address: pData.address,
        latitude: pData.latitude,
        longitude: pData.longitude,
        phone: pData.phone,
        isOpen: pData.isOpen,
        is24x7: pData.is24x7,
        isVerified: pData.isVerified,
        verificationStatus: pData.verificationStatus,  // 'TEST' marks test records
        rating: pData.rating,
        openingHours: pData.openingHours,
        managerId: pharmacist.id
        // isTestRecord / testDataNote are NOT schema columns;
        // derived at runtime from verificationStatus === 'TEST'
      }
    });

    createdPharmacies.push(pharmacy);
  }

  // 5. Seed 50 Medicines (unchanged medicine catalogue)
  const createdMedicines = [];
  for (const medData of medicinesData) {
    const med = await prisma.medicine.create({ data: medData });
    createdMedicines.push(med);
  }

  console.log(`✅ Seeded ${createdMedicines.length} medicines (unchanged catalogue)`);
  console.log(`⚠️  Seeded ${createdPharmacies.length} TEST pharmacy fixtures (NOT real participating pharmacies)`);

  // 6. Seed Inventory across test pharmacies
  // Distribution designed to exercise all ranking scenarios for testing.
  // Stock values are synthetic and do not represent real availability.
  let inventoryCount = 0;
  for (let pIdx = 0; pIdx < createdPharmacies.length; pIdx++) {
    const pharmacy = createdPharmacies[pIdx];

    for (let mIdx = 0; mIdx < createdMedicines.length; mIdx++) {
      const med = createdMedicines[mIdx];
      let stock = 0;
      let price = 0;

      // Synthetic pricing based on category (for testing only)
      if (med.isEmergency) {
        price = Math.round(150 + (mIdx * 15));
      } else if (med.category.includes('Antibiotic')) {
        price = Math.round(90 + (mIdx * 8));
      } else {
        price = Math.round(30 + (mIdx * 4));
      }

      // Test stock allocation — NOT real inventory data
      if (pIdx === 0) {
        // Chengannur test pharmacy: well-stocked for full-match testing
        stock = 25 + (mIdx % 20);
      } else if (pIdx === 1) {
        // Haripad test pharmacy: partial stock for partial-match testing
        stock = (mIdx >= 35 && mIdx <= 42) ? 0 : (10 + (mIdx % 15));
      } else if (pIdx === 2) {
        // Alappuzha test pharmacy: strong in emergency medicines for 24x7 testing
        stock = med.isEmergency ? 40 : (mIdx % 3 === 0 ? 15 : 0);
      }

      if (stock > 0) {
        await prisma.inventory.create({
          data: {
            pharmacyId: pharmacy.id,
            medicineId: med.id,
            stock,
            price: Number(price.toFixed(2)),
            batchNumber: `TEST-BATCH-${1000 + mIdx}`,
            expiryDate: new Date('2027-12-31')
          }
        });
        inventoryCount++;
      }
    }
  }

  console.log(`✅ Seeded ${inventoryCount} test inventory records`);

  // 7. Sample Prescription (references Chengannur test pharmacy area)
  const samplePrescription = await prisma.prescription.create({
    data: {
      userId: patient.id,
      originalFileName: 'rx_sample_dr_verma.jpg',
      filePath: 'uploads/prescriptions/sample_rx.jpg',
      ocrRawText: `CLINIC CARE MULTISPECIALTY
Dr. Alok Verma, MD (Gen Med) - Reg No: KMC-58291
Patient: Rohan Sharma | Age: 28 | Date: 10-Sep-2026
Diagnosis: Acute bacterial bronchitis with fever

Rx:
1. Augmentin 625 Duo - 1 tab twice daily x 5 days
2. Dolo 650 - 1 tab SOS for fever (max 3 daily)
3. Pan 40 - 1 tab before breakfast x 5 days
4. Asthalin Inhaler - 2 puffs as needed for wheeze

Signature: Dr. A. Verma`,
      status: 'VERIFIED',
      detectedMedicines: {
        create: [
          {
            rawName: 'Augmentin 625 Duo - 1 tab twice daily x 5 days',
            matchedMedicineId: createdMedicines.find(m => m.brandName === 'Augmentin 625 Duo')?.id,
            matchedMedicineName: 'Augmentin 625 Duo',
            confidence: 0.96,
            dosage: '1 tablet',
            frequency: 'Twice daily',
            duration: '5 days',
            quantity: 10,
            isConfirmed: true
          },
          {
            rawName: 'Dolo 650 - 1 tab SOS for fever (max 3 daily)',
            matchedMedicineId: createdMedicines.find(m => m.brandName === 'Dolo 650')?.id,
            matchedMedicineName: 'Dolo 650',
            confidence: 0.94,
            dosage: '1 tablet',
            frequency: 'SOS / as needed',
            duration: '3 days',
            quantity: 10,
            isConfirmed: true
          },
          {
            rawName: 'Pan 40 - 1 tab before breakfast x 5 days',
            matchedMedicineId: createdMedicines.find(m => m.brandName === 'Pan 40')?.id,
            matchedMedicineName: 'Pan 40',
            confidence: 0.92,
            dosage: '1 tablet',
            frequency: 'Once daily before food',
            duration: '5 days',
            quantity: 5,
            isConfirmed: true
          },
          {
            rawName: 'Asthalin Inhaler - 2 puffs as needed for wheeze',
            matchedMedicineId: createdMedicines.find(m => m.brandName === 'Asthalin Inhaler')?.id,
            matchedMedicineName: 'Asthalin Inhaler',
            confidence: 0.98,
            dosage: '2 puffs',
            frequency: 'As needed',
            duration: '1 inhaler',
            quantity: 1,
            isConfirmed: true
          }
        ]
      }
    }
  });

  // 8. Sample Reservation Order — references first test pharmacy (Chengannur area)
  const doloMed = createdMedicines.find(m => m.brandName === 'Dolo 650');
  const augMed = createdMedicines.find(m => m.brandName === 'Augmentin 625 Duo');
  const chengannurTestPharmacy = createdPharmacies[0];

  await prisma.order.create({
    data: {
      orderNumber: 'MF-202609-001',
      userId: patient.id,
      pharmacyId: chengannurTestPharmacy.id,
      status: 'CONFIRMED',
      orderType: 'RESERVATION',
      totalAmount: 320.0,
      verificationPin: '4829',
      notes: 'Test order — Prescription verified. Customer will pick up.',
      prescriptionId: samplePrescription.id,
      items: {
        create: [
          { medicineId: doloMed.id, quantity: 2, unitPrice: 35.0, subtotal: 70.0 },
          { medicineId: augMed.id, quantity: 1, unitPrice: 250.0, subtotal: 250.0 }
        ]
      },
      statusHistory: {
        create: [
          { status: 'PENDING', comment: 'Order placed by patient Rohan Sharma' },
          { status: 'CONFIRMED', comment: 'Stock verified and reserved by test pharmacy' }
        ]
      }
    }
  });

  // 9. Sample Assisted Delivery Order — references third test pharmacy (Alappuzha area)
  const asthalinMed = createdMedicines.find(m => m.brandName === 'Asthalin Inhaler');
  const alappuzhaTestPharmacy = createdPharmacies[2];

  await prisma.order.create({
    data: {
      orderNumber: 'MF-202609-002',
      userId: patient.id,
      pharmacyId: alappuzhaTestPharmacy.id,
      status: 'PENDING',
      orderType: 'ASSISTED_DELIVERY',
      totalAmount: 185.0,
      verificationPin: '9134',
      notes: 'Test order — Elderly patient needing emergency inhaler dispatch.',
      items: {
        create: [{ medicineId: asthalinMed.id, quantity: 1, unitPrice: 185.0, subtotal: 185.0 }]
      },
      assistantTask: {
        create: {
          status: 'AVAILABLE',
          acceptedAt: null,
          deliveryAddress: 'Chengannur Town Area, Alappuzha District, Kerala 689121 [TEST ADDRESS]',
          deliveryNotes: 'Test delivery — call upon arrival.',
          handoverPin: '9134'
        }
      },
      statusHistory: {
        create: [{ status: 'PENDING', comment: 'Test assisted delivery order' }]
      }
    }
  });

  // 10. Sample Notifications
  await prisma.notification.create({
    data: {
      userId: patient.id,
      title: 'Welcome to MediFind AI!',
      message: 'Your account is ready. Search medicines, upload prescriptions, or find emergency pharmacies in the Chengannur / Alappuzha, Kerala network.',
      type: 'INFO'
    }
  });

  await prisma.notification.create({
    data: {
      userId: patient.id,
      title: 'Order Confirmed: #MF-202609-001',
      message: 'Test pharmacy (Chengannur area) confirmed your reservation. Pickup PIN: 4829. Note: This is a test record.',
      type: 'ORDER_STATUS',
      linkUrl: '/orders'
    }
  });

  // 11. Run Phase 6.1H Authoritative Real Pharmacy Import
  const { validateAndImport } = require('./import_real_pharmacies');
  await validateAndImport();

  console.log('');
  console.log('🎉 MediFind AI Seed Data complete!');
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('PHARMACY DATA CLASSIFICATION REPORT');
  console.log('════════════════════════════════════════════════════════');
  console.log('  Max Care Pharmacy (Chengannur)         → PARTICIPATING REAL PHARMACY');
  console.log('  Karuna Medicals (Chengannur)           → PARTICIPATING REAL PHARMACY');
  console.log('  Historical Test Fixtures               → DEACTIVATED / CLEARED');
  console.log('════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
