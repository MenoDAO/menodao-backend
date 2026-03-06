import { PrismaClient, PackageTier, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function testUpgradeFlow() {
  console.log('=== Testing Upgrade Flow ===\n');

  // Step 1: Find or create a test member with Bronze subscription
  const testPhone = '+254712345678';
  let member = await prisma.member.findUnique({
    where: { phoneNumber: testPhone },
    include: { subscription: true },
  });

  if (!member) {
    console.log('Creating test member...');
    member = await prisma.member.create({
      data: {
        phoneNumber: testPhone,
        fullName: 'Test Upgrade User',
        isVerified: true,
      },
      include: { subscription: true },
    });
  }

  console.log(`Member ID: ${member.id}`);
  console.log(`Current tier: ${member.subscription?.tier || 'NONE'}\n`);

  // Step 2: Ensure member has Bronze subscription
  if (!member.subscription || member.subscription.tier !== 'BRONZE') {
    console.log('Setting up Bronze subscription...');
    if (member.subscription) {
      await prisma.subscription.update({
        where: { memberId: member.id },
        data: {
          tier: 'BRONZE',
          monthlyAmount: 350,
          annualCapLimit: 6000,
          annualCapUsed: 0,
          isActive: true,
        },
      });
    } else {
      await prisma.subscription.create({
        data: {
          memberId: member.id,
          tier: 'BRONZE',
          monthlyAmount: 350,
          annualCapLimit: 6000,
          annualCapUsed: 0,
          isActive: true,
        },
      });
    }
    console.log('Bronze subscription created\n');
  }

  // Step 3: Create upgrade contribution with metadata
  console.log('Creating upgrade contribution (Bronze -> Gold)...');

  // Use raw SQL to avoid schema mismatch issues
  const contributionId = `test-upgrade-${Date.now()}`;
  await prisma.$executeRaw`
    INSERT INTO "Contribution" (id, "memberId", amount, month, "paymentMethod", status, "paymentRef", metadata, "createdAt", "updatedAt")
    VALUES (
      ${contributionId},
      ${member.id},
      350,
      NOW(),
      'MPESA',
      'PENDING',
      ${'TEST_UPGRADE_' + Date.now()},
      ${'{"isUpgrade": true, "newTier": "GOLD"}'}::jsonb,
      NOW(),
      NOW()
    )
  `;

  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
  });

  if (!contribution) {
    throw new Error('Failed to create contribution');
  }

  console.log(`Contribution ID: ${contribution.id}`);
  console.log(`Metadata: ${JSON.stringify(contribution.metadata, null, 2)}\n`);

  // Step 4: Simulate payment callback (mark as completed)
  console.log('Simulating payment callback...');

  // Extract metadata BEFORE update (this is what the payment service does)
  const originalMetadata = contribution.metadata as {
    isUpgrade?: boolean;
    newTier?: PackageTier;
  } | null;

  console.log(
    `Original metadata extracted: ${JSON.stringify(originalMetadata, null, 2)}`,
  );

  // Update contribution to COMPLETED
  await prisma.contribution.update({
    where: { id: contribution.id },
    data: {
      status: 'COMPLETED',
      metadata: {
        ...(contribution.metadata as object),
        mpesaReceiptNumber: 'TEST_RECEIPT_123',
        completedAt: new Date().toISOString(),
      },
    },
  });

  console.log('Contribution marked as COMPLETED\n');

  // Step 5: Process upgrade (this is what payment service does)
  if (originalMetadata?.isUpgrade && originalMetadata?.newTier) {
    console.log(`Processing upgrade to ${originalMetadata.newTier}...`);

    const tierCaps: Record<PackageTier, number> = {
      BRONZE: 6000,
      SILVER: 10000,
      GOLD: 15000,
    };

    const tierPrices: Record<PackageTier, number> = {
      BRONZE: 350,
      SILVER: 550,
      GOLD: 700,
    };

    await prisma.subscription.update({
      where: { memberId: member.id },
      data: {
        tier: originalMetadata.newTier,
        monthlyAmount: tierPrices[originalMetadata.newTier],
        annualCapLimit: tierCaps[originalMetadata.newTier],
      },
    });

    console.log('Subscription updated!\n');
  } else {
    console.log('ERROR: No upgrade metadata found!\n');
  }

  // Step 6: Verify the upgrade
  const updatedMember = await prisma.member.findUnique({
    where: { id: member.id },
    include: { subscription: true },
  });

  console.log('=== VERIFICATION ===');
  console.log(`Member ID: ${updatedMember?.id}`);
  console.log(`Current tier: ${updatedMember?.subscription?.tier}`);
  console.log(`Monthly amount: ${updatedMember?.subscription?.monthlyAmount}`);
  console.log(
    `Annual cap limit: ${updatedMember?.subscription?.annualCapLimit}`,
  );
  console.log(`Is active: ${updatedMember?.subscription?.isActive}\n`);

  if (updatedMember?.subscription?.tier === 'GOLD') {
    console.log('✅ SUCCESS: Upgrade completed successfully!');
  } else {
    console.log('❌ FAILED: Tier did not update to GOLD');
  }

  // Step 7: Test the /subscriptions/current endpoint
  console.log('\n=== Testing /subscriptions/current endpoint ===');
  const currentSubscription = await prisma.subscription.findUnique({
    where: { memberId: member.id },
  });

  console.log('Response:');
  console.log(
    JSON.stringify(
      {
        id: currentSubscription?.id,
        tier: currentSubscription?.tier,
        monthlyAmount: currentSubscription?.monthlyAmount,
        annualCapLimit: currentSubscription?.annualCapLimit,
        isActive: currentSubscription?.isActive,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

testUpgradeFlow().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
