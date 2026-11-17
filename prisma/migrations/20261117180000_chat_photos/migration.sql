-- Photos in Messages: either side may send one with a message; it is
-- deleted from Cloudinary after 7 days (photoExpiresAt stays as a marker).
ALTER TABLE "chat_messages" ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "photoPublicId" TEXT,
ADD COLUMN "photoWidth" INTEGER,
ADD COLUMN "photoHeight" INTEGER,
ADD COLUMN "photoExpiresAt" TIMESTAMP(3);

CREATE INDEX "chat_messages_photoExpiresAt_idx" ON "chat_messages"("photoExpiresAt");
