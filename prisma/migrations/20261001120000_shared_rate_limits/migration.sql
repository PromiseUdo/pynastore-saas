-- ROADMAP 13.2: rate limits and model budgets shared by every server instance.
-- One row per bucket (fixed window). Rows are disposable: an expired row is
-- reset in place on its next use, and old ones are swept by lib/rate-limit.ts.
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");

-- Take one from each bucket, in order, in ONE round trip.
--   returns -1  every bucket had room (all were counted)
--   returns  0  `blocked_by` names a cool-down still running (nothing counted)
--   returns  i  bucket i (1-based) was full: buckets before it were counted,
--               it and those after it were not — the same as the old
--               in-memory `a && b && c` chain.
-- Each bucket is one atomic upsert, so concurrent callers can't both take
-- the last unit.
CREATE OR REPLACE FUNCTION rate_limit_take(
    p_keys TEXT[],
    p_limits INTEGER[],
    p_windows_ms BIGINT[],
    p_blocked_by TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    i INTEGER;
    taken INTEGER;
    now_ts TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
BEGIN
    IF p_blocked_by IS NOT NULL AND EXISTS (
        SELECT 1 FROM rate_limit_buckets WHERE "key" = p_blocked_by AND "resetAt" > now_ts
    ) THEN
        RETURN 0;
    END IF;

    FOR i IN 1 .. COALESCE(array_length(p_keys, 1), 0) LOOP
        INSERT INTO rate_limit_buckets AS b ("key", "count", "resetAt")
        VALUES (p_keys[i], 1, now_ts + p_windows_ms[i] * INTERVAL '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET
            "count"   = CASE WHEN b."resetAt" <= now_ts THEN 1 ELSE b."count" + 1 END,
            "resetAt" = CASE WHEN b."resetAt" <= now_ts THEN EXCLUDED."resetAt" ELSE b."resetAt" END
        WHERE b."resetAt" <= now_ts OR b."count" < p_limits[i]
        RETURNING b."count" INTO taken;

        IF NOT FOUND THEN
            RETURN i;
        END IF;
    END LOOP;

    RETURN -1;
END;
$$;
