BEGIN;

CREATE TABLE IF NOT EXISTS billing_rate_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sip_trunk_id uuid NOT NULL REFERENCES sip_trunks(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'ZAR',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_rate_decks_name_valid CHECK (char_length(name) BETWEEN 2 AND 100),
  CONSTRAINT billing_rate_decks_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT billing_rate_decks_trunk_unique UNIQUE (sip_trunk_id)
);

CREATE TABLE IF NOT EXISTS billing_rates (
  id bigserial PRIMARY KEY,
  rate_deck_id uuid NOT NULL REFERENCES billing_rate_decks(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  destination_name text NOT NULL DEFAULT '',
  cost_per_minute numeric(18,6) NOT NULL DEFAULT 0,
  sell_per_minute numeric(18,6) NOT NULL DEFAULT 0,
  billing_increment_seconds integer NOT NULL DEFAULT 60,
  minimum_seconds integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_rates_prefix_valid CHECK (prefix ~ '^[0-9]{1,15}$'),
  CONSTRAINT billing_rates_destination_valid CHECK (char_length(destination_name) <= 120),
  CONSTRAINT billing_rates_cost_valid CHECK (cost_per_minute BETWEEN 0 AND 10000),
  CONSTRAINT billing_rates_sell_valid CHECK (sell_per_minute BETWEEN 0 AND 10000),
  CONSTRAINT billing_rates_increment_valid CHECK (billing_increment_seconds BETWEEN 1 AND 3600),
  CONSTRAINT billing_rates_minimum_valid CHECK (minimum_seconds BETWEEN 0 AND 3600),
  CONSTRAINT billing_rates_prefix_unique UNIQUE (rate_deck_id, prefix)
);

CREATE INDEX IF NOT EXISTS billing_rates_longest_prefix_idx
  ON billing_rates(rate_deck_id, length(prefix) DESC, prefix)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS billing_call_charges (
  id bigserial PRIMARY KEY,
  cdr_id bigint NOT NULL REFERENCES call_detail_records(id) ON DELETE CASCADE,
  call_key text NOT NULL,
  call_started_at timestamptz NOT NULL,
  rate_deck_id uuid REFERENCES billing_rate_decks(id) ON DELETE SET NULL,
  rate_id bigint REFERENCES billing_rates(id) ON DELETE SET NULL,
  sip_trunk_id uuid REFERENCES sip_trunks(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'outbound',
  destination text NOT NULL,
  destination_name text NOT NULL DEFAULT '',
  matched_prefix text NOT NULL,
  original_billsec integer NOT NULL,
  charged_seconds integer NOT NULL,
  cost_amount numeric(18,6) NOT NULL,
  sell_amount numeric(18,6) NOT NULL,
  margin_amount numeric(18,6) NOT NULL,
  currency char(3) NOT NULL,
  rated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_call_charges_call_unique UNIQUE (call_key),
  CONSTRAINT billing_call_charges_cdr_unique UNIQUE (cdr_id),
  CONSTRAINT billing_call_charges_direction_valid CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT billing_call_charges_destination_valid CHECK (destination ~ '^[0-9]{1,21}$'),
  CONSTRAINT billing_call_charges_prefix_valid CHECK (matched_prefix ~ '^[0-9]{1,15}$'),
  CONSTRAINT billing_call_charges_seconds_valid CHECK (
    original_billsec >= 0 AND charged_seconds >= original_billsec
  ),
  CONSTRAINT billing_call_charges_currency_valid CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS billing_call_charges_rated_at_idx
  ON billing_call_charges(rated_at DESC);
CREATE INDEX IF NOT EXISTS billing_call_charges_started_at_idx
  ON billing_call_charges(call_started_at DESC);
CREATE INDEX IF NOT EXISTS billing_call_charges_trunk_idx
  ON billing_call_charges(sip_trunk_id, rated_at DESC);
CREATE INDEX IF NOT EXISTS billing_call_charges_currency_idx
  ON billing_call_charges(currency, rated_at DESC);

UPDATE modules
SET version = '0.19.0',
    status = 'active',
    description = 'Auditable CDR rating with trunk rate decks, longest-prefix matching, billing increments, provider cost, sell price and margin reporting.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('022_billing_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
