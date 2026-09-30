-- ROADMAP 12.5: merchant onboarding. Existing shops stay open (default true);
-- new ones are created closed by the application.
ALTER TABLE "organizations" ADD COLUMN "storefrontOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "organizations" ADD COLUMN "storefrontOpenedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "businessType" TEXT;
ALTER TABLE "organizations" ADD COLUMN "salesChannels" TEXT;
ALTER TABLE "organizations" ADD COLUMN "setupGuideDismissedAt" TIMESTAMP(3);

CREATE TABLE "onboarding_emails" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_emails_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "onboarding_emails_organizationId_kind_key" ON "onboarding_emails"("organizationId", "kind");
ALTER TABLE "onboarding_emails" ADD CONSTRAINT "onboarding_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
