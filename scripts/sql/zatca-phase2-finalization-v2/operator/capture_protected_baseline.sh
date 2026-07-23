#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

operator_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(CDPATH= cd -- "${operator_dir}/.." && pwd)"
repo_dir="$(CDPATH= cd -- "${package_dir}/../../.." && pwd)"

: "${PGSERVICE:?Set PGSERVICE to a libpq service name; do not put a password on the command line.}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF.}"
: "${VERCEL_PRODUCTION_URL:?Set VERCEL_PRODUCTION_URL to the current production deployment URL.}"
: "${RELEASE_LOG_DIR:?Set RELEASE_LOG_DIR to the protected release evidence directory.}"
: "${EDGE_KILL_SWITCH_CONFIRMED_FALSE:?Set EDGE_KILL_SWITCH_CONFIRMED_FALSE=YES only after inspecting the Edge configuration.}"
: "${EXPECTED_RELEASE_COMMIT:?Set EXPECTED_RELEASE_COMMIT to the reviewed release commit.}"
: "${EXPECTED_RELEASE_BRANCH:=feature/invoice-settings-ux-redesign}"
: "${LOCK_TIMEOUT:=5s}"
: "${STATEMENT_TIMEOUT:=10min}"

if [[ "${EDGE_KILL_SWITCH_CONFIRMED_FALSE}" != "YES" ]]; then
  echo "STOP: confirm ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false without copying other secret values." >&2
  exit 65
fi

for command_name in git jq psql shasum supabase vercel; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "STOP: required command is unavailable: ${command_name}" >&2
    exit 69
  }
done

current_branch="$(git -C "${repo_dir}" branch --show-current)"
current_commit="$(git -C "${repo_dir}" rev-parse HEAD)"
if [[ "${current_branch}" != "${EXPECTED_RELEASE_BRANCH}" ]]; then
  echo "STOP: branch ${current_branch} does not match ${EXPECTED_RELEASE_BRANCH}." >&2
  exit 65
fi
if [[ "${current_commit}" != "${EXPECTED_RELEASE_COMMIT}" ]]; then
  echo "STOP: HEAD ${current_commit} does not match reviewed commit ${EXPECTED_RELEASE_COMMIT}." >&2
  exit 65
fi
if [[ -n "$(git -C "${repo_dir}" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "STOP: release checkout is not clean." >&2
  exit 65
fi

mkdir -p -- "${RELEASE_LOG_DIR}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
baseline_dir="${RELEASE_LOG_DIR}/${timestamp}_protected_baseline"
mkdir -p -- "${baseline_dir}"

printf '%s\n' "${current_commit}" > "${baseline_dir}/git_commit.txt"
git -C "${repo_dir}" branch --show-current > "${baseline_dir}/git_branch.txt"
git -C "${repo_dir}" status --porcelain=v1 --untracked-files=all > "${baseline_dir}/git_status.txt"
shasum -a 256 \
  "${repo_dir}/supabase/functions/zatca-submit/index.ts" \
  "${repo_dir}/src/lib/zatca/submission.ts" \
  > "${baseline_dir}/reviewed_source_hashes.txt"

supabase functions list \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --output json \
  > "${baseline_dir}/supabase_functions.json"
jq '[.[] | select(.slug == "zatca-submit") | {
  slug, version, status, created_at, updated_at
}]' "${baseline_dir}/supabase_functions.json" \
  > "${baseline_dir}/zatca_submit_version.json"
jq -e 'length == 1' "${baseline_dir}/zatca_submit_version.json" >/dev/null

vercel inspect "${VERCEL_PRODUCTION_URL}" \
  > "${baseline_dir}/vercel_production.txt"

printf '%s\n' \
  'ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false (operator-confirmed; no secret values captured)' \
  > "${baseline_dir}/edge_kill_switch.txt"

PGOPTIONS="-c lock_timeout=${LOCK_TIMEOUT} -c statement_timeout=${STATEMENT_TIMEOUT} -c default_transaction_read_only=on" \
  psql "service=${PGSERVICE}" \
    -X \
    --set=ON_ERROR_STOP=1 \
    --set=VERBOSITY=verbose \
    --file="${package_dir}/00_hosted_preflight.sql" \
    > "${baseline_dir}/00_hosted_preflight.log" 2>&1

echo "PASS: protected baseline captured in ${baseline_dir}."
echo "STOP until two operators review Git/Edge/Vercel identities, hashes, invoice fingerprint, policies, grants, triggers, and flags."
