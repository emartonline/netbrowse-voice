BEGIN;

CREATE TABLE IF NOT EXISTS sound_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  filename text NOT NULL UNIQUE,
  asterisk_name text NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  voice text NOT NULL,
  source_text text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  speed numeric(4,2) NOT NULL DEFAULT 1.00,
  duration_ms integer NOT NULL,
  size_bytes bigint NOT NULL,
  sample_rate integer NOT NULL DEFAULT 8000,
  channels integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sound_assets_name_length CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT sound_assets_source_length CHECK (char_length(source_text) BETWEEN 1 AND 4096),
  CONSTRAINT sound_assets_provider_valid CHECK (provider IN ('openai')),
  CONSTRAINT sound_assets_speed_valid CHECK (speed BETWEEN 0.25 AND 4.00),
  CONSTRAINT sound_assets_duration_valid CHECK (duration_ms > 0),
  CONSTRAINT sound_assets_size_valid CHECK (size_bytes > 44),
  CONSTRAINT sound_assets_telephony_format CHECK (sample_rate = 8000 AND channels = 1)
);

CREATE INDEX IF NOT EXISTS sound_assets_created_at_idx
  ON sound_assets(created_at DESC);

INSERT INTO settings (setting_key, setting_value, is_secret)
VALUES ('sound_studio_openai_api_key', 'null'::jsonb, true)
ON CONFLICT (setting_key) DO NOTHING;

UPDATE modules
SET version = '0.7.0',
    status = 'active',
    description = 'AI speech generation, pronunciation direction, secure audio library and Asterisk-ready WAV conversion.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'sound-studio';

INSERT INTO schema_migrations(version)
VALUES ('007_sound_studio')
ON CONFLICT (version) DO NOTHING;

COMMIT;
