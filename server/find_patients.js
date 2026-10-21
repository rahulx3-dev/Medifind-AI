const { createSafeTestPrismaClient } = require('./src/utils/testDatabaseGuard');
const prisma = createSafeTestPrismaClient();
prisma.user.findMany({ 
  where: { role: 'PATIENT', email: { not: { contains: '_test_' } } }, 
  select: { email: true, name: true, id: true }, 
  take: 5 
}).then(u => { 
  console.log('SEEDED PATIENTS:', JSON.stringify(u, null, 2)); 
  return prisma.$disconnect(); 
});
