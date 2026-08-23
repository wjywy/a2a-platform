CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  monthly_request_limit integer NOT NULL DEFAULT 10000 CHECK (monthly_request_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  secret_hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["agent:invoke"]'::jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_id_idx ON api_keys(tenant_id);

CREATE TABLE usage_records (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  operation text NOT NULL,
  status_code integer NOT NULL,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_records_tenant_created_at_idx ON usage_records(tenant_id, created_at DESC);

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_url text NOT NULL,
  signing_secret text NOT NULL,
  events jsonb NOT NULL DEFAULT '["task.completed","task.failed"]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('agent_unhealthy','request_error_rate','latency_ms')),
  operator text NOT NULL CHECK (operator IN ('gt','lt')),
  threshold numeric NOT NULL,
  window_minutes integer NOT NULL DEFAULT 5 CHECK (window_minutes BETWEEN 1 AND 1440),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
  id bigserial PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('open','resolved')) DEFAULT 'open',
  value numeric NOT NULL,
  message text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX alert_events_rule_status_idx ON alert_events(rule_id, status, opened_at DESC);
