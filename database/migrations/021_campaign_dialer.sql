BEGIN;

ALTER TABLE outbound_campaigns
  ADD COLUMN IF NOT EXISTS calling_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[];

ALTER TABLE outbound_campaigns
  ADD COLUMN IF NOT EXISTS ring_timeout_seconds integer NOT NULL DEFAULT 45;

ALTER TABLE outbound_campaigns
  ADD COLUMN IF NOT EXISTS last_started_at timestamptz;

ALTER TABLE outbound_campaigns
  DROP CONSTRAINT IF EXISTS outbound_campaigns_status_valid;

ALTER TABLE outbound_campaigns
  ADD CONSTRAINT outbound_campaigns_status_valid
  CHECK (status IN ('draft', 'ready', 'running', 'paused', 'completed', 'archived'));

ALTER TABLE outbound_campaigns
  DROP CONSTRAINT IF EXISTS outbound_campaigns_calling_days_valid;

ALTER TABLE outbound_campaigns
  ADD CONSTRAINT outbound_campaigns_calling_days_valid CHECK (
    cardinality(calling_days) BETWEEN 1 AND 7
    AND calling_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  );

ALTER TABLE outbound_campaigns
  DROP CONSTRAINT IF EXISTS outbound_campaigns_ring_timeout_valid;

ALTER TABLE outbound_campaigns
  ADD CONSTRAINT outbound_campaigns_ring_timeout_valid
  CHECK (ring_timeout_seconds BETWEEN 10 AND 120);

CREATE TABLE IF NOT EXISTS outbound_campaign_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES outbound_campaign_contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  dial_status text,
  error_code text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_campaign_attempts_status_valid CHECK (
    status IN ('queued', 'dialing', 'answered', 'no_answer', 'busy', 'failed')
  ),
  CONSTRAINT outbound_campaign_attempts_dial_status_valid CHECK (
    dial_status IS NULL OR dial_status ~ '^[A-Z_]{2,32}$'
  ),
  CONSTRAINT outbound_campaign_attempts_error_valid CHECK (
    error_code IS NULL OR char_length(error_code) <= 200
  )
);

CREATE INDEX IF NOT EXISTS outbound_campaign_attempts_campaign_idx
  ON outbound_campaign_attempts(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_campaign_attempts_active_idx
  ON outbound_campaign_attempts(campaign_id, status)
  WHERE status IN ('queued', 'dialing');

CREATE UNIQUE INDEX IF NOT EXISTS outbound_campaign_attempts_contact_active_unique
  ON outbound_campaign_attempts(contact_id)
  WHERE status IN ('queued', 'dialing');

UPDATE modules
SET version = '0.18.0',
    status = 'active',
    description = 'Consent-based outbound campaigns with suppression, schedules, bounded pacing, retries, live execution and human or AI delivery.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'campaigns';

INSERT INTO schema_migrations(version)
VALUES ('021_campaign_dialer')
ON CONFLICT (version) DO NOTHING;

COMMIT;
