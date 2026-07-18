BEGIN;

ALTER TABLE extensions
  ADD COLUMN IF NOT EXISTS record_calls boolean NOT NULL DEFAULT false;

INSERT INTO settings (setting_key, setting_value, is_secret)
VALUES ('recording_retention_days', '90'::jsonb, false)
ON CONFLICT (setting_key) DO NOTHING;

UPDATE modules
SET version = '0.6.0',
    description = 'Asterisk control, extensions, live calls, CDR history, secure recordings and voicemail.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('006_call_recordings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
