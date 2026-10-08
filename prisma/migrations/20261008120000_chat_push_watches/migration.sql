-- ROADMAP 17.4: a phone in a store's app that asked to hear when the store replies in a chat.

-- CreateTable
CREATE TABLE "push_chat_watches" (
    "deviceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_chat_watches_pkey" PRIMARY KEY ("deviceId","conversationId")
);

-- CreateIndex
CREATE INDEX "push_chat_watches_conversationId_idx" ON "push_chat_watches"("conversationId");

-- AddForeignKey
ALTER TABLE "push_chat_watches" ADD CONSTRAINT "push_chat_watches_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_chat_watches" ADD CONSTRAINT "push_chat_watches_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

