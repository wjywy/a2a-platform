ALTER TABLE tenants
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN minute_request_limit integer NOT NULL DEFAULT 120 CHECK (minute_request_limit > 0),
  ADD COLUMN daily_request_limit integer NOT NULL DEFAULT 5000 CHECK (daily_request_limit > 0),
  ADD COLUMN concurrent_request_limit integer NOT NULL DEFAULT 20 CHECK (concurrent_request_limit > 0),
  ADD COLUMN warning_threshold_percent integer NOT NULL DEFAULT 80 CHECK (warning_threshold_percent BETWEEN 1 AND 100),
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE tenant_members
  ADD COLUMN display_name text NOT NULL DEFAULT '',
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN disabled_at timestamptz;

CREATE UNIQUE INDEX tenant_members_tenant_user_unique
  ON tenant_members(tenant_id, user_id)
  WHERE status = 'active';

CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('tenant_admin','developer','viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_invitations_tenant_created_idx
  ON tenant_invitations(tenant_id, created_at DESC);

ALTER TABLE api_keys
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN minute_request_limit integer,
  ADD COLUMN daily_request_limit integer,
  ADD COLUMN monthly_request_limit integer,
  ADD COLUMN concurrent_request_limit integer,
  ADD COLUMN created_by text NOT NULL DEFAULT 'system';
CREATE UNIQUE INDEX api_keys_secret_hash_unique ON api_keys(secret_hash);
CREATE INDEX api_keys_active_lookup_idx ON api_keys(secret_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE usage_records
  ADD COLUMN api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  ADD COLUMN caller_id text,
  ADD COLUMN input_bytes integer NOT NULL DEFAULT 0 CHECK (input_bytes >= 0),
  ADD COLUMN output_bytes integer NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
  ADD COLUMN event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  ADD COLUMN error_code text,
  ADD COLUMN error_message text,
  ADD COLUMN remote_task_id text;
CREATE INDEX usage_records_key_created_idx ON usage_records(api_key_id, created_at DESC);
CREATE INDEX usage_records_agent_created_idx ON usage_records(agent_id, created_at DESC);
CREATE INDEX usage_records_status_created_idx ON usage_records(status_code, created_at DESC);

ALTER TABLE agents
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN allowed_tenant_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN deleted_at timestamptz;
CREATE INDEX agents_status_updated_idx ON agents(status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE agent_card_revisions (
  id bigserial PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  card_snapshot jsonb NOT NULL,
  selected_interface jsonb NOT NULL,
  change_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_by text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, version)
);
CREATE INDEX agent_card_revisions_agent_fetched_idx
  ON agent_card_revisions(agent_id, fetched_at DESC);

ALTER TABLE task_snapshots
  ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  ADD COLUMN request_id text,
  ADD COLUMN operation text NOT NULL DEFAULT 'message.stream',
  ADD COLUMN status_code integer,
  ADD COLUMN error_code text,
  ADD COLUMN error_message text,
  ADD COLUMN started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN duration_ms integer,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN cancelled_at timestamptz;
CREATE INDEX task_snapshots_tenant_updated_idx ON task_snapshots(tenant_id, updated_at DESC);
CREATE INDEX task_snapshots_state_updated_idx ON task_snapshots(state, updated_at DESC);

CREATE TABLE task_events (
  id bigserial PRIMARY KEY,
  task_snapshot_id bigint NOT NULL REFERENCES task_snapshots(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  state text,
  payload jsonb NOT NULL,
  payload_bytes integer NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_snapshot_id, sequence)
);
CREATE INDEX task_events_snapshot_sequence_idx ON task_events(task_snapshot_id, sequence);

ALTER TABLE audit_logs
  ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN resource_type text,
  ADD COLUMN resource_id text,
  ADD COLUMN ip_address inet,
  ADD COLUMN user_agent text,
  ADD COLUMN outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','failure'));
CREATE INDEX audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX audit_logs_action_created_idx ON audit_logs(action, created_at DESC);

ALTER TABLE webhook_endpoints
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN timeout_ms integer NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 500 AND 30000),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 12),
  ADD COLUMN last_delivery_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','succeeded','retrying','dead_letter')),
  response_status integer,
  response_body text,
  error_message text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(webhook_id, event_id)
);
CREATE INDEX webhook_deliveries_pending_idx
  ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending','retrying');
CREATE INDEX webhook_deliveries_webhook_created_idx
  ON webhook_deliveries(webhook_id, created_at DESC);

ALTER TABLE alert_rules
  DROP CONSTRAINT alert_rules_metric_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_metric_check
  CHECK (metric IN ('agent_unhealthy','request_error_rate','latency_ms','quota_usage_percent'));
ALTER TABLE alert_rules
  ADD COLUMN severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
  ADD COLUMN cooldown_minutes integer NOT NULL DEFAULT 15 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
  ADD COLUMN updated_by text NOT NULL DEFAULT 'system';

ALTER TABLE alert_events
  DROP CONSTRAINT alert_events_status_check;
ALTER TABLE alert_events
  ADD CONSTRAINT alert_events_status_check
  CHECK (status IN ('open','acknowledged','silenced','resolved'));
ALTER TABLE alert_events
  ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  ADD COLUMN acknowledged_by text,
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN silenced_until timestamptz,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX alert_events_tenant_opened_idx ON alert_events(tenant_id, opened_at DESC);

CREATE TABLE notification_records (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  alert_event_id bigint REFERENCES alert_events(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('console','webhook','email')),
  destination text,
  status text NOT NULL CHECK (status IN ('pending','sent','failed','suppressed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_records_tenant_created_idx
  ON notification_records(tenant_id, created_at DESC);

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  sensitive boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings(key, value, description, updated_by) VALUES
  ('gateway.defaultTimeoutMs', '60000', '平台代理默认远程调用超时', 'migration'),
  ('health.intervalSeconds', '30', 'Agent 健康检查间隔', 'migration'),
  ('webhook.defaultMaxAttempts', '5', 'Webhook 默认最大投递次数', 'migration')
ON CONFLICT (key) DO NOTHING;
