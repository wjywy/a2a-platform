# Quickstart: Agent 自主响应、记忆增强与 Symbol 市场分析

## 1. 准备环境

在仓库根目录安装依赖，并启动已有 PostgreSQL/Redis：

```powershell
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis
```

准备本地开发所需的 `POSTGRES_URL`、`REDIS_URL`、`PLATFORM_JWT_SECRET`、`CREDENTIAL_ENCRYPTION_KEY` 和 DeepSeek 配置。development 模式未显式设置 `SYMBOL_INTERNAL_TOKEN` 时，会使用仅用于本地启动的默认内部令牌；production 必须显式提供高强度令牌。Longbridge API-key 模式可通过服务端环境变量 `LONGBRIDGE_APP_KEY`、`LONGBRIDGE_APP_SECRET`、`LONGBRIDGE_ACCESS_TOKEN` 配置；多租户环境也可以由 tenant admin 调用凭据录入接口。凭据不得写入前端 `.env`、测试 fixture、prompt 或日志。

可选的 Longbridge 配置包括 `LONGBRIDGE_ENABLED`、`LONGBRIDGE_HTTP_URL`、`LONGBRIDGE_TIMEOUT_MS`、`LONGBRIDGE_MAX_CONCURRENT` 和 `LONGBRIDGE_MAX_OPTION_CONTRACTS`。服务端只执行只读行情/期权查询，不包含下单能力。官方 Node SDK 的 OAuth 入口是交互式 `OAuth.build(clientId, onOpenUrl, callbackPort)`，需要注册回调地址并在服务端保存 SDK 自己管理的 token 文件；当前租户凭据 API 明确只接入加密 API-key 三元组，不接受把 OAuth 原始 token 当作 API-key 或写入日志。真实 OAuth 接入必须增加受控回调生命周期和持久化 token 存储后再开启，不能用环境变量拼接伪造。

## 2. 应用 schema

```powershell
npm run migrate
npm --workspace @a2a-platform/api run build
```

migration 应创建每个内置 Agent 的默认策略，并保持旧数据库中的 `symbol_conversations`、`agent_runs` 和 A2A 任务数据可读取。

## 3. 运行确定性测试

```powershell
npm --workspace @a2a-platform/api run test -- --runInBand
npm run test
```

至少检查以下行为：

1. `帮我分析苹果` 先经过严格 intent schema，唯一解析后直接进入研究，不出现要求重复股票代码的固定文案。
2. 不完整输入只进入 `TASK_STATE_INPUT_REQUIRED`；Agent 澄清文本随上下文变化，且没有行情/期权请求。
3. 第二轮回答“刚才提到的风险哪个最重要”时恢复同一 task/context，并把上一轮问题、最新纠正和未解决事项送入模型。
4. memory read/write 开关、scope、category、过期、纠正和 reset 生效；跨租户/主体测试全部拒绝。
5. Gamma fixture 使用 contract multiplier 和 open interest，返回公式、假设、聚合层级、排除项和情景限制；字段缺失不变成零。
6. SSE 的累计 delta、最终 Task、artifact 和持久化 transcript 一致；模型、Redis、Longbridge 和客户端断开均保留真实状态。

## 4. 本地 mock 验收

测试环境注入 `MockMarketDataProvider` 和可控模型响应，不访问真实 Longbridge：

```text
输入：帮我分析苹果未来一个月走势
期望：
- intent.companyName = 苹果，随后解析为唯一 provider symbol
- quote evidence 有 provider/asOf/freshness/session
- option permission=available 时出现 Gamma scope/assumptions/scenarios
- option permission=missing 时出现 degraded reason，不出现 Gamma=0 的假结果
- 最终自然语言由 mock Agent 响应生成，不等于应用中的固定句子
```

## 5. 真实 Longbridge smoke

只在已完成 Longbridge OAuth/OpenAPI 开通、标的市场权限和（如适用）美国 OPRA 权限的受控环境运行。使用一支有期权链的美股，例如 `AAPL.US`，并记录：

- quote、option chain、option quote 的返回状态和各自 `asOf/fetchedAt`；
- 期权权限、数据新鲜度、时间差和被排除合约；
- gross Gamma 与 modeled signed Gamma 的公式和假设；
- Agent 最终文本与 evidence/artifact 一致；
- 日志只包含 provider、状态、耗时和 request id，不包含 token。

如果账户未配置或权限不足，smoke 的预期结果是准确的 `unavailable/degraded`，不是通过 Yahoo 数据冒充 Longbridge。已有 Yahoo/Nasdaq 数据可以作为明确标记的 supplementary fallback，但不能覆盖 Longbridge source/freshness。

平台级验证入口为：

```powershell
npm run platform:verify
```

该入口在没有 `LONGBRIDGE_APP_KEY`、`LONGBRIDGE_APP_SECRET`、`LONGBRIDGE_ACCESS_TOKEN` 时输出 `SKIP`，不会把未执行的真实 smoke 计为通过，也不会打印凭据。

## 6. 手工 API 场景

启动 API 后，通过现有登录/租户权限调用管理端点：

```text
GET   /api/admin/agents/symbol-market/memory-policy?tenantId=<tenant>
PATCH /api/admin/agents/symbol-market/memory-policy
GET   /api/admin/agents/symbol-market/memories?tenantId=<tenant>&conversationId=<id>
POST  /api/admin/agents/symbol-market/memory/reset
GET   /api/admin/tenants/<tenant>/market-data/longbridge
PUT   /api/admin/tenants/<tenant>/market-data/longbridge
```

`PUT` 请求只发送 `{ "appKey": "...", "appSecret": "...", "accessToken": "..." }`；响应仅返回配置状态，不返回密钥。普通用户的 `/api/memory` 只使用认证主体和已授权租户，不接受正文中的 `userId` 作为身份依据。

然后从 Agent Studio 发起两轮对话，验证策略修改、记忆删除和 reset 会在下一次回答立即生效。跨租户请求必须得到权限错误，错误响应不得泄露资源内容。

## 7. 完成门槛

本地完成不等于部署完成。交付前依次保留 focused test、全量 build/test、mock acceptance、真实凭据 smoke（如配置）和 SSE/健康检查证据；只有用户另行确认后才进行 push、CI/CD 和线上验证。
