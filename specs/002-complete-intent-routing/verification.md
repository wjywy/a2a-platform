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

## Deployment evidence and release trigger

| Gate | Status | Reason / next action |
|---|---|---|
| CI | Pass | GitHub Actions run #54 completed dependency install, build, migration and the full test suite successfully. |
| Production credential check | Pass | The deployment job confirmed that `DEEPSEEK_API_KEY` is present on the production host without exposing its value. |
| Real DeepSeek stream smoke | Pass | The deployment job completed server-local A2A/SSE smoke tests for `symbol-market` and `symbol-company`, including terminal task completion and multiple stream events. |
| Public endpoint verification | Pass | `https://a2a-platform.com/healthz` returned HTTP 200 after the deployment job. |
| Symbol release image | Pending this commit | Run #54 safely reused the existing image because it only changed the deployment workflow; the preceding Symbol source release failed before image transfer. This documentation update deliberately triggers a full image build so the tested Symbol implementation is actually installed in production. |

The local test matrix validates routing behaviour against mocked DeepSeek and Provider boundaries. The production smoke proves an authenticated real-model stream, while ongoing monitoring remains necessary for classification quality across live user traffic.
