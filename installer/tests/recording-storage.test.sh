#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/../install.sh"

bash -n "${INSTALLER}"

# Asterisk must be able to traverse STATE_ROOT before it can write into the
# separately protected recordings directory.  0751 permits traversal without
# exposing the state directory listing to unrelated users.
grep -Fq 'install -d -m 0751 -o nbvoice -g nbvoice "${STATE_ROOT}"' "${INSTALLER}"
grep -Fq 'install -d -m 0770 -o asterisk -g asterisk "${STATE_ROOT}/recordings"' "${INSTALLER}"

printf 'Call-recording storage permission tests passed\n'
