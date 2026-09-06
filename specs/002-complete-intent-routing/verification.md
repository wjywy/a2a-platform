# Verification: Symbol Agent 完整意图识别与自然路由

**Recorded**: 2026-09-06

## Local implementation evidence

| Gate | Result | Evidence |
|---|---|---|
| API type build | Pass | `npm --workspace @a2a-platform/api run build` |
| Workspace build | Pass | `npm run build --workspaces` |
| Focused routing tests | Pass | 7 files, 176 tests: strict intent schema, memory context, Provider gate, A2A/SSE and 100 multi-turn cases |
| Full API test suite | Pass | `npm test`: 18 files, 284 tests |
| Database migration | Pass | `npm run migrate` applied `027_symbol_intent_routing.sql`; PostgreSQL confirms `routing_trace`, `active_intent`, `clarification_history` as `jsonb` |

## Behaviour covered locally

- All seven Symbol Agents return an Agent-authored completed task for capability questions and do not invoke the research graph.
- Research requests recompute missing fields on the server; model-provided empty `missing` cannot bypass the gate.
- Company-name unique resolution, ambiguity, selected candidates, corrections, new tasks, task reset and tenant/Agent isolation are covered through the HTTP/SSE route.
- 100 deterministic multi-turn cases cover a collecting research task interrupted by capability questions, small talk or clarification explanation, then resumed with a symbol and follow-up.
- SSE cumulative text, terminal Task, route metadata and subscribe replay remain consistent.

## Not yet executed

| Gate | Status | Reason / next action |
|---|---|---|
| Real DeepSeek routing smoke | Not executed | Local environment intentionally has no `DEEPSEEK_API_KEY`. Run `npx tsx scripts/verify-symbol-routing.ts` on the deployed host with a test tenant and server-only token. |
| CI | Not executed for this change | Requires commit and push. CI already has a server-side credential presence check and real-model stream smoke. |
| Deployment | Not executed | No push or deployment was requested in this implementation turn. |
| Public endpoint verification | Not executed | Requires a successful deployment first. |

The local test matrix validates routing behaviour against mocked DeepSeek and Provider boundaries. It is not a claim of real-model classification accuracy; that evidence must come from the server-local smoke and production monitoring after deployment.
