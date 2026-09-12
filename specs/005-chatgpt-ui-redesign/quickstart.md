# UI Redesign Validation Guide

## Prerequisites

- Install repository dependencies with existing lockfile.
- Start platform services and console through existing development or Docker commands.
- Use a test account with console data. For final Studio validation, select a healthy callable Agent runtime.

## Fast validation

1. Run `npm --workspace @a2a-platform/console run build`.
2. Run focused browser suites:
   - `npm run test:e2e -- tests/e2e/console.spec.ts`
   - `npm run test:e2e -- tests/e2e/agent-studio.spec.ts`
   - `npm run test:e2e -- tests/e2e/studio-product.spec.ts`
3. Inspect desktop at 1440×900 and 1280×800: grouped sidebar, one title, data/table density, focus states, no residual panel width.
4. Inspect mobile at 390×844 and 320×568: five bottom actions, “更多” reachability, 44px applicable controls, no document overflow or fixed-element overlap.
5. At 760/761 and 1079/1080px resize with selected detail, active filter, and safe unsubmitted form input. Confirm context remains and only one global navigation model is visible.

## State validation

For representative pages verify initial loading, refresh, empty, no-results, failure, disabled, submitting, success and confirmation states when applicable. Confirm a failed form preserves safe input and Studio history refresh preserves content.

## Real Studio validation

On desktop and a real mobile device, create a conversation with a healthy Agent, receive a completed reply, stop a second response, create a recoverable failure, open history and trace, then return to console. Record selected Agent and final event; an Agent Card or API health response is not completion evidence.

## Accessibility and device validation

- Complete navigation, filtering, details, a form, Studio panel opening and closing with keyboard only.
- Check 200% text enlargement, reduced motion and high-contrast rendering.
- On one iOS and one Android device, test keyboard, safe area, portrait/landscape, bottom navigation and Studio composer. Mark unavailable device checks unverified.

## Execution record — 2026-09-12

- `npm run build` in `apps/admin-console` passed after the final source changes. Vite reports the existing large-bundle advisory for the main client chunk; no bundle split was introduced by this visual feature.
- Directly relevant Playwright coverage passed with a local API at `http://127.0.0.1:3000`: 10 passed and 2 expected project skips. It covers desktop/mobile Studio geometry and return path, five mobile actions and “更多”, touch sizing, no horizontal overflow, light-surface hierarchy, and Agent-card desktop/mobile interaction.
- A full run of the three browser suites was also attempted. Docker could not start its local 8080 gateway because `infra-console:latest` already existed; an equivalent local API/Vite environment enabled focused validation. The full run then exposed existing runtime/data assumptions that are recorded separately, including an unavailable real Agent runtime. These are not treated as visual success evidence.
- Current physical-device testing and a final terminal `TASK_STATE_COMPLETED` reply remain unverified. See `checklists/implementation-evidence.md` for the evidence boundary.