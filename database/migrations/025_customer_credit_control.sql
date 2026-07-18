BEGIN;

ALTER TABLE customer_wallet_transactions
  ADD COLUMN IF NOT EXISTS billing_call_charge_id bigint
    REFERENCES billing_call_charges(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_transactions_charge_unique
  ON customer_wallet_transactions(billing_call_charge_id)
  WHERE billing_call_charge_id IS NOT NULL;

ALTER TABLE customer_wallet_transactions
  DROP CONSTRAINT IF EXISTS customer_wallet_transactions_amount_valid;

ALTER TABLE customer_wallet_transactions
  ADD CONSTRAINT customer_wallet_transactions_amount_valid
  CHECK (amount <> 0 AND amount BETWEEN -100000000 AND 100000000);

UPDATE modules
SET version = '0.21.0',
    status = 'active',
    description = 'Tenant-isolated customer portals with automatic rated-call wallet charging and real-time prepaid/postpaid outbound credit control.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

UPDATE modules
SET version = '0.21.0',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('025_customer_credit_control')
ON CONFLICT (version) DO NOTHING;

COMMIT;
