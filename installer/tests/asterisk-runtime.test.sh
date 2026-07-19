#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/asterisk-runtime.sh
source "${SCRIPT_DIR}/../lib/asterisk-runtime.sh"

asterisk() {
  printf '%s\n' 'cdr_pgsql.so PostgreSQL CDR Backend 0 Not Running extended'
}

if asterisk_module_is_running cdr_pgsql.so; then
  printf '%s\n' 'a non-running Asterisk module was accepted' >&2
  exit 1
fi

asterisk() {
  printf '%s\n' 'cdr_pgsql.so PostgreSQL CDR Backend 0 Running extended'
}

asterisk_module_is_running cdr_pgsql.so
wait_for_asterisk_module cdr_pgsql.so 1

if asterisk_module_is_running 'cdr_pgsql.so;unsafe'; then
  printf '%s\n' 'unsafe Asterisk module name was accepted' >&2
  exit 1
fi

printf '%s\n' 'Asterisk runtime readiness tests passed'
