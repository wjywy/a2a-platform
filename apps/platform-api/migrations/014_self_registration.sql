-- Self-service customer registration with cross-instance abuse protection.
CREATE TABLE auth_registration_limits (
  subject_type text NOT NULL CHECK(subject_type IN ('email','ip')),
  subject_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_hash)
);
INSERT INTO platform_settings(key,value,description,updated_by)
VALUES('auth.selfRegistrationEnabled','true','是否允许外部用户自助注册','migration')
ON CONFLICT (key) DO NOTHING;
