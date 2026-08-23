-- Shared, fail-closed login throttling across API replicas.
CREATE TABLE IF NOT EXISTS auth_login_limits (
  subject_type text NOT NULL CHECK(subject_type IN ('email','ip')),
  subject_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_hash)
);
