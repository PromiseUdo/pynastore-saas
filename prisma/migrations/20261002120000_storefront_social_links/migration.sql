-- ROADMAP 15.0: the shop's social profiles, and a default light/dark for
-- shoppers who haven't picked one.
ALTER TABLE "organizations" ADD COLUMN "storefrontSocialLinks" JSONB,
ADD COLUMN "storefrontDarkByDefault" BOOLEAN NOT NULL DEFAULT false;
