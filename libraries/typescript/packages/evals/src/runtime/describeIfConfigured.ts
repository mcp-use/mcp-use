import { describe, it } from "vitest";

/**
 * Conditionally run a test suite based on available API keys.
 *
 * Automatically skips the test suite if neither OPENAI_API_KEY nor ANTHROPIC_API_KEY
 * environment variables are set. This is useful for eval tests that require LLM access.
 *
 * @param name - Name of the test suite
 * @param fn - Test suite function to run if API keys are available
 *
 * @example
 * ```typescript
 * import { describeIfConfigured, createEvalAgent } from "@mcp-use/evals";
 *
 * describeIfConfigured("Weather Server Evals", () => {
 *   let agent: EvalAgent;
 *
 *   beforeAll(async () => {
 *     agent = await createEvalAgent({ servers: ["weather"] });
 *   });
 *
 *   it("gets weather for a city", async () => {
 *     const result = await agent.run("What's the weather in SF?");
 *     expect(result).toHaveUsedTool("get_weather");
 *   });
 * });
 * ```
 */
export function describeIfConfigured(name: string, fn: () => void): void {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    describe.skip(name, () => {
      it("skipped: missing API keys for evals", () => {});
    });
    // eslint-disable-next-line no-console
    console.warn(
      `⚠ Skipping "${name}" — missing OPENAI_API_KEY or ANTHROPIC_API_KEY`
    );
    return;
  }

  describe(name, fn);
}
