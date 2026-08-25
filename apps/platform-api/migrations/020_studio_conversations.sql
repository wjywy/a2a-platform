-- Generic Agent Studio conversations are independent of an A2A task so that
-- every registered Agent can have durable, user-managed chat history.
CREATE TABLE studio_conversations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_slug text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  last_task_id text,
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at timestamptz,
  archived_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_conversations_tenant_agent_status_updated_idx
  ON studio_conversations(tenant_id, agent_slug, status, updated_at DESC);
CREATE INDEX studio_conversations_tenant_search_idx
  ON studio_conversations(tenant_id, updated_at DESC);

CREATE TABLE studio_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL CHECK (length(content) <= 50000),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','streaming','completed','failed','cancelled')),
  task_id text,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, sequence)
);
CREATE INDEX studio_messages_conversation_sequence_idx
  ON studio_messages(conversation_id, sequence);
CREATE INDEX studio_messages_task_idx ON studio_messages(task_id) WHERE task_id IS NOT NULL;
