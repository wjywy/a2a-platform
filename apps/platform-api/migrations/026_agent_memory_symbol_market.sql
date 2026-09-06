-- Agent policies, scoped memory, Longbridge credentials and resumable Symbol evidence.

CREATE TABLE IF NOT EXISTS agent_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  response_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  memory_enabled boolean NOT NULL DEFAULT true,
  memory_read_scopes text[] NOT NULL DEFAULT ARRAY['conversation']::text[],
  memory_write_scopes text[] NOT NULL DEFAULT ARRAY['conversation']::text[],
  memory_categories text[] NOT NULL DEFAULT ARRAY['fact','correction','constraint','open_question','summary']::text[],
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  max_entries integer NOT NULL DEFAULT 40 CHECK (max_entries BETWEEN 1 AND 1000),
  max_context_chars integer NOT NULL DEFAULT 12000 CHECK (max_context_chars BETWEEN 1000 AND 100000),
  allow_user_control boolean NOT NULL DEFAULT true,
  allow_cross_conversation boolean NOT NULL DEFAULT false,
  allow_cross_agent boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (memory_read_scopes <@ ARRAY['conversation','user','agent','tenant']::text[]),
  CHECK (memory_write_scopes <@ ARRAY['conversation','user','agent','tenant']::text[]),
  CHECK (memory_categories <@ ARRAY['fact','preference','correction','constraint','open_question','summary','answer']::text[]),
  CHECK (memory_write_scopes <@ memory_read_scopes)
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('conversation','user','agent','tenant')),
  subject_type text NOT NULL CHECK (subject_type IN ('conversation','user','agent','api_key','tenant')),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 256),
  category text NOT NULL CHECK (category IN ('fact','preference','correction','constraint','open_question','summary','answer')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  source_conversation_id uuid,
  source_message_id text,
  source_kind text NOT NULL DEFAULT 'agent',
  confidence numeric(5,4) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  superseded_by uuid REFERENCES agent_memories(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (redacted_at IS NULL OR deleted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS agent_memories_scope_lookup_idx
  ON agent_memories(tenant_id,agent_id,scope,subject_id,updated_at DESC)
  WHERE deleted_at IS NULL AND redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_memories_expiry_idx
  ON agent_memories(expires_at)
  WHERE deleted_at IS NULL AND redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_memories_source_conversation_idx
  ON agent_memories(source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_data_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('longbridge')),
  secret_ciphertext text NOT NULL,
  secret_iv text NOT NULL,
  secret_tag text NOT NULL,
  secret_key_version text NOT NULL,
  credential_status text NOT NULL DEFAULT 'configured' CHECK (credential_status IN ('configured','invalid','expired','disabled')),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,provider)
);

ALTER TABLE symbol_conversations
  ADD COLUMN IF NOT EXISTS memory_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS memory_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stream_state jsonb NOT NULL DEFAULT '{}'::jsonb;
