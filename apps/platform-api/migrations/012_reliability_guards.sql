-- Crash-safe ownership for durable notification delivery.
ALTER TABLE notification_records
  ADD COLUMN delivery_owner text,
  ADD COLUMN delivery_lease_until timestamptz;

CREATE INDEX notification_records_delivery_lease_idx
  ON notification_records(status,delivery_lease_until)
  WHERE status='delivering';

-- External identities are never linked to privileged local accounts by email alone.
CREATE TABLE external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id text NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  PRIMARY KEY(issuer,subject),
  UNIQUE(user_id,issuer)
);

-- The migration runner encrypts every legacy secret before this migration is recorded.
ALTER TABLE webhook_endpoints DROP CONSTRAINT webhook_secret_material_check;
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_secret_material_check CHECK (
  signing_secret IS NULL AND secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL
  AND secret_tag IS NOT NULL AND secret_key_version IS NOT NULL
);

-- Task IDs are scoped by tenant for shared/public Agent instances.
ALTER TABLE task_snapshots DROP CONSTRAINT task_snapshots_agent_id_remote_task_id_key;
ALTER TABLE task_snapshots ADD CONSTRAINT task_snapshots_tenant_agent_remote_task_key
  UNIQUE NULLS NOT DISTINCT(tenant_id,agent_id,remote_task_id);

-- Expiring leases make least-connections routing self-healing after process crashes.
CREATE TABLE agent_instance_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_instance_leases_active_idx ON agent_instance_leases(instance_id,expires_at)
  WHERE released_at IS NULL;
