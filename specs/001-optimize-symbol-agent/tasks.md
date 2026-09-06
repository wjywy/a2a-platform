---

description: "Implementation tasks for Agent 自主响应、记忆增强与 Symbol 市场分析"
---

# Tasks: Agent 自主响应、记忆增强与 Symbol 市场分析

**Input**: Design documents from `/specs/001-optimize-symbol-agent/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/)

**Tests**: Spec 为每个用户故事定义了 Independent Test 和故障验收，因此本任务清单包含先写测试、再实现的测试任务。真实 Longbridge smoke 只在显式配置服务端凭据和市场权限的环境执行。

**Organization**: 任务按用户故事分阶段；Phase 1/2 是所有故事的共享基础，后续每个故事都有独立测试标准。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 准备依赖、配置和可重复的测试边界，不改变既有远端 Agent 行为。

- [X] T001 [P] 在 `apps/platform-api/package.json` 增加官方 `longbridge` Node SDK 依赖，并锁定与当前 Node.js 22/TypeScript 5.9 兼容的版本
- [X] T002 [P] 在 `apps/platform-api/src/config.ts` 增加 Longbridge provider 开关、超时、期权范围和上下文预算配置，并为生产环境拒绝不安全默认值
- [X] T003 [P] 在 `apps/platform-api/src/longbridge-provider.spec.ts` 建立 SDK mock、OAuth/权限错误和时间戳 fixture 工厂，不写入真实 token
- [X] T004 [P] 在 `apps/platform-api/src/memory-service.spec.ts` 建立租户、认证主体、会话和记忆策略的隔离 fixture 工厂

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有用户故事依赖的持久化、策略、上下文和 Provider 领域边界。

**⚠️ CRITICAL**: 本阶段完成前不得开始用户故事实现。

- [X] T005 在 `apps/platform-api/migrations/026_agent_memory_symbol_market.sql` 创建 `agent_policies`、`agent_memories` 和 `market_data_credentials` 表、约束、索引，并扩展 `symbol_conversations` 的 memory/evidence/stream 字段
- [X] T006 在 `apps/platform-api/src/agent-policy-service.ts` 定义并校验 Agent response/memory policy、scope/category 白名单、版本控制和默认策略
- [X] T007 在 `apps/platform-api/src/memory-service.ts` 实现 PostgreSQL 权威读写、过期过滤、confidence/recency 排序、superseded 纠正、主体隔离、删除/reset 和 Redis 缓存失效
- [X] T008 在 `apps/platform-api/src/market-data-provider.ts` 定义 `MarketDataProvider`、quote/option evidence envelope、permission/freshness/degraded 状态和 Gamma 输入领域类型
- [X] T009 在 `apps/platform-api/src/market-data-credentials.ts` 实现租户级 Longbridge 加密凭据解析，复用 `credential-service.ts` 的 AES-GCM 和服务端 secret 边界，仅返回 credential summary
- [X] T010 在 `apps/platform-api/src/symbol-context.ts` 实现有界上下文组装，合并最新用户消息、上一轮问题、intent、未解决事项、允许的 memory、Agent policy 和 evidence，并排除 token/内部 prompt/未授权记忆
- [X] T011 在 `apps/platform-api/src/symbol-bootstrap.ts` 为当前 7 个内置 Symbol Agent upsert 显式默认策略，默认只读写 conversation memory、关闭跨会话/跨 Agent memory
- [X] T012 [P] 在 `apps/platform-api/src/agent-policy-service.spec.ts` 覆盖 policy schema、默认值、版本冲突、scope/category 拒绝和固定句子/敏感字段禁止规则
- [X] T013 [P] 在 `apps/platform-api/src/market-data-provider.spec.ts` 覆盖 evidence envelope 的状态、时间戳、新鲜度、权限和不可用字段不填零规则
- [X] T014 在 `apps/platform-api/src/migrate.ts` 与 `apps/platform-api/src/app.integration.spec.ts` 验证 migration 顺序、旧会话兼容、默认策略初始化和租户外键隔离

**Checkpoint**: 基础层可单独通过测试；所有后续故事都只能通过 policy/context/provider/memory 契约访问共享能力。

---

## Phase 3: User Story 1 - 让 Agent 自主组织回答 (Priority: P1) 🎯 MVP

**Goal**: 正常回答、澄清、研究结论和拒绝由当前 Agent 模型结合上下文和证据自主生成，应用只负责协议、安全和真实故障状态。

**Independent Test**: 对同一个内置 Agent 发送至少三种语气/上下文不同的请求，再用两名评审检查内容是否针对当前上下文，并确认普通回答没有应用固定句子。

### Tests for User Story 1

- [X] T015 [P] [US1] 在 `apps/platform-api/src/symbol-service.spec.ts` 先写失败测试：模型生成的澄清/研究文本必须来自 mock Agent 输出，节点结构化 evidence 不得被转换成固定用户文案
- [X] T016 [P] [US1] 在 `apps/platform-api/src/app.integration.spec.ts` 先写失败测试：不同问题和不同租户的响应分别体现各自上下文，且协议 envelope 与 Agent-authored message 可区分

### Implementation for User Story 1

- [X] T017 [US1] 在 `apps/platform-api/src/agent-policy-service.ts` 实现 platform-owned Agent 的角色、中文、安全、证据引用和不确定性 prompt 规则，禁止将单一固定回答句子写入 policy
- [X] T018 [US1] 在 `apps/platform-api/src/symbol-service.ts` 重构 `runAnalysis` 和研究结果模型，使行情/技术/新闻/风险节点只返回结构化 evidence，移除普通成功、澄清和结论中的固定自然语言拼接
- [X] T019 [US1] 在 `apps/platform-api/src/symbol-service.ts` 接入 `symbol-context.ts` 和 Agent policy，让 `generateClarificationResponse`/`generateResearchResponse` 使用当前消息、历史问题、允许记忆和 evidence 生成内容
- [X] T020 [US1] 在 `apps/platform-api/src/symbol-graph.ts` 记录结构化节点证据、模型输入引用和真实运行状态，不把节点状态文本当作用户回答
- [X] T021 [US1] 在 `apps/platform-api/src/symbol-router.ts` 保留 A2A 状态、安全错误和传输 envelope，明确标识 protocol message 与 Agent-authored message，禁止伪造成功研究文本
- [X] T022 [US1] 在 `apps/platform-api/src/symbol-service.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 执行 US1 测试并补充至少 5 个内置 Agent 的上下文差异、固定文案回归和跨租户负例

**Checkpoint**: US1 可以独立证明“模型自主表达、应用只控边界”，且不依赖 Longbridge live credential。

---

## Phase 4: User Story 2 - 记住并控制每个 Agent 的上下文 (Priority: P1)

**Goal**: 每个 Agent 有明确可控的记忆策略；连续追问、纠正、删除和跨主体隔离都能在下一次模型调用中观察到。

**Independent Test**: 同一会话执行主问题、追问、纠正和目标切换；分别关闭读取/写入、执行 reset，并验证跨租户/跨主体始终没有未授权 memory。

### Tests for User Story 2

- [X] T023 [P] [US2] 在 `apps/platform-api/src/memory-service.spec.ts` 先写失败测试：conversation/user/agent/tenant scope、过期、superseded、删除、Redis 失效和跨租户/主体查询必须符合策略
- [X] T024 [P] [US2] 在 `apps/platform-api/src/app.integration.spec.ts` 先写失败测试：策略读取/修改、用户查看/删除/reset、管理员 reset 的角色和错误码符合 `memory-policy.openapi.md`

### Implementation for User Story 2

- [X] T025 [US2] 在 `apps/platform-api/src/memory-service.ts` 实现来自用户纠正、约束、实体、未解决问题、摘要和上一轮回答的记忆写回，并用 provenance/recency/confidence 控制覆盖优先级
- [X] T026 [US2] 在 `apps/platform-api/src/symbol-context.ts` 接入记忆策略读取结果，保证每次模型调用包含 bounded summary、上一轮问题和最新纠正，同时不读取被删除或 superseded 内容
- [X] T027 [US2] 在 `apps/platform-api/src/memory-router.ts` 实现用户 memory GET/DELETE/reset 和管理员 policy/memory GET/reset API，使用现有 principal/tenant role，不接受正文自报 userId 或 tenantId
- [X] T028 [US2] 在 `apps/platform-api/src/app.ts` 挂载 `memory-router.ts`，并在 `apps/platform-api/src/admin-router.ts` 复用现有审计与管理员访问控制，不泄露 memory 内容或资源存在性
- [X] T029 [US2] 在 `apps/platform-api/src/symbol-service.ts` 写入 memory references、bounded summary、纠正历史和删除后最小任务状态，支持原 task/context 的连续恢复
- [X] T030 [US2] 在 `apps/platform-api/src/memory-service.spec.ts`、`apps/platform-api/src/app.integration.spec.ts` 执行 US2 测试，并验证 20 组多轮追问/纠正中上下文没有静默丢失

**Checkpoint**: US2 可以独立通过 API 和 service 测试验证策略可控、记忆可删除、主体隔离和多轮恢复。

---

## Phase 5: User Story 3 - 用自然语言完成 Symbol Agent 的标的收集 (Priority: P1)

**Goal**: “帮我分析苹果”先由 AI 严格结构化解析，唯一公司名可直接解析为标的；信息不足时只由 Agent 生成上下文澄清，并在同一任务继续。

**Independent Test**: 覆盖“帮我分析苹果”、单独“1”、先代码后问题、公司名/代码冲突、歧义公司名和第二轮补充，验证 intent merge、missing 重算和任务恢复。

### Tests for User Story 3

- [X] T031 [P] [US3] 在 `apps/platform-api/src/symbol-service.spec.ts` 先写失败测试：苹果公司名唯一匹配时不要求重复代码，模型 malformed intent 被拒绝，missing 必须由合并后的 intent 重算
- [X] T032 [P] [US3] 在 `apps/platform-api/src/symbol-router.spec.ts` 先写失败测试：输入不完整只产生 `TASK_STATE_INPUT_REQUIRED`，且在 target 缺失时没有 quote/chart/option provider 调用

### Implementation for User Story 3

- [X] T033 [US3] 在 `apps/platform-api/src/symbol-service.ts` 扩展严格 intent schema、会话 memory merge 和冲突检测，优先最新明确用户纠正，不静默用代码覆盖公司名
- [X] T034 [US3] 在 `apps/platform-api/src/symbol-service.ts` 重构公司名解析与 `missingIntentFields`，只接受唯一且充分可信的 provider match，歧义时保留候选证据并交给 Agent 生成最小澄清
- [X] T035 [US3] 在 `apps/platform-api/src/symbol-service.ts` 保持 collecting task 的 taskId/contextId/transcript/clarification history，用户补充“苹果”、代码或问题后继续原任务而不是创建无关任务
- [X] T036 [US3] 在 `apps/platform-api/src/symbol-service.spec.ts`、`apps/platform-api/src/symbol-router.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 执行 US3 场景，覆盖至少 20 个中文标的输入和跨轮纠正

**Checkpoint**: 直接复现用户问题的“帮我分析苹果”链路可以在无 Longbridge live credential 时使用 provider/model mock 独立验收。

---

## Phase 6: User Story 4 - 使用长桥实时行情和期权 Gamma 进行股票研究 (Priority: P1)

**Goal**: 标的确认后拉取 Longbridge quote、期权链和期权报价，在权限可用时生成带公式/假设/时间戳的 Gamma 情景；权限不足或数据过期时透明降级。

**Independent Test**: 用 mock provider 验证 quote/option/Gamma 完整路径和字段缺失；再用已配置权限的 `AAPL.US` 受控 smoke 验证真实时间戳、权限和降级状态。

### Tests for User Story 4

- [X] T037 [P] [US4] 在 `apps/platform-api/src/longbridge-provider.spec.ts` 先写失败测试：`CODE.MARKET` 映射、实时 quote、option chain/quote、休市/延迟、OAuth/OPRA 权限错误和时间戳不一致
- [X] T038 [P] [US4] 在 `apps/platform-api/src/option-gamma-service.spec.ts` 先写失败测试：1% GEX 公式、contractMultiplier、call/put 假设、多到期日聚合、缺失字段排除和 Gamma 接近零
- [X] T039 [P] [US4] 在 `apps/platform-api/src/app.integration.spec.ts` 先写失败测试：行情可用但期权 degraded 时报告可完成且标记降级；无行情或模型失败时不能返回伪造 completed report

### Implementation for User Story 4

- [X] T040 [US4] 在 `apps/platform-api/src/longbridge-provider.ts` 使用官方 `longbridge` SDK 实现只读 quote/option chain/option quote adapter，完成字段校验、超时、并发限流和权限错误映射；官方 OAuth 交互式生命周期边界由 T062 单独跟踪
- [X] T041 [US4] 在 `apps/platform-api/src/option-gamma-service.ts` 实现 per-contract Gamma、`grossGammaExposure`、`modeledSignedGammaExposure`、按行权价/到期日聚合和情景 levels，显式返回公式、假设、排除项与限制
- [X] T042 [US4] 在 `apps/platform-api/src/symbol-graph.ts` 接入一次研究运行内一致的 Longbridge evidence snapshot 和 Gamma result，保存 provider/permission/freshness/asOf/fetchedAt，不持久化原始 token 或无界响应
- [X] T043 [US4] 在 `apps/platform-api/src/symbol-service.ts` 只在目标已确认且问题涉及行情/未来走势/期权/风险时请求相应 evidence，把 quote/option/Gamma 交给当前 Agent 解释事实、推断和不可用字段
- [X] T044 [US4] 在 `apps/platform-api/src/symbol-context.ts` 增加市场证据 prompt 规则，要求区分 Longbridge/fallback、live/delayed/stale、gross/modeled Gamma 和非投资建议，不允许模型把缺失数据当零
- [X] T045 [US4] 在 `apps/platform-api/src/longbridge-provider.spec.ts`、`apps/platform-api/src/option-gamma-service.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 执行 US4 mock 验收，并在 `scripts/verify-platform.ts` 增加不打印凭据的受控 Longbridge smoke 检查入口

**Checkpoint**: US4 在无权限时能真实降级，在 mock/有权限环境能输出带时间戳、公式、假设和限制的 Gamma 证据；不包含下单能力。

---

## Phase 7: User Story 5 - 在连续流式回答中保持一致和可解释 (Priority: P2)

**Goal**: Agent-authored delta、最终 Task、artifact、记忆和研究证据一致；断线、模型/记忆/provider 故障都保持真实状态。

**Independent Test**: 覆盖成功、部分数据不可用、模型中断和客户端重连，比较 SSE 累计文本、最终 Task、持久化会话和 evidence。

### Tests for User Story 5

- [X] T046 [P] [US5] 在 `apps/platform-api/src/symbol-router.spec.ts` 先写失败测试：SSE delta 有序累计、首个 WORKING 事件无伪造文本、最终 Task 文本与最后累计内容完全一致
- [X] T047 [P] [US5] 在 `apps/platform-api/src/app.integration.spec.ts` 先写失败测试：stream close/重连复用 task/context，model/memory/quote/option 失败映射为真实 failed/degraded 状态

### Implementation for User Story 5

- [X] T048 [US5] 在 `apps/platform-api/src/symbol-router.ts` 记录累计文本 hash/长度和事件序号，确保 SSE delta、最终 Task、artifact text 不重复、不截断、不矛盾
- [X] T049 [US5] 在 `apps/platform-api/src/symbol-service.ts` 将 stream state、memory references、evidence status 和最终结果同事务写入会话，支持断线后读取同一 task/context
- [X] T050 [US5] 在 `apps/platform-api/src/symbol-graph.ts` 统一节点失败、部分 provider 缺失、模型中断和取消的 run/event 状态，禁止失败路径伪造 completed
- [X] T051 [US5] 在 `apps/platform-api/src/symbol-router.spec.ts`、`apps/platform-api/src/symbol-stream-service.spec.ts`、`apps/platform-api/src/app.integration.spec.ts` 和现有 Playwright 测试入口执行 US5 验收；服务端断开后继续执行并按 task 重放累计 SSE，前端 transport 已接入同 task subscribe，最终 Task 与前端累计文本一致

**Checkpoint**: 所有成功/降级/失败/取消状态都能从 SSE、最终 Task、会话和 run trajectory 互相解释。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 完成跨 Agent 一致性、安全、性能、文档和交付验证。

- [X] T052 [P] 在 `apps/platform-api/src/symbol-bootstrap.ts` 和 `apps/platform-api/src/agent-policy-service.ts` 将自主响应/记忆策略应用到全部平台拥有的内置 Agent，并验证远端第三方 Agent 仍保留其协议输出边界
- [X] T053 [P] 在 `apps/platform-api/src/credential-service.ts`、`apps/platform-api/src/market-data-credentials.ts` 和 `apps/platform-api/src/longbridge-provider.ts` 执行 secret redaction、日志审查和敏感字段负例测试
- [X] T054 [P] 在 `apps/platform-api/src/memory-service.ts` 和 `apps/platform-api/src/symbol-context.ts` 对 memory 条数、字符数、transcript 和 option chain 做预算/性能测试，确认读取有界且缓存失效不会返回旧内容
- [X] T055 在 `specs/001-optimize-symbol-agent/quickstart.md` 更新实际环境变量、租户凭据录入、mock 验收和 Longbridge smoke 命令，并逐项执行 quickstart
- [X] T056 在 `apps/platform-api/src/symbol-service.spec.ts`、`apps/platform-api/src/memory-service.spec.ts`、`apps/platform-api/src/longbridge-provider.spec.ts`、`apps/platform-api/src/option-gamma-service.spec.ts` 和 `apps/platform-api/src/app.integration.spec.ts` 运行 focused tests、全量 build/test，并保存失败/降级/恢复证据
- [X] T057 在 `scripts/verify-platform.ts`、`infra/docker-compose.yml` 和 `.github/workflows` 的现有验证入口确认 migration、API health、真实 Agent SSE 和 Longbridge 配置状态；未配置真实凭据时明确标记 smoke 未执行，不伪造通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖；T001-T004 可并行。
- **Phase 2 (Foundational)**: 依赖 Phase 1；T012/T013 可在 T006/T008 的接口稳定后并行，其余按 T005 → T006/T007/T008/T009 → T010/T011 → T014 收口。
- **Phase 3 (US1)**: 依赖 Phase 2；T015/T016 可并行，之后 T017 → T018/T019/T020/T021 → T022。
- **Phase 4 (US2)**: 依赖 Phase 2 和 US1 的上下文边界；T023/T024 可并行，之后 T025/T026 → T027/T028/T029 → T030。
- **Phase 5 (US3)**: 依赖 US1 的模型表达和 US2 的会话记忆；T031/T032 可并行，之后 T033/T034 → T035 → T036。
- **Phase 6 (US4)**: 依赖 Phase 2、US1 的 evidence-only 约定和 US3 的目标解析；T037/T038/T039 可并行，之后 T040/T041 → T042/T043/T044 → T045。
- **Phase 7 (US5)**: 依赖 US1-US4 的最终文本、记忆和 evidence 结构；T046/T047 可并行，之后 T048/T049/T050 → T051。
- **Phase 8 (Polish)**: 依赖所有需要交付的用户故事；T052-T055 可并行，T056/T057 在相关修改完成后执行。

### User Story Dependencies

- **US1 (P1)**: 依赖 Foundational；是自主回答的 MVP 基础。
- **US2 (P1)**: 依赖 Foundational，可独立测试；与 US1 的 `symbol-context` 接口集成。
- **US3 (P1)**: 依赖 US1 的 Agent-authored clarification 和 US2 的持续上下文，用于修复“苹果”主路径。
- **US4 (P1)**: 依赖 US1 的 evidence-only 节点和 US3 的已确认 target；Provider/Gamma 单元测试可独立并行。
- **US5 (P2)**: 依赖所有前置输出的最终结构和状态，用于证明整条链路可恢复。

### Parallel Opportunities

- Phase 1 的依赖安装、配置 schema、Longbridge fixture 和 memory fixture 可并行。
- Phase 2 中 policy schema、Provider domain contract 的单元测试可并行；migration 完成后 memory service 与 credential resolver 可并行开发。
- 每个用户故事的测试任务可先并行编写；US4 的 Provider 测试与 Gamma 测试互不改同一实现文件，可并行。
- US1 完成后，US2 的 API/记忆实现与 US4 的 Longbridge/Gamma 实现可由不同开发者并行，但合并到 `symbol-service.ts` 前需按依赖顺序集成。
- Polish 阶段的安全审计、预算测试、bootstrap 策略和 quickstart 文档可并行；全量验证必须最后执行。

## Parallel Example: User Story 4

```text
Task T037: Longbridge provider contract/error tests in apps/platform-api/src/longbridge-provider.spec.ts
Task T038: Gamma formula/aggregation tests in apps/platform-api/src/option-gamma-service.spec.ts
Task T039: degraded research integration tests in apps/platform-api/src/app.integration.spec.ts
```

这三个测试任务互不依赖实现细节，完成后再由 T040/T041 实现，通过 T042-T045 接入 Symbol 主链路。

## Implementation Strategy

### MVP First

1. 完成 Phase 1-2 基础层。
2. 完成 US1，证明内置 Agent 已不再用应用固定句子代替模型回答。
3. 完成 US3 的“帮我分析苹果”最小路径，验证 AI-first intent、唯一公司名解析和同任务澄清恢复。
4. 在 mock provider 下独立验收，确认自然回答和任务状态后，再接入真实 Longbridge。

### Incremental Delivery

1. Phase 1-2 → 可迁移、可测试的 policy/memory/context/provider 基础。
2. US1 → 自主回答 MVP。
3. US2 → 记忆控制、删除和跨主体隔离。
4. US3 → 自然语言标的收集和多轮恢复。
5. US4 → Longbridge quote/option/Gamma 证据与透明降级。
6. US5 → SSE、断线恢复和全链路一致性。
7. Polish → 全量验证、受控 real-data smoke、部署前证据。

### Completion Criteria

- [X] 所有任务均按 `- [ ] Txxx [P?] [USx?] 描述 + 明确文件路径` 格式书写。
- [X] 每个用户故事都有独立测试标准、测试任务、实现任务和 checkpoint。
- [X] `spec.md` 的 FR-001 至 FR-024、SC-001 至 SC-010 均能在任务或验证任务中追踪。
- [X] 未配置 Longbridge/OPRA 凭据时不把 real-data smoke 标记为通过。

## Phase 9: Convergence

以下任务由本轮 spec/plan/tasks 与当前代码收敛审计追加；它们只补齐自动化验收和受控环境验证，不改变既有 A2A 协议边界。

- [X] T058 在 `apps/platform-api/src/app.integration.spec.ts` 增加 migration 顺序、旧 `symbol_conversations` 兼容、7 个内置 Agent 默认策略和租户外键隔离的专门断言，并验证全新 development compose 能完成内置 Agent bootstrap（FR-004/FR-009，partial）
- [X] T059 [P] 在 `apps/platform-api/src/app.integration.spec.ts` 增加至少 5 个内置 Agent 的模型上下文差异、跨租户负例和协议 envelope/Agent-authored message 分离验收，覆盖不同问题不得复用固定回答（US1/AC1）
- [X] T060 [P] 在 `apps/platform-api/src/app.integration.spec.ts` 增加 memory policy 读写、用户删除/reset、管理员角色错误码、跨租户隔离和多轮纠正上下文验收，并用可重复 fixture 覆盖 20 组 follow-up/correction（US2/AC1）
- [X] T061 [P] 在 `apps/platform-api/src/symbol-router.spec.ts` 与 `apps/platform-api/src/app.integration.spec.ts` 增加至少 20 个中文标的、歧义候选、代码/公司名冲突、同 task/context 补充和缺失 target 不触发 provider 的端到端断言（US3/AC1）
- [ ] T062 在 `apps/platform-api/src/longbridge-provider.ts`、`apps/platform-api/src/market-data-credentials.ts` 明确官方 OAuth token 生命周期的服务端接入边界并补 OAuth/OPRA 权限错误 fixture；在受控凭据环境执行 `AAPL.US` quote、option chain、option quote 和 Gamma smoke（FR-015/FR-016/FR-017，当前仅剩真实凭据 smoke）
- [X] T063 在 `apps/platform-api/src/symbol-service.ts`、`apps/platform-api/src/symbol-router.ts`、`apps/platform-api/src/symbol-stream-service.ts`、`apps/admin-console/src/a2a-chat-transport.ts` 与集成测试中完成真实状态降级、客户端断开后后台继续执行、同 task/context 重连、累计 SSE 重放及持久化 stream state/evidence/memory references/最终 Task 一致性验收；真实 DeepSeek/Longbridge smoke 仍受 T062 外部凭据门槛约束
