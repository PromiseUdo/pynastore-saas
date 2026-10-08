-- ROADMAP 17.1: Messages — shoppers chat with the store.
-- One conversation per shopper per store; messages ordered by a per-conversation seq.

-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('CUSTOMER', 'STAFF');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "chatInboxSeenAt" TIMESTAMP(3),
ADD COLUMN     "storefrontChatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storefrontChatGreeting" TEXT;

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestKeyHash" TEXT,
    "guestName" TEXT,
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastSender" "ChatSender" NOT NULL,
    "lastPreview" TEXT NOT NULL,
    "staffReadSeq" INTEGER NOT NULL DEFAULT 0,
    "customerReadSeq" INTEGER NOT NULL DEFAULT 0,
    "customerSeenAt" TIMESTAMP(3),
    "staffAlertedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "staffUserId" TEXT,
    "body" TEXT NOT NULL,
    "productId" TEXT,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversations_organizationId_status_lastMessageAt_idx" ON "chat_conversations"("organizationId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_conversations_organizationId_lastMessageAt_idx" ON "chat_conversations"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_conversations_customerId_idx" ON "chat_conversations"("customerId");

-- CreateIndex
CREATE INDEX "chat_conversations_resolvedByUserId_idx" ON "chat_conversations"("resolvedByUserId");

-- CreateIndex
CREATE INDEX "chat_conversations_blockedByUserId_idx" ON "chat_conversations"("blockedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_organizationId_customerId_key" ON "chat_conversations"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_organizationId_guestKeyHash_key" ON "chat_conversations"("organizationId", "guestKeyHash");

-- CreateIndex
CREATE INDEX "chat_messages_organizationId_idx" ON "chat_messages"("organizationId");

-- CreateIndex
CREATE INDEX "chat_messages_staffUserId_idx" ON "chat_messages"("staffUserId");

-- CreateIndex
CREATE INDEX "chat_messages_productId_idx" ON "chat_messages"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_conversationId_seq_key" ON "chat_messages"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_conversationId_clientId_key" ON "chat_messages"("conversationId", "clientId");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_blockedByUserId_fkey" FOREIGN KEY ("blockedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions: messages.view and messages.reply. The Owner holds every
-- permission without a row (lib/organization.ts); the built-in Admin role is a
-- stored snapshot, so existing Admins are granted both here. Other roles get
-- them from Roles & Permissions.
INSERT INTO "permissions" ("id", "key", "module")
VALUES
    (gen_random_uuid()::text, 'messages.view', 'messages'),
    (gen_random_uuid()::text, 'messages.reply', 'messages')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."isSystem" = true
  AND r."name" = 'Admin'
  AND p."key" IN ('messages.view', 'messages.reply')
ON CONFLICT DO NOTHING;
