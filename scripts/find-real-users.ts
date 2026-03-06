import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findRealUsers() {
  console.log('=== Finding Real Users (with OTP records) ===\n');

  // Get all members with their OTP count
  const members = await prisma.member.findMany({
    include: {
      _count: {
        select: {
          otpCodes: true,
        },
      },
      subscription: {
        select: {
          tier: true,
          isActive: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log(`Total members in database: ${members.length}\n`);

  // Separate real users from test data
  const realUsers = members.filter((m) => m._count.otpCodes > 0);
  const testUsers = members.filter((m) => m._count.otpCodes === 0);

  console.log('=== REAL USERS (with OTP records) ===');
  if (realUsers.length === 0) {
    console.log('❌ No real users found!\n');
    console.log(
      'This suggests the database only contains test data or signup flow is not working.\n',
    );
  } else {
    console.log(`✅ Found ${realUsers.length} real user(s):\n`);
    realUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.phoneNumber}`);
      console.log(`   Name: ${user.fullName || 'Not set'}`);
      console.log(`   OTP Count: ${user._count.otpCodes}`);
      console.log(
        `   Subscription: ${user.subscription ? `${user.subscription.tier} (${user.subscription.isActive ? 'Active' : 'Inactive'})` : 'None'}`,
      );
      console.log(`   Created: ${user.createdAt}`);
      console.log('');
    });
  }

  console.log('=== TEST DATA (no OTP records) ===');
  if (testUsers.length === 0) {
    console.log('✅ No test data found. Database is clean.\n');
  } else {
    console.log(`⚠️  Found ${testUsers.length} test account(s):\n`);
    testUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.phoneNumber}`);
      console.log(`   Name: ${user.fullName || 'Not set'}`);
      console.log(
        `   Subscription: ${user.subscription ? `${user.subscription.tier} (${user.subscription.isActive ? 'Active' : 'Inactive'})` : 'None'}`,
      );
      console.log(`   Created: ${user.createdAt}`);
      console.log('');
    });
    console.log(
      'These accounts were likely created by test scripts and should be removed.\n',
    );
    console.log('Run: npx ts-node scripts/cleanup-test-data.ts\n');
  }

  // Check OTP codes
  console.log('=== OTP CODE STATISTICS ===');
  const totalOtps = await prisma.oTPCode.count();
  const usedOtps = await prisma.oTPCode.count({ where: { isUsed: true } });
  const unusedOtps = await prisma.oTPCode.count({ where: { isUsed: false } });

  console.log(`Total OTP codes: ${totalOtps}`);
  console.log(`Used: ${usedOtps}`);
  console.log(`Unused: ${unusedOtps}`);

  if (totalOtps === 0) {
    console.log('\n⚠️  WARNING: No OTP codes in database. This suggests:');
    console.log('   1. No users have signed up through the normal flow');
    console.log('   2. OTP service may not be working');
    console.log('   3. Database may have been reset recently');
  }

  console.log('');

  await prisma.$disconnect();
}

findRealUsers().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
