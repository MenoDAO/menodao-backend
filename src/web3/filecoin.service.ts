import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';

/**
 * FilecoinService — uploads files to IPFS via Pinata and returns CIDs.
 *
 * Uses the Pinata pinFileToIPFS REST API.
 * Files are publicly accessible via ipfs.io and w3s.link gateways.
 *
 * Required env vars:
 *   PINATA_JWT — Pinata API JWT token
 *
 * Falls back to mock CIDs if credentials are not configured.
 */
@Injectable()
export class FilecoinService {
  private readonly logger = new Logger(FilecoinService.name);

  private readonly PINATA_URL =
    'https://api.pinata.cloud/pinning/pinFileToIPFS';
  private readonly IPFS_GATEWAY = 'https://ipfs.io/ipfs';
  private readonly STORACHA_GATEWAY = 'https://w3s.link/ipfs';

  private readonly pinataJwt: string;

  constructor(private config: ConfigService) {
    this.pinataJwt = this.config.get<string>('PINATA_JWT') || '';

    if (!this.pinataJwt) {
      this.logger.warn('[Pinata] PINATA_JWT not set — running in mock mode.');
    } else {
      this.logger.log('[Pinata] Initialized — ready to upload to IPFS');
    }
  }

  /**
   * Upload a file buffer to IPFS via Pinata and return the CID.
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.pinataJwt) {
      const mockCid = `bafybeimock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this.logger.warn(`[Pinata MOCK] ${filename} → ${mockCid}`);
      return mockCid;
    }

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });
    form.append('pinataMetadata', JSON.stringify({ name: filename }));

    const response = await axios.post<{ IpfsHash: string }>(
      this.PINATA_URL,
      form,
      {
        headers: {
          Authorization: `Bearer ${this.pinataJwt}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        timeout: 60000,
      },
    );

    const cid = response.data.IpfsHash;
    this.logger.log(`[Pinata] Uploaded ${filename} → ${cid}`);
    return cid;
  }

  /** Public IPFS gateway URL (ipfs.io) */
  gatewayUrl(cid: string): string {
    return `${this.IPFS_GATEWAY}/${cid}`;
  }

  /** Storacha/w3s gateway URL */
  storachaGatewayUrl(cid: string): string {
    return `${this.STORACHA_GATEWAY}/${cid}`;
  }

  /** IPLD explorer URL */
  nftStorageViewerUrl(cid: string): string {
    return `https://explore.ipld.io/#/explore/${cid}`;
  }
}
