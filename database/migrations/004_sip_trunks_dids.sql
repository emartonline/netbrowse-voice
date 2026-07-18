BEGIN;

CREATE TABLE IF NOT EXISTS sip_trunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  auth_mode text NOT NULL
    CHECK (auth_mode IN ('registration', 'ip')),
  provider_host text NOT NULL,
  provider_port integer NOT NULL DEFAULT 5060
    CHECK (provider_port BETWEEN 1 AND 65535),
  username text,
  secret_ciphertext text,
  inbound_match text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sip_trunks_name_valid
    CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT sip_trunks_host_valid
    CHECK (char_length(provider_host) BETWEEN 1 AND 253),
  CONSTRAINT sip_trunks_auth_complete
    CHECK (
      (auth_mode = 'registration' AND username IS NOT NULL AND secret_ciphertext IS NOT NULL)
      OR auth_mode = 'ip'
    )
);

CREATE INDEX IF NOT EXISTS sip_trunks_enabled_idx
  ON sip_trunks(enabled);

CREATE TABLE IF NOT EXISTS did_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  did_number text NOT NULL UNIQUE,
  trunk_id uuid NOT NULL REFERENCES sip_trunks(id) ON DELETE RESTRICT,
  extension_id uuid NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT did_routes_number_valid
    CHECK (did_number ~ '^\+?[0-9]{3,20}$')
);

CREATE INDEX IF NOT EXISTS did_routes_trunk_idx
  ON did_routes(trunk_id);

CREATE INDEX IF NOT EXISTS did_routes_extension_idx
  ON did_routes(extension_id);

UPDATE modules
SET version = '0.4.0',
    description = 'Asterisk control, extensions, SIP trunks, inbound DID routing and voicemail.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('004_sip_trunks_dids')
ON CONFLICT (version) DO NOTHING;

COMMIT;
