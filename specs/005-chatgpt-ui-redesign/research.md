# Research: UI Redesign Decisions

## Decision: retain React, Ant Design, and CSS Modules

**Rationale**: The console already has a React/Vite application, centralized Ant Design theme, CSS token definitions, CSS Modules for shell/pages/Studio, and browser coverage for mobile navigation and real Studio behavior. Replacing the stack would create avoidable risk across 11 modules.

**Alternatives considered**: Tailwind is rejected because it competes with CSS Modules. Replacing Ant Design is rejected because existing forms and overlays already integrate behavior and accessibility. An independent mobile UI is rejected because the specification requires desktop/mobile equivalence.

## Decision: use a token-first, surface-step redesign

**Rationale**: `design-tokens.css` and `theme.ts` are shared sources for color, radius, typography and controls. Refining these before page styles gives shell, form, table, drawer, Studio and authentication pages a coherent baseline. Surface steps establish hierarchy without decorative card borders.

**Alternatives considered**: Page-by-page visual patches would leave incompatible spacing and states. Broad global Ant Design overrides could hide required page-specific behavior.

## Decision: retain five mobile primary destinations and the “更多” drawer

**Rationale**: The prior mobile specification and `Layout.tsx` establish the reachable five-item model. The redesign refines spacing, accessibility and touch behavior without reopening approved information architecture.

**Alternatives considered**: Horizontal scrolling navigation hides destinations. Moving all navigation to a top menu makes frequent mobile destinations slower to reach.

## Decision: treat Studio as a focused full-viewport work surface

**Rationale**: Studio already preserves real conversations, history, drafts, message actions and execution data. It needs a reading-first responsive layout, not a new conversation implementation. The debug shell must reserve mobile navigation space while keeping the composer visible above safe area and keyboard.

**Alternatives considered**: An isolated Studio tree risks losing persistence and stream lifecycle behavior. A permanent desktop third column reduces reading width; contextual drawers are clearer.

## Decision: test through browser suites plus focused assertions

**Rationale**: The repository has Playwright scenarios for geometry, no overflow, five navigation choices, Studio lifecycle, stream error recovery, and hover/focus behavior. Extend these alongside the console build.

**Alternatives considered**: Static style tests cannot reveal fixed-element overlap and responsive reflow. Screenshot-only acceptance cannot prove navigation, form submission, or Agent streaming.

## Decision: reserve a runnable Agent for the final real-conversation gate

**Rationale**: Most UI coverage uses the existing test setup. A successful visible Agent reply requires a registered healthy runtime and correct proxy/API environment, so it is recorded separately from visual and build checks.

**Alternatives considered**: A healthy API or Agent Card does not prove stream completion and is not accepted as a conversation result.
