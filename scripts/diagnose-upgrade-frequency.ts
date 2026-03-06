import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseUpgradeFrequency() {
  console.log('=== Diagnosing Upgrade Frequency Issue ===\n');

  // Get all active subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: { isActive: true },
    include: {
      member: {
        select: {
          phoneNumber: true,
          fullName: true,
        },
      },
    },
  });

  console.log(`Found ${subscriptions.length} active subscriptions\n`);

  for (const sub of subscriptions) {
    console.log(
      `Member: ${sub.member.phoneNumber} (${sub.member.fullName || 'No name'})`,
    );
    console.log(`  Tier: ${sub.tier}`);
    console.log(`  Payment Frequency: ${sub.paymentFrequency}`);
    console.log(`  Monthly Amount: ${sub.monthlyAmount}`);
    console.log(`  Start Date: ${sub.subscriptionStartDate || sub.startDate}`);
    console.log('');

    // Simulate upgrade calculation
    if (sub.tier === 'BRONZE') {
      const newTier = 'SILVER';
      console.log(`  Simulating upgrade to ${newTier}:`);

      // Check what frequency is being used
      const frequency =
        sub.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly';
      console.log(`    Detected frequency: ${frequency}`);

      // Production prices
      const PRICES = {
        BRONZE: { monthly: 350, annual: 4200 },
        SILVER: { monthly: 550, annual: 6600 },
        GOLD: { monthly: 700, annual: 8400 },
      };

      const currentPrice = PRICES.BRONZE[frequency];
      const newPrice = PRICES.SILVER[frequency];
      const upgradeCost = newPrice - currentPrice;

      console.log(`    Current price (${frequency}): KES ${currentPrice}`);
      console.log(`    New price (${frequency}): KES ${newPrice}`);
      console.log(`    Upgrade cost: KES ${upgradeCost}`);
      console.log('');
    }
  }

  await prisma.$disconnect();
}

diagnoseUpgradeFrequency().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
