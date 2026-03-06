import { PrismaClient, PackageTier, PaymentFrequency } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test script to verify upgrade cost calculation respects payment frequency
 */
async function testUpgradeCostCalculation() {
  console.log('\n=== Testing Upgrade Cost Calculation ===\n');

  // Test data
  const testCases = [
    {
      name: 'Monthly Bronze to Silver',
      currentTier: 'BRONZE' as PackageTier,
      newTier: 'SILVER' as PackageTier,
      paymentFrequency: 'MONTHLY' as PaymentFrequency,
      expectedDifference: 200, // 550 - 350
    },
    {
      name: 'Monthly Bronze to Gold',
      currentTier: 'BRONZE' as PackageTier,
      newTier: 'GOLD' as PackageTier,
      paymentFrequency: 'MONTHLY' as PaymentFrequency,
      expectedDifference: 350, // 700 - 350
    },
    {
      name: 'Annual Bronze to Silver',
      currentTier: 'BRONZE' as PackageTier,
      newTier: 'SILVER' as PackageTier,
      paymentFrequency: 'ANNUAL' as PaymentFrequency,
      expectedDifference: 2400, // 6600 - 4200
    },
    {
      name: 'Annual Bronze to Gold',
      currentTier: 'BRONZE' as PackageTier,
      newTier: 'GOLD' as PackageTier,
      paymentFrequency: 'ANNUAL' as PaymentFrequency,
      expectedDifference: 4200, // 8400 - 4200
    },
    {
      name: 'Annual Silver to Gold',
      currentTier: 'SILVER' as PackageTier,
      newTier: 'GOLD' as PackageTier,
      paymentFrequency: 'ANNUAL' as PaymentFrequency,
      expectedDifference: 1800, // 8400 - 6600
    },
  ];

  const PACKAGE_PRICES: Record<
    PackageTier,
    { monthly: number; annual: number }
  > = {
    BRONZE: { monthly: 350, annual: 4200 },
    SILVER: { monthly: 550, annual: 6600 },
    GOLD: { monthly: 700, annual: 8400 },
  };

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const currentPrice =
      testCase.paymentFrequency === 'ANNUAL'
        ? PACKAGE_PRICES[testCase.currentTier].annual
        : PACKAGE_PRICES[testCase.currentTier].monthly;

    const newPrice =
      testCase.paymentFrequency === 'ANNUAL'
        ? PACKAGE_PRICES[testCase.newTier].annual
        : PACKAGE_PRICES[testCase.newTier].monthly;

    const calculatedDifference = newPrice - currentPrice;

    const isCorrect = calculatedDifference === testCase.expectedDifference;

    console.log(`Test: ${testCase.name}`);
    console.log(
      `  Current Tier: ${testCase.currentTier} (${currentPrice} KES)`,
    );
    console.log(`  New Tier: ${testCase.newTier} (${newPrice} KES)`);
    console.log(`  Payment Frequency: ${testCase.paymentFrequency}`);
    console.log(`  Expected Difference: ${testCase.expectedDifference} KES`);
    console.log(`  Calculated Difference: ${calculatedDifference} KES`);
    console.log(`  Result: ${isCorrect ? '✅ PASS' : '❌ FAIL'}\n`);

    if (isCorrect) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('=== Summary ===');
  console.log(`Total Tests: ${testCases.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(
    `\n${failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed'}`,
  );

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

testUpgradeCostCalculation().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
