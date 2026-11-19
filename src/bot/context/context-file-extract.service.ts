import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { extname } from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';
import AdmZip from 'adm-zip';

/** One logical document recovered from an upload. */
export interface ExtractedDocument {
  /** Original name, or the path of the entry inside an archive. */
  filename: string;
  /** Markdown-ish text, ready to be split into retrievable sections. */
  text: string;
}

export interface ExtractionResult {
  documents: ExtractedDocument[];
  /** Archive entries that could not be turned into text (unsupported type). */
  skipped: string[];
}

/** Text formats that are already close enough to markdown to use as-is. */
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text']);
/** Formats that need real parsing. */
const PARSED_EXTENSIONS = new Set(['.pdf', '.docx', '.html', '.htm']);
/** Everything the extractor will accept from a file picker. */
export const SUPPORTED_UPLOAD_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  ...PARSED_EXTENSIONS,
  '.zip',
];

/** Hard ceilings. Admins are trusted, but a dropped archive should not take the API down. */
const MAX_ZIP_ENTRIES = 300;
const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;

/** macOS/Windows archive noise that is never a real document. */
const JUNK_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.[^./]+$)/;

/**
 * Document formats we recognise but cannot yet parse. These are reported to
 * the admin as skipped — unlike images and fonts, which are expected to be
 * ignored and would only add noise — so it is clear why a file from a bundle
 * never appeared.
 */
const KNOWN_DOCUMENT_EXTENSIONS = new Set([
  '.doc',
  '.rtf',
  '.odt',
  '.pages',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.epub',
  '.mobi',
  '.tex',
]);

/**
 * Turns uploaded files into markdown the retrieval pipeline can index.
 *
 * Markdown and plain text pass straight through. PDFs are parsed to text,
 * DOCX/HTML is converted to markdown so Word headings become real `#`
 * headings the section splitter recognises, and a zip expands into one
 * document per entry so a bundle of guides can be dropped in a single go.
 *
 * Extraction failure is reported as a 400 with a message an admin can act on
 * ("this is a scanned PDF", "save as .docx") rather than a stack trace.
 */
@Injectable()
export class ContextFileExtractService {
  private readonly logger = new Logger(ContextFileExtractService.name);

  /**
   * @param filename the name the file was uploaded under; the extension
   *   decides how the bytes are interpreted.
   * @returns one document per input file, or one per extractable entry in an
   *   archive.
   * @throws BadRequestException when nothing usable can be extracted.
   */
  async extract(filename: string, buffer: Buffer): Promise<ExtractionResult> {
    const extension = extname(filename || '').toLowerCase();

    if (extension === '.zip') {
      return this.extractArchive(filename, buffer);
    }

    const text = await this.extractOne(extension, filename, buffer);
    return { documents: [{ filename, text }], skipped: [] };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Archives
  // ───────────────────────────────────────────────────────────────────────────

  private async extractArchive(
    filename: string,
    buffer: Buffer,
  ): Promise<ExtractionResult> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch (error) {
      throw new BadRequestException(
        `"${filename}" could not be opened as a zip archive (${
          error instanceof Error ? error.message : 'unknown error'
        }). Re-zip it and try again.`,
      );
    }

    const entries = zip
      .getEntries()
      .filter(
        (entry) => !entry.isDirectory && !JUNK_ENTRY.test(entry.entryName),
      );

    if (entries.length === 0) {
      throw new BadRequestException(
        `"${filename}" contains no files to import.`,
      );
    }
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new BadRequestException(
        `"${filename}" holds ${entries.length} files; the limit is ${MAX_ZIP_ENTRIES}. ` +
          'Split it into smaller archives.',
      );
    }

    const documents: ExtractedDocument[] = [];
    const skipped: string[] = [];
    let bytes = 0;

    for (const entry of entries) {
      const entryName = entry.entryName;
      const extension = extname(entryName).toLowerCase();

      if (
        !TEXT_EXTENSIONS.has(extension) &&
        !PARSED_EXTENSIONS.has(extension)
      ) {
        // Images, fonts and other assets are expected to be ignored. A
        // document format we simply cannot read is worth reporting, so the
        // admin knows why a file from their bundle never appeared.
        if (KNOWN_DOCUMENT_EXTENSIONS.has(extension)) {
          skipped.push(entryName);
        }
        continue;
      }
      if (entry.header.size > MAX_ZIP_ENTRY_BYTES) {
        skipped.push(entryName);
        continue;
      }

      let data: Buffer;
      try {
        data = entry.getData();
      } catch {
        skipped.push(entryName);
        continue;
      }
      bytes += data.length;
      if (bytes > MAX_ZIP_TOTAL_BYTES) {
        throw new BadRequestException(
          `"${filename}" expands past the ${Math.round(
            MAX_ZIP_TOTAL_BYTES / (1024 * 1024),
          )}MB limit. Split it into smaller archives.`,
        );
      }

      try {
        const text = await this.extractOne(extension, entryName, data);
        if (text.trim()) documents.push({ filename: entryName, text });
        else skipped.push(entryName);
      } catch (error) {
        this.logger.warn(
          `Skipping ${entryName} from ${filename}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skipped.push(entryName);
      }
    }

    if (documents.length === 0) {
      throw new BadRequestException(
        `"${filename}" contains no documents in a supported format. ` +
          `Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }

    this.logger.log(
      `Expanded ${filename}: ${documents.length} document(s)` +
        (skipped.length ? `, ${skipped.length} skipped` : ''),
    );
    return { documents, skipped };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Single files
  // ───────────────────────────────────────────────────────────────────────────

  private async extractOne(
    extension: string,
    filename: string,
    buffer: Buffer,
  ): Promise<string> {
    if (TEXT_EXTENSIONS.has(extension)) {
      return normalizeText(buffer.toString('utf8'));
    }

    switch (extension) {
      case '.pdf':
        return this.fromPdf(filename, buffer);
      case '.docx':
        return this.fromDocx(filename, buffer);
      case '.html':
      case '.htm':
        return htmlToMarkdown(buffer.toString('utf8'));
      case '.doc':
        throw new BadRequestException(
          `"${filename}" is a legacy .doc file, which cannot be read reliably. ` +
            'Open it in Word and save as .docx, or export to PDF.',
        );
      default:
        throw new BadRequestException(
          `"${filename}" (${
            extension || 'no extension'
          }) is not a supported format. Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(
            ', ',
          )}.`,
        );
    }
  }

  private async fromPdf(filename: string, buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      // pageJoiner puts a blank line at every page boundary, so a long PDF
      // arrives as page-sized blocks rather than one unbroken wall of text
      // that could never be retrieved section-by-section.
      const result = await parser.getText({ pageJoiner: '\n\n' });
      const text = normalizeText(result.text);
      // A real page has far more than this; an image-only PDF yields nothing.
      // The floor exists to catch empty extraction, not to judge short pages.
      if (text.replace(/\s/g, '').length < 10) {
        throw new BadRequestException(
          `"${filename}" has no extractable text — it looks like a scanned or ` +
            'image-only PDF. Run it through OCR (or export a text layer) first.',
        );
      }
      return text;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `"${filename}" could not be read as a PDF (${
          error instanceof Error ? error.message : 'unknown error'
        }).`,
      );
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  private async fromDocx(filename: string, buffer: Buffer): Promise<string> {
    try {
      // mammoth emits semantic HTML; turndown turns Word headings into real
      // markdown headings, which is what lets the section splitter cut a long
      // document into retrievable pieces instead of one blob.
      const { value: html } = await mammoth.convertToHtml({ buffer });
      const markdown = htmlToMarkdown(html);
      if (!markdown.trim()) {
        throw new BadRequestException(
          `"${filename}" contains no readable text.`,
        );
      }
      return markdown;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `"${filename}" could not be read as a Word document (${
          error instanceof Error ? error.message : 'unknown error'
        }). If it was saved as .doc, save it as .docx instead.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `headingStyle: 'atx'` matters: the section splitter only recognises
 * `# Heading` lines, and turndown otherwise renders h1/h2 with setext
 * underlines (`===`), which would silently collapse a document into one piece.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  return normalizeText(turndown.turndown(html ?? ''));
}

/**
 * Makes text safe to chunk: normal line endings, no stray control bytes or
 * NUL padding (both common in PDF extraction), and at most one blank line
 * between blocks.
 */
export function normalizeText(text: string): string {
  let out = (text ?? '').replace(/\r\n?/g, '\n');
  let cleaned = '';
  for (let i = 0; i < out.length; i += 1) {
    const code = out.charCodeAt(i);
    const keep = code === 0x0a || code === 0x09 || code >= 0x20;
    if (keep) cleaned += out[i];
  }
  out = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/** Stable identity for an upload: identical bytes collapse onto one row. */
export function hashFile(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Turns a filename into a readable title: `q3-pricing_guide.pdf` becomes
 * `Q3 Pricing Guide`. Used as the fallback title for content that has no
 * headings of its own.
 */
export function titleFromFilename(filename: string): string {
  const base = (filename || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'Untitled';
  return base
    .split(' ')
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}
