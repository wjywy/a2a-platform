# Quickstart: 意图路由验收

## 前置条件

- Node.js 22、npm workspace 依赖已安装。
- PostgreSQL/Redis 使用项目现有测试边界；单元和集成测试中的模型、Provider 可使用 mock。
- 真实模型 smoke 需要显式配置 `DEEPSEEK_API_KEY`，凭据不得打印。

## focused tests

```powershell
npm --workspace @a2a-platform/api run test -- src/symbol-intent-service.spec.ts src/symbol-service.spec.ts src/symbol-context.spec.ts src/symbol-graph-gate.spec.ts src/symbol-router.spec.ts src/symbol-routing.integration.spec.ts src/app.integration.spec.ts
```

预期至少覆盖：

1. “你能做什么、会使用哪些数据或工具”被识别为 `capability_query`，返回 Agent 自主回答，不进入 `INPUT_REQUIRED`，不调用 Provider。
2. “帮我分析苹果”被识别为 `research_request`，公司名唯一解析后进入研究；无法唯一解析时只询问最小信息。
3. 澄清任务后回复“苹果”“1”“什么东西”“不是苹果，是微软”分别恢复、解释、选择候选或纠正原任务。
4. 七个 Symbol Agent 使用同一批输入时均不把能力咨询路由到股票代码补充路径。
5. 结构化结果非法、模型不可用、记忆降级和冲突标的不会触发未授权 Provider 调用。

## build/test

```powershell
npm --workspace @a2a-platform/api run build
npm test
```

在本机执行全量集成测试前，需要 PostgreSQL 与 Redis 可访问；项目容器默认只映射 PostgreSQL。开发环境可启动一个临时、仅本机映射 Redis 容器后再运行测试，完成后删除该临时容器。

## 受控真实模型验证

在已部署应用服务器本机运行 `npx tsx scripts/verify-symbol-routing.ts`，或设置 `SYMBOL_ROUTING_SMOKE=true` 后运行 `scripts/verify-platform.ts`。脚本只接受回环地址、禁止重定向，且不会打印 token、原始 SSE 内容或模型文本。

验证以下请求，并检查最终状态：

- 能力咨询：必须是 Agent 自主文本、无行情调用。
- 研究请求：必须先完成意图识别，再按标的状态决定研究或澄清。
- 连续追问：必须复用原 `taskId/contextId`。

验证输出只记录意图类型、route、是否调用 Provider、任务状态和文本来源，不记录 API key、Authorization、ciphertext 或完整记忆内容。
