#!/usr/bin/env bash
# Reset DB lokal -> uji SQL -> jalankan server lokal -> uji E2E browser -> matikan server.
set -uo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/market}"
./dev/reset-db.sh >/dev/null || exit 1
echo "== Uji alur SQL"; psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f dev/test-flow.sql >/dev/null && echo "OK" || exit 1
node dev/local-supabase.mjs > dev/.server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; pkill -x postgrest 2>/dev/null' EXIT
sleep 3
echo "== Uji E2E browser"; node dev/e2e.mjs
