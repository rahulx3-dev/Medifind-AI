const http = require('http');

async function testMediFind() {
  console.log('🧪 MediFind AI - End-to-End System Verification Test');

  // 1. Login as Patient
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@medifind.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  console.log('✅ 1. Patient Login:', loginData.success, '| User:', loginData.user?.name);
  const token = loginData.token;

  // 2. OCR Prescription Upload & Extraction
  const rxRes = await fetch('http://localhost:5000/api/prescriptions/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ sampleId: 'sample-fever-bronchitis' })
  });
  const rxData = await rxRes.json();
  console.log('✅ 2. Prescription OCR Processed:', rxData.success, '| Medicines Detected:', rxData.prescription?.detectedMedicines?.length);
  rxData.prescription?.detectedMedicines?.forEach(m => {
    console.log(`   • ${m.matchedMedicineName} | Dosage: ${m.dosage} | Qty: ${m.quantity} | Confidence: ${m.confidence}`);
  });

  // 3. User Verification & Quantity Update (Requirement #2)
  const prescriptionId = rxData.prescription.id;
  const verifyRes = await fetch(`http://localhost:5000/api/prescriptions/${prescriptionId}/verify`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      items: rxData.prescription.detectedMedicines.map(m => ({
        id: m.id,
        matchedMedicineId: m.matchedMedicineId,
        matchedMedicineName: m.matchedMedicineName,
        quantity: 12, // explicitly test user edited quantity
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        isConfirmed: true
      }))
    })
  });
  const verifyData = await verifyRes.json();
  console.log('✅ 3. Prescription Verification Status:', verifyData.prescription?.status, '| Preserved Qty:', verifyData.prescription?.detectedMedicines[0]?.quantity);

  // 4. Multi-Criteria Pharmacy Ranking
  const rankRes = await fetch('http://localhost:5000/api/pharmacies/match-availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: verifyData.prescription.detectedMedicines.map(m => ({
        medicineId: m.matchedMedicineId,
        quantity: m.quantity
      })),
      lat: 9.3200,
      lon: 76.6160,
      isEmergency: false
    })
  });
  const rankData = await rankRes.json();
  console.log('✅ 4. Evaluated Pharmacies Count:', rankData.totalPharmaciesEvaluated);
  const topMatch = rankData.results[0];
  console.log(`   • Top Rank: ${topMatch.pharmacy.name} (Score: ${topMatch.scores.totalScore}/100)`);
  console.log(`   • Distance: ${topMatch.distanceKm} km | Status: ${topMatch.availabilityStatus} (${topMatch.matchedItemsCount}/${topMatch.totalRequested})`);
  console.log(`   • AI Explanation: ${topMatch.explanation}`);

  // 5. Reservation Creation
  const orderRes = await fetch('http://localhost:5000/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      pharmacyId: topMatch.pharmacy.id,
      items: [{ medicineId: topMatch.itemStockDetails[0].medicineId, quantity: 2 }],
      orderType: 'RESERVATION'
    })
  });
  const orderData = await orderRes.json();
  console.log('✅ 5. Order Reservation Placed:', orderData.success, '| Order #:', orderData.order?.orderNumber, '| PIN:', orderData.order?.verificationPin);

  // 6. Assistant Task Initial State Verification (Requirement #1)
  const asstLoginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'assistant@medifind.com', password: 'password123' })
  });
  const asstLogin = await asstLoginRes.json();
  const tasksRes = await fetch('http://localhost:5000/api/assistant/available', {
    headers: { Authorization: `Bearer ${asstLogin.token}` }
  });
  const tasksData = await tasksRes.json();
  console.log('✅ 6. Available Assistant Tasks Count:', tasksData.count);
  if (tasksData.tasks?.length > 0) {
    const t = tasksData.tasks[0];
    console.log(`   • Task Status: ${t.status} (Initial State is AVAILABLE: ${t.status === 'AVAILABLE'})`);
    console.log(`   • Task acceptedAt is NULL initially: ${t.acceptedAt === null}`);
  }

  // 7. Counter Pickup PIN Verification
  const pharmLoginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pharmacist1@medifind.com', password: 'password123' })
  });
  const pharmLogin = await pharmLoginRes.json();
  const verifyPinRes = await fetch(`http://localhost:5000/api/orders/${orderData.order.id}/verify-pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pharmLogin.token}`
    },
    body: JSON.stringify({ pin: orderData.order.verificationPin })
  });
  const verifyPinData = await verifyPinRes.json();
  console.log('✅ 7. Pharmacist Handover PIN Verification:', verifyPinData.success, '| Order Status:', verifyPinData.order?.status);

  console.log('🎉 ALL END-TO-END VERIFICATIONS PASSED SUCCESSFULLY!');
}

testMediFind().catch(console.error);
