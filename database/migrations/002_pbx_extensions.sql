BEGIN;

CREATE TABLE IF NOT EXISTS extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_number text NOT NULL UNIQUE,
  display_name text NOT NULL,
  secret_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_contacts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extensions_number_valid
    CHECK (extension_number ~ '^[0-9]{2,8}$'),
  CONSTRAINT extensions_display_name_valid
    CHECK (char_length(display_name) BETWEEN 2 AND 80),
  CONSTRAINT extensions_max_contacts_valid
    CHECK (max_contacts BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS extensions_number_idx
  ON extensions(extension_number);

UPDATE modules
SET version = '0.2.0',
    description = 'Asterisk control, encrypted SIP extensions, routing and shared platform services.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('002_pbx_extensions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
