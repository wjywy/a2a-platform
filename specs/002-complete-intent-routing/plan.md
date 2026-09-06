# Implementation Plan: Symbol Agent 完整意图识别与自然路由

**Branch**: `main`（功能目录标识：`002-complete-intent-routing`） | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-complete-intent-routing/spec.md`

## Summary

本 feature 采用“混合意图识别”首版方案：每条用户消息先由当前 Agent 的语义识别模型输出严格结构化的意图对象；服务端再结合可信的会话、活动任务、记忆和 Agent 能力声明校验、合并并重新计算缺失字段；只有确认是研究请求且满足能力所需输入时才允许进入行情/新闻/期权等数据链路。能力咨询、闲聊、越界、解释澄清和任务控制交给当前 Agent 自主组织中文回答，应用层只维护协议状态、安全边界和真实错误。

当前线上问题的直接修复点是把“是否缺少 symbol”从入口路由条件中移出：先判断交互意图，再决定缺失字段是否有意义。结构化意图、路由决定和恢复所需上下文会持久化到现有 Symbol 会话中，使“苹果”“1”“刚才那个”“什么东西”等短消息能够回到原任务。

## Technical Context

**Language/Version**: Node.js 22 / TypeScript 5.9，ESM

**Primary Dependencies**: Express 5、Zod、`@a2a-js/sdk`、`pg`、Redis、Vitest、Supertest；复用现有 DeepSeek Chat Completions 兼容调用、Agent policy、memory context、Symbol SSE transport

**Storage**: PostgreSQL 中现有 `symbol_conversations` 持久化活动意图、任务状态、transcript 和有界路由轨迹；Redis 只作为现有上下文读取缓存，不作为路由事实源

**Testing**: Vitest 单元测试、Supertest API/集成测试、现有 A2A/SSE envelope 测试；DeepSeek 与数据 Provider 使用 mock，真实模型 smoke 作为部署后的受控验证

**Target Platform**: Docker 化 Linux API 服务，支持 Windows PowerShell 本地开发；通过现有 HTTP+JSON、JSON-RPC 和 SSE 内置 Symbol 路由提供能力

**Project Type**: 多租户 Web Agent 平台的后端路由与内置 Agent 运行时

**Performance Goals**: 能力咨询和闲聊不得触发外部市场数据；意图上下文和路由轨迹有界；在现有模型超时预算内完成一次结构化识别，并保持现有流式首个有效模型增量目标

**Constraints**: 模型输出只作为内部结构化输入，不能直接展示；服务端不信任模型的 missing 字段；不能在业务代码中拼接固定用户话术；会话、租户、Agent 和记忆必须隔离；协议状态与 Agent 文本必须可区分；不泄露凭据和内部 prompt

**Scale/Scope**: 当前七个内置 Symbol Agent、所有现有消息发送/流式入口和多租户会话；不改变 Longbridge、期权/Gamma 数据计算本身，不新增下单能力

## Constitution Check

当前 `.specify/memory/constitution.md` 仍是未填写的 Spec Kit 模板，未提供可执行的项目专属原则、版本或批准日期。因此没有可判定的“违反宪章”项。本计划沿用仓库已有基线：复用租户鉴权和现有加密凭据边界；共享契约必须有单元、集成和故障测试；外部数据调用必须有明确路由前置条件；流式任务必须以真实最终状态收口；不得把 secret 写入日志、prompt、记忆或响应。

**Phase 0 状态**: 通过。规则路由、纯模型、混合识别、Agent 自主工具选择和专用分类器已在 [research.md](./research.md) 中比较，首版选择混合识别。

**Phase 1 复核**: 通过。意图契约是内部扩展，A2A 的 Task 状态和 SSE 事件保持兼容；能力回答、澄清回答和研究回答均通过现有文本生成边界输出，路由轨迹只作为受控 metadata 和持久化审计信息。

## Project Structure

### Documentation (this feature)

```text
specs/002-complete-intent-routing/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── intent-routing.md
│   └── a2a-routing.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/platform-api/
├── migrations/
│   └── 027_symbol_intent_routing.sql # 路由轨迹与旧会话兼容
└── src/
    ├── symbol-intent-service.ts      # 结构化意图契约、模型提取、校验、任务合并
    ├── symbol-service.ts             # 先路由再研究；统一回答、澄清和任务持久化
    ├── symbol-context.ts             # 为识别/回答提供有界 transcript、memory、task context
    ├── symbol-router.ts              # A2A/SSE 状态与 Agent 文本来源标记
    ├── symbol-graph.ts               # 仅在路由允许时执行证据节点
    ├── memory-service.ts             # 复用现有记忆策略和删除/隔离边界
    ├── agent-policy-service.ts       # 复用现有 Agent 角色与记忆 policy
    └── *.spec.ts / app.integration.spec.ts # 单元、路由和多租户集成回归
```

**Structure Decision**: 这是现有 Express/TypeScript 单 API 服务的增量功能，新增独立 `symbol-intent-service.ts` 收拢识别契约和合并逻辑，避免继续把分类器、澄清和研究编排全部堆在 `symbol-service.ts`。会话路由轨迹通过一次兼容 migration 进入既有会话存储；不另起服务、不改变外部 A2A 路由。

## Routing Design

### 首版调用顺序

1. 从请求体解析本轮文本，并加载同租户、同 Agent、同 task/context 的活动任务、transcript、记忆和 policy。
2. 调用结构化意图识别，输出 `intentType`、`taskRelation`、标的/公司名/市场/问题/观点线索、控制动作、置信度和不确定性原因。
3. 服务端校验结构化结果，依据本轮明确表达与上一轮状态合并意图；用户最新纠正优先，冲突不静默覆盖。
4. 服务端根据当前 Agent 的 `needs` 和 `intentType` 重算缺失字段。只有研究类意图才使用“缺少字段”作为输入待补充判断。
5. 分流：
   - 能力咨询、闲聊、越界、解释澄清、未知低置信度：当前 Agent 自主回答，不调用市场数据。
   - 任务控制：仅执行已验证且在当前 task 权限范围内的动作；不确定时由 Agent 解释并请求确认。
   - 研究/研究追问/澄清回复/纠正：目标和必需字段完整后进入现有 Symbol graph，否则由 Agent 生成最小澄清。
6. 持久化合并后的意图、路由决定、工具调用门禁、回答来源和恢复信息；流式输出继续使用现有 SSE。

### 路由不变量

- 模型提供 `missing` 仅作为诊断信息，服务端永远重新计算；模型不能通过返回空数组绕过数据前置条件。
- `capability_query` 不会因为缺少标的进入 `TASK_STATE_INPUT_REQUIRED`。
- `research_request` 缺少目标时不得触发 quote/chart/news/option provider。
- `clarification_reply` 必须先尝试合并当前 task，再决定继续澄清或研究。
- Agent 文本和协议状态分别标记 `agent-authored` / `protocol`，前端不把协议提示当成研究结论。

## Implementation Sequencing

1. 新增意图类型、严格结构化契约、服务端合并器和路由决策模型；先用单元测试锁定八类意图与低置信度边界。
2. 增加会话路由轨迹字段和兼容读写；将 transcript、上一轮澄清、候选和纠正纳入识别上下文。
3. 重构 `handleSymbolMessage` 为“识别 → 合并/重算 → 路由 → 研究或 Agent 回答”；能力咨询、闲聊和越界走自然回答，不进入 provider。
4. 接入 A2A send/stream/subscribe 的 metadata 和终态一致性；验证七个内置 Agent 的统一边界与角色差异。
5. 执行 focused tests、全量 build/test、100 组路由回归和真实 DeepSeek 受控 smoke；本计划不包含自动推送或部署。

## Complexity Tracking

没有已知的宪章违规，因此本节无额外复杂度豁免。
