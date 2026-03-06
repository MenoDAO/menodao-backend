import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupTestData() {
  console.log('=== Cleaning Up Test Data ===\n');

  // Safety check
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ERROR: This script should not be run in production!');
    console.error(
      'Please manually review and delete test data in production environments.',
    );
    process.exit(1);
  }

  // Find test member
  const testMember = await prisma.member.findUnique({
    where: { phoneNumber: '+254712345678' },
    include: {
      subscription: true,
      contributions: true,
      claims: true,
    },
  });

  if (!testMember) {
    console.log('✅ No test member found. Database is clean.');
    await prisma.$disconnect();
    return;
  }

  console.log('Found test member:');
  console.log(`  ID: ${testMember.id}`);
  console.log(`  Phone: ${testMember.phoneNumber}`);
  console.log(`  Name: ${testMember.fullName}`);
  console.log(`  Subscription: ${testMember.subscription?.tier || 'None'}`);
  console.log(`  Contributions: ${testMember.contributions.length}`);
  console.log(`  Claims: ${testMember.claims.length}`);
  console.log('');

  // Ask for confirmation
  console.log('⚠️  WARNING: This will delete all data for this test member!');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('Deleting test data...\n');

  // Delete in correct order (respecting foreign key constraints)

  // 1. Delete claims
  if (testMember.claims.length > 0) {
    const deletedClaims = await prisma.claim.deleteMany({
      where: { memberId: testMember.id },
    });
    console.log(`✓ Deleted ${deletedClaims.count} claims`);
  }

  // 2. Delete contributions
  if (testMember.contributions.length > 0) {
    const deletedContributions = await prisma.contribution.deleteMany({
      where: { memberId: testMember.id },
    });
    console.log(`✓ Deleted ${deletedContributions.count} contributions`);
  }

  // 3. Delete subscription
  if (testMember.subscription) {
    await prisma.subscription.delete({
      where: { memberId: testMember.id },
    });
    console.log('✓ Deleted subscription');
  }

  // 4. Delete OTP codes (if any)
  const deletedOtps = await prisma.oTPCode.deleteMany({
    where: { memberId: testMember.id },
  });
  if (deletedOtps.count > 0) {
    console.log(`✓ Deleted ${deletedOtps.count} OTP codes`);
  }

  // 5. Delete member
  await prisma.member.delete({
    where: { id: testMember.id },
  });
  console.log('✓ Deleted member');

  console.log('\n✅ Test data cleanup complete!');
  console.log('\nYou can now test the signup flow with a real phone number.\n');

  await prisma.$disconnect();
}

cleanupTestData().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
