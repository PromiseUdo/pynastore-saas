-- ROADMAP 13.1: a record of every scheduled-job run, and the alerts sent about them.
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "durationMs" INTEGER,
    "result" JSONB,
    "error" TEXT,
    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cron_runs_job_startedAt_idx" ON "cron_runs"("job", "startedAt");
CREATE INDEX "cron_runs_startedAt_idx" ON "cron_runs"("startedAt");

CREATE TABLE "cron_alerts" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cron_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cron_alerts_job_kind_key" ON "cron_alerts"("job", "kind");
