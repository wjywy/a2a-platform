# Research: Agent 自主响应、记忆增强与 Symbol 市场分析

## 研究范围

本阶段只解决实现方案中的技术未知项，不改变功能规格。重点核对现有 Symbol 链路、租户/凭据边界、会话持久化、Longbridge 数据能力，以及 Gamma 暴露的计算口径。

## 决策 1：统一“上下文 + 证据 + 策略”后再调用模型

**决定**：保留当前 `extractIntent` 的严格结构化调用作为 Symbol 链路第一步，但将其扩展为“最新消息 + 允许的历史摘要 + 当前意图”的解析输入；后续澄清和研究回答都通过统一的 `symbol-context` 组装器调用当前 Agent 模型。`runAnalysis` 等业务节点只返回结构化证据，不再返回面向用户的固定 `text`。应用只生成 A2A 状态、错误码、鉴权和传输 envelope。

**原因**：现有 `symbol-service.ts` 已有严格工具 schema、公司名唯一匹配、PostgreSQL 会话和 SSE delta，但行情/技术/新闻等节点仍直接拼接固定句子。继续在每个节点增加文案会重复制造当前问题；集中组装能让内置 Agent 共享记忆和安全规则，同时保持远端第三方 Agent 的原始协议输出不被平台改写。

**模型边界**：

- 意图抽取模型只能产生经过 Zod 校验的结构化对象，应用根据合并后的对象重新计算 `missing`，不盲信模型的缺失列表。
- 自然语言澄清、研究报告和正常拒绝由当前 Agent 模型生成；prompt 可要求中文、引用证据、披露不确定性和遵守金融安全边界，但不能指定固定句子。
- 模型不可用时可以返回明确的协议级失败/降级状态和技术原因，但该内容必须标记为平台故障说明，不能伪装成研究结论。

**放弃的方案**：仅替换现有几段固定文案。它不能解决不同 Agent 共用上下文、追问恢复、证据时间戳和故障一致性问题。

## 决策 2：PostgreSQL 权威记忆，Redis 只做可失效缓存

**决定**：新增 Agent 策略和记忆条目表；现有 `symbol_conversations` 继续保存任务生命周期、当前意图、授权 transcript 和最终结果，并增加摘要/证据/记忆引用字段。每次模型调用前由记忆服务按策略返回有界的 `MemoryContext`，写入先落 PostgreSQL，再删除或更新 Redis 缓存。Redis 不被当作唯一记忆来源。

**策略内容**：每个平台注册 Agent 至少有一份显式策略，包含 `enabled`、允许读取/写入的 scope、允许的记忆 category、保留天数、最大条目/上下文预算、是否允许用户查看/删除，以及是否允许跨会话或跨 Agent 读取。默认只启用当前会话；跨会话、跨 Agent、用户画像和租户共享均默认关闭。

**身份与隔离**：

- 所有查询以 `tenant_id + agent_id/slug + conversation_id` 为最低隔离条件。
- 当前会话默认以不可猜测的 `context_id`/`conversation_id` 作为记忆主体，因此用户不需要额外提供 user id。
- 需要跨会话时，主体只能来自已认证平台用户、Studio 会话 `created_by` 或网关认证后的 API Key 身份；不得接受消息正文中自称的 user id。外部 API 若只有租户级 API Key，则只能使用该调用主体的显式授权范围。
- 删除/重置使用同样的主体条件和管理员鉴权；跨租户、跨 Agent 的 SQL 查询必须在服务层和集成测试中双重验证。

**记忆质量**：每条记忆都带来源类型、来源会话/消息、创建和最后验证时间、置信度、有效期、纠正/替代关系以及敏感类别标记。新的明确用户陈述优先于旧推断；冲突条目被标记为 superseded，而不是静默覆盖或继续同时送入模型。读取前按 freshness、confidence 和策略 category 过滤，并限制条数/字符数。

**放弃的方案**：只把完整 transcript 放入 prompt。它没有保留/删除/纠正控制，容易突破上下文预算，也无法安全实现跨会话记忆。

## 决策 3：使用官方 Longbridge Node SDK，隐藏在只读 Provider 接口后

**决定**：在 API workspace 引入官方 `longbridge` npm 包，凭据只在服务端解析；核心业务只依赖 `MarketDataProvider` 接口，不直接依赖 SDK 的对象类型。第一版每次研究运行拉取一致的 quote/option chain/option quote 快照，不把 WebSocket 订阅纳入本功能的完成门槛。

官方 Longbridge SDK 页面明确列出 Node.js SDK，包名已从旧的 `longport` 更名为 `longbridge`；官方入门文档同时给出 HTTP API、Quote WebSocket 和 OAuth 2.0 访问方式：[Longbridge SDK](https://open.longbridge.com/sdk)、[Longbridge Getting Started](https://open.longbridge.com/docs/getting-started)。

**数据范围**：

- 股票快照：最新价、昨收、开高低、成交量/成交额、交易状态、交易时段和 source timestamp（供应商实际返回的字段为准）。
- 期权：到期日、行权价、call/put symbol、买卖/最新报价、成交量、持仓量、隐含波动率、合约乘数和可用 Greeks。期权链和期权报价能力分别由官方文档描述：[实时证券行情](https://open.longbridge.com/docs/quote/pull/quote)、[期权报价](https://open.longbridge.com/docs/quote/pull/option-quote)。
- 期权权限按市场/产品处理。官方 CLI 期权文档展示了到期日、行权价、call/put、成交量/持仓等能力及 Greeks；美国期权可能需要 OPRA 权限，不能把权限错误当成无交易或 Gamma 为零：[期权能力说明](https://open.longbridge.com/docs/cli/derivatives/option)。

**符号和凭据**：在领域层统一为 `AAPL.US`、`700.HK` 等 `CODE.MARKET` 形式，保留原始供应商代码供审计。优先复用现有 AES-GCM 加密服务和服务端配置/租户凭据模式；响应、日志、记忆和 prompt 只出现凭据配置状态，不出现 token。

**快照策略**：quote、chain、option quote 尽可能使用同一运行的 `asOf` 采样窗口；若供应商返回时间不一致，证据 envelope 记录每项时间和时间差。市场休市、盘前、盘后、延迟或只返回缓存时，由 Provider 明确标记 session/freshness，Agent 不得称其为当前成交。

**放弃的方案**：直接在 `symbol-service.ts` 中拼接 Longbridge 请求。这样会把 SDK 升级、字段映射、权限错误和降级逻辑扩散到每个 Agent，也难以使用确定性 mock。

## 决策 4：把 Gamma 输出定义为“带假设的暴露情景”，不宣称真实做市商仓位

**决定**：Gamma 分析器输出两类可区分的结果：

1. `grossGammaExposure`：按可用 Gamma、持仓量、合约乘数和标的价格计算的未定向总量，用于显示数据集中在哪些到期日/行权价。
2. `modeledSignedGammaExposure`：只有在报告显式展示口径时才使用的有符号情景。默认计算口径为 call 正、put 负，并标注这是基于期权持仓/做市商方向的模型化假设，不是 Longbridge 直接提供的真实 Dealer Position。

默认的单合约 1% 价格变动归一化公式为：

```text
exposure_1pct = gamma × openInterest × contractMultiplier × spot² × 0.01
```

缺少 Gamma、持仓量、合约乘数或可信 spot 的合约不参与该项计算，并在 `excludedContracts` 中说明原因，绝不把缺失字段写成 0。分析器按到期日、行权价和 call/put 聚合，找出接近现价的主要暴露区间，并生成上下行情景/区间，而不是输出单一涨跌预测。

**原因**：Gamma 本身是局部敏感度，聚合结果还依赖合约乘数、open interest 和方向假设。公开期权链通常不能证明做市商到底多空，因此“看涨/看跌”式的单值结论会过度解释数据。报告必须同时提供计算范围、`asOf`、被排除字段、gross 与 modeled 的区别，以及“不是投资建议”的安全边界。

**放弃的方案**：把所有 call/put Gamma 直接相加后输出“下一步上涨/下跌”。该方案既没有处理 contract size，也掩盖了方向假设和数据时点差异。

## 决策 5：降级状态贯穿证据、任务和 SSE

**决定**：Provider、记忆、模型和流式写出都返回可判定的状态。研究运行可在行情成功但期权权限不足时以 `degraded` 完成；若没有足够行情/标的或最终 Agent 无法生成可信回答，则任务为真实失败或输入等待。每个状态都保留来源、错误码、权限和时间信息。

SSE 继续发送工作状态、模型 delta 和最终 Task；增量文本只来自 Agent，最终 Task 使用同一累计文本。客户端重连通过已保存的 task/conversation/run 重新读取上下文和证据，不再次制造一个无关任务。平台协议状态与 Agent 内容在 metadata/artifact 层分开。

**放弃的方案**：无论数据源是否成功都返回固定“研究已完成”文案。它会让前端看似成功，却违反数据真实性和安全要求。

## 实施时需保留的验证证据

- `longbridge-provider.spec.ts`：正常行情、休市/延迟、OAuth/权限错误、字段缺失、时间戳不一致。
- `option-gamma-service.spec.ts`：公式、合约乘数、call/put 假设、缺失字段排除、接近零 Gamma 和多到期日聚合。
- `memory-service.spec.ts`：租户/主体隔离、纠正替代、过期过滤、读取/写入策略、删除后的缓存失效。
- `symbol-service.spec.ts` / `app.integration.spec.ts`：苹果公司名解析、自然澄清、同一任务续接、固定文案不再作为普通回答、A2A 状态和 SSE 最终一致。
- 配置真实 Longbridge 凭据后再运行受控 smoke；测试输出必须只显示 credential summary，不打印 token。
