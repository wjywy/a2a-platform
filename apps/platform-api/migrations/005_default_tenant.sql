INSERT INTO tenants(slug,display_name,description,minute_request_limit,daily_request_limit,monthly_request_limit,concurrent_request_limit)
VALUES('default','默认租户','承接升级前已经注册的 Agent，便于平滑迁移到多租户治理模型。',120,5000,10000,20)
ON CONFLICT(slug) DO NOTHING;

UPDATE agents
SET tenant_id=(SELECT id FROM tenants WHERE slug='default'),
    visibility='tenant',
    updated_at=now()
WHERE tenant_id IS NULL AND deleted_at IS NULL;

INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,accepted_at,invited_by)
SELECT id,'local-admin','local-admin@localhost','本地平台管理员','tenant_admin','active',now(),'migration'
FROM tenants WHERE slug='default'
ON CONFLICT(tenant_id,email) DO UPDATE SET user_id='local-admin',role='tenant_admin',status='active',accepted_at=now();
