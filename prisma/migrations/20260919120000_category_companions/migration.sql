-- "Goes well with": a merchant's own category pairings (see Category.companionIds).
ALTER TABLE "categories" ADD COLUMN     "companionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "companionTitle" TEXT;
