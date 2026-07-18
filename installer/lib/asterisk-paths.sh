#!/usr/bin/env bash

discover_asterisk_data_dir() {
  local config_path="$1"
  local shared_root="${2:-/usr/share/asterisk}"
  local variable_root="${3:-/var/lib/asterisk}"
  local configured

  configured="$(
    awk '
      /^[[:space:]]*astdatadir[[:space:]]*=>/ {
        value = $0
        sub(/^[^>]*>[[:space:]]*/, "", value)
        sub(/[[:space:]]*[;#].*$/, "", value)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (value != "") print value
      }
    ' "${config_path}" | tail -n 1
  )"
  if [[ -n "${configured}" ]]; then
    printf '%s\n' "${configured}"
  elif [[ -d "${shared_root}/sounds" ]]; then
    printf '%s\n' "${shared_root}"
  else
    printf '%s\n' "${variable_root}"
  fi
}

valid_asterisk_data_dir() {
  local value="$1"
  [[ "${value}" == /* && "${value}" != *".."* && \
     "${value}" =~ ^/[A-Za-z0-9._/-]+$ ]]
}
