import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from './blockchain.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('BlockchainService', () => {
  let service: BlockchainService;
  let prismaService: jest.Mocked<PrismaService>;
  let configService: jest.Mocked<ConfigService>;

  const mockPrismaService = {
    member: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    nFT: {
      create: jest.fn(),
    },
    blockchainTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined), // No blockchain config = mock mode
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    prismaService = module.get(PrismaService);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('mintMembershipNFT (mock mode)', () => {
    it('should throw if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(
        service.mintMembershipNFT('invalid-id', 'GOLD'),
      ).rejects.toThrow('Member not found');
    });

    it('should create NFT record in mock mode', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.nFT.create.mockResolvedValue({
        id: 'nft-1',
        tier: 'GOLD',
      });

      const result = await service.mintMembershipNFT('member-1', 'GOLD');

      expect(result).toMatch(/^0x/); // Should return mock tx hash
      expect(mockPrismaService.nFT.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memberId: 'member-1',
          tier: 'GOLD',
        }),
      });
    });

    it('should create NFT for different tiers', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
      });
      mockPrismaService.nFT.create.mockResolvedValue({});

      await service.mintMembershipNFT('member-1', 'BRONZE');
      expect(mockPrismaService.nFT.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tier: 'BRONZE' }),
      });

      await service.mintMembershipNFT('member-1', 'SILVER');
      expect(mockPrismaService.nFT.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tier: 'SILVER' }),
      });
    });
  });

  describe('recordContribution (mock mode)', () => {
    it('should throw if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(
        service.recordContribution('invalid-id', 500),
      ).rejects.toThrow('Member not found');
    });

    it('should create blockchain transaction record', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        walletAddress: '0x123',
      });
      mockPrismaService.blockchainTransaction.create.mockResolvedValue({});

      const result = await service.recordContribution('member-1', 500);

      expect(result).toMatch(/^0x/);
      expect(
        mockPrismaService.blockchainTransaction.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          txType: 'CONTRIBUTION',
          amount: '500',
          memberId: 'member-1',
          status: 'CONFIRMED',
        }),
      });
    });
  });

  describe('processDisbursement (mock mode)', () => {
    it('should throw if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(
        service.processDisbursement('invalid-id', 1000, 'claim-1'),
      ).rejects.toThrow('Member not found');
    });

    it('should create disbursement transaction', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: 'member-1',
        walletAddress: '0x456',
      });
      mockPrismaService.blockchainTransaction.create.mockResolvedValue({});

      const result = await service.processDisbursement(
        'member-1',
        5000,
        'claim-1',
      );

      expect(result).toMatch(/^0x/);
      expect(
        mockPrismaService.blockchainTransaction.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          txType: 'CLAIM_DISBURSEMENT',
          amount: '5000',
          memberId: 'member-1',
        }),
      });
    });
  });

  describe('getTransaction', () => {
    it('should return transaction by hash', async () => {
      const mockTx = {
        id: 'tx-1',
        txHash: '0x123',
        txType: 'CONTRIBUTION',
      };
      mockPrismaService.blockchainTransaction.findUnique.mockResolvedValue(
        mockTx,
      );

      const result = await service.getTransaction('0x123');

      expect(result).toEqual(mockTx);
      expect(
        mockPrismaService.blockchainTransaction.findUnique,
      ).toHaveBeenCalledWith({
        where: { txHash: '0x123' },
      });
    });

    it('should return null for non-existent transaction', async () => {
      mockPrismaService.blockchainTransaction.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.getTransaction('0xnonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAllTransactions', () => {
    it('should return paginated transactions', async () => {
      const mockTxs = [
        { id: 'tx-1', txHash: '0x123' },
        { id: 'tx-2', txHash: '0x456' },
      ];
      mockPrismaService.blockchainTransaction.findMany.mockResolvedValue(
        mockTxs,
      );
      mockPrismaService.blockchainTransaction.count.mockResolvedValue(100);

      const result = await service.getAllTransactions(1, 50);

      expect(result.data).toEqual(mockTxs);
      expect(result.meta).toEqual({
        total: 100,
        page: 1,
        limit: 50,
        totalPages: 2,
      });
    });

    it('should calculate correct skip for pagination', async () => {
      mockPrismaService.blockchainTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.blockchainTransaction.count.mockResolvedValue(0);

      await service.getAllTransactions(3, 50);

      expect(
        mockPrismaService.blockchainTransaction.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 100,
          take: 50,
        }),
      );
    });

    it('should order transactions by creation date descending', async () => {
      mockPrismaService.blockchainTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.blockchainTransaction.count.mockResolvedValue(0);

      await service.getAllTransactions();

      expect(
        mockPrismaService.blockchainTransaction.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
