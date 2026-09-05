# Feature Specification: Agent 自主响应、记忆增强与 Symbol 市场分析

**Feature Branch**: `001-optimize-symbol-agent`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "所有 Agent 链路都不应自行限定输出语句，最多用 prompt 控制；每个 Agent 都要有可控制、不会遗忘上下文的记忆机制；股票 Agent 要拉取长桥实时数据和期权数据，并使用 Gamma 分析股票后续走势。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 让 Agent 自主组织回答 (Priority: P1)

用户向任意平台内置 Agent 提出问题时，回答由当前 Agent 根据角色、对话记忆和工具证据自主组织。系统可以通过 prompt 约束语言、事实边界、安全规则和输出结构，但不能在链路中用固定句子替代 Agent 的自然回答。

**Why this priority**: 固定文案会让不同 Agent 对不同问题表现出相同的机械行为，也会掩盖上下文丢失和工具结果未被理解的问题。回答自主性是所有后续 Agent 能力的基础。

**Independent Test**: 使用同一个 Agent 发送至少三种语气、上下文和问题类型不同的请求，检查回答是否针对当前输入和历史内容变化，并确认没有命中固定追问或固定结论模板。

**Acceptance Scenarios**:

1. **Given** 用户向任意内置 Agent 提出具体问题，**When** Agent 生成回答，**Then** 用户看到的是结合当前问题、Agent 角色和可用证据组织的回答，而不是代码预置的一段固定句子。
2. **Given** 两个用户提出相同主题但上下文不同的问题，**When** Agent 分别回答，**Then** 回答能够体现各自上下文中的目标和约束，不把一个用户的内容带给另一个用户。
3. **Given** Agent 需要澄清、拒绝或说明数据不足，**When** Agent 回复用户，**Then** 这些自然语言内容也由 Agent 根据当前上下文生成；系统只保留协议状态、安全边界和必要的故障兜底，不伪造 Agent 内容。

---

### User Story 2 - 记住并控制每个 Agent 的上下文 (Priority: P1)

用户连续追问时，每个 Agent 都能记住当前会话中已经讨论过的问题、目标、约束和待解决事项，不会因为上一轮已经输出过答案就忘记用户正在追问什么。用户和管理员可以控制记忆是否启用、能读取哪些范围、能写入哪些内容以及如何清除。

**Why this priority**: 没有稳定的记忆，Agent 只能逐条回答孤立问题，无法形成真正的连续协作；没有控制能力，记忆又会带来隐私、越权和错误信息长期传播风险。

**Independent Test**: 在同一会话中连续提出主问题、追问、纠正和切换目标，验证 Agent 能引用相关历史并遵守最新纠正；再通过记忆开关、清除和跨用户隔离测试验证控制生效。

**Acceptance Scenarios**:

1. **Given** 用户先询问某支股票，再追问“刚才提到的风险哪个最重要”，**When** Agent 回复，**Then** Agent 能识别“刚才”所指的上一轮标的和风险结论，不要求用户重复完整问题。
2. **Given** 用户在后续消息中纠正先前的标的、时间范围或研究假设，**When** Agent 继续处理，**Then** 最新明确内容覆盖冲突的旧记忆，并在必要时说明修正后的理解。
3. **Given** 某 Agent 的记忆读取或写入范围被关闭，**When** 用户继续对话，**Then** Agent 遵守该策略，不读取或写入被禁止范围，并向用户自然说明可用上下文边界。
4. **Given** 用户请求查看、删除或重置该 Agent 保存的记忆，**When** 操作完成，**Then** 被删除内容不再参与后续回答，同时保留不包含已删除内容的必要任务状态。
5. **Given** 两个不同用户或租户拥有相似的 Agent 会话，**When** 任一用户继续追问，**Then** Agent 只能读取当前授权范围内的记忆，不发生跨用户或跨租户泄漏。

---

### User Story 3 - 用自然语言完成 Symbol Agent 的标的收集 (Priority: P1)

用户可以直接说“帮我分析苹果”、股票代码或补充性追问。Symbol Agent 先让 AI 结构化理解最新消息和历史上下文，再判断是否缺少必要信息；只有确实缺少时，才由 Agent 自主生成贴合上下文的澄清问题，并在用户补充后继续同一任务。

**Why this priority**: 这是当前 Symbol Agent 的直接体验问题，也是 Agent 自主响应和记忆机制能否落地的最小可见场景。

**Independent Test**: 分别测试“帮我分析苹果”、只说“1”、先提供代码再补充问题、以及在第二轮纠正标的，验证意图抽取、澄清、记忆合并和任务恢复的顺序。

**Acceptance Scenarios**:

1. **Given** 新的 Symbol 会话，**When** 用户发送“帮我分析苹果”，**Then** 系统先结构化识别公司名称和研究意图，不输出固定的代码补充文案。
2. **Given** 公司名称能唯一匹配上市标的，**When** 匹配成功，**Then** Symbol Agent 直接进入研究流程，不要求用户重复提供代码。
3. **Given** 用户只发送“1”或无法确定标的的内容，**When** Agent 需要补充信息，**Then** Agent 根据当前对话自主生成自然中文追问，只询问仍然必要的信息。
4. **Given** Agent 已发起澄清，**When** 用户随后回复公司名、代码或研究问题，**Then** 系统在原任务中合并新旧意图，不重新创建无关任务，也不遗忘上一轮问题。

---

### User Story 4 - 使用长桥实时行情和期权 Gamma 进行股票研究 (Priority: P1)

当股票目标已经明确时，股票 Agent 获取长桥提供的最新行情及时间戳；在期权权限和数据可用时，进一步获取期权链、合约行情、成交量、持仓量、隐含波动率及 Gamma 等相关数据。Agent 基于这些证据分析不同价格情景下的潜在支撑、阻力和波动风险，并清楚区分事实、推断和不确定性。

**Why this priority**: 实时行情和期权定位信息能补足单一历史价格分析的局限，是股票 Agent 从基础问答升级为研究工具的关键价值。

**Independent Test**: 对一个有期权数据权限的美股标的执行实时行情和期权分析，验证数据带有时间戳、Gamma 计算有假设和范围说明；再模拟无期权权限、市场休市、数据过期和数据源故障，验证系统如实降级。

**Acceptance Scenarios**:

1. **Given** 股票标的已确认且长桥行情可用，**When** Agent 开始研究，**Then** 研究证据包含最新价、涨跌、成交量、交易状态和数据时间，并注明数据来源和新鲜度。
2. **Given** 期权链和期权实时权限可用，**When** 用户询问后续走势或期权相关风险，**Then** Agent 获取与到期日、行权价、看涨/看跌方向相关的期权数据，并纳入 Gamma 分析。
3. **Given** 期权数据包含多个到期日和行权价，**When** Agent 分析 Gamma，**Then** Agent 能解释单合约 Gamma 与按合约规模、持仓和价格聚合后的 Gamma 暴露，给出不同价格区间的情景含义，而不是输出一个没有依据的确定涨跌结论。
4. **Given** 长桥没有期权权限或该标的期权数据不可用，**When** 用户请求期权/Gamma 分析，**Then** Agent 说明缺失原因、数据时间和分析限制，不把无权限数据当成零值，也不编造 Gamma 结论。
5. **Given** 市场处于休市、盘前、盘后或数据延迟状态，**When** Agent 输出行情判断，**Then** Agent 明确说明交易时段和数据新鲜度，并避免把延迟价格描述成当前实时成交价。

---

### User Story 5 - 在连续流式回答中保持一致和可解释 (Priority: P2)

用户等待研究结果时，可以看到 Agent 自主生成的增量回答；最终回答、任务状态、记忆和研究证据保持一致。任何模型、记忆或数据源异常都必须以真实状态呈现，不用固定成功文案掩盖失败。

**Why this priority**: 真实研究通常需要多个数据阶段，流式反馈降低等待焦虑；一致的最终状态则避免用户依据半截或过时信息做判断。

**Independent Test**: 运行成功、部分数据不可用、模型中断和客户端重连四类流式场景，比较增量内容、最终任务、会话记忆和数据时间戳是否一致。

**Acceptance Scenarios**:

1. **Given** Agent 已完成必要数据收集，**When** Agent 生成研究回答，**Then** 前端收到有序的自然语言增量，最终内容与已展示内容一致。
2. **Given** 流式连接中断后用户恢复同一任务，**When** Agent 继续回答，**Then** Agent 使用已保存的上下文和证据继续，不把已回答问题当成全新问题。
3. **Given** 任一模型、记忆或数据服务异常，**When** 任务结束，**Then** 任务状态、用户说明和可用数据范围一致，不能伪造完成结果或隐藏数据缺失。

### Edge Cases

- 用户同时说出公司名称和不一致的股票代码时，Agent 必须识别冲突并追问确认，不能由代码静默覆盖公司名。
- 公司名对应多个市场、多个同名公司或多个证券类型时，Agent 必须要求市场/证券类型/代码等最小必要信息。
- 用户切换到另一个 Agent 后继续使用“刚才的风险”之类的指代时，系统只能共享被策略允许的记忆；默认不把一个 Agent 的私有记忆隐式复制给另一个 Agent。
- 用户清除记忆后又继续当前任务时，系统保留完成任务所需的最小协议状态，但不再使用已删除的自然语言内容或用户偏好。
- 记忆中包含与当前问题冲突、过期或来源不明的信息时，Agent 必须优先核实最新用户表达和最新数据，并标记不确定性。
- 用户输入中包含要求改变系统规则、泄露其他用户信息或污染记忆的内容时，Agent 必须将其当作普通用户数据处理，不把它升级为系统指令或跨范围记忆。
- 长桥行情权限不足、账户未配置、连接中断或市场不支持时，Agent 必须说明降级状态；不得把权限错误解释为没有交易活动。
- 期权链过大、到期日缺失、报价为空、买卖价异常或 Gamma 接近零时，Agent 必须缩小分析范围或说明无法形成可靠的 Gamma 暴露判断。
- 期权数据时间戳与标的行情时间戳不一致时，Agent 必须在结论中提示时间差，不能把两组数据当成同一时刻的快照。
- Gamma 暴露方向受计算口径、做市商持仓假设或合约乘数影响时，Agent 必须展示口径和假设，不把情景推断表述为确定预测。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every platform-owned Agent MUST generate user-facing conversational content from the active Agent model, current user message, permitted memory, and available evidence; application code MUST NOT substitute fixed conversational sentences for normal answers, clarifications, conclusions, or refusals.
- **FR-002**: Prompts MAY constrain the Agent's role, language, safety boundaries, evidence use, output structure, and uncertainty disclosure, but MUST NOT prescribe a single fixed sentence or force identical wording for materially different contexts.
- **FR-003**: Protocol envelopes, lifecycle states, security notices, and transport errors MAY be generated by the application, but they MUST remain distinguishable from Agent-authored conversational content and MUST NOT pretend to be a research answer.
- **FR-004**: Every platform-owned Agent MUST have an explicit memory policy that controls whether memory is enabled, which scopes it may read, which scopes it may write, what categories are allowed, how long entries remain valid, and who may inspect, reset, or delete them.
- **FR-005**: The default memory scope MUST include the active conversation and its unresolved questions, recognized entities, user corrections, constraints, and prior Agent answers; cross-conversation or cross-Agent memory MUST require an explicit policy permission.
- **FR-006**: Before generating each response, the Agent MUST receive a context package that includes the latest user message, relevant prior turns, a bounded conversation summary, active intent, unresolved questions, and applicable memory entries; the package MUST preserve the relationship between the current question and the immediately preceding question.
- **FR-007**: The memory system MUST record provenance and recency for retained facts, support correction or supersession, and prevent stale or lower-confidence content from silently overriding a newer explicit user statement or newer market evidence.
- **FR-008**: Users MUST be able to inspect and delete or reset memory within their authorized scope, and deletion MUST take effect for subsequent Agent responses without exposing the deleted content in a new answer.
- **FR-009**: Memory reads, writes, updates, and deletions MUST respect tenant and user isolation; an Agent MUST NOT retrieve memory outside its configured scope or use one user's memory for another user.
- **FR-010**: Every new or continued Symbol Agent message MUST first pass through a validated structured intent-extraction step before the system decides whether to ask for information, resolve a target, query market data, or run research analysis.
- **FR-011**: The structured intent result MUST conform to a strict schema containing, at minimum, target symbol, company name, asset type, market, analysis period, user question, thesis, missing fields, and confidence; malformed, incomplete, or out-of-range results MUST be rejected safely.
- **FR-012**: Symbol intent MUST be merged with the permitted conversation memory, and the system MUST recompute missing required fields from the merged result rather than blindly trusting a model-provided missing list.
- **FR-013**: When required information is missing, the active Agent MUST generate a contextual clarification that asks only for the missing information; the system MUST not query market data or start research analysis before the required target is available.
- **FR-014**: A company name MUST be allowed to satisfy the initial target requirement while it is being resolved; automatic ticker selection MUST occur only for a unique, sufficiently confident match, and ambiguous matches MUST result in an Agent-generated clarification.
- **FR-015**: After the target is sufficiently identified, the stock research flow MUST request the configured Longbridge real-time market data, including the latest available price, change, volume, trading status, session, and source timestamp when those fields are available.
- **FR-016**: For stock requests involving future movement, options, volatility, positioning, or risk, the stock research flow MUST request available Longbridge option expiries, strikes, call/put identity, quotes, volume, open interest, implied volatility, contract metadata, and option Greeks including Gamma; unavailable fields MUST be marked unavailable rather than inferred as zero.
- **FR-017**: The Gamma analysis MUST define its calculation scope and assumptions, distinguish per-contract Gamma from aggregate Gamma exposure, account for relevant contract size and positioning fields when available, and present scenario ranges or levels with the data timestamp and limitations.
- **FR-018**: Gamma-based output MUST be framed as evidence-based scenarios and risk analysis, not as a guaranteed price direction, trading instruction, or personalized investment recommendation.
- **FR-019**: The final research response MUST be generated by the active Agent from the user's current question, permitted memory, Longbridge evidence, and any other authorized evidence; it MUST distinguish sourced facts, model interpretation, assumptions, and unavailable data.
- **FR-020**: Completed research responses MUST be delivered as ordered incremental Agent-authored content to the frontend and MUST end with a final task result that matches the accumulated content without duplication, truncation, or contradictory state.
- **FR-021**: The task and conversation record MUST preserve the authorized transcript, memory references or summary, current intent, data timestamps, source/permission status, clarification history, stream state, and final result needed to resume the same task.
- **FR-022**: The shared behavior MUST apply consistently to every platform-owned built-in Agent and every supported conversation entry point; external remote Agents remain responsible for their own internal prompts and memory, while the platform MUST preserve their protocol output and scope boundaries.
- **FR-023**: If the model, memory service, Longbridge market data, option data, or response stream fails, the system MUST expose an accurate non-success or degraded state and a truthful Agent or protocol explanation, and MUST NOT fabricate data, hide missing permissions, or report an incomplete task as successfully completed.
- **FR-024**: All provider credentials and memory controls MUST remain server-side and MUST NOT be included in prompts, user-visible content, persisted Agent memory, or streamed research output.

### Key Entities

- **Agent Response Policy**: The policy for a platform-owned Agent that defines prompt-level behavioral constraints, permitted tools, memory read/write scope, retention, and user controls without prescribing fixed conversational sentences.
- **Agent Memory**: Authorized, time-aware context retained from prior turns, including facts, preferences, corrections, unresolved questions, summaries, source provenance, and expiry or confidence metadata.
- **Symbol Intent**: The validated interpretation of the current Symbol request, including symbol/company name, asset type, market, period, question, thesis, missing information, and confidence.
- **Symbol Conversation**: A persistent task containing the authorized transcript, current intent, memory summary or references, lifecycle state, clarification history, evidence metadata, and optional report.
- **Market Snapshot**: A timestamped Longbridge quote and market-status view for the identified security, including price, change, volume, session, and freshness.
- **Option Chain Snapshot**: A timestamped set of option expiries, strikes, call/put contracts, quotes, volume, open interest, implied volatility, contract metadata, and available Greeks.
- **Gamma Exposure Analysis**: A derived analysis that applies an explicit scope and assumptions to option Gamma, positioning, contract size, and underlying price to describe potential price-level behavior and risk scenarios.
- **Research Report**: The Agent-authored Chinese response that combines user intent, permitted memory, market evidence, option/Gamma analysis, assumptions, timestamps, limitations, and financial-research disclaimers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In an acceptance set of at least 30 prompts across at least five platform-owned Agent types, 100% of normal user-facing responses are generated from the active Agent context and contain no application-owned fixed conversational template; at least 90% are judged context-specific by two independent reviewers.
- **SC-002**: In at least 20 multi-turn conversations containing a follow-up, correction, and target change, at least 95% of responses correctly reference the relevant prior question or latest correction without requiring the user to restate unrelated context.
- **SC-003**: In 100% of cross-user and cross-tenant negative tests, an Agent receives no unauthorized memory entry; in 100% of memory deletion tests, deleted content is absent from subsequent response context.
- **SC-004**: In 100% of policy-control tests, disabling memory read, disabling memory write, changing retention, and limiting scope changes the next Agent context according to the configured policy and produces an observable audit result.
- **SC-005**: In an acceptance set of at least 20 Chinese Symbol target inputs, at least 90% identify the correct company or symbol; a unique company name such as “苹果” does not trigger an unnecessary request to repeat the target.
- **SC-006**: In 100% of incomplete Symbol cases, the Agent asks only for currently missing required information and no market-data or research call occurs before the required target is available.
- **SC-007**: When Longbridge real-time permissions are available, at least 95% of valid stock research requests include a timestamped latest market snapshot and an explicit freshness/session indication; when permissions are unavailable, 100% of responses identify the limitation rather than treating the data as zero or current.
- **SC-008**: For at least 90% of option-enabled acceptance cases, the report includes timestamped option evidence and a Gamma analysis with visible scope, assumptions, and scenario limitations; 0% present Gamma as a guaranteed directional prediction.
- **SC-009**: For at least 95% of completed streaming requests, users see meaningful Agent-authored content within 5 seconds after response generation begins and receive a final response without truncation, duplication, or state contradiction.
- **SC-010**: Across simulated model, memory, quote, option, and stream failures, 100% of tasks expose an accurate failure or degraded state and do not produce a fabricated completed report.

## Assumptions

- The feature applies to all platform-owned built-in Agents and the shared orchestration/conversation path. A remote third-party Agent's internal output and memory remain outside platform control, but the platform will not overwrite its content with fixed sentences.
- “记忆机制” defaults to active-conversation memory. Cross-conversation, cross-Agent, user-profile, or tenant-wide memory is opt-in through explicit policy because broader recall has greater privacy and relevance risk.
- The active Agent model remains responsible for natural-language wording; prompts and schemas constrain behavior and structure, while the application owns only protocol state, safety enforcement, validation, and transport envelopes.
- Longbridge is configured as a read-only market-data dependency with server-side credentials. Quote permissions are market- and product-specific; US options may require a separate OPRA permission, and missing permission is a supported degraded state. Longbridge documents real-time security quotes, option chains, option quotes, and option Greeks including Gamma in separate market-data capabilities.
- “Gamma” means options Greek Gamma and aggregate Gamma Exposure analysis, not a presentation or productivity product. Gamma analysis is probabilistic scenario analysis and does not guarantee future price movement.
- Existing Yahoo or other authorized market-data sources may remain as supplementary or fallback evidence, but the system MUST label each source and MUST NOT silently present delayed or substitute data as Longbridge real-time data.
- The stock Agent may use a bounded default analysis window when the user omits a period, but it must ask for a period or thesis when that information is essential to the selected Agent's task.
- The existing authentication, tenant isolation, task persistence, frontend streaming transport, and financial-research disclaimer remain in scope and are reused.
- This feature does not add trade execution, portfolio orders, personalized investment advice, or an automatic buy/sell recommendation.
- The project constitution remains the generated Spec Kit template until a separate constitution pass establishes project-specific principles.

## External References

- [Longbridge real-time security quotes](https://open.longbridge.com/docs/quote/pull/quote)
- [Longbridge option quotes and available Greeks](https://open.longbridge.com/docs/quote/pull/option-quote)
- [Longbridge option chain and option volume capabilities](https://open.longbridge.com/docs/cli/derivatives/option)
