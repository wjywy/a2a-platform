# Data Model: Agent 自主响应、记忆增强与 Symbol 市场分析

## 设计原则

- PostgreSQL 是唯一权威来源；Redis key 必须能定位到 tenant、Agent 和主体，且只存可重建的裁剪上下文。
- 记忆不是完整聊天记录的替身。完整授权 transcript 留在会话/消息表，记忆只保存经过策略允许、可解释和可撤销的事实/摘要。
- Longbridge 原始行情/期权字段属于一次研究运行的证据，不自动升级为长期记忆；最终报告只保存已裁剪的证据和派生结果。
- 所有用户可见自然语言都通过 Agent 模型生成，数据库中的策略只能是角色、规则、证据和安全约束，不能成为固定回答句库。

## 持久化实体

### `agent_policies`

每个平台注册 Agent 的显式运行策略。内置 Symbol Agent 在 bootstrap 时逐个 upsert 默认策略；管理 API 修改时递增 `version` 并写入既有 `audit_logs`。

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | uuid PK | 策略标识 |
| `agent_id` | uuid FK `agents.id`, unique | 一个 Agent 的当前生效策略 |
| `response_rules` | jsonb | 角色、语言、证据引用、安全和不确定性规则；禁止固定自然语言句子 |
| `memory_enabled` | boolean | 是否允许记忆读写总开关 |
| `memory_read_scopes` | text[] | `conversation`、`user`、`agent`、`tenant` 的允许集合 |
| `memory_write_scopes` | text[] | 可写 scope，不能超出读取和策略允许范围 |
| `memory_categories` | text[] | `fact`、`preference`、`correction`、`constraint`、`open_question`、`summary`、`answer` |
| `retention_days` | integer | 条目默认有效期，受租户 retention 上限约束 |
| `max_entries` / `max_context_chars` | integer | 单次读取数量和送入模型的字符预算 |
| `allow_user_control` | boolean | 是否允许授权用户查看/删除/重置 |
| `allow_cross_conversation` / `allow_cross_agent` | boolean | 默认 false；只有对应 scope 同时获准才生效 |
| `version` | integer | 乐观锁和审计版本 |
| `updated_by`, `created_at`, `updated_at` | text/timestamptz | 操作者和时间 |

`agent_id` 上的唯一约束保证“每个 Agent 有策略”。若未来需要租户覆盖，使用独立的 `(agent_id, tenant_id)` 覆盖表和显式优先级，不在本次功能中把全局策略静默改成租户策略。

### `agent_memories`

按策略保存的可检索记忆。`subject_id` 只能由服务端从当前会话、认证用户或认证 API Key 得出，不能直接采用用户消息中的身份字段。

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | uuid PK | 记忆标识 |
| `tenant_id` | uuid FK `tenants.id` | 第一层隔离键 |
| `agent_id` | uuid FK `agents.id` | 第二层 Agent 隔离键 |
| `scope` | text check | `conversation`、`user`、`agent`、`tenant` |
| `subject_type` / `subject_id` | text | 当前会话、认证用户、API Key 调用主体或租户 |
| `category` | text check | 记忆类别，受 Agent 策略白名单限制 |
| `content` | jsonb | 结构化事实/摘要；写入前做长度、敏感信息和 prompt 注入边界校验 |
| `source_conversation_id` / `source_message_id` | uuid/text nullable | provenance，指向来源会话/消息 |
| `confidence` | numeric 0..1 | 推断置信度；用户明确陈述使用较高来源等级而非模型自行提升 |
| `observed_at` / `expires_at` | timestamptz | 事实观测时间和失效时间 |
| `superseded_by` | uuid FK self nullable | 纠正后指向最新条目 |
| `deleted_at` / `redacted_at` | timestamptz nullable | 删除/隐私清理标记；后续读取永远排除 |
| `created_at` / `updated_at` | timestamptz | 生命周期时间 |

建议索引：`(tenant_id, agent_id, scope, subject_id, updated_at DESC)`、`expires_at`、`superseded_by`。删除接口先在事务中写不可逆的非内容审计记录、清理 Redis，再物理删除或将 payload redacted；后续上下文查询不依赖缓存是否成功清除。

### 现有 `symbol_conversations` 的扩展

沿用现有 `task_id` 主键和 collecting/completed/failed/cancelled 状态，增加以下 JSONB/标量字段，避免另建一张与 Symbol 任务重复的会话表：

- `memory_summary`：当前允许用于恢复的有界摘要、未解决问题、实体和最近纠正；不保存被删除记忆的正文。
- `memory_entry_ids`：本轮读取并实际用于模型上下文的记忆 id 列表，供审计和复现，不代表授权永久不变。
- `evidence`：本次研究的来源、权限、freshness、quote/option/Gamma 状态和时间戳摘要。
- `stream_state`：已发出的累计 Agent 文本 hash/长度、最后事件序号和最终状态，用于重连一致性校验。

已有 `intent`、`transcript`、`result` 继续保留：intent 是最新合并后的结构化目标，transcript 是授权会话内容，result 是最终结构化报告数据。完整 transcript 不直接无界地送入模型。

### `market_data_credentials`

按租户和 provider 保存 Longbridge 服务端凭据的加密 envelope。表中只保存 `secret_ciphertext`、`secret_iv`、`secret_tag`、`secret_key_version` 和非敏感 `credential_status`/`last_checked_at`；使用现有 `credential-service.ts` 的 AES-GCM 机制和不同 purpose 字符串。API 只返回 `configured`、权限检查时间和状态，不返回密文或明文。

### 研究运行中的证据对象

研究运行继续写入现有 `agent_runs.input/output` 和 `agent_run_events`，不为每次易过期报价创建长期关系表。`output.evidence` 使用以下对象：

```text
MarketSnapshot {
  provider: "longbridge" | "fallback";
  symbol: string; providerSymbol: string;
  asOf: string; fetchedAt: string;
  price?: number; previousClose?: number; change?: number;
  volume?: number; turnover?: number;
  session?: "regular" | "pre" | "post" | "closed" | "unknown";
  freshness: "live" | "delayed" | "stale" | "unknown";
  permission: "available" | "missing" | "expired" | "unknown";
}

OptionChainSnapshot {
  underlying: string; asOf: string; fetchedAt: string;
  expiries: Array<{ expiry: string; strikes: number[] }>;
  contracts: OptionContract[];
  permission: "available" | "missing" | "expired" | "unknown";
}

OptionContract {
  symbol: string; expiry: string; strike: number;
  side: "call" | "put"; last?: number; bid?: number; ask?: number;
  volume?: number; openInterest?: number; impliedVolatility?: number;
  gamma?: number; contractMultiplier?: number; asOf?: string;
  unavailable: string[];
}

GammaExposureAnalysis {
  formula: string; spot: number; scope: object; assumptions: string[];
  grossByLevel: Array<{ expiry?: string; strike: number; value: number }>;
  modeledSignedByLevel: Array<{ expiry?: string; strike: number; value: number }>;
  scenarios: Array<{ range: string; interpretation: string }>;
  excludedContracts: Array<{ symbol: string; reasons: string[] }>;
  limitations: string[]; asOf: string;
}
```

缺失的 `gamma`、`openInterest`、`contractMultiplier` 或 spot 不得隐式填零；`unavailable` 和 `excludedContracts` 是报告证据的一部分。

## 关系与隔离

```text
tenants 1 ── * symbol_conversations
agents  1 ── 1 agent_policies
agents  1 ── * agent_memories
tenants 1 ── * agent_memories
tenants 1 ── * market_data_credentials (provider=longbridge)
symbol_conversations 1 ── * agent_memories (source reference, not ownership)
agent_runs 1 ── * agent_run_events
```

记忆读取的必要条件是：租户匹配、Agent 匹配、scope 在策略读集合中、subject 匹配、未过期、未删除且未被 superseded。跨 Agent 读取必须同时满足策略和显式共享标记；没有任何默认跨租户路径。

## 状态与不变量

### 会话/运行

`collecting → completed | failed | cancelled`，与现有 Symbol 状态保持兼容。只有通过结构化 intent 校验并解析出必需标的后才能进入数据收集；期权无权限可以使研究结果为 `degraded`，不能伪装成完整期权结果。

### 记忆

`active → superseded | expired | redacted/deleted`。新用户纠正先写新条目，再在同一事务中把旧条目标记 `superseded_by`；读取只返回最新有效条目。删除/重置必须在下一个模型调用前完成，且清理上下文缓存。

### 证据

每个 provider 结果必须有 `provider`、`fetchedAt`、`asOf`、permission/freshness 状态；quote 和 option 的时间不一致时保留各自时间并在 `limitations` 中标出差值。Provider 失败只能产生 `unavailable/degraded`，不能构造默认零值。
