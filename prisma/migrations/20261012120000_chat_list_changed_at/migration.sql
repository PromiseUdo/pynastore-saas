-- Messages: a change signal for the inbox list that read marks and the
-- shopper's "panel open" mark don't move (see ChatConversation.listChangedAt).

-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "listChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "chat_conversations_organizationId_listChangedAt_idx" ON "chat_conversations"("organizationId", "listChangedAt");


-- Existing rows start from their latest message.
UPDATE "chat_conversations" SET "listChangedAt" = "lastMessageAt";
