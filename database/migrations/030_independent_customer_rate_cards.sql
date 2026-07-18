BEGIN;

CREATE TABLE IF NOT EXISTS customer_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ZAR',
  enabled boolean NOT NULL DEFAULT true,
  legacy_billing_rate_deck_id uuid UNIQUE
    REFERENCES billing_rate_decks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_rate_cards_name_valid
    CHECK (char_length(name) BETWEEN 2 AND 100),
  CONSTRAINT customer_rate_cards_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS customer_rate_cards_active_idx
  ON customer_rate_cards(currency, name)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS customer_rate_card_rates (
  id bigserial PRIMARY KEY,
  rate_card_id uuid NOT NULL
    REFERENCES customer_rate_cards(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  destination_name text NOT NULL DEFAULT '',
  price_per_minute numeric(18,6) NOT NULL DEFAULT 0,
  billing_increment_seconds integer NOT NULL DEFAULT 60,
  minimum_seconds integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_rate_card_rates_prefix_valid
    CHECK (prefix ~ '^[0-9]{1,15}$'),
  CONSTRAINT customer_rate_card_rates_destination_valid
    CHECK (char_length(destination_name) <= 120),
  CONSTRAINT customer_rate_card_rates_price_valid
    CHECK (price_per_minute BETWEEN 0 AND 10000),
  CONSTRAINT customer_rate_card_rates_increment_valid
    CHECK (billing_increment_seconds BETWEEN 1 AND 3600),
  CONSTRAINT customer_rate_card_rates_minimum_valid
    CHECK (minimum_seconds BETWEEN 0 AND 3600),
  CONSTRAINT customer_rate_card_rates_prefix_unique
    UNIQUE (rate_card_id, prefix)
);

CREATE INDEX IF NOT EXISTS customer_rate_card_rates_longest_prefix_idx
  ON customer_rate_card_rates(rate_card_id, length(prefix) DESC, prefix)
  WHERE enabled = true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_rate_card_id uuid
    REFERENCES customer_rate_cards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customers_customer_rate_card_idx
  ON customers(customer_rate_card_id)
  WHERE customer_rate_card_id IS NOT NULL;

ALTER TABLE billing_call_charges
  ADD COLUMN IF NOT EXISTS customer_rate_card_id uuid
    REFERENCES customer_rate_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_rate_id bigint
    REFERENCES customer_rate_card_rates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS billing_call_charges_customer_rate_card_idx
  ON billing_call_charges(customer_rate_card_id, call_started_at DESC)
  WHERE customer_rate_card_id IS NOT NULL;

INSERT INTO customer_rate_cards
  (name, currency, enabled, legacy_billing_rate_deck_id, created_by,
   created_at, updated_at)
SELECT decks.name || ' Customer Rates', decks.currency, decks.enabled, decks.id,
       decks.created_by, decks.created_at, decks.updated_at
 FROM billing_rate_decks AS decks
 WHERE EXISTS (
   SELECT 1 FROM customers WHERE customers.rate_deck_id = decks.id
 )
   AND NOT EXISTS (
     SELECT 1 FROM schema_migrations
      WHERE version = '030_independent_customer_rate_cards'
   )
ON CONFLICT (legacy_billing_rate_deck_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = GREATEST(customer_rate_cards.updated_at, EXCLUDED.updated_at);

INSERT INTO customer_rate_card_rates
  (rate_card_id, prefix, destination_name, price_per_minute,
   billing_increment_seconds, minimum_seconds, enabled, created_at, updated_at)
SELECT cards.id, rates.prefix, rates.destination_name, rates.sell_per_minute,
       rates.billing_increment_seconds, rates.minimum_seconds, rates.enabled,
       rates.created_at, rates.updated_at
  FROM customer_rate_cards AS cards
  JOIN billing_rates AS rates
    ON rates.rate_deck_id = cards.legacy_billing_rate_deck_id
 WHERE cards.legacy_billing_rate_deck_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM schema_migrations
      WHERE version = '030_independent_customer_rate_cards'
   )
ON CONFLICT (rate_card_id, prefix) DO UPDATE
SET destination_name = EXCLUDED.destination_name,
    price_per_minute = EXCLUDED.price_per_minute,
    billing_increment_seconds = EXCLUDED.billing_increment_seconds,
    minimum_seconds = EXCLUDED.minimum_seconds,
    enabled = EXCLUDED.enabled,
    updated_at = GREATEST(customer_rate_card_rates.updated_at, EXCLUDED.updated_at);

UPDATE customers
SET customer_rate_card_id = cards.id
FROM customer_rate_cards AS cards
WHERE customers.customer_rate_card_id IS NULL
  AND customers.rate_deck_id = cards.legacy_billing_rate_deck_id
  AND NOT EXISTS (
    SELECT 1 FROM schema_migrations
     WHERE version = '030_independent_customer_rate_cards'
  );

UPDATE billing_call_charges AS charges
SET customer_rate_card_id = cards.id
FROM customer_rate_cards AS cards
WHERE charges.customer_rate_card_id IS NULL
  AND charges.sell_rate_deck_id = cards.legacy_billing_rate_deck_id
  AND NOT EXISTS (
    SELECT 1 FROM schema_migrations
     WHERE version = '030_independent_customer_rate_cards'
  );

UPDATE billing_call_charges AS charges
SET customer_rate_id = card_rates.id
FROM customer_rate_card_rates AS card_rates
WHERE charges.customer_rate_id IS NULL
  AND charges.customer_rate_card_id = card_rates.rate_card_id
  AND charges.sell_matched_prefix = card_rates.prefix
  AND NOT EXISTS (
    SELECT 1 FROM schema_migrations
     WHERE version = '030_independent_customer_rate_cards'
  );

UPDATE modules
SET version = '0.25.0',
    status = 'active',
    description = 'Independent provider cost decks and assignable retail or wholesale customer rate cards.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('030_independent_customer_rate_cards')
ON CONFLICT (version) DO NOTHING;

COMMIT;
