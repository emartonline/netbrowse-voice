BEGIN;

-- The existing settings table is deliberately reused: the client ID can be
-- read by the owner, while the client secret is encrypted by the API before
-- it is persisted and is never returned to a browser.
UPDATE modules
SET version = '0.32.0',
    status = 'active',
    description = 'Tenant-isolated customer billing, wallet ledgers, invoices, DID purchases and owner-configured PayPal Sandbox wallet top-ups.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('037_paypal_gui_settings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
