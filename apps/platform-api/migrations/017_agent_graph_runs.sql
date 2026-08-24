CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_slug text NOT NULL,
  a2a_task_id uuid NOT NULL,
  graph_thread_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('queued','running','input_required','completed','failed','cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, agent_slug, a2a_task_id)
);
CREATE INDEX agent_runs_tenant_updated_idx ON agent_runs(tenant_id,updated_at DESC);

CREATE TABLE agent_run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  node text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('node_started','node_completed','tool','interrupt','error','final')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,sequence)
);
CREATE INDEX agent_run_events_run_sequence_idx ON agent_run_events(run_id,sequence);
