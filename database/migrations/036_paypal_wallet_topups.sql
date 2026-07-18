BEGIN;

CREATE TABLE IF NOT EXISTS paypal_wallet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  initiated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_order_id text NOT NULL UNIQUE,
  capture_request_id uuid NOT NULL UNIQUE,
  payment_capture_id text UNIQUE,
  wallet_transaction_id bigint UNIQUE
    REFERENCES customer_wallet_transactions(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL,
  amount numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'created',
  failure_reason text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paypal_wallet_orders_provider_id_valid
    CHECK (provider_order_id ~ '^[A-Za-z0-9]{1,36}$'),
  CONSTRAINT paypal_wallet_orders_capture_id_valid
    CHECK (payment_capture_id IS NULL OR payment_capture_id ~ '^[A-Za-z0-9]{1,128}$'),
  CONSTRAINT paypal_wallet_orders_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT paypal_wallet_orders_amount_valid CHECK (amount > 0 AND amount <= 1000000),
  CONSTRAINT paypal_wallet_orders_status_valid
    CHECK (status IN ('created', 'capturing', 'captured', 'failed', 'cancelled')),
  CONSTRAINT paypal_wallet_orders_failure_valid
    CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 2 AND 200),
  CONSTRAINT paypal_wallet_orders_capture_state_valid
    CHECK (
      (status = 'captured' AND payment_capture_id IS NOT NULL
        AND wallet_transaction_id IS NOT NULL AND captured_at IS NOT NULL)
      OR
      (status <> 'captured' AND payment_capture_id IS NULL
        AND wallet_transaction_id IS NULL AND captured_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS paypal_wallet_orders_customer_idx
  ON paypal_wallet_orders(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paypal_wallet_orders_recovery_idx
  ON paypal_wallet_orders(status, updated_at)
  WHERE status IN ('created', 'capturing', 'failed');

UPDATE modules
SET version = '0.31.0',
    status = 'active',
    description = 'Tenant-isolated customer billing, wallet ledgers, invoices, DID purchases and PayPal wallet top-ups with captured-payment verification.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('036_paypal_wallet_topups')
ON CONFLICT (version) DO NOTHING;

COMMIT;
