-- A staff member can delete their own account (ROADMAP 19.3).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
