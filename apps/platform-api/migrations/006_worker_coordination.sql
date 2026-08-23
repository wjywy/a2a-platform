-- Guarantee one unresolved alert per rule even if an operator temporarily runs
-- mixed worker versions during a rolling deployment.
WITH duplicates AS (
  SELECT id,
    row_number() OVER (PARTITION BY rule_id ORDER BY opened_at DESC, id DESC) AS position
  FROM alert_events
  WHERE status <> 'resolved'
)
UPDATE alert_events
SET status='resolved', resolved_at=COALESCE(resolved_at,now()), updated_at=now()
WHERE id IN (SELECT id FROM duplicates WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS alert_events_one_active_per_rule_idx
  ON alert_events(rule_id)
  WHERE status <> 'resolved';

CREATE TABLE IF NOT EXISTS quota_counters (
  subject_type text NOT NULL CHECK(subject_type IN ('tenant','api_key','agent')),
  subject_id uuid NOT NULL,
  quota_window text NOT NULL CHECK(quota_window IN ('minute','day','month','concurrent')),
  window_start timestamptz NOT NULL,
  count bigint NOT NULL DEFAULT 0 CHECK(count >= 0),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_id,quota_window,window_start)
);

CREATE INDEX IF NOT EXISTS quota_counters_expiry_idx ON quota_counters(expires_at);
