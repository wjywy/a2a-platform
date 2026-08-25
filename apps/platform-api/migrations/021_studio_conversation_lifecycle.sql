-- Conversation lifecycle records make studio chat management durable and auditable.
-- They deliberately live in the platform database rather than browser storage so a
-- user can reopen a conversation from another device without exposing an API key.
CREATE TABLE studio_message_revisions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES studio_messages(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  content text NOT NULL CHECK (length(content) <= 50000),
  edited_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, revision)
);
CREATE INDEX studio_message_revisions_message_idx
  ON studio_message_revisions(message_id, revision DESC);

CREATE TABLE studio_conversation_events (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'conversation_created', 'conversation_renamed', 'conversation_archived',
    'conversation_restored', 'conversation_deleted', 'conversation_forked',
    'message_created', 'message_updated', 'message_retried', 'message_cancelled', 'conversation_labeled',
    'feedback_recorded'
  )),
  message_id uuid REFERENCES studio_messages(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_conversation_events_conversation_idx
  ON studio_conversation_events(conversation_id, created_at DESC);
CREATE INDEX studio_conversation_events_tenant_idx
  ON studio_conversation_events(tenant_id, created_at DESC);

CREATE TABLE studio_message_feedback (
  message_id uuid PRIMARY KEY REFERENCES studio_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  note text CHECK (length(note) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_message_feedback_conversation_idx
  ON studio_message_feedback(conversation_id, updated_at DESC);
