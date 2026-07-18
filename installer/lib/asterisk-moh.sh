#!/usr/bin/env bash

configure_asterisk_moh_directory() {
  local moh_config="$1"
  local moh_directory="$2"
  local temporary_config

  [[ -f "${moh_config}" && ! -L "${moh_config}" ]] || {
    printf 'Asterisk music-on-hold configuration is missing or unsafe: %s\n' "${moh_config}" >&2
    return 1
  }
  [[ "${moh_directory}" == /* && -d "${moh_directory}" ]] || {
    printf 'Asterisk music-on-hold directory is missing: %s\n' "${moh_directory}" >&2
    return 1
  }

  temporary_config="$(mktemp "${moh_config}.nbvoice.XXXXXX")"
  if ! awk -v directory="${moh_directory}" '
    function write_directory() {
      print "directory=" directory
      updated = 1
    }

    {
      lowered = tolower($0)
      if (lowered ~ /^[[:space:]]*\[[^]]+\][[:space:]]*$/) {
        if (in_default && !updated) write_directory()
        in_default = (lowered ~ /^[[:space:]]*\[default\][[:space:]]*$/)
        if (in_default) found_default = 1
      }
      if (in_default && lowered ~ /^[[:space:]]*directory[[:space:]]*=/) {
        if (!updated) write_directory()
        next
      }
      print
    }

    END {
      if (in_default && !updated) write_directory()
      if (!found_default) {
        print ""
        print "[default]"
        write_directory()
        print "mode=files"
      }
    }
  ' "${moh_config}" > "${temporary_config}"; then
    rm -f -- "${temporary_config}"
    return 1
  fi

  chown --reference="${moh_config}" "${temporary_config}"
  chmod --reference="${moh_config}" "${temporary_config}"
  mv -f -- "${temporary_config}" "${moh_config}"
}
