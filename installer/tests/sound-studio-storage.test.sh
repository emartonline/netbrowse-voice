#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/../install.sh"
SERVICE="${SCRIPT_DIR}/../templates/nbvoice-api.service"
AI_ENGINE_MIGRATION="${SCRIPT_DIR}/../../database/migrations/012_ai_receptionist_engines.sql"

bash -n "${INSTALLER}"

grep -Fq 'npm run typecheck' "${INSTALLER}"
typecheck_line="$(grep -n -m1 'npm run typecheck' "${INSTALLER}" | cut -d: -f1)"
build_line="$(grep -n -m1 'npm run build' "${INSTALLER}" | cut -d: -f1)"
(( typecheck_line < build_line ))

grep -Fq 'database/migrations/007_sound_studio.sql' "${INSTALLER}"
grep -Fq 'database/migrations/008_sound_studio_providers.sql' "${INSTALLER}"
grep -Fq 'database/migrations/009_ivr_builder.sql' "${INSTALLER}"
grep -Fq 'database/migrations/010_did_ivr_destinations.sql' "${INSTALLER}"
grep -Fq 'database/migrations/011_ai_receptionist.sql' "${INSTALLER}"
grep -Fq 'database/migrations/012_ai_receptionist_engines.sql' "${INSTALLER}"
grep -Fq 'DROP CONSTRAINT IF EXISTS ai_receptionists_external_agent_valid' \
  "${AI_ENGINE_MIGRATION}"
grep -Fq 'chmod 0755 /opt/netbrowse-voice "${APP_ROOT}" "${APP_ROOT}/apps" "${APP_ROOT}/apps/web"' "${INSTALLER}"
grep -Fq 'install -d -m 2770 -o asterisk -g asterisk "${SOUND_ROOT}"' "${INSTALLER}"
grep -Fq 'nbvai-disclosure-local.wav' "${INSTALLER}"
grep -Fq 'nbvai-unavailable-local.wav' "${INSTALLER}"
grep -Fq 'espeak-ng' "${INSTALLER}"
grep -Fq 'NBVOICE_SOUND_DIR=' "${INSTALLER}"
grep -Fq '@NBVOICE_SOUND_DIR@' "${SERVICE}"
grep -Fq 'SupplementaryGroups=asterisk' "${SERVICE}"

printf 'Sound Studio storage permission tests passed\n'
