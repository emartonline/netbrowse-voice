#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/asterisk-modules.sh
source "${SCRIPT_DIR}/../lib/asterisk-modules.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
MODULES_CONFIG="${TEST_ROOT}/modules.conf"

cat > "${MODULES_CONFIG}" <<'EOF'
[modules]
autoload=yes
noload = app_voicemail.so
load => app_voicemail_odbc.so

[global]
foo=bar
EOF

configure_asterisk_voicemail_modules "${MODULES_CONFIG}"
cp "${MODULES_CONFIG}" "${MODULES_CONFIG}.first"
configure_asterisk_voicemail_modules "${MODULES_CONFIG}"

cmp "${MODULES_CONFIG}.first" "${MODULES_CONFIG}"
[[ "$(grep -Fc 'noload => app_voicemail_odbc.so' "${MODULES_CONFIG}")" -eq 1 ]]
[[ "$(grep -Fc 'noload => app_voicemail_imap.so' "${MODULES_CONFIG}")" -eq 1 ]]
[[ "$(grep -Fc 'load => app_voicemail.so' "${MODULES_CONFIG}")" -eq 1 ]]
! grep -Fq 'noload = app_voicemail.so' "${MODULES_CONFIG}"
[[ "$(grep -nF 'load => app_voicemail.so' "${MODULES_CONFIG}" | cut -d: -f1)" -lt \
   "$(grep -nF '[global]' "${MODULES_CONFIG}" | cut -d: -f1)" ]]

printf 'Asterisk voicemail module configuration tests passed\n'
