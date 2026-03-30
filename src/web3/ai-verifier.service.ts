import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  reason: string;
}

@Injectable()
export class AiVerifierService {
  private readonly logger = new Logger(AiVerifierService.name);
  private readonly visionApiKey: string;
  private readonly visionEndpoint: string;

  constructor(private config: ConfigService) {
    this.visionApiKey = this.config.get<string>('VISION_API_KEY') || '';
    this.visionEndpoint = this.config.get<string>('VISION_API_ENDPOINT') || '';
  }

  /**
   * Verify dental improvement between before/after images.
   * Uses a real vision API if configured, otherwise returns a simulated result
   * with high confidence for demo purposes.
   */
  async verifyCase(
    beforeCID: string,
    afterCID: string,
  ): Promise<VerificationResult> {
    const beforeUrl = `https://ipfs.io/ipfs/${beforeCID}`;
    const afterUrl = `https://ipfs.io/ipfs/${afterCID}`;

    if (!this.visionApiKey || !this.visionEndpoint) {
      return this.simulateVerification(beforeCID, afterCID);
    }

    try {
      const res = await axios.post(
        this.visionEndpoint,
        {
          agentId: 'did:menodao:verifier-1',
          beforeImageUrl: beforeUrl,
          afterImageUrl: afterUrl,
          task: 'dental_improvement_verification',
        },
        {
          headers: { Authorization: `Bearer ${this.visionApiKey}` },
          timeout: 20000,
        },
      );

      const score: number = res.data?.score ?? res.data?.confidence ?? 0;
      const verified = score > 0.7;

      this.logger.log(
        `AI verification: beforeCID=${beforeCID} score=${score} verified=${verified}`,
      );

      return {
        verified,
        confidence: score,
        reason: verified
          ? 'Dental improvement detected by AI agent'
          : 'Insufficient improvement detected',
      };
    } catch (err) {
      this.logger.error(
        'Vision API call failed, falling back to simulation:',
        err,
      );
      return this.simulateVerification(beforeCID, afterCID);
    }
  }

  /**
   * Simulated verification for demo — always returns verified with high confidence.
   * In production this would be replaced by a real vision model call.
   */
  private simulateVerification(
    beforeCID: string,
    afterCID: string,
  ): VerificationResult {
    // Deterministic but plausible confidence score based on CID hash
    const seed =
      (beforeCID.charCodeAt(beforeCID.length - 1) +
        afterCID.charCodeAt(afterCID.length - 1)) %
      20;
    const confidence = 0.8 + seed / 100; // 0.80 – 0.99

    this.logger.warn(
      `[SIMULATED] AI verification: confidence=${confidence.toFixed(2)} verified=true`,
    );

    return {
      verified: true,
      confidence,
      reason: '[Demo] Simulated AI verification — dental improvement confirmed',
    };
  }
}
