import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { describeIfConfigured } from "../../src/runtime/describeIfConfigured.js";
import { EvalCodeGenerator } from "../../src/generator/codegen.js";
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

describeIfConfigured("generator e2e", () => {
  it("produces a runnable eval file from inspected servers", async () => {
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
    const plans = await planTests(schemas, {
      provider: "openai",
      model: openaiModel,
    });

    const generator = new EvalCodeGenerator();
    const code = generator.generate(plans[0]);

    expect(code).toContain("describeIfConfigured");
    expect(code).toContain("add");
  }, 120000);
});
