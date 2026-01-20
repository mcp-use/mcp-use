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
          resource: {
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

describeIfConfigured("eval runtime resource usage", () => {
  it("captures resource access during a run", async () => {
    // Path relative to evals package
    const serverPath = path.resolve(
      process.cwd(),
      "tests/servers/resource_server.ts"
    );
    const configPath = await writeConfig(serverPath);

    const agent = await createEvalAgent({
      configPath,
      servers: ["resource"],
    });

    const client = (agent as any).client;
    const session = client.requireSession("resource");

    const runPromise = agent.run("Say hello");
    await session.readResource("resource://hello");
    const result = await runPromise;

    expect(result).toHaveUsedResource("hello");

    await agent.cleanup();
  }, 60000);

  it("captures resource access across multiple runs with suite lifecycle", async () => {
    // This test verifies the fix for the closure bug where resource tracking
    // would fail after the first run when serverLifecycle is "suite"
    const serverPath = path.resolve(
      process.cwd(),
      "tests/servers/resource_server.ts"
    );
    const configPath = await writeConfig(serverPath);

    const agent = await createEvalAgent({
      configPath,
      servers: ["resource"],
    });

    const client = (agent as any).client;
    const session = client.requireSession("resource");

    // First run - should capture resource access
    const runPromise1 = agent.run("Say hello first time");
    await session.readResource("resource://hello");
    const result1 = await runPromise1;

    expect(result1).toHaveUsedResource("hello");
    expect(result1.resourceAccess.length).toBe(1);

    // Second run - should ALSO capture resource access (this would fail before the fix)
    const runPromise2 = agent.run("Say hello second time");
    await session.readResource("resource://hello");
    const result2 = await runPromise2;

    expect(result2).toHaveUsedResource("hello");
    expect(result2.resourceAccess.length).toBe(1);

    // Third run to be extra sure
    const runPromise3 = agent.run("Say hello third time");
    await session.readResource("resource://hello");
    const result3 = await runPromise3;

    expect(result3).toHaveUsedResource("hello");
    expect(result3.resourceAccess.length).toBe(1);

    await agent.cleanup();
  }, 60000);
});
