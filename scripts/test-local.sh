#!/usr/bin/env bash
# Run the whole test suite the way CI does (ROADMAP 13.7): against a fresh
# throwaway Postgres 17 + pgvector in Docker, built from the migrations, with
# the placeholder settings in .env.ci — not your Neon database, and with no
# real keys. About a minute, against many for a remote database.
#
#   scripts/test-local.sh                 # everything
#   scripts/test-local.sh tests/foo.test.ts   # just some files
#
# Needs Docker (on this Mac: `colima start`).
set -euo pipefail
NAME=notely-test-db
PORT=55433
URL="postgresql://postgres:ci@localhost:$PORT/notely"

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=postgres -p "$PORT:5432" pgvector/pgvector:pg17 >/dev/null
fi
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec "$NAME" psql -U postgres -qc "DROP DATABASE IF EXISTS notely WITH (FORCE)" -c "CREATE DATABASE notely"

export DOTENV_CONFIG_PATH=.env.ci DATABASE_URL="$URL" DIRECT_URL="$URL"
npx prisma migrate deploy >/dev/null
npx vitest run --no-file-parallelism "$@"
echo "Done. Stop the database with: docker rm -f $NAME"
