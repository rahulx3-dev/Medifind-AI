const path = require('path');
const fs = require('fs');

async function testUploadEndpoint() {
  const API_BASE = 'http://localhost:5000/api';

  // Step 1: Login
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@medifind.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.token) {
    console.error('Login failed:', loginData);
    return;
  }
  const token = loginData.token;
  console.log('Logged in successfully as patient.');

  // Step 2: Upload real prescription image
  const imgPath = path.join(__dirname, 'uploads', 'prescriptions', 'rx-1790497738763-331964841.jpg');
  if (!fs.existsSync(imgPath)) {
    console.error('Image file not found:', imgPath);
    return;
  }

  const formData = new FormData();
  const fileBlob = new Blob([fs.readFileSync(imgPath)], { type: 'image/jpeg' });
  formData.append('prescriptionImage', fileBlob, 'rx-1790497738763-331964841.jpg');

  const uploadRes = await fetch(`${API_BASE}/prescriptions/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  const uploadData = await uploadRes.json();
  console.log('\n=== UPLOAD API RESPONSE ===');
  console.log('Success:', uploadData.success);
  console.log('Message:', uploadData.message);
  console.log('OCR Confidence:', uploadData.ocrConfidence);
  console.log('Raw OCR Text:');
  console.log(uploadData.prescription?.ocrRawText);
  console.log('\nDetected Medicines in Response:');
  (uploadData.prescription?.detectedMedicines || []).forEach((m, i) => {
    console.log(`[${i+1}] rawName: "${m.rawName}", name: "${m.medicineName || m.rawName}", matchedName: "${m.matchedMedicineName || 'null'}", needsMapping: ${m.needsMapping}, qty: ${m.quantity}, extractedQty: ${m.extractedQuantity}`);
  });
}

testUploadEndpoint().catch(console.error);
