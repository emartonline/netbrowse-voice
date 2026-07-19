#!/usr/bin/env bash

asterisk_module_is_running() {
  local module="$1"

  [[ "${module}" =~ ^[A-Za-z0-9_.-]+\.so$ ]] || return 1

  asterisk -rx "module show like ${module}" 2>/dev/null |
    awk -v module="${module}" '
      $1 == module &&
        $0 ~ /[[:space:]]Running[[:space:]]/ &&
        index($0, "Not Running") == 0 {
          found = 1
      }
      END { exit(found ? 0 : 1) }
    '
}

wait_for_asterisk_module() {
  local module="$1"
  local attempts="${2:-15}"
  local attempt

  [[ "${attempts}" =~ ^[1-9][0-9]?$ ]] || return 1

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if asterisk_module_is_running "${module}"; then
      return 0
    fi

    if (( attempt < attempts )); then
      sleep 1
    fi
  done

  return 1
}
