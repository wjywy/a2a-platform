# UI State Model

This feature changes presentation and interaction behavior; it adds no persisted business entities or database migrations. Existing API contracts remain authoritative.

## Design token set

| Field | Meaning | Validation |
| --- | --- | --- |
| Surface tokens | Canvas, layout, sidebar, selected and elevated backgrounds | Adjacent surfaces remain distinguishable in light mode |
| Text and action tokens | Primary, supporting, primary action, focus and semantic states | Required contrast and state meaning are preserved |
| Spacing and radius tokens | Named increments for page, group, field and control spacing | Same component category uses the same named token |
| Motion tokens | Press, hover, disclosure duration and easing | Transform/opacity-only feedback; reduced-motion alternative exists |

## Viewport layout state

| Field | Values | Invariant |
| --- | --- | --- |
| Layout mode | mobile, compact, desktop | One global navigation model is visible at a time |
| Current page | Existing `PageKey` values | Navigation highlights the page represented by the URL and view |
| Mobile more drawer | open, closed | Secondary navigation, scope and account actions remain reachable and closeable |
| Detail surface | inline, drawer, modal, closed | Close restores a logical trigger or list context |
| Viewport safety | normal, keyboard-open, safe-area | Fixed controls do not hide active input or final scrollable content |

## User interaction state

| Field | Values | Invariant |
| --- | --- | --- |
| Data request state | initial-loading, refreshing, ready, empty, filtered-empty, failed | Refresh retains ready data; empty and failed communicate different next steps |
| Mutation state | idle, submitting, succeeded, failed | Submitting prevents duplicate mutation; recoverable input survives failure |
| Control state | default, hover, focus, active, disabled | Touch does not require hover; focus is visible |
| Notification state | pending, success, warning, error | Notifications report actual outcomes and do not obscure exit or submit control |

## Studio state

| Field | Values | Invariant |
| --- | --- | --- |
| Conversation selection | no conversation, selected conversation | Selecting or reflowing preserves transcript and draft where existing behavior allows |
| Stream state | idle, generating, stopped, completed, failed, input-required | Composer exposes only actions valid for real stream state |
| History state | initial-loading, ready, refreshing, empty, filtered-empty, failed | Background refresh never replaces visible list with loading placeholder |
| Reading position | at latest, reading history | New output does not pull reader to bottom; return-to-latest remains available |
| Panel state | history, settings, trace, label manager, message editor | Only active overlay accepts focus; close restores useful context |
