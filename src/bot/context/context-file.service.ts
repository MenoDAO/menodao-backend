import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandContextService } from './brand-context.service';
import { ContextFileStorageService } from './context-file-storage.service';
import {
  ContextFileExtractService,
  hashFile,
  titleFromFilename,
} from './context-file-extract.service';

export interface ContextFileIngestResult {
  fileId: string;
  filename: string;
  /** How many retrievable sections the upload produced. */
  sections: number;
  created: number;
  updated: number;
  deactivated: number;
  /** Archive entries that could not be turned into text. */
  skipped: string[];
}

/**
 * One uploaded file in, retrievable sections out.
 *
 * The order matters: extraction runs first so an unreadable file fails with a
 * clear 400 before anything is written, then the original bytes and the
 * extracted text go to S3, then the sections are upserted into the document
 * store the bot retrieves from. A failure after the S3 writes unwinds them so
 * no orphaned objects are left behind.
 */
@Injectable()
export class ContextFileService {
  private readonly logger = new Logger(ContextFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ContextFileStorageService,
    private readonly extract: ContextFileExtractService,
    private readonly context: BrandContextService,
  ) {}

  async ingest(input: {
    filename: string;
    contentType: string;
    buffer: Buffer;
    kind?: string;
    title?: string;
    active?: boolean;
    actorAdminId?: string;
  }): Promise<ContextFileIngestResult> {
    const { filename, buffer } = input;
    const sha256 = hashFile(buffer);

    // 1. Parse before persisting: an unsupported or empty file must not leave
    //    anything behind.
    const { documents, skipped } = await this.extract.extract(filename, buffer);

    const rawKey = this.storage.rawKey(sha256, filename);
    const textKey = this.storage.textKey(sha256, filename);
    const markdown = renderExtractedText(filename, documents);

    // 2. Raw bytes as they arrived, plus the text we derived from them.
    await this.storage.putRaw(rawKey, buffer, input.contentType);
    let textStorageKey: string | null = null;
    try {
      await this.storage.putText(textKey, markdown);
      textStorageKey = textKey;
    } catch (error) {
      // The raw copy is the important one — keep going without the text copy
      // rather than failing an upload that already succeeded.
      this.logger.warn(
        `Could not store extracted text for ${filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const kind = input.kind ?? undefined;
    const fallbackTitle =
      documents.length === 1
        ? (input.title ?? titleFromFilename(filename))
        : undefined;

    // 3. Sections. One logical document per archive entry, each with its own
    //    fallback title so heading-less entries are still named usefully.
    const sections: Array<{ title: string; content: string }> = [];
    for (const document of documents) {
      const fallback =
        documents.length === 1
          ? fallbackTitle
          : titleFromFilename(document.filename);
      sections.push(...this.context.splitIntoSections(document.text, fallback));
    }

    let fileRow: { id: string };
    try {
      // 4. Row first: sections reference it through fileId.
      fileRow = await this.prisma.botContextFile.create({
        data: {
          filename,
          contentType: input.contentType || 'application/octet-stream',
          byteSize: buffer.length,
          sha256,
          storageKey: rawKey,
          textStorageKey,
          status: 'EXTRACTED',
          extractedAt: new Date(),
          sectionCount: sections.length,
          kind: input.kind ?? 'BIBLE',
          title: input.title ?? null,
          uploadedByAdminId: input.actorAdminId ?? null,
        },
      });
    } catch (error) {
      await this.storage.remove(rawKey, textStorageKey);
      throw error;
    }

    try {
      // Filename-keyed identity: re-uploading a file with the same name
      // replaces its sections (and deactivates any that disappeared) instead
      // of piling up duplicates.
      const result = await this.context.importSections({
        kind,
        title: fallbackTitle,
        sections,
        active: input.active,
        source: 'UPLOAD',
        externalId: `upload:${filename.toLowerCase()}`,
        fileId: fileRow.id,
        actorAdminId: input.actorAdminId,
      });

      this.logger.log(
        `Ingested ${filename}: ${sections.length} section(s) from ` +
          `${documents.length} document(s) — ${result.created} created, ` +
          `${result.updated} updated, ${result.deactivated} deactivated` +
          (skipped.length ? `, ${skipped.length} skipped` : ''),
      );

      return {
        fileId: fileRow.id,
        filename,
        sections: sections.length,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
        skipped,
      };
    } catch (error) {
      // Unwind: the upload never became retrievable, so neither should its
      // record or its objects.
      await this.prisma.botContextFile
        .delete({ where: { id: fileRow.id } })
        .catch(() => undefined);
      await this.storage.remove(rawKey, textStorageKey);
      throw error;
    }
  }
}

/**
 * Rebuilds the markdown mirror of an upload. A single file is stored exactly
 * as extracted; an archive is stored with one heading per entry so re-splitting
 * the text later reproduces the same document boundaries.
 */
function renderExtractedText(
  filename: string,
  documents: Array<{ filename: string; text: string }>,
): string {
  if (documents.length === 1) return documents[0].text;
  return documents
    .map(
      (document) =>
        `# ${titleFromFilename(document.filename)}\n\n${document.text}`,
    )
    .join('\n\n');
}
