# A2A Agent Platform

面向外部客户的多租户 A2A Agent 控制面、统一调用网关和运营控制台。平台登记远端 Agent Card，在不接管远端进程的前提下，统一提供发现、鉴权、限流、配额、任务观测、Webhook、告警和审计。

平台使用 React、TypeScript、CSS Modules、Express、PostgreSQL、Redis、Nginx 和 Docker Compose。A2A 调用由 `@a2a-js/sdk` 执行，网关向客户暴露 A2A 1.0 HTTP+JSON 与 SSE。

## 设计边界

- 上线表示允许平台代理流量，不会启动远端 Agent。
- 下线表示停止平台代理流量，不会停止远端 Agent 进程。
- PostgreSQL 中的 Task 是平台观测快照；远端 TaskStore 仍是协议任务的权威来源。
- Agent Card 在注册和刷新时保存版本；远端能力不会被平台改写。
- API Key 用于客户调用；管理 JWT 用于控制台，两者不能互相替代。

## 已实现能力

### 多租户与权限

- 租户搜索、分页、创建、详情、编辑、启用、停用和受约束删除。
- 租户独立 Agent、API Key、Webhook、配额、用量、任务和审计范围。
- 平台管理员、租户管理员、开发者、只读成员四级角色。
- 成员邀请、一次性邀请令牌、接受邀请、角色变更和成员移除。
- 防止移除或降级最后一名租户管理员。
- 非平台管理员不能转移 Agent 所属租户或配置跨租户公开范围。

### API Key 与网关鉴权

- Key 以 `a2a_live_` 开头，创建时只展示一次明文。
- 数据库只保存 SHA-256 哈希和可识别前缀。
- 支持名称、说明、作用域、过期时间、撤销和最后使用时间。
- 作用域包括 `agent:invoke`、`task:read`、`task:cancel`、`usage:read`。
- 网关分别返回无效、撤销、过期、无作用域、租户停用和 Agent 越权错误。
- 外部网关不接受 `dev-admin-token` 代替 API Key。

### 配额、限流和用量

- 租户与 API Key 分别维护每分钟、每日、每月和并发配额。
- Agent 调用策略另有最大并发限制。
- PostgreSQL 原子计数器是时间窗口与并发租约的唯一权威来源，实例切换不会出现双计数平面。
- Redis 仅承担跨实例实时事件，不参与硬配额判定。
- 429 响应包含租户与 Key 的配额快照和剩余量。
- 记录调用方、Agent、操作、状态码、耗时、输入输出字节、SSE 事件数和错误。
- 控制台展示请求量、失败率、平均/P95 延迟、传输数据和小时趋势，支持 CSV。

### Agent 生命周期

- 注册前读取并校验远端 Agent Card。
- 选择 JSON-RPC 或 HTTP+JSON 远端接口，平台代理 HTTP+JSON。
- 编辑名称、说明、标签、租户、可见性、超时、重试和并发策略。
- 上线前强制健康检查；下线只改变平台流量状态。
- 手动/定时健康检查和健康历史。
- 刷新 Card 时保存版本、操作者、接口和能力差异。
- 差异包含普通字段、技能新增/删除/变化、接口新增/删除。
- 删除采用软删除并要求先下线。
- 原有 `stock-expert` 自动归入 `default` 租户，不删除原数据。

### 内置 Symbol A2A 示例

- 平台启动时会自动登记七个 `symbol-*` Agent：市场行情、公司研究、技术与期权、新闻、风险、观点审查和研究编排。
- 每个 Agent 是平台进程内的真实 HTTP+JSON A2A 服务；仍由平台网关鉴权、配额、任务中心和健康检查统一管理。
- 用户可输入任意自然语言。模型仅提取已明确给出的标的、周期和观点；不会用硬编码公司名称表猜测代码。缺少关键参数时，返回 A2A `TASK_STATE_INPUT_REQUIRED` 并在同一 Task 中追问。
- 会话、槽位、任务结果保存在 PostgreSQL 的 `symbol_conversations`；Redis 仅缓存短时行情和会话读取，不承担持久化职责。
- 行情与资讯使用公开 Yahoo Finance 数据源；配置 `DEEPSEEK_API_KEY` 后启用结构化意图解析和基于工具证据的真实对话回复。模型不可用时会明确返回失败，不会以固定行情文案冒充回答。所有输出均明确为研究参考，不构成投资建议。

### 调用与任务中心

- 在线调试选择租户、在线 Agent 和真实 API Key。
- 新建流式消息，逐条展示原始 SSE 事件。
- 自动提取远端 Task ID，支持取消和重新订阅。
- Task 列表按租户、Agent、状态、关键词筛选并分页。
- 详情包含调用方、错误、耗时、重试、快照和事件时间线。
- Task 事件可下载为 JSON。
- 事件写入 PostgreSQL 并发布到 Redis Pub/Sub。
- 控制台用鉴权 SSE 订阅跨 API 实例事件。

### Webhook、告警与通知

- Webhook 创建、编辑、启停、删除、密钥轮换和测试。
- 事件包含任务创建/工作/完成/失败和 Agent 降级/恢复。
- 请求使用事件 ID、Unix 时间和 HMAC-SHA256 签名。
- Worker 控制超时，失败指数退避，耗尽后进入死信。
- 支持投递历史、响应摘要和手动重放。
- 告警指标包括 Agent 不健康数、错误率、延迟和月配额使用率。
- 支持严重级别、窗口、阈值、冷却、确认、静默和恢复。

### 审计与设置

- 成功写操作记录操作者、租户、资源、Request ID、IP 和 User-Agent。
- 失败写操作由统一错误处理中间件记录 `request.failed`。
- 审计支持租户、动作、结果、关键词和时间筛选。
- 平台设置支持网关、健康检查和 Webhook 参数。

## 架构

```mermaid
flowchart LR
    Customer[外部客户] -->|Agent Card / X-API-Key| Gateway[Nginx :8080]
    Operator[运营人员] -->|浏览器 :5173| Console[React Console]
    Console -->|Bearer JWT| Gateway
    Gateway --> API1[Platform API 1]
    Gateway --> API2[Platform API N]
    API1 -->|A2A Client| Remote[远端 A2A Agent]
    API2 -->|A2A Client| Remote
    API1 --> PostgreSQL[(PostgreSQL)]
    API2 --> PostgreSQL
    API1 --> Redis[(Redis)]
    API2 --> Redis
    Worker[Health / Alert / Webhook Worker] --> PostgreSQL
    Worker --> Redis
    Worker -->|健康检查| Remote
    Worker -->|HMAC POST| Receiver[客户 Webhook]
```

### 流式请求数据流

```mermaid
sequenceDiagram
    participant C as 客户
    participant G as 平台网关
    participant R as Redis
    participant D as PostgreSQL
    participant A as 远端 Agent
    participant W as Worker
    C->>G: POST message:stream + X-API-Key
    G->>D: 验证 Key、租户、作用域和可见性
    G->>D: 原子获取租户/Key/Agent 配额租约
    G->>A: A2A sendMessageStream
    loop 每个远端事件
        A-->>G: Task / Status / Artifact / Message
        G->>D: 同事务更新 Task、追加事件与 Outbox
        G->>R: 发布跨实例事件
        G-->>C: 写入同一 HTTP SSE 连接
        W->>D: 消费 Outbox 并创建 Webhook 投递记录
    end
    G->>D: 写入用量、耗时、字节和结果
    G->>R: 释放并发租约
    W->>D: 领取待投递记录
    W->>C: HMAC 签名 POST
```

## 目录结构

```text
a2a-agent-platform/
├─ apps/
│  ├─ admin-console/       React 管理控制台
│  ├─ platform-api/        Express 管理 API、A2A 网关、迁移和 Worker
│  │  ├─ migrations/       PostgreSQL 顺序迁移
│  │  └─ src/              领域服务、路由、鉴权、任务、配额、Webhook、告警
│  └─ health-worker/       独立 Worker workspace
├─ infra/                  Dockerfile、Compose、Nginx
├─ scripts/                连通性验证和代码行统计
├─ tests/e2e/              Playwright 桌面与 375px 移动端测试
├─ DESIGN.md               UI 视觉约束
└─ playwright.config.ts
```

## 本地启动

要求 Node.js 20+、Docker Desktop 和 Compose v2。宿主机端口 `5173`、`8080`、`5432` 需要可用。

```powershell
Copy-Item .env.example .env
npm install
npm run platform:up
```

`platform:up` 会构建镜像、等待数据库健康、执行迁移，然后后台启动 API、Worker、Nginx 和控制台。

| 服务       | 地址                            | 说明           |
| ---------- | ------------------------------- | -------------- |
| 管理控制台 | `http://localhost:5173`         | 客户运营台     |
| 平台网关   | `http://localhost:8080`         | A2A 与管理 API |
| 健康检查   | `http://localhost:8080/healthz` | API 存活状态   |
| PostgreSQL | `localhost:5432`                | 本地数据库     |

默认本地管理 Token 是 `dev-admin-token`，由 Compose 显式注入。生产未配置时不会自动启用。
控制台不会把该 Token 打包为默认凭据；可通过“成员与角色 → 平台用户”创建首个本地账号，生产建议配置 OIDC。Compose 的
5173、8080 和 5432 均只监听 `127.0.0.1`，管理 API 仅允许配置清单中的
控制台 Origin 跨域访问。

首次启动可用开发 Token 创建本地管理员，然后在控制台登录；密码不会写入脚本或镜像：

```powershell
$bootstrap = @{ email="admin@example.com"; displayName="Platform Admin"; password="替换为至少12位密码"; platformRole="platform_admin" } | ConvertTo-Json
Invoke-RestMethod http://localhost:8080/api/admin/users -Method Post `
  -Headers @{ Authorization="Bearer dev-admin-token" } -ContentType application/json -Body $bootstrap
```

启动后验证：

```powershell
npm run platform:verify
```

验证 5173、8080、管理身份、默认租户和原有 `stock-expert`。

日志与停止：

```powershell
npm run platform:logs
npm run down
```

停止命令保留数据库卷。不要使用 `down -v`，除非明确需要删除本项目数据。

## 配置

| 变量                             | 示例                                                      | 说明                                                       |
| -------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `POSTGRES_URL`                   | `postgres://platform:platform@postgres:5432/a2a_platform` | PostgreSQL                                                 |
| `REDIS_URL`                      | `redis://redis:6379`                                      | 限流与实时事件                                             |
| `PLATFORM_ORIGIN`                | `http://localhost:8080`                                   | 代理 Card 外部 URL                                         |
| `CONSOLE_ORIGINS`                | `http://localhost:5173`                                   | 控制台 CORS 白名单                                         |
| `PLATFORM_DEV_TOKEN`             | `dev-admin-token`                                         | 本地管理 Token                                             |
| `PLATFORM_JWT_SECRET`            | 随机 32+ 字符                                             | HS256 管理 JWT 密钥                                        |
| `PLATFORM_JWT_ISSUER`            | `a2a-agent-platform`                                      | JWT issuer                                                 |
| `LOCAL_LOGIN_ENABLED`            | `true`                                                    | 是否允许本地密码登录                                       |
| `SELF_REGISTRATION_ENABLED`      | `true`                                                    | 是否允许外部用户自助注册                                   |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` | 企业 IdP 配置                                             | OIDC 授权码 + PKCE 登录                                    |
| `CREDENTIAL_ENCRYPTION_KEY`      | 独立随机密钥                                              | 上游凭据 AES-GCM 加密                                      |
| `CREDENTIAL_KEY_VERSION`         | `v2`                                                      | 当前凭据加密密钥版本                                       |
| `CREDENTIAL_PREVIOUS_KEYS`       | `{"v1":"旧密钥"}`                                         | 轮换期间只读旧版本密钥环                                   |
| `SMTP_URL`                       | `smtps://...`                                             | 邮件通知投递                                               |
| `METRICS_TOKEN`                  | 随机监控令牌                                              | 保护 `/metrics`                                            |
| `ALLOW_PRIVATE_OUTBOUND_TARGETS` | `true`                                                    | 是否允许内网 Card/Webhook                                  |
| `HEALTH_CHECK_INTERVAL_MS`       | `30000`                                                   | Worker 周期                                                |
| `MAX_A2A_RESPONSE_BYTES`         | `16777216`                                                | 单次上游响应解压后上限                                     |
| `MAX_A2A_EVENT_BYTES`            | `1048576`                                                 | 单个 SSE 事件上限                                          |
| `MAX_A2A_STREAM_EVENTS`          | `10000`                                                   | 单次流最大事件数                                           |
| `MAX_A2A_CALL_DURATION_MS`       | `300000`                                                  | 不可由租户放大的调用上限                                   |
| `SYMBOL_INTERNAL_TOKEN`          | 随机 32 字节令牌                                          | 平台调用内置 Symbol Agent 的私有凭据                       |
| `DEEPSEEK_API_KEY`               | `sk-...`                                                  | 自然语言意图提取与最终对话回复；未配置时不会回退为固定文案 |
| `DEEPSEEK_MODEL`                 | `deepseek-chat`                                           | 意图提取与对话回复模型                                     |
| `FINNHUB_API_KEY`                | 可选                                                      | 为后续扩展保留的新闻数据源凭据                             |

生产必须使用随机 JWT 密钥、关闭开发 Token、关闭私网出站、配置 TLS、备份和监控。

## 用户自助注册与 Agent 目录

登录页在 `SELF_REGISTRATION_ENABLED=true` 且本地登录启用时显示“没有账号？立即注册”。注册请求：

```powershell
$body = @{ email="customer@example.com"; displayName="Customer"; password="替换为至少12位密码" } | ConvertTo-Json
Invoke-RestMethod http://localhost:8080/api/auth/register -Method Post `
  -ContentType application/json -Body $body
```

注册成功立即签发访问令牌和 HttpOnly 刷新会话，但不会自动授予平台角色或租户角色。无租户用户只能通过 `/api/catalog/agents?page=1&pageSize=20` 查看公开 Agent；加入租户后，目录还会包含该租户拥有的 Agent 以及明确授权给该租户的 Agent。接口返回标准 `items/page/pageSize/total/totalPages` 分页结构。目录中的 Card 和协议接口始终指向平台代理地址，不会返回远端 Agent 地址、Card 图标、签名或扩展私有参数。

自助注册账号在完成企业 OIDC 登录或持有租户邀请令牌前保持 `emailVerified=false`，只能获得公开目录能力。已验证 OIDC 身份或邀请令牌可安全回收同邮箱的未验证占位账号：旧账号会被停用并更换邮箱，新身份使用全新用户 ID，旧访问令牌不会继承新租户权限。纯本地账号若要在生产环境证明邮箱所有权，仍应接入邮件验证；未接入前建议将 `SELF_REGISTRATION_ENABLED=false`，或仅把公开目录用于无敏感信息的 Agent。

## 注册 Agent

控制台填写显示名称、slug、Agent Card 完整 URL、所属租户、说明和标签。

Windows 宿主机运行的 Agent 通常使用：

```text
http://host.docker.internal:41241/.well-known/agent-card.json
```

这是容器访问 Windows 的地址。外部客户发现平台代理服务使用：

```text
http://localhost:8080/agents/stock-expert/.well-known/agent-card.json
```

前者供平台读取远端 Card，后者供客户发现平台代理 Agent。

## 创建 API Key

在“租户管理”中点击目标租户的“API Key”，创建后立即保存一次性明文。

管理 API 示例：

```powershell
$body = @{
  name = "production-client"
  scopes = @("agent:invoke", "task:read", "task:cancel")
  expiresAt = "2027-01-01T00:00:00.000Z"
  minuteRequestLimit = 60
  dailyRequestLimit = 10000
  monthlyRequestLimit = 200000
  concurrentRequestLimit = 10
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:8080/api/admin/tenants/<tenant-id>/api-keys" `
  -Method Post `
  -Headers @{ Authorization = "Bearer dev-admin-token" } `
  -ContentType "application/json" `
  -Body $body
```

响应中的 `key.secret` 只出现一次，列表接口只返回 `prefix`。

## 外部调用

获取 Card：

```powershell
Invoke-RestMethod http://localhost:8080/agents/stock-expert/.well-known/agent-card.json
```

流式调用：

```powershell
$request = @{
  message = @{
    messageId = [guid]::NewGuid().ToString()
    role = "ROLE_USER"
    parts = @(@{
      content = @{ '$case' = "text"; value = "分析 AAPL 的走势与风险" }
      mediaType = "text/plain"
      filename = ""
    })
    taskId = ""
    contextId = ""
    extensions = @()
    metadata = @{}
    referenceTaskIds = @()
  }
  metadata = @{}
} | ConvertTo-Json -Depth 8

curl.exe -N -X POST `
  "http://localhost:8080/agents/stock-expert/a2a/rest/message:stream" `
  -H "Content-Type: application/json" `
  -H "X-API-Key: a2a_live_替换为真实密钥" `
  --data-binary $request
```

平台同时暴露 JSON-RPC 2.0；方法名使用 A2A 1.0 的 `SendMessage`、`SendStreamingMessage`、`GetTask`、`CancelTask`、`ListTasks` 和 Push Notification Config 系列：

```powershell
$rpc = @{ jsonrpc="2.0"; id="demo-1"; method="SendMessage"; params=$request } | ConvertTo-Json -Depth 10
curl.exe -X POST "http://localhost:8080/agents/stock-expert/a2a/jsonrpc" `
  -H "Content-Type: application/json" `
  -H "X-API-Key: a2a_live_替换为真实密钥" `
  --data-binary $rpc
```

查询、取消、重新订阅：

```powershell
curl.exe "http://localhost:8080/agents/stock-expert/a2a/rest/tasks/<task-id>" `
  -H "X-API-Key: a2a_live_替换为真实密钥"

curl.exe -X POST "http://localhost:8080/agents/stock-expert/a2a/rest/tasks/<task-id>:cancel" `
  -H "X-API-Key: a2a_live_替换为真实密钥" -d "{}"

curl.exe -N -X POST "http://localhost:8080/agents/stock-expert/a2a/rest/tasks/<task-id>:subscribe" `
  -H "X-API-Key: a2a_live_替换为真实密钥"
```

分别需要 `task:read` 和 `task:cancel` 作用域。

## Webhook 签名

请求头：

```text
X-A2A-Event-Id: <uuid>
X-A2A-Event: task.completed
X-A2A-Timestamp: <unix-seconds>
X-A2A-Signature: sha256=<hex-digest>
```

签名原文是 `<timestamp>.<raw-request-body>`。Node.js 验证：

```ts
import crypto from "node:crypto";

export function verify(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  received: string,
) {
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
```

接收方还应校验时间戳并按事件 ID 幂等去重。

## 权限模型

| 能力                 | 平台管理员 | 租户管理员 | 开发者 | 只读成员 |
| -------------------- | ---------: | ---------: | -----: | -------: |
| 跨租户列表/创建租户  |         是 |         否 |     否 |       否 |
| 编辑本租户与配额     |         是 |         是 |     否 |       否 |
| 启停/删除租户        |         是 |         否 |     否 |       否 |
| 成员与角色           |         是 |         是 |     否 |       否 |
| API Key 管理         |         是 |         是 |     否 |       否 |
| 本租户 Agent 管理    |         是 |         是 |     是 |       否 |
| 跨租户 Agent 可见性  |         是 |         否 |     否 |       否 |
| Webhook              |         是 |         是 |     是 |       否 |
| 告警规则             |         是 |         是 |     否 |       否 |
| 任务、用量、审计查看 |         是 |         是 |     是 |       是 |
| 平台设置             |         是 |         否 |     否 |       否 |

API Key 作用域独立于管理角色。

## 多实例

| 状态                    | 存储          |
| ----------------------- | ------------- |
| 租户、成员、Agent、Card | PostgreSQL    |
| Key 哈希、Webhook、告警 | PostgreSQL    |
| Task、用量、审计        | PostgreSQL    |
| 限流与并发租约          | PostgreSQL    |
| 跨实例实时事件          | Redis Pub/Sub |

```powershell
docker compose -f infra/docker-compose.yml up -d --scale api=2 --no-recreate
```

负载均衡器必须保持 SSE 长连接并关闭缓冲。Worker 使用 PostgreSQL advisory
leader lock，多个实例中仅一个执行健康检查和告警；实例失联后数据库会自动释放
锁，其他实例接管。Webhook 领取使用 `FOR UPDATE SKIP LOCKED` 和超时租约回收。

## 数据库迁移

迁移按文件名顺序、每文件单事务执行，记录到 `schema_migrations`。

```powershell
npm run migrate
```

1. `001_initial.sql`：Agent、健康、Task、审计。
2. `002_platform_governance.sql`：租户、Key、用量、Webhook、告警。
3. `003_tenant_agent_policy.sql`：Agent 租户策略、成员。
4. `004_platform_operations.sql`：完整配额、事件、投递、版本、设置。
5. `005_default_tenant.sql`：已有 Agent 迁入默认租户。
6. `006_worker_coordination.sql`：活动告警唯一约束、Worker 协调与 PostgreSQL 配额计数器。
7. `007_task_event_outbox.sql`：Task 与生命周期通知的事务 Outbox。
8. `008_customer_runtime.sql`：客户身份、会话、多实例、上游凭据、产物、目录与数据保留。
9. `009_notification_delivery.sql`：持久通知重试、死信与 Worker 心跳。
10. `010_runtime_settings.sql`：动态登录与通知运行开关。
11. `011_encrypt_webhook_secrets.sql`：Webhook HMAC 密钥加密存储与旧数据升级。
12. `012_reliability_guards.sql`：Task 租户唯一性、实例亲和租约、通知领取租约、OIDC 外部身份绑定与 Webhook 密文约束。
13. `013_login_limits.sql`：跨实例共享的登录邮箱/IP 失败计数和封禁窗口。
14. `014_self_registration.sql`：自助注册开关与跨实例邮箱/IP 注册限流。

API 和 Worker 依赖迁移成功后启动。

## 测试与质量门禁

```powershell
npm run build
npm test
npm run test:e2e
docker compose -f infra/docker-compose.yml config --quiet
npm run platform:verify
npm run lines
```

测试覆盖 JWT 篡改、自助注册与安全 Agent 目录、OIDC 已验证身份绑定、跨实例登录限流、角色越权、租户生命周期、邀请激活、最后管理员、Key 哈希/撤销/过期/作用域、租户隔离、停用、配额 429、Card 不可达、Task 实例亲和与跨租户引用拦截、流式产物追加、任务取消、Webhook 密文、失败重试与死信。

Playwright 使用本机 Chrome，验证全部主页面、默认租户、`stock-expert`、自助注册后安全目录与重新登录、Agent 注册弹窗、真实开发者邀请激活与角色界面，以及 375px 移动端。

代码行脚本统计 TypeScript、TSX、CSS、SQL、Markdown、Compose/Nginx 和运维脚本，排除依赖、构建产物、覆盖率、测试产物、Git 和 lock 文件，并逐文件输出。

## 安全

- API Key 明文不写数据库、日志或审计详情。
- Webhook、通知渠道和上游 Agent 凭据使用 AES-256-GCM 加密，密钥版本由环境配置；API Key 仍只保存单向哈希。
- 凭据轮换时先把旧版本放入 `CREDENTIAL_PREVIOUS_KEYS`，再切换 `CREDENTIAL_KEY_VERSION` 和当前密钥；新写入使用新版本，旧密文继续可读，确认迁移完成后才移除旧密钥。
- OIDC 只接受 `email_verified=true` 的声明，并以 issuer + subject 绑定外部身份；同邮箱不会自动合并，避免身份提供方切换导致接管。
- 生产必须轮换 JWT 密钥并接入 OIDC。
- Card/Webhook 仅接受 HTTP(S)，拒绝内嵌账号密码。
- 生产拒绝 localhost、链路本地、RFC1918 和解析到私网的域名。
- Card 重定向逐跳校验，Webhook 禁止自动跟随重定向；每次实际出站前重新解析检查。
- A2A 响应、单个流事件、事件总数和最长调用时间均有平台级硬上限。
- 本地 Compose 显式允许私网，以支持 `host.docker.internal`。
- Redis 故障时配额切换到 PostgreSQL 原子计数器，不会 fail-open。
- 服务端强制租户角色和 Agent 可见性，不依赖前端隐藏按钮。
- 自助注册用户默认无租户、无平台角色且邮箱状态为未验证；注册接口按邮箱和 IP 进行 PostgreSQL 跨实例限流。生产可以关闭自助注册或在接入邮件验证后再开放。
- 登录态 Agent 目录只返回公开、所属租户或显式租户授权的 Agent，并将 Card、协议接口改写为平台代理地址。
- Task 快照按租户、Agent 和远端 Task ID 隔离；查询、取消和重新订阅固定回到创建该 Task 的实例，`ListTasks` 聚合平台代理持久状态。
- 公开 Agent 仍要求有效 Key、启用租户、作用域和配额。

## 排障

### 控制台请求失败或 404

```powershell
docker compose -f infra/docker-compose.yml ps
Invoke-RestMethod http://localhost:8080/healthz
```

控制台 Nginx 同时代理 `/api/` 和 `/agents/`。更新源码后执行 `npm run platform:up` 重建。

### 为什么是 host.docker.internal

容器中的 localhost 是容器自身。`host.docker.internal` 是 Docker Desktop 提供的 Windows 宿主机地址。公网 Card 不会被改写。

### Agent 无法上线

- Card URL 从 API 容器可访问。
- Card 有名称、版本和 `supportedInterfaces`。
- 至少提供 JSON-RPC 或 HTTP+JSON。
- 远端端口绑定到 Docker 可访问的网络接口。

### API_KEY_INVALID

- 使用完整 `a2a_live_...`，不是 prefix。
- 使用 `X-API-Key`，不要使用管理 Token。
- 确认 Key 未撤销、未过期。

### AGENT_ACCESS_DENIED

私有 Agent 仅所属租户可调用。检查 Agent 租户、可见性和 Key 所属租户。

### 429

查看 `error.details.quotas` 和 `X-RateLimit-*`。租户总配额与 Key 配额分别计算，任一耗尽都会拒绝。

### SSE 没有输出

- 确认远端支持 streaming。
- 确认代理关闭缓冲。
- “断开 SSE”只断开本地连接；停止远端任务需要取消。

### Webhook 重试

- 查看 HTTP 状态、响应摘要和错误。
- 接收方须在超时内返回 2xx。
- 耗尽尝试后进入死信，修复后可手动重放。

### Redis 不可用

硬配额与并发租约继续由 PostgreSQL 严格执行；Redis Pub/Sub 中断期间，控制台实时
刷新会降级，持久化 Task 与 Webhook 不丢失。生产应对 Redis 连接失败告警。

### 迁移失败

失败事务会回滚且不写 `schema_migrations`。修复后重新运行迁移，不要手工标记成功。

## 运维建议

- PostgreSQL 每日备份并定期恢复演练。
- 为用量、任务事件、审计和投递配置归档保留期。
- 监控 5xx、429、P95、Redis、Worker 周期和死信。
- 使用外部密钥管理服务。
- 发布前执行全部质量门禁。

### 健康、指标与备份

- `/healthz` 只表示进程存活；`/readyz` 同时检查迁移版本、Redis 与 Worker 心跳。
- `/metrics` 输出 Agent、近五分钟请求/延迟、Worker 心跳和持久队列深度；设置 `METRICS_TOKEN` 后使用 Bearer Token 访问。
- `infra/prometheus.yml` 提供本地抓取示例；`deploy/helm/a2a-agent-platform` 提供 Kubernetes/Helm 基线部署。
- Windows 备份使用 `scripts/backup.ps1`，恢复演练使用 `scripts/restore.ps1`。恢复脚本会覆盖目标数据库，必须在隔离环境验证。
- Worker 每 24 小时按租户 `data_retention_days` 分批清理用量、任务、审计、健康和投递历史。

## License

对外发布前请补充组织要求的许可证、隐私政策、数据保留政策和客户服务条款。
