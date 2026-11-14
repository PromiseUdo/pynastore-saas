-- Wholesale: delivery options by audience, and a trade free-delivery threshold (ROADMAP 21.4A).

-- CreateEnum
CREATE TYPE "DeliveryAudience" AS ENUM ('EVERYONE', 'RETAIL', 'TRADE');

-- AlterTable
ALTER TABLE "delivery_rates" ADD COLUMN     "audience" "DeliveryAudience" NOT NULL DEFAULT 'EVERYONE',
ADD COLUMN     "tradeFreeOver" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "pickup_locations" ADD COLUMN     "audience" "DeliveryAudience" NOT NULL DEFAULT 'EVERYONE';

