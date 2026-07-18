BEGIN;

ALTER TABLE sip_trunks
  ADD COLUMN IF NOT EXISTS registration_contact_user text;

ALTER TABLE sip_trunks
  DROP CONSTRAINT IF EXISTS sip_trunks_registration_contact_user_valid;

ALTER TABLE sip_trunks
  ADD CONSTRAINT sip_trunks_registration_contact_user_valid
    CHECK (
      registration_contact_user IS NULL
      OR char_length(registration_contact_user) BETWEEN 1 AND 128
    );

-- Callcentric requires the full account number in the REGISTER Contact header.
-- Preserve other providers' existing behaviour unless an administrator opts in.
UPDATE sip_trunks
SET registration_contact_user = COALESCE(registration_username, username)
WHERE auth_mode = 'registration'
  AND lower(provider_host) IN ('sip.callcentric.net', 'callcentric.com')
  AND registration_contact_user IS NULL;

UPDATE modules
SET version = '0.32.3',
    description = 'Provider-neutral SIP trunks with registration Contact-header interoperability for carriers such as Callcentric.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('039_trunk_registration_contact_user')
ON CONFLICT (version) DO NOTHING;

COMMIT;
