import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';
import { config } from './delete-test-users.config';

/**
 * Delete specific test users and all their related records
 * Usage: npx ts-node scripts/delete-test-users.ts
 *
 * IMPORTANT: This script uses the DATABASE_URL from delete-test-users.config.ts
 * Update that file to point to your dev database before running!
 */

// Override DATABASE_URL with config value
process.env.DATABASE_URL = config.DATABASE_URL;

const prisma = new PrismaClient();

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

async function deleteTestUsers() {
  const phoneNumbers = config.PHONE_NUMBERS;

  // Show database connection info
  const dbUrl = config.DATABASE_URL;
  const dbHost = dbUrl.match(/@([^:]+)/)?.[1] || 'unknown';
  const dbName = dbUrl.match(/\/([^?]+)/)?.[1] || 'unknown';

  console.log('\n⚠️  DATABASE CLEANUP SCRIPT ⚠️');
  console.log('================================');
  console.log(`📊 Database Host: ${dbHost}`);
  console.log(`📊 Database Name: ${dbName}`);
  console.log(`📱 Phone numbers to delete: ${phoneNumbers.join(', ')}`);
  console.log('================================\n');

  // Safety check
  if (dbHost.includes('rds.amazonaws.com') && !dbHost.includes('dev')) {
    console.log('🚨 WARNING: This appears to be a PRODUCTION database!');
    console.log(
      '🚨 Please update delete-test-users.config.ts to point to the dev database first.',
    );
    console.log('🚨 Exiting for safety...\n');
    process.exit(1);
  }

  const answer = await askQuestion(
    'Are you sure you want to delete these users? (yes/no): ',
  );

  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled by user');
    process.exit(0);
  }

  console.log('\n🗑️  Starting cleanup of test users...');

  for (const phoneNumber of phoneNumbers) {
    console.log(`\n🔍 Looking for user: ${phoneNumber}`);

    const member = await prisma.member.findUnique({
      where: { phoneNumber },
      include: {
        subscription: true,
        contributions: true,
        claims: true,
        nfts: true,
        otpCodes: true,
        transactions: true,
        deviceTokens: true,
        visits: true,
        campRegistrations: true,
      },
    });

    if (!member) {
      console.log(`   ⚠️  User ${phoneNumber} not found, skipping...`);
      continue;
    }

    console.log(
      `   ✅ Found user: ${member.fullName || phoneNumber} (ID: ${member.id})`,
    );

    // Delete related records in order (respecting foreign key constraints)

    // 1. Delete questionnaire data (linked to visits)
    if (member.visits.length > 0) {
      const visitIds = member.visits.map((v) => v.id);
      const questionnaireCount = await prisma.questionnaireData.deleteMany({
        where: { visitId: { in: visitIds } },
      });
      console.log(
        `   🗑️  Deleted ${questionnaireCount.count} questionnaire records`,
      );
    }

    // 2. Delete visit procedures (linked to visits)
    if (member.visits.length > 0) {
      const visitIds = member.visits.map((v) => v.id);
      const visitProcedureCount = await prisma.visitProcedure.deleteMany({
        where: { visitId: { in: visitIds } },
      });
      console.log(
        `   🗑️  Deleted ${visitProcedureCount.count} visit procedures`,
      );
    }

    // 3. Delete disbursal status history (linked to disbursals)
    const claimIds = member.claims.map((c) => c.id);
    if (claimIds.length > 0) {
      const disbursals = await prisma.disbursal.findMany({
        where: { claimId: { in: claimIds } },
      });
      const disbursalIds = disbursals.map((d) => d.id);

      if (disbursalIds.length > 0) {
        const historyCount = await prisma.disbursalStatusHistory.deleteMany({
          where: { disbursalId: { in: disbursalIds } },
        });
        console.log(
          `   🗑️  Deleted ${historyCount.count} disbursal status history records`,
        );

        // Delete disbursals
        const disbursalCount = await prisma.disbursal.deleteMany({
          where: { id: { in: disbursalIds } },
        });
        console.log(`   🗑️  Deleted ${disbursalCount.count} disbursals`);
      }
    }

    // 4. Delete visits
    const visitCount = await prisma.visit.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${visitCount.count} visits`);

    // 5. Delete claims
    const claimCount = await prisma.claim.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${claimCount.count} claims`);

    // 6. Delete camp registrations
    const campRegCount = await prisma.campRegistration.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${campRegCount.count} camp registrations`);

    // 7. Delete device tokens
    const deviceTokenCount = await prisma.deviceToken.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${deviceTokenCount.count} device tokens`);

    // 8. Delete blockchain transactions
    const txCount = await prisma.blockchainTransaction.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${txCount.count} blockchain transactions`);

    // 9. Delete NFTs
    const nftCount = await prisma.nFT.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${nftCount.count} NFTs`);

    // 10. Delete OTP codes
    const otpCount = await prisma.oTPCode.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${otpCount.count} OTP codes`);

    // 11. Delete contributions (payments)
    const contributionCount = await prisma.contribution.deleteMany({
      where: { memberId: member.id },
    });
    console.log(`   🗑️  Deleted ${contributionCount.count} contributions`);

    // 12. Delete subscription
    if (member.subscription) {
      await prisma.subscription.delete({
        where: { id: member.subscription.id },
      });
      console.log(`   🗑️  Deleted subscription (${member.subscription.tier})`);
    }

    // 13. Finally, delete the member
    await prisma.member.delete({
      where: { id: member.id },
    });
    console.log(`   ✅ Deleted member: ${phoneNumber}`);
  }

  console.log('\n✨ Cleanup complete!');
}

deleteTestUsers()
  .catch((error) => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
