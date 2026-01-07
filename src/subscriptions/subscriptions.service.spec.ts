import { Test, TestingModule } from '@nestjs/testing';
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
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockBlockchainService = {
    mintMembershipNFT: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BlockchainService, useValue: mockBlockchainService },
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
      expect(packages.map(p => p.tier)).toEqual(['BRONZE', 'SILVER', 'GOLD']);
      
      const bronze = packages.find(p => p.tier === 'BRONZE');
      expect(bronze?.monthlyPrice).toBe(300);
      expect(bronze?.benefits).toContain('Annual dental checkup');

      const gold = packages.find(p => p.tier === 'GOLD');
      expect(gold?.monthlyPrice).toBe(700);
      expect(gold?.benefits).toContain('Family discounts');
    });
  });

  describe('subscribe', () => {
    it('should throw if member already has subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
      });

      await expect(service.subscribe('member-1', 'SILVER')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.subscribe('member-1', 'SILVER')).rejects.toThrow(
        'Member already has a subscription',
      );
    });

    it('should create subscription with correct tier and price', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
        monthlyAmount: 500,
      });
      mockBlockchainService.mintMembershipNFT.mockResolvedValue('0x123');

      const result = await service.subscribe('member-1', 'SILVER');

      expect(mockPrismaService.subscription.create).toHaveBeenCalledWith({
        data: {
          memberId: 'member-1',
          tier: 'SILVER',
          monthlyAmount: 500,
        },
      });
      expect(result.tier).toBe('SILVER');
    });

    it('should mint NFT for new subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        monthlyAmount: 700,
      });
      mockBlockchainService.mintMembershipNFT.mockResolvedValue('0x123');

      await service.subscribe('member-1', 'GOLD');

      expect(mockBlockchainService.mintMembershipNFT).toHaveBeenCalledWith(
        'member-1',
        'GOLD',
      );
    });

    it('should not fail if NFT minting fails', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        monthlyAmount: 300,
      });
      mockBlockchainService.mintMembershipNFT.mockRejectedValue(new Error('Blockchain error'));

      // Should not throw
      const result = await service.subscribe('member-1', 'BRONZE');
      expect(result.tier).toBe('BRONZE');
    });
  });

  describe('upgrade', () => {
    it('should throw if no existing subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(service.upgrade('member-1', 'GOLD')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if trying to upgrade to same or lower tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
      });

      await expect(service.upgrade('member-1', 'BRONZE')).rejects.toThrow(
        'Can only upgrade to a higher tier',
      );

      await expect(service.upgrade('member-1', 'SILVER')).rejects.toThrow(
        'Can only upgrade to a higher tier',
      );
    });

    it('should upgrade subscription to higher tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        monthlyAmount: 700,
      });
      mockBlockchainService.mintMembershipNFT.mockResolvedValue('0x123');

      const result = await service.upgrade('member-1', 'GOLD');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { memberId: 'member-1' },
        data: {
          tier: 'GOLD',
          monthlyAmount: 700,
        },
      });
      expect(result.tier).toBe('GOLD');
    });

    it('should mint new NFT for upgraded tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'SILVER',
      });
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        monthlyAmount: 700,
      });
      mockBlockchainService.mintMembershipNFT.mockResolvedValue('0x123');

      await service.upgrade('member-1', 'GOLD');

      expect(mockBlockchainService.mintMembershipNFT).toHaveBeenCalledWith(
        'member-1',
        'GOLD',
      );
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
      expect(result?.benefits).toContain('Quarterly dental checkups');
      expect(result?.benefits).toContain('Family discounts');
    });
  });
});
