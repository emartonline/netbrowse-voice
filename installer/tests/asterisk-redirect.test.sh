#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../templates/nbvoice-asterisk-redirect
source "${SCRIPT_DIR}/../templates/nbvoice-asterisk-redirect"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
REQUEST_ROOT="${TEST_ROOT}"
REDIRECT_LOG="${TEST_ROOT}/redirect.log"

expected_request_owner() {
  printf '%s:%s' "$(id -un)" "$(id -gn)"
}

run_redirect() {
  printf '%s|%s\n' "$1" "$2" >> "${REDIRECT_LOG}"
}

request="${REQUEST_ROOT}/valid.request"
printf 'PJSIP/100-00000001|102\n' > "${request}"
chmod 0600 "${request}"
process_request "${request}"
grep -Fqx 'PJSIP/100-00000001|102' "${REDIRECT_LOG}"
[[ ! -e "${request}" ]]

request="${REQUEST_ROOT}/unsafe.request"
printf 'PJSIP/100-00000001|102,System(touch /tmp/unsafe)\n' > "${request}"
chmod 0600 "${request}"
if (process_request "${request}") >/dev/null 2>&1; then
  printf 'unsafe redirect request was accepted\n' >&2
  exit 1
fi

request="${REQUEST_ROOT}/remote-context.request"
printf 'PJSIP/100-00000001|nbvoice-internal,102,1\n' > "${request}"
chmod 0600 "${request}"
if (process_request "${request}") >/dev/null 2>&1; then
  printf 'redirect context injection was accepted\n' >&2
  exit 1
fi

printf 'Asterisk redirect helper tests passed\n'
