import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMemberPhone() {
  console.log('=== Checking Member Phone Numbers ===\n');

  const members = await prisma.member.findMany({
    select: {
      id: true,
      phoneNumber: true,
      fullName: true,
      subscription: {
        select: {
          tier: true,
          isActive: true,
        },
      },
    },
  });

  console.log(`Total members: ${members.length}\n`);

  members.forEach((member) => {
    console.log(`Member ID: ${member.id}`);
    console.log(`  Phone: ${member.phoneNumber}`);
    console.log(`  Name: ${member.fullName || 'No name'}`);
    console.log(
      `  Subscription: ${member.subscription ? `${member.subscription.tier} (${member.subscription.isActive ? 'Active' : 'Inactive'})` : 'None'}`,
    );
    console.log('');
  });

  await prisma.$disconnect();
}

checkMemberPhone().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
