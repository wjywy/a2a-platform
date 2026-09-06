# Data Model: Symbol Agent 完整意图识别与自然路由

## 设计原则

- 意图识别结果是内部候选，不是用户可见答案。
- 用户最新明确表达优先于旧意图；冲突必须保留原因并等待确认。
- `missing` 由服务端根据意图类型和 Agent 能力声明计算。
- 路由轨迹有界、可审计、租户隔离，不保存密钥和未授权上下文。

## `IntentEnvelope`

表示模型对当前用户消息的结构化理解，建议保存在现有 `symbol_conversations.intent` 中。

| 字段 | 类型 | 说明 | 校验/规则 |
|---|---|---|---|
| `intentType` | enum | 八类主要意图 | 必须是 `capability_query`、`research_request`、`follow_up_question`、`clarification_reply`、`correction`、`task_control`、`small_talk`、`out_of_scope` 之一 |
| `taskRelation` | enum | 与当前任务关系 | `new`、`active`、`previous`、`none`、`uncertain` |
| `symbol` | string? | 用户明确提供的代码 | 只接受规范化后可验证的代码，不允许模型凭空猜测 |
| `companyName` | string? | 用户明确提供的公司/标的名称 | 进入 provider 唯一匹配流程 |
| `assetType` | enum? | stock/etf/index/crypto | 与 Agent 能力和市场匹配校验 |
| `market` | string? | 市场线索 | 与代码或候选冲突时保留冲突 |
| `period` | string? | 时间范围 | 由 Agent 能力声明决定是否必需 |
| `question` | string? | 用户当前想解决的问题 | 不把模型的回答写入此字段 |
| `thesis` | string? | 用户的投资观点或假设 | 观点审查 Agent 使用 |
| `controlAction` | enum? | 任务控制动作 | `cancel`、`retry`、`reset_memory` 或空；必须经过服务端权限和状态检查 |
| `confidence` | number | 识别信心 | 0 到 1，仅作为路由辅助，不替代服务端校验 |
| `uncertaintyReasons` | string[] | 不确定或冲突原因 | 有界，禁止包含 secret 或跨主体内容 |

模型返回的 `missing` 可暂时保留用于诊断，但不是权威字段；服务端必须根据 `intentType`、Agent `needs` 和合并后的值重新计算。

## `ActiveTaskContext`

对应现有 Symbol 会话和 task/context。

- `taskId` / `contextId`：A2A 任务关联。
- `tenantId` / `agentSlug`：隔离边界。
- `state`：collecting、completed、failed、cancelled。
- `intent`：当前合并后的 `IntentEnvelope`。
- `pendingFields`：仅研究类意图使用的服务端计算结果。
- `candidateSymbols`：公司名/代码解析候选及来源。
- `clarificationHistory`：已提出的问题、用户回应和仍未解决字段。
- `memorySummary` / `memoryEntryIds`：按 Agent policy 允许读取的记忆引用。
- `evidence`：研究工具返回的证据，不由本 feature 重新定义。

## `RoutingDecision`

每轮消息的最终服务端决定，写入有界 `routing_trace`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `intentType` | enum | 合并后的主要意图 |
| `taskRelation` | enum | 是否恢复当前任务 |
| `route` | enum | `agent_response`、`input_required`、`research`、`task_control`、`safe_boundary` |
| `missing` | string[] | 服务端重算的缺失字段 |
| `providerAllowed` | boolean | 是否允许外部数据调用 |
| `providerCalls` | string[] | 实际调用的逻辑能力名，默认有界 |
| `reasonCodes` | string[] | 例如 `capability_without_target`、`target_missing`、`conflict_requires_confirmation` |
| `messageSource` | enum | `agent-authored` 或 `protocol` |
| `at` | timestamp | 路由时间 |

## 状态转换

```text
新消息
  ├─ capability/small_talk/out_of_scope/解释澄清 ──> completed + agent_response
  ├─ task_control ──> task_control 或 safe_boundary
  ├─ research/follow_up/clarification/correction
  │    ├─ 缺少必需字段 ──> collecting + input_required
  │    └─ 字段完整且目标通过验证 ──> working -> completed/failed
  └─ 低置信度/冲突 ──> collecting + agent_response 或 input_required
```

## 持久化变更

- 给 `symbol_conversations` 增加有界 `routing_trace JSONB NOT NULL DEFAULT '[]'`，旧会话读取时默认为空数组。
- `saveConversation` 使用追加后裁剪的轨迹，避免单个会话无界增长。
- 现有 `intent`、`transcript`、`evidence` 和 `stream_state` 保持兼容；新 metadata 字段均可选。
- 不新增凭据表、不改变 memory 的主体隔离规则。
