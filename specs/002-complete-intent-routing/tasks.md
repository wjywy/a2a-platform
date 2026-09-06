# Tasks: Symbol Agent 完整意图识别与自然路由

**Input**: Design documents from `/specs/002-complete-intent-routing/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: 本 feature 明确要求回归测试、Provider 调用门禁测试、多轮任务测试和真实模型受控 smoke，因此任务包含先写失败测试再实现的 TDD 顺序。

**Organization**: 按用户故事拆分；每个故事完成后都应能独立验证一段用户价值。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立意图路由的样本、类型和验证入口，不改变现有生产行为。

- [X] T001 [P] 在 `apps/platform-api/src/intent-routing-fixtures.ts` 建立八类意图、中文自然表达、短句、指代、纠正和越界请求的共享验收样本矩阵
- [X] T002 [P] 在 `apps/platform-api/src/symbol-intent-service.ts` 建立意图类型、任务关系、路由结果和结构化字段的公共 TypeScript 类型出口
- [X] T003 [P] 在 `apps/platform-api/src/symbol-intent-service.spec.ts` 建立共享样本矩阵的解析、规范化和字段边界测试入口

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 为所有用户故事提供严格契约、持久化兼容和有界上下文。

**⚠️ CRITICAL**: 本阶段完成前不得修改七个 Agent 的实际分流行为。

- [X] T004 在 `apps/platform-api/src/symbol-intent-service.ts` 实现严格结构化意图 schema、wire schema、长度限制和空值规范化，拒绝未知枚举和额外字段
- [X] T005 在 `apps/platform-api/src/symbol-intent-service.spec.ts` 先写并运行失败测试，覆盖八类 `intentType`、`taskRelation`、控制动作、非法 JSON、额外字段和置信度边界
- [X] T006 在 `apps/platform-api/migrations/027_symbol_intent_routing.sql` 增加有界 `routing_trace` 字段并保证旧 `symbol_conversations` 记录可读取
- [X] T007 在 `apps/platform-api/src/symbol-service.ts` 更新 Conversation 类型、读取和保存逻辑，兼容旧会话并追加后裁剪路由轨迹
- [X] T008 [P] 在 `apps/platform-api/src/symbol-context.ts` 将当前 task、上一轮澄清、候选、任务关系和路由所需记忆纳入有界识别上下文，并保持 secret redaction
- [X] T009 [P] 在 `apps/platform-api/src/symbol-router.ts` 设计路由 metadata 的序列化边界，区分 `agent-authored` 文本、协议状态和内部路由诊断

**Checkpoint**: 严格意图对象可解析、旧会话可恢复、识别上下文有界且不含凭据；此时尚未改变实际用户分流。

---

## Phase 3: User Story 1 - 先理解用户是在问什么 (Priority: P1) 🎯 MVP

**Goal**: 能力咨询、闲聊、越界和研究请求不再共用“缺少股票代码”的入口；能力咨询由当前 Agent 自主回答且不调用市场数据。

**Independent Test**: 对全部七个 Symbol Agent 发送“你能做什么、会使用哪些数据或工具”“你好”“帮我分析苹果”“与金融无关的问题”，比较识别类型、route、任务状态、Provider 调用和 Agent 文本来源。

### Tests for User Story 1

> 先写测试并确认失败，再实现路由。

- [X] T010 [P] [US1] 在 `apps/platform-api/src/symbol-intent-service.spec.ts` 增加能力咨询、闲聊、越界和研究请求的结构化模型 fixture 与路由决策失败测试
- [X] T011 [P] [US1] 在 `apps/platform-api/src/symbol-service.spec.ts` 增加“能力咨询不进入 INPUT_REQUIRED、不调用 Provider、文本来自 mock Agent”的失败测试
- [X] T012 [P] [US1] 在 `apps/platform-api/src/app.integration.spec.ts` 增加七个 Agent 的能力咨询 API/SSE 回归测试，断言无行情/新闻/期权调用

### Implementation for User Story 1

- [X] T013 [US1] 在 `apps/platform-api/src/symbol-intent-service.ts` 实现模型结构化提取 prompt，要求识别 intentType、taskRelation、上下文引用和不确定性，不返回用户可见文本
- [X] T014 [US1] 在 `apps/platform-api/src/symbol-intent-service.ts` 实现服务端合并、冲突检查和路由决策函数，确保模型的 `missing`、`route` 和 Provider 许可不能绕过服务端规则
- [X] T015 [US1] 在 `apps/platform-api/src/symbol-service.ts` 增加能力回答、闲聊、越界和解释澄清的 Agent 生成路径，复用 policy/context，禁止固定用户话术
- [X] T016 [US1] 在 `apps/platform-api/src/symbol-service.ts` 重构 `handleSymbolMessage` 为“识别 → 合并/重算 → 路由”，移除在意图分类前直接按 `intent.missing` 进入 `requestInput` 的控制流
- [X] T017 [US1] 在 `apps/platform-api/src/symbol-service.ts` 和 `apps/platform-api/src/symbol-graph.ts` 增加 Provider 调用门禁，确保 `capability_query`、`small_talk`、`out_of_scope` 和解释澄清不会进入行情图
- [X] T018 [US1] 在 `apps/platform-api/src/symbol-service.ts` 保存非研究回答的合并意图、route、messageSource 和有界 routing trace，并以可完成 Task 返回 Agent 文本
- [X] T019 [US1] 在 `apps/platform-api/src/symbol-router.ts` 将 intentType、route 和 messageSource 以可选 metadata 暴露到 send/stream/subscribe，同时不把内部诊断原样泄露给用户

**Checkpoint**: “你能做什么”不再触发股票代码追问；七个 Agent 都走各自角色的 Agent 自主回答；研究请求仍能进入原有研究链路。

---

## Phase 4: User Story 2 - 让澄清回复回到原任务 (Priority: P1)

**Goal**: 苹果、AAPL、候选序号、短确认、指代和纠正都能恢复当前 task/context，不遗忘上一轮任务。

**Independent Test**: 创建缺少标的的 collecting task，依次发送“苹果”“1”“什么东西”“不是苹果，是微软”，验证意图合并、候选选择、自然解释、纠正覆盖和 taskId/contextId 连续性。

### Tests for User Story 2

- [X] T020 [P] [US2] 在 `apps/platform-api/src/symbol-intent-service.spec.ts` 增加 `clarification_reply`、`follow_up_question`、`correction` 对活动任务和无活动任务的失败测试
- [X] T021 [P] [US2] 在 `apps/platform-api/src/symbol-service.spec.ts` 增加候选序号、指代、最新纠正优先和相同缺失字段不得重复固定句式的失败测试
- [X] T022 [P] [US2] 在 `apps/platform-api/src/app.integration.spec.ts` 增加多轮 API/SSE 测试，断言同一 task/context 恢复、路由轨迹追加和记忆 policy 边界生效

### Implementation for User Story 2

- [X] T023 [US2] 在 `apps/platform-api/src/symbol-intent-service.ts` 实现 taskRelation 判断和活动任务合并，优先采用最新明确目标、时间范围、市场和研究问题
- [X] T024 [US2] 在 `apps/platform-api/src/symbol-intent-service.ts` 实现候选序号、确认词、指代词和简短纠正的上下文解析；无上下文时返回不确定原因，不猜测
- [X] T025 [US2] 在 `apps/platform-api/src/symbol-service.ts` 调整公司名解析顺序为意图类型确认后执行，并在解析成功、歧义和冲突时重新计算服务端缺失字段
- [X] T026 [US2] 在 `apps/platform-api/src/symbol-service.ts` 持久化 clarification history、候选和 routing trace，确保下一轮识别能看到上一轮 Agent 追问及其原因
- [X] T027 [US2] 在 `apps/platform-api/src/symbol-service.ts` 增加澄清循环保护：连续未补全时将历史交给 Agent 改变表达、提供示例或说明停止条件，不拼接重复固定文案
- [X] T028 [US2] 在 `apps/platform-api/src/symbol-context.ts` 接入 active task intent、上一轮问题、最新纠正和允许的 memory，并验证删除/superseded 内容不再进入模型上下文

**Checkpoint**: “什么东西”会得到对当前任务的自然解释，“苹果/1/微软”能恢复或纠正原任务，不会重新开一个无关任务。

---

## Phase 5: User Story 3 - 只有研究意图才进入数据链路 (Priority: P1)

**Goal**: 研究请求只有在目标和 Agent 所需字段完整、冲突解决、权限允许后才调用行情/新闻/期权等 Provider；缺目标只进入可恢复澄清。

**Independent Test**: 对能力咨询、缺标的研究、公司名唯一匹配、公司名歧义、代码/公司冲突和已有目标追问分别运行，比较 Provider 调用记录和最终状态。

### Tests for User Story 3

- [X] T029 [P] [US3] 在 `apps/platform-api/src/symbol-service.spec.ts` 增加服务端重算 missing 的失败测试，证明模型返回空 missing 也不能绕过缺标的门禁
- [X] T030 [P] [US3] 在 `apps/platform-api/src/symbol-router.spec.ts` 增加 send/stream 的研究澄清、研究完成和无目标不调用 Provider 的契约测试
- [X] T031 [P] [US3] 在 `apps/platform-api/src/app.integration.spec.ts` 增加公司名唯一匹配、歧义候选、冲突目标和已有 task follow-up 的 Provider spy 测试

### Implementation for User Story 3

- [X] T032 [US3] 在 `apps/platform-api/src/symbol-intent-service.ts` 实现按 `intentType` 和当前 Agent capability declaration 重算 missing，明确能力咨询不需要 symbol
- [X] T033 [US3] 在 `apps/platform-api/src/symbol-service.ts` 将研究类意图的目标解析、候选冲突确认和 Provider 前置校验集中到单一路径
- [X] T034 [US3] 在 `apps/platform-api/src/symbol-service.ts` 让 `research_request`、完整的 `follow_up_question`、`clarification_reply` 和 `correction` 进入现有 graph，其余 route 明确禁止 Provider
- [X] T035 [US3] 在 `apps/platform-api/src/symbol-graph.ts` 增加 route/provider gate 的运行轨迹，记录允许与拒绝原因，不把路由状态文本当成研究证据
- [X] T036 [US3] 在 `apps/platform-api/src/symbol-bootstrap.ts` 和 `apps/platform-api/src/symbol-service.ts` 校验七个内置 Agent 的 capability declaration、needs 和意图分类边界一致

**Checkpoint**: 研究目标完整时继续使用现有 Longbridge/Yahoo/新闻/期权/Gamma 能力；目标缺失、冲突或非研究意图不会触发 Provider。

---

## Phase 6: User Story 4 - 七个内置 Symbol Agent 保持一致但不失角色差异 (Priority: P2)

**Goal**: 七个 Agent 共用分类、记忆隔离和任务恢复规则，但能力回答和缺失字段仍体现各自角色。

**Independent Test**: 用共享样本矩阵调用 `symbol-market`、`symbol-company`、`symbol-technical-options`、`symbol-news`、`symbol-risk`、`symbol-critic`、`symbol-supervisor`，验证分类与边界一致、回答角色不同。

### Tests for User Story 4

- [X] T037 [P] [US4] 在 `apps/platform-api/src/app.integration.spec.ts` 增加七个 Agent 全量意图矩阵测试，覆盖八类意图、工具门禁和任务状态
- [X] T038 [P] [US4] 在 `apps/platform-api/src/symbol-service.spec.ts` 增加不同 Agent needs、观点审查 thesis 缺失和角色能力回答差异测试

### Implementation for User Story 4

- [X] T039 [US4] 在 `apps/platform-api/src/symbol-service.ts` 统一七个 Agent 的路由入口和意图 schema，禁止各 Agent 私自恢复固定缺参模板
- [X] T040 [US4] 在 `apps/platform-api/src/agent-policy-service.ts` 和 `apps/platform-api/src/symbol-context.ts` 为能力回答提供角色化能力边界，同时禁止承诺未启用的数据或交易操作
- [X] T041 [US4] 在 `apps/platform-api/src/memory-service.ts` 和 `apps/platform-api/src/symbol-service.ts` 验证跨 Agent、跨租户、用户删除和 reset 不会污染意图识别上下文

**Checkpoint**: 七个 Agent 的意图路由行为一致，最终回答仍由各自 Agent 自主组织并体现不同职责。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 完成流式一致性、安全审查、回归集和交付前验证。

- [X] T042 [P] 在 `apps/platform-api/src/symbol-router.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 验证路由 metadata、SSE delta、最终 Task、subscribe 重放和 `messageSource` 一致
- [X] T043 [P] 在 `apps/platform-api/src/symbol-intent-service.ts`、`apps/platform-api/src/symbol-context.ts` 和 `apps/platform-api/src/symbol-router.ts` 执行日志、prompt、memory、metadata 的 secret redaction 负例测试
- [X] T044 [P] 在 `apps/platform-api/src/intent-routing-fixtures.ts` 扩展至少 100 组连续多轮样本，并在 `apps/platform-api/src/app.integration.spec.ts` 统计误触发 Provider、误澄清和 task 丢失率
- [X] T045 在 `specs/002-complete-intent-routing/quickstart.md` 对照实际测试入口更新并逐项执行本 feature 的 focused validation
- [X] T046 在 `apps/platform-api/src/symbol-intent-service.spec.ts`、`apps/platform-api/src/symbol-service.spec.ts`、`apps/platform-api/src/symbol-router.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 运行 focused tests、全量 build/test 并记录真实失败/降级状态
- [X] T047 在 `scripts/verify-platform.ts` 增加不打印凭据的受控真实 DeepSeek 路由 smoke，验证能力咨询、帮我分析苹果、澄清回复和连续追问四条线上路径
- [X] T048 在 `specs/002-complete-intent-routing/verification.md` 记录本地测试、真实模型 smoke、CI、部署和公网复验的分层证据；未执行的门禁必须明确标记

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖；T001-T003 可并行。
- **Phase 2 (Foundational)**: 依赖 Phase 1；T004/T005 先稳定契约，T006/T007 完成兼容持久化，T008/T009 可并行但依赖类型稳定。
- **Phase 3 (US1)**: 依赖 Phase 2；T010-T012 可并行，之后 T013 → T014 → T015/T016/T017 → T018/T019。
- **Phase 4 (US2)**: 依赖 US1 的识别与路由入口；T020-T022 可并行，之后 T023/T024 → T025/T026/T027/T028。
- **Phase 5 (US3)**: 依赖 US1、US2；T029-T031 可并行，之后 T032/T033 → T034/T035/T036。
- **Phase 6 (US4)**: 依赖 US1-US3；T037/T038 可并行，之后 T039/T040/T041。
- **Phase 7 (Polish)**: 依赖需要交付的用户故事；T042-T045 可并行，T046-T048 最后收口。

### User Story Dependencies

- **US1 (P1)**: 依赖 Foundational，是 MVP；证明能力咨询不再进入缺标的路径。
- **US2 (P1)**: 依赖 US1 的统一识别入口；补齐活动 task/context 恢复和澄清循环。
- **US3 (P1)**: 依赖 US1 的路由闸门和 US2 的任务合并；将研究类意图安全接回现有 Provider/graph。
- **US4 (P2)**: 依赖前三个故事；对七个 Agent 做一致性收口，不改变各自研究能力。

### Parallel Opportunities

- T001-T003 可并行建立样本、类型和测试入口。
- T006/T007 与 T008/T009 在契约稳定后可并行。
- 每个用户故事的测试任务可并行编写，完成后按“测试失败 → 实现 → 集成”收口。
- T029-T031 的 Provider 门禁、A2A 契约和集成 spy 测试可并行。
- Polish 阶段的 SSE、一致性、secret redaction 和回归集可并行。

## Parallel Example: User Story 1

```text
Task T010: 结构化八类意图与 route 决策失败测试 in apps/platform-api/src/symbol-intent-service.spec.ts
Task T011: 能力咨询不进入 INPUT_REQUIRED 的服务测试 in apps/platform-api/src/symbol-service.spec.ts
Task T012: 七个 Agent 能力咨询 API/SSE 回归测试 in apps/platform-api/src/app.integration.spec.ts
```

## Implementation Strategy

### MVP First

1. 完成 Phase 1-2，锁定结构化契约、旧会话兼容和有界上下文。
2. 完成 US1，首先修复“你能做什么”被误判为缺少股票代码的问题。
3. 执行 US1 独立测试，确认七个 Agent 都不调用 Provider，再进入多轮恢复。

### Incremental Delivery

1. US1 → 能力咨询/闲聊/越界自然回答。
2. US2 → 苹果、1、什么东西、纠正和 follow-up 恢复原任务。
3. US3 → 研究类意图重新接入目标解析和现有数据链路。
4. US4 → 七 Agent 统一收口和角色差异验证。
5. Polish → 流式、回归集、真实模型 smoke、CI/部署证据。

### Completion Criteria

- [ ] 所有任务都采用 `- [ ] Txxx [P?] [USx?] 描述 + 明确文件路径` 格式。
- [ ] 每个用户故事都有独立测试、实现任务和 checkpoint。
- [ ] 能力咨询不会返回 `TASK_STATE_INPUT_REQUIRED`，也不会调用市场数据。
- [ ] 研究缺标的不会调用 Provider，澄清回复能复用原 task/context。
- [ ] 七个 Agent 的路由边界一致，协议状态与 Agent 文本可区分。
- [ ] 未配置真实凭据时不把 real-model smoke 或部署验证标记为通过。
