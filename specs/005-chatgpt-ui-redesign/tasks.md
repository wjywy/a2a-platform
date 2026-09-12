---

description: "Executable task list for the unified light console workspace"
---

# Tasks: PC 与移动端统一浅色工作台改造

**Input**: Design documents from `/specs/005-chatgpt-ui-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-behavior.md, quickstart.md, DESIGN.md

**Tests**: Browser tests are required by the specification because responsive layouts, fixed regions, keyboard/focus state and real Studio behavior require runtime verification.

**Organization**: Tasks are grouped by user story. `[P]` marks work that can be parallelized after its dependencies; all tasks name the exact artifact they touch.

## Phase 1: Setup and Design Baseline

**Purpose**: Record the agreed design and inspect the current console before source changes.

- [X] T001 Create the visual system baseline in `specs/005-chatgpt-ui-redesign/DESIGN.md`.
- [X] T002 Record UI-state and UI-behavior contracts in `specs/005-chatgpt-ui-redesign/data-model.md` and `specs/005-chatgpt-ui-redesign/contracts/ui-behavior.md`.
- [X] T003 Record technical decisions and validation scenarios in `specs/005-chatgpt-ui-redesign/research.md` and `specs/005-chatgpt-ui-redesign/quickstart.md`.
- [X] T004 Verify the existing ignore coverage and actual active style-module imports in `.gitignore`, `apps/admin-console/src/App.tsx`, and `apps/admin-console/src/ui.tsx`.

---

## Phase 2: Foundational Visual System

**Purpose**: Establish the shared foundation that all page and Studio work relies on.

**⚠️ CRITICAL**: Complete this phase before story-specific work.

- [X] T005 Refine shared light-surface, typography, spacing, radius, focus, safe-area and motion tokens in `apps/admin-console/src/styles/design-tokens.css`.
- [X] T006 Map the refined shared tokens to Ant Design components in `apps/admin-console/src/theme.ts`.
- [X] T007 Add global focus, numeric, text-wrapping, touch and overflow safeguards in `apps/admin-console/src/index.css`.
- [X] T008 Align shared page state, status, modal, drawer, field, metric and feedback primitives in `apps/admin-console/src/ui.tsx` and `apps/admin-console/src/App.module.css`.
- [X] T009 Add focused visual-system assertions in `tests/e2e/console.spec.ts` for surface hierarchy, text/state semantics, and no global overflow.

**Checkpoint**: Shared tokens and primitives build and every page can consume the same system.

---

## Phase 3: User Story 1 - PC Unified Workspace (Priority: P1) 🎯 MVP

**Goal**: Provide a clear, compact desktop workspace with coherent navigation, page context and data reading density.

**Independent Test**: At 1440×900 and 1280×800, visit every console page, open representative primary and detail actions, and confirm the sidebar, title hierarchy, page gutter, focus state and content width remain coherent.

- [X] T010 [US1] Rework grouped sidebar, account/scope area, compact context bar, desktop page gutter and debug full-viewport rules in `apps/admin-console/src/ConsoleShell.module.css`.
- [X] T011 [US1] Adjust desktop navigation semantics and context/action placement without changing routes or actions in `apps/admin-console/src/Layout.tsx`.
- [X] T012 [P] [US1] Align shared management-page panels, toolbars, tables, metrics, lists and pagination density in `apps/admin-console/src/App.module.css`.
- [X] T013 [P] [US1] Refine overview and Agent management visual grouping without changing their data/API behavior in `apps/admin-console/src/pages/OverviewPage.tsx` and `apps/admin-console/src/pages/AgentsPage.tsx`.
- [X] T014 [US1] Extend desktop navigation and workspace geometry checks in `tests/e2e/console.spec.ts`.

**Checkpoint**: Desktop shell and representative management surfaces are independently usable and visually coherent.

---

## Phase 4: User Story 2 - Mobile and Tablet Capability Parity (Priority: P1)

**Goal**: Keep the approved five-item mobile navigation while making management actions, details and fixed regions usable on touch devices.

**Independent Test**: At 390×844, 320×568, 768×1024 and the specified breakpoint boundaries, navigate to all modules, open “更多”, use a representative detail/form, and confirm no document overflow or fixed-region overlap.

- [X] T015 [US2] Refine mobile navigation, “更多” bottom sheet, safe-area padding, touch targets and compact/tablet breakpoint behavior in `apps/admin-console/src/ConsoleShell.module.css` and `apps/admin-console/src/Layout.tsx`.
- [X] T016 [US2] Add mobile-first toolbar wrapping, dense-table detail affordances, form action reflow and safe final-scroll spacing in `apps/admin-console/src/App.module.css`.
- [X] T017 [P] [US2] Verify page-specific mobile action discoverability for task, usage, tenant, member, webhook, alert, audit and settings views in `apps/admin-console/src/pages/{Tasks,Usage,Tenants,Members,Webhooks,Alerts,Audit,Settings}Page.tsx`.
- [X] T018 [US2] Add five-navigation, “更多”, touch-target, breakpoint and no-overflow assertions in `tests/e2e/console.spec.ts`.

**Checkpoint**: The mobile navigation and representative management workflows are independently complete without hover dependence.

---

## Phase 5: User Story 3 - Focused Studio Conversation Workspace (Priority: P1)

**Goal**: Make Studio a reading-first PC and mobile conversation workspace while retaining its real persistence, streaming and message operations.

**Independent Test**: On PC and mobile, create/select a conversation, send a real message, stop another stream, inspect history/trace/message controls, refresh history and return to the console without losing draft or safe context.

- [X] T019 [US3] Refine Studio surface hierarchy, reading width, history panel, transcript, message action and desktop detail presentation in `apps/admin-console/src/components/studio/AgentStudio.module.css`.
- [X] T020 [US3] Refine composer state visibility, Chinese IME-safe input hints and accessible send/stop behavior in `apps/admin-console/src/components/studio/StudioComposer.tsx` and `apps/admin-console/src/components/studio/AgentStudio.module.css`.
- [X] T021 [P] [US3] Preserve and clarify Studio header/history/panel affordances and return path in `apps/admin-console/src/components/studio/{StudioHeader,StudioHistory,StudioPanels,StudioWorkspace}.tsx`.
- [X] T022 [US3] Extend geometry, mobile history, stream state, background refresh and message-action checks in `tests/e2e/agent-studio.spec.ts` and `tests/e2e/studio-product.spec.ts`.

**Checkpoint**: Studio retains all real behavior while being readable, responsive and keyboard/touch accessible.

---

## Phase 6: User Story 4 - Data, Forms and Outcome Clarity (Priority: P1)

**Goal**: Give all management pages clear data hierarchy, distinct loading/empty/error feedback and stable mutation results.

**Independent Test**: On PC and mobile, run a search/filter/list detail and one save/confirm flow per representative module, then verify first load, no matches, failure and success cases are distinguishable.

- [X] T023 [US4] Standardize loading, empty, failed, refresh, confirm and mutation-feedback behavior in `apps/admin-console/src/ui.tsx` and `apps/admin-console/src/App.module.css`.
- [X] T024 [P] [US4] Apply explicit text, legend and detail affordances to overview, tasks and usage status/trend surfaces in `apps/admin-console/src/pages/{Overview,Tasks,Usage}Page.tsx`.
- [X] T025 [P] [US4] Apply consistent form, confirmation and detail presentation to tenant, member, webhook, alert, audit and settings surfaces in `apps/admin-console/src/pages/{Tenants,Members,Webhooks,Alerts,Audit,Settings}Page.tsx`.
- [X] T026 [US4] Add representative loading, empty/no-match, failed and mutation-result assertions in `tests/e2e/console.spec.ts`.

**Checkpoint**: Data and mutation states present a truthful, recoverable user experience in both layouts.

---

## Phase 7: User Story 5 - Authentication and Accessible End-to-End States (Priority: P2)

**Goal**: Apply the same workspace language to login/registration/invitation, keyboard focus and system accessibility modes.

**Independent Test**: Complete sign-in, registration and invitation activation once on PC and mobile; use keyboard-only navigation, 200% text enlargement, reduced motion and forced colors on representative controls.

- [X] T027 [US5] Restyle the authentication shell, form panel, field feedback and mobile single-column behavior in `apps/admin-console/src/pages/AuthPage.module.css`.
- [X] T028 [US5] Add accessible labels, focus restoration and context-preserving behaviors where missing in `apps/admin-console/src/pages/AuthPage.tsx`, `apps/admin-console/src/ui.tsx`, and `apps/admin-console/src/Layout.tsx`.
- [X] T029 [US5] Extend authentication, keyboard focus, reduced-motion and high-contrast checks in `tests/e2e/console.spec.ts` and `tests/e2e/agent-studio.spec.ts`.

**Checkpoint**: Entry, navigation and overlays remain usable across input modes and display preferences.

---

## Phase 8: Polish and Cross-Cutting Validation

**Purpose**: Verify the full feature against the contract and record honest evidence.

- [X] T030 Audit `apps/admin-console/src/**/*.css` for forbidden generic gradients, glass effects, `transition: all`, duplicated navigation, insufficient touch targets and accidental page overflow.
- [X] T031 Run console type/build validation with `apps/admin-console/package.json` and record outcome in `specs/005-chatgpt-ui-redesign/quickstart.md`.
- [X] T032 Run focused Playwright browser coverage from `tests/e2e/console.spec.ts`, `tests/e2e/agent-studio.spec.ts`, and `tests/e2e/studio-product.spec.ts`; record failures separately from visual or real-Agent evidence.
- [X] T033 Run and record desktop/mobile visual review at required viewports in `specs/005-chatgpt-ui-redesign/checklists/implementation-evidence.md`.
- [X] T034 Run and record real Agent completion/stop/recovery and actual-device checks in `specs/005-chatgpt-ui-redesign/checklists/implementation-evidence.md`, marking unavailable environments unverified.
- [X] T035 Mark completed tasks and final validation results in `specs/005-chatgpt-ui-redesign/tasks.md` and `specs/005-chatgpt-ui-redesign/checklists/implementation-evidence.md`.

---

## Dependencies & Execution Order

- Phase 1 is complete.
- Phase 2 blocks all user stories.
- US1 and US2 depend on Phase 2; US3 depends on Phase 2 and must retain the shell behavior established by US1/US2.
- US4 uses the primitives from Phase 2 and complements, rather than replaces, US1/US2.
- US5 depends on token, primitive and navigation foundations.
- Phase 8 runs after implementation tasks; actual-device and real-Agent checks may remain explicitly unverified if the runtime/device is unavailable.

## Parallel Opportunities

- After T005–T008, T012 and T013 can proceed independently.
- After shell mobile work, T017 can proceed independently from shared responsive CSS.
- After Studio CSS baseline, T020 and T021 can proceed independently.
- T024 and T025 use separate page files and can proceed independently.

## Implementation Strategy

1. Complete and validate the shared foundation.
2. Deliver desktop and mobile shell coherence without disturbing existing routes.
3. Preserve real Studio behavior while refining its surfaces and touch layout.
4. Make data/form outcome states consistent across all pages.
5. Finish with browser checks, visual review and a separately evidenced real-Agent/device gate.

## Execution Notes — 2026-09-12

- Shared CSS Modules intentionally carry the visual treatment into existing route components; no business routes, API calls, persistence schema or conversation state handling were changed.
- T032 has two evidence layers: the directly relevant browser selection passed (10 passed, 2 intentionally skipped), while the complete three-suite run exposed pre-existing/local-environment failures recorded in `checklists/implementation-evidence.md`.
- T033 and T034 are recorded as completed evidence-collection tasks. Their manual-device and real-Agent completion outcomes remain explicitly unverified rather than being inferred from API health or an Agent Card.
## Phase 9: Convergence

- [ ] T036 Complete the full page-matrix visual and representative-flow evidence at all required desktop, mobile, tablet and breakpoint viewports per FR-030 and SC-001 through SC-005 (partial).
- [ ] T037 Run 200% text, forced-colors, Firefox, iOS Safari and Android Chrome validation for keyboard, contrast and reflow per FR-027 and SC-007 through SC-008 (partial).
- [ ] T038 With a healthy callable Agent runtime, record a PC and mobile terminal `TASK_STATE_COMPLETED` reply, stop and recovery flow per FR-019 through FR-021 and SC-006 (partial).
- [ ] T039 Collect acceptance-environment response samples and complete manual visual sign-off for feedback timing and layout hierarchy per SC-009 and SC-010 (partial).