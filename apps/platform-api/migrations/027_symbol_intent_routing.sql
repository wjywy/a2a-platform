-- Structured intent routing trace. Existing Symbol conversations remain readable.
ALTER TABLE symbol_conversations
  ADD COLUMN IF NOT EXISTS routing_trace jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE symbol_conversations
  ADD COLUMN IF NOT EXISTS active_intent jsonb,
  ADD COLUMN IF NOT EXISTS clarification_history jsonb NOT NULL DEFAULT '[]'::jsonb;
