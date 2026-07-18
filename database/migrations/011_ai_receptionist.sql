BEGIN;

CREATE TABLE IF NOT EXISTS ai_receptionists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  extension_number text NOT NULL UNIQUE,
  greeting_sound_asset_id uuid NOT NULL
    REFERENCES sound_assets(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'google',
  model text NOT NULL DEFAULT 'gemini-3.5-flash',
  voice text NOT NULL DEFAULT 'Kore',
  system_prompt text NOT NULL,
  knowledge_base text NOT NULL DEFAULT '',
  handoff_extension_id uuid
    REFERENCES extensions(id) ON DELETE RESTRICT,
  max_turns integer NOT NULL DEFAULT 4,
  listen_timeout_seconds integer NOT NULL DEFAULT 12,
  store_transcripts boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_receptionists_name_valid
    CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT ai_receptionists_extension_valid
    CHECK (extension_number ~ '^[0-9]{2,8}$'),
  CONSTRAINT ai_receptionists_provider_valid
    CHECK (provider = 'google'),
  CONSTRAINT ai_receptionists_model_valid
    CHECK (model = 'gemini-3.5-flash'),
  CONSTRAINT ai_receptionists_voice_valid
    CHECK (voice ~ '^[A-Za-z][A-Za-z0-9_-]{1,63}$'),
  CONSTRAINT ai_receptionists_prompt_valid
    CHECK (char_length(system_prompt) BETWEEN 20 AND 4000),
  CONSTRAINT ai_receptionists_knowledge_valid
    CHECK (char_length(knowledge_base) <= 12000),
  CONSTRAINT ai_receptionists_turns_valid
    CHECK (max_turns BETWEEN 1 AND 6),
  CONSTRAINT ai_receptionists_timeout_valid
    CHECK (listen_timeout_seconds BETWEEN 3 AND 30)
);

CREATE TABLE IF NOT EXISTS ai_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_receptionists(id) ON DELETE RESTRICT,
  caller_number text,
  channel_id text,
  status text NOT NULL DEFAULT 'in_progress',
  turn_count integer NOT NULL DEFAULT 0,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_code text,
  CONSTRAINT ai_call_sessions_status_valid
    CHECK (status IN ('in_progress', 'completed', 'transferred', 'failed', 'no_input')),
  CONSTRAINT ai_call_sessions_turn_count_valid
    CHECK (turn_count BETWEEN 0 AND 6),
  CONSTRAINT ai_call_sessions_transcript_valid
    CHECK (jsonb_typeof(transcript) = 'array')
);

CREATE INDEX IF NOT EXISTS ai_call_sessions_agent_started_idx
  ON ai_call_sessions(agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_sessions_started_idx
  ON ai_call_sessions(started_at DESC);

UPDATE modules
SET status = 'active',
    version = '0.10.0',
    description = 'Turn-based Google AI call handling with disclosure, business knowledge, private sessions and human handoff.',
    updated_at = now()
WHERE module_key = 'ai-receptionist';

INSERT INTO schema_migrations(version)
VALUES ('011_ai_receptionist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
