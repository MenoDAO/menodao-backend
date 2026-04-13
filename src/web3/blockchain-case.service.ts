import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { SignedClaim } from './eip712-signer.service';

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

// ABI for MenoDAOClaimVault — EIP-712 signed payout enforcer
const CLAIM_VAULT_ABI = [
  'function executePayout((bytes32 claimId, address clinic, uint256 amount, bytes32 resultHash, uint256 timestamp, string beforeCID, string afterCID) claim, bytes signature) external',
  'event ClaimValidated(bytes32 indexed claimId, bytes32 resultHash)',
  'event PayoutExecuted(bytes32 indexed claimId, address indexed recipient, uint256 amount)',
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
  private readonly payoutAmount: bigint;

  // ClaimVault (new EIP-712 payout path)
  private claimVaultContract: ethers.Contract | null = null;
  private signerWallet: ethers.Wallet | null = null;
  private readonly claimVaultAddress: string;

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

    this.claimVaultAddress =
      this.config.get<string>('CLAIM_VAULT_CONTRACT_ADDRESS') || '';

    this.init();
    this.initClaimVault();
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

  private initClaimVault() {
    const signerKey = this.config.get<string>('AGENT_SIGNER_PRIVATE_KEY') || '';

    if (!signerKey || !this.claimVaultAddress) {
      this.logger.warn(
        '[MOCK] AGENT_SIGNER_PRIVATE_KEY or CLAIM_VAULT_CONTRACT_ADDRESS not set — ClaimVault running in mock mode',
      );
      return;
    }

    try {
      // Use BASE_SEPOLIA_RPC if set (ClaimVault on Base Sepolia), otherwise fall back to CALIBRATION_RPC
      const vaultRpc =
        this.config.get<string>('BASE_SEPOLIA_RPC') ||
        this.config.get<string>('CALIBRATION_RPC') ||
        'https://sepolia.base.org';
      const provider = new ethers.JsonRpcProvider(vaultRpc);
      this.signerWallet = new ethers.Wallet(signerKey, provider);
      this.claimVaultContract = new ethers.Contract(
        this.claimVaultAddress,
        CLAIM_VAULT_ABI,
        this.signerWallet,
      );
      this.logger.log(
        `ClaimVault connected to ${this.claimVaultAddress} via ${vaultRpc} | signer=${this.signerWallet.address}`,
      );
    } catch (err) {
      this.logger.error('Failed to init ClaimVault:', err);
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

  /** Get the configured payout amount in wei (bigint) */
  getPayoutWei(): bigint {
    return this.payoutAmount;
  }

  /**
   * Submit a signed EIP-712 claim to MenoDAOClaimVault.
   * This replaces the direct approveAndPay call — all payouts now go through the vault.
   * Returns the payout transaction hash.
   */
  async submitSignedClaim(signedClaim: SignedClaim): Promise<string> {
    if (!this.claimVaultContract || !this.signerWallet) {
      const mockTx = `0x${Buffer.from(`vault-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      this.logger.warn(
        `[MOCK] submitSignedClaim — claimId=${signedClaim.claim.claimId} → txHash=${mockTx}`,
      );
      return mockTx;
    }

    try {
      // Build the claim tuple matching the contract struct order
      const claimTuple = {
        claimId: signedClaim.claim.claimId,
        clinic: signedClaim.claim.clinic,
        amount: signedClaim.claim.amount,
        resultHash: signedClaim.claim.resultHash,
        timestamp: signedClaim.claim.timestamp,
        beforeCID: signedClaim.claim.beforeCID,
        afterCID: signedClaim.claim.afterCID,
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const tx = await this.claimVaultContract.executePayout(
        claimTuple,
        signedClaim.signature,
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const receipt = await tx.wait();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const txHash: string = receipt.hash as string;

      this.logger.log(
        `ClaimVault payout executed — claimId=${signedClaim.claim.claimId} clinic=${signedClaim.claim.clinic} amount=${signedClaim.claim.amount} tx=${txHash}`,
      );
      return txHash;
    } catch (err) {
      this.logger.error(
        `submitSignedClaim failed for claimId=${signedClaim.claim.claimId}:`,
        err,
      );
      throw err;
    }
  }
}
