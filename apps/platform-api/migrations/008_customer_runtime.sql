-- Customer identity, logical Agent instances, richer tasks and notification governance.

CREATE TABLE platform_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  password_hash text,
  platform_role text CHECK (platform_role IS NULL OR platform_role='platform_admin'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  email_verified boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_users(id,email,display_name,email_verified,platform_role)
VALUES('local-admin','local-admin@localhost','本地平台管理员',true,'platform_admin')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions(user_id,expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE oidc_login_states (
  state_hash text PRIMARY KEY,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_exchange_codes (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents
  ADD COLUMN routing_strategy text NOT NULL DEFAULT 'weighted_round_robin'
    CHECK (routing_strategy IN ('weighted_round_robin','least_connections','priority'));

CREATE TABLE agent_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  card_url text NOT NULL,
  selected_interface jsonb NOT NULL,
  weight integer NOT NULL DEFAULT 100 CHECK (weight BETWEEN 1 AND 10000),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draining','disabled')),
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','unhealthy')),
  active_requests integer NOT NULL DEFAULT 0 CHECK (active_requests >= 0),
  credential_ciphertext text,
  credential_iv text,
  credential_tag text,
  credential_key_version text,
  last_health_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id,name)
);
CREATE INDEX agent_instances_routing_idx
  ON agent_instances(agent_id,status,health_status,priority,active_requests);

ALTER TABLE usage_records
  ADD COLUMN agent_instance_id uuid REFERENCES agent_instances(id) ON DELETE SET NULL;
ALTER TABLE task_snapshots
  ADD COLUMN agent_instance_id uuid REFERENCES agent_instances(id) ON DELETE SET NULL;

INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status)
SELECT id,'default',card_url,selected_interface,
  CASE WHEN status IN ('online','degraded') THEN 'active' ELSE 'disabled' END,
  health_status
FROM agents
ON CONFLICT(agent_id,name) DO NOTHING;

ALTER TABLE agent_health_checks
  ADD COLUMN instance_id uuid REFERENCES agent_instances(id) ON DELETE SET NULL,
  ADD COLUMN check_type text NOT NULL DEFAULT 'card' CHECK (check_type IN ('card','a2a'));
CREATE INDEX agent_health_checks_instance_checked_idx
  ON agent_health_checks(instance_id,checked_at DESC);

ALTER TABLE task_snapshots
  ADD COLUMN request_payload jsonb,
  ADD COLUMN artifacts jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE api_key_agent_grants (
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(api_key_id,agent_id)
);

CREATE TABLE notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('webhook','email')),
  destination text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name)
);

ALTER TABLE notification_records
  ADD COLUMN channel_id uuid REFERENCES notification_channels(id) ON DELETE SET NULL,
  ADD COLUMN event_type text,
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE tenants
  ADD COLUMN data_retention_days integer NOT NULL DEFAULT 90 CHECK (data_retention_days BETWEEN 7 AND 3650);

INSERT INTO platform_settings(key,value,description,updated_by) VALUES
  ('retention.defaultDays','90','默认运行数据保留天数','migration'),
  ('auth.localLoginEnabled','false','是否允许账号密码登录','migration'),
  ('notifications.emailEnabled','false','是否启用 SMTP 邮件通知','migration')
ON CONFLICT (key) DO NOTHING;
