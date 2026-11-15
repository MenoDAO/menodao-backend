import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const BOT_CONTEXT_DEFAULT_KIND = 'BIBLE';

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
export const BOT_CONTEXT_KINDS = [
  'BRAND',
  'ETHICS',
  'OPERATING',
  'CLINICAL',
  'POLICY',
  'BIBLE',
] as const;

export type BotContextKind = (typeof BOT_CONTEXT_KINDS)[number];

export const BOT_CONTEXT_TOP_K = 3;

/** How long the in-process document cache stays warm before a DB re-read. */
export const BOT_CONTEXT_CACHE_TTL_MS = 60_000;

/** Hard cap on how much retrieved text is injected into one prompt. */
export const BOT_CONTEXT_MAX_INJECTED_CHARS = 8_000;

/** Per-document cap inside the injected block. */
export const BOT_CONTEXT_MAX_DOC_CHARS = 4_000;

/**
 * High-frequency English/Swahili words that produce false-positive matches.
 * Kept small on purpose — over-filtering hurts recall on short queries.
 */
const BOT_CONTEXT_STOPWORDS = new Set<string>([
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

export interface BotContextDocumentRecord {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  active: boolean;
  source: string;
  externalId: string | null;
  externalUrl: string | null;
  lastSyncedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievedBotContext {
  documentId: string;
  kind: string;
  title: string | null;
  content: string;
  score: number;
}

export interface BotContextPreview {
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
 * BotContextService — retrieval layer for the Dr. Papi bot.
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
export class BotContextService {
  private readonly logger = new Logger(BotContextService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Retrieval (bot read path)
  // ───────────────────────────────────────────────────────────────────────────

  async retrieve(
    query: string,
    kind: string = BOT_CONTEXT_DEFAULT_KIND,
    topK: number = BOT_CONTEXT_TOP_K,
  ): Promise<RetrievedBotContext[]> {
    const startedAt = Date.now();
    const { documents, df, avgdl } = await this.loadDocuments(kind);
    const queryTokens = this.tokenize(query);

    // BM25: rare terms carry more weight, and document length is normalised so
    // a two-line note cannot outrank the substantial guide section that
    // actually answers the question.
    const totalDocs = documents.length;
    const scored = documents
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
      `Retrieval for kind=${kind}: scanned ${totalDocs} doc(s) in ${
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
    kind: string = BOT_CONTEXT_DEFAULT_KIND,
    topK: number = BOT_CONTEXT_TOP_K,
  ): Promise<BotContextPreview> {
    const startedAt = Date.now();
    const retrieved = await this.retrieve(query, kind, topK);
    const { documents } = await this.loadDocuments(kind);
    const promptBlock = this.renderPromptBlock(retrieved);

    return {
      query,
      kind,
      scanned: documents.length,
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
  renderPromptBlock(retrieved: RetrievedBotContext[]): string {
    if (retrieved.length === 0) return '';

    const parts: string[] = [];
    let used = 0;
    for (const doc of retrieved) {
      const header = `### ${doc.title ?? 'Relevant Guide'}\n`;
      const separator = parts.length > 0 ? 2 : 0;
      const remaining =
        BOT_CONTEXT_MAX_INJECTED_CHARS - used - header.length - separator;
      if (remaining <= 0) break;
      const content = doc.content.slice(
        0,
        Math.min(BOT_CONTEXT_MAX_DOC_CHARS, remaining),
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
  }): Promise<BotContextDocumentRecord[]> {
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

  async findById(id: string): Promise<BotContextDocumentRecord> {
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
    content: string;
    active?: boolean;
    source?: string;
    externalId?: string;
    externalUrl?: string;
  }): Promise<BotContextDocumentRecord> {
    const created = await this.prisma.botContextDocument.create({
      data: {
        kind: input.kind ?? BOT_CONTEXT_DEFAULT_KIND,
        title: input.title ?? null,
        content: input.content,
        active: input.active ?? true,
        source: input.source ?? 'MANUAL',
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
      },
    });
    this.invalidateCache();
    this.logger.log(
      `Context document created: ${created.kind}/${created.title ?? created.id}`,
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
    },
  ): Promise<BotContextDocumentRecord> {
    await this.findById(id);
    const updated = await this.prisma.botContextDocument.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
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
        version: { increment: 1 },
      },
    });
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
   */
  async importSections(input: {
    kind?: string;
    title?: string;
    content: string;
    active?: boolean;
    source?: string;
    externalId?: string;
    externalUrl?: string;
  }): Promise<{
    created: number;
    documents: BotContextDocumentRecord[];
  }> {
    const kind = input.kind ?? BOT_CONTEXT_DEFAULT_KIND;
    const sections = this.splitIntoSections(input.content, input.title);

    const created: BotContextDocumentRecord[] = [];
    for (const section of sections) {
      created.push(
        await this.prisma.botContextDocument.create({
          data: {
            kind,
            title: section.title,
            content: section.content,
            active: input.active ?? true,
            source: input.source ?? 'MANUAL',
            externalId: input.externalId ?? null,
            externalUrl: input.externalUrl ?? null,
          },
        }),
      );
    }

    this.invalidateCache();
    this.logger.log(
      `Imported ${created.length} section(s) into kind=${kind}${
        input.externalId ? ` (drive file ${input.externalId})` : ''
      }`,
    );
    return { created: created.length, documents: created };
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
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

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
   * Reads the active documents for a kind, caching them (with term
   * frequencies and document frequencies pre-computed) for a short TTL. The
   * cache is dropped whenever a document is written through this service.
   */
  private async loadDocuments(kind: string): Promise<{
    documents: CachedDocument[];
    df: Map<string, number>;
    avgdl: number;
  }> {
    const cached = this.cache.get(kind);
    const now = Date.now();
    if (cached && now - cached.loadedAt < BOT_CONTEXT_CACHE_TTL_MS) {
      return {
        documents: cached.documents,
        df: cached.df,
        avgdl: cached.avgdl,
      };
    }

    const rows = await this.prisma.botContextDocument.findMany({
      where: { kind, active: true },
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

    this.cache.set(kind, { loadedAt: now, documents, df, avgdl });
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
      .filter((token) => !BOT_CONTEXT_STOPWORDS.has(token));
    for (const token of normalized) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    return tf;
  }
}
