# Quickstart: 登录即全功能可用与移动控制台重构

## Prerequisites

- 已安装仓库锁定的 Node.js 依赖。
- 本地平台 API、数据库与控制台可按仓库现有开发方式启动。
- 用于端到端测试的开发管理员令牌和默认测试数据可用。

## Static and focused verification

```powershell
npm --workspace @a2a-platform/api run test
npm --workspace @a2a-platform/console run build
npx playwright test tests/e2e/console.spec.ts tests/e2e/agent-studio.spec.ts
```

不要把构建成功视为功能验证完成。

## Acceptance walkthrough

1. 使用一个非平台管理员的有效登录会话，依次直接打开全部 11 个控制台地址，确认没有角色重定向、隐藏菜单或角色错误。
2. 选取租户、成员、Webhook、告警、设置和 Agent 中的代表性读写操作，确认非管理员会话可完成，并在审计中看到真实操作者。
3. 在 320、360、390、430 像素宽手机视口中，确认底栏只含概览、Agent、在线调试、任务、更多五项且根页面无横向溢出。
4. 打开更多面板，验证七个次级页面、范围切换、注册 Agent、账号和退出登录均在两次或更少导航点击内可达；测试关闭和焦点返回。
5. 在手机上进入在线调试，验证 Agent 选择、历史记录、消息发送/停止、流式结果、消息操作、错误状态和返回控制台路径；打开软件键盘和历史抽屉时关键输入与控制不得被遮挡。
6. 在桌面重复导航和深链接检查，确认完整侧栏、当前页面状态和已访问页面状态未回退。

## Expected outcomes

- 只有未认证或已禁用账户被拒绝。
- 五项底栏完整可见，次级能力从更多面板可达。
- 所有现有页面和桌面能力在移动端拥有实际可操作路径。
- 控制台/API 测试与控制台构建均通过。
