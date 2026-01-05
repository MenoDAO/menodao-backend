import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { PackageTier, TransactionType, TxStatus } from '@prisma/client';

// Simplified ABI for MenoDAO NFT contract
const NFT_ABI = [
  'function mint(address to, uint256 tier) external returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function balanceOf(address owner) external view returns (uint256)',
];

// Simplified ABI for Treasury contract
const TREASURY_ABI = [
  'function recordContribution(address member, uint256 amount) external',
  'function disburse(address to, uint256 amount, string calldata claimId) external',
  'event ContributionRecorded(address indexed member, uint256 amount, uint256 timestamp)',
  'event Disbursement(address indexed to, uint256 amount, string claimId)',
];

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private nftContract: ethers.Contract;
  private treasuryContract: ethers.Contract;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.initializeBlockchain();
  }

  private initializeBlockchain() {
    const rpcUrl = this.configService.get<string>('POLYGON_RPC_URL');
    const privateKey = this.configService.get<string>('PRIVATE_KEY');
    const nftAddress = this.configService.get<string>('NFT_CONTRACT_ADDRESS');
    const treasuryAddress = this.configService.get<string>('TREASURY_CONTRACT_ADDRESS');

    if (!rpcUrl || !privateKey) {
      this.logger.warn('Blockchain not configured - running in mock mode');
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);

      if (nftAddress && nftAddress !== '0x...') {
        this.nftContract = new ethers.Contract(nftAddress, NFT_ABI, this.wallet);
      }

      if (treasuryAddress && treasuryAddress !== '0x...') {
        this.treasuryContract = new ethers.Contract(treasuryAddress, TREASURY_ABI, this.wallet);
      }

      this.logger.log('Blockchain service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize blockchain:', error);
    }
  }

  /**
   * Mint membership NFT for a member
   */
  async mintMembershipNFT(memberId: string, tier: PackageTier): Promise<string> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    // Mock mode if blockchain not configured
    if (!this.nftContract) {
      this.logger.log(`[MOCK] Minting ${tier} NFT for member ${memberId}`);
      const mockTxHash = `0x${Buffer.from(Date.now().toString()).toString('hex').padEnd(64, '0')}`;
      
      await this.prisma.nFT.create({
        data: {
          memberId,
          tokenId: `mock-${Date.now()}`,
          tier,
          contractAddress: '0x0000000000000000000000000000000000000000',
          txHash: mockTxHash,
        },
      });

      return mockTxHash;
    }

    // Get or create wallet address for member
    let walletAddress = member.walletAddress;
    if (!walletAddress) {
      // In production, you'd integrate with a wallet provider
      // For now, generate a deterministic address
      walletAddress = ethers.keccak256(ethers.toUtf8Bytes(memberId)).slice(0, 42);
      await this.prisma.member.update({
        where: { id: memberId },
        data: { walletAddress },
      });
    }

    const tierValue = { BRONZE: 1, SILVER: 2, GOLD: 3 }[tier];

    try {
      const tx = await this.nftContract.mint(walletAddress, tierValue);
      const receipt = await tx.wait();

      // Record transaction
      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.NFT_MINT,
          fromAddress: this.wallet.address,
          toAddress: walletAddress,
          tokenId: tierValue.toString(),
          network: 'polygon',
          status: TxStatus.CONFIRMED,
          blockNumber: receipt.blockNumber,
          memberId,
        },
      });

      // Record NFT
      await this.prisma.nFT.create({
        data: {
          memberId,
          tokenId: receipt.hash, // Would parse from event logs
          tier,
          contractAddress: await this.nftContract.getAddress(),
          txHash: receipt.hash,
        },
      });

      return receipt.hash;
    } catch (error) {
      this.logger.error('NFT minting failed:', error);
      throw error;
    }
  }

  /**
   * Record contribution on-chain
   */
  async recordContribution(memberId: string, amountKES: number): Promise<string> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    // Mock mode
    if (!this.treasuryContract) {
      this.logger.log(`[MOCK] Recording contribution of KES ${amountKES} for member ${memberId}`);
      const mockTxHash = `0x${Buffer.from(`contrib-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      
      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: mockTxHash,
          txType: TransactionType.CONTRIBUTION,
          fromAddress: member.walletAddress || '0x0',
          toAddress: '0x0000000000000000000000000000000000000000',
          amount: amountKES.toString(),
          network: 'polygon',
          status: TxStatus.CONFIRMED,
          memberId,
        },
      });

      return mockTxHash;
    }

    const walletAddress = member.walletAddress || '0x0000000000000000000000000000000000000000';

    try {
      const tx = await this.treasuryContract.recordContribution(
        walletAddress,
        ethers.parseUnits(amountKES.toString(), 18),
      );
      const receipt = await tx.wait();

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.CONTRIBUTION,
          fromAddress: walletAddress,
          toAddress: await this.treasuryContract.getAddress(),
          amount: amountKES.toString(),
          network: 'polygon',
          status: TxStatus.CONFIRMED,
          blockNumber: receipt.blockNumber,
          memberId,
        },
      });

      return receipt.hash;
    } catch (error) {
      this.logger.error('Contribution recording failed:', error);
      throw error;
    }
  }

  /**
   * Process claim disbursement on-chain
   */
  async processDisbursement(memberId: string, amountKES: number, claimId: string): Promise<string> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    // Mock mode
    if (!this.treasuryContract) {
      this.logger.log(`[MOCK] Disbursing KES ${amountKES} for claim ${claimId}`);
      const mockTxHash = `0x${Buffer.from(`disburse-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      
      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: mockTxHash,
          txType: TransactionType.CLAIM_DISBURSEMENT,
          fromAddress: '0x0000000000000000000000000000000000000000',
          toAddress: member.walletAddress || '0x0',
          amount: amountKES.toString(),
          network: 'polygon',
          status: TxStatus.CONFIRMED,
          memberId,
        },
      });

      return mockTxHash;
    }

    const walletAddress = member.walletAddress;
    if (!walletAddress) {
      throw new Error('Member has no wallet address');
    }

    try {
      const tx = await this.treasuryContract.disburse(
        walletAddress,
        ethers.parseUnits(amountKES.toString(), 18),
        claimId,
      );
      const receipt = await tx.wait();

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.CLAIM_DISBURSEMENT,
          fromAddress: await this.treasuryContract.getAddress(),
          toAddress: walletAddress,
          amount: amountKES.toString(),
          network: 'polygon',
          status: TxStatus.CONFIRMED,
          blockNumber: receipt.blockNumber,
          memberId,
        },
      });

      return receipt.hash;
    } catch (error) {
      this.logger.error('Disbursement failed:', error);
      throw error;
    }
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(txHash: string) {
    return this.prisma.blockchainTransaction.findUnique({
      where: { txHash },
    });
  }

  /**
   * Get all transactions (for public auditability)
   */
  async getAllTransactions(page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.blockchainTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blockchainTransaction.count(),
    ]);

    return {
      data: transactions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
