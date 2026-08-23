CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL,
  card_url text NOT NULL,
  card_snapshot jsonb NOT NULL,
  selected_interface jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'offline', 'online', 'degraded')) DEFAULT 'offline',
  health_status text NOT NULL CHECK (health_status IN ('unknown', 'healthy', 'unhealthy')) DEFAULT 'unknown',
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_health_checks (
  id bigserial PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL,
  latency_ms integer,
  error_message text
);
CREATE INDEX agent_health_checks_agent_id_checked_at_idx ON agent_health_checks(agent_id, checked_at DESC);

CREATE TABLE task_snapshots (
  id bigserial PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  remote_task_id text NOT NULL,
  context_id text,
  state text,
  latest_event jsonb NOT NULL,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, remote_task_id)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  request_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_agent_id_created_at_idx ON audit_logs(agent_id, created_at DESC);
