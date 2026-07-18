BEGIN;

CREATE TABLE IF NOT EXISTS call_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  extension_number text NOT NULL UNIQUE,
  group_type text NOT NULL DEFAULT 'queue',
  strategy text NOT NULL DEFAULT 'ringall',
  ring_timeout_seconds integer NOT NULL DEFAULT 15,
  retry_seconds integer NOT NULL DEFAULT 5,
  max_wait_seconds integer NOT NULL DEFAULT 60,
  wrapup_seconds integer NOT NULL DEFAULT 5,
  fallback_extension_id uuid REFERENCES extensions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_groups_name_valid CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT call_groups_extension_valid CHECK (extension_number ~ '^[0-9]{2,8}$'),
  CONSTRAINT call_groups_type_valid CHECK (group_type IN ('ring_group', 'queue')),
  CONSTRAINT call_groups_strategy_valid CHECK (strategy IN ('ringall', 'rrmemory', 'leastrecent')),
  CONSTRAINT call_groups_ring_timeout_valid CHECK (ring_timeout_seconds BETWEEN 5 AND 60),
  CONSTRAINT call_groups_retry_valid CHECK (retry_seconds BETWEEN 1 AND 30),
  CONSTRAINT call_groups_max_wait_valid CHECK (max_wait_seconds BETWEEN 10 AND 600),
  CONSTRAINT call_groups_wrapup_valid CHECK (wrapup_seconds BETWEEN 0 AND 120)
);

CREATE TABLE IF NOT EXISTS call_group_members (
  call_group_id uuid NOT NULL REFERENCES call_groups(id) ON DELETE CASCADE,
  extension_id uuid NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_group_id, extension_id),
  CONSTRAINT call_group_members_position_valid CHECK (position BETWEEN 0 AND 49)
);

CREATE INDEX IF NOT EXISTS call_group_members_extension_idx
  ON call_group_members(extension_id);

ALTER TABLE ai_receptionists
  ADD COLUMN IF NOT EXISTS handoff_destination_type text NOT NULL DEFAULT 'extension';

ALTER TABLE ai_receptionists
  ADD COLUMN IF NOT EXISTS handoff_call_group_id uuid
    REFERENCES call_groups(id) ON DELETE RESTRICT;

ALTER TABLE ai_receptionists
  DROP CONSTRAINT IF EXISTS ai_receptionists_handoff_destination_valid;

ALTER TABLE ai_receptionists
  ADD CONSTRAINT ai_receptionists_handoff_destination_valid CHECK (
    (handoff_destination_type = 'extension' AND handoff_call_group_id IS NULL)
    OR
    (handoff_destination_type = 'call_group' AND handoff_extension_id IS NULL)
  );

INSERT INTO modules
  (module_key, name, version, status, description, sort_order, installed_at)
VALUES
  ('call-centre', 'Call Centre Core', '0.12.0', 'active',
   'Asterisk-native ring groups, queues, live member readiness and AI handoff destinations.',
   35, now())
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  version = EXCLUDED.version,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  installed_at = COALESCE(modules.installed_at, EXCLUDED.installed_at),
  updated_at = now();

INSERT INTO schema_migrations(version)
VALUES ('015_call_centre_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
