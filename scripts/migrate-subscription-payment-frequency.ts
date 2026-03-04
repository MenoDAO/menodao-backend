/**
 * Migration Script: Update Subscription Payment Frequency and Claim Limits
 *
 * This script migrates existing subscriptions to include:
 * 1. Payment frequency (defaults to MONTHLY)
 * 2. Correct annual cap limits based on tier
 *
 * The script is idempotent - safe to run multiple times.
 */

import { PrismaClient, PackageTier, PaymentFrequency } from '@prisma/client';

const prisma = new PrismaClient();

// Tier-based claim limits (in KES)
const TIER_LIMITS = {
  [PackageTier.BRONZE]: 6000,
  [PackageTier.SILVER]: 10000,
  [PackageTier.GOLD]: 15000,
};

async function migrateSubscriptions() {
  console.log('Starting subscription migration...\n');

  try {
    // Get all subscriptions
    const subscriptions = await prisma.subscription.findMany({
      select: {
        id: true,
        tier: true,
        paymentFrequency: true,
        annualCapLimit: true,
        member: {
          select: {
            id: true,
            phoneNumber: true,
            fullName: true,
          },
        },
      },
    });

    console.log(`Found ${subscriptions.length} subscriptions to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ subscriptionId: string; error: string }> = [];

    for (const subscription of subscriptions) {
      try {
        const updates: any = {};
        let needsUpdate = false;

        // Check if payment frequency needs to be set
        if (!subscription.paymentFrequency) {
          updates.paymentFrequency = PaymentFrequency.MONTHLY;
          needsUpdate = true;
        }

        // Check if annual cap limit needs to be updated
        const correctLimit = TIER_LIMITS[subscription.tier];
        if (subscription.annualCapLimit !== correctLimit) {
          updates.annualCapLimit = correctLimit;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: updates,
          });

          console.log(`✓ Updated subscription ${subscription.id}`);
          console.log(
            `  Member: ${subscription.member.fullName || 'N/A'} (${subscription.member.phoneNumber})`,
          );
          console.log(`  Tier: ${subscription.tier}`);
          if (updates.paymentFrequency) {
            console.log(`  Set payment frequency: ${updates.paymentFrequency}`);
          }
          if (updates.annualCapLimit) {
            console.log(
              `  Updated cap limit: ${subscription.annualCapLimit} → ${updates.annualCapLimit}`,
            );
          }
          console.log('');

          updatedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        errors.push({
          subscriptionId: subscription.id,
          error: errorMessage,
        });
        console.error(
          `✗ Error updating subscription ${subscription.id}: ${errorMessage}\n`,
        );
      }
    }

    // Summary
    console.log('\n=== Migration Summary ===');
    console.log(`Total subscriptions: ${subscriptions.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (already correct): ${skippedCount}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n=== Errors ===');
      errors.forEach(({ subscriptionId, error }) => {
        console.log(`Subscription ${subscriptionId}: ${error}`);
      });
    }

    // Validation
    console.log('\n=== Validation ===');
    const validationResults = await prisma.subscription.groupBy({
      by: ['tier', 'paymentFrequency', 'annualCapLimit'],
      _count: true,
    });

    console.log('Current subscription distribution:');
    validationResults.forEach((result) => {
      console.log(
        `  ${result.tier} | ${result.paymentFrequency} | Limit: ${result.annualCapLimit} | Count: ${result._count}`,
      );
    });

    // Check for any subscriptions with incorrect limits
    const incorrectLimits = await prisma.subscription.findMany({
      where: {
        OR: [
          { tier: PackageTier.BRONZE, annualCapLimit: { not: 6000 } },
          { tier: PackageTier.SILVER, annualCapLimit: { not: 10000 } },
          { tier: PackageTier.GOLD, annualCapLimit: { not: 15000 } },
        ],
      },
      select: {
        id: true,
        tier: true,
        annualCapLimit: true,
      },
    });

    if (incorrectLimits.length > 0) {
      console.log(
        `\n⚠️  Warning: ${incorrectLimits.length} subscriptions still have incorrect limits:`,
      );
      incorrectLimits.forEach((sub) => {
        console.log(
          `  ${sub.id}: ${sub.tier} has limit ${sub.annualCapLimit} (expected ${TIER_LIMITS[sub.tier]})`,
        );
      });
    } else {
      console.log('\n✓ All subscriptions have correct claim limits');
    }

    console.log('\n✓ Migration completed successfully');
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Rollback function (if needed)
async function rollback() {
  console.log('Rolling back migration...\n');

  try {
    // This would reset all subscriptions to default values
    // Use with caution!
    const result = await prisma.subscription.updateMany({
      data: {
        paymentFrequency: PaymentFrequency.MONTHLY,
        annualCapLimit: 6000,
      },
    });

    console.log(`✓ Rolled back ${result.count} subscriptions`);
  } catch (error) {
    console.error('✗ Rollback failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// CLI interface
const command = process.argv[2];

if (command === 'rollback') {
  rollback().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  migrateSubscriptions().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
