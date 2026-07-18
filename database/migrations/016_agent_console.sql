BEGIN;

CREATE TABLE IF NOT EXISTS call_group_agent_states (
  call_group_id uuid NOT NULL,
  extension_id uuid NOT NULL,
  signed_in boolean NOT NULL DEFAULT true,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_group_id, extension_id),
  FOREIGN KEY (call_group_id, extension_id)
    REFERENCES call_group_members(call_group_id, extension_id)
    ON DELETE CASCADE,
  CONSTRAINT call_group_agent_state_coherent CHECK (signed_in OR NOT paused),
  CONSTRAINT call_group_agent_pause_reason_valid CHECK (
    pause_reason IS NULL OR pause_reason IN ('break', 'lunch', 'training', 'admin')
  )
);

INSERT INTO call_group_agent_states (call_group_id, extension_id)
SELECT call_group_id, extension_id
FROM call_group_members
ON CONFLICT (call_group_id, extension_id) DO NOTHING;

UPDATE modules
SET version = '0.13.0',
    description = 'Asterisk-native ring groups, queues, live supervision, persistent agent sign-in and pause controls.',
    updated_at = now()
WHERE module_key = 'call-centre';

INSERT INTO schema_migrations(version)
VALUES ('016_agent_console')
ON CONFLICT (version) DO NOTHING;

COMMIT;
