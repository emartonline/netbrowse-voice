BEGIN;

UPDATE modules
SET version = '0.27.0',
    status = 'active',
    description = 'Tenant-isolated recording playback, downloads, deletion, storage accounting and plan quota enforcement.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('032_customer_recording_archive')
ON CONFLICT (version) DO NOTHING;

COMMIT;
