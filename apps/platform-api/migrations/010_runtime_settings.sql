-- Make the development default usable while retaining the environment variable as a hard production gate.
UPDATE platform_settings
SET value='true'::jsonb, updated_at=now()
WHERE key='auth.localLoginEnabled' AND updated_by='migration' AND value='false'::jsonb;
