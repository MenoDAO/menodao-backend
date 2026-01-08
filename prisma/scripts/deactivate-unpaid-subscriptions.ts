/**
 * Script to deactivate all subscriptions that don't have a completed payment.
 * This ensures only paid subscriptions remain active.
 * 
 * Run with: npx ts-node prisma/scripts/deactivate-unpaid-subscriptions.ts
 */

import { PrismaClient, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting subscription deactivation script...\n');

  // Get all active subscriptions
  const activeSubscriptions = await prisma.subscription.findMany({
    where: { isActive: true },
    include: {
      member: {
        include: {
          contributions: {
            where: { status: PaymentStatus.COMPLETED },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  console.log(`Found ${activeSubscriptions.length} active subscriptions\n`);

  let deactivatedCount = 0;
  let keptActiveCount = 0;

  for (const subscription of activeSubscriptions) {
    const hasCompletedPayment = subscription.member.contributions.length > 0;

    if (!hasCompletedPayment) {
      // Deactivate subscription without completed payment
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { isActive: false },
      });
      console.log(
        `❌ Deactivated: ${subscription.member.phoneNumber} (${subscription.tier}) - No completed payment`,
      );
      deactivatedCount++;
    } else {
      console.log(
        `✓ Kept active: ${subscription.member.phoneNumber} (${subscription.tier}) - Has completed payment`,
      );
      keptActiveCount++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total active subscriptions: ${activeSubscriptions.length}`);
  console.log(`Deactivated (no payment): ${deactivatedCount}`);
  console.log(`Kept active (has payment): ${keptActiveCount}`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
