BEGIN;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number bigserial NOT NULL UNIQUE,
  name text NOT NULL,
  billing_email text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ZAR',
  billing_mode text NOT NULL DEFAULT 'prepaid',
  credit_limit numeric(18,6) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_name_valid CHECK (char_length(name) BETWEEN 2 AND 120),
  CONSTRAINT customers_email_normalized CHECK (billing_email = lower(billing_email)),
  CONSTRAINT customers_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT customers_billing_mode_valid CHECK (billing_mode IN ('prepaid', 'postpaid')),
  CONSTRAINT customers_credit_limit_valid CHECK (credit_limit BETWEEN 0 AND 100000000)
);

CREATE INDEX IF NOT EXISTS customers_active_name_idx ON customers(active, name);

CREATE TABLE IF NOT EXISTS customer_wallets (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE RESTRICT,
  balance numeric(18,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_wallets_balance_valid CHECK (balance BETWEEN -100000000 AND 100000000)
);

CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL,
  currency char(3) NOT NULL,
  amount numeric(18,6) NOT NULL,
  balance_after numeric(18,6) NOT NULL,
  note text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_wallet_transactions_type_valid
    CHECK (transaction_type IN ('topup', 'adjustment', 'charge', 'refund')),
  CONSTRAINT customer_wallet_transactions_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT customer_wallet_transactions_amount_valid
    CHECK (amount <> 0 AND amount BETWEEN -1000000 AND 1000000),
  CONSTRAINT customer_wallet_transactions_balance_valid
    CHECK (balance_after BETWEEN -100000000 AND 100000000),
  CONSTRAINT customer_wallet_transactions_note_valid
    CHECK (char_length(note) BETWEEN 2 AND 200)
);

CREATE INDEX IF NOT EXISTS customer_wallet_transactions_customer_idx
  ON customer_wallet_transactions(customer_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_customer_wallet_transaction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer wallet transactions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS customer_wallet_transactions_immutable
  ON customer_wallet_transactions;
CREATE TRIGGER customer_wallet_transactions_immutable
BEFORE UPDATE OR DELETE ON customer_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_customer_wallet_transaction_mutation();

CREATE TABLE IF NOT EXISTS customer_extensions (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  extension_id uuid NOT NULL UNIQUE REFERENCES extensions(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, extension_id)
);

CREATE INDEX IF NOT EXISTS customer_extensions_customer_idx
  ON customer_extensions(customer_id, extension_id);

CREATE TABLE IF NOT EXISTS customer_did_routes (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  did_route_id uuid NOT NULL UNIQUE REFERENCES did_routes(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, did_route_id)
);

CREATE INDEX IF NOT EXISTS customer_did_routes_customer_idx
  ON customer_did_routes(customer_id, did_route_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT;

ALTER TABLE billing_call_charges
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_customer_role_idx
  ON users(customer_id, role, active)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_call_charges_customer_idx
  ON billing_call_charges(customer_id, call_started_at DESC)
  WHERE customer_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users
  ADD CONSTRAINT users_role_valid
  CHECK (role IN ('owner', 'administrator', 'agent', 'customer_admin'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_assignment_valid;
ALTER TABLE users
  ADD CONSTRAINT users_customer_assignment_valid
  CHECK (
    (role = 'customer_admin' AND customer_id IS NOT NULL)
    OR (role <> 'customer_admin' AND customer_id IS NULL)
  );

UPDATE modules
SET version = '0.20.0',
    status = 'active',
    description = 'Tenant-isolated customer accounts, portal login, service assignments, wallets, rated usage and immutable transaction ledgers.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('024_customer_portal')
ON CONFLICT (version) DO NOTHING;

COMMIT;
