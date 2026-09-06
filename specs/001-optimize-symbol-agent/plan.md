# Implementation Plan: Agent 自主响应、记忆增强与 Symbol 市场分析

**Branch**: `001-optimize-symbol-agent` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

## Summary

本功能把平台拥有的内置 Agent 统一改造成“模型负责理解和表达、平台负责边界和证据”的链路。实现分为三条相互衔接的主线：

1. 在现有 Symbol 意图抽取之后建立统一的 Agent 上下文组装层，消除正常回答、澄清、研究结论和拒绝中的应用固定句子；协议状态、鉴权和真实故障仍由平台负责。
2. 新增可配置的 Agent 策略和记忆服务，以 PostgreSQL 为事实源、Redis 为短期加速缓存，保存有来源、时效、置信度和纠正关系的会话上下文，并在每次模型调用前按策略构造有界上下文。
3. 通过服务端 Longbridge Provider 拉取标的最新行情、期权链和期权报价，在有权限时计算带口径和假设说明的 Gamma 暴露情景，再交给当前 Agent 生成中文研究报告；无权限、休市、过期或故障都以可观察的降级状态返回。

## Technical Context

**Language/Version**: Node.js 22 / TypeScript 5.9，ESM

**Primary Dependencies**: Express 5、Zod、`@a2a-js/sdk`、LangGraph/Postgres checkpointer、Vercel AI SDK/DeepSeek 兼容 Chat Completions、`pg`、Redis；新增官方 Longbridge Node SDK `longbridge`，通过内部 Provider 接口隔离供应商实现

**Storage**: PostgreSQL 是会话、Agent 策略、记忆和研究运行的权威存储；Redis 只缓存有 TTL 的已裁剪上下文/会话读取结果；Longbridge 凭据使用现有 AES-GCM 服务端加密模式，明文不进入模型上下文或持久化记忆

**Testing**: Vitest 单元测试、Supertest API/集成测试、现有 PostgreSQL/Redis 测试边界；Provider 和 Gamma 使用确定性 mock，真实 Longbridge smoke test 仅在显式配置凭据和权限的环境运行；必要时保留 Playwright 流式前端验收

**Target Platform**: Docker 化 Linux 服务端（本地开发支持 Windows PowerShell），通过现有 Express API、A2A HTTP+JSON/JSON-RPC 和 SSE 暴露能力

**Project Type**: 多租户 Web Agent 平台后端 / 内置 Agent 运行时

**Performance Goals**: 意图校验和记忆读取必须是有界的；不得在缺少必需标的时发起行情或研究请求；保持现有 SSE 增量输出路径，模型开始生成后满足 Spec 的 5 秒内出现有意义内容目标；Longbridge 请求按一次研究运行使用一致的时间戳快照并遵守现有上游超时与响应体限制

**Constraints**: 不把自然语言回答、澄清或研究结论写死在应用代码；跨会话/跨 Agent 记忆必须由策略显式开启；租户、用户/调用主体、Agent 和会话必须隔离；Longbridge 美国期权可能需要单独 OPRA 权限，缺失时不得用零值或编造 Gamma；Gamma 只能表达证据驱动的情景和风险，不能变成交易指令；远端第三方 Agent 的内部 prompt/记忆不在平台控制范围内

**Scale/Scope**: 覆盖当前 7 个内置 Symbol Agent 及共用的内置 Agent 链路、所有支持的会话入口和多租户部署；不新增下单、组合管理、个性化投资建议或实时推送订阅产品

## Constitution Check

当前 `.specify/memory/constitution.md` 仍是未填写的 Spec Kit 模板，未提供可执行的项目专属原则、版本或批准日期。因此没有可判定的“违反宪章”项。本计划采用以下仓库已有基线作为设计门槛：复用现有租户鉴权和加密凭据边界；新增共享契约必须有单元、集成和故障测试；外部数据必须带来源、时间和权限状态；流式任务必须以真实最终状态收口；不得把 secret 写入日志、prompt、记忆或响应。

**Phase 0 状态**: 通过。未知项已在 [research.md](./research.md) 中记录并完成决策。

**Phase 1 复核**: 通过。数据模型、API/Provider/流式契约均保留现有 A2A 兼容性，并将新的策略、记忆和市场证据作为扩展字段或内部服务边界接入。

## Project Structure

### Documentation (this feature)

```text
specs/001-optimize-symbol-agent/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── memory-policy.openapi.md
│   ├── market-data-provider.md
│   └── symbol-stream.md
├── checklists/
│   └── requirements.md
└── tasks.md                         # 由 $speckit-tasks 生成，本阶段不创建
```

### Source Code (repository root)

```text
apps/platform-api/
├── migrations/
│   └── 026_agent_memory_symbol_market.sql
└── src/
    ├── agent-policy-service.ts       # Agent 响应/记忆策略解析、校验、版本和审计
    ├── memory-service.ts             # 记忆读写、纠正、删除、裁剪和隔离
    ├── memory-router.ts              # 记忆/策略管理 API；或按现有约定并入 admin-router
    ├── market-data-provider.ts       # Provider 与证据 envelope 的平台接口
    ├── longbridge-provider.ts        # 官方 longbridge SDK 的服务端适配器
    ├── option-gamma-service.ts       # Gamma 单合约、聚合暴露和情景计算
    ├── symbol-context.ts             # 意图、记忆、证据、历史摘要的有界模型上下文
    ├── symbol-service.ts             # 改造意图合并、澄清/研究生成和任务记忆写回
    ├── symbol-graph.ts               # 将 Provider 证据和节点状态写入运行轨迹
    ├── symbol-router.ts              # 保持 A2A/SSE 状态语义，移除伪造内容
    ├── symbol-bootstrap.ts           # 为所有内置 Agent 初始化默认策略
    ├── credential-service.ts         # 复用既有服务端凭据加密能力
    └── __tests__ 或同目录 *.spec.ts  # 延续当前 Vitest 测试布局

apps/platform-api/src/
├── agent-policy-service.spec.ts
├── memory-service.spec.ts
├── longbridge-provider.spec.ts
├── option-gamma-service.spec.ts
├── symbol-context.spec.ts
├── symbol-service.spec.ts
└── app.integration.spec.ts
```

**Structure Decision**: 这是现有 Express/TypeScript 单 API 服务的增量功能，继续使用 `apps/platform-api/src`、同目录 Vitest 和按序 SQL migration。策略与记忆作为可复用服务独立出来，Symbol 只负责业务编排；Longbridge 与 Gamma 通过 Provider/分析器接口隔离，避免把供应商字段或计算口径散落在 `symbol-service.ts`。外部 API 沿用现有 `/api/admin` 鉴权和 `symbol-router` A2A 路径，不另起服务。

## Implementation Sequencing

1. 先落数据库 schema、Zod/domain 类型、默认策略和记忆服务，完成租户/调用主体隔离、删除/纠正和缓存失效测试。
2. 抽出统一上下文构造与 Agent prompt policy，重构 Symbol 的固定 `text` 生成路径；保留协议 envelope 和真实故障状态，验证“苹果”与补充追问的多轮恢复。
3. 增加 Longbridge 凭据配置和 Provider 适配，先实现一次研究运行内的行情/期权快照与透明降级，再接入 Gamma 分析器。
4. 将市场证据、Gamma 假设、来源时间戳和权限状态接入 LangGraph 运行结果及最终 Agent 上下文，完成 SSE 累积文本与最终 Task 一致性。
5. 运行 focused tests、全量 build/test、mock acceptance 和配置凭据后的受控 real-data smoke；部署/推送不属于本次 plan 阶段。

## Complexity Tracking

没有已知的宪章违规，因此本节无额外复杂度豁免。
