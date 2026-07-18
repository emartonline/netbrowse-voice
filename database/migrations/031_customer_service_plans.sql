BEGIN;

CREATE TABLE IF NOT EXISTS customer_service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  max_extensions integer NOT NULL DEFAULT 5,
  max_dids integer NOT NULL DEFAULT 1,
  recording_storage_mb integer NOT NULL DEFAULT 0,
  max_ai_receptionists integer NOT NULL DEFAULT 0,
  max_campaigns integer NOT NULL DEFAULT 0,
  self_service_extensions boolean NOT NULL DEFAULT true,
  recording_enabled boolean NOT NULL DEFAULT false,
  ai_receptionist_enabled boolean NOT NULL DEFAULT false,
  campaigns_enabled boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_service_plans_name_valid
    CHECK (char_length(name) BETWEEN 2 AND 100),
  CONSTRAINT customer_service_plans_description_valid
    CHECK (char_length(description) <= 500),
  CONSTRAINT customer_service_plans_extension_limit_valid
    CHECK (max_extensions BETWEEN 0 AND 10000),
  CONSTRAINT customer_service_plans_did_limit_valid
    CHECK (max_dids BETWEEN 0 AND 10000),
  CONSTRAINT customer_service_plans_recording_limit_valid
    CHECK (recording_storage_mb BETWEEN 0 AND 1000000),
  CONSTRAINT customer_service_plans_ai_limit_valid
    CHECK (max_ai_receptionists BETWEEN 0 AND 1000),
  CONSTRAINT customer_service_plans_campaign_limit_valid
    CHECK (max_campaigns BETWEEN 0 AND 1000)
);

CREATE INDEX IF NOT EXISTS customer_service_plans_enabled_idx
  ON customer_service_plans(name)
  WHERE enabled = true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS service_plan_id uuid
    REFERENCES customer_service_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extension_range_start integer,
  ADD COLUMN IF NOT EXISTS extension_range_end integer;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_extension_range_valid;
ALTER TABLE customers
  ADD CONSTRAINT customers_extension_range_valid CHECK (
    (extension_range_start IS NULL AND extension_range_end IS NULL)
    OR (
      extension_range_start BETWEEN 10 AND 99999999
      AND extension_range_end BETWEEN extension_range_start AND 99999999
      AND length(extension_range_start::text) = length(extension_range_end::text)
      AND extension_range_end - extension_range_start <= 9999
    )
  );

CREATE INDEX IF NOT EXISTS customers_service_plan_idx
  ON customers(service_plan_id)
  WHERE service_plan_id IS NOT NULL;

INSERT INTO customer_service_plans
  (name, description, max_extensions, max_dids, recording_storage_mb,
   max_ai_receptionists, max_campaigns, self_service_extensions,
   recording_enabled, ai_receptionist_enabled, campaigns_enabled)
VALUES
  ('Standard',
   'Core hosted PBX access with customer-managed extensions and voicemail.',
   10, 5, 1024, 1, 1, true, true, true, true)
ON CONFLICT (name) DO NOTHING;

UPDATE customers
SET service_plan_id = (
  SELECT id FROM customer_service_plans WHERE name = 'Standard' LIMIT 1
)
WHERE service_plan_id IS NULL;

UPDATE modules
SET version = '0.26.0',
    status = 'active',
    description = 'Tenant service plans, quotas, extension ranges and customer-safe PBX self-service.',
    installed_at = COALESCE(installed_at, now()),
    updated_at = now()
WHERE module_key = 'pbx-core';

UPDATE modules
SET version = '0.26.0',
    updated_at = now()
WHERE module_key = 'billing';

INSERT INTO schema_migrations(version)
VALUES ('031_customer_service_plans')
ON CONFLICT (version) DO NOTHING;

COMMIT;
