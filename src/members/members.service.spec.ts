import { Test, TestingModule } from '@nestjs/testing';
import { MembersService } from './members.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('MembersService', () => {
  let service: MembersService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    member: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    contribution: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    claim: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    blockchainTransaction: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
    prismaService = module.get(PrismaService);

    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return member with related data', async () => {
      const mockMember = {
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { tier: 'GOLD' },
        contributions: [],
        claims: [],
        nfts: [],
      };
      mockPrismaService.member.findUnique.mockResolvedValue(mockMember);

      const result = await service.findById('member-1');

      expect(result).toEqual(mockMember);
      expect(mockPrismaService.member.findUnique).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        include: expect.objectContaining({
          subscription: true,
          nfts: true,
        }),
      });
    });

    it('should throw NotFoundException if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update member profile', async () => {
      const updateDto = { fullName: 'Updated Name', location: 'Mombasa' };
      const mockUpdatedMember = {
        id: 'member-1',
        fullName: 'Updated Name',
        location: 'Mombasa',
        subscription: { tier: 'SILVER' },
      };
      mockPrismaService.member.update.mockResolvedValue(mockUpdatedMember);

      const result = await service.update('member-1', updateDto);

      expect(mockPrismaService.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: updateDto,
        include: { subscription: true },
      });
      expect(result).toEqual(mockUpdatedMember);
    });
  });

  describe('getContributionHistory', () => {
    it('should return paginated contributions', async () => {
      const mockContributions = [
        { id: 'c1', amount: 500 },
        { id: 'c2', amount: 500 },
      ];
      mockPrismaService.contribution.findMany.mockResolvedValue(mockContributions);
      mockPrismaService.contribution.count.mockResolvedValue(10);

      const result = await service.getContributionHistory('member-1', 1, 20);

      expect(result.data).toEqual(mockContributions);
      expect(result.meta).toEqual({
        total: 10,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should calculate correct pagination', async () => {
      mockPrismaService.contribution.findMany.mockResolvedValue([]);
      mockPrismaService.contribution.count.mockResolvedValue(45);

      const result = await service.getContributionHistory('member-1', 2, 20);

      expect(mockPrismaService.contribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('getClaimHistory', () => {
    it('should return paginated claims with camp info', async () => {
      const mockClaims = [
        { id: 'cl1', amount: 1000, camp: { name: 'Camp A' } },
      ];
      mockPrismaService.claim.findMany.mockResolvedValue(mockClaims);
      mockPrismaService.claim.count.mockResolvedValue(5);

      const result = await service.getClaimHistory('member-1', 1, 10);

      expect(mockPrismaService.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { camp: true },
        }),
      );
      expect(result.data).toEqual(mockClaims);
    });
  });

  describe('getTransactionHistory', () => {
    it('should return paginated blockchain transactions', async () => {
      const mockTxs = [
        { id: 'tx1', txHash: '0x123', txType: 'CONTRIBUTION' },
      ];
      mockPrismaService.blockchainTransaction.findMany.mockResolvedValue(mockTxs);
      mockPrismaService.blockchainTransaction.count.mockResolvedValue(25);

      const result = await service.getTransactionHistory('member-1', 1, 20);

      expect(result.data).toEqual(mockTxs);
      expect(result.meta.totalPages).toBe(2);
    });
  });
});
