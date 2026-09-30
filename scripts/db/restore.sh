#!/usr/bin/env bash
# Restore an encrypted backup into an EMPTY database and prove it's complete
# (ROADMAP 13.6): every table's row count must equal what was counted when
# the backup was taken. Exits non-zero if anything differs.
#
#   scripts/db/restore.sh notely-20261001-0130.tar.gpg postgresql://…/empty_db
#
#   BACKUP_PASSPHRASE  the passphrase the backup was made with
#
# The target must be empty and must have the pgvector extension available
# (Neon has it; locally use the pgvector/pgvector:pg17 image). NEVER point
# this at a database with data you want — restore into a new Neon branch or
# a scratch database, check it, then switch over.
set -euo pipefail
BACKUP="${1:?usage: restore.sh <backup.tar.gpg> <target database url>}"
TARGET="${2:?usage: restore.sh <backup.tar.gpg> <target database url>}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d "$BACKUP" | tar -C "$WORK" -xf -
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$WORK/notely.dump"
psql "$TARGET" -At -v ON_ERROR_STOP=1 -f "$HERE/row-counts.sql" > "$WORK/restored-counts.txt"

if diff -u "$WORK/counts.txt" "$WORK/restored-counts.txt"; then
  echo "Restore verified: $(wc -l < "$WORK/counts.txt") tables, $(awk '{s+=$2} END {print s}' "$WORK/counts.txt") rows, as taken at $(cat "$WORK/taken-at.txt")."
else
  echo "Restore INCOMPLETE: the row counts above differ from the backup's." >&2
  exit 1
fi
