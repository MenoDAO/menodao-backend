import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { PackageTier, TransactionType, TxStatus } from '@prisma/client';
import {
  ChainId,
  CHAIN_CONFIGS,
  getChainConfig,
  DEFAULT_CHAIN,
} from './chains.config';

// Simplified ABI for MenoDAO NFT contract
const NFT_ABI = [
  'function mint(address to, uint256 tier) external returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) external view returns (address)',
];

// Simplified ABI for Treasury contract
const TREASURY_ABI = [
  'function recordContribution(address member, uint256 amount) external',
  'function disburse(address to, uint256 amount, string calldata claimId) external',
  'event ContributionRecorded(address indexed member, uint256 amount, uint256 timestamp)',
  'event Disbursement(address indexed to, uint256 amount, string claimId)',
];

interface ChainConnection {
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  nftContract?: ethers.Contract;
  treasuryContract?: ethers.Contract;
}

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private chains: Map<ChainId, ChainConnection> = new Map();
  private defaultChain: ChainId;
  private isTestnet: boolean;
  private masterWallet: ethers.Wallet;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.isTestnet = this.configService.get('NODE_ENV') !== 'production';
    this.defaultChain =
      (this.configService.get('DEFAULT_CHAIN') as ChainId) || DEFAULT_CHAIN;
    this.initializeBlockchain();
  }

  private initializeBlockchain() {
    const privateKey = this.configService.get<string>('BLOCKCHAIN_PRIVATE_KEY');

    if (!privateKey) {
      this.logger.warn('Blockchain not configured - running in mock mode');
      return;
    }

    // Initialize connections for all supported chains
    for (const chainId of Object.keys(CHAIN_CONFIGS) as ChainId[]) {
      try {
        const config = getChainConfig(chainId, this.isTestnet);
        const provider = new ethers.JsonRpcProvider(config.activeRpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);

        // Get chain-specific contract addresses from env
        const nftAddress = this.configService.get<string>(
          `${chainId.toUpperCase()}_NFT_CONTRACT`,
        );
        const treasuryAddress = this.configService.get<string>(
          `${chainId.toUpperCase()}_TREASURY_CONTRACT`,
        );

        const connection: ChainConnection = { provider, wallet };

        if (nftAddress && nftAddress !== '0x...') {
          connection.nftContract = new ethers.Contract(
            nftAddress,
            NFT_ABI,
            wallet,
          );
        }

        if (treasuryAddress && treasuryAddress !== '0x...') {
          connection.treasuryContract = new ethers.Contract(
            treasuryAddress,
            TREASURY_ABI,
            wallet,
          );
        }

        this.chains.set(chainId, connection);
        this.logger.log(
          `Chain ${chainId} initialized (${this.isTestnet ? 'testnet' : 'mainnet'})`,
        );
      } catch (error) {
        this.logger.error(`Failed to initialize ${chainId}:`, error);
      }
    }

    // Store master wallet for custodial operations
    if (this.chains.size > 0) {
      const defaultConnection = this.chains.get(this.defaultChain);
      if (defaultConnection) {
        this.masterWallet = defaultConnection.wallet;
      }
    }

    this.logger.log(
      `Blockchain service initialized with ${this.chains.size} chains`,
    );
  }

  /**
   * Get connection for a specific chain
   */
  private getChain(chainId?: ChainId): ChainConnection | undefined {
    return this.chains.get(chainId || this.defaultChain);
  }

  /**
   * Get supported chains
   */
  getSupportedChains() {
    return Object.entries(CHAIN_CONFIGS).map(([id, config]) => ({
      id,
      name: config.name,
      chainId:
        this.isTestnet && config.testnet
          ? config.testnet.chainId
          : config.chainId,
      explorerUrl:
        this.isTestnet && config.testnet
          ? config.testnet.explorerUrl
          : config.explorerUrl,
      isTestnet: this.isTestnet,
      isConfigured: this.chains.has(id as ChainId),
    }));
  }

  /**
   * Create a custodial wallet for a member
   * Generates a deterministic wallet from member ID + master key
   */
  async createCustodialWallet(memberId: string): Promise<string> {
    // Check if member already has a wallet
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (member?.walletAddress) {
      return member.walletAddress;
    }

    // Generate deterministic wallet from member ID
    // Using keccak256 hash of memberId + salt for security
    const salt = this.configService.get('WALLET_SALT') || 'menodao-custodial';
    const seed = ethers.keccak256(ethers.toUtf8Bytes(`${memberId}-${salt}`));
    const wallet = new ethers.Wallet(seed);

    // Store wallet address (not private key - that's derived deterministically)
    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        walletAddress: wallet.address,
        // Store metadata about the wallet
      },
    });

    this.logger.log(
      `Custodial wallet created for member ${memberId}: ${wallet.address}`,
    );
    return wallet.address;
  }

  /**
   * Get or create custodial wallet for member
   */
  async getOrCreateWallet(memberId: string): Promise<string> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (member?.walletAddress) {
      return member.walletAddress;
    }

    return this.createCustodialWallet(memberId);
  }

  /**
   * Derive custodial wallet private key for a member (for signing)
   * IMPORTANT: Only call this server-side, never expose to client
   */
  private deriveCustodialKey(memberId: string): string {
    const salt = this.configService.get('WALLET_SALT') || 'menodao-custodial';
    return ethers.keccak256(ethers.toUtf8Bytes(`${memberId}-${salt}`));
  }

  /**
   * Get custodial wallet signer for a member
   */
  private getCustodialSigner(
    memberId: string,
    chainId?: ChainId,
  ): ethers.Wallet {
    const chain = this.getChain(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId || this.defaultChain} not configured`);
    }

    const privateKey = this.deriveCustodialKey(memberId);
    return new ethers.Wallet(privateKey, chain.provider);
  }

  /**
   * Mint membership NFT for a member (multi-chain support)
   */
  async mintMembershipNFT(
    memberId: string,
    tier: PackageTier,
    chainId?: ChainId,
  ): Promise<string> {
    const targetChain = chainId || this.defaultChain;
    const chain = this.getChain(targetChain);

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    // Get or create custodial wallet
    const walletAddress = await this.getOrCreateWallet(memberId);

    // Mock mode if blockchain not configured
    if (!chain?.nftContract) {
      this.logger.log(
        `[MOCK] Minting ${tier} NFT on ${targetChain} for member ${memberId}`,
      );
      const mockTxHash = `0x${Buffer.from(Date.now().toString()).toString('hex').padEnd(64, '0')}`;

      await this.prisma.nFT.create({
        data: {
          memberId,
          tokenId: `mock-${Date.now()}`,
          tier,
          contractAddress: '0x0000000000000000000000000000000000000000',
          txHash: mockTxHash,
          metadata: {
            chain: targetChain,
            isMock: true,
            mintedAt: new Date().toISOString(),
          },
        },
      });

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: mockTxHash,
          txType: TransactionType.NFT_MINT,
          fromAddress: '0x0000000000000000000000000000000000000000',
          toAddress: walletAddress,
          tokenId: `mock-${tier}-${Date.now()}`,
          network: targetChain,
          status: TxStatus.CONFIRMED,
          memberId,
        },
      });

      return mockTxHash;
    }

    const tierValue = { BRONZE: 1, SILVER: 2, GOLD: 3 }[tier];

    try {
      this.logger.log(
        `Minting ${tier} NFT on ${targetChain} for ${walletAddress}`,
      );

      const tx = await chain.nftContract.mint(walletAddress, tierValue);
      const receipt = await tx.wait();

      const contractAddress = await chain.nftContract.getAddress();

      // Record transaction
      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.NFT_MINT,
          fromAddress: chain.wallet.address,
          toAddress: walletAddress,
          tokenId: tierValue.toString(),
          network: targetChain,
          status: TxStatus.CONFIRMED,
          blockNumber: receipt.blockNumber,
          memberId,
        },
      });

      // Record NFT
      await this.prisma.nFT.create({
        data: {
          memberId,
          tokenId: receipt.hash, // Would parse from event logs in production
          tier,
          contractAddress,
          txHash: receipt.hash,
          metadata: {
            chain: targetChain,
            chainId: getChainConfig(targetChain, this.isTestnet).activeChainId,
            explorerUrl: `${getChainConfig(targetChain, this.isTestnet).activeExplorerUrl}/tx/${receipt.hash}`,
          },
        },
      });

      this.logger.log(`NFT minted successfully: ${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      this.logger.error('NFT minting failed:', error);
      throw error;
    }
  }

  /**
   * Get member's NFTs across all chains
   */
  async getMemberNFTs(memberId: string) {
    const nfts = await this.prisma.nFT.findMany({
      where: { memberId },
      orderBy: { mintedAt: 'desc' },
    });

    return nfts.map((nft) => ({
      ...nft,
      chain: (nft.metadata as any)?.chain || 'polygon',
      explorerUrl: (nft.metadata as any)?.explorerUrl,
      isCustodial: true, // All NFTs start as custodial
    }));
  }

  /**
   * Transfer NFT to external wallet (claim)
   */
  async claimNFT(
    memberId: string,
    nftId: string,
    externalWallet: string,
  ): Promise<string> {
    const nft = await this.prisma.nFT.findFirst({
      where: { id: nftId, memberId },
    });

    if (!nft) {
      throw new Error('NFT not found or not owned by member');
    }

    const chainId =
      ((nft.metadata as any)?.chain as ChainId) || this.defaultChain;
    const chain = this.getChain(chainId);

    if (!chain?.nftContract) {
      this.logger.log(`[MOCK] Claiming NFT ${nftId} to ${externalWallet}`);

      // Update NFT record
      await this.prisma.nFT.update({
        where: { id: nftId },
        data: {
          metadata: {
            ...((nft.metadata as object) || {}),
            claimed: true,
            claimedTo: externalWallet,
            claimedAt: new Date().toISOString(),
          },
        },
      });

      // Update member's external wallet
      await this.prisma.member.update({
        where: { id: memberId },
        data: { walletAddress: externalWallet },
      });

      return `mock-claim-${Date.now()}`;
    }

    try {
      // Get custodial signer for the member
      const custodialSigner = this.getCustodialSigner(memberId, chainId);
      const custodialAddress = await custodialSigner.getAddress();

      // Connect NFT contract with custodial signer
      const nftWithSigner = new ethers.Contract(
        await chain.nftContract.getAddress(),
        NFT_ABI,
        custodialSigner,
      );

      // Transfer NFT to external wallet
      const tx = await nftWithSigner.safeTransferFrom(
        custodialAddress,
        externalWallet,
        nft.tokenId,
      );
      const receipt = await tx.wait();

      // Record transaction
      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.NFT_MINT, // Could add TRANSFER type
          fromAddress: custodialAddress,
          toAddress: externalWallet,
          tokenId: nft.tokenId,
          network: chainId,
          status: TxStatus.CONFIRMED,
          blockNumber: receipt.blockNumber,
          memberId,
        },
      });

      // Update NFT record
      await this.prisma.nFT.update({
        where: { id: nftId },
        data: {
          metadata: {
            ...((nft.metadata as object) || {}),
            claimed: true,
            claimedTo: externalWallet,
            claimedAt: new Date().toISOString(),
            claimTxHash: receipt.hash,
          },
        },
      });

      // Update member's external wallet
      await this.prisma.member.update({
        where: { id: memberId },
        data: { walletAddress: externalWallet },
      });

      this.logger.log(
        `NFT ${nftId} claimed to ${externalWallet}: ${receipt.hash}`,
      );
      return receipt.hash;
    } catch (error) {
      this.logger.error('NFT claim failed:', error);
      throw error;
    }
  }

  /**
   * Record contribution on-chain (multi-chain support)
   */
  async recordContribution(
    memberId: string,
    amountKES: number,
    chainId?: ChainId,
  ): Promise<string> {
    const targetChain = chainId || this.defaultChain;
    const chain = this.getChain(targetChain);

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    const walletAddress =
      member.walletAddress || (await this.getOrCreateWallet(memberId));

    // Mock mode
    if (!chain?.treasuryContract) {
      this.logger.log(
        `[MOCK] Recording contribution of KES ${amountKES} on ${targetChain} for member ${memberId}`,
      );
      const mockTxHash = `0x${Buffer.from(`contrib-${Date.now()}`).toString('hex').padEnd(64, '0')}`;

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: mockTxHash,
          txType: TransactionType.CONTRIBUTION,
          fromAddress: walletAddress,
          toAddress: '0x0000000000000000000000000000000000000000',
          amount: amountKES.toString(),
          network: targetChain,
          status: TxStatus.CONFIRMED,
          memberId,
        },
      });

      return mockTxHash;
    }

    try {
      const tx = await chain.treasuryContract.recordContribution(
        walletAddress,
        ethers.parseUnits(amountKES.toString(), 18),
      );
      const receipt = await tx.wait();

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.CONTRIBUTION,
          fromAddress: walletAddress,
          toAddress: await chain.treasuryContract.getAddress(),
          amount: amountKES.toString(),
          network: targetChain,
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
   * Process claim disbursement on-chain (multi-chain support)
   */
  async processDisbursement(
    memberId: string,
    amountKES: number,
    claimId: string,
    chainId?: ChainId,
  ): Promise<string> {
    const targetChain = chainId || this.defaultChain;
    const chain = this.getChain(targetChain);

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new Error('Member not found');
    }

    const walletAddress =
      member.walletAddress || (await this.getOrCreateWallet(memberId));

    // Mock mode
    if (!chain?.treasuryContract) {
      this.logger.log(
        `[MOCK] Disbursing KES ${amountKES} on ${targetChain} for claim ${claimId}`,
      );
      const mockTxHash = `0x${Buffer.from(`disburse-${Date.now()}`).toString('hex').padEnd(64, '0')}`;

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: mockTxHash,
          txType: TransactionType.CLAIM_DISBURSEMENT,
          fromAddress: '0x0000000000000000000000000000000000000000',
          toAddress: walletAddress,
          amount: amountKES.toString(),
          network: targetChain,
          status: TxStatus.CONFIRMED,
          memberId,
        },
      });

      return mockTxHash;
    }

    try {
      const tx = await chain.treasuryContract.disburse(
        walletAddress,
        ethers.parseUnits(amountKES.toString(), 18),
        claimId,
      );
      const receipt = await tx.wait();

      await this.prisma.blockchainTransaction.create({
        data: {
          txHash: receipt.hash,
          txType: TransactionType.CLAIM_DISBURSEMENT,
          fromAddress: await chain.treasuryContract.getAddress(),
          toAddress: walletAddress,
          amount: amountKES.toString(),
          network: targetChain,
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
