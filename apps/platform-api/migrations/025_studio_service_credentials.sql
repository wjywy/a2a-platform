-- Agent Studio must be usable after login without exposing a tenant API key
-- to browser JavaScript.  The actual secret is AES-GCM encrypted by the API
-- process; api_keys keeps only its normal one-way hash.
CREATE TABLE studio_service_credentials (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL UNIQUE REFERENCES api_keys(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  secret_iv text NOT NULL,
  secret_tag text NOT NULL,
  secret_key_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX studio_service_credentials_api_key_id_idx
  ON studio_service_credentials(api_key_id);
