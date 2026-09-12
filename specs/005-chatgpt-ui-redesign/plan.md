# Implementation Plan: PC 与移动端统一浅色工作台改造

**Branch**: `005-chatgpt-ui-redesign` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

## Summary

Unify the existing A2A Hub console, authentication entry and Studio around a light, reading-first operations workspace while preserving every current real navigation, form, message and Agent interaction. Start with shared tokens and shell behavior, then align management pages, Studio and mobile interaction, backed by focused Playwright coverage and the console build.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.1

**Primary Dependencies**: Vite 6, Ant Design 6, `@ant-design/icons`, React Markdown, Vercel AI SDK UI integration

**Storage**: Existing platform API and conversation persistence; no schema, API or storage change

**Testing**: Console TypeScript build and Playwright suites in `tests/e2e/console.spec.ts`, `tests/e2e/agent-studio.spec.ts`, `tests/e2e/studio-product.spec.ts`

**Target Platform**: Desktop Chromium/Firefox, iOS Safari and Android Chrome; keyboard, touch, reduced-motion and forced-color modes

**Project Type**: Monorepo web application; this feature changes the React admin console

**Performance Goals**: Applicable interactive actions show feedback within 200ms in at least 95% of sampled actions; no page-level horizontal overflow at required viewports

**Constraints**: Preserve business behavior and `004-open-access-mobile` navigation/access decisions; light only; CSS Modules plus tokens; no visual framework, copied branding or decorative gradients

**Scale/Scope**: Global shell, 11 modules, authentication entry, Studio workspace, shared primitives and browser tests

## Constitution Check

The project constitution remains an unfilled template and provides no enforceable project-specific gates. The approved feature gates are:

- Preserve real A2A and conversation behavior; do not mock or replace Studio persistence and streaming.
- Retain five mobile primary actions and desktop/mobile capability equivalence.
- Validate visual behavior, keyboard/touch states and real Agent streaming separately.
- Do not claim device or public deployment results that were not executed.

**Pre-research status**: PASS. The feature needs no new data model, API, third-party service or architecture exception.

## Design Artifacts

- [DESIGN.md](./DESIGN.md): visual system, surface, typography, responsive and component baseline.
- [research.md](./research.md): implementation decisions and rejected alternatives.
- [data-model.md](./data-model.md): visual and interaction state model; no persisted data change.
- [contracts/ui-behavior.md](./contracts/ui-behavior.md): navigation, responsive, feedback, Studio and accessibility contract.
- [quickstart.md](./quickstart.md): runnable validation guide.

## Project Structure

### Documentation

```text
specs/005-chatgpt-ui-redesign/
├── spec.md
├── DESIGN.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/ui-behavior.md
├── quickstart.md
└── tasks.md
```

### Source Code

```text
apps/admin-console/src/
├── styles/design-tokens.css     # Shared visual variables
├── theme.ts                     # Ant Design token bridge
├── index.css                    # Global browser/accessibility defaults
├── ConsoleShell.module.css      # Console shell and mobile navigation
├── Layout.tsx                   # Navigation and global controls
├── ui.tsx                       # Shared UI primitives
├── pages/
│   ├── AuthPage.tsx
│   ├── AuthPage.module.css
│   └── {Overview,Agents,Tasks,Usage,Tenants,Members,Webhooks,Alerts,Audit,Settings,Debug}Page.tsx
└── components/studio/
    ├── AgentStudio.module.css
    ├── Studio{Workspace,Header,History,Transcript,Composer,Panels}.tsx
    └── useStudio*.ts

tests/e2e/
├── console.spec.ts
├── agent-studio.spec.ts
└── studio-product.spec.ts
```

**Structure Decision**: Keep visual work in the existing console package. Shared rules live in tokens/theme/index; shell, page and Studio modules own layout-specific rules; existing browser suites validate behavior.

## Implementation Order

1. Establish tokens, theme, global typography/focus/motion baseline.
2. Align desktop/mobile shell and shared UI primitives.
3. Refine management-page dense data patterns and authentication entry without changing business actions.
4. Refine Studio reading layout, composer, history/panel behavior and touch states while retaining existing APIs.
5. Expand focused browser assertions, build, and run appropriate desktop/mobile suites.

## Post-Design Constitution Check

**Status**: PASS. The plan uses existing source boundaries and component stack. It introduces no persistence model, API, third-party service or nonstandard architecture exception.
