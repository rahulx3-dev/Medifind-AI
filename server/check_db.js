const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Find inventory records at real pharmacies with non-null stock or price
  const nonNull = await p.inventory.findMany({
    where: {
      pharmacy: { isVerified: true, verificationStatus: 'VERIFIED' },
      OR: [
        { stock: { not: null } },
        { price: { not: null } }
      ]
    },
    include: {
      medicine: { select: { brandName: true } },
      pharmacy: { select: { name: true } }
    }
  });

  console.log('Non-null stock/price inventory at real pharmacies:', nonNull.length);
  nonNull.forEach(i => console.log(` - ${i.pharmacy.name} | ${i.medicine.brandName} | stock=${i.stock} | price=${i.price}`));
}

main().catch(console.error).finally(() => p.$disconnect());
