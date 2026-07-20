import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildStdioEnv } from "../../../src/connectors/stdio.js";

const SECRET_KEY = "MCP_USE_STDIO_ENV_LEAK_PROBE";

describe("buildStdioEnv", () => {
  beforeEach(() => {
    process.env[SECRET_KEY] = "super-secret";
  });

  afterEach(() => {
    delete process.env[SECRET_KEY];
  });

  it("returns undefined when no env is configured", () => {
    expect(buildStdioEnv(undefined)).toBeUndefined();
  });

  it("does not leak arbitrary parent process env into the child", () => {
    const result = buildStdioEnv({ MY_SERVER_VAR: "1" });

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty(SECRET_KEY);
  });

  it("keeps the caller-provided variables", () => {
    const result = buildStdioEnv({ MY_SERVER_VAR: "1" });

    expect(result?.MY_SERVER_VAR).toBe("1");
  });

  it("uses the SDK default safe environment as the base", () => {
    const result = buildStdioEnv({ MY_SERVER_VAR: "1" });

    for (const key of Object.keys(getDefaultEnvironment())) {
      expect(result).toHaveProperty(key);
    }
  });
});
