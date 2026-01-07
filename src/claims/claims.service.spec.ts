import { Test, TestingModule } from '@nestjs/testing';
import { ClaimsService } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ClaimsService', () => {
  let service: ClaimsService;
  let prismaService: jest.Mocked<PrismaService>;
  let blockchainService: jest.Mocked<BlockchainService>;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
    },
    claim: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockBlockchainService = {
    processDisbursement: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BlockchainService, useValue: mockBlockchainService },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
    prismaService = module.get(PrismaService);
    blockchainService = module.get(BlockchainService);

    jest.clearAllMocks();
  });

  describe('createClaim', () => {
    it('should throw if no active subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.createClaim('member-1', 'CHECKUP', 'Routine checkup', 1000),
      ).rejects.toThrow('Active subscription required');
    });

    it('should throw if subscription is inactive', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: false,
      });

      await expect(
        service.createClaim('member-1', 'CHECKUP', 'Routine checkup', 1000),
      ).rejects.toThrow('Active subscription required');
    });

    it('should throw if annual claim limit reached', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: true,
      });
      // BRONZE tier has limit of 2 claims
      mockPrismaService.claim.findMany.mockResolvedValue([
        { id: 'cl1', amount: 2000, status: 'APPROVED' },
        { id: 'cl2', amount: 2000, status: 'DISBURSED' },
      ]);

      await expect(
        service.createClaim('member-1', 'CLEANING', 'Professional cleaning', 1000),
      ).rejects.toThrow('reached your annual claim limit');
    });

    it('should throw if claim would exceed amount limit', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'BRONZE',
        isActive: true,
      });
      // BRONZE tier has limit of 5000 KES
      mockPrismaService.claim.findMany.mockResolvedValue([
        { id: 'cl1', amount: 4500, status: 'APPROVED' },
      ]);

      await expect(
        service.createClaim('member-1', 'FILLING', 'Cavity filling', 1000),
      ).rejects.toThrow('exceed your annual limit');
    });

    it('should create claim successfully', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD',
        isActive: true,
      });
      mockPrismaService.claim.findMany.mockResolvedValue([]);
      mockPrismaService.claim.create.mockResolvedValue({
        id: 'claim-1',
        claimType: 'CHECKUP',
        description: 'Routine checkup',
        amount: 1000,
        status: 'PENDING',
      });

      const result = await service.createClaim(
        'member-1',
        'CHECKUP',
        'Routine checkup',
        1000,
      );

      expect(result.status).toBe('PENDING');
      expect(mockPrismaService.claim.create).toHaveBeenCalledWith({
        data: {
          memberId: 'member-1',
          claimType: 'CHECKUP',
          description: 'Routine checkup',
          amount: 1000,
          campId: undefined,
          status: 'PENDING',
        },
      });
    });

    it('should allow claims up to tier limits', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tier: 'GOLD', // 8 claims, 50000 KES limit
        isActive: true,
      });
      mockPrismaService.claim.findMany.mockResolvedValue([
        { id: 'cl1', amount: 10000, status: 'APPROVED' },
        { id: 'cl2', amount: 10000, status: 'DISBURSED' },
      ]);
      mockPrismaService.claim.create.mockResolvedValue({
        id: 'claim-3',
        amount: 25000,
        status: 'PENDING',
      });

      const result = await service.createClaim(
        'member-1',
        'EXTRACTION',
        'Wisdom tooth',
        25000,
      );

      expect(result.id).toBe('claim-3');
    });
  });

  describe('approveClaim', () => {
    it('should throw if claim not found', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(null);

      await expect(service.approveClaim('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update claim status to approved', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        id: 'claim-1',
        status: 'PENDING',
      });
      mockPrismaService.claim.update.mockResolvedValue({
        id: 'claim-1',
        status: 'APPROVED',
      });

      const result = await service.approveClaim('claim-1');

      expect(result.status).toBe('APPROVED');
    });
  });

  describe('processDisbursement', () => {
    it('should throw if claim not found', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(null);

      await expect(service.processDisbursement('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if claim not approved', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        id: 'claim-1',
        status: 'PENDING',
        member: { id: 'member-1' },
      });

      await expect(service.processDisbursement('claim-1')).rejects.toThrow(
        'Claim must be approved before disbursement',
      );
    });

    it('should process disbursement on blockchain', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        id: 'claim-1',
        status: 'APPROVED',
        memberId: 'member-1',
        amount: 5000,
        member: { id: 'member-1' },
      });
      mockPrismaService.claim.update
        .mockResolvedValueOnce({ status: 'PROCESSING' })
        .mockResolvedValueOnce({ status: 'DISBURSED', txHash: '0x123' });
      mockBlockchainService.processDisbursement.mockResolvedValue('0x123');

      await service.processDisbursement('claim-1');

      expect(mockBlockchainService.processDisbursement).toHaveBeenCalledWith(
        'member-1',
        5000,
        'claim-1',
      );
    });

    it('should throw if blockchain disbursement fails', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        id: 'claim-1',
        status: 'APPROVED',
        memberId: 'member-1',
        amount: 5000,
        member: { id: 'member-1' },
      });
      mockPrismaService.claim.update.mockResolvedValue({ status: 'PROCESSING' });
      mockBlockchainService.processDisbursement.mockRejectedValue(
        new Error('Blockchain error'),
      );

      await expect(service.processDisbursement('claim-1')).rejects.toThrow(
        'Disbursement processing failed',
      );
    });
  });

  describe('getMemberClaims', () => {
    it('should return claims with summary for subscribed member', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        tier: 'SILVER', // 4 claims, 15000 KES limit
      });
      
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const mockClaims = [
        { id: 'cl1', amount: 3000, status: 'DISBURSED', createdAt: new Date() },
        { id: 'cl2', amount: 2000, status: 'APPROVED', createdAt: new Date() },
        { id: 'cl3', amount: 1000, status: 'PENDING', createdAt: new Date() },
      ];
      mockPrismaService.claim.findMany.mockResolvedValue(mockClaims);

      const result = await service.getMemberClaims('member-1');

      expect(result.claims).toHaveLength(3);
      expect(result.summary).toEqual({
        claimsUsed: 2, // Only approved and disbursed count
        claimsRemaining: 2,
        amountClaimed: 5000,
        amountRemaining: 10000,
      });
    });

    it('should return null summary for unsubscribed member', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      mockPrismaService.claim.findMany.mockResolvedValue([]);

      const result = await service.getMemberClaims('member-1');

      expect(result.summary).toBeNull();
    });
  });
});
