# Research: Symbol Agent 完整意图识别与自然路由

**Date**: 2026-09-05
**Scope**: 当前 `a2a-agent-platform` 的七个内置 Symbol Agent、现有会话记忆和 A2A/SSE 路由

## 当前链路观察

- `apps/platform-api/src/symbol-service.ts` 已经使用结构化模型调用提取 `symbol`、`companyName`、`question`、`thesis` 和 `missing`。
- `handleSymbolMessage` 当前在 `extractIntent` 后直接检查 `intent.missing`，之后才执行公司名解析。这使所有“没有标的”的输入先进入同一个澄清路径。
- `generateClarificationResponse` 已经调用当前模型生成文本，但它收到的系统任务被限定为“只追问缺失字段”，因此不能纠正上游把能力咨询误判成研究请求的问题。
- `symbol-context.ts`、`memory-service.ts` 和 `agent-policy-service.ts` 已经提供 transcript、bounded summary、记忆权限和 Agent 角色上下文，可作为识别与回答的输入边界。
- `symbol-router.ts` 已经区分流式 protocol event 与 agent-authored text，可扩展路由 metadata 而不改变 A2A Task 状态协议。

## 方案比较

### 方案 A：纯规则/关键词路由

**Decision**: 不作为主方案。

**Rationale**: 速度快、可解释、无需模型调用，但无法稳定处理“刚才那个”“什么东西”“苹果那家公司”“详细一点”等上下文表达，也容易把关键词命中误当作研究意图。

### 方案 B：纯大模型自由文本路由

**Decision**: 不采用。

**Rationale**: 能理解自然语言，但自由文本不能作为安全路由契约；格式漂移、缺少字段、幻觉标的和不可审计会直接影响 provider 调用。

### 方案 C：大模型结构化识别 + 服务端校验与路由闸门

**Decision**: 采用首版。

**Rationale**: 模型处理语义、指代、上下文和自然表达；结构化契约让服务端可以校验枚举、字段长度、租户/记忆边界和目标冲突；服务端重算缺失字段并决定是否允许工具调用，避免模型绕过前置条件。

**Trade-off**: 每条消息多一次识别模型调用，会增加延迟和成本；通过有界上下文、短结构化输出、缓存能力声明和 focused smoke 控制风险。

### 方案 D：让当前 Agent 直接自主选择工具和流程

**Decision**: 作为后续演进方向，不作为首版路由基础。

**Rationale**: 交互自然，但在“能力咨询不应调用行情”“无标的不能调用 provider”“跨 Agent 记忆隔离”等边界上，工具选择不能替代服务端授权闸门。首版先把意图契约和调用门禁稳定下来。

### 方案 E：专用意图分类模型或 Embedding 检索

**Decision**: 暂不采用。

**Rationale**: 可降低长期延迟和调用成本，但需要高质量标注集、持续评估和模型维护。首版先用结构化大模型积累真实路由样本，后续可在同一契约下替换分类器。

## 结论

首版采用方案 C，并将识别器视为可替换组件。路由契约不依赖具体模型供应商；模型只负责提出结构化判断，服务端负责最终授权。对外可见文本仍由当前 Agent 根据角色、记忆和证据生成，协议 envelope 和真实错误由平台生成。

## 待后续评估

- 使用真实中文回归集校准低置信度策略，而不是把模型的 confidence 当作绝对事实。
- 统计“能力咨询误触发 provider”“研究请求误进入澄清”“澄清回复丢失 task”三类错误，作为后续模型/规则优化依据。
- 当样本量足够时，再评估专用分类器是否能在不降低准确率的情况下替换结构化识别模型。
