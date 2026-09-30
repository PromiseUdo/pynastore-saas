-- ROADMAP 11.1: platform staff may open the platform console. Default false,
-- so no existing user gains anything.
ALTER TABLE "users" ADD COLUMN "isPlatformStaff" BOOLEAN NOT NULL DEFAULT false;
