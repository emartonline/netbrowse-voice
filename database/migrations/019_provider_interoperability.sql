BEGIN;

ALTER TABLE sip_trunks
  ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'udp',
  ADD COLUMN IF NOT EXISTS registration_username text,
  ADD COLUMN IF NOT EXISTS from_user text,
  ADD COLUMN IF NOT EXISTS from_domain text,
  ADD COLUMN IF NOT EXISTS dial_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS strip_plus boolean NOT NULL DEFAULT true;

UPDATE sip_trunks
SET registration_username = username
WHERE auth_mode = 'registration'
  AND registration_username IS NULL;

-- Preserve the pre-0.16 From-user behaviour for existing registration trunks.
UPDATE sip_trunks
SET from_user = username
WHERE auth_mode = 'registration'
  AND from_user IS NULL;

ALTER TABLE sip_trunks
  DROP CONSTRAINT IF EXISTS sip_trunks_auth_mode_check,
  DROP CONSTRAINT IF EXISTS sip_trunks_auth_complete,
  DROP CONSTRAINT IF EXISTS sip_trunks_transport_valid,
  DROP CONSTRAINT IF EXISTS sip_trunks_registration_username_valid,
  DROP CONSTRAINT IF EXISTS sip_trunks_from_user_valid,
  DROP CONSTRAINT IF EXISTS sip_trunks_from_domain_valid,
  DROP CONSTRAINT IF EXISTS sip_trunks_dial_prefix_valid;

ALTER TABLE sip_trunks
  ADD CONSTRAINT sip_trunks_auth_mode_check
    CHECK (auth_mode IN ('registration', 'credentials', 'ip')),
  ADD CONSTRAINT sip_trunks_auth_complete
    CHECK (
      (auth_mode IN ('registration', 'credentials')
        AND username IS NOT NULL
        AND secret_ciphertext IS NOT NULL)
      OR auth_mode = 'ip'
    ),
  ADD CONSTRAINT sip_trunks_transport_valid
    CHECK (transport IN ('udp', 'tcp')),
  ADD CONSTRAINT sip_trunks_registration_username_valid
    CHECK (registration_username IS NULL OR char_length(registration_username) BETWEEN 1 AND 128),
  ADD CONSTRAINT sip_trunks_from_user_valid
    CHECK (from_user IS NULL OR char_length(from_user) BETWEEN 1 AND 128),
  ADD CONSTRAINT sip_trunks_from_domain_valid
    CHECK (from_domain IS NULL OR char_length(from_domain) BETWEEN 1 AND 253),
  ADD CONSTRAINT sip_trunks_dial_prefix_valid
    CHECK (dial_prefix ~ '^[0-9]{0,20}$');

UPDATE modules
SET version = '0.16.0',
    description = 'Provider-neutral SIP trunks with registration, digest or IP authentication and outbound number formatting.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('019_provider_interoperability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
