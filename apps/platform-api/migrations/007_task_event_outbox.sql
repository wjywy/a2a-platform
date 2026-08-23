CREATE TABLE task_event_outbox (
  id bigserial PRIMARY KEY,
  task_snapshot_id bigint NOT NULL REFERENCES task_snapshots(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  remote_task_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN (
    'task.created','task.working','task.completed','task.failed'
  )),
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','processing','dispatched','dead_letter'
  )),
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_event_outbox_pending_idx
  ON task_event_outbox(available_at,id)
  WHERE status IN ('pending','processing');
