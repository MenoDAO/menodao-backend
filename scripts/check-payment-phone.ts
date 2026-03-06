import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPaymentPhone() {
  console.log('=== Checking Payment Phone Numbers ===\n');

  const members = await prisma.member.findMany({
    include: {
      contributions: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      subscription: true,
    },
  });

  for (const member of members) {
    console.log(`Member: ${member.phoneNumber}`);
    console.log(`  Full Name: ${member.fullName || 'Not set'}`);
    console.log(
      `  Subscription: ${member.subscription?.tier || 'None'} (${member.subscription?.isActive ? 'Active' : 'Inactive'})`,
    );
    console.log(`  Recent Contributions:`);

    if (member.contributions.length === 0) {
      console.log('    No contributions found');
    } else {
      member.contributions.forEach((contrib, index) => {
        console.log(`    ${index + 1}. Amount: KES ${contrib.amount}`);
        console.log(`       Status: ${contrib.status}`);
        console.log(`       Payment Ref: ${contrib.paymentRef || 'N/A'}`);
        console.log(
          `       Phone Number: ${contrib.phoneNumber || 'Not recorded'}`,
        );
        console.log(`       Created: ${contrib.createdAt}`);
        console.log('');
      });
    }
    console.log('---\n');
  }

  await prisma.$disconnect();
}

checkPaymentPhone().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
