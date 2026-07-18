BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'retail';

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_account_type_valid;
ALTER TABLE customers
  ADD CONSTRAINT customers_account_type_valid
  CHECK (account_type IN ('retail', 'wholesale'));

UPDATE modules
SET version = '0.24.0',
    status = 'active',
    description = 'Customer-perspective rate labels with explicit retail and wholesale account classification.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('029_customer_account_types')
ON CONFLICT (version) DO NOTHING;

COMMIT;
