// Feature: whatsapp-ai-chatbot, Property 11: Payment Callback Idempotency

import * as fc from 'fast-check';
import { PaymentService, PaymentCallbackData } from './payment.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SasaPayService } from '../sasapay/sasapay.service';
import { SmsService } from '../sms/sms.service';
import { ReferralService } from '../referrals/referral.service';

/**
 * Validates: Requirements 5.6, 5.7
 *
 * Property 11: Payment Callback Idempotency
 * For any contributionId already in COMPLETED status, calling
 * PaymentService.processCallback() a second time SHALL NOT re-activate
 * the subscription or create duplicate records.
 */
describe('PaymentService — Property 11: Payment Callback Idempotency', () => {
  let service: PaymentService;

  // Track calls to subscription update and contribution create
  const mockSubscriptionUpdate = jest.fn();
  const mockContributionUpdate = jest.fn();
  const mockContributionCreate = jest.fn();
  const mockContributionFindFirst = jest.fn();
  const mockContributionFindUnique = jest.fn();
  const mockSubscriptionFindUnique = jest.fn();
  const mockMemberFindUnique = jest.fn();

  const mockPrisma = {
    contribution: {
      findFirst: mockContributionFindFirst,
      findUnique: mockContributionFindUnique,
      update: mockContributionUpdate,
      create: mockContributionCreate,
    },
    subscription: {
      findUnique: mockSubscriptionFindUnique,
      update: mockSubscriptionUpdate,
    },
    member: {
      findUnique: mockMemberFindUnique,
    },
  } as unknown as PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    }),
  } as unknown as ConfigService;

  const mockSasaPayService = {
    isConfigured: jest.fn().mockReturnValue(false),
    normalizePhoneNumber: jest.fn((p: string) => p),
  } as unknown as SasaPayService;

  const mockSmsService = {
    sendSms: jest.fn().mockResolvedValue(undefined),
  } as unknown as SmsService;

  const mockReferralService = {
    creditCommission: jest.fn().mockResolvedValue(undefined),
    updateActiveReferralCount: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferralService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PaymentService(
      mockConfigService,
      mockPrisma,
      mockSasaPayService,
      mockSmsService,
      mockReferralService,
    );
  });

  /**
   * Property 11: Payment Callback Idempotency
   *
   * For any contributionId already in COMPLETED status, calling
   * processCallback() a second time SHALL NOT:
   *   1. Call subscription activation (subscription.update with isActive: true)
   *   2. Create a new contribution record
   *   3. Throw an error (returns gracefully)
   *
   * The mechanism: findContributionByCallback() only queries for
   * contributions with status IN ['PENDING', 'FAILED']. A COMPLETED
   * contribution is invisible to the callback lookup, so the second
   * call returns { success: false, message: 'Transaction not found' }
   * without touching any subscription or contribution records.
   */
  it('Property 11: second callback on COMPLETED contribution does not re-activate subscription or create duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary contributionId strings
        fc
          .string({ minLength: 1, maxLength: 64 })
          .filter((s) => s.trim().length > 0),
        // Generate arbitrary CheckoutRequestID strings
        fc
          .string({ minLength: 1, maxLength: 64 })
          .filter((s) => s.trim().length > 0),
        async (contributionId, checkoutRequestId) => {
          jest.clearAllMocks();

          // Simulate: contribution is already COMPLETED — findContributionByCallback
          // queries only PENDING/FAILED, so it returns null for a COMPLETED contribution
          mockContributionFindFirst.mockResolvedValue(null);
          mockContributionFindUnique.mockResolvedValue(null);

          const callbackData: PaymentCallbackData = {
            CheckoutRequestID: checkoutRequestId,
            MerchantRequestID: `merchant_${checkoutRequestId}`,
            ResultCode: '0', // success result
            ResultDesc: 'The service request is processed successfully.',
            Amount: 350,
            MpesaReceiptNumber: `LGR${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
            PhoneNumber: '254712345678',
            TransactionDate: '20250101120000',
          };

          // Call processCallback() — simulating the second call on an already-COMPLETED contribution
          const result = await service.processCallback(callbackData);

          // 1. SHALL return gracefully (no error thrown)
          expect(result).toBeDefined();
          expect(typeof result.success).toBe('boolean');
          expect(typeof result.message).toBe('string');

          // 2. SHALL NOT re-activate the subscription
          //    (subscription.update should never be called with isActive: true)
          const subscriptionActivationCalls =
            mockSubscriptionUpdate.mock.calls.filter(
              (call) => call[0]?.data?.isActive === true,
            );
          expect(subscriptionActivationCalls).toHaveLength(0);

          // 3. SHALL NOT create a new contribution record
          expect(mockContributionCreate).not.toHaveBeenCalled();

          // 4. The result message should indicate the transaction was not found
          //    (not a processing error — the idempotency guard is working correctly)
          expect(result.message).toBe('Transaction not found');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 11 (variant): subscription activation count stays at 1 after multiple callbacks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 36 })
          .filter((s) => s.trim().length > 0),
        fc.integer({ min: 2, max: 10 }), // number of duplicate callback calls
        async (memberId, duplicateCallCount) => {
          jest.clearAllMocks();

          const checkoutRequestId = `checkout_${memberId}`;
          const contributionId = `contrib_${memberId}`;

          // First call: contribution is PENDING — found and processed
          const pendingContribution = {
            id: contributionId,
            memberId,
            amount: 350,
            status: 'PENDING',
            metadata: {
              checkoutRequestId,
              merchantRequestId: `merchant_${memberId}`,
            },
            member: {
              id: memberId,
              phoneNumber: '+254712345678',
              fullName: 'Test Member',
              preferredLanguage: 'en',
              referredBy: null,
            },
          };

          const activeSubscription = {
            id: `sub_${memberId}`,
            memberId,
            tier: 'BRONZE',
            isActive: false, // not yet active before first callback
            paymentFrequency: 'MONTHLY',
            monthlyAmount: 350,
            member: {
              id: memberId,
              phoneNumber: '+254712345678',
              fullName: 'Test Member',
              preferredLanguage: 'en',
            },
          };

          // First call: PENDING contribution found
          mockContributionFindFirst
            .mockResolvedValueOnce(pendingContribution) // first call finds PENDING
            .mockResolvedValue(null); // subsequent calls find nothing (COMPLETED is invisible)

          mockContributionUpdate.mockResolvedValue({
            ...pendingContribution,
            status: 'COMPLETED',
          });

          mockSubscriptionFindUnique.mockResolvedValue(activeSubscription);
          mockSubscriptionUpdate.mockResolvedValue({
            ...activeSubscription,
            isActive: true,
          });

          mockMemberFindUnique.mockResolvedValue({
            id: memberId,
            referredBy: null,
          });

          const callbackData: PaymentCallbackData = {
            CheckoutRequestID: checkoutRequestId,
            MerchantRequestID: `merchant_${memberId}`,
            ResultCode: '0',
            ResultDesc: 'The service request is processed successfully.',
            Amount: 350,
            MpesaReceiptNumber: 'LGR12345678',
            PhoneNumber: '254712345678',
            TransactionDate: '20250101120000',
          };

          // First callback — processes the payment
          await service.processCallback(callbackData);

          const activationCountAfterFirst =
            mockSubscriptionUpdate.mock.calls.filter(
              (call) => call[0]?.data?.isActive === true,
            ).length;

          // Reset mocks to simulate subsequent duplicate callbacks
          // (contribution is now COMPLETED, so findFirst returns null)
          jest.clearAllMocks();
          mockContributionFindFirst.mockResolvedValue(null);
          mockContributionFindUnique.mockResolvedValue(null);

          // Duplicate callbacks (2nd through Nth)
          for (let i = 1; i < duplicateCallCount; i++) {
            await service.processCallback(callbackData);
          }

          // Subscription activation should have happened exactly once (in the first call)
          // The duplicate calls should not trigger any additional activations
          const activationCountAfterDuplicates =
            mockSubscriptionUpdate.mock.calls.filter(
              (call) => call[0]?.data?.isActive === true,
            ).length;

          expect(activationCountAfterFirst).toBe(1);
          expect(activationCountAfterDuplicates).toBe(0); // no new activations from duplicates
          expect(mockContributionCreate).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });
});
