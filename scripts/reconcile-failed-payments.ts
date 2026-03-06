import { PrismaClient, PaymentStatus } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

interface SasaPayTransactionStatusResponse {
  status: boolean;
  detail: string;
  TransactionStatus?: string;
  ResultCode?: string;
  ResultDesc?: string;
  Amount?: number;
  MpesaReceiptNumber?: string;
  TransactionDate?: string;
  PhoneNumber?: string;
}

// Payment references to check
const PAYMENT_REFS_TO_CHECK = [
  'menodao_mmeng45l4c5926fc',
  'menodao_mmenec7388129d91',
  'menodao_mmemf2dpe43c78b5',
  'menodao_mmd7ra5dd08cdc05',
  'menodao_mmayuwm0ecc6a6ab',
  'menodao_mmawh6yxb0276728',
];

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SASAPAY_CLIENT_ID;
  const clientSecret = process.env.SASAPAY_CLIENT_SECRET;
  const baseUrl = process.env.SASAPAY_BASE_URL || 'https://sandbox.sasapay.app';

  if (!clientId || !clientSecret) {
    throw new Error('SASAPAY_CLIENT_ID and SASAPAY_CLIENT_SECRET must be set');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );

  const response = await axios.get(
    `${baseUrl}/api/v1/auth/token/?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    },
  );

  if (!response.data.status || !response.data.access_token) {
    throw new Error(
      `Token request failed: ${response.data.detail || 'Unknown error'}`,
    );
  }

  return response.data.access_token;
}

async function checkTransactionStatus(
  merchantRequestId: string,
  token: string,
): Promise<SasaPayTransactionStatusResponse> {
  const baseUrl = process.env.SASAPAY_BASE_URL || 'https://sandbox.sasapay.app';

  try {
    const response = await axios.get<SasaPayTransactionStatusResponse>(
      `${baseUrl}/api/v1/payments/check-payment-status/?CheckoutRequestID=${merchantRequestId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error(
        `Status check failed: ${JSON.stringify(error.response.data)}`,
      );
      return {
        status: false,
        detail: error.response.data?.detail || 'Status check failed',
      };
    }
    throw error;
  }
}

async function reconcilePayment(paymentRef: string, token: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Checking payment: ${paymentRef}`);
  console.log('='.repeat(80));

  // Find the contribution in database
  const contribution = await prisma.contribution.findFirst({
    where: {
      paymentRef: paymentRef,
    },
    include: {
      member: {
        include: {
          subscription: true,
        },
      },
    },
  });

  if (!contribution) {
    console.log(`❌ Payment not found in database: ${paymentRef}`);
    return;
  }

  console.log(`\nDatabase Record:`);
  console.log(`  Contribution ID: ${contribution.id}`);
  console.log(
    `  Member: ${contribution.member.name} (${contribution.member.phoneNumber})`,
  );
  console.log(`  Amount: KES ${contribution.amount}`);
  console.log(`  Status: ${contribution.status}`);
  console.log(`  Created: ${contribution.createdAt}`);
  console.log(`  Updated: ${contribution.updatedAt}`);

  // Extract CheckoutRequestID from paymentRef or metadata
  // The paymentRef format is typically: menodao_{checkoutRequestId}
  const checkoutRequestId = paymentRef.replace('menodao_', '');

  console.log(
    `\nChecking SasaPay status for CheckoutRequestID: ${checkoutRequestId}`,
  );

  try {
    const statusResponse = await checkTransactionStatus(
      checkoutRequestId,
      token,
    );

    console.log(`\nSasaPay Response:`);
    console.log(`  Status: ${statusResponse.status}`);
    console.log(`  Detail: ${statusResponse.detail}`);
    console.log(
      `  Transaction Status: ${statusResponse.TransactionStatus || 'N/A'}`,
    );
    console.log(`  Result Code: ${statusResponse.ResultCode || 'N/A'}`);
    console.log(`  Result Desc: ${statusResponse.ResultDesc || 'N/A'}`);
    console.log(
      `  M-Pesa Receipt: ${statusResponse.MpesaReceiptNumber || 'N/A'}`,
    );
    console.log(`  Amount: ${statusResponse.Amount || 'N/A'}`);

    // Check if payment was actually successful
    const isSuccessful =
      statusResponse.status &&
      (statusResponse.ResultCode === '0' ||
        statusResponse.TransactionStatus === 'Success' ||
        statusResponse.TransactionStatus === 'Completed');

    if (isSuccessful && contribution.status === PaymentStatus.FAILED) {
      console.log(`\n✅ PAYMENT WAS SUCCESSFUL BUT MARKED AS FAILED!`);
      console.log(`   Updating database record...`);

      // Update contribution to COMPLETED
      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          status: PaymentStatus.COMPLETED,
          paymentRef: statusResponse.MpesaReceiptNumber || paymentRef,
        },
      });

      // Activate subscription if not already active
      if (
        contribution.member.subscription &&
        !contribution.member.subscription.isActive
      ) {
        await prisma.subscription.update({
          where: { id: contribution.member.subscription.id },
          data: {
            isActive: true,
            startDate: new Date(),
          },
        });
        console.log(`   ✅ Subscription activated`);
      }

      console.log(`   ✅ Payment record updated to COMPLETED`);
    } else if (
      isSuccessful &&
      contribution.status === PaymentStatus.COMPLETED
    ) {
      console.log(
        `\n✅ Payment is successful and correctly marked as COMPLETED`,
      );
    } else if (!isSuccessful) {
      console.log(`\n❌ Payment was genuinely failed or not found in SasaPay`);
    }
  } catch (error) {
    console.error(`\n❌ Error checking status: ${(error as Error).message}`);
  }
}

async function main() {
  console.log('Payment Reconciliation Script');
  console.log('==============================\n');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(
    `SasaPay Base URL: ${process.env.SASAPAY_BASE_URL || 'https://sandbox.sasapay.app'}`,
  );
  console.log(`Payments to check: ${PAYMENT_REFS_TO_CHECK.length}\n`);

  try {
    // Get access token
    console.log('Authenticating with SasaPay...');
    const token = await getAccessToken();
    console.log('✅ Authentication successful\n');

    // Check each payment
    for (const paymentRef of PAYMENT_REFS_TO_CHECK) {
      await reconcilePayment(paymentRef, token);
      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('Reconciliation Complete');
    console.log('='.repeat(80));
  } catch (error) {
    console.error(`\n❌ Fatal error: ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
