import { Test, TestingModule } from '@nestjs/testing';
import { ContributionsService } from './contributions.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ContributionsService', () => {
  let service: ContributionsService;
  let prismaService: jest.Mocked<PrismaService>;
  let blockchainService: jest.Mocked<BlockchainService>;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
    },
    contribution: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockBlockchainService = {
    recordContribution: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BlockchainService, useValue: mockBlockchainService },
      ],
    }).compile();

    service = module.get<ContributionsService>(ContributionsService);
    prismaService = module.get(PrismaService);
    blockchainService = module.get(BlockchainService);

    jest.clearAllMocks();
  });

  describe('initiatePayment', () => {
    it('should throw if member has no subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.initiatePayment('member-1', 500, 'MPESA'),
      ).rejects.toThrow('Please subscribe to a package first');
    });

    it('should create pending contribution record', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
      });
      mockPrismaService.contribution.create.mockResolvedValue({
        id: 'contrib-1',
        amount: 500,
        paymentMethod: 'MPESA',
        status: 'PENDING',
      });

      const result = await service.initiatePayment('member-1', 500, 'MPESA');

      expect(mockPrismaService.contribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memberId: 'member-1',
          amount: 500,
          paymentMethod: 'MPESA',
          status: 'PENDING',
        }),
      });
      expect(result.contributionId).toBe('contrib-1');
      expect(result.status).toBe('PENDING');
    });

    it('should include payment method in response', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
      });
      mockPrismaService.contribution.create.mockResolvedValue({
        id: 'contrib-1',
        amount: 300,
        paymentMethod: 'CARD',
        status: 'PENDING',
      });

      const result = await service.initiatePayment('member-1', 300, 'CARD');

      expect(result.paymentMethod).toBe('CARD');
      expect(result.amount).toBe(300);
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

  describe('handlePaymentWebhook', () => {
    it('should confirm payment on success', async () => {
      const confirmSpy = jest.spyOn(service, 'confirmPayment').mockResolvedValue({} as any);
      
      await service.handlePaymentWebhook({
        contributionId: 'contrib-1',
        status: 'success',
        reference: 'ref-123',
      });

      expect(confirmSpy).toHaveBeenCalledWith('contrib-1', 'ref-123');
    });

    it('should mark as failed on failure', async () => {
      mockPrismaService.contribution.update.mockResolvedValue({
        id: 'contrib-1',
        status: 'FAILED',
      });

      await service.handlePaymentWebhook({
        contributionId: 'contrib-1',
        status: 'failed',
        reference: 'ref-123',
      });

      expect(mockPrismaService.contribution.update).toHaveBeenCalledWith({
        where: { id: 'contrib-1' },
        data: { status: 'FAILED' },
      });
    });
  });
});
