import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixUserUpgrade() {
  const phoneNumber = process.argv[2];
  const newTier = process.argv[3] as 'BRONZE' | 'SILVER' | 'GOLD';

  if (!phoneNumber || !newTier) {
    console.log(
      'Usage: npx ts-node scripts/fix-user-upgrade.ts <phone> <tier>',
    );
    console.log(
      'Example: npx ts-node scripts/fix-user-upgrade.ts +254712345678 GOLD',
    );
    process.exit(1);
  }

  console.log(`\n=== Fixing Upgrade for ${phoneNumber} to ${newTier} ===\n`);

  const member = await prisma.member.findUnique({
    where: { phoneNumber },
    include: {
      subscription: true,
      contributions: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!member) {
    console.log('❌ Member not found');
    process.exit(1);
  }

  console.log(`Member ID: ${member.id}`);
  console.log(`Current tier: ${member.subscription?.tier}`);
  console.log(`\nRecent contributions:`);
  member.contributions.forEach((c) => {
    console.log(`  - ${c.id}: ${c.status} - ${c.amount} KES - ${c.createdAt}`);
    if (c.metadata) {
      console.log(`    Metadata: ${JSON.stringify(c.metadata)}`);
    }
  });

  const tierCaps = { BRONZE: 6000, SILVER: 10000, GOLD: 15000 };
  const tierPrices = { BRONZE: 350, SILVER: 550, GOLD: 700 };

  console.log(`\n=== Updating to ${newTier} ===`);
  await prisma.subscription.update({
    where: { memberId: member.id },
    data: {
      tier: newTier,
      monthlyAmount: tierPrices[newTier],
      annualCapLimit: tierCaps[newTier],
    },
  });

  const updated = await prisma.member.findUnique({
    where: { id: member.id },
    include: { subscription: true },
  });

  console.log(`\n✅ Updated successfully!`);
  console.log(`New tier: ${updated?.subscription?.tier}`);
  console.log(`Monthly amount: ${updated?.subscription?.monthlyAmount}`);
  console.log(`Annual cap: ${updated?.subscription?.annualCapLimit}`);

  await prisma.$disconnect();
}

fixUserUpgrade().catch(console.error);
