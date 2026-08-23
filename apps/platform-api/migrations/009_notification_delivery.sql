-- Durable notification delivery and worker liveness.
ALTER TABLE notification_channels
  ADD COLUMN secret_ciphertext text,
  ADD COLUMN secret_iv text,
  ADD COLUMN secret_tag text,
  ADD COLUMN secret_key_version text,
  ADD COLUMN last_delivery_at timestamptz;

ALTER TABLE notification_records
  ADD COLUMN attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN response_status integer,
  ADD COLUMN response_body text,
  ADD COLUMN delivered_at timestamptz;

ALTER TABLE notification_records DROP CONSTRAINT notification_records_status_check;
ALTER TABLE notification_records ADD CONSTRAINT notification_records_status_check
  CHECK (status IN ('pending','delivering','retrying','sent','failed','suppressed'));

CREATE INDEX notification_records_pending_idx
  ON notification_records(status,next_attempt_at,created_at)
  WHERE status IN ('pending','retrying');
CREATE INDEX notification_records_tenant_idx
  ON notification_records(tenant_id,created_at DESC);

CREATE TABLE worker_heartbeats (
  worker_name text PRIMARY KEY,
  instance_id text NOT NULL,
  last_started_at timestamptz NOT NULL DEFAULT now(),
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
