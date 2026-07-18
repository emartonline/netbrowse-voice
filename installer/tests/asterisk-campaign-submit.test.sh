#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../templates/nbvoice-asterisk-campaign-submit
source "${SCRIPT_DIR}/../templates/nbvoice-asterisk-campaign-submit"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
OUTBOX_ROOT="${TEST_ROOT}/outbox"
OUTGOING_ROOT="${TEST_ROOT}/outgoing"
mkdir -p "${OUTBOX_ROOT}" "${OUTGOING_ROOT}"

expected_request_owner() {
  printf '%s:%s' "$(id -un)" "$(id -gn)"
}

install_call_file() {
  install -m 0600 "$1" "${OUTGOING_ROOT}/$2"
}

ATTEMPT_ID="cda43e55-6388-40d8-a373-a3a8ca09ce5b"
REQUEST="${OUTBOX_ROOT}/nbvoice-campaign-${ATTEMPT_ID}.call"
printf '%s\n' \
  'Channel: Local/s@nbvoice-campaign-originate/n' \
  'Callerid: +27101234567' \
  'MaxRetries: 0' \
  'RetryTime: 60' \
  'WaitTime: 45' \
  'Context: nbvoice-internal' \
  'Extension: 600' \
  'Priority: 1' \
  "Setvar: __NBVOICE_CAMPAIGN_ATTEMPT_ID=${ATTEMPT_ID}" \
  'Setvar: __NBVOICE_CAMPAIGN_DESTINATION=27821234567' \
  'Setvar: __NBVOICE_CAMPAIGN_TRUNK=nbvt-0123456789abcdef0123456789abcdef' \
  'Setvar: __NBVOICE_CAMPAIGN_CALLER_ID=+27101234567' \
  'Setvar: __NBVOICE_CAMPAIGN_RING_TIMEOUT=45' \
  'Archive: no' > "${REQUEST}"
chmod 0600 "${REQUEST}"
process_request "${REQUEST}"
[[ ! -e "${REQUEST}" ]]
[[ -f "${OUTGOING_ROOT}/$(basename -- "${REQUEST}")" ]]

UNSAFE="${OUTBOX_ROOT}/nbvoice-campaign-${ATTEMPT_ID}.call"
printf '%s\n' \
  'Channel: Local/s@nbvoice-campaign-originate/n' \
  'Callerid: +27101234567' \
  'MaxRetries: 0' \
  'RetryTime: 60' \
  'WaitTime: 45' \
  'Context: system-shell' \
  'Extension: 600' \
  'Priority: 1' \
  "Setvar: __NBVOICE_CAMPAIGN_ATTEMPT_ID=${ATTEMPT_ID}" \
  'Setvar: __NBVOICE_CAMPAIGN_DESTINATION=27821234567' \
  'Setvar: __NBVOICE_CAMPAIGN_TRUNK=nbvt-0123456789abcdef0123456789abcdef' \
  'Setvar: __NBVOICE_CAMPAIGN_CALLER_ID=+27101234567' \
  'Setvar: __NBVOICE_CAMPAIGN_RING_TIMEOUT=45' \
  'Archive: no' > "${UNSAFE}"
chmod 0600 "${UNSAFE}"
if (validate_request "${UNSAFE}") >/dev/null 2>&1; then
  printf 'unsafe campaign context was accepted\n' >&2
  exit 1
fi

printf 'Asterisk campaign submit helper tests passed\n'
