#!/usr/bin/env bash
# A local Postgres for development (docs/DATABASE.md, "Developing without
# Neon"): the same pgvector image the tests use, but kept — its data lives in
# the Docker volume notely-dev-data and survives restarts. Starts it (or
# creates it the first time), then applies any new migrations.
#
#   npm run db:local            # start it (and apply new migrations)
#   npm run db:local -- --reset # wipe it: every account, shop and order, gone
#
# .env points at it with:
#   DATABASE_URL / DIRECT_URL = postgresql://postgres:dev@localhost:55432/notely
#   SHADOW_DATABASE_URL       = postgresql://postgres:dev@localhost:55432/shadow
#
# Needs Docker (on this Mac: `colima start`).
set -euo pipefail
NAME=notely-dev-db
PORT=55432

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" --restart unless-stopped -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=notely \
    -p "$PORT:5432" -v notely-dev-data:/var/lib/postgresql/data pgvector/pgvector:pg17 >/dev/null
  until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  docker exec "$NAME" psql -U postgres -qc "CREATE DATABASE shadow"
  FIRST=1
else
  docker start "$NAME" >/dev/null
  until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
fi

if [ "${1:-}" = "--reset" ]; then
  # Local only — this container never holds anything but development data.
  docker exec "$NAME" psql -U postgres -qc "DROP DATABASE IF EXISTS notely WITH (FORCE)" -c "CREATE DATABASE notely"
  FIRST=1
  echo "Local database wiped."
fi

npx prisma migrate deploy
if [ "${FIRST:-0}" = 1 ]; then npx prisma db seed; fi
echo "Local database ready on localhost:$PORT."
