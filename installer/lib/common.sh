#!/usr/bin/env bash

log() {
  printf '[Netbrowse Voice] %s\n' "$*"
}

warn() {
  printf '[Netbrowse Voice] WARNING: %s\n' "$*" >&2
}

fail() {
  printf '[Netbrowse Voice] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Run this installer with sudo."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

random_hex() {
  openssl rand -hex "${1:-24}"
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local count=1
  while (( count <= attempts )); do
    if curl --fail --silent --max-time 2 "$url" >/dev/null; then
      return 0
    fi
    sleep 1
    ((count += 1))
  done
  return 1
}

service_state() {
  if systemctl is-active --quiet "$1"; then
    printf 'online'
  else
    printf 'offline'
  fi
}
