#!/usr/bin/env bash

configure_asterisk_voicemail_modules() {
  local modules_config="$1"
  local temporary_config

  [[ -f "${modules_config}" && ! -L "${modules_config}" ]] || {
    printf 'Asterisk modules configuration is missing or unsafe: %s\n' "${modules_config}" >&2
    return 1
  }

  temporary_config="$(mktemp "${modules_config}.nbvoice.XXXXXX")"
  if ! awk '
    function write_managed_block() {
      print "; BEGIN Netbrowse Voice voicemail backend"
      print "noload => app_voicemail_odbc.so"
      print "noload => app_voicemail_imap.so"
      print "load => app_voicemail.so"
      print "; END Netbrowse Voice voicemail backend"
      inserted = 1
    }

    {
      lowered = tolower($0)

      if (lowered == "; begin netbrowse voice voicemail backend" ||
          lowered == "; end netbrowse voice voicemail backend") {
        next
      }

      if (lowered ~ /^[[:space:]]*(load|noload)[[:space:]]*=>?[[:space:]]*app_voicemail(_odbc|_imap)?\.so([[:space:]]*[;#].*)?[[:space:]]*$/) {
        next
      }

      if (lowered ~ /^[[:space:]]*\[[^]]+\][[:space:]]*$/) {
        if (in_modules && !inserted) {
          write_managed_block()
        }
        in_modules = (lowered ~ /^[[:space:]]*\[modules\][[:space:]]*$/)
        if (in_modules) {
          found_modules = 1
        }
      }

      print
    }

    END {
      if (!inserted) {
        if (!found_modules) {
          print ""
          print "[modules]"
        }
        write_managed_block()
      }
    }
  ' "${modules_config}" > "${temporary_config}"; then
    rm -f -- "${temporary_config}"
    return 1
  fi

  chown --reference="${modules_config}" "${temporary_config}"
  chmod --reference="${modules_config}" "${temporary_config}"
  mv -f -- "${temporary_config}" "${modules_config}"
}
