import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizedEnv } from "../src/proc.js";

describe("sanitizedEnv", () => {
  it("strips pnpm/npm script-context vars but keeps everything else", () => {
    const env = sanitizedEnv({
      ANTHROPIC_API_KEY: "sk-test",
      HOME: "/Users/u",
      npm_config_registry: "https://registry.npmjs.org/",
      npm_lifecycle_event: "eval",
      npm_package_name: "@mcp-use/sdk-evals",
      PNPM_SCRIPT_SRC_DIR: "/repo/evals",
      pnpm_config_verify_deps_before_run: "true",
    });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(env.HOME).toBe("/Users/u");
    expect(
      Object.keys(env).filter((k) => /^(npm_|pnpm_)/i.test(k))
    ).toEqual([]);
  });

  it("pins a plain bash shell and silences zoxide", () => {
    const env = sanitizedEnv({ SHELL: "/bin/zsh" });
    expect(env.SHELL).toBe("/bin/bash");
    expect(env._ZO_DOCTOR).toBe("0");
  });

  it("removes node_modules bin dirs from PATH so the repo can't leak binaries", () => {
    const env = sanitizedEnv({
      PATH: [
        "/repo/libraries/typescript/node_modules/.bin",
        "/repo/libraries/typescript/evals/node_modules/.bin",
        "/usr/local/bin",
        "/usr/bin",
      ].join(delimiter),
    });
    expect(env.PATH).toBe(["/usr/local/bin", "/usr/bin"].join(delimiter));
  });

  it("drops NODE_ENV so trials don't inherit the harness's mode", () => {
    const env = sanitizedEnv({ NODE_ENV: "production", FOO: "bar" });
    expect("NODE_ENV" in env).toBe(false);
    expect(env.FOO).toBe("bar");
  });
});
