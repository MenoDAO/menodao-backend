import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPaymentFrequencies() {
  console.log('=== Checking Payment Frequencies ===\n');

  const allSubs = await prisma.subscription.findMany({
    select: {
      id: true,
      tier: true,
      paymentFrequency: true,
      isActive: true,
      member: {
        select: {
          phoneNumber: true,
        },
      },
    },
  });

  console.log(`Total subscriptions: ${allSubs.length}\n`);

  const byFrequency = allSubs.reduce(
    (acc, sub) => {
      const freq = sub.paymentFrequency || 'NULL';
      acc[freq] = (acc[freq] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log('Breakdown by frequency:');
  Object.entries(byFrequency).forEach(([freq, count]) => {
    console.log(`  ${freq}: ${count}`);
  });

  console.log('\nAll subscriptions:');
  allSubs.forEach((sub) => {
    console.log(
      `  ${sub.member.phoneNumber}: ${sub.tier} - ${sub.paymentFrequency} (${sub.isActive ? 'Active' : 'Inactive'})`,
    );
  });

  await prisma.$disconnect();
}

checkPaymentFrequencies().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
