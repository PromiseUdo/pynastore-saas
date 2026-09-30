-- ROADMAP 13.3: one alerts table for jobs, webhooks and errors; the error log.
ALTER TABLE "cron_alerts" RENAME TO "ops_alerts";
ALTER TABLE "ops_alerts" RENAME COLUMN "job" TO "subject";
ALTER TABLE "ops_alerts" RENAME CONSTRAINT "cron_alerts_pkey" TO "ops_alerts_pkey";
ALTER INDEX "cron_alerts_job_kind_key" RENAME TO "ops_alerts_subject_kind_key";
UPDATE "ops_alerts" SET "subject" = 'cron:' || "subject";

CREATE TABLE "error_groups" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "where" TEXT NOT NULL,
    "kind" TEXT,
    "message" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStack" TEXT,
    "lastPath" TEXT,
    "lastDigest" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "error_groups_fingerprint_key" ON "error_groups"("fingerprint");
CREATE INDEX "error_groups_resolvedAt_lastSeenAt_idx" ON "error_groups"("resolvedAt", "lastSeenAt");
CREATE INDEX "error_groups_lastSeenAt_idx" ON "error_groups"("lastSeenAt");

CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "path" TEXT,
    "host" TEXT,
    "digest" TEXT,
    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "error_events_groupId_occurredAt_idx" ON "error_events"("groupId", "occurredAt");
CREATE INDEX "error_events_occurredAt_idx" ON "error_events"("occurredAt");
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
