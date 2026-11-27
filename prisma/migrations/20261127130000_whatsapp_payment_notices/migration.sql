ALTER TABLE "Member" ADD COLUMN "whatsappUnsubscribedAt" TIMESTAMP(3);
UPDATE "Member" AS member
SET "whatsappUnsubscribedAt" = optout."sentAt"
FROM (
  SELECT thread."memberId", max(message."sentAt") AS "sentAt"
  FROM "BotChatThread" AS thread
  JOIN "BotChatMessage" AS message ON message."threadId" = thread.id
  WHERE message.direction = 'OUTBOUND'
    AND message.content IN (
      'I’ve turned off WhatsApp renewal reminders.',
      'Nimezima vikumbusho vya malipo ya uanachama.'
    )
  GROUP BY thread."memberId"
) AS optout
WHERE member.id = optout."memberId" AND member."whatsappRenewalOptIn" = false;
CREATE TABLE "WhatsappPaymentNotice" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "WhatsappPaymentNotice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsappPaymentNotice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WhatsappPaymentNotice_finishedAt_nextAttempt_idx"
ON "WhatsappPaymentNotice"("finishedAt", "nextAttempt");
