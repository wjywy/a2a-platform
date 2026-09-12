# UI Design Baseline: A2A Hub 浅色运营工作台

**Feature**: [PC 与移动端统一浅色工作台改造](./spec.md)
**Status**: Approved implementation baseline
**CSS strategy**: CSS Modules for component layout and interaction; shared CSS custom properties plus the existing Ant Design theme for global tokens. Do not introduce Tailwind, a second component system, or CSS-in-JS.

## 1. Visual Theme and Atmosphere

The interface is a precise, calm, Chinese-first operations workspace. It uses a lightly warm neutral canvas, a graphite action color, and tight information hierarchy so agents, tasks, and conversation context stay more prominent than UI decoration.

The experience takes inspiration from a focused ChatGPT/Codex workspace: grouped navigation, a persistent current context, reading-oriented conversation content, and details available on demand. It does not copy product branding, icons, copy, or proprietary assets.

## 2. Color Palette and Roles

| Token | Value | Role |
| --- | --- | --- |
| `--color-surface-canvas` | `#ffffff` | Main reading and form surface |
| `--color-surface-layout` | `#f4f4f2` | Application canvas and page background |
| `--color-sidebar-background` | `#ecece8` | Persistent navigation, visibly stepped from main canvas |
| `--color-sidebar-selected` | `#deded8` | Current section and selected history item |
| `--color-text-primary` | `#1f1f1c` | Headings and primary data |
| `--color-text-secondary` | `#5f5f59` | Supporting labels and descriptions |
| `--color-action-primary` | `#292925` | Primary submit and send actions |
| `--color-action-primary-hover` | `#171715` | Pointer hover on primary action |
| `--color-focus-ring` | `#365f86` | Keyboard focus and non-color-only affordance |
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
- Navigation uses a surface-step selected state instead of high-saturation color. Desktop sections are grouped; mobile has five fixed actions and a bottom-sheet “更多” menu.
- Icon-only controls have 40px visible controls and 44px touch targets where applicable, plus visible focus and accessible names.

## 5. Layout Principles

Use a 4px rhythm: 8px icon-to-label, 8–12px control groups, 16–20px form rows, and 24–32px content groups. Typical desktop page gutter is 28px, mobile is 16px and narrows to 12px at 320px.

The desktop shell uses a grouped sidebar and compact context bar. List and analytics pages use available width; forms remain comfortably readable. Studio reserves a 720–800px reading column with history and details outside that column.

## 6. Depth and Elevation

Depth comes first from surface stepping: sidebar `#ecece8`, layout `#f4f4f2`, canvas `#ffffff`, and selected surface `#deded8`. Ordinary content sections remain flush. Menus, drawers, modals, and mobile navigation use small/medium shadows, without strong borders around every container.

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

- “Update a desktop management page to use `#f4f4f2` layout, a white content surface, 28px desktop gutter, 24px 650 page title, 17px 620 section headings, 8px control radius, 24px group spacing, tabular numeric columns, and no decorative card grid.”
- “Create a mobile object-row detail entry using 16px page gutter, 44px touch target, `#1f1f1c` primary text, `#5f5f59` supporting text, a 12px detail panel radius, and an explicit visible action. Preserve all desktop actions through the detail panel.”
- “Style a Studio composer using a white raised surface on `#f4f4f2`, 24px radius, 16px mobile body text, graphite `#292925` send button, `#365f86` focus ring, and transform-only active feedback.”
- “Style a status result with text plus icon and semantic color; use `#1d7350` success, `#8a5c12` warning, or `#aa3c43` error, keeping a 4.5:1 text contrast ratio on its surface.”
