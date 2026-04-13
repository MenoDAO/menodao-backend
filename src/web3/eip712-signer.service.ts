import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayoutClaim {
  claimId: string; // bytes32 hex string
  clinic: string; // address
  amount: bigint; // wei
  resultHash: string; // bytes32 hex string
  timestamp: number; // unix seconds
  beforeCID: string;
  afterCID: string;
}

export interface SignedClaim {
  claim: PayoutClaim;
  signature: string; // 65-byte ECDSA sig, 0x-prefixed hex
}

export interface SignClaimInput {
  caseOnChainId: number;
  visitId: string;
  clinicAddress: string;
  amountWei: bigint;
  aiResult: { verified: boolean; confidence: number; reason: string };
  beforeCID: string;
  afterCID: string;
}

// ─── EIP-712 type definitions ─────────────────────────────────────────────────

const PAYOUT_CLAIM_TYPES = {
  PayoutClaim: [
    { name: 'claimId', type: 'bytes32' },
    { name: 'clinic', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resultHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'beforeCID', type: 'string' },
    { name: 'afterCID', type: 'string' },
  ],
};

// Filecoin Calibration testnet chainId — overridable via CLAIM_VAULT_CHAIN_ID env var
const CALIBRATION_CHAIN_ID = 314159;

@Injectable()
export class EIP712SignerService {
  private readonly logger = new Logger(EIP712SignerService.name);
  private signerWallet: ethers.Wallet | null = null;
  private readonly claimVaultAddress: string;
  private readonly chainId: number;
  private readonly mockMode: boolean;

  constructor(private config: ConfigService) {
    const privateKey =
      this.config.get<string>('AGENT_SIGNER_PRIVATE_KEY') || '';
    this.claimVaultAddress =
      this.config.get<string>('CLAIM_VAULT_CONTRACT_ADDRESS') || '';
    // Allow override for multi-chain deployment (Base Sepolia = 84532, Calibration = 314159)
    this.chainId = parseInt(
      this.config.get<string>('CLAIM_VAULT_CHAIN_ID') ||
        String(CALIBRATION_CHAIN_ID),
      10,
    );

    if (!privateKey || !this.claimVaultAddress) {
      this.logger.warn(
        '[MOCK] AGENT_SIGNER_PRIVATE_KEY or CLAIM_VAULT_CONTRACT_ADDRESS not set — EIP712SignerService running in mock mode',
      );
      this.mockMode = true;
      return;
    }

    try {
      this.signerWallet = new ethers.Wallet(privateKey);
      this.mockMode = false;
      this.logger.log(
        `EIP712SignerService ready — signer=${this.signerWallet.address} vault=${this.claimVaultAddress}`,
      );
    } catch (err) {
      this.logger.error(
        'Failed to init EIP712SignerService signer wallet:',
        err,
      );
      this.mockMode = true;
    }
  }

  /**
   * Compute keccak256(abi.encode(verified, confidence*1e18, reason))
   * Binds the AI decision to the claim in a tamper-evident way.
   */
  computeResultHash(aiResult: {
    verified: boolean;
    confidence: number;
    reason: string;
  }): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bool', 'uint256', 'string'],
        [
          aiResult.verified,
          BigInt(Math.round(aiResult.confidence * 1e18)),
          aiResult.reason,
        ],
      ),
    );
  }

  /**
   * Compute keccak256(abi.encode(caseOnChainId, visitId))
   * Unique per case — used as replay guard on-chain.
   */
  computeClaimId(caseOnChainId: number, visitId: string): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'string'],
        [caseOnChainId, visitId],
      ),
    );
  }

  /**
   * Build and EIP-712 sign a PayoutClaim.
   * Returns the full SignedClaim including the 65-byte ECDSA signature.
   */
  async signClaim(input: SignClaimInput): Promise<SignedClaim> {
    const claimId = this.computeClaimId(input.caseOnChainId, input.visitId);
    const resultHash = this.computeResultHash(input.aiResult);
    const timestamp = Math.floor(Date.now() / 1000);

    const claim: PayoutClaim = {
      claimId,
      clinic: input.clinicAddress,
      amount: input.amountWei,
      resultHash,
      timestamp,
      beforeCID: input.beforeCID,
      afterCID: input.afterCID,
    };

    if (this.mockMode || !this.signerWallet) {
      const mockSig = '0x' + '0'.repeat(130);
      this.logger.warn(
        `[MOCK] signClaim — claimId=${claimId} clinic=${input.clinicAddress} amount=${input.amountWei}`,
      );
      return { claim, signature: mockSig };
    }

    const domain = {
      name: 'MenoDAOClaimVault',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.claimVaultAddress,
    };

    // ethers.js v6 signTypedData expects plain JS values (not bigint for bytes32)
    const claimForSigning = {
      claimId: claim.claimId,
      clinic: claim.clinic,
      amount: claim.amount,
      resultHash: claim.resultHash,
      timestamp: claim.timestamp,
      beforeCID: claim.beforeCID,
      afterCID: claim.afterCID,
    };

    const signature = await this.signerWallet.signTypedData(
      domain,
      PAYOUT_CLAIM_TYPES,
      claimForSigning,
    );

    this.logger.log(
      `Claim signed — claimId=${claimId} clinic=${input.clinicAddress} amount=${input.amountWei} sig=${signature.slice(0, 12)}...`,
    );

    return { claim, signature };
  }

  /** Expose signer address for logging / verification */
  getSignerAddress(): string | null {
    return this.signerWallet?.address ?? null;
  }
}
