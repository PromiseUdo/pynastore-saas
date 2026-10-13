-- The business app's one-minute, single-use tickets (ROADMAP 19.2).

-- CreateTable
CREATE TABLE "staff_app_tickets" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_app_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_app_tickets_expiresAt_idx" ON "staff_app_tickets"("expiresAt");
