#!/usr/bin/env bash
# One-off: copy the patient tables from the app database (DATABASE_URL) into
# the HIPAA database (DATABASE_URL_2), then compare row counts. Run from
# backend/ after `npx prisma db push` has created the tables in DATABASE_URL_2.
# Nothing is deleted from DATABASE_URL; drop those tables only after checking.
#
#   PG_BIN=/path/to/postgresql/17/bin bash scripts/maintenance/copy-phi-to-hipaa-db.sh
#
# Needs pg_dump/psql 17 or newer (PG_BIN, default: from PATH).
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_BIN=${PG_BIN:-$(dirname "$(command -v pg_dump)")}
TABLES=(User ProfileClient Invite Booking Session SessionReport TherapistNote ProgressMetric ProgressReport
        ProgressNote RiskFlag document_chunks WhatsAppMessage SupportTicket SupportReply AuditLog)

# Direct (non-pooler) connection, without the Prisma-only options libpq rejects.
url() {
  node -e 'require("dotenv").config(); const u = new URL(process.env[process.argv[1]]);
    u.hostname = u.hostname.replace("-pooler", "");
    for (const k of ["pool_timeout", "channel_binding"]) u.searchParams.delete(k);
    process.stdout.write(u.toString())' "$1"
}
SRC=$(url DATABASE_URL)
DST=$(url DATABASE_URL_2)

for t in "${TABLES[@]}"; do
  n=$("$PG_BIN/psql" "$DST" -tAc "select count(*) from public.\"$t\"")
  if [ "$n" != 0 ]; then echo "Stopped: \"$t\" in DATABASE_URL_2 already has $n rows." >&2; exit 1; fi
done

args=()
for t in "${TABLES[@]}"; do args+=(-t "public.\"$t\""); done

# Streamed straight from one database to the other: no patient data on disk.
# One transaction (-1): either every table is copied or none is.
"$PG_BIN/pg_dump" --data-only --no-owner --no-privileges "${args[@]}" -d "$SRC" \
  | "$PG_BIN/psql" "$DST" -v ON_ERROR_STOP=1 -q -1

echo "Row counts (app database -> HIPAA database):"
fail=0
for t in "${TABLES[@]}"; do
  a=$("$PG_BIN/psql" "$SRC" -tAc "select count(*) from public.\"$t\"")
  b=$("$PG_BIN/psql" "$DST" -tAc "select count(*) from public.\"$t\"")
  mark=ok; [ "$a" = "$b" ] || { mark=DIFFERENT; fail=1; }
  printf '  %-18s %6s -> %-6s %s\n' "$t" "$a" "$b" "$mark"
done
exit $fail
