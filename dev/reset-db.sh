#!/usr/bin/env bash
# Buat ulang database lokal: stub Supabase + semua migrasi. HANYA untuk lokal.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/market}"
ADMIN_URL="${DB_URL%/*}/postgres"
DB_NAME="${DB_URL##*/}"
psql "$ADMIN_URL" -q -c "drop database if exists \"$DB_NAME\" with (force)" -c "create database \"$DB_NAME\""
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f dev/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true
done
rm -rf dev/.storage
echo "Database lokal siap."
