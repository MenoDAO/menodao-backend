-- Bot context documents (retrieval layer): "bible" source docs for persona grounding.

CREATE TABLE "BotContextDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BIBLE',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotContextDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotContextDocument_kind_idx" ON "BotContextDocument"("kind");
CREATE INDEX "BotContextDocument_active_idx" ON "BotContextDocument"("active");
