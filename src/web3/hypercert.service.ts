import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface HypercertData {
  impactType: string;
  beforeCID: string;
  afterCID: string;
  timestamp: number;
  verifier: string;
  agentId: string;
  visitId: string;
  clinicAddress: string;
  mintedAt: string;
  tokenId: string;
  // Ownership: MenoDAO attests, clinic receives proof, patient is beneficiary
  ownership: {
    attester: string; // MenoDAO — the org that verified and funded care
    clinic: string; // Clinic wallet — delivered the service
    beneficiary: string; // Patient visit ID — received the care
  };
  // IPFS CID of the full metadata JSON (pinned via Pinata)
  metadataCID?: string;
  metadataUrl?: string;
  // Note on real minting
  note: string;
}

@Injectable()
export class HypercertService {
  private readonly logger = new Logger(HypercertService.name);
  private readonly pinataJwt: string;
  private readonly PINATA_UPLOAD_URL =
    'https://api.pinata.cloud/pinning/pinJSONToIPFS';

  constructor(private config: ConfigService) {
    this.pinataJwt =
      this.config.get<string>('PINATA_JWT') ||
      this.config.get<string>('FILECOIN_API_KEY') ||
      '';
  }

  /**
   * Mint a Hypercert as proof of dental care impact.
   *
   * Ownership model:
   *   - MenoDAO (attester): the DAO that verified the case and released payment
   *   - Clinic (service provider): receives the tFIL payout + proof of delivery
   *   - Patient (beneficiary): identified by visitId, received the dental care
   *
   * The full metadata is pinned to IPFS via Pinata so it has a permanent,
   * verifiable CID. On-chain minting via the Hypercerts AT Protocol SDK
   * is stubbed pending their stable Node.js server-side support.
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
      impactType: 'Dental Care — MenoDAO Verified',
      beforeCID: params.beforeCID,
      afterCID: params.afterCID,
      timestamp: Date.now(),
      verifier: 'did:menodao:verifier-1',
      agentId: 'did:menodao:verifier-1',
      visitId: params.visitId,
      clinicAddress: params.clinicAddress,
      mintedAt: new Date().toISOString(),
      tokenId,
      ownership: {
        attester: 'MenoDAO — dental care cooperative (attests impact)',
        clinic: params.clinicAddress,
        beneficiary: `visit:${params.visitId} (patient who received care)`,
      },
      note:
        'Hypercert metadata pinned to IPFS. On-chain ERC-1155 minting via ' +
        'Hypercerts SDK pending stable server-side AT Protocol support.',
    };

    // Pin the full metadata JSON to IPFS so it has a real, verifiable CID
    const metadataCID = await this.pinMetadata(data, tokenId);
    if (metadataCID) {
      data.metadataCID = metadataCID;
      data.metadataUrl = `https://ipfs.io/ipfs/${metadataCID}`;
    }

    this.logger.log(
      `[Hypercert] Impact proof created — visitId=${params.visitId} ` +
        `tokenId=${tokenId} confidence=${params.verifierConfidence.toFixed(2)} ` +
        `metadataCID=${metadataCID || 'mock'}`,
    );

    return data;
  }

  /** Pin the hypercert metadata JSON to IPFS via Pinata */
  private async pinMetadata(
    data: HypercertData,
    tokenId: string,
  ): Promise<string | null> {
    if (!this.pinataJwt) {
      this.logger.warn('[Hypercert] No PINATA_JWT — skipping metadata pin');
      return null;
    }

    try {
      const res = await axios.post(
        this.PINATA_UPLOAD_URL,
        {
          pinataMetadata: { name: `menodao-hypercert-${tokenId}` },
          pinataContent: data,
        },
        {
          headers: {
            Authorization: `Bearer ${this.pinataJwt}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const cid: string = res.data?.IpfsHash;
      this.logger.log(`[Hypercert] Metadata pinned to IPFS — CID: ${cid}`);
      return cid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Hypercert] Metadata pin failed: ${msg}`);
      return null;
    }
  }
}
