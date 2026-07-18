#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/asterisk-paths.sh
source "${SCRIPT_DIR}/../lib/asterisk-paths.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
CONFIG="${TEST_ROOT}/asterisk.conf"
SHARED="${TEST_ROOT}/usr-share-asterisk"
VARIABLE="${TEST_ROOT}/var-lib-asterisk"

printf '%s\n' \
  '[directories](!)' \
  'astdatadir => /srv/asterisk-data ; package override' \
  'astdatadir => /opt/asterisk-data' > "${CONFIG}"
[[ "$(discover_asterisk_data_dir "${CONFIG}" "${SHARED}" "${VARIABLE}")" == "/opt/asterisk-data" ]]

printf '%s\n' '[directories](!)' > "${CONFIG}"
mkdir -p "${SHARED}/sounds"
[[ "$(discover_asterisk_data_dir "${CONFIG}" "${SHARED}" "${VARIABLE}")" == "${SHARED}" ]]
rm -rf -- "${SHARED}"
[[ "$(discover_asterisk_data_dir "${CONFIG}" "${SHARED}" "${VARIABLE}")" == "${VARIABLE}" ]]

valid_asterisk_data_dir "/usr/share/asterisk"
! valid_asterisk_data_dir "relative/path"
! valid_asterisk_data_dir "/var/lib/../root"
! valid_asterisk_data_dir "/var/lib/asterisk;touch"

printf 'Asterisk data path discovery tests passed\n'
