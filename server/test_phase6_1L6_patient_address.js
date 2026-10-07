/**
 * Test Suite: Phase 6.1L.6 — Patient Address System & Capabilities
 *
 * Verification Areas:
 * 1. Patient address CRUD & validation
 * 2. Ownership & role security (owner-only access, assistant route gating)
 * 3. Address selection & default marking
 * 4. Physical vs non-address service behavior in checkout
 * 5. Pharmacy delivery compatibility (deliveryAddress + addressId)
 * 6. Assistant privacy gating (unassigned tasks hide address, assigned tasks reveal address)
 * 7. Frontend UI source verification in CheckoutPage
 */

const fs = require('fs');
const path = require('path');
const prisma = require('./src/prisma');
const addressController = require('./src/controllers/addressController');
const checkoutController = require('./src/controllers/checkoutController');
const assistantController = require('./src/controllers/assistantController');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
}

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

async function run() {
  console.log('\n=== Phase 6.1L.6 Patient Address Test Suite ===\n');

  try {
    // -------------------------------------------------------------
    // Setup Test Users & Pharmacy
    // -------------------------------------------------------------
    const patientA = await prisma.user.create({
      data: {
        name: 'Patient Alappuzha A',
        email: `patient_a_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT',
        phone: '+919876543201'
      }
    });

    const patientB = await prisma.user.create({
      data: {
        name: 'Patient Kottayam B',
        email: `patient_b_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT',
        phone: '+919876543202'
      }
    });

    const assistantUser = await prisma.user.create({
      data: {
        name: 'Assistant Ramesh',
        email: `ramesh_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'ASSISTANT',
        phone: '+919876543203'
      }
    });
    await prisma.assistantProfile.create({
      data: {
        userId: assistantUser.id,
        isActive: true,
        isAvailable: true,
        capabilities: 'MEDICINE_DELIVERY,MEDICINE_COLLECTION,DIGITAL_ASSISTANCE'
      }
    });

    let pharmacy = await prisma.pharmacy.findFirst({
      where: { name: 'Max Care Pharmacy' }
    });
    if (!pharmacy) {
      pharmacy = await prisma.pharmacy.findFirst({
        where: { isVerified: true, verificationStatus: 'VERIFIED' }
      });
    }

    // -------------------------------------------------------------
    // 1. Patient Address CRUD & Validation
    // -------------------------------------------------------------
    console.log('--- 1. Patient Address CRUD & Field Validation ---');

    // Validation: Empty / too short addressLine1 rejected
    const reqInvalidAddr = {
      user: patientA,
      body: {
        addressLine1: 'xyz',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121'
      }
    };
    const resInvalidAddr = createMockRes();
    await addressController.createAddress(reqInvalidAddr, resInvalidAddr);
    check('Short address rejected with 400', resInvalidAddr.statusCode === 400);

    // Validation: Blocked placeholder address rejected
    const reqBlockedAddr = {
      user: patientA,
      body: {
        addressLine1: 'This is a test address for test orders',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121'
      }
    };
    const resBlockedAddr = createMockRes();
    await addressController.createAddress(reqBlockedAddr, resBlockedAddr);
    check('Placeholder / test address rejected with 400',
      resBlockedAddr.statusCode === 400 && resBlockedAddr.data.error.includes('Placeholder or test addresses'));

    // Create valid first address (should auto-become default)
    const reqCreateA1 = {
      user: patientA,
      body: {
        label: 'Home',
        recipientName: 'Patient Alappuzha A',
        phone: '+919876543201',
        addressLine1: 'Puthenveettil House, Market Road',
        addressLine2: 'Ward 4',
        landmark: 'Near Govt Hospital',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121'
      }
    };
    const resCreateA1 = createMockRes();
    await addressController.createAddress(reqCreateA1, resCreateA1);
    check('Valid address created with 201', resCreateA1.statusCode === 201 && resCreateA1.data.success);
    const addressA1 = resCreateA1.data.address;
    check('First address auto-marked as default', addressA1.isDefault === true);
    check('Formatted address generated', resCreateA1.data.formattedAddress.includes('Chengannur, Kerala - 689121'));

    // Create second address for patientA
    const reqCreateA2 = {
      user: patientA,
      body: {
        label: 'Work',
        addressLine1: 'IT Square Tech Park, Bypass Road',
        city: 'Chengannur',
        state: 'Kerala',
        postalCode: '689121',
        isDefault: false
      }
    };
    const resCreateA2 = createMockRes();
    await addressController.createAddress(reqCreateA2, resCreateA2);
    const addressA2 = resCreateA2.data.address;
    check('Second address created without overwriting default', addressA2.isDefault === false);

    // Create address for patientB
    const reqCreateB1 = {
      user: patientB,
      body: {
        label: 'Home',
        addressLine1: 'Kottayam Residency, Baker Hill',
        city: 'Kottayam',
        state: 'Kerala',
        postalCode: '686001'
      }
    };
    const resCreateB1 = createMockRes();
    await addressController.createAddress(reqCreateB1, resCreateB1);
    const addressB1 = resCreateB1.data.address;

    // List addresses for patientA
    const reqListA = { user: patientA };
    const resListA = createMockRes();
    await addressController.getAddresses(reqListA, resListA);
    check('Patient A retrieves only their own addresses (count = 2)',
      resListA.statusCode === 200 && resListA.data.addresses.length === 2);
    check('Patient A addresses do not include Patient B address',
      !resListA.data.addresses.some(a => a.id === addressB1.id));

    // Update addressA2
    const reqUpdateA2 = {
      user: patientA,
      params: { id: addressA2.id },
      body: { landmark: 'Opposite Civil Station' }
    };
    const resUpdateA2 = createMockRes();
    await addressController.updateAddress(reqUpdateA2, resUpdateA2);
    check('Patient A updates own address landmark',
      resUpdateA2.statusCode === 200 && resUpdateA2.data.address.landmark === 'Opposite Civil Station');

    // -------------------------------------------------------------
    // 2. Ownership & Security Enforcements
    // -------------------------------------------------------------
    console.log('\n--- 2. Ownership & Security Authorization ---');

    // Patient A tries to read Patient B's address
    const reqGetBfromA = {
      user: patientA,
      params: { id: addressB1.id }
    };
    const resGetBfromA = createMockRes();
    await addressController.getAddressById(reqGetBfromA, resGetBfromA);
    check('Cross-patient address read blocked with 403', resGetBfromA.statusCode === 403);

    // Patient A tries to update Patient B's address
    const reqUpdateBfromA = {
      user: patientA,
      params: { id: addressB1.id },
      body: { landmark: 'Hacked Landmark' }
    };
    const resUpdateBfromA = createMockRes();
    await addressController.updateAddress(reqUpdateBfromA, resUpdateBfromA);
    check('Cross-patient address update blocked with 403', resUpdateBfromA.statusCode === 403);

    // Patient A tries to delete Patient B's address
    const reqDeleteBfromA = {
      user: patientA,
      params: { id: addressB1.id }
    };
    const resDeleteBfromA = createMockRes();
    await addressController.deleteAddress(reqDeleteBfromA, resDeleteBfromA);
    check('Cross-patient address delete blocked with 403', resDeleteBfromA.statusCode === 403);

    // -------------------------------------------------------------
    // 3. Address Selection & Default Designation
    // -------------------------------------------------------------
    console.log('\n--- 3. Address Selection & Default Designation ---');

    // Switch default from addressA1 to addressA2
    const reqSetDefA2 = {
      user: patientA,
      params: { id: addressA2.id }
    };
    const resSetDefA2 = createMockRes();
    await addressController.setDefaultAddress(reqSetDefA2, resSetDefA2);
    check('Address A2 set as default', resSetDefA2.statusCode === 200 && resSetDefA2.data.address.isDefault === true);

    const recheckA1 = await prisma.patientAddress.findUnique({ where: { id: addressA1.id } });
    check('Previous default Address A1 isDefault toggled to false', recheckA1.isDefault === false);

    // -------------------------------------------------------------
    // 4. Physical vs Non-Address Services in Checkout
    // -------------------------------------------------------------
    console.log('\n--- 4. Physical vs Non-Address Services in Checkout ---');

    // Create confirmed orders for checkout testing
    const orderPhys = await prisma.order.create({
      data: {
        orderNumber: `MF-ORD-PHYS-${Date.now()}`,
        userId: patientA.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        totalAmount: 150.00
      }
    });

    // 4A: Physical service requires address: fails when no address provided
    const reqFulfillMissing = {
      user: patientA,
      params: { orderId: orderPhys.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        deliveryAddress: ''
      }
    };
    // Note: since patientA has default address A2, fallback will apply if deliveryAddress is omitted,
    // so let's test with a patient who has NO addresses
    const patientNoAddr = await prisma.user.create({
      data: {
        name: 'Patient No Address',
        email: `noaddr_${Date.now()}@medifind.test`,
        password: 'hashedpassword',
        role: 'PATIENT'
      }
    });
    const orderNoAddr = await prisma.order.create({
      data: {
        orderNumber: `MF-ORD-NOADDR-${Date.now()}`,
        userId: patientNoAddr.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        orderType: 'RESERVATION',
        totalAmount: 100.00
      }
    });
    const reqFulfillNoAddr = {
      user: patientNoAddr,
      params: { orderId: orderNoAddr.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        assistantId: assistantUser.id
      }
    };
    const resFulfillNoAddr = createMockRes();
    await checkoutController.selectFulfillment(reqFulfillNoAddr, resFulfillNoAddr);
    check('Physical assistant service without address rejected with 400',
      resFulfillNoAddr.statusCode === 400 && resFulfillNoAddr.data.error.includes('service location address is required'));

    // 4B: Non-address service (DIGITAL_ASSISTANCE) succeeds without address
    const reqFulfillDigital = {
      user: patientNoAddr,
      params: { orderId: orderNoAddr.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'DIGITAL_ASSISTANCE',
        assistantId: assistantUser.id
      }
    };
    const resFulfillDigital = createMockRes();
    await checkoutController.selectFulfillment(reqFulfillDigital, resFulfillDigital);
    check('Non-address service (DIGITAL_ASSISTANCE) succeeds without address',
      resFulfillDigital.statusCode === 200 && resFulfillDigital.data.success);
    check('Non-address service has deliveryAddress = null',
      resFulfillDigital.data.deliveryAddress === null);

    // -------------------------------------------------------------
    // 5. Checkout Address Selection & Pharmacy Delivery Compatibility
    // -------------------------------------------------------------
    console.log('\n--- 5. Checkout Address Selection & Pharmacy Delivery ---');

    // 5A: Select fulfillment with explicit addressId
    const reqFulfillWithId = {
      user: patientA,
      params: { orderId: orderPhys.id },
      body: {
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_COLLECTION',
        addressId: addressA2.id,
        assistantId: assistantUser.id
      }
    };
    const resFulfillWithId = createMockRes();
    await checkoutController.selectFulfillment(reqFulfillWithId, resFulfillWithId);
    check('Fulfillment with addressId succeeds',
      resFulfillWithId.statusCode === 200 && resFulfillWithId.data.success);
    check('Order stores linked addressId',
      resFulfillWithId.data.addressId === addressA2.id);
    check('Order stores formatted deliveryAddress for backward compatibility',
      typeof resFulfillWithId.data.deliveryAddress === 'string' &&
      resFulfillWithId.data.deliveryAddress.includes('IT Square Tech Park'));

    // 5B: Patient A cannot use Patient B's addressId in checkout
    const reqFulfillCrossAddr = {
      user: patientA,
      params: { orderId: orderPhys.id },
      body: {
        fulfillmentType: 'DELIVERY',
        addressId: addressB1.id
      }
    };
    const resFulfillCrossAddr = createMockRes();
    await checkoutController.selectFulfillment(reqFulfillCrossAddr, resFulfillCrossAddr);
    check('Using another user addressId in checkout blocked with 403',
      resFulfillCrossAddr.statusCode === 403);

    // 5C: Standard Pharmacy DELIVERY with backward compatible string address
    await prisma.pharmacy.update({
      where: { id: pharmacy.id },
      data: { deliveryAvailable: true }
    });
    const reqFulfillStandardDelivery = {
      user: patientA,
      params: { orderId: orderPhys.id },
      body: {
        fulfillmentType: 'DELIVERY',
        deliveryAddress: 'Hill View Villa, Mavelikkara Road, Chengannur 689121'
      }
    };
    const resFulfillStandardDelivery = createMockRes();
    await checkoutController.selectFulfillment(reqFulfillStandardDelivery, resFulfillStandardDelivery);
    check('Standard pharmacy delivery with custom address string succeeds',
      resFulfillStandardDelivery.statusCode === 200 &&
      resFulfillStandardDelivery.data.deliveryAddress.includes('Hill View Villa'));
    await prisma.pharmacy.update({
      where: { id: pharmacy.id },
      data: { deliveryAvailable: false }
    });

    // -------------------------------------------------------------
    // 6. Assistant Address Privacy Gating
    // -------------------------------------------------------------
    console.log('\n--- 6. Assistant Address Privacy Gating ---');

    // Create an unassigned assistant task with a delivery address
    const orderWithPrivacy = await prisma.order.create({
      data: {
        orderNumber: `MF-ORD-PRIV-${Date.now()}`,
        userId: patientA.id,
        pharmacyId: pharmacy.id,
        status: 'CONFIRMED',
        fulfillmentType: 'ASSISTANT_DELIVERY',
        assistantServiceType: 'MEDICINE_DELIVERY',
        deliveryAddress: 'Secret Residence, Private Lane, Chengannur',
        verificationPin: '4444'
      }
    });

    const taskPrivacy = await prisma.assistantTask.create({
      data: {
        orderId: orderWithPrivacy.id,
        status: 'AVAILABLE',
        serviceType: 'MEDICINE_DELIVERY',
        deliveryAddress: 'Secret Residence, Private Lane, Chengannur',
        handoverPin: '4444'
      }
    });

    // Setup assistant Ramesh with MEDICINE_DELIVERY capability
    await prisma.assistantProfile.upsert({
      where: { userId: assistantUser.id },
      update: { capabilities: 'MEDICINE_DELIVERY', isActive: true, isAvailable: true },
      create: { userId: assistantUser.id, capabilities: 'MEDICINE_DELIVERY', isActive: true, isAvailable: true }
    });

    // 6A: In available tasks list (unassigned), address must NOT be exposed
    const reqAvailTasks = { user: assistantUser };
    const resAvailTasks = createMockRes();
    await assistantController.getAvailableTasks(reqAvailTasks, resAvailTasks);

    const foundAvailable = resAvailTasks.data.tasks.find(t => t.id === taskPrivacy.id);
    check('Task found in available list', !!foundAvailable);
    check('Unassigned task does NOT expose deliveryAddress',
      foundAvailable && foundAvailable.deliveryAddress === undefined);
    check('Unassigned task order does NOT expose deliveryAddress',
      foundAvailable && (!foundAvailable.order || foundAvailable.order.deliveryAddress === undefined));

    // 6B: Once assigned/accepted, deliveryAddress IS revealed
    const reqAccept = {
      params: { id: taskPrivacy.id },
      user: assistantUser
    };
    const resAccept = createMockRes();
    await assistantController.acceptTask(reqAccept, resAccept);
    check('Assistant accepts task', resAccept.statusCode === 200);
    check('Accepted task response reveals deliveryAddress to assigned assistant',
      resAccept.data.task.order &&
      resAccept.data.task.order.deliveryAddress === 'Secret Residence, Private Lane, Chengannur');

    // 6C: In getMyTasks (assigned to assistant), deliveryAddress is visible
    const reqMyTasks = { user: assistantUser };
    const resMyTasks = createMockRes();
    await assistantController.getMyTasks(reqMyTasks, resMyTasks);
    const foundMyTask = resMyTasks.data.tasks.find(t => t.id === taskPrivacy.id);
    check('getMyTasks reveals deliveryAddress to assigned assistant',
      foundMyTask && foundMyTask.order &&
      foundMyTask.order.deliveryAddress === 'Secret Residence, Private Lane, Chengannur');

    // -------------------------------------------------------------
    // 7. Frontend Integration Verification in CheckoutPage
    // -------------------------------------------------------------
    console.log('\n--- 7. Frontend Source Verification (CheckoutPage) ---');
    const checkoutSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/CheckoutPage.jsx'), 'utf-8');

    check('CheckoutPage declares savedAddresses state',
      checkoutSrc.includes('const [savedAddresses, setSavedAddresses] = useState'));
    check('CheckoutPage declares selectedAddressId state',
      checkoutSrc.includes('const [selectedAddressId, setSelectedAddressId] = useState'));
    check('CheckoutPage fetches patient addresses from /api/addresses',
      checkoutSrc.includes("fetch('/api/addresses'"));
    check('CheckoutPage submits addressId in fulfillment payload',
      checkoutSrc.includes('addressId: selectedAddressId'));
    check('CheckoutPage renders saved address selector cards',
      checkoutSrc.includes('Saved Addresses Radio List') || checkoutSrc.includes('handleSelectSaved'));
    check('CheckoutPage allows adding new address inline',
      checkoutSrc.includes('handleSaveNewAddress'));

    // -------------------------------------------------------------
    // Cleanup test artifacts
    // -------------------------------------------------------------
    try {
      const testOrderIds = [orderPhys?.id, orderNoAddr?.id, orderWithPrivacy?.id].filter(Boolean);
      if (testOrderIds.length > 0) {
        await prisma.assistantTask.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: testOrderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
      }
      const testUserIds = [patientA?.id, patientB?.id, assistantUser?.id, otherUser?.id].filter(Boolean);
      if (testUserIds.length > 0) {
        await prisma.patientAddress.deleteMany({ where: { userId: { in: testUserIds } } });
        await prisma.assistantProfile.deleteMany({ where: { userId: { in: testUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
      }
    } catch (cleanupErr) {
      console.warn('Non-fatal test cleanup warning:', cleanupErr.message);
    }

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n========================================`);
    console.log(`Phase 6.1L.6 Tests Completed: ${pass} passed, ${fail} failed.`);
    console.log(`========================================\n`);

    if (fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error in test_phase6_1L6_patient_address:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
