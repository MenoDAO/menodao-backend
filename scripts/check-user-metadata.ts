import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUserMetadata() {
  const phoneNumber = process.argv[2] || '+254712345678';

  console.log(`\n=== Checking Metadata for ${phoneNumber} ===\n`);

  const member = await prisma.member.findUnique({
    where: { phoneNumber },
    include: {
      subscription: true,
      contributions: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  if (!member) {
    console.log('❌ Member not found');
    process.exit(1);
  }

  console.log(`Member ID: ${member.id}`);
  console.log(`Current Tier: ${member.subscription?.tier}\n`);

  console.log('Recent Contributions:\n');

  member.contributions.forEach((c, i) => {
    console.log(`${i + 1}. Contribution ${c.id}`);
    console.log(`   Status: ${c.status}`);
    console.log(`   Amount: ${c.amount} KES`);
    console.log(`   Created: ${c.createdAt.toISOString()}`);
    console.log(`   Payment Ref: ${c.paymentRef || 'N/A'}`);

    if (c.metadata) {
      console.log(`   Raw Metadata: ${JSON.stringify(c.metadata)}`);

      const metadata = c.metadata as any;

      // Check for upgrade metadata
      if (metadata.isUpgrade !== undefined) {
        console.log(`   ✅ Has isUpgrade field: ${metadata.isUpgrade}`);
        console.log(`      Type: ${typeof metadata.isUpgrade}`);
        console.log(`      Value === true: ${metadata.isUpgrade === true}`);
      } else {
        console.log(`   ❌ No isUpgrade field`);
      }

      if (metadata.newTier !== undefined) {
        console.log(`   ✅ Has newTier field: ${metadata.newTier}`);
        console.log(`      Type: ${typeof metadata.newTier}`);
      } else {
        console.log(`   ❌ No newTier field`);
      }

      // Check if this looks like an upgrade
      if (metadata.isUpgrade === true && metadata.newTier) {
        console.log(`   🔄 THIS IS AN UPGRADE CONTRIBUTION`);
        console.log(`      Target: ${metadata.newTier}`);
        console.log(`      Status: ${c.status}`);

        if (c.status === 'COMPLETED') {
          console.log(
            `      ⚠️  COMPLETED but tier is still ${member.subscription?.tier}`,
          );
          console.log(`      This upgrade did NOT process correctly!`);
        }
      }
    } else {
      console.log(`   ℹ️  No metadata`);
    }

    console.log('');
  });

  // Look specifically for completed upgrades
  const completedUpgrades = member.contributions.filter((c) => {
    const metadata = c.metadata as any;
    return c.status === 'COMPLETED' && metadata?.isUpgrade === true;
  });

  if (completedUpgrades.length > 0) {
    console.log(`\n⚠️  ISSUE DETECTED:`);
    console.log(
      `Found ${completedUpgrades.length} completed upgrade(s) that may not have processed:\n`,
    );

    completedUpgrades.forEach((c, i) => {
      const metadata = c.metadata as any;
      console.log(`${i + 1}. Contribution ${c.id}`);
      console.log(`   Target Tier: ${metadata.newTier}`);
      console.log(`   Completed: ${c.updatedAt.toISOString()}`);
      console.log(`   Current Tier: ${member.subscription?.tier}`);

      if (member.subscription?.tier !== metadata.newTier) {
        console.log(
          `   ❌ MISMATCH: Should be ${metadata.newTier} but is ${member.subscription?.tier}`,
        );
      } else {
        console.log(`   ✅ Tier matches target`);
      }
      console.log('');
    });
  }

  await prisma.$disconnect();
}

checkUserMetadata().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
