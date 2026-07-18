BEGIN;

UPDATE modules
SET version = '0.23.0',
    status = 'active',
    description = 'Tenant-isolated customer invoices with branded PDF downloads, immutable call line items and auditable payment records.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('027_invoice_pdf_navigation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
