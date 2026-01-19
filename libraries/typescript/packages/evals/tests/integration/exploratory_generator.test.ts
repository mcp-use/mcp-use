import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { describeIfConfigured } from "../../src/runtime/describeIfConfigured.js";
import { inspectServers } from "../../src/generator/inspectServers.js";
import { planTests } from "../../src/generator/planTests.js";

async function writeConfig(serverPath: string): Promise<string> {
  const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const configModel = process.env.OPENAI_CONFIG_MODEL || "gpt-5.2";

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evals-config-"));
  const configPath = path.join(dir, "eval.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        default: { runAgent: "run", judgeAgent: "judge" },
        agents: {
          run: { provider: "openai", model: configModel },
          judge: { provider: "openai", model: configModel },
        },
        servers: {
          simple: {
            type: "stdio",
            command: "tsx",
            args: [serverPath],
          },
        },
        defaults: { timeout: 30000, retries: 0, serverLifecycle: "suite" },
      },
      null,
      2
    )
  );
  return configPath;
}

describeIfConfigured("exploratory generator e2e", () => {
  it("produces test plans with exploratory mode enabled", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: OPENAI_API_KEY not set");
      return;
    }

    const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Path from evals package to mcp-use package's test server
    const serverPath = path.resolve(
      process.cwd(),
      "../mcp-use/tests/servers/simple_server.ts"
    );
    const configPath = await writeConfig(serverPath);

    const schemas = await inspectServers({ configPath, servers: ["simple"] });

    // Test with exploratory mode
    const plans = await planTests(schemas, {
      provider: "openai",
      model: openaiModel,
      explore: true,
      configPath,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].tools.length).toBeGreaterThan(0);
    expect(plans[0].server).toBe("simple");

    // Verify test structure
    const firstTool = plans[0].tools[0];
    expect(firstTool.tests.length).toBeGreaterThan(0);

    // Check that tests have required fields
    const firstTest = firstTool.tests[0];
    expect(firstTest).toHaveProperty("category");
    expect(firstTest).toHaveProperty("prompt");
    expect(["direct", "indirect", "negative", "error"]).toContain(
      firstTest.category
    );
  }, 180000); // Longer timeout for exploratory mode

  it("falls back to non-exploratory mode when explore is false", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: OPENAI_API_KEY not set");
      return;
    }

    const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const serverPath = path.resolve(
      process.cwd(),
      "../mcp-use/tests/servers/simple_server.ts"
    );
    const configPath = await writeConfig(serverPath);

    const schemas = await inspectServers({ configPath, servers: ["simple"] });

    // Test without exploratory mode (default behavior)
    const plans = await planTests(schemas, {
      provider: "openai",
      model: openaiModel,
      explore: false,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].tools.length).toBeGreaterThan(0);
  }, 120000);
});
