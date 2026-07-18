BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS parent_customer_id uuid
    REFERENCES customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by_customer_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_not_own_parent;
ALTER TABLE customers
  ADD CONSTRAINT customers_not_own_parent
  CHECK (parent_customer_id IS NULL OR parent_customer_id <> id);

CREATE INDEX IF NOT EXISTS customers_parent_idx
  ON customers(parent_customer_id, active, name)
  WHERE parent_customer_id IS NOT NULL;

ALTER TABLE customer_service_plans
  ADD COLUMN IF NOT EXISTS owner_customer_id uuid
    REFERENCES customers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS customer_service_plans_owner_idx
  ON customer_service_plans(owner_customer_id, enabled, name)
  WHERE owner_customer_id IS NOT NULL;

UPDATE modules
SET version = '0.28.0',
    status = 'active',
    description = 'Wholesale reseller client accounts, delegated service plans, isolated portal logins and bounded extension sub-ranges.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

UPDATE modules
SET version = '0.28.0', updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('033_reseller_clients')
ON CONFLICT (version) DO NOTHING;

COMMIT;
