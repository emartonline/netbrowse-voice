BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS extension_id uuid REFERENCES extensions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS users_agent_extension_unique
  ON users(extension_id)
  WHERE extension_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_valid' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_valid
      CHECK (role IN ('owner', 'administrator', 'agent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_agent_extension_required' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_agent_extension_required
      CHECK (role <> 'agent' OR extension_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_role_active_idx
  ON users(role, active);

UPDATE modules
SET version = '0.14.0',
    description = 'Asterisk-native queues, live supervision, persistent agent states and restricted agent workspaces.',
    updated_at = now()
WHERE module_key = 'call-centre';

INSERT INTO schema_migrations(version)
VALUES ('017_agent_workspace')
ON CONFLICT (version) DO NOTHING;

COMMIT;
