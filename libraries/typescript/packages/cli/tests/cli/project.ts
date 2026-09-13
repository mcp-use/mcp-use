import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { getFreePort } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const localRequire = createRequire(join(here, "../../package.json"));
const serverRoot = join(here, "../../../server");

/** An empty project needs no dependencies; runnable fixtures use the checkout. */
export type FixtureKind = "basic" | "views" | "empty";
type Cleanup = () => void | Promise<void>;

/** A running local CLI server, automatically stopped by its project fixture. */
export interface DevHandle {
  url: string;
  logs: readonly string[];
  stop: () => Promise<void>;
}

/** Owns all projects and resources acquired by one test, including partial setup. */
export class TestProjects {
  private readonly directories: string[] = [];
  private readonly cleanups: Cleanup[] = [];
  private disposal: Promise<void> | undefined;
  private readonly environment = {
    MCP_URL: process.env.MCP_URL,
    PORT: process.env.PORT,
  };

  constructor(private readonly root: string) {}

  /** Create an independent mutable project backed by explicitly linked local packages. */
  create(kind: FixtureKind = "basic"): TestProject {
    const cwd = mkdtempSync(join(this.root, `${kind}-`));
    this.directories.push(cwd);
    if (kind !== "empty") {
      cpSync(join(here, "fixtures", kind), cwd, { recursive: true });
      const manifest = JSON.parse(
        readFileSync(join(cwd, "package.json"), "utf8")
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        const target =
          name === "mcp-use"
            ? serverRoot
            : dirname(localRequire.resolve(`${name}/package.json`));
        const destination = join(cwd, "node_modules", name);
        mkdirSync(dirname(destination), { recursive: true });
        symlinkSync(target, destination, "junction");
      }
    }
    return new TestProject(cwd, this);
  }

  /** Register a resource immediately after acquiring it. Resources close in reverse order. */
  defer(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  /** Stop all resources before deleting any project; report every cleanup failure. */
  dispose(): Promise<void> {
    return (this.disposal ??= this.disposeAll());
  }

  private async disposeAll(): Promise<void> {
    const errors: unknown[] = [];
    while (this.cleanups.length) {
      try {
        await this.cleanups.pop()!();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const [name, value] of Object.entries(this.environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (process.env.KEEP_TEST_PROJECTS !== "1") {
      for (const cwd of this.directories) {
        try {
          await rm(cwd, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
        } catch (error) {
          errors.push(
            new Error(`Could not remove CLI test project: ${cwd}`, {
              cause: error,
            })
          );
        }
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "CLI test cleanup failed");
  }
}

/** A test's project directory and the resources running against it. */
export class TestProject {
  constructor(
    readonly cwd: string,
    private readonly owner: TestProjects
  ) {}

  /** Write a project file, creating its parent directories as needed. */
  writeFile(path: string, contents: string): void {
    const file = join(this.cwd, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  /** Track an additional test-owned client, listener or mock. */
  defer(cleanup: Cleanup): void {
    this.owner.defer(cleanup);
  }

  /** Start the CLI source under test; even failed startup is owned and awaited. */
  async startDev(
    options: { port?: number; host?: string; inspector?: boolean } = {}
  ): Promise<DevHandle> {
    const { runDev } = await import("../../src/cli/index.js");
    const port = options.port ?? (await getFreePort());
    const lines: string[] = [];
    const record = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(record);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(record);
    const controller = new AbortController();
    let done: Promise<void> = Promise.resolve();
    let stopped: Promise<void> | undefined;
    let startupFailed = false;
    const stop = (): Promise<void> =>
      (stopped ??= (async () => {
        controller.abort();
        try {
          await done;
        } finally {
          logSpy.mockRestore();
          warnSpy.mockRestore();
        }
      })());
    this.defer(async () => {
      if (!startupFailed) await stop();
    });

    try {
      done = runDev({
        ...options,
        port,
        cwd: this.cwd,
        signal: controller.signal,
      });
      let completed = false;
      let startupError: unknown;
      void done.then(
        () => {
          completed = true;
        },
        (error: unknown) => {
          completed = true;
          startupError = error;
        }
      );
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (completed)
          throw startupError ?? new Error("CLI server exited before readiness");
        const endpoint = lines.find((line) => line.includes("MCP endpoint"));
        if (endpoint) {
          const url = /(https?:\/\/\S+)/.exec(endpoint)?.[1];
          if (!url) throw new Error(`No URL in: ${endpoint}`);
          return { url, logs: lines, stop };
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        `CLI server startup timed out in ${this.cwd}\n${lines.join("\n")}`
      );
    } catch (error) {
      startupFailed = true;
      await stop().catch(() => {}); // The original startup error is reported below.
      throw error;
    }
  }
}
