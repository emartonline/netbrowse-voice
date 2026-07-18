BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'administrator',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modules (
  module_key text PRIMARY KEY,
  name text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  description text NOT NULL DEFAULT '',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  installed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modules_status_valid
    CHECK (status IN ('active', 'disabled', 'planned', 'incompatible'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action);

INSERT INTO modules
  (module_key, name, version, status, description, sort_order, installed_at)
VALUES
  ('pbx-core', 'PBX Core', '0.1.0', 'active',
   'Asterisk control, extensions, trunks, routing and shared platform services.', 10, now()),
  ('sound-studio', 'Sound Studio', '0.1.0', 'planned',
   'AI-generated announcements, pronunciation control and Asterisk audio conversion.', 20, null),
  ('ai-receptionist', 'AI Receptionist', '0.1.0', 'planned',
   'Conversational inbound call handling, business tools and human handoff.', 30, null),
  ('campaigns', 'Campaigns', '0.1.0', 'planned',
   'Human and AI outbound campaigns with compliant list and pacing controls.', 40, null),
  ('billing', 'Billing', '0.1.0', 'planned',
   'Rate decks, wallets, live charging, invoices and reseller margins.', 50, null)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO schema_migrations(version)
VALUES ('001_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
