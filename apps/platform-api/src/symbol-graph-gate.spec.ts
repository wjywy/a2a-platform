import { expect, it, vi } from "vitest";
import { runSymbolGraph } from "./symbol-graph.js";
vi.mock("./db.js", () => ({ query: vi.fn().mockResolvedValue([{ id: "run-1" }]) }));
it.each(["capability_query", "small_talk", "out_of_scope", "task_control"])("blocks forged provider permission for %s at graph entry", async (intentType) => {
  const execute = vi.fn();
  await expect(runSymbolGraph({ tenantId: "tenant", taskId: "task", agentSlug: "symbol-market", intent: { intentType, symbol: "AAPL", confidence: 0.99 }, routing: { intentType: "research_request", taskRelation: "new", route: "research", missing: [], providerAllowed: true, reasonCodes: [] } }, execute)).rejects.toThrow("PROVIDER_ROUTE_DENIED");
  expect(execute).not.toHaveBeenCalled();
});
it("rejects missing route and missing critic thesis before executing any node", async () => {
  const execute = vi.fn();
  await expect(runSymbolGraph({ tenantId: "tenant", taskId: "task", agentSlug: "symbol-critic", intent: { intentType: "research_request", symbol: "AAPL" } }, execute)).rejects.toThrow("PROVIDER_ROUTE_DENIED");
  expect(execute).not.toHaveBeenCalled();
});
