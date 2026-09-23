-- Sending an invoice to the customer (docs/ROADMAP.md Phase 3).
--
-- An invoice could be issued but never reached anyone: there was no email, no
-- customer-facing page and nothing to link to. `publicToken` is that page's
-- only key — the invoice number counts upwards, so it can never be what opens
-- it. Existing invoices get no token until they are next sent, which is
-- correct: nobody has been given a link to them.

-- AlterTable
ALTER TABLE "invoices"
  ADD COLUMN "publicToken"    TEXT,
  ADD COLUMN "sentAt"         TIMESTAMP(3),
  ADD COLUMN "lastReminderAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_publicToken_key" ON "invoices"("publicToken");
