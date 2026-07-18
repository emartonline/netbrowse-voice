#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/asterisk-cdr.sh
source "${SCRIPT_DIR}/../lib/asterisk-cdr.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT
TARGET="${TEST_ROOT}/cdr.conf"

cat > "${TARGET}" <<'CONF'
[general]
enable=no
unanswered=no

[csv]
usegmtime=no
CONF

# Test against a local file without requiring the Asterisk group.
install() {
  command cp "${@: -2:1}" "${@: -1}"
}

configure_asterisk_cdr_general "${TARGET}"
grep -qx 'enable=yes' "${TARGET}"
grep -qx 'unanswered=yes' "${TARGET}"
grep -qx 'congestion=yes' "${TARGET}"
grep -qx 'safeshutdown=yes' "${TARGET}"
[[ "$(grep -c '^enable=' "${TARGET}")" -eq 1 ]]

configure_asterisk_cdr_general "${TARGET}"
[[ "$(grep -c '^enable=' "${TARGET}")" -eq 1 ]]
[[ "$(grep -c '^; BEGIN Netbrowse Voice' "${TARGET}")" -eq 1 ]]

PGSQL_TARGET="${TEST_ROOT}/cdr_pgsql.conf"
write_asterisk_pgsql_cdr "${PGSQL_TARGET}" "0123456789abcdef0123456789abcdef0123456789abcdef"
grep -qx 'hostname=127.0.0.1' "${PGSQL_TARGET}"
grep -qx 'dbname=netbrowse_voice' "${PGSQL_TARGET}"
grep -qx 'table=call_detail_records' "${PGSQL_TARGET}"
grep -qx 'password=0123456789abcdef0123456789abcdef0123456789abcdef' "${PGSQL_TARGET}"

printf 'Asterisk CDR configuration tests passed\n'
