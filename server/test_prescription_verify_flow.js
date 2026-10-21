/**
 * Test Prescription Verification & Quantity Flow
 */
const BASE_URL = 'http://localhost:5000/api';

async function run() {
  console.log('\n=== TESTING PRESCRIPTION VERIFICATION & QUANTITY FLOW ===\n');

  // 1. Login as patient
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@medifind.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('1. Patient login:', loginData.success ? 'SUCCESS' : 'FAILED');

  // 2. Fetch sample prescription ID
  const samplesRes = await fetch(`${BASE_URL}/prescriptions/samples`);
  const samplesData = await samplesRes.json();
  const sampleId = samplesData.samples?.[0]?.id || 'sample-rx-1';

  const formData = new FormData();
  formData.append('sampleId', sampleId);

  const uploadRes = await fetch(`${BASE_URL}/prescriptions/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadData = await uploadRes.json();
  console.log('2. Prescription upload status:', uploadRes.status, 'success:', uploadData.success, uploadData.error || '');
  const rxId = uploadData.prescription?.id;
  const detected = uploadData.prescription?.detectedMedicines || [];
  console.log(`   Prescription ID: ${rxId}, Detected count: ${detected.length}`);

  detected.forEach(d => {
    console.log(`   - ${d.rawName || d.medicineName}: qty=${d.quantity}, extractedQty=${d.extractedQuantity}, mapped=${d.matchedMedicineName || 'unmapped'}`);
  });

  // 3. Verify prescription with mapped medicines (including manual/remapped items)
  const catalogueRes = await fetch(`${BASE_URL}/medicines/search`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const catalogueData = await catalogueRes.json();
  const doloMed = catalogueData.medicines?.find(m => m.brandName.includes('Dolo'));

  const itemsToVerify = detected.map(d => ({
    id: d.id,
    matchedMedicineId: d.matchedMedicineId || doloMed.id,
    matchedMedicineName: d.matchedMedicineName || doloMed.brandName,
    quantity: d.quantity || 5,
    dosage: d.dosage || '650mg',
    frequency: d.frequency || '1 TDS',
    duration: d.duration || '3 days',
    isConfirmed: true
  }));

  // Also simulate adding a new manual item with client-generated ID
  itemsToVerify.push({
    id: `manual-${Date.now()}`,
    matchedMedicineId: doloMed.id,
    matchedMedicineName: doloMed.brandName,
    quantity: 10,
    dosage: '650mg',
    frequency: 'Once daily',
    duration: '5 days',
    isConfirmed: true
  });

  console.log('\n3. Submitting verification with items (including client-generated manual item)...');
  const verifyRes = await fetch(`${BASE_URL}/prescriptions/${rxId}/verify`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items: itemsToVerify })
  });
  const verifyData = await verifyRes.json();
  console.log('   Verification response status:', verifyRes.status);
  console.log('   Verification success:', verifyData.success, verifyData.error || '');
  console.log('   Prescription verified status:', verifyData.prescription?.status);
  console.log('   Verified items count:', verifyData.prescription?.detectedMedicines?.length);

  if (verifyRes.status === 200 && verifyData.success) {
    console.log('\n✅ PASS: Verification succeeded without getting stuck on manual/client items!');
  } else {
    console.log('\n❌ FAIL: Verification failed!');
  }
}

run().catch(console.error);
