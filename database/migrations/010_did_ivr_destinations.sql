BEGIN;

ALTER TABLE did_routes
  ADD COLUMN IF NOT EXISTS destination_type text;

ALTER TABLE did_routes
  ADD COLUMN IF NOT EXISTS ivr_menu_id uuid
    REFERENCES ivr_menus(id) ON DELETE RESTRICT;

UPDATE did_routes
   SET destination_type = 'extension'
 WHERE destination_type IS NULL;

ALTER TABLE did_routes
  ALTER COLUMN destination_type SET DEFAULT 'extension',
  ALTER COLUMN destination_type SET NOT NULL,
  ALTER COLUMN extension_id DROP NOT NULL;

ALTER TABLE did_routes
  DROP CONSTRAINT IF EXISTS did_routes_destination_type_valid,
  DROP CONSTRAINT IF EXISTS did_routes_destination_complete;

ALTER TABLE did_routes
  ADD CONSTRAINT did_routes_destination_type_valid
    CHECK (destination_type IN ('extension', 'ivr')),
  ADD CONSTRAINT did_routes_destination_complete
    CHECK (
      (destination_type = 'extension' AND extension_id IS NOT NULL AND ivr_menu_id IS NULL)
      OR
      (destination_type = 'ivr' AND extension_id IS NULL AND ivr_menu_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS did_routes_ivr_menu_idx
  ON did_routes(ivr_menu_id);

UPDATE modules
SET version = '0.9.0',
    description = 'Asterisk control, extensions, SIP trunks, inbound DID routing to extensions or IVRs, and voicemail.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('010_did_ivr_destinations')
ON CONFLICT (version) DO NOTHING;

COMMIT;
