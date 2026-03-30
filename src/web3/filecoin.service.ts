import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormDataLib = require('form-data') as typeof import('form-data');

/**
 * FilecoinService — uploads files to IPFS via Pinata and returns CIDs.
 *
 * Pinata free tier: https://app.pinata.cloud
 * - Sign up free (no card required for free tier)
 * - Go to API Keys → New Key → Admin → copy the JWT
 * - Set FILECOIN_API_KEY=<JWT> in .env
 *
 * Falls back to a deterministic mock CID if no API key is set (demo/test mode).
 */
@Injectable()
export class FilecoinService {
  private readonly logger = new Logger(FilecoinService.name);
  private readonly apiKey: string;

  // Pinata public IPFS upload endpoint
  private readonly PINATA_UPLOAD_URL =
    'https://api.pinata.cloud/pinning/pinFileToIPFS';

  // Public IPFS gateways for viewing files
  private readonly IPFS_GATEWAY = 'https://ipfs.io/ipfs';
  private readonly PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('FILECOIN_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn(
        'FILECOIN_API_KEY not set — FilecoinService running in mock mode. ' +
          'Get a free Pinata JWT at https://app.pinata.cloud',
      );
    } else {
      this.logger.log('FilecoinService initialized with Pinata API');
    }
  }

  /**
   * Upload a file buffer to IPFS via Pinata and return the CID.
   * Falls back to a mock CID if no API key is configured.
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.apiKey) {
      // Deterministic mock CID for demo/testing without API key
      const mockCid = `bafybeimock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this.logger.warn(`[MOCK] No API key — mock CID: ${mockCid}`);
      return mockCid;
    }

    try {
      const form = new FormDataLib();
      form.append('file', buffer, {
        filename,
        contentType: mimeType,
      });

      // Optional metadata for Pinata dashboard
      form.append(
        'pinataMetadata',
        JSON.stringify({ name: `menodao-${filename}` }),
      );

      const res = await axios.post(this.PINATA_UPLOAD_URL, form, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        timeout: 60000,
      });

      // Pinata returns { IpfsHash: 'Qm...' or 'bafy...' }
      const cid: string = res.data?.IpfsHash;

      if (!cid) {
        throw new Error(
          `Unexpected Pinata response: ${JSON.stringify(res.data)}`,
        );
      }

      this.logger.log(`Uploaded ${filename} to IPFS via Pinata — CID: ${cid}`);
      return cid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pinata upload failed for ${filename}: ${msg}`);
      throw err;
    }
  }

  /** Public IPFS gateway URL for a CID (ipfs.io) */
  gatewayUrl(cid: string): string {
    return `${this.IPFS_GATEWAY}/${cid}`;
  }

  /** Pinata gateway URL for a CID (faster for Pinata-pinned content) */
  pinataGatewayUrl(cid: string): string {
    return `${this.PINATA_GATEWAY}/${cid}`;
  }

  /** NFT.Storage viewer URL for a CID */
  nftStorageViewerUrl(cid: string): string {
    return `https://explore.ipld.io/#/explore/${cid}`;
  }
}
