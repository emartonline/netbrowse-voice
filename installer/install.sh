#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="/var/log/netbrowse-voice-install.log"
APP_ROOT="/opt/netbrowse-voice/app"
CONFIG_ROOT="/etc/netbrowse-voice"
ENV_FILE="${CONFIG_ROOT}/netbrowse-voice.env"
STATE_ROOT="/var/lib/netbrowse-voice"
CACHE_ROOT="/var/cache/netbrowse-voice"
VERSION="0.32.2"

apply_application_permissions() {
  chown -R root:nbvoice /opt/netbrowse-voice
  chmod -R u=rwX,g=rX,o= /opt/netbrowse-voice
  chmod 0755 /opt/netbrowse-voice "${APP_ROOT}" "${APP_ROOT}/apps" "${APP_ROOT}/apps/web"
  if [[ -d "${APP_ROOT}/apps/web/dist" ]]; then
    find "${APP_ROOT}/apps/web/dist" -type d -exec chmod 0755 {} +
    find "${APP_ROOT}/apps/web/dist" -type f -exec chmod 0644 {} +
  fi
}

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/asterisk-modules.sh
source "${SCRIPT_DIR}/lib/asterisk-modules.sh"
# shellcheck source=lib/asterisk-cdr.sh
source "${SCRIPT_DIR}/lib/asterisk-cdr.sh"
# shellcheck source=lib/asterisk-paths.sh
source "${SCRIPT_DIR}/lib/asterisk-paths.sh"
# shellcheck source=lib/asterisk-moh.sh
source "${SCRIPT_DIR}/lib/asterisk-moh.sh"

require_root
touch "${LOG_FILE}"
chmod 0600 "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1
trap 'warn "Installation stopped on line ${LINENO}. Review ${LOG_FILE}."' ERR

log "Starting Netbrowse Voice ${VERSION} installation"

[[ -f "${PROJECT_ROOT}/package.json" ]] || fail "Run the installer from an extracted Netbrowse Voice release."
[[ -r /etc/os-release ]] || fail "Cannot identify this operating system."
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID}" == "ubuntu" ]] || fail "This release supports Ubuntu Server only."
[[ "${VERSION_ID}" == "26.04" ]] || \
  fail "This development release is validated on Ubuntu 26.04 only; found ${VERSION_ID}."
case "$(dpkg --print-architecture)" in
  amd64) ;;
  *) fail "This development release currently supports x86-64/amd64 only." ;;
esac

export DEBIAN_FRONTEND=noninteractive
log "Installing operating-system dependencies"
apt-get update
apt-get install -y --no-install-recommends \
  asterisk \
  asterisk-core-sounds-en-wav \
  asterisk-moh-opsound-wav \
  asterisk-modules \
  build-essential \
  ca-certificates \
  curl \
  espeak-ng \
  ffmpeg \
  git \
  jq \
  nginx \
  nodejs \
  npm \
  openssl \
  postgresql \
  postgresql-client \
  redis-server \
  rsync \
  sox \
  sudo

require_command node
require_command npm
require_command psql
require_command openssl

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
(( NODE_MAJOR >= 22 )) || fail "Node.js 22 or later is required; Ubuntu installed $(node --version)."

if [[ -z "$(swapon --show --noheadings 2>/dev/null)" ]]; then
  log "Creating a 4 GB swap file"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 4G /swapfile
    chmod 0600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi

log "Creating the service account and application directories"
if ! id nbvoice >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "${STATE_ROOT}" --shell /usr/sbin/nologin nbvoice
fi
if getent group asterisk >/dev/null 2>&1; then
  usermod -a -G asterisk nbvoice
fi
install -d -m 0750 -o root -g nbvoice "${CONFIG_ROOT}"
# Asterisk owns recording files but is not the owner of STATE_ROOT.  Keep the
# state directory unlistable to other users while allowing service processes
# to traverse it to their explicitly permitted subdirectories.
install -d -m 0751 -o nbvoice -g nbvoice "${STATE_ROOT}"
install -d -m 0750 -o nbvoice -g nbvoice \
  "${STATE_ROOT}/asterisk-staging" /var/log/netbrowse-voice
install -d -m 0770 -o nbvoice -g nbvoice "${STATE_ROOT}/redirect-requests"
install -d -m 0770 -o asterisk -g asterisk "${STATE_ROOT}/ai-runtime"
install -d -m 0700 -o root -g root "${STATE_ROOT}/config-backups"
install -d -m 0755 -o root -g root /opt/netbrowse-voice "${CACHE_ROOT}/npm"
install -d -m 0755 -o root -g nbvoice "${APP_ROOT}"

log "Selecting the file-based Asterisk voicemail backend"
[[ -f /etc/asterisk/modules.conf ]] || fail "Asterisk modules configuration is missing."
if [[ ! -f "${STATE_ROOT}/config-backups/modules.conf.before-netbrowse-voice" ]]; then
  install -m 0600 -o root -g root /etc/asterisk/modules.conf \
    "${STATE_ROOT}/config-backups/modules.conf.before-netbrowse-voice"
fi
configure_asterisk_voicemail_modules /etc/asterisk/modules.conf

log "Copying application source"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.npm-cache/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  "${PROJECT_ROOT}/" "${APP_ROOT}/"
apply_application_permissions

systemctl enable --now postgresql redis-server asterisk nginx

ASTERISK_DATA_DIR="$(discover_asterisk_data_dir /etc/asterisk/asterisk.conf)"
valid_asterisk_data_dir "${ASTERISK_DATA_DIR}" || \
  fail "Asterisk data directory is unsafe: ${ASTERISK_DATA_DIR}"
DISCOVERED_SOUND_ROOT="${ASTERISK_DATA_DIR%/}/sounds/netbrowse"

if [[ -f "${ENV_FILE}" ]]; then
  log "Reusing the existing installation credentials"
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  DB_PASSWORD="${NBVOICE_DB_PASSWORD:?Existing environment is missing NBVOICE_DB_PASSWORD}"
  if [[ -z "${NBVOICE_DATA_KEY:-}" ]]; then
    log "Adding the encrypted PBX credential key"
    NBVOICE_DATA_KEY="$(random_hex 32)"
    printf 'NBVOICE_DATA_KEY=%s\n' "${NBVOICE_DATA_KEY}" >> "${ENV_FILE}"
  fi
  SOUND_ROOT="${NBVOICE_SOUND_DIR:-${DISCOVERED_SOUND_ROOT}}"
  if [[ -z "${NBVOICE_SOUND_DIR:-}" ]]; then
    printf 'NBVOICE_SOUND_DIR=%s\n' "${SOUND_ROOT}" >> "${ENV_FILE}"
  fi
else
  DB_PASSWORD="$(random_hex 24)"
  INSTALL_SECRET="$(random_hex 32)"
  log "Generating installation credentials"
  {
    printf 'NODE_ENV=production\n'
    printf 'HOST=127.0.0.1\n'
    printf 'PORT=3100\n'
    printf 'DATABASE_URL=postgresql://nbvoice:%s@127.0.0.1:5432/netbrowse_voice\n' "${DB_PASSWORD}"
    printf 'NBVOICE_DB_PASSWORD=%s\n' "${DB_PASSWORD}"
    printf 'REDIS_URL=redis://127.0.0.1:6379\n'
    printf 'COOKIE_SECURE=false\n'
    printf 'SESSION_HOURS=12\n'
    printf 'NBVOICE_INSTALL_SECRET=%s\n' "${INSTALL_SECRET}"
    printf 'NBVOICE_DATA_KEY=%s\n' "$(random_hex 32)"
    printf 'NBVOICE_SOUND_DIR=%s\n' "${DISCOVERED_SOUND_ROOT}"
    printf '\n# Optional headless fallback for PayPal wallet top-ups.\n'
    printf '# The owner can securely configure Sandbox credentials in Billing → PayPal Sandbox.\n'
    printf 'NBVOICE_PAYPAL_MODE=sandbox\n'
    printf 'NBVOICE_PAYPAL_CLIENT_ID=\n'
    printf 'NBVOICE_PAYPAL_CLIENT_SECRET=\n'
    printf 'NBVOICE_PAYPAL_MINIMUM_TOPUP=5\n'
    printf 'NBVOICE_PAYPAL_MAXIMUM_TOPUP=10000\n'
  } > "${ENV_FILE}"
  SOUND_ROOT="${DISCOVERED_SOUND_ROOT}"
  chown root:nbvoice "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
fi
if ! grep -q '^NBVOICE_PAYPAL_MODE=' "${ENV_FILE}"; then
  {
    printf '\n# Optional headless fallback for PayPal wallet top-ups.\n'
    printf '# The owner can securely configure Sandbox credentials in Billing → PayPal Sandbox.\n'
    printf 'NBVOICE_PAYPAL_MODE=sandbox\n'
    printf 'NBVOICE_PAYPAL_CLIENT_ID=\n'
    printf 'NBVOICE_PAYPAL_CLIENT_SECRET=\n'
    printf 'NBVOICE_PAYPAL_MINIMUM_TOPUP=5\n'
    printf 'NBVOICE_PAYPAL_MAXIMUM_TOPUP=10000\n'
  } >> "${ENV_FILE}"
fi
valid_asterisk_data_dir "${SOUND_ROOT}" || \
  fail "Netbrowse Voice sound directory is unsafe: ${SOUND_ROOT}"
chown root:nbvoice "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

log "Preparing PostgreSQL"
if [[ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='nbvoice'")" != "1" ]]; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE nbvoice LOGIN PASSWORD '${DB_PASSWORD}'"
else
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE nbvoice WITH LOGIN PASSWORD '${DB_PASSWORD}'"
fi
if [[ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='netbrowse_voice'")" != "1" ]]; then
  runuser -u postgres -- createdb --owner=nbvoice netbrowse_voice
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d netbrowse_voice \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"

log "Installing application dependencies and building the release"
cd "${APP_ROOT}"
NPM_CONFIG_CACHE="${CACHE_ROOT}/npm" npm ci --no-audit --no-fund
NPM_CONFIG_CACHE="${CACHE_ROOT}/npm" npm run typecheck
NPM_CONFIG_CACHE="${CACHE_ROOT}/npm" npm run build
NPM_CONFIG_CACHE="${CACHE_ROOT}/npm" npm prune --omit=dev --no-audit --no-fund
apply_application_permissions

log "Applying database migrations"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/001_core.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/002_pbx_extensions.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/003_extension_services.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/004_sip_trunks_dids.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/005_live_calls_cdr.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/006_call_recordings.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/007_sound_studio.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/008_sound_studio_providers.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/009_ivr_builder.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/010_did_ivr_destinations.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/011_ai_receptionist.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/012_ai_receptionist_engines.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/013_openai_realtime.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/014_natural_ai_disclosures.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/015_call_centre_core.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/016_agent_console.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/017_agent_workspace.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/018_campaigns_foundation.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/019_provider_interoperability.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/020_outbound_routes.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/021_campaign_dialer.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/022_billing_foundation.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/023_outbound_call_outcomes.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/024_customer_portal.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/025_customer_credit_control.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/026_customer_invoices.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/027_invoice_pdf_navigation.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/028_customer_rate_cards.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/029_customer_account_types.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/030_independent_customer_rate_cards.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/031_customer_service_plans.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/032_customer_recording_archive.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/033_reseller_clients.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/034_reseller_branding.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/035_did_marketplace.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/036_paypal_wallet_topups.sql"
PGPASSWORD="${DB_PASSWORD}" psql \
  "postgresql://nbvoice:${DB_PASSWORD}@127.0.0.1:5432/netbrowse_voice" \
  -v ON_ERROR_STOP=1 \
  -f "${APP_ROOT}/database/migrations/037_paypal_gui_settings.sql"

log "Preparing the controlled campaign call outbox"
install -d -m 0770 -o nbvoice -g nbvoice "${STATE_ROOT}/campaign-outbox"

log "Preparing secure call-recording storage"
install -d -m 0770 -o asterisk -g asterisk "${STATE_ROOT}/recordings"

log "Preparing the Asterisk sound library"
install -d -m 2770 -o asterisk -g asterisk "${SOUND_ROOT}"

log "Installing the provider-independent AI disclosure"
DISCLOSURE_SOURCE="$(mktemp /tmp/nbvoice-disclosure.XXXXXX.wav)"
DISCLOSURE_TARGET="$(mktemp "${SOUND_ROOT}/.nbvai-disclosure.XXXXXX.wav")"
espeak-ng -v en -s 145 -w "${DISCLOSURE_SOURCE}" \
  "You are speaking with an A I receptionist. Your voice will be processed to answer this call. You can ask for a person at any time."
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -i "${DISCLOSURE_SOURCE}" -ar 8000 -ac 1 -c:a pcm_s16le "${DISCLOSURE_TARGET}"
chown asterisk:asterisk "${DISCLOSURE_TARGET}"
chmod 0640 "${DISCLOSURE_TARGET}"
mv -Tf "${DISCLOSURE_TARGET}" "${SOUND_ROOT}/nbvai-disclosure-local.wav"
rm -f "${DISCLOSURE_SOURCE}"

log "Installing the local AI failure announcement"
UNAVAILABLE_SOURCE="$(mktemp /tmp/nbvoice-unavailable.XXXXXX.wav)"
UNAVAILABLE_TARGET="$(mktemp "${SOUND_ROOT}/.nbvai-unavailable.XXXXXX.wav")"
espeak-ng -v en -s 145 -w "${UNAVAILABLE_SOURCE}" \
  "The automated assistant is temporarily unavailable. Please try again later."
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -i "${UNAVAILABLE_SOURCE}" -ar 8000 -ac 1 -c:a pcm_s16le "${UNAVAILABLE_TARGET}"
chown asterisk:asterisk "${UNAVAILABLE_TARGET}"
chmod 0640 "${UNAVAILABLE_TARGET}"
mv -Tf "${UNAVAILABLE_TARGET}" "${SOUND_ROOT}/nbvai-unavailable-local.wav"
rm -f "${UNAVAILABLE_SOURCE}"

log "Installing the outbound credit-control announcement"
BILLING_BLOCKED_SOURCE="$(mktemp /tmp/nbvoice-billing-blocked.XXXXXX.wav)"
BILLING_BLOCKED_TARGET="$(mktemp "${SOUND_ROOT}/.nbvoice-billing-blocked.XXXXXX.wav")"
espeak-ng -v en -s 145 -w "${BILLING_BLOCKED_SOURCE}" \
  "This outbound call cannot be completed. Please contact your account administrator."
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -i "${BILLING_BLOCKED_SOURCE}" -ar 8000 -ac 1 -c:a pcm_s16le "${BILLING_BLOCKED_TARGET}"
chown asterisk:asterisk "${BILLING_BLOCKED_TARGET}"
chmod 0640 "${BILLING_BLOCKED_TARGET}"
mv -Tf "${BILLING_BLOCKED_TARGET}" "${SOUND_ROOT}/nbvoice-billing-blocked.wav"
rm -f "${BILLING_BLOCKED_SOURCE}"

log "Configuring durable PostgreSQL call records"
[[ -f /etc/asterisk/cdr.conf ]] || fail "Asterisk CDR configuration is missing."
if [[ ! -f "${STATE_ROOT}/config-backups/cdr.conf.before-netbrowse-voice" ]]; then
  install -m 0600 -o root -g root /etc/asterisk/cdr.conf \
    "${STATE_ROOT}/config-backups/cdr.conf.before-netbrowse-voice"
fi
if [[ -f /etc/asterisk/cdr_pgsql.conf ]] && \
   [[ ! -f "${STATE_ROOT}/config-backups/cdr_pgsql.conf.before-netbrowse-voice" ]]; then
  install -m 0600 -o root -g root /etc/asterisk/cdr_pgsql.conf \
    "${STATE_ROOT}/config-backups/cdr_pgsql.conf.before-netbrowse-voice"
fi
configure_asterisk_cdr_general /etc/asterisk/cdr.conf
write_asterisk_pgsql_cdr /etc/asterisk/cdr_pgsql.conf "${DB_PASSWORD}"

log "Configuring the default Asterisk hold-music library"
[[ -f /etc/asterisk/musiconhold.conf ]] || fail "Asterisk music-on-hold configuration is missing."
if [[ ! -f "${STATE_ROOT}/config-backups/musiconhold.conf.before-netbrowse-voice" ]]; then
  install -m 0600 -o root -g root /etc/asterisk/musiconhold.conf \
    "${STATE_ROOT}/config-backups/musiconhold.conf.before-netbrowse-voice"
fi
configure_asterisk_moh_directory /etc/asterisk/musiconhold.conf /usr/share/asterisk/moh

log "Installing services and the management command"
sed "s|@NBVOICE_SOUND_DIR@|${SOUND_ROOT}|g" \
  "${APP_ROOT}/installer/templates/nbvoice-api.service" \
  > /etc/systemd/system/nbvoice-api.service.new
install -m 0644 /etc/systemd/system/nbvoice-api.service.new /etc/systemd/system/nbvoice-api.service
rm -f /etc/systemd/system/nbvoice-api.service.new
install -m 0644 "${APP_ROOT}/installer/templates/nginx.conf" /etc/nginx/sites-available/netbrowse-voice
ln -sfn /etc/nginx/sites-available/netbrowse-voice /etc/nginx/sites-enabled/netbrowse-voice
rm -f /etc/nginx/sites-enabled/default
install -m 0755 "${APP_ROOT}/bin/nbvoice" /usr/local/sbin/nbvoice
install -d -m 0755 -o root -g root /usr/local/libexec
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-apply" \
  /usr/local/libexec/nbvoice-asterisk-apply
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-status" \
  /usr/local/libexec/nbvoice-asterisk-status
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-queues" \
  /usr/local/libexec/nbvoice-asterisk-queues
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-calls" \
  /usr/local/libexec/nbvoice-asterisk-calls
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-redirect" \
  /usr/local/libexec/nbvoice-asterisk-redirect
install -m 0755 -o root -g root \
  "${APP_ROOT}/installer/templates/nbvoice-asterisk-campaign-submit" \
  /usr/local/libexec/nbvoice-asterisk-campaign-submit
install -m 0440 -o root -g root \
  "${APP_ROOT}/installer/templates/netbrowse-voice-sudoers" \
  /etc/sudoers.d/netbrowse-voice
visudo -cf /etc/sudoers.d/netbrowse-voice >/dev/null

# Nginx can traverse and read only the compiled public dashboard. Application
# source remains group-restricted.
apply_application_permissions
nginx -t
systemctl daemon-reload
systemctl enable nbvoice-api
# The new API generates current PBX files from PostgreSQL during startup and
# invokes the strict apply helper. Never validate stale staging from an older
# release before the generator has had a chance to replace it.
systemctl restart asterisk
if ! asterisk -rx "core show application VoiceMail" >/dev/null 2>&1; then
  fail "Asterisk voicemail application did not load."
fi
if ! asterisk -rx "core show application VoiceMailMain" >/dev/null 2>&1; then
  fail "Asterisk voicemail mailbox application did not load."
fi
if ! asterisk -rx "core show application MixMonitor" >/dev/null 2>&1; then
  fail "Asterisk MixMonitor recording application did not load."
fi
if ! asterisk -rx "core show application StopMixMonitor" >/dev/null 2>&1; then
  fail "Asterisk StopMixMonitor application did not load."
fi
if ! asterisk -rx "core show application AudioSocket" >/dev/null 2>&1; then
  fail "Asterisk AudioSocket streaming application did not load."
fi
if ! asterisk -rx "core show application Queue" >/dev/null 2>&1; then
  fail "Asterisk Queue application did not load."
fi
if ! asterisk -rx "moh show classes" | grep -Eq '^[[:space:]]*Class:[[:space:]]+default([[:space:]]|$)'; then
  fail "Asterisk default music-on-hold class did not load."
fi
if ! asterisk -rx "core show function UUID" >/dev/null 2>&1; then
  fail "Asterisk UUID dialplan function did not load."
fi
if ! asterisk -rx "module show like cdr_pgsql.so" | grep -Eq '^[[:space:]]*cdr_pgsql\.so[[:space:]].*[[:space:]]Running([[:space:]]|$)'; then
  fail "Asterisk PostgreSQL CDR backend did not load."
fi
systemctl restart nbvoice-api nginx

if ! wait_for_http "http://127.0.0.1:3100/api/health/public" 40; then
  systemctl status nbvoice-api --no-pager || true
  journalctl -u nbvoice-api -n 80 --no-pager || true
  fail "Voice Core did not become healthy."
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"
log "Installation completed successfully"
printf '\nOpen Netbrowse Voice at: http://%s\n' "${SERVER_IP:-server-address}"
printf 'Create the first administrator in the browser.\n'
printf 'Check services at any time with: sudo nbvoice status\n\n'
