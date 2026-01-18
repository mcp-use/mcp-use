import { describe, expect, it } from "vitest";
import { EvalCodeGenerator } from "../../../src/generator/codegen.js";

describe("EvalCodeGenerator", () => {
  it("generates a describe block with tool tests", () => {
    const generator = new EvalCodeGenerator();
    const output = generator.generate({
      server: "weather",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          tests: [
            { category: "direct", prompt: "Weather in Tokyo" },
            {
              category: "negative",
              prompt: "Capital of Japan",
              expectNotUsed: true,
            },
          ],
        },
      ],
      resources: [],
    });

    expect(output).toContain('describeIfConfigured("weather server"');
    expect(output).toContain('describe("get_weather"');
    expect(output).toContain('expect(result).toHaveUsedTool("get_weather")');
    expect(output).toContain(
      'expect(result).not.toHaveUsedTool("get_weather")'
    );
  });

  it("escapes quotes in prompts", () => {
    const generator = new EvalCodeGenerator();
    const output = generator.generate({
      server: "weather",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          tests: [{ category: "direct", prompt: 'Say "hello"' }],
        },
      ],
      resources: [],
    });

    expect(output).toContain('Say \\"hello\\"');
  });
});
