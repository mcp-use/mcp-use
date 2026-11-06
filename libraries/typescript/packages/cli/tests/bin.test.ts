/**
 * `mcp-use start` and `mcp-use build` through the built bin: argv, env and
 * files in, exit code and output out.
 *
 * The `start` entries below return from `listen()` without binding a port, so
 * the CLI prints its startup line and exits on its own.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { test } from "./helpers/cli-test.js";

/** Write a `.mcp-use/build/` workspace into `dir`. */
async function writeBuild(
  dir: string,
  options: { entrySource?: string; manifest?: string }
): Promise<void> {
  const buildDir = join(dir, ".mcp-use", "build");
  await mkdir(buildDir, { recursive: true });
  await writeFile(
    join(buildDir, "manifest.json"),
    options.manifest ??
      JSON.stringify({ buildId: "test", entryPoint: "index.js" })
  );
  if (options.entrySource !== undefined) {
    await writeFile(join(buildDir, "index.js"), options.entrySource);
  }
}

/** Reports the address it was given, plus NODE_ENV, without binding. */
const ADDRESS_ENTRY = `
export default {
  host: "configured-host",
  port: 4321,
  async listen(port = 3000, options) {
    return { port, url: \`http://\${options?.host}:\${port}/mcp?env=\${process.env.NODE_ENV}\` };
  },
  async close() {},
};
`;

/** Registers a global middleware, as MCPServer does for Inspector. */
const INSPECTOR_ENTRY = `
export default {
  basePath: "/api/mcp",
  app: { use() {} },
  async listen(port = 3000) {
    return { port, url: \`http://localhost:\${port}/api/mcp\` };
  },
  async close() {},
};
`;

describe("mcp-use start", () => {
  test.for([
    ["no build", undefined, undefined, /no production build.*mcp-use build/is],
    [
      "a manifest without entryPoint",
      '{ "buildId": "x" }',
      undefined,
      /invalid build manifest/i,
    ],
    [
      "an entry without a default export",
      undefined,
      "export const x = 1;",
      /no default export/,
    ],
    [
      "a default export without listen()",
      undefined,
      "export default { notAServer: true };",
      /listen/,
    ],
  ] as const)(
    "exits 1 with an actionable error for %s",
    async ([label, manifest, entrySource, message], { cli }) => {
      if (label !== "no build") {
        await writeBuild(cli.cwd, {
          ...(manifest !== undefined && { manifest }),
          ...(entrySource !== undefined && { entrySource }),
        });
      }

      const result = await cli.run(["start", "--path", cli.cwd]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(message);
    }
  );

  test("prefers flags over PORT/HOST env over server config", async ({
    cli,
  }) => {
    await writeBuild(cli.cwd, { entrySource: ADDRESS_ENTRY });
    const env = { PORT: "4123", HOST: "env-host" };

    const flags = await cli.run(
      ["start", "--path", cli.cwd, "--port", "5001", "--host", "flag-host"],
      { env }
    );
    const fromEnv = await cli.run(["start", "--path", cli.cwd], { env });
    const fromConfig = await cli.run(["start", "--path", cli.cwd]);

    expect(flags.stdout).toBe(
      "mcp-use server running at http://flag-host:5001/mcp?env=production\n"
    );
    expect(fromEnv.stdout).toBe(
      "mcp-use server running at http://env-host:4123/mcp?env=production\n"
    );
    expect(fromConfig.stdout).toBe(
      "mcp-use server running at http://configured-host:4321/mcp?env=production\n"
    );
  });

  test("sets NODE_ENV=production only when it is unset", async ({ cli }) => {
    await writeBuild(cli.cwd, { entrySource: ADDRESS_ENTRY });

    const unset = await cli.run(["start", "--path", cli.cwd]);
    const staging = await cli.run(["start", "--path", cli.cwd], {
      env: { NODE_ENV: "staging" },
    });

    expect(unset.stdout).toContain("/mcp?env=production\n");
    expect(staging.stdout).toContain("/mcp?env=staging\n");
  });

  test("prints only the server URL when Inspector is not requested", async ({
    cli,
  }) => {
    await writeBuild(cli.cwd, { entrySource: INSPECTOR_ENTRY });

    const result = await cli.run([
      "start",
      "--path",
      cli.cwd,
      "--port",
      "4567",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "mcp-use server running at http://localhost:4567/api/mcp\n"
    );
  });

  test("prints the Inspector URL under the server base path with --with-inspector", async ({
    cli,
  }) => {
    await writeBuild(cli.cwd, { entrySource: INSPECTOR_ENTRY });

    const result = await cli.run([
      "start",
      "--path",
      cli.cwd,
      "--port",
      "4567",
      "--with-inspector",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "mcp-use inspector at http://localhost:4567/api/mcp/inspector\n"
    );
  });
});

describe("mcp-use start env files", () => {
  /** Reports two env values in its URL, without binding. */
  const ENV_ENTRY = `
export default {
  async listen(port = 3000) {
    return { port, url: \`http://localhost:\${port}/mcp?file=\${process.env.MCP_USE_ENV_PRIORITY}&shell=\${process.env.MCP_USE_SHELL_PRIORITY}\` };
  },
  async close() {},
};
`;

  async function writeEnvProject(dir: string, next: boolean): Promise<void> {
    await writeBuild(dir, { entrySource: ENV_ENTRY });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(next ? { dependencies: { next: "16.0.0" } } : {})
    );
    await writeFile(join(dir, ".env"), "MCP_USE_ENV_PRIORITY=base\n");
    await writeFile(
      join(dir, ".env.production"),
      "MCP_USE_ENV_PRIORITY=production\n"
    );
    await writeFile(
      join(dir, ".env.local"),
      "MCP_USE_ENV_PRIORITY=local\nMCP_USE_SHELL_PRIORITY=file\n"
    );
    await writeFile(
      join(dir, ".env.production.local"),
      "MCP_USE_ENV_PRIORITY=production-local\n"
    );
  }

  test("a Next project loads .env.production.local first and never overrides the shell", async ({
    cli,
  }) => {
    await writeEnvProject(cli.cwd, true);

    const result = await cli.run(
      ["start", "--path", cli.cwd, "--port", "4567"],
      { env: { MCP_USE_SHELL_PRIORITY: "shell" } }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "mcp-use server running at http://localhost:4567/mcp?file=production-local&shell=shell\n"
    );
  });

  test("a project without Next loads only .env", async ({ cli }) => {
    await writeEnvProject(cli.cwd, false);

    const result = await cli.run([
      "start",
      "--path",
      cli.cwd,
      "--port",
      "4567",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "mcp-use server running at http://localhost:4567/mcp?file=base&shell=undefined\n"
    );
  });
});

describe("mcp-use build", () => {
  test("exits 1 when --entry does not exist", async ({ cli }) => {
    const result = await cli.run(["build", "--entry", "nope.ts"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Entry not found/);
  });

  test("prints the inner errors of an entry's empty AggregateError", async ({
    cli,
  }) => {
    // Node's connection-refused error, as a Redis client throws it when the
    // entry connects at module scope and the database is unreachable.
    await writeFile(
      join(cli.cwd, "index.ts"),
      'throw new AggregateError([new Error("connect ECONNREFUSED ::1:6390"), new Error("connect ECONNREFUSED 127.0.0.1:6390")], "");\n'
    );

    const result = await cli.run([
      "build",
      "--path",
      cli.cwd,
      "--entry",
      "index.ts",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "connect ECONNREFUSED ::1:6390; connect ECONNREFUSED 127.0.0.1:6390"
    );
  });
});
