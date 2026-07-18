BEGIN;

ALTER TABLE ai_receptionists
  ADD COLUMN IF NOT EXISTS disclosure_asterisk_name text;

ALTER TABLE ai_receptionists
  DROP CONSTRAINT IF EXISTS ai_receptionists_disclosure_name_valid;

ALTER TABLE ai_receptionists
  ADD CONSTRAINT ai_receptionists_disclosure_name_valid
    CHECK (
      disclosure_asterisk_name IS NULL OR
      disclosure_asterisk_name ~ '^netbrowse/nbvs-ai-disclosure-[0-9a-f]{8}$'
    );

UPDATE modules
SET version = '0.11.0',
    description = 'OpenAI Realtime streaming with natural protected disclosure, Google and ElevenLabs alternatives, private sessions and human handoff.',
    updated_at = now()
WHERE module_key = 'ai-receptionist';

INSERT INTO schema_migrations(version)
VALUES ('014_natural_ai_disclosures')
ON CONFLICT (version) DO NOTHING;

COMMIT;
