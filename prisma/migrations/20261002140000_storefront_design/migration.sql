-- ROADMAP 15.1: the shop's look, as a published design and a draft.
CREATE TABLE "storefront_designs" (
    "organizationId" TEXT NOT NULL,
    "draft" JSONB,
    "draftSavedAt" TIMESTAMP(3),
    "draftSavedById" TEXT,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_designs_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "storefront_designs" ADD CONSTRAINT "storefront_designs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
