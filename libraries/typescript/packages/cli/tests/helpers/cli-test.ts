/**
 * Vitest fixtures for behaviour tests of the `mcp-use` CLI.
 *
 * ```ts
 * import { describe, expect } from "vitest";
 * import { test } from "../helpers/cli-test.js";
 *
 * test("lists deployments", async ({ cloud, cli }) => {
 *   cloud.on("GET", "/api/v1/deployments", { body: { items: [] } });
 *   const result = await cli.run(["deployments", "list", "--json"], {
 *     env: { MCP_USE_API_KEY: "test_key" },
 *   });
 *   expect(result.exitCode).toBe(0);
 * });
 * ```
 *
 * Each test gets its own fake Cloud and its own sandbox directories. Both are
 * created only when the test asks for them and are torn down after it, so
 * nothing leaks between tests. A request the test did not register a route
 * for fails the test during teardown.
 */
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test as base } from "vitest";

import { startFakeCloud, type FakeCloud } from "./fake-cloud.js";
import {
  runCli,
  type CliResult,
  type CliSandbox,
  type RunOptions,
} from "./run-cli.js";

/** A sandboxed CLI wired to the test's fake Cloud. */
export interface Cli extends CliSandbox {
  /**
   * Run `mcp-use ...args`. `MCP_USE_CLOUD_API_URL` points at the fake Cloud;
   * `options.env` can add to or override it.
   */
  run(args: readonly string[], options?: RunOptions): Promise<CliResult>;
}

export const test = base.extend<{ cloud: FakeCloud; cli: Cli }>({
  // Vitest requires a destructuring pattern here; `task` is unused.
  cloud: async ({ task: _task }, use) => {
    const cloud = await startFakeCloud();
    try {
      await use(cloud);
    } finally {
      await cloud.close();
    }
    expect(
      cloud.unhandled.map((request) => `${request.method} ${request.path}`),
      "fake Cloud received requests with no registered route"
    ).toEqual([]);
  },

  cli: async ({ cloud }, use) => {
    // realpath: on macOS the temp dir is a symlink, and the child process
    // reports the resolved path.
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mcp-use-cli-test-"))
    );
    const sandbox: CliSandbox = {
      home: join(root, "home"),
      configHome: join(root, "home", ".config"),
      cwd: join(root, "work"),
    };
    await mkdir(sandbox.configHome, { recursive: true });
    await mkdir(sandbox.cwd, { recursive: true });
    try {
      await use({
        ...sandbox,
        run: (args, options = {}) =>
          runCli(args, sandbox, {
            ...options,
            env: { MCP_USE_CLOUD_API_URL: cloud.apiUrl, ...options.env },
          }),
      });
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
});
