#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/../install.sh"

grep -Fqx 'NPM_CONFIG_CACHE="${CACHE_ROOT}/npm" npm ci --no-audit --no-fund' "${INSTALLER}"
grep -Fqx "node --input-type=module -e \"import('fastify')\" >/dev/null" "${INSTALLER}"
! grep -Fq 'npm prune --omit=dev' "${INSTALLER}"

printf '%s\n' 'Runtime dependency installer checks passed'
