import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseUpgradeIssue() {
  const phoneNumber = process.argv[2] || '+254712345678';

  console.log(`\n=== Diagnosing Upgrade Issue for ${phoneNumber} ===\n`);

  // 1. Find the member
  const member = await prisma.member.findUnique({
    where: { phoneNumber },
    include: {
      subscription: true,
      contributions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!member) {
    console.log('❌ Member not found');
    process.exit(1);
  }

  console.log(`✅ Member found: ${member.id}`);
  console.log(`   Name: ${member.fullName}`);
  console.log(`   Phone: ${member.phoneNumber}`);
  console.log(`   Verified: ${member.isVerified}`);
  console.log();

  // 2. Check subscription
  if (!member.subscription) {
    console.log('❌ No subscription found');
    process.exit(1);
  }

  console.log(`📦 Current Subscription:`);
  console.log(`   Tier: ${member.subscription.tier}`);
  console.log(`   Monthly Amount: ${member.subscription.monthlyAmount}`);
  console.log(`   Annual Cap: ${member.subscription.annualCapLimit}`);
  console.log(`   Is Active: ${member.subscription.isActive}`);
  console.log(`   Payment Frequency: ${member.subscription.paymentFrequency}`);
  console.log();

  // 3. Check recent contributions
  console.log(`💰 Recent Contributions (last 10):`);
  if (member.contributions.length === 0) {
    console.log('   No contributions found');
  } else {
    member.contributions.forEach((c, i) => {
      console.log(`\n   ${i + 1}. Contribution ID: ${c.id}`);
      console.log(`      Status: ${c.status}`);
      console.log(`      Amount: ${c.amount} KES`);
      console.log(`      Payment Ref: ${c.paymentRef || 'N/A'}`);
      console.log(`      Created: ${c.createdAt.toISOString()}`);
      console.log(`      Updated: ${c.updatedAt.toISOString()}`);

      if (c.metadata) {
        console.log(`      Metadata:`);
        const metadata = c.metadata as Record<string, any>;
        Object.entries(metadata).forEach(([key, value]) => {
          console.log(`        - ${key}: ${JSON.stringify(value)}`);
        });
      } else {
        console.log(`      Metadata: None`);
      }
    });
  }
  console.log();

  // 4. Look for upgrade contributions specifically
  const upgradeContributions = member.contributions.filter((c) => {
    const metadata = c.metadata as { isUpgrade?: boolean } | null;
    return metadata?.isUpgrade === true;
  });

  if (upgradeContributions.length > 0) {
    console.log(
      `🔄 Upgrade Contributions Found: ${upgradeContributions.length}`,
    );
    upgradeContributions.forEach((c, i) => {
      const metadata = c.metadata as {
        isUpgrade?: boolean;
        newTier?: string;
      } | null;
      console.log(`\n   ${i + 1}. Upgrade Contribution:`);
      console.log(`      ID: ${c.id}`);
      console.log(`      Status: ${c.status}`);
      console.log(`      Target Tier: ${metadata?.newTier || 'UNKNOWN'}`);
      console.log(`      Created: ${c.createdAt.toISOString()}`);
      console.log(
        `      Completed: ${c.status === 'COMPLETED' ? 'YES' : 'NO'}`,
      );
    });
  } else {
    console.log(`ℹ️  No upgrade contributions found`);
  }
  console.log();

  // 5. Check for completed upgrade contributions that didn't update subscription
  const completedUpgrades = upgradeContributions.filter(
    (c) => c.status === 'COMPLETED',
  );

  if (completedUpgrades.length > 0) {
    console.log(`\n⚠️  ISSUE DETECTED:`);
    console.log(
      `   Found ${completedUpgrades.length} completed upgrade contribution(s)`,
    );
    console.log(
      `   but subscription tier is still: ${member.subscription.tier}`,
    );
    console.log();

    const latestUpgrade = completedUpgrades[0];
    const metadata = latestUpgrade.metadata as {
      isUpgrade?: boolean;
      newTier?: string;
    } | null;

    console.log(`   Latest upgrade details:`);
    console.log(`   - Contribution ID: ${latestUpgrade.id}`);
    console.log(`   - Target Tier: ${metadata?.newTier}`);
    console.log(`   - Completed At: ${latestUpgrade.updatedAt.toISOString()}`);
    console.log();

    console.log(`   💡 Recommended Action:`);
    console.log(
      `   Run: npx ts-node scripts/fix-user-upgrade.ts "${phoneNumber}" ${metadata?.newTier}`,
    );
  } else {
    console.log(`✅ No completed upgrades pending processing`);
  }

  console.log();
  console.log(`=== Diagnosis Complete ===\n`);

  await prisma.$disconnect();
}

diagnoseUpgradeIssue().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
