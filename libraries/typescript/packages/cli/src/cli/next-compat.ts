/** Standalone compatibility for MCP source hosted by a Next.js project. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const NEXT_SERVER_MODULES = new Set([
  "server-only",
  "client-only",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
]);

/** Exact aliases for Vite configurations that are known to be SSR-only. */
export function nextStandaloneAliases(projectRoot: string) {
  const shim = fileURLToPath(
    new URL("./next-server-shims.js", import.meta.url)
  );
  return isNextProject(projectRoot)
    ? [...NEXT_SERVER_MODULES].map((find) => ({
        find,
        replacement: shim,
      }))
    : [];
}

/** Bare modules that must reach the SSR shim instead of Node externalization. */
export function nextStandaloneSsrOptions(projectRoot: string) {
  return isNextProject(projectRoot)
    ? { noExternal: [...NEXT_SERVER_MODULES] }
    : { external: true as const };
}

/** Whether `projectRoot` declares `next` in package dependencies. */
export function isNextProject(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return (
      pkg.dependencies?.["next"] !== undefined ||
      pkg.devDependencies?.["next"] !== undefined
    );
  } catch {
    return false;
  }
}

/** Load the same environment-file priority used by a Next host project. */
export function loadProjectEnv(
  projectRoot: string,
  mode: "development" | "production"
): void {
  const files = isNextProject(projectRoot)
    ? [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]
    : [".env"];
  for (const filename of files) {
    const path = join(projectRoot, filename);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

/** Shim request-bound Next modules only in Vite's standalone SSR runtime. */
export function nextStandaloneCompatPlugin(projectRoot: string): Plugin {
  const enabled = isNextProject(projectRoot);
  const shim = fileURLToPath(
    new URL("./next-server-shims.js", import.meta.url)
  );
  return {
    name: "mcp-use-next-standalone-compat",
    enforce: "pre",
    resolveId(source, _importer, options) {
      // `options.ssr` remains authoritative across Vite's build and module
      // runner environments; view/client resolution must stay strict.
      return enabled && options.ssr && NEXT_SERVER_MODULES.has(source)
        ? { id: shim, external: false }
        : undefined;
    },
  };
}
