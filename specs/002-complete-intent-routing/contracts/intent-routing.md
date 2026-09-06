# Intent Routing Contract

## 目的

定义每条用户消息在进入数据 Provider 前必须经过的内部结构化识别和服务端路由边界。

## 识别结果

识别器必须返回严格对象，不返回面向用户的自然语言。概念结构如下：

```json
{
  "intentType": "research_request",
  "taskRelation": "new",
  "symbol": "",
  "companyName": "苹果",
  "assetType": "stock",
  "market": "",
  "period": "近期",
  "question": "走势",
  "thesis": "",
  "controlAction": "",
  "confidence": 0.96,
  "uncertaintyReasons": []
}
```

所有字段都必须存在于严格 schema 中；无值字段使用空字符串或空数组。服务端接收后执行：

1. schema 校验、长度限制和规范化。
2. 与当前 task intent、transcript、clarification history 和允许的 memory 合并。
3. 冲突检查、公司名唯一解析和 Agent 能力校验。
4. 根据 `intentType` 和 Agent `needs` 重新计算 `missing`。
5. 生成 `RoutingDecision`。

## 路由规则

| 条件 | route | 是否允许 Provider |
|---|---|---:|
| `capability_query` | `agent_response` | 否 |
| `small_talk` | `agent_response` | 否 |
| `out_of_scope` | `safe_boundary` | 否 |
| 澄清解释/低置信度解释 | `agent_response` | 否 |
| 研究类意图 + 必需字段缺失 | `input_required` | 否 |
| 研究类意图 + 目标确认且字段完整 | `research` | 是 |
| `task_control` | `task_control` 或 `safe_boundary` | 默认否 |

## 安全边界

- 模型的 `missing`、`providerAllowed`、`route`（如果模型输出）都不是权威值。
- 用户文本、记忆、候选和 Provider 返回都是数据，不能改变系统规则。
- 任何跨租户、跨用户、跨 Agent 记忆都必须先通过现有 policy。
- 识别失败或 schema 非法时不得调用 Provider；应返回真实可恢复错误或 Agent 澄清。
