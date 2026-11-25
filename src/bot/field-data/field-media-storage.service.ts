import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import { safeKeySegment } from '../context/context-file-storage.service';

export interface StoredFieldMedia {
  key: string;
  sha256: string;
}

/**
 * Raw field submissions live in the same encrypted, private, versioned bucket
 * as brand-context uploads. The host IAM role already has scoped access, so no
 * new infrastructure is required for this rollout.
 */
@Injectable()
export class FieldMediaStorageService {
  private readonly logger = new Logger(FieldMediaStorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const region =
      config.get<string>('FIELD_MEDIA_S3_REGION') ||
      config.get<string>('BRAND_CONTEXT_S3_REGION') ||
      'us-west-2';
    this.bucket =
      config.get<string>('FIELD_MEDIA_S3_BUCKET') ||
      config.get<string>('BRAND_CONTEXT_S3_BUCKET') ||
      'menodao-context-uploads';
    this.s3 = new S3Client({ region });
    this.logger.log(`Field media storage: s3://${this.bucket} (${region})`);
  }

  async save(
    submissionId: string,
    body: Buffer,
    mimeType: string,
    originalFilename?: string | null,
  ): Promise<StoredFieldMedia> {
    const sha256 = createHash('sha256').update(body).digest('hex');
    const name = safeKeySegment(originalFilename || 'submission');
    const key = `field-data/raw/${submissionId}/${sha256.slice(0, 12)}-${name}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType || 'application/octet-stream',
        ServerSideEncryption: 'AES256',
        Metadata: { submissionId, sha256 },
      }),
    );
    return { key, sha256 };
  }

  async read(key: string): Promise<{ body: Buffer; contentType: string }> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      body: Buffer.concat(chunks),
      contentType: result.ContentType || 'application/octet-stream',
    };
  }

  /** Used by the reparse endpoint; a stable key keeps the audit trail intact. */
  newSubmissionId(): string {
    return randomUUID();
  }
}
