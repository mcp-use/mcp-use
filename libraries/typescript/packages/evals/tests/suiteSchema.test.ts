import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { evalSuiteSchema } from "../src/schema/suite.v1.js";

describe("evalSuiteSchema", () => {
  it("accepts cloud trigger configuration", () => {
    const doc = parseYaml(`
apiVersion: mcp-use.com/evals/v1
kind: EvalSuite
name: cloud-trigger-smoke
triggers:
  manual: true
  ci:
    enabled: true
    branches: ["main", "release/*"]
    watchPaths: ["evals/**", "src/**"]
  cron:
    enabled: true
    schedule: "0 6 * * *"
    branch: main
flows:
  - id: smoke
    type: agent
    clients:
      - target: inspector
        models: ["openai/gpt-4o"]
    checks:
      - id: list-tools
        call:
          mcp: listTools
        assert:
          - kind: jsonpath
            path: "$[0].name"
    scenarios:
      - id: hello
        turns:
          - user: Hello
`);

    const suite = evalSuiteSchema.parse(doc);
    expect(suite.triggers?.ci?.branches).toEqual(["main", "release/*"]);
    expect(suite.triggers?.cron?.schedule).toBe("0 6 * * *");
  });
});
