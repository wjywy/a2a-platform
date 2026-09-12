# Implementation Plan: 登录即全功能可用与移动控制台重构

**Branch**: `[004-open-access-mobile]` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

## Summary

将控制台权限模型收敛为“有效登录会话即可使用全部既有控制台能力”。前端和 API 一并移除平台角色、租户角色及未选租户导致的访问差异；身份验证、已禁用账户检查、目标对象完整性、服务凭据一致性和改变性操作审计保持不变。

移动端重构控制台壳层：底部只保留概览、Agent、在线调试、任务和更多五个入口；“更多”承载七个次级页面、范围切换及账号操作。每个桌面功能须在手机上通过触摸和键盘等效访问，线上调试的聊天工作区为导航和输入区域预留安全空间。详见 [research.md](./research.md)。

## Technical Context

**Language/Version**: TypeScript 5.9；React 19.1 浏览器客户端；Node.js 服务端

**Primary Dependencies**: Vite 6、Ant Design 6、Express 5、Zod 3、PostgreSQL 驱动、现有 A2A SDK

**Storage**: PostgreSQL；本地存储仅保存会话令牌和当前工作范围

**Testing**: Vitest 3（API 单元和集成测试）；Playwright 1.62（桌面与移动端端到端测试）；控制台 TypeScript 构建

**Target Platform**: 现代桌面浏览器、320–430 像素宽手机、手机横向与平板；现有 Node.js 平台 API

**Project Type**: 浏览器管理控制台 + 同仓库 REST/SSE 平台 API

**Performance Goals**: 导航切换不引入全页刷新；五项手机底栏在 320、360、390、430 像素宽下完整可见；现有在线调试流式调用行为和重连能力不回退

**Constraints**: 未登录和禁用账户继续拒绝；不删除角色/成员数据；每个改变性操作保留审计；全页无意外横向滚动；移动控制不依赖悬停

**Scale/Scope**: 11 个现有控制台页面、全局范围与账号操作、在线调试会话工作区，以及对应 API 守卫和桌面/移动验证

## Constitution Check

当前 constitution 是未定制的项目模板，未定义可执行的架构或治理门槛。

**Pre-design gate: PASS** — 本功能复用既有前端、API、数据库和审计边界；不引入新的服务、数据存储或外部依赖。访问策略的改变由用户明确授权，仍以认证和账号状态校验作为边界。

**Post-design gate: PASS** — 设计将角色数据保留为审计事实，并把范围目标完整性与角色授权分开；移动导航复用现有控制台壳层与测试基础设施。

## Project Structure

### Documentation

```text
specs/004-open-access-mobile/
├── contracts/
│   ├── authenticated-console-access.md
│   └── mobile-navigation.md
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
└── tasks.md
```

### Source Code

```text
apps/
├── admin-console/src/
│   ├── App.tsx
│   ├── AppContext.tsx
│   ├── Layout.tsx
│   ├── ConsoleShell.module.css
│   ├── pages/
│   └── components/studio/
└── platform-api/src/
    ├── auth.ts
    ├── admin-router.ts
    └── app.integration.spec.ts

tests/e2e/
├── console.spec.ts
└── agent-studio.spec.ts
```

**Structure Decision**: 在现有 monorepo 中直接演进共享控制台壳层和管理 API。不会创建独立移动应用或新的授权服务；API 守卫与 UI 状态同步改变，测试分别覆盖 API 合同与实际浏览器行为。

## Complexity Tracking

无。
