BEGIN;

ALTER TABLE sound_assets
  DROP CONSTRAINT IF EXISTS sound_assets_provider_valid;

ALTER TABLE sound_assets
  ADD CONSTRAINT sound_assets_provider_valid
  CHECK (provider IN ('openai', 'google', 'elevenlabs'));

INSERT INTO settings (setting_key, setting_value, is_secret)
VALUES
  ('sound_studio_google_api_key', 'null'::jsonb, true),
  ('sound_studio_elevenlabs_api_key', 'null'::jsonb, true)
ON CONFLICT (setting_key) DO NOTHING;

UPDATE modules
SET version = '0.7.0',
    status = 'active',
    description = 'Multi-provider AI speech generation, secure audio library and Asterisk-ready WAV conversion.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'sound-studio';

INSERT INTO schema_migrations(version)
VALUES ('008_sound_studio_providers')
ON CONFLICT (version) DO NOTHING;

COMMIT;
