const fs = require('fs');
const path = require('path');
const { runOCR, processPrescriptionText, matchMedicineNameAgainstCatalog } = require('./src/utils/ocrEngine');
const { createSafeTestPrismaClient } = require('./src/utils/testDatabaseGuard');
const prisma = createSafeTestPrismaClient();

const USER_IMAGES = [
  {
    id: 1,
    name: 'Image 1: Slanted Lined Paper (Dolo / Pantoprazole / Cefixime)',
    path: 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\a12d4c75-ebc5-4d29-91f2-c4056e41fd9b\\.user_uploaded\\media_1790779837204.jpg',
    expected: ['Dolo', 'Pantoprazole', 'Cefixime']
  },
  {
    id: 2,
    name: 'Image 2: Horizontal Lined Paper (Dolo 650 / Pantoprazole 40 / Paracetamol 650 / Cefixime)',
    path: 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\a12d4c75-ebc5-4d29-91f2-c4056e41fd9b\\.user_uploaded\\media_1790779837212.jpg',
    expected: ['Dolo 650', 'Pantoprazole 40', 'Paracetamol 650', 'Cefixime']
  },
  {
    id: 3,
    name: 'Image 3: Plain Paper Cursive (Dolo / Brufen / Pantoprazole)',
    path: 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\a12d4c75-ebc5-4d29-91f2-c4056e41fd9b\\.user_uploaded\\media_1790780168071.jpg',
    expected: ['Dolo', 'Brufen', 'Pantoprazole']
  }
];

async function run() {
  console.log('Loading 50-medicine catalogue from DB...');
  const catalogue = await prisma.medicine.findMany();
  console.log(`Loaded ${catalogue.length} medicines.\n`);

  for (const img of USER_IMAGES) {
    console.log('='.repeat(70));
    console.log(`TESTING: ${img.name}`);
    console.log(`File: ${img.path}`);
    console.log(`Exists: ${fs.existsSync(img.path)}`);
    console.log(`Expected medicines: ${img.expected.join(', ')}`);
    console.log('='.repeat(70));

    if (!fs.existsSync(img.path)) {
      console.log('FILE NOT FOUND!');
      continue;
    }

    const startTime = Date.now();
    try {
      const ocrResult = await runOCR(img.path);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`\n[OCR Result] Time: ${elapsed}s | Success: ${ocrResult.success} | Confidence: ${ocrResult.confidence}%`);
      console.log('--- RAW OCR TEXT ---');
      console.log(ocrResult.rawText || '(No text detected)');
      console.log('--- END RAW OCR TEXT ---\n');

      console.log('Processing extraction against catalogue...');
      const detectedMedicines = processPrescriptionText(ocrResult.rawText, catalogue);
      
      console.log(`Detected items count: ${detectedMedicines.length}`);
      detectedMedicines.forEach((dm, i) => {
        console.log(`\n  [${i + 1}] Raw extracted: "${dm.rawName}"`);
        console.log(`      Clean Name:   "${dm.medicineName}"`);
        console.log(`      Strength:     "${dm.strength || 'N/A'}"`);
        console.log(`      ExtractedQty: ${dm.extractedQuantity || 'N/A'}`);
        console.log(`      Matched Drug: ${dm.matchedMedicine ? dm.matchedMedicine.brandName : 'None'}`);
        console.log(`      Confidence:   ${Math.round((dm.confidence || 0) * 100)}%`);
        console.log(`      NeedsMapping: ${dm.needsMapping}`);
        console.log(`      Status:       ${dm.status}`);
        console.log(`      Evidence:     ${dm.evidenceSummary}`);
        if (dm.allMatches && dm.allMatches.length > 0) {
          console.log(`      Candidates:   ${dm.allMatches.map(c => `${c.medicine.brandName} (${Math.round(c.confidence * 100)}%)`).join(', ')}`);
        }
      });

    } catch (err) {
      console.error(`Error processing image ${img.id}:`, err);
    }
  }

  await prisma.$disconnect();
}

run();
