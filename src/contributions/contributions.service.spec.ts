import { Test, TestingModule } from '@nestjs/testing';
import { ContributionsService } from './contributions.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentService } from '../payments/payment.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ContributionsService', () => {
  let service: ContributionsService;
  let prismaService: jest.Mocked<PrismaService>;
  let blockchainService: jest.Mocked<BlockchainService>;
  let paymentService: jest.Mocked<PaymentService>;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;

  const mockPrismaService = {
    member: {
      findUnique: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
    },
    contribution: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockBlockchainService = {
    recordContribution: jest.fn(),
  };

  const mockPaymentService = {
    initiateSTKPush: jest.fn(),
    validatePayment: jest.fn(),
    processCallback: jest.fn(),
  };

  const mockSubscriptionsService = {
    getPackages: jest.fn().mockReturnValue([
      { tier: 'BRONZE', monthlyPrice: 350, actualCharge: 350 },
      { tier: 'SILVER', monthlyPrice: 550, actualCharge: 550 },
      { tier: 'GOLD', monthlyPrice: 700, actualCharge: 700 },
    ]),
    activateSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BlockchainService, useValue: mockBlockchainService },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
      ],
    }).compile();

    service = module.get<ContributionsService>(ContributionsService);
    prismaService = module.get(PrismaService);
    blockchainService = module.get(BlockchainService);
    paymentService = module.get(PaymentService);
    subscriptionsService = module.get(SubscriptionsService);

    jest.clearAllMocks();
  });

  describe('initiatePayment', () => {
    it('should throw if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(
        service.initiatePayment('member-1', 500, 'MPESA'),
      ).rejects.toThrow('Member not found');
    });

    it('should throw if member has no subscription', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: null,
      });

      await expect(
        service.initiatePayment('member-1', 500, 'MPESA'),
      ).rejects.toThrow('Please subscribe to a package first');
    });

    it('should create pending contribution and initiate STK push', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { tier: 'SILVER', monthlyAmount: 550 },
      });
      mockPrismaService.contribution.create.mockResolvedValue({
        id: 'contrib-1',
        amount: 550,
        status: 'PENDING',
      });
      mockPaymentService.initiateSTKPush.mockResolvedValue({
        success: true,
        reference: 'menodao_123',
        checkoutRequestId: 'checkout-123',
      });

      const result = await service.initiatePayment('member-1', 550, 'MPESA');

      expect(mockPrismaService.contribution.create).toHaveBeenCalled();
      expect(mockPaymentService.initiateSTKPush).toHaveBeenCalled();
      expect(result.contributionId).toBe('contrib-1');
      expect(result.status).toBe('PENDING');
    });

    it('should fail contribution if STK push fails', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { tier: 'BRONZE', monthlyAmount: 350 },
      });
      mockPrismaService.contribution.create.mockResolvedValue({
        id: 'contrib-1',
      });
      mockPrismaService.contribution.update.mockResolvedValue({
        id: 'contrib-1',
        status: 'FAILED',
      });
      mockPaymentService.initiateSTKPush.mockResolvedValue({
        success: false,
        error: 'STK push failed',
      });

      await expect(
        service.initiatePayment('member-1', 350, 'MPESA'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmPayment', () => {
    it('should throw if contribution not found', async () => {
      mockPrismaService.contribution.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPayment('invalid-id', 'ref-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should record contribution on blockchain', async () => {
      mockPrismaService.contribution.findUnique.mockResolvedValue({
        id: 'contrib-1',
        memberId: 'member-1',
        amount: 500,
        member: { id: 'member-1' },
      });
      mockPrismaService.contribution.update.mockResolvedValue({
        id: 'contrib-1',
        status: 'COMPLETED',
        txHash: '0x123',
      });
      mockBlockchainService.recordContribution.mockResolvedValue('0x123');

      await service.confirmPayment('contrib-1', 'mpesa-ref');

      expect(mockBlockchainService.recordContribution).toHaveBeenCalledWith(
        'member-1',
        500,
      );
    });

    it('should update contribution status to completed', async () => {
      mockPrismaService.contribution.findUnique.mockResolvedValue({
        id: 'contrib-1',
        memberId: 'member-1',
        amount: 500,
        member: { id: 'member-1' },
      });
      mockPrismaService.contribution.update.mockResolvedValue({
        id: 'contrib-1',
        status: 'COMPLETED',
      });
      mockBlockchainService.recordContribution.mockResolvedValue('0x123');

      await service.confirmPayment('contrib-1', 'mpesa-ref');

      expect(mockPrismaService.contribution.update).toHaveBeenCalledWith({
        where: { id: 'contrib-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          paymentRef: 'mpesa-ref',
        }),
      });
    });

    it('should continue if blockchain recording fails', async () => {
      mockPrismaService.contribution.findUnique.mockResolvedValue({
        id: 'contrib-1',
        memberId: 'member-1',
        amount: 500,
        member: { id: 'member-1' },
      });
      mockPrismaService.contribution.update.mockResolvedValue({
        id: 'contrib-1',
        status: 'COMPLETED',
        txHash: null,
      });
      mockBlockchainService.recordContribution.mockRejectedValue(
        new Error('Blockchain error'),
      );

      // Should not throw
      const result = await service.confirmPayment('contrib-1', 'mpesa-ref');
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('getSummary', () => {
    it('should calculate total contributions', async () => {
      mockPrismaService.contribution.findMany.mockResolvedValue([
        { id: 'c1', amount: 500, status: 'COMPLETED' },
        { id: 'c2', amount: 500, status: 'COMPLETED' },
        { id: 'c3', amount: 700, status: 'COMPLETED' },
      ]);

      const result = await service.getSummary('member-1');

      expect(result.totalContributed).toBe(1700);
      expect(result.monthsContributed).toBe(3);
    });

    it('should return recent contributions', async () => {
      const contributions = [
        { id: 'c1', amount: 500 },
        { id: 'c2', amount: 500 },
        { id: 'c3', amount: 500 },
        { id: 'c4', amount: 500 },
        { id: 'c5', amount: 500 },
        { id: 'c6', amount: 500 },
      ];
      mockPrismaService.contribution.findMany.mockResolvedValue(contributions);

      const result = await service.getSummary('member-1');

      expect(result.recentContributions).toHaveLength(5);
    });

    it('should return zero for members with no contributions', async () => {
      mockPrismaService.contribution.findMany.mockResolvedValue([]);

      const result = await service.getSummary('member-1');

      expect(result.totalContributed).toBe(0);
      expect(result.monthsContributed).toBe(0);
    });
  });

  describe('handlePaymentCallback', () => {
    it('should process callback via payment service', async () => {
      mockPaymentService.processCallback.mockResolvedValue({
        success: true,
        message: 'Payment processed',
      });

      const result = await service.handlePaymentCallback({
        ResultCode: '0',
        Paid: true,
      } as any);

      expect(mockPaymentService.processCallback).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('checkPaymentStatus', () => {
    it('should throw if contribution not found', async () => {
      mockPrismaService.contribution.findFirst.mockResolvedValue(null);

      await expect(
        service.checkPaymentStatus('invalid-id', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return contribution status', async () => {
      mockPrismaService.contribution.findFirst.mockResolvedValue({
        id: 'contrib-1',
        status: 'COMPLETED',
        amount: 500,
        paymentRef: 'ref-123',
        txHash: '0x123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.checkPaymentStatus('contrib-1', 'member-1');

      expect(result.contributionId).toBe('contrib-1');
      expect(result.status).toBe('COMPLETED');
    });
  });
});
