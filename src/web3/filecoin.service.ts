import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormDataLib = require('form-data') as typeof import('form-data');

/**
 * FilecoinService — uploads files to IPFS via Storacha (web3.storage).
 *
 * Uses the Storacha HTTP upload API with UCAN delegation auth.
 * The STORACHA_PROOF is a base64-encoded CAR file containing the delegation.
 * The upload endpoint accepts multipart/form-data with a Bearer token
 * derived from the delegation proof.
 *
 * Required env vars:
 *   STORACHA_PRIVATE_KEY  — server agent private key
 *   STORACHA_SPACE_DID    — space DID
 *   STORACHA_PROOF        — base64 UCAN delegation proof
 *
 * Falls back to mock CIDs if credentials are not configured.
 */
@Injectable()
export class FilecoinService {
  private readonly logger = new Logger(FilecoinService.name);

  // Storacha upload endpoint
  private readonly UPLOAD_URL = 'https://up.storacha.network/upload';

  // Public IPFS gateways
  private readonly IPFS_GATEWAY = 'https://ipfs.io/ipfs';
  private readonly STORACHA_GATEWAY = 'https://w3s.link/ipfs';

  private readonly privateKey: string;
  private readonly spaceDid: string;
  private readonly proof: string;

  constructor(private config: ConfigService) {
    this.privateKey = this.config.get<string>('STORACHA_PRIVATE_KEY') || '';
    this.spaceDid = this.config.get<string>('STORACHA_SPACE_DID') || '';
    this.proof = this.config.get<string>('STORACHA_PROOF') || '';

    if (!this.privateKey || !this.spaceDid || !this.proof) {
      this.logger.warn(
        '[Storacha] Missing credentials — running in mock mode. ' +
          'Set STORACHA_PRIVATE_KEY, STORACHA_SPACE_DID, STORACHA_PROOF.',
      );
    } else {
      this.logger.log(
        `[Storacha] Initialized — space=${this.spaceDid.slice(0, 30)}...`,
      );
    }
  }

  /**
   * Upload a file buffer to IPFS via Storacha and return the CID.
   * The proof is sent as a Bearer token; Storacha validates the UCAN delegation.
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.privateKey || !this.spaceDid || !this.proof) {
      const mockCid = `bafybeimock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this.logger.warn(`[Storacha MOCK] ${filename} → ${mockCid}`);
      return mockCid;
    }

    try {
      const form = new FormDataLib();
      form.append('file', buffer, { filename, contentType: mimeType });

      const res = await axios.post(this.UPLOAD_URL, form, {
        headers: {
          // Storacha HTTP API: Bearer token is the base64 proof
          Authorization: `Bearer ${this.proof}`,
          'X-Auth-Secret': this.privateKey,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        timeout: 60000,
      });

      // Storacha returns { cid: 'bafy...' }
      const cid: string = res.data?.cid || res.data?.root?.['/'];

      if (!cid) {
        throw new Error(
          `Unexpected Storacha response: ${JSON.stringify(res.data)}`,
        );
      }

      this.logger.log(`[Storacha] Uploaded ${filename} → ${cid}`);
      return cid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Storacha] Upload failed for ${filename}: ${msg}`);
      throw err;
    }
  }

  /** Public IPFS gateway URL (ipfs.io) */
  gatewayUrl(cid: string): string {
    return `${this.IPFS_GATEWAY}/${cid}`;
  }

  /** Storacha gateway URL (faster for Storacha-pinned content) */
  storachaGatewayUrl(cid: string): string {
    return `${this.STORACHA_GATEWAY}/${cid}`;
  }

  /** IPLD explorer URL */
  nftStorageViewerUrl(cid: string): string {
    return `https://explore.ipld.io/#/explore/${cid}`;
  }
}
