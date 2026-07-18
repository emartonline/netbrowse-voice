BEGIN;

ALTER TABLE ai_receptionists
  DROP CONSTRAINT IF EXISTS ai_receptionists_turns_valid;

ALTER TABLE ai_receptionists
  ADD CONSTRAINT ai_receptionists_turns_valid
    CHECK (max_turns BETWEEN 1 AND 100);

ALTER TABLE ai_call_sessions
  DROP CONSTRAINT IF EXISTS ai_call_sessions_turn_count_valid;

ALTER TABLE ai_call_sessions
  ADD CONSTRAINT ai_call_sessions_turn_count_valid
    CHECK (turn_count BETWEEN 0 AND 100);

UPDATE modules
SET version = '0.32.1',
    description = 'OpenAI, Google and ElevenLabs voice receptionists with up to 100 turns, private sessions and seamless queue handoff music.',
    updated_at = now()
WHERE module_key = 'ai-receptionist';

INSERT INTO schema_migrations(version)
VALUES ('038_ai_queue_handoff_and_turns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
