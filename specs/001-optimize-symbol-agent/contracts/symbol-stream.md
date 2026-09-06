# Symbol A2A / SSE Stream Contract

## Compatibility

内置 Symbol Agent 继续提供现有 Agent Card、A2A HTTP+JSON/JSON-RPC 和 `message:send`/`message:stream` 路径。新能力通过 Task metadata、artifact data 和内部运行结果增加，不改变既有客户端对 `TASK_STATE_INPUT_REQUIRED`、`TASK_STATE_WORKING`、`TASK_STATE_COMPLETED`、`TASK_STATE_FAILED`、`TASK_STATE_CANCELED` 的解析。

## Lifecycle

```text
新消息
  │
  ├─ 结构化 intent 无效/必填信息缺失 ──> INPUT_REQUIRED + Agent 澄清
  │                                      └─ 保存 collecting 会话
  │
  ├─ 目标已确认 ──> WORKING 状态事件
  │                ├─ memory/context assembly
  │                ├─ Longbridge evidence / Gamma (可降级)
  │                └─ 当前 Agent 生成自然语言
  │
  └─> COMPLETED（可能 `metadata.degraded=true`）
       或 FAILED/CANCELED（真实非成功状态）
```

`degraded` 是领域运行/证据状态，不强行新增未知 A2A 枚举：如果仍能生成有边界的研究报告，协议使用 `TASK_STATE_COMPLETED` 并在 metadata/artifact 中明确降级；如果没有足够证据或模型无法可信生成，则使用 `TASK_STATE_FAILED`，不能返回“已完成”的研究文案。

## SSE event rules

1. 首个工作事件只包含 task/context id 和 `TASK_STATE_WORKING`，不填伪造的 assistant text。
2. Agent 开始生成后，`onDelta` 发送按顺序递增的累计文本；每个客户端可用 `text = previous + delta` 或直接采用累计值，但服务端必须在 metadata 记录累计长度/hash。
3. `INPUT_REQUIRED` 的 message 是 Agent 根据当前上下文生成的澄清内容，`metadata` 同时给出校验后的 `missing` 字段；平台不能用固定句子覆盖它。
4. 最终 Task 的 message text 必须等于最后一次累计的 Agent 文本，artifact data 必须对应同一研究运行的 evidence/result。不得重复发送旧 delta、截断最终文本或把错误状态标成 completed。
5. 每个研究运行的证据至少包含 provider、permission、freshness、asOf/fetchedAt；期权/Gamma 缺失时 artifact 显示 unavailable/degraded reason，而不是 0。
6. stream close、模型 abort 或网络断开后，服务端仍持久化已知的会话/运行状态；重连读取同一 task/conversation，不生成新的隐式上下文。

## Final Task shape

```json
{
  "id": "task-uuid",
  "contextId": "context-uuid",
  "status": {
    "state": "TASK_STATE_COMPLETED",
    "message": {
      "role": "ROLE_AGENT",
      "parts": [{ "text": "<最后一段 Agent 生成的累计内容>" }]
    }
  },
  "artifacts": [{
    "artifactId": "symbol-report",
    "parts": [{ "data": {
      "intent": {},
      "evidence": {},
      "gamma": {},
      "degraded": []
    }}, { "text": "<同一最终文本>" }]
  }],
  "metadata": {
    "agent": "symbol-market",
    "intent": {},
    "memory": { "enabled": true, "usedEntryIds": [] },
    "degraded": false
  }
}
```

`memory.usedEntryIds` 只记录本轮被授权读取并实际进入上下文的 id；不向用户暴露被删除、被拒绝或跨租户条目。凭据、内部 prompt、完整原始响应和未授权记忆不得出现在 artifact、metadata 或 SSE。

## Error mapping

| 层级 | 真实情况 | 对外行为 |
|---|---|---|
| intent | schema 错误/无法识别 | 安全重试或 `INPUT_REQUIRED`；不启动数据请求 |
| memory | 禁止读取、超时、存储异常 | 按策略决定是否继续；继续时 metadata 标记 degraded，不能假装使用了记忆 |
| Longbridge quote | 无凭据/权限/休市/过期/上游失败 | evidence 标明 permission/freshness/reason；不填虚假价格 |
| options/Gamma | OPRA/字段缺失/时间不一致 | 报告保留可用部分，Gamma scope/排除项/限制可见 |
| model | 调用失败/中断 | 真实 failed/degraded；协议错误与 Agent 内容分开 |
| stream | 客户端断开 | 持久化可恢复状态，后续订阅同一 task |
