-- Conversation titles and archive state support the Agent Studio history.
ALTER TABLE symbol_conversations
  ADD COLUMN title text,
  ADD COLUMN archived_at timestamptz;

UPDATE symbol_conversations
SET title = left(regexp_replace(user_message, '\\s+', ' ', 'g'), 96)
WHERE title IS NULL;

ALTER TABLE symbol_conversations
  ALTER COLUMN title SET NOT NULL;

CREATE INDEX symbol_conversations_history_idx
  ON symbol_conversations(tenant_id, agent_slug, archived_at, updated_at DESC);
