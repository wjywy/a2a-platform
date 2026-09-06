# Memory and Agent Policy API Contract

本文件定义平台内部/管理 API 的行为契约。所有接口都沿用现有认证、租户成员角色和 `X-Request-Id` 约定；内置 Agent 的策略和记忆永远不通过浏览器暴露凭据。

## Common types

```ts
type MemoryScope = "conversation" | "user" | "agent" | "tenant";
type MemoryCategory =
  | "fact" | "preference" | "correction" | "constraint"
  | "open_question" | "summary" | "answer";

type MemoryPolicy = {
  enabled: boolean;
  readScopes: MemoryScope[];
  writeScopes: MemoryScope[];
  categories: MemoryCategory[];
  retentionDays: number;
  maxEntries: number;
  maxContextChars: number;
  allowUserControl: boolean;
  allowCrossConversation: boolean;
  allowCrossAgent: boolean;
  version: number;
};

type MemoryItem = {
  id: string;
  agentSlug: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: Record<string, unknown>;
  source: { conversationId?: string; messageId?: string; kind: string };
  confidence: number;
  observedAt: string;
  expiresAt: string;
  status: "active" | "superseded" | "expired" | "redacted";
};
```

`content` 只返回策略允许的结构化内容，不返回密钥、token、内部 prompt 或已删除条目。服务端忽略正文中的租户/user/subject 字段，主体从认证上下文和受信任会话关系推导。

## Agent policy

### `GET /api/admin/agents/{agentSlug}/memory-policy?tenantId={tenantId}`

需要 `viewer` 以上的租户访问权限。返回：

```json
{ "agentSlug": "symbol-market", "policy": { "enabled": true, "readScopes": ["conversation"], "writeScopes": ["conversation"], "categories": ["fact", "correction", "constraint", "open_question", "summary"], "retentionDays": 30, "maxEntries": 40, "maxContextChars": 12000, "allowUserControl": true, "allowCrossConversation": false, "allowCrossAgent": false, "version": 1 } }
```

### `PATCH /api/admin/agents/{agentSlug}/memory-policy`

需要 `developer`；`tenantId` 放在 JSON body 或现有约定的 query 中。只接受上述字段的部分更新，所有数组必须是白名单值，`writeScopes` 不能绕过 `enabled`。成功返回完整新策略和递增后的 `version`，并产生 `agent.memory_policy.updated` 审计记录。版本冲突返回 `409 POLICY_VERSION_CONFLICT`。

禁止的策略内容：固定回答句子、凭据、要求模型泄露上下文、隐式跨租户 scope、未定义的记忆 category。

## User memory controls

这些接口由登录用户访问，租户和主体由服务端 session/principal 推导；不接受客户端自报的 `userId`。如果策略关闭 `allowUserControl`，返回 `403 MEMORY_CONTROL_DISABLED`。

### `GET /api/memory?agentSlug={slug}&conversationId={id}`

返回当前主体在授权 scope 内的 `MemoryItem[]`，只包含 active 条目和必要的来源/时效元数据，不返回其他用户、租户或 Agent 的记忆。

### `DELETE /api/memory/{memoryId}`

删除一条当前主体可见的记忆。返回 `204`；事务内写非内容审计记录、使 Redis 上下文失效并确保下一次模型调用查询不到该 id。不存在或不属于当前主体统一返回 `404`，避免泄露资源存在性。

### `POST /api/memory/reset`

请求体：

```json
{ "agentSlug": "symbol-market", "conversationId": "optional-uuid", "scope": "conversation" }
```

仅允许重置当前主体和策略允许的 scope。返回：

```json
{ "deletedCount": 3, "agentSlug": "symbol-market", "scope": "conversation" }
```

删除后可保留任务继续运行所需的最小 A2A/task 状态，但不得把被删除自然语言内容或记忆重新放入下一个模型上下文。

## Admin memory inspection and reset

### `GET /api/admin/agents/{agentSlug}/memories?tenantId={tenantId}&conversationId={id}`

需要 `viewer`。返回租户范围内、且符合 Agent 策略的记忆摘要；默认不返回已 redacted/expired 内容。管理员只能查看其已授权租户，平台管理员也必须显式指定目标租户。

### `POST /api/admin/agents/{agentSlug}/memory/reset`

需要 `tenant_admin`。请求体可指定 `tenantId`、`conversationId` 或经服务端解析的主体范围。禁止使用空条件重置所有租户；如确需全租户清理必须使用单独的后台运维操作和二次审计。返回删除数量与范围，不返回被删除内容。

## Error contract

```json
{ "error": { "code": "MEMORY_SCOPE_DENIED", "message": "当前记忆策略不允许读取该范围。", "requestId": "..." } }
```

允许的错误码至少包括 `TENANT_CONTEXT_REQUIRED`、`MEMORY_CONTROL_DISABLED`、`MEMORY_SCOPE_DENIED`、`MEMORY_NOT_FOUND`、`POLICY_VERSION_CONFLICT` 和 `INVALID_MEMORY_CONTENT`。错误消息是协议/控制面说明，不得冒充 Agent 研究回答。
