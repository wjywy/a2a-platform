# UI Design Baseline: A2A Hub 中性浅色会话工作台

**Feature**: [PC 与移动端统一浅色工作台改造](./spec.md)
**Status**: Approved implementation baseline
**CSS strategy**: CSS Modules for component layout and interaction; shared CSS custom properties plus the existing Ant Design theme for global tokens. Do not introduce Tailwind, a second component system, or CSS-in-JS.

## 1. Visual Theme and Atmosphere

The interface is a precise, calm, Chinese-first workspace with a neutral white main canvas, a near-white context sidebar, and a graphite action color. Conversation, current task and content are the first visual layer; navigation, status and administration controls deliberately recede.

The experience takes inspiration from a focused ChatGPT/Codex workspace: grouped navigation, a persistent current context, reading-oriented conversation content, and details available on demand. It does not copy product branding, icons, copy, or proprietary assets.

## 2. Color Palette and Roles

| Token | Value | Role |
| --- | --- | --- |
| `--color-surface-canvas` | `#ffffff` | Main reading and form surface |
| `--color-surface-layout` | `#ffffff` | Primary application and continuous reading canvas |
| `--color-sidebar-background` | `#f9f9f9` | Quiet context navigation, stepped from the white main canvas |
| `--color-sidebar-selected` | `#e8e8e8` | Current section and selected history item |
| `--color-text-primary` | `#0d0d0d` | Headings, conversation and primary data |
| `--color-text-secondary` | `#676767` | Supporting labels and descriptions |
| `--color-action-primary` | `#212121` | Primary submit and send actions |
| `--color-action-primary-hover` | `#2f2f2f` | Pointer hover on primary action |
| `--color-focus-ring` | `#0d0d0d` | Keyboard focus and non-color-only affordance |
| `--color-status-success` | `#1d7350` | Completed and healthy states |
| `--color-status-warning` | `#8a5c12` | Attention and in-progress warnings |
| `--color-status-danger` | `#aa3c43` | Failures and destructive actions |

Semantic color always appears with text, iconography, numeric context, or a visible legend. The palette has no decorative gradients or glass effects.

## 3. Typography Rules

The primary stack remains the installed system UI stack: `Segoe UI Variable Text`, `Segoe UI`, `PingFang SC`, `Noto Sans CJK SC`, `Microsoft YaHei`, then system fallbacks. This provides fluent Chinese rendering without adding a network font dependency.

| Role | Size | Weight | Line height | Tracking |
| --- | --- | --- | --- | --- |
| Page title | 24px | 650 | 1.2 | `-0.012em` |
| Section title | 17px | 620 | 1.35 | normal |
| Body / table | 14px desktop, 16px mobile conversation | 400–540 | 1.55–1.65 | normal |
| Supporting text | 12px | 400–540 | 1.5 | normal |
| Conversation reading | 15px desktop, 16px mobile | 400 | 1.7 | normal |

Headings use balanced wrapping where supported. Numeric metrics and table columns use tabular figures.

## 4. Component Styling

- Primary buttons are graphite surfaces with white labels; default, hover, active, disabled, loading, success, and error states retain the same footprint.
- Secondary actions are flat or lightly filled neutral controls; card-like containers are reserved for distinct modules such as editable form, task detail, or overlay.
- Inputs have persistent labels, a 1px neutral boundary, explicit focus ring, in-place field error, and no placeholder-only labels.
- Ordinary controls and surfaces remain on the 4/8/12px scale. The Studio composer alone uses the 24px radius exception.
- Navigation uses a surface-step selected state instead of high-saturation color. Desktop sections are grouped; mobile has five fixed actions and a bottom-sheet “更多” menu.
- Icon-only controls have 40px visible controls and 44px touch targets where applicable, plus visible focus and accessible names.

## 5. Layout Principles

Use a 4px rhythm: 8px icon-to-label, 8–12px control groups, 16–20px form rows, and 24–32px content groups. Typical desktop page gutter is 28px, mobile is 16px and narrows to 12px at 320px.

The desktop shell uses a quiet context sidebar and a 56px local header. List and analytics pages use available width without a permanent dashboard banner; forms remain comfortably readable. Studio reserves a 720–800px reading column, keeps the composer aligned to it, and exposes history or details only as secondary context.

## 6. Depth and Elevation

Depth comes from a restrained neutral surface ladder: sidebar `#f9f9f9`, main canvas `#ffffff`, hover `#ececec`, and selected surface `#e8e8e8`. Ordinary content sections remain flush and cardless where possible. Menus, drawers and modals alone receive a light shadow; separators use a single faint border token.

## 7. Do and Don't

- Do keep one page title and one clearly ranked primary action per management view.
- Do preserve real Agent, task, form, history, and message interactions while restyling.
- Do use `@media (hover: hover)` for pointer-only hover affordances.
- Do keep context during reflow, refresh, and loading states.
- Do make empty, loading, unknown, failed, stopped, and successful states distinct.
- Do not add a hero, marketing copy, gradient, glassmorphism, new brand mark, or generic decorative card grid.
- Do not make mobile rely on hover, hide functional desktop actions, or create page-level horizontal overflow.
- Do not animate layout properties or use `transition: all`.

## 8. Responsive Behavior

| Width | Navigation | Content |
| --- | --- | --- |
| 320–760px | Five-item bottom navigation, secondary destinations in “更多” | Single column, 44px touch targets, readable object rows and expandable details |
| 761–1079px | Compact sidebar, no mobile navigation | Reflowed tools and panels; never squeeze reading content below usability |
| 1080px+ | Full grouped sidebar | Data views use full workspace; Studio preserves reading width |

All layouts support safe areas, soft keyboard changes, reduced motion, forced colors, 200% text enlargement, and narrow effective widths without losing controls.

## 9. Implementation Prompts

- “Update a desktop management page to use a `#ffffff` main canvas, `#f9f9f9` context surface, 24px desktop gutter, 24px 650 page title, 17px 620 section headings, 8px control radius, 24px group spacing, tabular numeric columns, and no decorative card grid.”
- “Create a mobile object-row detail entry using 16px page gutter, 44px touch target, `#0d0d0d` primary text, `#676767` supporting text, a 12px detail panel radius, and an explicit visible action. Preserve all desktop actions through the detail panel.”
- “Style a Studio composer using a `#f4f4f4` input surface on the white main canvas, 24px radius, 16px mobile body text, graphite `#212121` send button, `#0d0d0d` focus ring, and transform-only active feedback.”
- “Style a status result with text plus icon and semantic color; use `#1d7350` success, `#8a5c12` warning, or `#aa3c43` error, keeping a 4.5:1 text contrast ratio on its surface.”

## 10. Audit-Driven Parity Revision — 2026-09-13

The second implementation pass adopts the complete findings in [chatgpt-ui-difference-audit.md](./chatgpt-ui-difference-audit.md). Its decisive change is structural: the app is no longer styled as a warm operations dashboard with a chat area inside it. The white main canvas, quiet context navigation, compact local header, conversation reading column and bottom composer define the shell; metrics, tables, status and execution details become tools inside that shell.

The memorable anchor is the uninterrupted white reading plane aligned from the conversation transcript into the input surface. Radius tiers are 4px for tiny labels, 8px for controls and navigation, 12px for menus and tool surfaces, and 24px only for the composer. Interactive controls use `transform: scale(0.96)` on press and keep the same footprint in loading, selected, disabled, success and error states.
