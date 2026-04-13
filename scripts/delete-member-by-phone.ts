import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const phone = process.argv[2];

async function main() {
  if (!phone)
    throw new Error('Usage: ts-node delete-member-by-phone.ts <phone>');

  // Normalize
  let normalized = phone.replace(/[\s\-]/g, '');
  if (normalized.startsWith('0')) normalized = '+254' + normalized.slice(1);
  else if (normalized.startsWith('254')) normalized = '+' + normalized;

  const member = await prisma.member.findUnique({
    where: { phoneNumber: normalized },
    include: { subscription: true },
  });

  if (!member) {
    console.log('❌ Member not found for phone:', normalized);
    return;
  }

  console.log(
    `Found: ${member.id} | ${member.fullName} | ${member.phoneNumber}`,
  );

  await prisma.withdrawalRecord.deleteMany({
    where: { championId: member.id },
  });
  await prisma.commissionLedger.deleteMany({
    where: { championId: member.id },
  });
  await prisma.deviceToken.deleteMany({ where: { memberId: member.id } });
  await prisma.oTPCode.deleteMany({ where: { memberId: member.id } });
  await prisma.claim.deleteMany({ where: { memberId: member.id } });
  await prisma.contribution.deleteMany({ where: { memberId: member.id } });
  if (member.subscription) {
    await prisma.subscription.delete({ where: { memberId: member.id } });
  }
  await prisma.member.delete({ where: { id: member.id } });

  console.log('✅ Deleted:', normalized);
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
