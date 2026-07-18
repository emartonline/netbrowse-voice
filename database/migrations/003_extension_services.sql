BEGIN;

ALTER TABLE extensions
  ADD COLUMN IF NOT EXISTS ring_timeout_seconds integer NOT NULL DEFAULT 30
    CHECK (ring_timeout_seconds BETWEEN 5 AND 120),
  ADD COLUMN IF NOT EXISTS voicemail_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_pin_ciphertext text,
  ADD COLUMN IF NOT EXISTS dnd_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_waiting boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_group integer
    CHECK (pickup_group BETWEEN 0 AND 63),
  ADD COLUMN IF NOT EXISTS forward_mode text NOT NULL DEFAULT 'off'
    CHECK (forward_mode IN ('off', 'always', 'busy', 'unavailable')),
  ADD COLUMN IF NOT EXISTS forward_extension_id uuid
    REFERENCES extensions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS extensions_forward_extension_idx
  ON extensions(forward_extension_id);

UPDATE modules
SET version = '0.3.0',
    description = 'Asterisk control, live extension status, voicemail and call handling services.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('003_extension_services')
ON CONFLICT (version) DO NOTHING;

COMMIT;
