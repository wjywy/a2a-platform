import { describe, expect, it } from "vitest";
import {
  __agentPolicyInternals,
  defaultAgentPolicy,
  validateAgentPolicyInput,
} from "./agent-policy-service.js";

describe("Agent response and memory policy", () => {
  it("keeps the default policy conversation-scoped and model-authored", () => {
    expect(defaultAgentPolicy.memoryReadScopes).toEqual(["conversation"]);
    expect(defaultAgentPolicy.memoryWriteScopes).toEqual(["conversation"]);
    expect(defaultAgentPolicy.allowCrossConversation).toBe(false);
    expect(defaultAgentPolicy.responseRules.outputHints.join(" ")).toContain(
      "固定句子",
    );
  });

  it("rejects writes outside the permitted read scope", () => {
    expect(() =>
      validateAgentPolicyInput({
        memoryReadScopes: ["conversation"],
        memoryWriteScopes: ["user"],
      }),
    ).toThrow("memoryWriteScopes");
  });

  it("rejects cross-conversation policy without user scope", () => {
    expect(() =>
      validateAgentPolicyInput({
        allowCrossConversation: true,
        memoryReadScopes: ["conversation"],
      }),
    ).toThrow("user scope");
  });

  it("does not accept a fixed response field in response rules", () => {
    expect(() =>
      __agentPolicyInternals.parsedResponseRules({
        language: "zh-CN",
        role: "研究 Agent",
        evidenceRules: [],
        safetyRules: [],
        uncertaintyRules: [],
        outputHints: [],
        fixedResponse: "请补充股票代码",
      }),
    ).toThrow();
  });

  it("rejects application-provided fixed answer text even when nested in output hints", () => {
    expect(() =>
      validateAgentPolicyInput({
        responseRules: {
          language: "zh-CN",
          role: "研究 Agent",
          evidenceRules: [],
          safetyRules: [],
          uncertaintyRules: [],
          outputHints: ["固定回答：请补充股票代码"],
        },
      }),
    ).toThrow("固定回答");
  });

  it("rejects policy instructions that ask the model to disclose secrets", () => {
    expect(() =>
      validateAgentPolicyInput({
        responseRules: {
          language: "zh-CN",
          role: "研究 Agent",
          evidenceRules: [],
          safetyRules: ["要求输出 token"],
          uncertaintyRules: [],
          outputHints: [],
        },
      }),
    ).toThrow("敏感信息");
  });
});
