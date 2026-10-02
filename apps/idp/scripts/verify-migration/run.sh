#!/usr/bin/env bash
# Rehearses the pending migrations against a copy of production data.
#
#   1. exports the production D1 (read-only) to $WORK/prod.sql
#   2. imports it into an isolated local D1 under $WORK/state (never the dev state)
#   3. optionally runs a pre-migration SQL file (e.g. the d1_migrations rename)
#   4. applies pending migrations with wrangler, exactly as prod would
#   5. compares every table and row before vs after (compare.py)
#
# Usage: scripts/verify-migration/run.sh <expectations.json> [pre.sql]
# WORK defaults to ../../.context/verify-migration (gitignored: it holds real data).
set -euo pipefail
cd "$(dirname "$0")/../.."

EXPECT="$1"
PRE="${2:-}"
WORK="${WORK:-../../.context/verify-migration}"
STATE="$WORK/state"
rm -rf "$STATE" && mkdir -p "$WORK"

echo "== export production (read-only)"
npx wrangler d1 export db --remote --output "$WORK/prod.sql" >/dev/null

echo "== import into isolated local D1"
# Local D1 enforces foreign keys and the export creates tables alphabetically, so
# load the dump with sqlite3 (FKs off) straight into the D1's own file.
npx wrangler d1 execute db --local --persist-to "$STATE" --command "select 1" >/dev/null
DB="$(find "$STATE" -name '*.sqlite' -not -name 'metadata.sqlite' | head -1)"
sqlite3 -bail "$DB" < "$WORK/prod.sql"
sqlite3 "$DB" ".backup $WORK/before.sqlite"

if [ -n "$PRE" ]; then
  echo "== pre-migration SQL: $PRE"
  npx wrangler d1 execute db --local --persist-to "$STATE" --file "$PRE" >/dev/null
fi

echo "== pending migrations"
npx wrangler d1 migrations list db --local --persist-to "$STATE"
echo "== apply"
npx wrangler d1 migrations apply db --local --persist-to "$STATE"
sqlite3 "$DB" ".backup $WORK/after.sqlite"  # .backup includes the WAL; a plain cp would not

echo "== compare"
python3 scripts/verify-migration/compare.py "$WORK/before.sqlite" "$WORK/after.sqlite" "$EXPECT"
