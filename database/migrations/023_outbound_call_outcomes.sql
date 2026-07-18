BEGIN;

UPDATE modules
SET version = '0.19.1',
    description = 'Auditable outbound CDR outcomes with exact Asterisk dial status, non-chargeable attempt visibility and rated-call accounting.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

UPDATE modules
SET version = '0.19.1',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('023_outbound_call_outcomes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
