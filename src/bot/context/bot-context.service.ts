import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const BOT_CONTEXT_DEFAULT_KIND = 'BIBLE';
export const BOT_CONTEXT_TOP_K = 3;

export interface BotContextDocumentRecord {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  active: boolean;
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

/**
 * BotContextService — retrieval layer for the Dr. Papi bot.
 *
 * Backing store for the "bible" source documents the assistant grounds its
 * answers in. Retrieval is a lightweight keyword-overlap scoring pass over the
 * active documents for a given kind — no external embedding service, no vector
 * DB (keeps the Lightsail zero-cost footprint and response latency flat).
 */
@Injectable()
export class BotContextService {
  private readonly logger = new Logger(BotContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    kind: string = BOT_CONTEXT_DEFAULT_KIND,
  ): Promise<BotContextDocumentRecord[]> {
    return this.prisma.botContextDocument.findMany({
      where: { kind },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async save(input: {
    kind?: string;
    title?: string;
    content: string;
    active?: boolean;
  }): Promise<BotContextDocumentRecord> {
    return this.prisma.botContextDocument.create({
      data: {
        kind: input.kind ?? BOT_CONTEXT_DEFAULT_KIND,
        title: input.title ?? null,
        content: input.content,
        active: input.active ?? true,
      },
    });
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.prisma.botContextDocument.delete({
      where: { id },
    });
    this.logger.log(`Bot context document ${id} (${result.kind}) removed`);
    return true;
  }

  async retrieve(
    query: string,
    kind: string = BOT_CONTEXT_DEFAULT_KIND,
    topK: number = BOT_CONTEXT_TOP_K,
  ): Promise<RetrievedBotContext[]> {
    const docs = await this.prisma.botContextDocument.findMany({
      where: { kind, active: true },
      orderBy: { updatedAt: 'desc' },
    });

    const queryTokens = this.tokenize(query);
    const scored = docs
      .map((doc) => {
        const docTokens = this.tokenize(doc.content);
        let overlap = 0;
        for (const token of queryTokens) {
          if (docTokens.has(token)) overlap += 1;
        }
        const score =
          overlap > 0 ? overlap / Math.max(1, Math.sqrt(docTokens.size)) : 0;
        return { doc, overlap, score };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.doc.updatedAt.getTime() - a.doc.updatedAt.getTime(),
      )
      .slice(0, topK);

    return scored.map(({ doc, score }) => ({
      documentId: doc.id,
      kind: doc.kind,
      title: doc.title,
      content: doc.content,
      score,
    }));
  }

  private tokenize(input: string): Set<string> {
    const tokens = new Set<string>();
    const normalized = (input ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2);
    for (const token of normalized) tokens.add(token);
    return tokens;
  }
}
