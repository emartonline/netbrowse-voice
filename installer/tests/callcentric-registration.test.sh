#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="${ROOT}/installer/install.sh"
APPLY="${ROOT}/installer/templates/nbvoice-asterisk-apply"
MIGRATION="${ROOT}/database/migrations/039_trunk_registration_contact_user.sql"

bash -n "${INSTALLER}"
grep -Fq 'database/migrations/038_ai_queue_handoff_and_turns.sql' "${INSTALLER}"
grep -Fq 'database/migrations/039_trunk_registration_contact_user.sql' "${INSTALLER}"
grep -Fq 'ADD COLUMN IF NOT EXISTS registration_contact_user text' "${MIGRATION}"
grep -Fq "lower(provider_host) IN ('sip.callcentric.net', 'callcentric.com')" "${MIGRATION}"
grep -Fq 'contact_user=' "${APPLY}"
