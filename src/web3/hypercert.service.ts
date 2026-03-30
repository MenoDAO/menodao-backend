import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HypercertData {
  impactType: string;
  beforeCID: string;
  afterCID: string;
  timestamp: number;
  verifier: string;
  visitId: string;
  clinicAddress: string;
  mintedAt: string;
  // In production this would be the on-chain token ID
  mockTokenId: string;
}

@Injectable()
export class HypercertService {
  private readonly logger = new Logger(HypercertService.name);

  constructor(private config: ConfigService) {}

  /**
   * Mint a Hypercert as proof of dental care impact.
   * Currently a stub that logs and returns metadata — ready to wire into
   * the real Hypercerts SDK when available.
   */
  async mintHypercert(params: {
    visitId: string;
    beforeCID: string;
    afterCID: string;
    clinicAddress: string;
    verifierConfidence: number;
  }): Promise<HypercertData> {
    const tokenId = `hc-${params.visitId.slice(0, 8)}-${Date.now().toString(36)}`;

    const data: HypercertData = {
      impactType: 'Dental Care',
      beforeCID: params.beforeCID,
      afterCID: params.afterCID,
      timestamp: Date.now(),
      verifier: 'did:menodao:verifier-1',
      visitId: params.visitId,
      clinicAddress: params.clinicAddress,
      mintedAt: new Date().toISOString(),
      mockTokenId: tokenId,
    };

    // TODO: Replace with real Hypercerts SDK call
    // import { HypercertClient } from '@hypercerts-org/sdk';
    // const client = new HypercertClient({ chain: calibration });
    // await client.mintClaim(metadata, totalUnits, transferRestriction);

    this.logger.log(
      `[Hypercert] Impact proof minted — visitId=${params.visitId} tokenId=${tokenId} confidence=${params.verifierConfidence.toFixed(2)}`,
    );

    return data;
  }
}
