BEGIN;

CREATE TABLE IF NOT EXISTS customer_branding (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  slug varchar(63) NOT NULL,
  brand_name varchar(120) NOT NULL,
  portal_title varchar(160) NOT NULL DEFAULT 'Communications portal',
  primary_color varchar(7) NOT NULL DEFAULT '#0B243A',
  accent_color varchar(7) NOT NULL DEFAULT '#FF7A1A',
  support_email varchar(254),
  support_phone varchar(40),
  website_url varchar(500),
  logo_data bytea,
  logo_mime_type varchar(30),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_branding_slug_valid
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  CONSTRAINT customer_branding_primary_color_valid
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT customer_branding_accent_color_valid
    CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT customer_branding_logo_type_valid
    CHECK (logo_mime_type IS NULL OR logo_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT customer_branding_logo_pair_valid
    CHECK ((logo_data IS NULL) = (logo_mime_type IS NULL)),
  CONSTRAINT customer_branding_logo_size_valid
    CHECK (logo_data IS NULL OR octet_length(logo_data) <= 393216)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_branding_slug_unique
  ON customer_branding(lower(slug));

INSERT INTO customer_branding
  (customer_id, slug, brand_name, portal_title)
SELECT id,
       'reseller-' || lpad(account_number::text, 6, '0'),
       name,
       'Communications portal'
  FROM customers
 WHERE account_type = 'wholesale'
   AND parent_customer_id IS NULL
ON CONFLICT (customer_id) DO NOTHING;

UPDATE modules
SET version = '0.29.0',
    status = 'active',
    description = 'Reseller white-label branding, inherited client portals, secure brand assets and branded login links.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('034_reseller_branding')
ON CONFLICT (version) DO NOTHING;

COMMIT;
