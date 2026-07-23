#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

operator_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(CDPATH= cd -- "${operator_dir}/.." && pwd)"
repo_dir="$(CDPATH= cd -- "${package_dir}/../../.." && pwd)"
step="${1:-}"

case "${step}" in
  00) sql_file="${package_dir}/00_hosted_preflight.sql" ;;
  01) sql_file="${package_dir}/01_artifact_lifecycle.sql" ;;
  02) sql_file="${package_dir}/02_chain_allocator.sql" ;;
  03) sql_file="${package_dir}/03_claims_and_idempotency.sql" ;;
  04) sql_file="${package_dir}/04_lock_compliance_fields.sql" ;;
  04a) sql_file="${package_dir}/04a_safe_invoice_read_surface.sql" ;;
  05) sql_file="${package_dir}/05_capabilities_and_status.sql" ;;
  06) sql_file="${package_dir}/06_verification.sql" ;;
  09) sql_file="${package_dir}/09_branch_readiness_gate.sql" ;;
  10) sql_file="${package_dir}/10_branch_readiness_verification.sql" ;;
  11) sql_file="${package_dir}/11_durable_simplified_reporting_outbox.sql" ;;
  12) sql_file="${package_dir}/12_atomic_simplified_checkout_v2.sql" ;;
  *)
    echo "Usage: $0 {00|01|02|03|04|04a|05|06|09|10|11|12}" >&2
    exit 64
    ;;
esac

: "${PGSERVICE:?Set PGSERVICE to a libpq service name; do not put a password on the command line.}"
: "${RELEASE_LOG_DIR:?Set RELEASE_LOG_DIR to the protected release evidence directory.}"
: "${EXPECTED_RELEASE_COMMIT:?Set EXPECTED_RELEASE_COMMIT to the reviewed release commit.}"
: "${EXPECTED_RELEASE_BRANCH:=feature/invoice-settings-ux-redesign}"
: "${LOCK_TIMEOUT:=5s}"
: "${STATEMENT_TIMEOUT:=10min}"

current_commit="$(git -C "${repo_dir}" rev-parse HEAD)"
current_branch="$(git -C "${repo_dir}" branch --show-current)"
if [[ "${current_commit}" != "${EXPECTED_RELEASE_COMMIT}" ]]; then
  echo "STOP: HEAD ${current_commit} does not match reviewed commit ${EXPECTED_RELEASE_COMMIT}." >&2
  exit 65
fi
if [[ "${current_branch}" != "${EXPECTED_RELEASE_BRANCH}" ]]; then
  echo "STOP: branch ${current_branch} does not match ${EXPECTED_RELEASE_BRANCH}." >&2
  exit 65
fi
if [[ -n "$(git -C "${repo_dir}" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "STOP: release checkout is not clean." >&2
  exit 65
fi

if [[ "${step}" != "00" ]]; then
  : "${MAINTENANCE_APPROVED:?Set MAINTENANCE_APPROVED=YES after the billing pause is active.}"
  : "${CLIENT_DRAIN_CONFIRMED:?Set CLIENT_DRAIN_CONFIRMED=YES after every Kubri tab/window is closed.}"
  : "${EDGE_KILL_SWITCH_CONFIRMED_FALSE:?Set EDGE_KILL_SWITCH_CONFIRMED_FALSE=YES after console and capability verification.}"
  if [[ "${MAINTENANCE_APPROVED}" != "YES"
        || "${CLIENT_DRAIN_CONFIRMED}" != "YES"
        || "${EDGE_KILL_SWITCH_CONFIRMED_FALSE}" != "YES" ]]; then
    echo "STOP: maintenance, client drain, and false Edge kill switch must all be confirmed with YES." >&2
    exit 65
  fi
fi

mkdir -p -- "${RELEASE_LOG_DIR}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
step_log="${RELEASE_LOG_DIR}/${timestamp}_${step}_$(basename "${sql_file}" .sql).log"
flag_log="${RELEASE_LOG_DIR}/${timestamp}_${step}_flags_false.log"

trap 'echo "STOP: SQL step failed. Keep billing closed and inspect the step log." >&2' ERR

{
  echo "step=${step}"
  echo "release_commit=${current_commit}"
  echo "release_branch=${current_branch}"
  echo "captured_at=${timestamp}"
  shasum -a 256 "${sql_file}"
} | tee "${step_log}"

PGOPTIONS="-c lock_timeout=${LOCK_TIMEOUT} -c statement_timeout=${STATEMENT_TIMEOUT} -c idle_in_transaction_session_timeout=2min" \
  psql "service=${PGSERVICE}" \
    -X \
    --set=ON_ERROR_STOP=1 \
    --set=VERBOSITY=verbose \
    --file="${sql_file}" 2>&1 | tee -a "${step_log}"

if [[ "${step}" != "00" ]]; then
  PGOPTIONS="-c lock_timeout=${LOCK_TIMEOUT} -c statement_timeout=2min -c default_transaction_read_only=on" \
    psql "service=${PGSERVICE}" \
      -X \
      --set=ON_ERROR_STOP=1 \
      --set=VERBOSITY=verbose \
      --file="${operator_dir}/verify_flags_false.sql" 2>&1 | tee "${flag_log}"
fi

echo "PASS: step ${step} completed. Review ${step_log} before authorizing the next step."
