-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "customAdminDomain" TEXT,
ADD COLUMN     "customStoreDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_customAdminDomain_key" ON "organizations"("customAdminDomain");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_customStoreDomain_key" ON "organizations"("customStoreDomain");
