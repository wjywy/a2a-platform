# A2A Routing Contract

## 对外行为

现有 Symbol Agent 的 `message:send`、`message:stream`、task 查询和 subscribe 路径保持不变。变化仅体现在任务如何选择下一步，以及 metadata 对路由结果的补充。

### Agent 自主回答

- 能力咨询、闲聊、越界和解释澄清返回 Agent 生成的自然文本。
- `metadata.messageSource` 为 `agent-authored`。
- 不因缺少 `symbol` 返回 `TASK_STATE_INPUT_REQUIRED`。
- 能力咨询和闲聊不得触发市场数据调用。

### 研究请求需要补充信息

- 返回 `TASK_STATE_INPUT_REQUIRED`。
- `metadata.missing` 是服务端重新计算的字段。
- 面向用户的文本由 Agent 生成；协议状态和字段 metadata 由平台生成。
- 保存 `taskId`、`contextId`、合并意图和澄清历史，下一轮使用同一任务恢复。

### 研究完成或失败

- 目标完整并通过校验后，进入现有 provider/graph/Agent 研究流程。
- Provider、记忆或模型失败必须返回真实 `TASK_STATE_FAILED` 或降级证据，不得用固定成功文案代替。

## 流式要求

- 第一个 working event 可以只有 protocol metadata，不得伪造文本。
- Agent 文本增量继续使用现有累计快照和 sequence/hash 元数据。
- 最终 Task 的文本必须与最后一次累计 Agent 文本一致。
- 断线后通过原 task/context 查询或 subscribe 时，路由 metadata、文本来源和终态保持一致。
