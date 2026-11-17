-- A light version of the shop's logo for the storefront's dark mode (optional).
ALTER TABLE "organizations" ADD COLUMN "logoDarkUrl" TEXT;
ALTER TABLE "organizations" ADD COLUMN "logoDarkPublicId" TEXT;
