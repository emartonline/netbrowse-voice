BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS rate_deck_id uuid
    REFERENCES billing_rate_decks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customers_rate_deck_idx
  ON customers(rate_deck_id)
  WHERE rate_deck_id IS NOT NULL;

ALTER TABLE billing_call_charges
  ADD COLUMN IF NOT EXISTS cost_charged_seconds integer,
  ADD COLUMN IF NOT EXISTS sell_rate_deck_id uuid
    REFERENCES billing_rate_decks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sell_rate_id bigint
    REFERENCES billing_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sell_matched_prefix text,
  ADD COLUMN IF NOT EXISTS sell_per_minute numeric(18,6),
  ADD COLUMN IF NOT EXISTS billing_increment_seconds integer,
  ADD COLUMN IF NOT EXISTS minimum_seconds integer;

UPDATE billing_call_charges AS charges
SET cost_charged_seconds = COALESCE(charges.cost_charged_seconds, charges.charged_seconds),
    sell_rate_deck_id = COALESCE(charges.sell_rate_deck_id, charges.rate_deck_id),
    sell_rate_id = COALESCE(charges.sell_rate_id, charges.rate_id),
    sell_matched_prefix = COALESCE(charges.sell_matched_prefix, charges.matched_prefix),
    sell_per_minute = COALESCE(
      charges.sell_per_minute,
      CASE
        WHEN charges.charged_seconds > 0
          THEN round(charges.sell_amount * 60 / charges.charged_seconds, 6)
        ELSE 0
      END
    ),
    billing_increment_seconds = COALESCE(
      charges.billing_increment_seconds,
      (SELECT rates.billing_increment_seconds FROM billing_rates AS rates WHERE rates.id = charges.rate_id),
      60
    ),
    minimum_seconds = COALESCE(
      charges.minimum_seconds,
      (SELECT rates.minimum_seconds FROM billing_rates AS rates WHERE rates.id = charges.rate_id),
      0
    );

ALTER TABLE billing_call_charges
  ALTER COLUMN cost_charged_seconds SET NOT NULL,
  ALTER COLUMN sell_matched_prefix SET NOT NULL,
  ALTER COLUMN sell_per_minute SET NOT NULL,
  ALTER COLUMN billing_increment_seconds SET NOT NULL,
  ALTER COLUMN minimum_seconds SET NOT NULL;

ALTER TABLE billing_call_charges
  DROP CONSTRAINT IF EXISTS billing_call_charges_cost_seconds_valid;
ALTER TABLE billing_call_charges
  ADD CONSTRAINT billing_call_charges_cost_seconds_valid
  CHECK (cost_charged_seconds >= original_billsec);

ALTER TABLE billing_call_charges
  DROP CONSTRAINT IF EXISTS billing_call_charges_sell_rate_valid;
ALTER TABLE billing_call_charges
  ADD CONSTRAINT billing_call_charges_sell_rate_valid
  CHECK (sell_per_minute BETWEEN 0 AND 10000);

ALTER TABLE billing_call_charges
  DROP CONSTRAINT IF EXISTS billing_call_charges_sell_prefix_valid;
ALTER TABLE billing_call_charges
  ADD CONSTRAINT billing_call_charges_sell_prefix_valid
  CHECK (sell_matched_prefix ~ '^[0-9]{1,15}$');

ALTER TABLE billing_call_charges
  DROP CONSTRAINT IF EXISTS billing_call_charges_sell_terms_valid;
ALTER TABLE billing_call_charges
  ADD CONSTRAINT billing_call_charges_sell_terms_valid
  CHECK (
    billing_increment_seconds BETWEEN 1 AND 3600
    AND minimum_seconds BETWEEN 0 AND 3600
  );

UPDATE customers AS customers
SET rate_deck_id = (
  SELECT decks.id
    FROM billing_rate_decks AS decks
   WHERE decks.enabled = true
     AND decks.currency = customers.currency
   ORDER BY decks.created_at, decks.id
   LIMIT 1
)
WHERE customers.rate_deck_id IS NULL
  AND 1 = (
    SELECT count(*)
      FROM billing_rate_decks AS decks
     WHERE decks.enabled = true
       AND decks.currency = customers.currency
  );

UPDATE modules
SET version = '0.24.0',
    status = 'active',
    description = 'Customer selling-rate cards, tenant-safe itemised rated calls and immutable provider/customer billing snapshots.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('028_customer_rate_cards')
ON CONFLICT (version) DO NOTHING;

COMMIT;
