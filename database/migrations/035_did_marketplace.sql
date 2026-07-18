BEGIN;

CREATE TABLE IF NOT EXISTS did_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  did_number text NOT NULL UNIQUE,
  trunk_id uuid NOT NULL REFERENCES sip_trunks(id) ON DELETE RESTRICT,
  country_code char(2) NOT NULL,
  region text NOT NULL DEFAULT '',
  locality text NOT NULL DEFAULT '',
  currency char(3) NOT NULL,
  setup_price numeric(18,6) NOT NULL DEFAULT 0,
  monthly_price numeric(18,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available',
  customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
  did_route_id uuid UNIQUE REFERENCES did_routes(id) ON DELETE RESTRICT,
  listed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT did_inventory_number_valid
    CHECK (did_number ~ '^\+?[0-9]{3,20}$'),
  CONSTRAINT did_inventory_country_valid
    CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT did_inventory_region_valid
    CHECK (char_length(region) <= 100),
  CONSTRAINT did_inventory_locality_valid
    CHECK (char_length(locality) <= 100),
  CONSTRAINT did_inventory_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT did_inventory_prices_valid
    CHECK (
      setup_price BETWEEN 0 AND 1000000
      AND monthly_price BETWEEN 0 AND 1000000
      AND setup_price + monthly_price <= 1000000
    ),
  CONSTRAINT did_inventory_status_valid
    CHECK (status IN ('available', 'disabled', 'assigned')),
  CONSTRAINT did_inventory_assignment_valid
    CHECK (
      (status = 'assigned' AND customer_id IS NOT NULL
        AND did_route_id IS NOT NULL AND assigned_at IS NOT NULL)
      OR
      (status <> 'assigned' AND customer_id IS NULL
        AND did_route_id IS NULL AND assigned_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS did_inventory_catalog_idx
  ON did_inventory(currency, country_code, did_number)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS did_inventory_customer_idx
  ON did_inventory(customer_id, did_number)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS did_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES did_inventory(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  did_route_id uuid REFERENCES did_routes(id) ON DELETE SET NULL,
  currency char(3) NOT NULL,
  billing_mode text NOT NULL,
  setup_amount numeric(18,6) NOT NULL,
  monthly_amount numeric(18,6) NOT NULL,
  initial_total numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'active',
  next_renewal_at timestamptz NOT NULL,
  failure_reason text,
  purchased_by uuid REFERENCES users(id) ON DELETE SET NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT did_purchases_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT did_purchases_mode_valid CHECK (billing_mode IN ('prepaid', 'postpaid')),
  CONSTRAINT did_purchases_amounts_valid CHECK (
    setup_amount BETWEEN 0 AND 1000000
    AND monthly_amount BETWEEN 0 AND 1000000
    AND initial_total = setup_amount + monthly_amount
    AND initial_total <= 1000000
  ),
  CONSTRAINT did_purchases_status_valid
    CHECK (status IN ('active', 'past_due', 'failed', 'cancelled')),
  CONSTRAINT did_purchases_failure_valid
    CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 2 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS did_purchases_current_inventory_unique
  ON did_purchases(inventory_id)
  WHERE status IN ('active', 'past_due');

CREATE INDEX IF NOT EXISTS did_purchases_customer_idx
  ON did_purchases(customer_id, purchased_at DESC);

CREATE INDEX IF NOT EXISTS did_purchases_renewal_idx
  ON did_purchases(next_renewal_at)
  WHERE status IN ('active', 'past_due');

CREATE TABLE IF NOT EXISTS did_purchase_charges (
  id bigserial PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES did_purchases(id) ON DELETE RESTRICT,
  wallet_transaction_id bigint UNIQUE
    REFERENCES customer_wallet_transactions(id) ON DELETE RESTRICT,
  charge_type text NOT NULL,
  currency char(3) NOT NULL,
  amount numeric(18,6) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT did_purchase_charges_type_valid
    CHECK (charge_type IN ('initial', 'renewal')),
  CONSTRAINT did_purchase_charges_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT did_purchase_charges_amount_valid
    CHECK (amount BETWEEN 0 AND 1000000),
  CONSTRAINT did_purchase_charges_period_valid
    CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS did_purchase_charges_period_unique
  ON did_purchase_charges(purchase_id, charge_type, period_start);

UPDATE modules
SET version = '0.30.0',
    status = 'active',
    description = 'Customer DID marketplace with protected stock allocation, prepaid and postpaid charging, tenant routing and automated renewals.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

UPDATE modules
SET version = '0.30.0',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('035_did_marketplace')
ON CONFLICT (version) DO NOTHING;

COMMIT;
