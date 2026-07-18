#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SCRIPT_DIR}/../.."
INSTALLER="${ROOT}/installer/install.sh"
MIGRATION="${ROOT}/database/migrations/036_paypal_wallet_topups.sql"
GUI_MIGRATION="${ROOT}/database/migrations/037_paypal_gui_settings.sql"

bash -n "${INSTALLER}"
grep -Fq 'database/migrations/036_paypal_wallet_topups.sql' "${INSTALLER}"
grep -Fq 'database/migrations/037_paypal_gui_settings.sql' "${INSTALLER}"
grep -Fq 'NBVOICE_PAYPAL_MODE=sandbox' "${INSTALLER}"
grep -Fq 'NBVOICE_PAYPAL_CLIENT_SECRET=' "${INSTALLER}"
grep -Fq 'CREATE TABLE IF NOT EXISTS paypal_wallet_orders' "${MIGRATION}"
grep -Fq 'provider_order_id text NOT NULL UNIQUE' "${MIGRATION}"
grep -Fq 'wallet_transaction_id bigint UNIQUE' "${MIGRATION}"
grep -Fq "VALUES ('037_paypal_gui_settings')" "${GUI_MIGRATION}"
grep -Fq 'owner-configured PayPal Sandbox' "${GUI_MIGRATION}"

printf 'PayPal wallet installer tests passed\n'
