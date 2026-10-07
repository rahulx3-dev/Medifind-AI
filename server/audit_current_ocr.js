const { runOCR, processPrescriptionText } = require('./src/utils/ocrEngine');
const prisma = require('./src/prisma');

async function testCurrent() {
  const images = [
    './uploads/prescriptions/rx-1790600878179-512868392.jpg',
    './uploads/prescriptions/rx-1790600707032-882494267.jpg',
    './uploads/prescriptions/rx-1790497738763-331964841.jpg'
  ];
  const catalog = await prisma.medicine.findMany();
  for (const img of images) {
    console.log('\n======================================================');
    console.log('=== TESTING IMAGE:', img);
    console.log('======================================================');
    const start = Date.now();
    const res = await runOCR(img);
    const elapsed = Date.now() - start;
    console.log('OCR success:', res.success, 'conf:', res.confidence, 'words:', res.wordCount, 'time:', elapsed + 'ms');
    console.log('--- RAW OCR TEXT START ---');
    console.log(res.rawText);
    console.log('--- RAW OCR TEXT END ---');
    const detected = processPrescriptionText(res.rawText, catalog);
    console.log('Detected count:', detected.length);
    detected.forEach((item, idx) => {
      console.log(`[${idx + 1}] raw: "${item.rawName}" -> extractedName: "${item.medicineName}", matched: "${item.matchedMedicineName}", status: ${item.status}, conf: ${item.confidence}, needsMapping: ${item.needsMapping}`);
    });
  }
  await prisma.$disconnect();
}
testCurrent().catch(console.error);
