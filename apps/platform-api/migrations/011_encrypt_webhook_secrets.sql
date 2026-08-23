-- Webhook signing secrets must not remain readable in a database snapshot.
ALTER TABLE webhook_endpoints
  ALTER COLUMN signing_secret DROP NOT NULL,
  ADD COLUMN secret_ciphertext text,
  ADD COLUMN secret_iv text,
  ADD COLUMN secret_tag text,
  ADD COLUMN secret_key_version text;

ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_secret_material_check CHECK (
  (signing_secret IS NOT NULL) OR
  (secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL AND secret_tag IS NOT NULL AND secret_key_version IS NOT NULL)
);
