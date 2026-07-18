BEGIN;

ALTER TABLE ai_receptionists
  DROP CONSTRAINT IF EXISTS ai_receptionists_provider_valid,
  DROP CONSTRAINT IF EXISTS ai_receptionists_model_valid,
  DROP CONSTRAINT IF EXISTS ai_receptionists_voice_valid,
  DROP CONSTRAINT IF EXISTS ai_receptionists_external_agent_valid;

ALTER TABLE ai_receptionists
  ADD COLUMN IF NOT EXISTS external_agent_id text,
  ADD CONSTRAINT ai_receptionists_provider_valid
    CHECK (provider IN ('openai', 'google', 'elevenlabs')),
  ADD CONSTRAINT ai_receptionists_model_valid
    CHECK (
      (provider = 'openai' AND model = 'gpt-realtime-2.1') OR
      (provider = 'google' AND model = 'gemini-3.5-flash') OR
      (provider = 'elevenlabs' AND model = 'eleven_agents')
    ),
  ADD CONSTRAINT ai_receptionists_voice_valid
    CHECK (voice ~ '^[A-Za-z0-9_-]{2,128}$'),
  ADD CONSTRAINT ai_receptionists_external_agent_valid
    CHECK (
      (provider IN ('openai', 'google') AND external_agent_id IS NULL) OR
      (provider = 'elevenlabs' AND external_agent_id ~ '^[A-Za-z0-9_-]{8,128}$')
    );

UPDATE modules
SET status = 'active',
    version = '0.10.1',
    description = 'Provider-selectable Google or ElevenLabs voice agents with local disclosure, private bounded sessions and human handoff.',
    updated_at = now()
WHERE module_key = 'ai-receptionist';

INSERT INTO schema_migrations(version)
VALUES ('012_ai_receptionist_engines')
ON CONFLICT (version) DO NOTHING;

COMMIT;
