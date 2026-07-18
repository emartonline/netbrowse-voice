#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SCRIPT_DIR}/../.."
INSTALLER="${ROOT}/installer/install.sh"
MIGRATION="${ROOT}/database/migrations/035_did_marketplace.sql"

grep -Fq 'database/migrations/035_did_marketplace.sql' "${INSTALLER}"
grep -Fq 'CREATE TABLE IF NOT EXISTS did_inventory' "${MIGRATION}"
grep -Fq 'CREATE TABLE IF NOT EXISTS did_purchases' "${MIGRATION}"
grep -Fq 'did_purchases_current_inventory_unique' "${MIGRATION}"
grep -Fq "status IN ('active', 'past_due')" "${MIGRATION}"
grep -Fq 'REFERENCES customer_wallet_transactions(id)' "${MIGRATION}"

printf 'DID marketplace installer tests passed\n'
