import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runStart } from "../../src/bin/start.js";
import { it as base } from "./fixtures.js";

export const it = base.extend<{
  makeProject: (options?: {
    entrySource?: string;
    manifest?: string;
    empty?: boolean;
  }) => Promise<string>;
  start: typeof runStart;
}>({
  makeProject: async ({ scope }, use) => {
    scope.preserveEnv("NODE_ENV", "PORT", "HOST");
    // main() installs these itself; register restoration before any assertion or startup.
    scope.preserveSignals("SIGINT", "SIGTERM");
    await use(async (options = {}) => {
      const cwd = scope.directory("production-");
      if (options.empty) return cwd;
      await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
      const buildDir = join(cwd, ".mcp-use", "build");
      await mkdir(buildDir, { recursive: true });
      await writeFile(
        join(buildDir, "manifest.json"),
        options.manifest ??
          JSON.stringify({
            buildId: "test",
            entryPoint: "index.js",
            createdAt: new Date().toISOString(),
          })
      );
      if (options.entrySource !== undefined)
        await writeFile(join(buildDir, "index.js"), options.entrySource);
      return cwd;
    });
  },
  start: async ({ scope }, use) => {
    await use(async (options) => {
      const pending = runStart(options);
      // Own startup before awaiting it, including an unexpectedly successful .rejects assertion.
      const close = scope.defer(async () => {
        const started = await pending.catch(() => undefined);
        await started?.close();
      }, `production server in ${options.cwd}`);
      const started = await pending;
      return { ...started, close };
    });
  },
});
