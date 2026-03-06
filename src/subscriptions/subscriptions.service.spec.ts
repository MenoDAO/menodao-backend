import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prismaService: jest.Mocked<PrismaService>;
  let blockchainService: jest.Mocked<BlockchainService>;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    claim: {
      count: jest.fn(),
    },
    contribution: {
      findFirst: jest.fn(),
    },
  };

  const mockBlockchainService = {
    mintMembershipNFT: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BlockchainService, useValue: mockBlockchainService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prismaService = module.get(PrismaService);
    blockchainService = module.get(BlockchainService);

    jest.clearAllMocks();
  });

  describe('getPackages', () => {
    it('should return all package tiers with prices and benefits', () => {
      const packages = service.getPackages();

      expect(packages).toHaveLength(3);
      expect(packages.map((p) => p.tier)).toEqual(['BRONZE', 'SILVER', 'GOLD']);

      const bronze = packages.find((p) => p.tier === 'BRONZE');
      expect(bronze?.monthlyPrice).toBe(350);
      expect(bronze?.benefits).toContain('MenoBronze Package');

      const gold = packages.find((p) => p.tier === 'GOLD');
      expect(gold?.monthlyPrice).toBe(700);
      expect(gold?.benefits).toContain('Family discounts');
    });
  });

  describe('subscribe', () => {
    it('should throw if member already has active subscription to same tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: true,
        paymentFrequency: 'MONTHLY',
      });

      // Mock no previous contributions (so frequency check passes in dev mode)
      mockPrismaService.contribution.findFirst.mockResolvedValue(null);

      // Should throw when trying to subscribe to same tier
      await expect(service.subscribe('member-1', 'BRONZE')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.subscribe('member-1', 'BRONZE')).rejects.toThrow(
        'You already have an active subscription to this tier',
      );
    });

    it('should create inactive subscription requiring payment', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
        monthlyAmount: 550,
        isActive: false,
        paymentFrequency: 'MONTHLY',
        subscriptionStartDate: new Date(),
        annualCapUsed: 0,
        annualCapLimit: 10000,
        procedureUsageCount: {},
        lastResetDate: new Date(),
      });

      const result = await service.subscribe('member-1', 'SILVER');

      expect(mockPrismaService.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberId: 'member-1',
            tier: 'SILVER',
            monthlyAmount: 550,
            isActive: false,
            paymentFrequency: 'MONTHLY',
            annualCapLimit: 10000,
          }),
        }),
      );
      expect(result.paymentRequired).toBe(true);
      expect(result.subscription.tier).toBe('SILVER');
    });

    it('should update inactive subscription if it exists', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: false,
      });
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        monthlyAmount: 700,
        isActive: false,
      });

      const result = await service.subscribe('member-1', 'GOLD');

      expect(mockPrismaService.subscription.update).toHaveBeenCalled();
      expect(result.paymentRequired).toBe(true);
    });
  });

  describe('upgrade', () => {
    it('should throw if no existing subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(service.upgrade('member-1', 'GOLD')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if subscription is not active', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: false,
      });

      await expect(service.upgrade('member-1', 'GOLD')).rejects.toThrow(
        'Please activate your current subscription first',
      );
    });

    it('should throw if trying to upgrade to same or lower tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
        isActive: true,
      });

      await expect(service.upgrade('member-1', 'BRONZE')).rejects.toThrow(
        'Can only upgrade to a higher tier',
      );

      await expect(service.upgrade('member-1', 'SILVER')).rejects.toThrow(
        'Can only upgrade to a higher tier',
      );
    });

    it('should return payment required for upgrade', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: true,
        paymentFrequency: 'MONTHLY',
      });

      // Mock hasActiveClaims to return false (no claims made)
      mockPrismaService.claim.count.mockResolvedValue(0);

      const result = await service.upgrade('member-1', 'GOLD');

      expect(result.paymentRequired).toBe(true);
      expect(result.currentTier).toBe('BRONZE');
      expect(result.newTier).toBe('GOLD');
    });
  });

  describe('getSubscription', () => {
    it('should return null if no subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      const result = await service.getSubscription('member-1');

      expect(result).toBeNull();
    });

    it('should return subscription with benefits', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        monthlyAmount: 700,
      });

      const result = await service.getSubscription('member-1');

      expect(result?.tier).toBe('GOLD');
      expect(result?.benefits).toContain('MenoGold Package');
      expect(result?.benefits).toContain('Family discounts');
    });
  });
});
