BEGIN;

CREATE TABLE IF NOT EXISTS outbound_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sip_trunk_id uuid NOT NULL REFERENCES sip_trunks(id) ON DELETE RESTRICT,
  access_prefix text NOT NULL UNIQUE,
  outbound_caller_id text,
  ring_timeout_seconds integer NOT NULL DEFAULT 60,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_routes_name_valid
    CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT outbound_routes_access_prefix_valid
    CHECK (access_prefix ~ '^[0-9]{1,4}$'),
  CONSTRAINT outbound_routes_caller_id_valid
    CHECK (outbound_caller_id IS NULL OR outbound_caller_id ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT outbound_routes_timeout_valid
    CHECK (ring_timeout_seconds BETWEEN 10 AND 120)
);

CREATE INDEX IF NOT EXISTS outbound_routes_trunk_idx
  ON outbound_routes(sip_trunk_id);

ALTER TABLE sip_trunks
  DROP CONSTRAINT IF EXISTS sip_trunks_dial_prefix_plus_valid;

ALTER TABLE sip_trunks
  ADD CONSTRAINT sip_trunks_dial_prefix_plus_valid
    CHECK (dial_prefix = '' OR strip_plus = true);

UPDATE modules
SET version = '0.17.0',
    description = 'PBX extensions, provider-neutral SIP trunks, inbound DIDs and controlled outbound access-code routes.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('020_outbound_routes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
