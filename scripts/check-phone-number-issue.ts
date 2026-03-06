import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPhoneNumberIssue() {
  console.log('=== Investigating Phone Number Issue ===\n');

  // Get the member with the test phone number
  const testMember = await prisma.member.findUnique({
    where: { phoneNumber: '+254712345678' },
    include: {
      subscription: true,
      contributions: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  if (!testMember) {
    console.log('No member found with phone number +254712345678');
    return;
  }

  console.log('Member Details:');
  console.log(`  ID: ${testMember.id}`);
  console.log(`  Phone: ${testMember.phoneNumber}`);
  console.log(`  Name: ${testMember.fullName || 'Not set'}`);
  console.log(`  Location: ${testMember.location || 'Not set'}`);
  console.log(`  Created: ${testMember.createdAt}`);
  console.log(`  Verified: ${testMember.isVerified}`);
  console.log('');

  // Check all OTP codes ever created
  console.log('=== All OTP Codes (All Time) ===\n');
  const allOtps = await prisma.oTPCode.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      phoneNumber: true,
      code: true,
      isUsed: true,
      createdAt: true,
      expiresAt: true,
      memberId: true,
    },
  });

  if (allOtps.length === 0) {
    console.log('No OTP codes found in database');
  } else {
    allOtps.forEach((otp, index) => {
      console.log(`${index + 1}. Phone: ${otp.phoneNumber}`);
      console.log(`   Code: ${otp.code}`);
      console.log(`   Used: ${otp.isUsed}`);
      console.log(`   Member ID: ${otp.memberId || 'None'}`);
      console.log(`   Created: ${otp.createdAt}`);
      console.log('');
    });
  }

  // Check contributions to see what phone numbers were used for payments
  console.log('\n=== Payment Phone Numbers ===\n');
  if (testMember.contributions.length === 0) {
    console.log('No contributions found');
  } else {
    testMember.contributions.forEach((contribution, index) => {
      console.log(`${index + 1}. Contribution ID: ${contribution.id}`);
      console.log(`   Amount: KES ${contribution.amount}`);
      console.log(`   Status: ${contribution.status}`);
      console.log(`   Created: ${contribution.createdAt}`);
      console.log('');
    });
  }

  // Check if there are any other members
  console.log('\n=== All Members in Database ===\n');
  const allMembers = await prisma.member.findMany({
    select: {
      id: true,
      phoneNumber: true,
      fullName: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  allMembers.forEach((member, index) => {
    console.log(`${index + 1}. ${member.phoneNumber}`);
    console.log(`   Name: ${member.fullName || 'Not set'}`);
    console.log(`   Created: ${member.createdAt}`);
    console.log('');
  });

  await prisma.$disconnect();
}

checkPhoneNumberIssue().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
