import { describe, expect, it } from "vitest";
import { resolveChatToolPolicy } from "../chat-tool-policy";

describe("resolveChatToolPolicy", () => {
  it("hides app-only tools from the model while retaining user choices", () => {
    const tools = [
      { name: "legacy" },
      { name: "app-only", _meta: { ui: { visibility: ["app"] } } },
      { name: "model-only", _meta: { ui: { visibility: ["model"] } } },
      {
        name: "shared",
        _meta: { ui: { visibility: ["model", "app"] } },
      },
    ];

    const policy = resolveChatToolPolicy(tools, new Set(["model-only"]));
    expect(policy.modelVisibleTools.map((tool) => tool.name)).toEqual([
      "legacy",
      "model-only",
      "shared",
    ]);
    expect([...policy.effectiveDisabledTools].sort()).toEqual([
      "app-only",
      "model-only",
    ]);
    expect(tools.map((tool) => tool.name)).toContain("app-only");
  });
});
