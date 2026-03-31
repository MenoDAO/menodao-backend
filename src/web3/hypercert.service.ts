import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilecoinService } from './filecoin.service';

export interface HypercertData {
  name: string;
  description: string;
  impactType: string;
  workScope: { type: string; procedures: string[]; location: string };
  workTimeframeStart: string;
  workTimeframeEnd: string;
  contributors: { attester: string; provider: string; agent: string };
  beneficiary: { name: string; visitId: string };
  evidence: {
    beforeImageCID: string; afterImageCID: string;
    beforeImageUrl: string; afterImageUrl: string;
    aiVerificationScore: number; aiAgentId: string;
  };
  onChain: { network: string; contractAddress: string; submitTxHash?: string; payoutTxHash?: string; caseId?: number };
  beforeCID: string; afterCID: string; timestamp: number;
  verifier: string; agentId: string; visitId: string;
  clinicAddress: string; mintedAt: string; tokenId: string;
  metadataCID?: string; metadataUrl?: string; note: string;
}

@Injectable()
export class HypercertService {
  private readonly logger = new Logger(HypercertService.name);

  constructor(
    private config: ConfigService,
    private filecoin: FilecoinService,
  ) {}

  async mintHypercert(params: {
    visitId: string; beforeCID: string; afterCID: string;
    clinicAddress: string; clinicName?: string; memberName?: string;
    procedures?: string[]; verifierConfidence: number;
  }): Promise<HypercertData> {
    const tokenId = `hc-${params.visitId.slice(0, 8)}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const clinicName = params.clinicName || params.clinicAddress;
    const memberName = params.memberName || 'MenoDAO Member';
    const procedures = params.procedures || ['Dental Care'];
    const contractAddress = this.config.get<string>('MENODAO_CONTRACT_ADDRESS') || 'pending';

    const data: HypercertData = {
      name: `MenoDAO Dental Care — ${memberName}`,
      description: `Verified dental care impact for ${memberName} at ${clinicName}. AI-confirmed improvement with on-chain evidence on Filecoin Calibration testnet.`,
      impactType: 'Dental Care — MenoDAO Verified',
      workScope: { type: 'Dental Treatment', procedures, location: clinicName },
      workTimeframeStart: now,
      workTimeframeEnd: now,
      contributors: { attester: 'MenoDAO', provider: clinicName, agent: 'did:menodao:verifier-1' },
      beneficiary: { name: memberName, visitId: params.visitId },
      evidence: {
        beforeImageCID: params.beforeCID, afterImageCID: params.afterCID,
        beforeImageUrl: `https://ipfs.io/ipfs/${params.beforeCID}`,
        afterImageUrl: `https://ipfs.io/ipfs/${params.afterCID}`,
        aiVerificationScore: params.verifierConfidence,
        aiAgentId: 'did:menodao:verifier-1',
      },
      onChain: { network: 'Filecoin Calibration Testnet (chainId: 314159)', contractAddress },
      beforeCID: params.beforeCID, afterCID: params.afterCID,
      timestamp: Date.now(), verifier: 'did:menodao:verifier-1',
      agentId: 'did:menodao:verifier-1', visitId: params.visitId,
      clinicAddress: params.clinicAddress, mintedAt: now, tokenId,
      note: 'Hypercert metadata stored on IPFS/Filecoin via Storacha. AI agent (did:menodao:verifier-1) evaluated dental improvement from Storacha-stored images.',
    };

    // Pin the metadata JSON to Storacha/IPFS
    const metadataCID = await this.pinMetadata(data, tokenId);
    if (metadataCID) {
      data.metadataCID = metadataCID;
      data.metadataUrl = `https://ipfs.io/ipfs/${metadataCID}`;
    }

    this.logger.log(`[Hypercert] Created — visitId=${params.visitId} member="${memberName}" clinic="${clinicName}" tokenId=${tokenId} confidence=${params.verifierConfidence.toFixed(2)}`);
    return data;
  }

  private async pinMetadata(data: HypercertData, tokenId: string): Promise<string | null> {
    try {
      const jsonBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
      const cid = await this.filecoin.uploadFile(
        jsonBuffer,
        `menodao-hypercert-${tokenId}.json`,
        'application/json',
      );
      this.logger.log(`[Hypercert] Metadata stored on Storacha — CID: ${cid}`);
      return cid;
    } catch (err) {
      this.logger.error(`[Hypercert] Metadata storage failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
