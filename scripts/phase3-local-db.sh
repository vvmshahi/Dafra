#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_url="${DAFRA_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

case "$db_url" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *)
    echo "Refusing database operation: DAFRA_LOCAL_DB_URL must target 127.0.0.1 or localhost." >&2
    exit 64
    ;;
esac

case "${1:-check}" in
  check)
    echo "Local database target safety check passed. No SQL was executed."
    ;;
  start)
    cd "$project_root"
    exec supabase start -x storage-api,imgproxy,supavisor
    ;;
  reset)
    if [[ ! -f "$project_root/supabase/migrations/PHASE3_BASELINE_READY" ]]; then
      echo "Refusing reset: the reviewed baseline-ready marker does not exist." >&2
      exit 65
    fi
    if [[ "${DAFRA_ALLOW_LOCAL_RESET:-}" != "YES" ]]; then
      echo "Refusing reset: set DAFRA_ALLOW_LOCAL_RESET=YES after reviewing the localhost target." >&2
      exit 66
    fi
    cd "$project_root"
    exec supabase db reset --local
    ;;
  *)
    echo "Usage: scripts/phase3-local-db.sh [check|start|reset]" >&2
    exit 64
    ;;
esac
