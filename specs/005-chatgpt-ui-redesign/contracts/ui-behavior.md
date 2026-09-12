# UI Behavior Contract

## Navigation contract

- Desktop presents grouped navigation for every existing console page and preserves current-page semantics.
- Mobile presents exactly five primary actions: 概览, Agent, 在线调试, 任务, 更多.
- “更多” exposes secondary pages, active working range, registration and account actions through touch- and keyboard-reachable controls.
- URL visit, refresh, and browser navigation restore matching navigation state.

## Responsive contract

- 320–760px uses mobile single column with 44×44px applicable touch targets.
- 761–1079px uses compact desktop navigation without mobile bar.
- 1080px and above uses full grouped desktop sidebar.
- Layout change preserves current page, safe form input, selected detail, selected conversation and draft according to existing behavior.
- Only data/code regions needing horizontal comparison may scroll horizontally; the document viewport may not overflow horizontally.

## State-feedback contract

- Initial loading, refresh, empty data, no filter match, failed request, submitting, stopped stream, completed stream and input-required states have distinct visible messages or controls.
- Mutation feedback represents actual completion; the UI never announces success before operation succeeds.
- Pointer hover is supplemental; keyboard focus and touch press have equivalent discoverability.
- Controls retain layout footprint while pending or reporting outcome.

## Studio contract

- Preserve existing Agent selection, create/switch/search/label/rename/archive/restore/delete, edit/regenerate/branch/copy, trace and retry operations.
- Desktop response content remains reading-oriented. Mobile uses history drawer and keeps composer reachable above navigation and keyboard.
- The user can return from Studio to console on desktop and mobile.
- Background history refresh does not discard visible history, draft or reading context.

## Accessibility contract

- Every interactive element has accessible name; icon-only controls retain `aria-label`.
- Keyboard focus is visible, modal focus contained, and close restores useful focus.
- Status meaning does not rely on color alone.
- Normal text meets 4.5:1 contrast, large text 3:1, and focus/control indicators 3:1.
