import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export const BRAND_CONTEXT_DEFAULT_KIND = 'BIBLE';

/**
 * Document categories. The bot retrieves from every active document of the
 * requested kind, so a kind is a retrieval bucket rather than a tag:
 *
 *  - BRAND      voice, tone, positioning, how we speak
 *  - ETHICS     matters of ethics, conduct, boundaries
 *  - OPERATING  operating principles, day-to-day rules
 *  - CLINICAL   clinical protocols the assistant may describe
 *  - POLICY     pricing, membership, refunds, escalation
 *  - BIBLE      catch-all for everything else
 */
export const BRAND_CONTEXT_KINDS = [
  'BRAND',
  'ETHICS',
  'OPERATING',
  'CLINICAL',
  'POLICY',
  'BIBLE',
] as const;

export type BrandContextKind = (typeof BRAND_CONTEXT_KINDS)[number];

export const BRAND_CONTEXT_TOP_K = 3;

/** How long the in-process document cache stays warm before a DB re-read. */
export const BRAND_CONTEXT_CACHE_TTL_MS = 60_000;

/** Hard cap on how much retrieved text is injected into one prompt. */
export const BRAND_CONTEXT_MAX_INJECTED_CHARS = 8_000;

/** Per-document cap inside the injected block. */
export const BRAND_CONTEXT_MAX_DOC_CHARS = 4_000;

/**
 * How many historical versions to keep per document. Clinical and policy
 * guides keep every version: they are the evidence trail for what the
 * assistant was instructed to tell patients.
 */
export const BRAND_CONTEXT_VERSION_RETENTION = 20;

/** Kinds whose version history is never pruned. */
export const BRAND_CONTEXT_UNPRUNED_KINDS = ['CLINICAL', 'POLICY'] as const;

export type BrandContextChangeType =
  | 'CREATE'
  | 'UPDATE'
  | 'SYNC'
  | 'ROLLBACK'
  | 'DELETE';

/**
 * High-frequency English/Swahili words that produce false-positive matches.
 * Kept small on purpose — over-filtering hurts recall on short queries.
 */
const BRAND_CONTEXT_STOPWORDS = new Set<string>([
  'the',
  'and',
  'for',
  'with',
  'you',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'can',
  'could',
  'should',
  'would',
  'will',
  'this',
  'that',
  'these',
  'those',
  'but',
  'not',
  'its',
  'our',
  'your',
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'does',
  'did',
  'been',
  'being',
  'there',
  'their',
  'them',
  'they',
  'from',
  'into',
  'about',
  'please',
  'thanks',
  'want',
  'need',
  'help',
  'also',
  'any',
  'some',
  'like',
  'very',
  'just',
  'much',
  'many',
  'kwa',
  'na',
  'ya',
  'ni',
  'kama',
  'lakini',
  'au',
  'wa',
  'za',
  'zaidi',
  'ili',
  'basi',
  'pia',
  'hii',
  'hiyo',
  'hizi',
  'hizo',
  'yake',
  'wake',
  'wangu',
  'wako',
  'wetu',
  'wenu',
  'yeye',
  'sisi',
  'ninyi',
  'wao',
  'sana',
  'kwamba',
  'hivyo',
  'hilo',
  'kwenye',
  'ndani',
  'nje',
  'mimi',
  'wewe',
]);

export interface BrandContextDocumentRecord {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  active: boolean;
  source: string;
  externalId: string | null;
  externalUrl: string | null;
  lastSyncedAt: Date | null;
  sectionKey: string | null;
  contentHash: string | null;
  externalRevision: string | null;
  sourceModifiedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandContextVersionRecord {
  id: string;
  documentId: string;
  version: number;
  kind: string;
  title: string | null;
  content: string;
  contentHash: string;
  source: string;
  externalRevision: string | null;
  changeType: string;
  createdByAdminId: string | null;
  createdAt: Date;
}

export interface RetrievedBrandContext {
  documentId: string;
  kind: string;
  title: string | null;
  content: string;
  score: number;
}

export interface BrandContextPreview {
  query: string;
  kind: string;
  scanned: number;
  elapsedMs: number;
  matched: Array<{
    documentId: string;
    title: string | null;
    kind: string;
    score: number;
    content: string;
  }>;
  promptBlock: string;
  injectedChars: number;
}

interface CachedDocument {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  /** Term frequency over title + content. */
  tf: Map<string, number>;
  tokenCount: number;
}

interface CacheEntry {
  loadedAt: number;
  documents: CachedDocument[];
  /** Document frequency per term, used for BM25 inverse document frequency. */
  df: Map<string, number>;
  avgdl: number;
}

/** BM25 tuning. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * BrandContextService — retrieval layer for the Dr. Papi bot.
 *
 * Backing store for the "bible" source documents the assistant grounds its
 * answers in (brand voice, ethics, operating principles, policies). Retrieval
 * is a lightweight keyword-overlap scoring pass over the active documents for a
 * given kind — no external embedding service, no vector DB (keeps the
 * Lightsail zero-cost footprint and response latency flat).
 *
 * The documents are read once and kept in a short-lived in-process cache with
 * their tokens pre-computed, so a reply pays one DB round trip at most per
 * minute per kind instead of one per message.
 */
@Injectable()
export class BrandContextService {
  private readonly logger = new Logger(BrandContextService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Retrieval (bot read path)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves the documents most relevant to a question.
   *
   * Search spans every kind by default: a question about ethics should reach
   * the ETHICS guide even though its kind is not BIBLE. BM25 statistics
   * (document frequency, average length) are computed over the whole active
   * corpus, so a term that is rare everywhere is rare regardless of kind.
   */
  async retrieve(
    query: string,
    kinds: string | readonly string[] = BRAND_CONTEXT_KINDS,
    topK: number = BRAND_CONTEXT_TOP_K,
  ): Promise<RetrievedBrandContext[]> {
    const startedAt = Date.now();
    const wanted: string[] = typeof kinds === 'string' ? [kinds] : [...kinds];
    const { documents, df, avgdl } = await this.loadDocuments();
    const candidates = documents.filter((doc) => wanted.includes(doc.kind));
    const queryTokens = this.tokenize(query);

    // BM25: rare terms carry more weight, and document length is normalised so
    // a two-line note cannot outrank the substantial guide section that
    // actually answers the question.
    const totalDocs = candidates.length;
    const scored = candidates
      .map((doc) => {
        let score = 0;
        for (const token of queryTokens.keys()) {
          const docFreq = df.get(token);
          if (!docFreq) continue;
          const tf = doc.tf.get(token);
          if (!tf) continue;
          const idf = Math.log(
            1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5),
          );
          const norm = 1 - BM25_B + BM25_B * (doc.tokenCount / (avgdl || 1));
          score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
        }
        return { doc, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
      .slice(0, topK);

    this.logger.log(
      `Retrieval over kinds=[${wanted.join(',')}]: scanned ${totalDocs} doc(s) in ${
        Date.now() - startedAt
      }ms, matched ${scored.length}`,
    );

    return scored.map(({ doc, score }) => ({
      documentId: doc.id,
      kind: doc.kind,
      title: doc.title,
      content: doc.content,
      score,
    }));
  }

  /**
   * Renders the retrieved context the way it is injected into the prompt, and
   * reports what the bot would actually use for a given question. This is the
   * tuning aid for the admin dashboard: it shows which document wins and how
   * much of it reaches the model.
   */
  async preview(
    query: string,
    kind?: string,
    topK: number = BRAND_CONTEXT_TOP_K,
  ): Promise<BrandContextPreview> {
    const startedAt = Date.now();
    const kinds: string[] = kind ? [kind] : [...BRAND_CONTEXT_KINDS];
    const retrieved = await this.retrieve(query, kinds, topK);
    const { documents } = await this.loadDocuments();
    const promptBlock = this.renderPromptBlock(retrieved);

    return {
      query,
      kind: kind ?? 'ALL',
      scanned: documents.filter((doc) => kinds.includes(doc.kind)).length,
      elapsedMs: Date.now() - startedAt,
      matched: retrieved.map((doc) => ({
        documentId: doc.documentId,
        title: doc.title,
        kind: doc.kind,
        score: Number(doc.score.toFixed(4)),
        content: doc.content.slice(0, 600),
      })),
      promptBlock,
      injectedChars: promptBlock.length,
    };
  }

  /** Renders the retrieval block exactly as the bot injects it. */
  renderPromptBlock(retrieved: RetrievedBrandContext[]): string {
    if (retrieved.length === 0) return '';

    const parts: string[] = [];
    let used = 0;
    for (const doc of retrieved) {
      const header = `### ${doc.title ?? 'Relevant Guide'}\n`;
      const separator = parts.length > 0 ? 2 : 0;
      const remaining =
        BRAND_CONTEXT_MAX_INJECTED_CHARS - used - header.length - separator;
      if (remaining <= 0) break;
      const content = doc.content.slice(
        0,
        Math.min(BRAND_CONTEXT_MAX_DOC_CHARS, remaining),
      );
      if (!content.trim()) continue;
      const rendered = `${header}${content}`;
      parts.push(rendered);
      used += rendered.length + separator;
    }
    return parts.join('\n\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Administration (dashboard read/write path)
  // ───────────────────────────────────────────────────────────────────────────

  async listForAdmin(filters: {
    kind?: string;
    source?: string;
    active?: boolean;
    search?: string;
  }): Promise<BrandContextDocumentRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.source) where.source = filters.source;
    if (filters.active !== undefined) where.active = filters.active;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { content: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.botContextDocument.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async findById(id: string): Promise<BrandContextDocumentRecord> {
    const doc = await this.prisma.botContextDocument.findUnique({
      where: { id },
    });
    if (!doc) {
      throw new NotFoundException(`Context document ${id} not found`);
    }
    return doc;
  }

  async create(input: {
    kind?: string;
    title?: string;
    // Optional at the API level so the admin form can be submitted with files
    // instead of typed text; a document with nothing in it is still rejected.
    content?: string;
    active?: boolean;
    source?: string;
    externalId?: string;
    externalUrl?: string;
    sectionKey?: string;
    externalRevision?: string;
    sourceModifiedAt?: Date;
    lastSyncedAt?: Date;
    actorAdminId?: string;
  }): Promise<BrandContextDocumentRecord> {
    const content = (input.content ?? '').trim();
    if (!content) {
      throw new BadRequestException(
        'A context document needs content — type it here, or upload a file instead.',
      );
    }
    const created = await this.prisma.botContextDocument.create({
      data: {
        kind: input.kind ?? BRAND_CONTEXT_DEFAULT_KIND,
        title: input.title ?? null,
        content,
        contentHash: this.hashContent(content),
        active: input.active ?? true,
        source: input.source ?? 'MANUAL',
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
        sectionKey: input.sectionKey ?? null,
        externalRevision: input.externalRevision ?? null,
        sourceModifiedAt: input.sourceModifiedAt ?? null,
        lastSyncedAt: input.lastSyncedAt ?? null,
      },
    });
    await this.snapshot(created, 'CREATE', input.actorAdminId);
    this.invalidateCache();
    this.logger.log(
      `Context document created: ${created.kind}/${created.title ?? created.id} (v${created.version})`,
    );
    return created;
  }

  async update(
    id: string,
    input: {
      kind?: string;
      title?: string;
      content?: string;
      active?: boolean;
      source?: string;
      externalId?: string | null;
      externalUrl?: string | null;
      lastSyncedAt?: Date | null;
      externalRevision?: string | null;
      sourceModifiedAt?: Date | null;
      changeType?: BrandContextChangeType;
      actorAdminId?: string;
    },
  ): Promise<BrandContextDocumentRecord> {
    const existing = await this.findById(id);
    const contentChanged =
      input.content !== undefined &&
      this.hashContent(input.content) !==
        (existing.contentHash ?? this.hashContent(existing.content));

    const updated = await this.prisma.botContextDocument.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined
          ? {
              content: input.content,
              contentHash: this.hashContent(input.content),
            }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.externalId !== undefined
          ? { externalId: input.externalId }
          : {}),
        ...(input.externalUrl !== undefined
          ? { externalUrl: input.externalUrl }
          : {}),
        ...(input.lastSyncedAt !== undefined
          ? { lastSyncedAt: input.lastSyncedAt }
          : {}),
        ...(input.externalRevision !== undefined
          ? { externalRevision: input.externalRevision }
          : {}),
        ...(input.sourceModifiedAt !== undefined
          ? { sourceModifiedAt: input.sourceModifiedAt }
          : {}),
        // Version tracks content only: metadata edits (title, active) are
        // audited but must not spam the history.
        ...(contentChanged ? { version: { increment: 1 } } : {}),
      },
    });
    if (contentChanged) {
      await this.snapshot(
        updated,
        input.changeType ?? 'UPDATE',
        input.actorAdminId,
        input.externalRevision ?? undefined,
      );
    }
    this.invalidateCache();
    this.logger.log(
      `Context document updated: ${updated.id} (v${updated.version})`,
    );
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.botContextDocument.delete({ where: { id } });
    this.invalidateCache();
    this.logger.log(`Context document deleted: ${id}`);
  }

  /**
   * Bulk import that splits a long guide into retrievable sections.
   *
   * A 40-page bible pasted as one document is useless for retrieval: every
   * question matches the whole thing and the whole thing is injected into the
   * prompt. Splitting on headings produces one document per section, so the
   * top-K actually returns the sections that matter.
   *
   * Re-importing the same guide is an upsert, not a duplication: sections are
   * matched by a stable `sectionKey` (normalised heading + duplicate ordinal)
   * inside their source document. Sections that disappeared from the guide are
   * soft-deactivated so their version history survives.
   */
  async importSections(input: {
    kind?: string;
    title?: string;
    content?: string;
    /**
     * Pre-split sections. File ingestion supplies these directly (an archive
     * expands to several documents, each with its own fallback title), while a
     * pasted guide is split from `content` instead.
     */
    sections?: Array<{ title: string; content: string }>;
    active?: boolean;
    source?: string;
    externalId?: string;
    externalUrl?: string;
    externalRevision?: string;
    sourceModifiedAt?: Date;
    // Set when the sections came from an uploaded file, so the retrievable
    // text traces back to the raw bytes in S3.
    fileId?: string;
    actorAdminId?: string;
  }): Promise<{
    created: number;
    updated: number;
    deactivated: number;
    documents: BrandContextDocumentRecord[];
  }> {
    const kind = input.kind ?? BRAND_CONTEXT_DEFAULT_KIND;
    const source = input.source ?? 'MANUAL';
    const sections =
      input.sections && input.sections.length > 0
        ? input.sections
        : this.splitIntoSections(input.content ?? '', input.title);
    if (sections.length === 0) {
      throw new BadRequestException(
        'Nothing to import — the document has no content.',
      );
    }
    const externalId =
      input.externalId ?? this.deriveImportKey(kind, input.title, sections);
    const syncedAt = source === 'GOOGLE_DRIVE' ? new Date() : null;

    // Keys must be stable across edits elsewhere in the guide, so the ordinal
    // counts repeats of the same heading rather than the section's position.
    const occurrences = new Map<string, number>();
    const keyed = sections.map((section) => {
      const normalized = this.normalizeHeading(section.title);
      const ordinal = occurrences.get(normalized) ?? 0;
      occurrences.set(normalized, ordinal + 1);
      return {
        ...section,
        sectionKey: this.hashKey(`${normalized}#${ordinal}`),
        contentHash: this.hashContent(section.content),
      };
    });

    const documents: BrandContextDocumentRecord[] = [];
    const seenKeys = new Set<string>();
    let created = 0;
    let updated = 0;

    for (const section of keyed) {
      seenKeys.add(section.sectionKey);
      const existing = await this.prisma.botContextDocument.findUnique({
        where: {
          source_externalId_sectionKey: {
            source,
            externalId,
            sectionKey: section.sectionKey,
          },
        },
      });

      if (!existing) {
        const doc = await this.prisma.botContextDocument.create({
          data: {
            kind,
            title: section.title,
            content: section.content,
            contentHash: section.contentHash,
            active: input.active ?? true,
            source,
            externalId,
            externalUrl: input.externalUrl ?? null,
            sectionKey: section.sectionKey,
            externalRevision: input.externalRevision ?? null,
            sourceModifiedAt: input.sourceModifiedAt ?? null,
            lastSyncedAt: syncedAt,
            fileId: input.fileId ?? null,
          },
        });
        await this.snapshot(doc, 'CREATE', input.actorAdminId);
        documents.push(doc);
        created += 1;
        continue;
      }

      const changed =
        existing.contentHash !== section.contentHash ||
        (input.active ?? true) !== existing.active;

      if (!changed) {
        documents.push(existing);
        continue;
      }

      const doc = await this.prisma.botContextDocument.update({
        where: { id: existing.id },
        data: {
          title: section.title,
          content: section.content,
          contentHash: section.contentHash,
          active: input.active ?? true,
          externalUrl: input.externalUrl ?? existing.externalUrl,
          externalRevision: input.externalRevision ?? existing.externalRevision,
          sourceModifiedAt: input.sourceModifiedAt ?? existing.sourceModifiedAt,
          lastSyncedAt: syncedAt ?? existing.lastSyncedAt,
          ...(input.fileId ? { fileId: input.fileId } : {}),
          version: { increment: 1 },
        },
      });
      await this.snapshot(
        doc,
        'SYNC',
        input.actorAdminId,
        input.externalRevision,
      );
      documents.push(doc);
      updated += 1;
    }

    const stale = await this.prisma.botContextDocument.findMany({
      where: {
        source,
        externalId,
        sectionKey: { notIn: [...seenKeys] },
        active: true,
      },
    });
    let deactivated = 0;
    for (const doc of stale) {
      const removed = await this.prisma.botContextDocument.update({
        where: { id: doc.id },
        data: { active: false, version: { increment: 1 } },
      });
      await this.snapshot(removed, 'DELETE', input.actorAdminId);
      deactivated += 1;
    }

    this.invalidateCache();
    this.logger.log(
      `Imported ${sections.length} section(s) into kind=${kind}: ` +
        `${created} created, ${updated} updated, ${deactivated} deactivated` +
        `${input.externalId ? ` (drive file ${input.externalId})` : ''}`,
    );
    return { created, updated, deactivated, documents };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Version history
  // ───────────────────────────────────────────────────────────────────────────

  /** Lists the immutable snapshots of a document, newest first. */
  async listVersions(documentId: string): Promise<BrandContextVersionRecord[]> {
    await this.findById(documentId);
    return this.prisma.brandContextDocumentVersion.findMany({
      where: { documentId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Restores a historical version by writing it as a new version. History is
   * append-only: the bad state being replaced stays available for audit.
   */
  async restoreVersion(
    documentId: string,
    version: number,
    actorAdminId?: string,
  ): Promise<BrandContextDocumentRecord> {
    await this.findById(documentId);
    const snapshot = await this.prisma.brandContextDocumentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    if (!snapshot) {
      throw new NotFoundException(
        `Version ${version} of context document ${documentId} not found`,
      );
    }

    const restored = await this.prisma.botContextDocument.update({
      where: { id: documentId },
      data: {
        kind: snapshot.kind,
        title: snapshot.title,
        content: snapshot.content,
        contentHash: snapshot.contentHash,
        source: snapshot.source,
        externalRevision: snapshot.externalRevision,
        active: true,
        version: { increment: 1 },
      },
    });
    await this.snapshot(
      restored,
      'ROLLBACK',
      actorAdminId,
      snapshot.externalRevision ?? undefined,
    );
    this.invalidateCache();
    this.logger.log(
      `Context document ${documentId} restored from v${version} (now v${restored.version})`,
    );
    return restored;
  }

  /**
   * Splits a document into sections on markdown headings, falling back to
   * paragraph chunks when there are no headings. Tiny sections are merged into
   * the previous one so a stray "## Notes" does not become its own document.
   */
  splitIntoSections(
    content: string,
    fallbackTitle?: string,
  ): Array<{ title: string; content: string }> {
    const text = (content ?? '').trim();
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const hasHeadings = lines.some((line) => /^#{1,4}\s+\S/.test(line));

    if (!hasHeadings) {
      return this.chunkByParagraph(text, fallbackTitle);
    }

    const sections: Array<{ title: string; content: string }> = [];
    let currentTitle: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
      const body = buffer.join('\n').trim();
      if (!body) {
        buffer = [];
        return;
      }
      sections.push({
        title: currentTitle ?? fallbackTitle ?? 'Guide',
        content: body,
      });
      buffer = [];
    };

    for (const line of lines) {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        currentTitle = heading[2].trim();
        continue;
      }
      buffer.push(line);
    }
    flush();

    // Sections stay separate even when short: the title is indexed too, and
    // BM25 length normalisation stops a two-line section from outranking the
    // substantial guide that actually answers the question.
    return sections;
  }

  private chunkByParagraph(
    text: string,
    fallbackTitle?: string,
  ): Array<{ title: string; content: string }> {
    const target = 1_200;
    const split = (raw: string, separator: RegExp): string[] =>
      raw
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean);

    // Guides typed into the dashboard have blank lines between paragraphs.
    // PDF extraction usually does not: it emits one visual line per newline,
    // so splitting on blank lines alone would yield a single document the
    // size of the whole file, which BM25 cannot rank usefully. Fall back to
    // line granularity, then break up anything still over the target.
    let paragraphs = split(text, /\n\s*\n/);
    if (paragraphs.length === 1 && (paragraphs[0]?.length ?? 0) > target) {
      paragraphs = split(text, /\n/);
    }
    paragraphs = paragraphs.flatMap((paragraph) =>
      paragraph.length > target * 2 ? split(paragraph, /\n/) : [paragraph],
    );

    const chunks: Array<{ title: string; content: string }> = [];
    let buffer: string[] = [];
    let size = 0;

    for (const paragraph of paragraphs) {
      buffer.push(paragraph);
      size += paragraph.length;
      if (size >= target) {
        chunks.push({
          title: fallbackTitle ?? 'Guide',
          content: buffer.join('\n\n'),
        });
        buffer = [];
        size = 0;
      }
    }
    if (buffer.length > 0) {
      chunks.push({
        title: fallbackTitle ?? 'Guide',
        content: buffer.join('\n\n'),
      });
    }

    if (chunks.length <= 1) {
      return [{ title: fallbackTitle ?? 'Guide', content: text }];
    }
    return chunks.map((chunk, index) => ({
      title: `${fallbackTitle ?? 'Guide'} (${index + 1})`,
      content: chunk.content,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Writes an immutable snapshot of the current document state, then prunes
   * old history for non-clinical kinds. Snapshotting must never block the
   * write that already succeeded, so failures are logged and swallowed.
   */
  private async snapshot(
    doc: BrandContextDocumentRecord,
    changeType: BrandContextChangeType,
    actorAdminId?: string,
    externalRevision?: string,
  ): Promise<void> {
    try {
      await this.prisma.brandContextDocumentVersion.create({
        data: {
          documentId: doc.id,
          version: doc.version,
          kind: doc.kind,
          title: doc.title,
          content: doc.content,
          contentHash: doc.contentHash ?? this.hashContent(doc.content),
          source: doc.source,
          externalRevision: externalRevision ?? doc.externalRevision ?? null,
          changeType,
          createdByAdminId: actorAdminId ?? null,
        },
      });
      await this.pruneVersions(doc.id, doc.kind);
    } catch (error) {
      this.logger.warn(
        `Could not snapshot context document ${doc.id} (v${doc.version}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async pruneVersions(documentId: string, kind: string): Promise<void> {
    if ((BRAND_CONTEXT_UNPRUNED_KINDS as readonly string[]).includes(kind)) {
      return;
    }
    const total = await this.prisma.brandContextDocumentVersion.count({
      where: { documentId },
    });
    if (total <= BRAND_CONTEXT_VERSION_RETENTION) return;

    const excess = await this.prisma.brandContextDocumentVersion.findMany({
      where: { documentId },
      orderBy: { version: 'asc' },
      take: total - BRAND_CONTEXT_VERSION_RETENTION,
      select: { id: true },
    });
    await this.prisma.brandContextDocumentVersion.deleteMany({
      where: { id: { in: excess.map((entry) => entry.id) } },
    });
  }

  /** sha256 of normalised content — the gate for a version bump. */
  private hashContent(content: string): string {
    return createHash('sha256')
      .update((content ?? '').replace(/\r\n/g, '\n').trim())
      .digest('hex');
  }

  private hashKey(input: string): string {
    return createHash('sha1').update(input).digest('hex');
  }

  private normalizeHeading(title: string): string {
    return (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Stable identity for a manual import: re-importing a guide with the same
   * kind and title updates its sections instead of creating duplicates.
   */
  private deriveImportKey(
    kind: string,
    title: string | undefined,
    sections: Array<{ title: string }>,
  ): string {
    const basis = title ?? sections[0]?.title ?? 'guide';
    return `manual:${this.hashKey(`${kind}|${basis}`)}`;
  }

  /**
   * Reads every active document once, caching them (with term frequencies and
   * document frequencies pre-computed) for a short TTL. The cache is dropped
   * whenever a document is written through this service.
   */
  private async loadDocuments(): Promise<{
    documents: CachedDocument[];
    df: Map<string, number>;
    avgdl: number;
  }> {
    const cached = this.cache.get('ALL');
    const now = Date.now();
    if (cached && now - cached.loadedAt < BRAND_CONTEXT_CACHE_TTL_MS) {
      return {
        documents: cached.documents,
        df: cached.df,
        avgdl: cached.avgdl,
      };
    }

    const rows = await this.prisma.botContextDocument.findMany({
      where: { active: true },
      select: {
        id: true,
        kind: true,
        title: true,
        content: true,
      },
    });

    const documents = rows.map((row) => {
      const tf = this.tokenize(`${row.title ?? ''} ${row.content}`);
      let tokenCount = 0;
      for (const count of tf.values()) tokenCount += count;
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        content: row.content,
        tf,
        tokenCount,
      };
    });

    const df = new Map<string, number>();
    let total = 0;
    for (const doc of documents) {
      total += doc.tokenCount;
      for (const term of doc.tf.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    const avgdl = documents.length > 0 ? total / documents.length : 1;

    this.cache.set('ALL', { loadedAt: now, documents, df, avgdl });
    return { documents, df, avgdl };
  }

  private invalidateCache(): void {
    this.cache.clear();
  }

  private tokenize(input: string): Map<string, number> {
    const tf = new Map<string, number>();
    const normalized = (input ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
      .filter((token) => !BRAND_CONTEXT_STOPWORDS.has(token));
    for (const token of normalized) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    return tf;
  }
}
