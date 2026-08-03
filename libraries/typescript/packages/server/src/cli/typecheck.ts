/** `mcp-use typecheck`: refresh MCP view types, then run local TypeScript. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { discoverEntry } from "./entry.js";
import { syncMcpEnvDeclaration } from "./mcp-env-declaration.js";

/** Options for {@link runTypecheck}. */
export interface TypecheckOptions {
  /** Project root containing `package.json` and `tsconfig.json`. */
  cwd: string;
  /** Server entry override, resolved from the project root. */
  entry?: string;
  /** MCP source directory, resolved from the project root. */
  mcpDir?: string;
  /** Additional arguments forwarded to the project-local `tsc`. */
  tscArgs?: readonly string[];
}

/**
 * Refresh the MCP environment declaration and run the project's own
 * TypeScript compiler with emission disabled.
 *
 * @returns The exit code returned by TypeScript.
 * @throws If the entry cannot be found, TypeScript is not installed in the
 * project, or the compiler process cannot be started.
 */
export async function runTypecheck(options: TypecheckOptions): Promise<number> {
  const sourceRoot =
    options.mcpDir === undefined
      ? options.cwd
      : resolve(options.cwd, options.mcpDir);
  const entry =
    options.entry === undefined
      ? discoverEntry(sourceRoot)
      : discoverEntry(options.cwd, options.entry);
  const declarationStatus = await syncMcpEnvDeclaration(options.cwd, entry);
  if (declarationStatus === "created" || declarationStatus === "updated") {
    console.log(`[mcp-use] ${declarationStatus} mcp-env.d.ts`);
  } else if (declarationStatus === "user-owned") {
    console.warn("[mcp-use] mcp-env.d.ts is user-owned; leaving it unchanged");
  }

  const compiler = resolveProjectTypeScript(options.cwd);
  return runCompiler(compiler, options.cwd, options.tscArgs ?? []);
}

/** Resolve the `tsc` binary from the selected project's TypeScript package. */
function resolveProjectTypeScript(cwd: string): string {
  const projectRequire = createRequire(join(cwd, "package.json"));
  try {
    const manifest = projectRequire.resolve("typescript/package.json");
    return join(dirname(manifest), "bin", "tsc");
  } catch {
    throw new Error(
      `TypeScript is not installed in ${cwd}. Install it with npm install --save-dev typescript.`
    );
  }
}

/** Spawn TypeScript under the current Node executable and preserve its code. */
function runCompiler(
  compiler: string,
  cwd: string,
  args: readonly string[]
): Promise<number> {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(process.execPath, [compiler, ...args, "--noEmit"], {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolveExitCode(code ?? (signal === "SIGINT" ? 130 : 1));
    });
  });
}
