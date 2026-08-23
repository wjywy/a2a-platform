-- Keep public-registration abuse protection bounded during long-running deployments.
CREATE INDEX auth_registration_limits_updated_at_idx
ON auth_registration_limits(updated_at);
