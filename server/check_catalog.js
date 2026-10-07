const fs = require('fs');
const path = require('path');
const prisma = require('./src/prisma');

// Load seedData to verify catalog
const seedData = require('./prisma/seedData');
console.log('SeedData medicines count:', seedData.length);

async function testAll() {
  const catalog = await prisma.medicine.findMany();
  console.log('DB catalog count:', catalog.length);
  await prisma.$disconnect();
}

testAll().catch(console.error);
