# Feature Specification: 内置 Symbol Agent 自然交互优化

**Feature Branch**: `001-optimize-symbol-agent`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "优化内置的 symbol agent。先调用 AI 模型分析用户输入并按 JSON Schema 提取信息；信息不足时自然追问，信息完整后再调用行情数据和 AI 模型，并将结果流式返回前端。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 用公司名称直接开始研究 (Priority: P1)

用户可以直接说“帮我分析苹果”或其他公司名称，Symbol Agent 能理解用户要研究的标的，不要求用户必须先提供股票代码。对于能够唯一匹配到上市标的的公司，系统继续完成研究并返回结果。

**Why this priority**: 这是当前最明显的交互障碍。用户已经提供了足够自然语言信息时，重复要求“代码或公司名称”会让对话看起来像固定表单，而不是智能 Agent。

**Independent Test**: 在新的 Symbol Agent 会话中发送“帮我分析苹果”，验证系统不返回固定格式的补充信息文案，而是完成苹果对应标的的研究或给出基于当前匹配结果的上下文回复。

**Acceptance Scenarios**:

1. **Given** 新的市场行情会话，**When** 用户发送“帮我分析苹果”，**Then** 系统识别出公司名称并尝试匹配唯一交易标的，不要求用户重复输入公司名称或代码。
2. **Given** 公司名称可以唯一匹配到一个上市标的，**When** 标的匹配完成，**Then** 系统继续收集行情证据并返回针对该标的的研究结果。
3. **Given** 公司名称存在多个合理匹配，**When** 系统无法唯一确定标的，**Then** 系统用自然语言说明歧义，并只询问股票代码或上市市场等必要信息。

---

### User Story 2 - 信息不足时进行有上下文的追问 (Priority: P1)

当用户只发送“1”、 “我想研究一家科技公司”或其他无法确定研究目标的内容时，Agent 以当前对话为上下文生成简短、自然的追问；用户补充信息后，Agent 继续同一任务，不重新开始，也不重复已经获得的信息。

**Why this priority**: 追问是所有研究流程的入口。追问内容是否贴合上下文，直接决定用户是否愿意继续提供信息。

**Independent Test**: 先发送无法确定标的的消息，再发送公司名称或代码，验证两轮消息属于同一个任务，并且第二轮能够使用第一轮已保存的上下文继续处理。

**Acceptance Scenarios**:

1. **Given** 会话中尚未确定研究标的，**When** 用户发送“1”，**Then** Agent 用自然语言询问当前缺失的研究目标，不输出固定的“为了继续……请补充……”模板。
2. **Given** Agent 已询问研究目标，**When** 用户回复“苹果”，**Then** Agent 将其识别为上一轮缺失信息的补充，并继续进行标的匹配和研究。
3. **Given** 用户已经提供了研究标的但缺少其他任务要求，**When** Agent 追问，**Then** 追问只针对仍然缺失且对当前 Agent 必需的信息，不重复询问已确认内容。

---

### User Story 3 - 信息完整后获得真实的流式研究结果 (Priority: P1)

当用户直接提供有效交易代码（例如 AAPL）或经过对话补充后目标已确定，Agent 才查询实时或近期行情证据，并基于证据生成中文研究回答。回答应在前端逐步显示，而不是等待完整结果后一次性出现。

**Why this priority**: 研究结果是 Agent 的核心价值；真实证据和流式反馈同时决定结果可信度与等待体验。

**Independent Test**: 发送包含有效交易代码和研究问题的请求，验证前端先收到进行中的增量内容，最终收到完整结果，并且最终内容与任务完成状态一致。

**Acceptance Scenarios**:

1. **Given** 用户提供有效交易代码和研究问题，**When** Agent 开始处理，**Then** 系统不再进行无关的目标追问，而是进入行情证据收集和研究回答阶段。
2. **Given** 行情证据收集成功，**When** AI 生成研究回答，**Then** 前端收到多个按顺序到达的内容增量，并最终收到完整中文回答。
3. **Given** 增量回答已经展示，**When** 任务结束，**Then** 最终任务内容与已展示的回答一致，不出现重复、截断或前后不一致的文本。

---

### User Story 4 - 外部服务异常时保持可解释 (Priority: P2)

当意图解析、标的匹配、行情数据或回答生成服务暂时不可用时，用户能看到明确且自然的失败说明，系统不会伪造研究结果，也不会把失败任务误标为已完成。

**Why this priority**: 金融信息场景对事实准确性要求高。可解释的失败比看似成功但内容不可靠的回答更安全。

**Independent Test**: 分别模拟意图解析失败、行情数据不可用和回答生成失败，验证用户得到对应提示，任务状态准确，且没有虚构数据或固定成功文案。

**Acceptance Scenarios**:

1. **Given** AI 无法返回合法的结构化意图，**When** 用户提交消息，**Then** 系统说明暂时无法理解或处理该请求，并保留可重试的任务上下文。
2. **Given** 行情数据源无法提供证据，**When** Agent 尝试研究目标，**Then** 系统不返回伪造行情，并明确说明数据暂不可用。
3. **Given** 最终回答生成中断，**When** 流式任务结束，**Then** 任务状态反映失败或可重试，而不是报告为成功完成。

### Edge Cases

- 用户同时提供公司名称和疑似代码，但两者不一致时，以用户明确表达为依据并提示冲突，不静默选择其中一个。
- 公司名称对应多个市场或多个同名标的时，不猜测代码，要求用户补充市场或交易代码。
- 用户只提供代码、不提供问题时，市场行情 Agent 可以使用默认的近期表现概览；需要额外研究假设的 Agent 必须继续询问缺失内容。
- 用户在多轮对话中改变研究目标时，最新明确目标覆盖旧目标，但已完成的历史消息仍保留在同一任务记录中。
- AI 返回缺少字段、字段类型错误或超出允许值的结构化结果时，系统不得把未经验证的内容传给行情查询或研究流程。
- 行情服务返回空结果、过期数据或无法唯一匹配时，系统必须告知用户并转为必要的澄清，而不是生成看似确定的结论。
- 用户中途断开流式连接后再次提交同一任务时，系统从已保存的意图和对话上下文继续，不重复创建无关任务。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST first analyze every new or continued Symbol Agent message with an AI intent-extraction step before determining whether to query market data or run research analysis.
- **FR-002**: The intent-extraction result MUST conform to a strict, validated JSON Schema containing the target symbol, company name, asset type, market, analysis period, user question, thesis, missing fields, and confidence; absent values MUST be represented explicitly and invalid results MUST be rejected.
- **FR-003**: System MUST merge newly extracted information with the existing task context and recompute missing required information from the merged result rather than trusting an unvalidated model-provided missing list.
- **FR-004**: A company name MUST satisfy the initial target requirement while it is being resolved; the system MUST not require a ticker merely because the user used a company name.
- **FR-005**: When required information is missing, the system MUST ask a contextual clarification that addresses only the missing information, preserves the current task, and does not query market data or start research analysis.
- **FR-006**: Clarification responses MUST be generated from the current conversation and task context, use natural Chinese, and MUST NOT rely on a fixed sentence template or mechanically repeat the same wording for every request.
- **FR-007**: The system MUST continue the same task after a clarification reply, retaining the prior transcript and recognized intent while allowing a newer explicit user target to update the current target.
- **FR-008**: After the target is sufficiently identified, the system MUST resolve company names through an authoritative market-data search and accept an automatic match only when it is unique and sufficiently confident; ambiguous matches MUST trigger a clarification.
- **FR-009**: The system MUST query market evidence only after the required target information is available and MUST generate the final research response from the returned evidence and the user's current question.
- **FR-010**: Completed research responses MUST be delivered as ordered incremental content to the frontend and MUST end with a final task result that exactly matches the accumulated response.
- **FR-011**: The system MUST persist the task state, recognized intent, transcript, clarification history, and final result so that list, detail, rename, archive, restore, retry, and resumed-conversation behavior remain consistent.
- **FR-012**: The shared behavior MUST apply consistently to every built-in Symbol Agent and every supported conversation entry point, including direct requests and continued tasks.
- **FR-013**: If intent extraction, target resolution, market evidence collection, or final response generation fails, the system MUST return a truthful user-facing error, preserve the failure state accurately, and MUST NOT fabricate data or report an incomplete task as successfully completed.

### Key Entities

- **Symbol Intent**: The validated interpretation of the user's research target and request, including symbol/company name, asset type, market, period, question, thesis, missing information, and confidence.
- **Symbol Conversation**: A persistent task containing the user/Agent transcript, current intent, lifecycle state, and optional research result.
- **Clarification Turn**: A contextual Agent question and the user's subsequent answer used to complete missing intent information within the same conversation.
- **Market Evidence**: Live or recent quote, price history, company information, news, technical, risk, or other source data used to support a research response.
- **Research Report**: The user-facing Chinese answer and its supporting evidence produced after the target and required request information are complete.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a representative acceptance set of at least 20 Chinese natural-language target inputs, at least 90% identify the correct company or symbol; a unique company name such as “苹果” MUST not trigger an unnecessary request for the user to repeat the target.
- **SC-002**: In 100% of incomplete-input acceptance cases, the Agent asks only for information that is still missing and performs no market-data or research call before the required target information is available.
- **SC-003**: In 100% of multi-turn continuation cases covering at least three user turns, the task identifier, conversation context, prior transcript, and previously recognized intent remain available to the next turn.
- **SC-004**: At least 95% of valid target requests in the acceptance environment produce a completed research result based on returned market evidence, while zero failed evidence or model calls produce a fabricated completed report.
- **SC-005**: For at least 95% of completed streaming requests, the user sees the first meaningful response content within 5 seconds after response generation begins and sees the final content without truncation or duplication.
- **SC-006**: Across the acceptance set, 0% of clarification responses use the current fixed-template wording or ask the user to provide information that the conversation already contains.
- **SC-007**: Across simulated model, target-resolution, and market-data failures, 100% of tasks expose an accurate non-success state and a truthful user-facing explanation.

## Assumptions

- Users can provide Chinese natural-language messages and may provide either a company name, a transaction code, or both.
- Existing AI model access and existing market-data access remain available dependencies; this feature does not replace those providers.
- A unique, high-confidence market match is sufficient to proceed without asking for the ticker or market.
- When a company name cannot be uniquely resolved, asking for a ticker and/or market is the default safe clarification.
- The existing authentication, tenant isolation, task persistence, frontend streaming transport, and financial disclaimer behavior remain in scope and are reused.
- This feature applies to the shared built-in Symbol Agent conversation workflow; it does not add new agents, portfolio execution, trading actions, personalized investment advice, or a new market-data provider.
- The initial project constitution is still a template; project-specific principles can be finalized in a later constitution pass without changing this user-facing scope.
