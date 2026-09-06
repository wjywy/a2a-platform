# Verification Record

验证日期：2026-09-05（Asia/Shanghai）

## 已通过

- API 全量测试：15 个测试文件、136 个测试通过。
- Symbol/Provider focused acceptance：应用集成 53 个测试通过；Longbridge provider 14 个、Symbol service 16 个、memory service 7 个、resumable stream 2 个测试通过。
- API TypeScript build：通过。
- Workspace build：Console、Worker、API 全部通过；Vite 仅报告既有大 chunk warning。
- Playwright：现有 Agent Studio 桌面端失败 SSE 场景通过，错误后输入区恢复且不存在真实“停止生成”按钮。
- Docker compose 运行态：API、Worker、Nginx、Console、PostgreSQL、Redis 均健康；API 日志确认注册 7 个内置 Symbol Agent。
- Longbridge 原生 SDK 加载：容器内 `longbridge-native=loaded`。
- 容器内平台验证：Console、Gateway health、管理员鉴权、默认租户迁移、既有 `stock-expert` Agent、7 个内置 Symbol Agent、7 个 Agent Card、Longbridge 配置状态共 8/8 检查通过。
- Longbridge AAPL real-data smoke：明确 `SKIP`，因为当前环境没有服务端 Longbridge API-key；没有用 fallback 冒充 Longbridge 成功。
- 迁移/记忆集成验收：026 migration 顺序、旧 `symbol_conversations` 默认字段、7 条策略、租户外键、memory API 删除和跨租户读取均有自动化断言。

## 尚未执行

- DeepSeek 真实模型流式调用：当前环境没有服务端 `DEEPSEEK_API_KEY`，因此未宣称真实 Agent SSE 成功。
- Longbridge OAuth 浏览器授权生命周期和真实行情/期权/OPRA 权限：需要受控账户和服务端凭据后执行；官方 OAuth `OAuth.build` 的交互式回调边界已记录，当前服务端凭据 API 只开启加密 API-key 模式。
- 客户端断线后的后台继续执行和同 task/context SSE 重订阅：API 集成测试已实际断开首条 HTTP 流，等待同一任务完成，再通过 `tasks/:taskId:subscribe` 重放累计快照并校验最终内容；Playwright 仍覆盖失败流关闭和前端恢复。跨进程重启恢复不在本地单进程验收范围内。

## 凭据边界

本记录、测试输出和平台验证输出不包含 Longbridge、DeepSeek 或平台内部令牌；日志只记录状态、服务和测试结果。
