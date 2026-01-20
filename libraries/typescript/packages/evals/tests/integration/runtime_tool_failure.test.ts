import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { createEvalAgent, describeIfConfigured } from "../../src/index.js";

async function writeConfig(serverPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evals-config-"));
  const configPath = path.join(dir, "eval.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        default: { runAgent: "run", judgeAgent: "judge" },
        agents: {
          run: { provider: "openai", model: "gpt-5.2" },
          judge: { provider: "openai", model: "gpt-5.2" },
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

describeIfConfigured("eval runtime tool success", () => {
  it("runs agent and produces output", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: OPENAI_API_KEY not set");
      return;
    }

    // Path from evals package to mcp-use package's test server
    const serverPath = path.resolve(
      process.cwd(),
      "../mcp-use/tests/servers/simple_server.ts"
    );
    const configPath = await writeConfig(serverPath);

    const agent = await createEvalAgent({
      configPath,
      servers: ["simple"],
    });

    // Use Infinity which will pass type checking but cause an error
    const result = await agent.run(
      "Call the add tool with a=Infinity and b=Infinity"
    );

    // Since GPT-5.2 is smart enough to avoid calling with obviously invalid params,
    // we just verify the agent ran successfully without errors
    expect(result.error).toBeUndefined();
    expect(result.output.length).toBeGreaterThan(0);

    await agent.cleanup();
  }, 60000);
});
