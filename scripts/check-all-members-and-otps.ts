import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllMembersAndOTPs() {
  console.log('=== Checking All Members and Recent OTPs ===\n');

  // Get all members
  const members = await prisma.member.findMany({
    select: {
      id: true,
      phoneNumber: true,
      fullName: true,
      createdAt: true,
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

  console.log(`Total members: ${members.length}\n`);

  members.forEach((member, index) => {
    console.log(`${index + 1}. Member ID: ${member.id}`);
    console.log(`   Phone: ${member.phoneNumber}`);
    console.log(`   Name: ${member.fullName || 'No name'}`);
    console.log(`   Created: ${member.createdAt}`);
    console.log(
      `   Subscription: ${member.subscription ? `${member.subscription.tier} (${member.subscription.isActive ? 'Active' : 'Inactive'})` : 'None'}`,
    );
    console.log('');
  });

  // Check recent OTP verifications
  console.log('\n=== Recent OTP Verifications (last 10) ===\n');

  const otps = await prisma.oTPCode.findMany({
    take: 10,
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      phoneNumber: true,
      code: true,
      isUsed: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  otps.forEach((otp, index) => {
    console.log(`${index + 1}. Phone: ${otp.phoneNumber}`);
    console.log(`   Code: ${otp.code}`);
    console.log(`   Used: ${otp.isUsed}`);
    console.log(`   Created: ${otp.createdAt}`);
    console.log(`   Expires: ${otp.expiresAt}`);
    console.log('');
  });

  await prisma.$disconnect();
}

checkAllMembersAndOTPs().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
