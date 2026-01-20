import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { describeIfConfigured } from "../../src/runtime/describeIfConfigured.js";
import { judge } from "../../src/runtime/judge.js";

async function writeConfig(): Promise<string> {
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
        servers: {},
        defaults: { timeout: 30000, retries: 0, serverLifecycle: "suite" },
      },
      null,
      2
    )
  );
  return configPath;
}

describeIfConfigured("judge smoke", () => {
  it("returns a similarity score", async () => {
    const configPath = await writeConfig();
    const result = await judge("Hello world", "Hello world", { configPath });
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.reasoning.length).toBeGreaterThan(0);
  }, 60000);
});
