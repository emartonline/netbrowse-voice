BEGIN;

ALTER TABLE customer_wallet_transactions
  DROP CONSTRAINT IF EXISTS customer_wallet_transactions_type_valid;

ALTER TABLE customer_wallet_transactions
  ADD CONSTRAINT customer_wallet_transactions_type_valid
  CHECK (transaction_type IN ('topup', 'adjustment', 'charge', 'refund', 'payment'));

CREATE TABLE IF NOT EXISTS billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number bigserial NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL,
  billing_mode text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  subtotal numeric(18,6) NOT NULL,
  total numeric(18,6) NOT NULL,
  paid_amount numeric(18,6) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoices_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT billing_invoices_mode_valid CHECK (billing_mode IN ('prepaid', 'postpaid')),
  CONSTRAINT billing_invoices_period_valid CHECK (period_end >= period_start),
  CONSTRAINT billing_invoices_due_valid CHECK (due_date >= issue_date),
  CONSTRAINT billing_invoices_status_valid CHECK (status IN ('issued', 'paid')),
  CONSTRAINT billing_invoices_amounts_valid CHECK (
    subtotal >= 0 AND total = subtotal AND paid_amount >= 0 AND paid_amount <= total
  ),
  CONSTRAINT billing_invoices_paid_state_valid CHECK (
    (status = 'paid' AND paid_amount = total AND paid_at IS NOT NULL)
    OR (status = 'issued' AND paid_amount < total AND paid_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS billing_invoices_customer_idx
  ON billing_invoices(customer_id, issue_date DESC, invoice_number DESC);

CREATE INDEX IF NOT EXISTS billing_invoices_status_due_idx
  ON billing_invoices(status, due_date)
  WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS billing_invoice_items (
  id bigserial PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE RESTRICT,
  billing_call_charge_id bigint NOT NULL UNIQUE
    REFERENCES billing_call_charges(id) ON DELETE RESTRICT,
  service_date date NOT NULL,
  source text NOT NULL,
  destination text NOT NULL,
  destination_name text NOT NULL,
  charged_seconds integer NOT NULL,
  amount numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoice_items_source_valid CHECK (char_length(source) BETWEEN 1 AND 80),
  CONSTRAINT billing_invoice_items_destination_valid CHECK (destination ~ '^[0-9]{1,32}$'),
  CONSTRAINT billing_invoice_items_name_valid CHECK (char_length(destination_name) BETWEEN 1 AND 160),
  CONSTRAINT billing_invoice_items_seconds_valid CHECK (charged_seconds >= 0),
  CONSTRAINT billing_invoice_items_amount_valid CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS billing_invoice_items_invoice_idx
  ON billing_invoice_items(invoice_id, service_date, id);

CREATE TABLE IF NOT EXISTS billing_invoice_payments (
  id bigserial PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL,
  amount numeric(18,6) NOT NULL,
  reference text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoice_payments_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT billing_invoice_payments_amount_valid CHECK (amount > 0),
  CONSTRAINT billing_invoice_payments_reference_valid CHECK (char_length(reference) BETWEEN 2 AND 120)
);

CREATE INDEX IF NOT EXISTS billing_invoice_payments_invoice_idx
  ON billing_invoice_payments(invoice_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_billing_invoice_detail_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issued invoice details and payments are immutable';
END;
$$;

DROP TRIGGER IF EXISTS billing_invoice_items_immutable ON billing_invoice_items;
CREATE TRIGGER billing_invoice_items_immutable
BEFORE UPDATE OR DELETE ON billing_invoice_items
FOR EACH ROW EXECUTE FUNCTION prevent_billing_invoice_detail_mutation();

DROP TRIGGER IF EXISTS billing_invoice_payments_immutable ON billing_invoice_payments;
CREATE TRIGGER billing_invoice_payments_immutable
BEFORE UPDATE OR DELETE ON billing_invoice_payments
FOR EACH ROW EXECUTE FUNCTION prevent_billing_invoice_detail_mutation();

UPDATE modules
SET version = '0.22.0',
    status = 'active',
    description = 'Tenant-isolated customer invoices, immutable call line items, auditable payment records and downloadable CSV statements.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('026_customer_invoices')
ON CONFLICT (version) DO NOTHING;

COMMIT;
