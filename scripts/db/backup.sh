#!/usr/bin/env bash
# Dump the database, record its row counts, and encrypt both (ROADMAP 13.6).
#
#   BACKUP_DATABASE_URL  the DIRECT (not -pooler) address of the database
#   BACKUP_PASSPHRASE    encrypts the backup; without it the backup is unreadable
#   OUT_DIR              where to write (default ./backup)
#
# Needs pg_dump/psql of the SERVER's major version (17) and gpg.
# Writes notely-<UTC stamp>.tar.gpg: the custom-format dump plus counts.txt.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
OUT_DIR="${OUT_DIR:-backup}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date -u +%Y%m%d-%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The dump and the row counts must see the SAME moment, or a write landing
# in between (a scheduled job, an order) makes a perfect restore look
# incomplete. One transaction exports its snapshot, pg_dump reads through it,
# and the counts are taken inside that same transaction before it closes.
coproc PSQL { psql "$BACKUP_DATABASE_URL" -qAt -v ON_ERROR_STOP=1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${PSQL[1]}"
read -r SNAPSHOT <&"${PSQL[0]}"
pg_dump "$BACKUP_DATABASE_URL" --snapshot="$SNAPSHOT" --format=custom --no-owner --no-privileges --file="$WORK/notely.dump"
{
  echo "\\o $WORK/counts.txt"
  cat "$HERE/row-counts.sql"
  echo "\\o"
  echo "SELECT 'counted';"
} >&"${PSQL[1]}"
read -r DONE <&"${PSQL[0]}"
[ "$DONE" = "counted" ] || { echo "Counting rows failed" >&2; exit 1; }
echo "COMMIT;" >&"${PSQL[1]}"
exec {PSQL[1]}>&-
wait "$PSQL_PID" 2>/dev/null || true
date -u +%Y-%m-%dT%H:%M:%SZ > "$WORK/taken-at.txt"

mkdir -p "$OUT_DIR"
tar -C "$WORK" -cf - notely.dump counts.txt taken-at.txt \
  | gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
        --symmetric --cipher-algo AES256 -o "$OUT_DIR/notely-$STAMP.tar.gpg"
echo "Backed up $(wc -l < "$WORK/counts.txt") tables, $(awk '{s+=$2} END {print s}' "$WORK/counts.txt") rows → $OUT_DIR/notely-$STAMP.tar.gpg"
