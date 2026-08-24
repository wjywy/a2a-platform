-- Durable conversational state for the bundled A2A symbol agents.
-- PostgreSQL is authoritative; Redis only accelerates short-lived reads.
CREATE TABLE symbol_conversations (
  task_id uuid PRIMARY KEY,
  context_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_slug text NOT NULL CHECK (agent_slug ~ '^symbol-[a-z0-9-]+$'),
  state text NOT NULL CHECK (state IN ('collecting','completed','failed','cancelled')),
  user_message text NOT NULL,
  intent jsonb NOT NULL DEFAULT '{}'::jsonb,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX symbol_conversations_tenant_agent_updated_idx
  ON symbol_conversations(tenant_id,agent_slug,updated_at DESC);
CREATE INDEX symbol_conversations_expires_idx
  ON symbol_conversations(expires_at);
