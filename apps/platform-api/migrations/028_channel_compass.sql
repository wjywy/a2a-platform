CREATE TABLE channel_compass_tasks (
  task_id uuid PRIMARY KEY,
  context_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('collecting','completed','failed','cancelled')),
  user_message text NOT NULL,
  intent jsonb NOT NULL DEFAULT '{}'::jsonb,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX channel_compass_tasks_tenant_updated_idx
  ON channel_compass_tasks(tenant_id,updated_at DESC);
CREATE INDEX channel_compass_tasks_context_idx
  ON channel_compass_tasks(context_id,tenant_id,updated_at DESC);
CREATE INDEX channel_compass_tasks_expires_idx
  ON channel_compass_tasks(expires_at);

CREATE TABLE channel_compass_visualizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES channel_compass_tasks(task_id) ON DELETE CASCADE,
  title text NOT NULL,
  chart_spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX channel_compass_visualizations_expires_idx
  ON channel_compass_visualizations(expires_at);
