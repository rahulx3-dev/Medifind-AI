const { createWorker } = require('tesseract.js');
const prisma = require('./src/prisma');
const path = require('path');
const { Jimp } = require('jimp');

// Test running multi-pass OCR on both handwritten and printed prescriptions
async function runPrototype() {
  const catalog = await prisma.medicine.findMany();
  console.log('Catalogue loaded:', catalog.length, 'medicines.');

  const worker = await createWorker('eng', 1, { langPath: __dirname, logger: () => {} });

  const testImages = [
    { name: 'Handwritten 1', path: './uploads/prescriptions/rx-1790600878179-512868392.jpg' },
    { name: 'Printed Kerala CHC', path: './uploads/prescriptions/rx-1790497738763-331964841.jpg' }
  ];

  for (const item of testImages) {
    console.log(`\n======================================================`);
    console.log(`TESTING: ${item.name} (${item.path})`);
    console.log(`======================================================`);

    // Pass 1: PSM 6
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const resPsm6 = await worker.recognize(item.path, {}, { tsv: true });
    console.log('PSM 6 rawText:\n' + resPsm6.data.text.trim());
    console.log('PSM 6 confidence:', resPsm6.data.confidence);

    // Pass 2: PSM 4
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    const resPsm4 = await worker.recognize(item.path, {}, { tsv: true });
    console.log('PSM 4 rawText:\n' + resPsm4.data.text.trim().slice(0, 300) + '...');
    console.log('PSM 4 confidence:', resPsm4.data.confidence);
  }

  await worker.terminate();
  await prisma.$disconnect();
}

runPrototype().catch(console.error);
