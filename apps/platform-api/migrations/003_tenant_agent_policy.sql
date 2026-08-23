ALTER TABLE agents ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'tenant', 'public'));
ALTER TABLE agents ADD COLUMN invocation_policy jsonb NOT NULL DEFAULT '{"timeoutMs":60000,"maxRetries":0,"maxConcurrent":20}'::jsonb;
CREATE INDEX agents_tenant_id_idx ON agents(tenant_id);

CREATE TABLE tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('tenant_admin','developer','viewer')),
  status text NOT NULL CHECK (status IN ('active','invited','disabled')) DEFAULT 'invited',
  invited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);
CREATE INDEX tenant_members_tenant_id_idx ON tenant_members(tenant_id);
