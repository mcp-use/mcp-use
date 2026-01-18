import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createEvalAgent } from "../../src/index.js";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";

describe("additionalInstructions config", () => {
  const testConfigPath = join(
    process.cwd(),
    "test-config-additional-instructions.json"
  );

  const testConfig = {
    default: {
      runAgent: "test-gpt",
      judgeAgent: "test-gpt",
    },
    agents: {
      "test-gpt": {
        provider: "openai",
        model: "gpt-4o-mini",
      },
    },
    servers: {},
    defaults: {
      timeout: 30000,
      retries: 0,
      serverLifecycle: "suite" as const,
      additionalInstructions:
        "TEST_INSTRUCTIONS: Only respond with 'OK' to any query.",
    },
  };

  beforeAll(async () => {
    await writeFile(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterAll(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should load config with additionalInstructions", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: OPENAI_API_KEY not set");
      return;
    }

    const agent = await createEvalAgent({
      configPath: testConfigPath,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");

    // Test that additionalInstructions affect behavior
    const result = await agent.run("What is the weather today?");

    // The test instructions force the agent to respond with only "OK"
    // So we verify that the output is very short and contains "OK"
    expect(result.output).toBeDefined();
    expect(result.output.toLowerCase()).toContain("ok");
    expect(result.output.length).toBeLessThan(50); // Should be very short

    // Cleanup
    await agent.cleanup();
  });

  it("should work without additionalInstructions", async () => {
    const configWithoutInstructions = {
      ...testConfig,
      defaults: {
        timeout: 30000,
        retries: 0,
        serverLifecycle: "suite" as const,
      },
    };

    const configPath = join(process.cwd(), "test-config-no-instructions.json");
    await writeFile(
      configPath,
      JSON.stringify(configWithoutInstructions, null, 2)
    );

    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: OPENAI_API_KEY not set");
      await unlink(configPath);
      return;
    }

    const agent = await createEvalAgent({
      configPath,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");

    // Cleanup
    await agent.cleanup();
    await unlink(configPath);
  });
});
