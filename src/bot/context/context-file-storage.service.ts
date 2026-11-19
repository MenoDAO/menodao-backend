import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Bucket holding the raw uploads and their extracted text. */
export const BRAND_CONTEXT_S3_BUCKET_DEFAULT = 'menodao-context-uploads';

/**
 * Stores context-document files in S3.
 *
 * Every upload is kept twice, deliberately:
 *
 *  - `raw/<sha256>/<name>`  the original bytes, untouched. This is the source
 *    of truth for "what did the admin actually upload" and lets extraction be
 *    re-run later with better tooling without asking anyone to re-upload.
 *  - `text/<sha256>/<name>.md`  the extracted, retrieval-friendly markdown.
 *    This is the "version that is easy to work with later": re-splitting a
 *    guide into sections reads this instead of re-parsing the PDF/DOCX.
 *
 * The bucket already default-encrypts, is versioned and blocks all public
 * access; objects are written with the same encryption explicitly so they stay
 * protected even if the bucket policy changes.
 */
@Injectable()
export class ContextFileStorageService {
  private readonly logger = new Logger(ContextFileStorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const region =
      config.get<string>('AWS_REGION') ||
      config.get<string>('AWS_DEFAULT_REGION') ||
      'us-west-2';
    this.bucket =
      config.get<string>('BRAND_CONTEXT_S3_BUCKET') ||
      BRAND_CONTEXT_S3_BUCKET_DEFAULT;
    this.s3 = new S3Client({ region });
    this.logger.log(`Context file storage: s3://${this.bucket} (${region})`);
  }

  /** S3 key for the untouched original. The hash makes re-uploads collide. */
  rawKey(sha256: string, filename: string): string {
    return `raw/${sha256}/${safeKeySegment(filename)}`;
  }

  /** S3 key for the extracted markdown. Always `.md`, whatever the input. */
  textKey(sha256: string, filename: string): string {
    return `text/${sha256}/${safeKeySegment(filename)}.md`;
  }

  async putRaw(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      }),
    );
    this.logger.log(`Stored raw file s3://${this.bucket}/${key}`);
  }

  async putText(key: string, markdown: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: Buffer.from(markdown, 'utf8'),
        ContentType: 'text/markdown; charset=utf-8',
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  /**
   * Best-effort removal. A leftover object is harmless, so a failed delete
   * must never fail the request that triggered it.
   */
  async remove(...keys: Array<string | null | undefined>): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
      } catch (error) {
        this.logger.warn(
          `Could not delete s3://${this.bucket}/${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

/**
 * Keeps a filename usable as a single S3 key segment: no path separators, no
 * control characters, bounded length. Unicode is left alone — S3 keys are
 * UTF-8 and the dashboard already displays these names.
 */
export function safeKeySegment(filename: string): string {
  const source = filename || 'file';
  let cleaned = '';
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    const isControl = code < 0x20 || code === 0x7f;
    const isSeparator = source[i] === '/' || source[i] === '\\';
    cleaned += isControl || isSeparator ? '_' : source[i];
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^\.+/, '_');
  const name = cleaned || 'file';
  // Keep the extension: the tail of a name is the part that identifies it.
  return name.length > 180 ? name.slice(-180) : name;
}
