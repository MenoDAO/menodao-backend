import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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
  private readonly pinataJwt: string;
  private readonly PINATA_UPLOAD_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

  constructor(private config: ConfigService) {
    this.pinataJwt = this.config.get<string>('PINATA_JWT') || this.config.get<string>('FILECOIN_API_KEY') || '';
  }

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
      note: 'Hypercert metadata pinned to IPFS via Pinata. AI agent (did:menodao:verifier-1) evaluated dental improvement from Filecoin-stored images.',
    };

    const metadataCID = await this.pinMetadata(data, tokenId);
    if (metadataCID) { data.metadataCID = metadataCID; data.metadataUrl = `https://ipfs.io/ipfs/${metadataCID}`; }

    this.logger.log(`[Hypercert] Created — visitId=${params.visitId} member="${memberName}" clinic="${clinicName}" tokenId=${tokenId} confidence=${params.verifierConfidence.toFixed(2)}`);
    return data;
  }

  private async pinMetadata(data: HypercertData, tokenId: string): Promise<string | null> {
    if (!this.pinataJwt) { this.logger.warn('[Hypercert] No PINATA_JWT — skipping'); return null; }
    try {
      const res = await axios.post(this.PINATA_UPLOAD_URL,
        { pinataMetadata: { name: `menodao-hypercert-${tokenId}` }, pinataContent: data },
        { headers: { Authorization: `Bearer ${this.pinataJwt}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      const cid = (res.data as { IpfsHash: string })?.IpfsHash;
      this.logger.log(`[Hypercert] Pinned — CID: ${cid}`);
      return cid || null;
    } catch (err) {
      this.logger.error(`[Hypercert] Pin failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
