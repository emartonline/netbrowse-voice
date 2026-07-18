#!/usr/bin/env bash

configure_asterisk_cdr_general() {
  local target="$1"
  local temporary
  [[ -f "${target}" && ! -L "${target}" ]] || {
    printf 'Netbrowse Voice CDR: configuration is missing or unsafe: %s\n' "${target}" >&2
    return 1
  }
  temporary="$(mktemp)"

  awk '
    BEGIN { in_general = 0; found_general = 0 }
    /^[[:space:]]*\[[Gg][Ee][Nn][Ee][Rr][Aa][Ll]\][[:space:]]*$/ {
      print
      print "; BEGIN Netbrowse Voice managed CDR settings"
      print "enable=yes"
      print "unanswered=yes"
      print "congestion=yes"
      print "safeshutdown=yes"
      print "; END Netbrowse Voice managed CDR settings"
      in_general = 1
      found_general = 1
      next
    }
    in_general && /^[[:space:]]*\[/ { in_general = 0 }
    in_general && /^[[:space:]]*(enable|unanswered|congestion|safeshutdown)[[:space:]]*=/ { next }
    /^[[:space:]]*; BEGIN Netbrowse Voice managed CDR settings[[:space:]]*$/ { next }
    /^[[:space:]]*; END Netbrowse Voice managed CDR settings[[:space:]]*$/ { next }
    { print }
    END {
      if (!found_general) {
        print ""
        print "[general]"
        print "; BEGIN Netbrowse Voice managed CDR settings"
        print "enable=yes"
        print "unanswered=yes"
        print "congestion=yes"
        print "safeshutdown=yes"
        print "; END Netbrowse Voice managed CDR settings"
      }
    }
  ' "${target}" > "${temporary}"

  install -m 0640 -o root -g asterisk "${temporary}" "${target}"
  rm -f "${temporary}"
}

write_asterisk_pgsql_cdr() {
  local target="$1"
  local password="$2"
  local temporary
  temporary="$(mktemp)"

  if [[ -e "${target}" && ( ! -f "${target}" || -L "${target}" ) ]]; then
    printf 'Netbrowse Voice CDR: configuration path is unsafe: %s\n' "${target}" >&2
    rm -f "${temporary}"
    return 1
  fi

  if [[ ! "${password}" =~ ^[A-Za-z0-9._~-]{24,160}$ ]]; then
    printf 'Netbrowse Voice CDR: database password contains unsupported characters\n' >&2
    rm -f "${temporary}"
    return 1
  fi

  {
    printf '; Managed by Netbrowse Voice. Manual changes will be replaced.\n'
    printf '[global]\n'
    printf 'hostname=127.0.0.1\n'
    printf 'port=5432\n'
    printf 'dbname=netbrowse_voice\n'
    printf 'user=nbvoice\n'
    printf 'password=%s\n' "${password}"
    printf 'table=call_detail_records\n'
  } > "${temporary}"

  install -m 0640 -o root -g asterisk "${temporary}" "${target}"
  rm -f "${temporary}"
}
