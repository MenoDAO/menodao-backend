/**
 * Backfill referral codes for all existing members who don't have one.
 *
 * Usage:
 *   DATABASE_URL="..." npx ts-node scripts/backfill-referral-codes.ts
 *
 * Safe to run multiple times — skips members who already have a code.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generateCode(fullName: string, phoneNumber: string): string {
  const firstName = fullName.trim().split(/\s+/)[0].toUpperCase();
  const lastFour = phoneNumber.replace(/\D/g, '').slice(-4);
  return `${firstName}_${lastFour}`;
}

async function getUniqueCode(
  baseCode: string,
  excludeId: string,
): Promise<string> {
  const existing = await prisma.member.findUnique({
    where: { referralCode: baseCode },
    select: { id: true },
  });

  if (!existing || existing.id === excludeId) {
    return baseCode;
  }

  for (let i = 1; i <= 99; i++) {
    const candidate = `${baseCode}_${String(i).padStart(2, '0')}`;
    const collision = await prisma.member.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!collision || collision.id === excludeId) {
      return candidate;
    }
  }

  return `${baseCode}_${Date.now().toString().slice(-4)}`;
}

async function main() {
  console.log('🚀 Starting referral code backfill...\n');

  const members = await prisma.member.findMany({
    where: { referralCode: null },
    select: { id: true, fullName: true, phoneNumber: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${members.length} members without a referral code.\n`);

  let generated = 0;
  let skipped = 0;

  for (const member of members) {
    if (!member.fullName || !member.phoneNumber) {
      console.log(
        `  ⏭  Skipping ${member.id} — missing fullName or phoneNumber`,
      );
      skipped++;
      continue;
    }

    const baseCode = generateCode(member.fullName, member.phoneNumber);
    const uniqueCode = await getUniqueCode(baseCode, member.id);

    await prisma.member.update({
      where: { id: member.id },
      data: { referralCode: uniqueCode },
    });

    console.log(`  ✅ ${member.fullName} → ${uniqueCode}`);
    generated++;
  }

  console.log(`\n✅ Done.`);
  console.log(`   Generated: ${generated}`);
  console.log(`   Skipped (missing data): ${skipped}`);
  console.log(`   Total processed: ${members.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
