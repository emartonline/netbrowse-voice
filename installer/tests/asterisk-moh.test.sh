#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/asterisk-moh.sh
source "${SCRIPT_DIR}/../lib/asterisk-moh.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
CONFIG="${TEST_ROOT}/musiconhold.conf"
MOH_DIR="${TEST_ROOT}/moh"
mkdir -p "${MOH_DIR}"

cat > "${CONFIG}" <<'EOF'
[general]
foo=yes

[default]
mode=files
directory=moh

[other]
directory=/leave/unchanged
EOF

configure_asterisk_moh_directory "${CONFIG}" "${MOH_DIR}"
cp "${CONFIG}" "${CONFIG}.first"
configure_asterisk_moh_directory "${CONFIG}" "${MOH_DIR}"

cmp "${CONFIG}.first" "${CONFIG}"
grep -Fqx "directory=${MOH_DIR}" "${CONFIG}"
grep -Fqx 'directory=/leave/unchanged' "${CONFIG}"
[[ "$(grep -Fc "directory=${MOH_DIR}" "${CONFIG}")" -eq 1 ]]

printf 'Asterisk music-on-hold configuration tests passed\n'
