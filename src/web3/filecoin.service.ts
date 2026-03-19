import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class FilecoinService {
  private readonly logger = new Logger(FilecoinService.name);
  private readonly apiKey: string;
  private readonly pinEndpoint: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('FILECOIN_API_KEY') || '';
    // Default to web3.storage compatible endpoint; override via env
    this.pinEndpoint =
      this.config.get<string>('FILECOIN_PIN_ENDPOINT') ||
      'https://api.web3.storage/upload';
  }

  /**
   * Upload a file buffer to Filecoin/IPFS and return the CID.
   * Falls back to a mock CID if no API key is configured (demo mode).
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.apiKey) {
      const mockCid = `bafybeimock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this.logger.warn(
        `[MOCK] No FILECOIN_API_KEY — returning mock CID: ${mockCid}`,
      );
      return mockCid;
    }

    try {
      const formData = new FormData();
      const blob = new Blob([buffer as unknown as ArrayBuffer], {
        type: mimeType,
      });
      formData.append('file', blob, filename);

      const res = await axios.post(this.pinEndpoint, formData, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      });

      // web3.storage returns { cid: '...' }, nft.storage returns { value: { cid: '...' } }
      const cid: string =
        res.data?.cid || res.data?.value?.cid || res.data?.IpfsHash;

      if (!cid) {
        throw new Error(
          `Unexpected response shape: ${JSON.stringify(res.data)}`,
        );
      }

      this.logger.log(`Uploaded ${filename} to Filecoin — CID: ${cid}`);
      return cid;
    } catch (err) {
      this.logger.error(`Filecoin upload failed for ${filename}:`, err);
      throw err;
    }
  }

  /** Public IPFS gateway URL for a CID */
  gatewayUrl(cid: string): string {
    return `https://ipfs.io/ipfs/${cid}`;
  }
}
