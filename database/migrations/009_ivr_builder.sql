BEGIN;

CREATE TABLE IF NOT EXISTS ivr_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  extension_number text NOT NULL UNIQUE,
  greeting_sound_asset_id uuid NOT NULL REFERENCES sound_assets(id) ON DELETE RESTRICT,
  timeout_seconds integer NOT NULL DEFAULT 7,
  max_attempts integer NOT NULL DEFAULT 3,
  fallback_extension_id uuid REFERENCES extensions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ivr_menus_name_length CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT ivr_menus_extension_format CHECK (extension_number ~ '^[0-9]{2,8}$'),
  CONSTRAINT ivr_menus_timeout_valid CHECK (timeout_seconds BETWEEN 2 AND 30),
  CONSTRAINT ivr_menus_attempts_valid CHECK (max_attempts BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS ivr_options (
  ivr_menu_id uuid NOT NULL REFERENCES ivr_menus(id) ON DELETE CASCADE,
  digit text NOT NULL,
  destination_extension_id uuid NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ivr_menu_id, digit),
  CONSTRAINT ivr_options_digit_valid CHECK (digit ~ '^[0-9]$')
);

CREATE INDEX IF NOT EXISTS ivr_menus_created_at_idx ON ivr_menus(created_at DESC);
CREATE INDEX IF NOT EXISTS ivr_options_destination_idx ON ivr_options(destination_extension_id);

INSERT INTO modules
  (module_key, name, version, status, description, sort_order, installed_at)
VALUES
  ('ivr-builder', 'IVR Builder', '0.8.0', 'active',
   'Announcement menus, keypad routing, timeout handling and Asterisk dialplan publishing.',
   25, now())
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  version = EXCLUDED.version,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  installed_at = COALESCE(modules.installed_at, now()),
  updated_at = now();

INSERT INTO schema_migrations(version)
VALUES ('009_ivr_builder')
ON CONFLICT (version) DO NOTHING;

COMMIT;
