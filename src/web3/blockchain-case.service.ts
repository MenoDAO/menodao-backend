import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

// Minimal ABI — matches MenoDAOCases.sol deployed on Filecoin Calibration testnet
const MENODAO_ABI = [
  'function submitCase(string memory beforeCID, string memory afterCID, address clinic) public returns (uint256)',
  'function approveAndPay(uint256 id, uint256 payoutAmount) public',
  'function approveAndPay(uint256 id) public',
  'function caseCount() public view returns (uint)',
  'function cases(uint id) public view returns (string beforeCID, string afterCID, address clinic, bool paid, uint256 submittedAt)',
  'event CaseSubmitted(uint256 indexed id, string beforeCID, string afterCID, address indexed clinic)',
  'event Paid(uint256 indexed id, address indexed clinic, uint256 amount)',
];

// Demo payout: 0.001 tFIL — tiny for testing, adjustable for production
// To change: update DEMO_PAYOUT_ETHER env var or redeploy with new amount
const DEMO_PAYOUT_ETHER = '0.001';

export interface OnChainCase {
  caseId: number;
  txHash: string;
}

@Injectable()
export class BlockchainCaseService {
  private readonly logger = new Logger(BlockchainCaseService.name);
  private contract: ethers.Contract | null = null;
  private wallet: ethers.Wallet | null = null;
  private readonly contractAddress: string;
  private readonly rpcUrl: string;
  private readonly payoutAmount: bigint;

  constructor(private config: ConfigService) {
    this.contractAddress =
      this.config.get<string>('MENODAO_CONTRACT_ADDRESS') || '';
    this.rpcUrl =
      this.config.get<string>('CALIBRATION_RPC') ||
      'https://api.calibration.node.glif.io/rpc/v1';

    // Allow override via env, default to demo amount
    const payoutEther =
      this.config.get<string>('DEMO_PAYOUT_ETHER') || DEMO_PAYOUT_ETHER;
    this.payoutAmount = ethers.parseEther(payoutEther);

    this.init();
  }

  private init() {
    const privateKey = this.config.get<string>('BLOCKCHAIN_PRIVATE_KEY') || '';

    if (!privateKey || !this.contractAddress) {
      this.logger.warn(
        '[MOCK] BLOCKCHAIN_PRIVATE_KEY or MENODAO_CONTRACT_ADDRESS not set — running in mock mode',
      );
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, provider);
      this.contract = new ethers.Contract(
        this.contractAddress,
        MENODAO_ABI,
        this.wallet,
      );
      this.logger.log(
        `BlockchainCaseService connected to ${this.contractAddress} on Calibration testnet` +
          ` | payout=${ethers.formatEther(this.payoutAmount)} tFIL`,
      );
    } catch (err) {
      this.logger.error('Failed to init BlockchainCaseService:', err);
    }
  }

  /**
   * Submit a dental case to the smart contract.
   * Returns the on-chain case ID and tx hash.
   */
  async submitCase(
    beforeCID: string,
    afterCID: string,
    clinicAddress: string,
  ): Promise<OnChainCase> {
    if (!this.contract || !this.wallet) {
      const mockId = Math.floor(Math.random() * 10000);
      const mockTx = `0x${Buffer.from(`case-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      this.logger.warn(`[MOCK] submitCase → caseId=${mockId} txHash=${mockTx}`);
      return { caseId: mockId, txHash: mockTx };
    }

    try {
      const countBefore: bigint = await this.contract.caseCount();
      const expectedId = Number(countBefore);

      const tx = await this.contract.submitCase(
        beforeCID,
        afterCID,
        clinicAddress,
      );
      const receipt = await tx.wait();

      this.logger.log(
        `Case submitted on-chain: id=${expectedId} tx=${receipt.hash}`,
      );
      return { caseId: expectedId, txHash: receipt.hash };
    } catch (err) {
      this.logger.error('submitCase failed:', err);
      throw err;
    }
  }

  /**
   * Approve a verified case and release payout.
   * Uses DEMO_PAYOUT_ETHER (default 0.001 tFIL) — adjustable via env for production.
   */
  async approveAndPay(caseId: number): Promise<string> {
    if (!this.contract) {
      const mockTx = `0x${Buffer.from(`pay-${caseId}-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      this.logger.warn(
        `[MOCK] approveAndPay(${caseId}) payout=${ethers.formatEther(this.payoutAmount)} tFIL → txHash=${mockTx}`,
      );
      return mockTx;
    }

    try {
      // Call the overload that accepts a custom payout amount
      const tx = await this.contract['approveAndPay(uint256,uint256)'](
        caseId,
        this.payoutAmount,
      );
      const receipt = await tx.wait();
      this.logger.log(
        `Case ${caseId} paid: ${ethers.formatEther(this.payoutAmount)} tFIL → tx=${receipt.hash}`,
      );
      return receipt.hash;
    } catch (err) {
      this.logger.error(`approveAndPay(${caseId}) failed:`, err);
      throw err;
    }
  }

  /** Get the configured payout amount in ether string */
  getPayoutEther(): string {
    return ethers.formatEther(this.payoutAmount);
  }
}
