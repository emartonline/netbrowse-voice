BEGIN;

CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  dialing_mode text NOT NULL DEFAULT 'progressive',
  destination_type text NOT NULL,
  destination_call_group_id uuid REFERENCES call_groups(id) ON DELETE RESTRICT,
  destination_ai_receptionist_id uuid REFERENCES ai_receptionists(id) ON DELETE RESTRICT,
  sip_trunk_id uuid REFERENCES sip_trunks(id) ON DELETE RESTRICT,
  outbound_caller_id text,
  calls_per_minute integer NOT NULL DEFAULT 10,
  max_concurrent_calls integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 3,
  retry_delay_minutes integer NOT NULL DEFAULT 60,
  calling_window_start time NOT NULL DEFAULT '08:00',
  calling_window_end time NOT NULL DEFAULT '18:00',
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  compliance_attested boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_campaigns_name_valid CHECK (char_length(name) BETWEEN 2 AND 100),
  CONSTRAINT outbound_campaigns_description_valid CHECK (char_length(description) <= 1000),
  CONSTRAINT outbound_campaigns_status_valid
    CHECK (status IN ('draft', 'ready', 'paused', 'completed', 'archived')),
  CONSTRAINT outbound_campaigns_mode_valid
    CHECK (dialing_mode IN ('preview', 'progressive', 'ai')),
  CONSTRAINT outbound_campaigns_destination_type_valid
    CHECK (destination_type IN ('human_queue', 'ai_receptionist')),
  CONSTRAINT outbound_campaigns_destination_valid CHECK (
    (destination_type = 'human_queue'
      AND destination_call_group_id IS NOT NULL
      AND destination_ai_receptionist_id IS NULL)
    OR
    (destination_type = 'ai_receptionist'
      AND destination_ai_receptionist_id IS NOT NULL
      AND destination_call_group_id IS NULL)
  ),
  CONSTRAINT outbound_campaigns_mode_destination_valid CHECK (
    (destination_type = 'ai_receptionist' AND dialing_mode = 'ai')
    OR
    (destination_type = 'human_queue' AND dialing_mode IN ('preview', 'progressive'))
  ),
  CONSTRAINT outbound_campaigns_caller_id_valid CHECK (
    outbound_caller_id IS NULL OR outbound_caller_id ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT outbound_campaigns_pacing_valid CHECK (calls_per_minute BETWEEN 1 AND 60),
  CONSTRAINT outbound_campaigns_concurrency_valid CHECK (max_concurrent_calls BETWEEN 1 AND 50),
  CONSTRAINT outbound_campaigns_attempts_valid CHECK (max_attempts BETWEEN 1 AND 5),
  CONSTRAINT outbound_campaigns_retry_valid CHECK (retry_delay_minutes BETWEEN 5 AND 1440),
  CONSTRAINT outbound_campaigns_window_valid CHECK (calling_window_start < calling_window_end),
  CONSTRAINT outbound_campaigns_timezone_valid CHECK (char_length(timezone) BETWEEN 1 AND 80),
  CONSTRAINT outbound_campaigns_ready_attested CHECK (status <> 'ready' OR compliance_attested)
);

CREATE INDEX IF NOT EXISTS outbound_campaigns_status_idx
  ON outbound_campaigns(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS outbound_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  reason text NOT NULL DEFAULT 'requested',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_suppressions_phone_valid CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT outbound_suppressions_reason_valid
    CHECK (reason IN ('requested', 'manual', 'regulatory')),
  CONSTRAINT outbound_suppressions_notes_valid CHECK (char_length(notes) <= 500)
);

CREATE TABLE IF NOT EXISTS outbound_campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  external_reference text NOT NULL DEFAULT '',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone_e164),
  CONSTRAINT outbound_campaign_contacts_phone_valid CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT outbound_campaign_contacts_name_valid
    CHECK (char_length(first_name) <= 100 AND char_length(last_name) <= 100),
  CONSTRAINT outbound_campaign_contacts_reference_valid CHECK (char_length(external_reference) <= 120),
  CONSTRAINT outbound_campaign_contacts_status_valid CHECK (
    status IN ('ready', 'suppressed', 'in_progress', 'answered', 'no_answer', 'busy', 'failed', 'completed')
  ),
  CONSTRAINT outbound_campaign_contacts_attempts_valid CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT outbound_campaign_contacts_custom_fields_valid CHECK (jsonb_typeof(custom_fields) = 'object')
);

CREATE INDEX IF NOT EXISTS outbound_campaign_contacts_status_idx
  ON outbound_campaign_contacts(campaign_id, status, created_at);

CREATE INDEX IF NOT EXISTS outbound_campaign_contacts_phone_idx
  ON outbound_campaign_contacts(phone_e164);

UPDATE modules
SET status = 'active',
    version = '0.15.0',
    description = 'Validated outbound campaign lists, global suppression, pacing, retries and human or AI assignment.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'campaigns';

INSERT INTO schema_migrations(version)
VALUES ('018_campaigns_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
