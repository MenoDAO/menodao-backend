import { PrismaClient, PackageTier } from '@prisma/client';

const prisma = new PrismaClient();

async function testUpgradeWithLogs() {
  console.log('=== Testing Upgrade Flow with Detailed Logs ===\n');

  const testPhone = '+254700000001';

  // Step 1: Create or find test member
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

  console.log(`✅ Member: ${member.id}`);

  // Step 2: Ensure Bronze subscription exists
  if (!member.subscription) {
    await prisma.subscription.create({
      data: {
        memberId: member.id,
        tier: 'BRONZE',
        monthlyAmount: 350,
        annualCapLimit: 6000,
        isActive: true,
      },
    });
    console.log('✅ Created Bronze subscription');
  } else if (member.subscription.tier !== 'BRONZE') {
    await prisma.subscription.update({
      where: { memberId: member.id },
      data: { tier: 'BRONZE', monthlyAmount: 350, annualCapLimit: 6000 },
    });
    console.log('✅ Reset to Bronze subscription');
  } else {
    console.log('✅ Bronze subscription exists');
  }

  // Step 3: Create upgrade contribution with metadata
  console.log('\n--- Creating Upgrade Contribution ---');

  const metadata = {
    isUpgrade: true,
    newTier: 'GOLD' as PackageTier,
  };

  console.log('Metadata to save:', JSON.stringify(metadata, null, 2));

  const contribution = await prisma.contribution.create({
    data: {
      memberId: member.id,
      amount: 350,
      month: new Date(),
      paymentMethod: 'MPESA',
      status: 'PENDING',
      paymentRef: `TEST_UPGRADE_${Date.now()}`,
      metadata: metadata,
    },
  });

  console.log(`✅ Created contribution: ${contribution.id}`);
  console.log(
    'Saved metadata:',
    JSON.stringify(contribution.metadata, null, 2),
  );

  // Step 4: Verify metadata was saved correctly
  const savedContribution = await prisma.contribution.findUnique({
    where: { id: contribution.id },
  });

  console.log('\n--- Verifying Saved Metadata ---');
  console.log(
    'Retrieved metadata:',
    JSON.stringify(savedContribution?.metadata, null, 2),
  );

  const savedMetadata = savedContribution?.metadata as {
    isUpgrade?: boolean;
    newTier?: PackageTier;
  } | null;

  console.log('Type checks:');
  console.log('  - isUpgrade type:', typeof savedMetadata?.isUpgrade);
  console.log('  - isUpgrade value:', savedMetadata?.isUpgrade);
  console.log('  - isUpgrade === true:', savedMetadata?.isUpgrade === true);
  console.log('  - newTier type:', typeof savedMetadata?.newTier);
  console.log('  - newTier value:', savedMetadata?.newTier);
  console.log('  - newTier exists:', !!savedMetadata?.newTier);

  // Step 5: Simulate payment callback processing
  console.log('\n--- Simulating Payment Callback ---');

  // Extract metadata BEFORE updating (this is what payment service does)
  const originalMetadata = savedContribution?.metadata as {
    isUpgrade?: boolean;
    newTier?: PackageTier;
  } | null;

  console.log(
    'Original metadata extracted:',
    JSON.stringify(originalMetadata, null, 2),
  );

  // Update contribution to COMPLETED
  await prisma.contribution.update({
    where: { id: contribution.id },
    data: {
      status: 'COMPLETED',
      metadata: {
        ...(savedContribution?.metadata as object),
        mpesaReceiptNumber: 'TEST_RECEIPT_123',
        completedAt: new Date().toISOString(),
      },
    },
  });

  console.log('✅ Contribution marked as COMPLETED');

  // Step 6: Check if upgrade should process
  console.log('\n--- Checking Upgrade Conditions ---');
  console.log('Condition 1 - isUpgrade:', originalMetadata?.isUpgrade);
  console.log('Condition 2 - newTier:', originalMetadata?.newTier);
  console.log(
    'Both conditions met:',
    !!(originalMetadata?.isUpgrade && originalMetadata?.newTier),
  );

  if (originalMetadata?.isUpgrade && originalMetadata?.newTier) {
    console.log('\n✅ Upgrade conditions met, processing upgrade...');

    const subscription = await prisma.subscription.findUnique({
      where: { memberId: member.id },
    });

    if (subscription) {
      console.log(`Current tier: ${subscription.tier}`);

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

      console.log(`✅ Subscription updated to ${originalMetadata.newTier}`);
    } else {
      console.log('❌ No subscription found');
    }
  } else {
    console.log('\n❌ Upgrade conditions NOT met!');
    console.log('This is the problem - metadata is not being read correctly');
  }

  // Step 7: Verify final state
  console.log('\n--- Final Verification ---');
  const finalMember = await prisma.member.findUnique({
    where: { id: member.id },
    include: { subscription: true },
  });

  console.log('Final tier:', finalMember?.subscription?.tier);
  console.log(
    'Final monthly amount:',
    finalMember?.subscription?.monthlyAmount,
  );
  console.log('Final annual cap:', finalMember?.subscription?.annualCapLimit);

  if (finalMember?.subscription?.tier === 'GOLD') {
    console.log('\n✅ SUCCESS: Upgrade completed!');
  } else {
    console.log('\n❌ FAILED: Tier did not update to GOLD');
  }

  await prisma.$disconnect();
}

testUpgradeWithLogs().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
