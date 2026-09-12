---

description: "登录即全功能可用与移动控制台重构的任务清单"
---

# Tasks: 登录即全功能可用与移动控制台重构

**Input**: `specs/004-open-access-mobile/` 下的计划、研究、数据模型、合同和验证指南

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`

**Tests**: 本规格明确要求 API、桌面和移动端行为验证，因此测试任务在相应实现任务之前执行。

## Phase 1: Setup

**Purpose**: 确认现有测试基线与特性边界，不建立新的运行时基础设施。

- [X] T001 Record the current console/API baseline and the targeted role-gating call sites in `apps/platform-api/src/auth.ts`, `apps/platform-api/src/admin-router.ts`, and `apps/admin-console/src/App.tsx`
- [X] T002 Verify existing ignore coverage without changing unrelated entries in `.gitignore`, `.dockerignore`, and `.prettierignore`

---

## Phase 2: Foundational Access Policy

**Purpose**: 使认证后的全局访问策略在 API 和共享控制台状态中一致；完成前不得实施依赖该策略的页面或移动导航工作。

- [X] T003 Add authenticated non-administrator access regression cases for representative global, tenant and Agent operations in `apps/platform-api/src/app.integration.spec.ts`
- [X] T004 Retain authentication-helper regression coverage for invalid and disabled accounts in `apps/platform-api/src/auth.spec.ts` while keeping the shared guard outside the console-only policy change
- [X] T005 Preserve the shared authentication guard in `apps/platform-api/src/auth.ts` and confine default-open policy enforcement to the console router while retaining tenant-target validation
- [X] T006 Remove route-local platform/tenant role branches and preserve object/service-credential integrity checks in `apps/platform-api/src/admin-router.ts`
- [X] T007 Normalize all-users tenant and Agent loading, eliminate role-derived page redirects, and simplify the shared access context in `apps/admin-console/src/App.tsx` and `apps/admin-console/src/AppContext.tsx`
- [X] T008 Remove role-derived visibility, disabled-state and title variants while preserving role data as display/audit information in `apps/admin-console/src/pages/AgentsPage.tsx`, `apps/admin-console/src/pages/ApiKeysPanel.tsx`, `apps/admin-console/src/pages/TenantsPage.tsx`, `apps/admin-console/src/pages/MembersPage.tsx`, `apps/admin-console/src/pages/WebhooksPage.tsx`, and `apps/admin-console/src/pages/AlertsPage.tsx`
- [ ] T009 Run the focused access-policy API cases in `apps/platform-api/src/auth.spec.ts` and `apps/platform-api/src/app.integration.spec.ts`

**Checkpoint**: All existing console routes and representative operations accept a valid non-administrator session; unauthenticated and disabled sessions remain rejected.

---

## Phase 3: User Story 1 - 登录后无角色阻断地使用控制台 (Priority: P1) 🎯 MVP

**Goal**: 任意已登录用户可直接访问全部 11 个页面、加载全部工作范围并完成既有控制台操作。

**Independent Test**: 以非平台管理员会话直接打开所有页面，执行代表性全局、范围和 Agent 操作，确认无角色隐藏、重定向、禁用或角色错误。

- [ ] T010 [P] [US1] Add desktop direct-route and authenticated non-administrator access coverage for every console page in `tests/e2e/console.spec.ts`
- [X] T011 [US1] Render full desktop navigation, tenant selection and global actions for every authenticated user in `apps/admin-console/src/Layout.tsx`
- [X] T012 [US1] Update stale role-specific end-to-end expectations and assert retained logout/authentication behavior in `tests/e2e/console.spec.ts`

**Checkpoint**: User Story 1 is independently usable on desktop and validates the API-to-UI access contract.

---

## Phase 4: User Story 2 - 用精简的底部导航在手机上访问全部模块 (Priority: P1)

**Goal**: 手机底栏只有四项高频页面和一个“更多”入口，全部其余页面和全局操作仍在两步内可达。

**Independent Test**: 在手机视口中依次访问五项底栏、“更多”内的七个次级页面、范围切换、注册 Agent 与退出登录，验证地址和当前状态同步。

- [ ] T013 [P] [US2] Add mobile navigation, more-panel, deep-link, close/focus and two-step reachability coverage in `tests/e2e/console.spec.ts`
- [X] T014 [US2] Implement primary/secondary navigation metadata, mobile more-panel state, range selector and global actions in `apps/admin-console/src/Layout.tsx`
- [X] T015 [US2] Implement five-item bottom navigation, more-panel layering, focus, touch target and safe-area styling in `apps/admin-console/src/ConsoleShell.module.css`
- [X] T016 [US2] Synchronize debug-shell mobile navigation visibility and bottom safe-area space with the app shell in `apps/admin-console/src/ConsoleShell.module.css` and `apps/admin-console/src/components/studio/AgentStudio.module.css`

**Checkpoint**: User Story 2 is independently usable at phone widths; no bottom navigation horizontal scrolling remains.

---

## Phase 5: User Story 3 - 在手机上完整完成桌面工作流 (Priority: P1)

**Goal**: 每一个桌面页面能力在手机上均有可发现、不依赖悬停的等效路径，特别包括在线调试的会话和消息操作。

**Independent Test**: 按规格中的“移动端能力映射”完成每页主要流程与一项次级操作；在手机上完成在线调试的会话管理、流式交互和返回控制台。

- [ ] T017 [P] [US3] Add mobile capability-parity and interaction-state regression coverage for page actions and dense-data routes in `tests/e2e/console.spec.ts`
- [ ] T018 [P] [US3] Add phone-width Studio navigation, history, composer, streaming-control and return-path regression coverage in `tests/e2e/agent-studio.spec.ts`
- [ ] T019 [US3] Make shared page toolbars, tables, dialogs, action groups and primary controls reachable at narrow widths in `apps/admin-console/src/App.module.css` and `apps/admin-console/src/ConsoleShell.module.css`
- [ ] T020 [US3] Make Agent, tenant, member, Webhook, alert, usage, task, audit and settings page actions discoverable and operable at narrow widths in `apps/admin-console/src/pages/AgentsPage.tsx`, `apps/admin-console/src/pages/TenantsPage.tsx`, `apps/admin-console/src/pages/MembersPage.tsx`, `apps/admin-console/src/pages/WebhooksPage.tsx`, `apps/admin-console/src/pages/AlertsPage.tsx`, `apps/admin-console/src/pages/UsagePage.tsx`, `apps/admin-console/src/pages/TasksPage.tsx`, `apps/admin-console/src/pages/AuditPage.tsx`, and `apps/admin-console/src/pages/SettingsPage.tsx`
- [X] T021 [US3] Preserve complete mobile online-debug interaction paths and compensate composer/history/trace overlays for the global bottom navigation in `apps/admin-console/src/components/studio/AgentStudio.module.css`, `apps/admin-console/src/components/studio/StudioHeader.tsx`, `apps/admin-console/src/components/studio/StudioPanels.tsx`, and `apps/admin-console/src/components/studio/StudioComposer.tsx`

**Checkpoint**: User Story 3 provides full mobile capability parity for the existing console rather than a read-only/mobile-only subset.

---

## Phase 6: User Story 4 - 在不同屏幕与设备状态下稳定操作 (Priority: P2)

**Goal**: 在手机纵向、手机横向、平板和桌面尺寸中，关键内容与控件不会因固定导航、抽屉、键盘或长数据而被遮挡或裁切。

**Independent Test**: 在 320、360、390、430 像素宽手机及横向/平板/桌面视口执行导航、表单、确认、长列表和错误恢复，根文档无横向溢出且所有关键控件可点。

- [ ] T022 [P] [US4] Expand the viewport matrix and horizontal-overflow, safe-area and touch-target assertions in `tests/e2e/console.spec.ts` and `tests/e2e/agent-studio.spec.ts`
- [ ] T023 [US4] Complete responsive shell, overlay and reduced-motion/focus refinements for phone, landscape, tablet and desktop in `apps/admin-console/src/ConsoleShell.module.css`, `apps/admin-console/src/App.module.css`, and `apps/admin-console/src/components/studio/AgentStudio.module.css`

**Checkpoint**: User Story 4 passes the defined viewport matrix with no global layout regression.

---

## Phase 7: Polish & Cross-Cutting Validation

**Purpose**: Run the actual validation gates, reconcile the completed work with the specification, and document any environment-only limitation.

- [X] T024 Verify no role-only navigation or console action gate remains through targeted searches in `apps/admin-console/src` and `apps/platform-api/src`
- [ ] T025 Run API tests for `apps/platform-api/src/auth.spec.ts` and `apps/platform-api/src/app.integration.spec.ts`
- [X] T026 Run the console production build from `apps/admin-console/package.json`
- [ ] T027 Run Playwright access, navigation, mobile parity and Studio regression coverage in `tests/e2e/console.spec.ts` and `tests/e2e/agent-studio.spec.ts`
- [X] T028 Reconcile the implementation against `specs/004-open-access-mobile/spec.md` and record completed task status in `specs/004-open-access-mobile/tasks.md`

## Dependencies & Execution Order

- Phase 1 has no code dependency.
- Phase 2 blocks all UI work: UI cannot truthfully expose every feature until API guards use the same authenticated-session policy.
- US1 follows Phase 2 and establishes the full desktop capability baseline.
- US2 follows Phase 2 and can share the Layout shell with US1; in this execution it follows US1 to avoid edits to the same files concurrently.
- US3 follows the final mobile navigation structure because all actions must be reachable through it.
- US4 follows US2/US3 because it validates the combined overlays and responsive behavior.
- Polish requires every prior phase.

## Parallel Opportunities

- T003 and T004 can be authored independently before the shared access implementation.
- T010 and T013 can be prepared in the same E2E file only sequentially in this checkout; T018 can proceed separately in `tests/e2e/agent-studio.spec.ts`.
- T017 and T018 target different test suites; T019 and T021 target different layout domains once the shell contract is stable.
- T022 can be prepared alongside non-conflicting visual refinements but must validate after them.

## Implementation Strategy

1. Land the API/UI access-policy foundation and its tests first; verify non-administrator routes and operations before changing navigation.
2. Implement the five-item bottom navigation and more panel, then validate deep links and account/range actions at mobile width.
3. Extend page-level and Studio mobile parity with real interaction tests, not snapshots.
4. Run all focused API, build and E2E gates; mark a task complete only after its requested validation passes.

## Execution Status (2026-09-12)

- Completed implementation tasks are checked above. The console policy is deliberately scoped to `admin-router.ts`; shared authentication used by non-console routes remains unchanged.
- Passed: API type check, `auth.spec.ts` (12/12), console production build, ignore coverage, and diff whitespace check.
- Blocked environment-dependent validation: `app.integration.spec.ts` requires PostgreSQL (connection to `127.0.0.1:5432` was refused); Playwright reached neither `http://localhost:5173` nor `http://127.0.0.1:8080` (both refused connections). Docker Desktop's Linux engine pipe was also unavailable. Therefore T009, T025, T027 and the remaining expanded mobile-parity coverage tasks are intentionally left unchecked.