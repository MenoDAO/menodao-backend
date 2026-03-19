import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

// Minimal ABI for the Menodao dental case contract on Filecoin Calibration testnet
const MENODAO_ABI = [
  'function submitCase(string memory beforeCID, string memory afterCID, address clinic) public',
  'function approveAndPay(uint id) public',
  'function caseCount() public view returns (uint)',
  'function cases(uint id) public view returns (string beforeCID, string afterCID, address clinic, bool paid)',
  'event CaseSubmitted(uint id)',
  'event Paid(uint id)',
];

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

  constructor(private config: ConfigService) {
    this.contractAddress =
      this.config.get<string>('MENODAO_CONTRACT_ADDRESS') || '';
    this.rpcUrl =
      this.config.get<string>('CALIBRATION_RPC') ||
      'https://api.calibration.node.glif.io/rpc/v1';

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
        `BlockchainCaseService connected to contract ${this.contractAddress} on Calibration testnet`,
      );
    } catch (err) {
      this.logger.error('Failed to init BlockchainCaseService:', err);
    }
  }

  /**
   * Submit a dental case to the smart contract.
   * Returns the on-chain case ID and tx hash.
   * Falls back to mock if contract not configured.
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
      // Get current case count to predict the new case ID
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
   * Approve a case and trigger on-chain payout.
   */
  async approveAndPay(caseId: number): Promise<string> {
    if (!this.contract) {
      const mockTx = `0x${Buffer.from(`pay-${caseId}-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      this.logger.warn(`[MOCK] approveAndPay(${caseId}) → txHash=${mockTx}`);
      return mockTx;
    }

    try {
      const tx = await this.contract.approveAndPay(caseId);
      const receipt = await tx.wait();
      this.logger.log(`Case ${caseId} paid on-chain: tx=${receipt.hash}`);
      return receipt.hash;
    } catch (err) {
      this.logger.error(`approveAndPay(${caseId}) failed:`, err);
      throw err;
    }
  }
}
