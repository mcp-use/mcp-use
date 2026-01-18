import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvalConfigError } from "../../../src/shared/errors.js";
import {
  clearEvalConfigCache,
  loadEvalConfig,
} from "../../../src/runtime/loadEvalConfig.js";

async function withTempFile(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evals-config-"));
  const filePath = path.join(dir, "eval.config.json");
  await fs.writeFile(filePath, contents, "utf-8");
  return filePath;
}

describe("loadEvalConfig", () => {
  it("loads a valid config and caches by path", async () => {
    clearEvalConfigCache();
    const filePath = await withTempFile(
      JSON.stringify({
        default: { runAgent: "run", judgeAgent: "judge" },
        agents: { run: { provider: "openai", model: "gpt-4o-mini" } },
        servers: { weather: { type: "stdio", command: "node", args: [] } },
        defaults: { timeout: 1000, retries: 1, serverLifecycle: "suite" },
      })
    );

    const config1 = await loadEvalConfig(filePath);
    const config2 = await loadEvalConfig(filePath);

    expect(config1).toEqual(config2);
  });

  it("throws on invalid JSON", async () => {
    clearEvalConfigCache();
    const filePath = await withTempFile("{ invalid");

    await expect(loadEvalConfig(filePath)).rejects.toBeInstanceOf(
      EvalConfigError
    );
  });

  it("throws on schema validation errors", async () => {
    clearEvalConfigCache();
    const filePath = await withTempFile(JSON.stringify({}));

    await expect(loadEvalConfig(filePath)).rejects.toBeInstanceOf(
      EvalConfigError
    );
  });
});
