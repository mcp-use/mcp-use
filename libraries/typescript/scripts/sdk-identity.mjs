// Build-time identity of the official MCP SDK that a package inlines.
//
// `mcp-use` (Node entry) and `@mcp-use/cli` compile `@modelcontextprotocol/server`
// and `@modelcontextprotocol/core` into their own bundles, so the SDK version a
// deployed app runs is fixed when the workspace is built, not by the app's
// lockfile. Builds record it here so runtime surfaces (startup log, health
// route, `--version --json`) and the SDK matrix can report the exact SDK in use.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INLINED = ["@modelcontextprotocol/server", "@modelcontextprotocol/core"];

function packageDir(fromDir, name) {
  const require = createRequire(join(resolve(fromDir), "package.json"));
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      );
      if (manifest.name === name) return { dir, version: manifest.version };
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`Cannot locate ${name} from ${fromDir}`);
    dir = parent;
  }
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function buildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Resolve the SDK version a package at `fromDir` inlines, a hash of the
 * inlined SDK sources (it changes when a pnpm patch changes them), and the
 * commit the build came from.
 *
 * @param {string} fromDir Package directory (the one holding package.json).
 * @returns {{ bundled: string, bundledHash: string, buildSha: string }}
 */
export function sdkIdentity(fromDir) {
  const hash = createHash("sha256");
  let bundled = "";
  // Resolve `core` through `server`, since a package may only depend on server.
  let from = fromDir;
  for (const name of INLINED) {
    const { dir, version } = packageDir(from, name);
    from = dir;
    if (name === "@modelcontextprotocol/server") bundled = version;
    const distDir = join(dir, "dist");
    for (const file of listFiles(distDir).sort()) {
      hash.update(`${name}/${relative(distDir, file)}\0`);
      hash.update(readFileSync(file));
    }
  }
  return {
    bundled,
    bundledHash: `sha256-${hash.digest("hex").slice(0, 32)}`,
    buildSha: buildSha(),
  };
}

/**
 * esbuild `define` entries for the identity constants.
 *
 * @param {string} fromDir
 */
export function sdkIdentityDefine(fromDir) {
  const id = sdkIdentity(fromDir);
  return {
    __MCP_USE_BUNDLED_SDK_VERSION__: JSON.stringify(id.bundled),
    __MCP_USE_BUNDLED_SDK_HASH__: JSON.stringify(id.bundledHash),
    __MCP_USE_BUILD_SHA__: JSON.stringify(id.buildSha),
  };
}

// CLI: `node scripts/sdk-identity.mjs <packageDir>` writes <packageDir>/dist/sdk-info.json.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkgDir = resolve(process.argv[2] ?? ".");
  const id = sdkIdentity(pkgDir);
  writeFileSync(
    join(pkgDir, "dist", "sdk-info.json"),
    `${JSON.stringify({ sdk: { bundled: id.bundled, bundledHash: id.bundledHash }, build: { sha: id.buildSha } }, null, 2)}\n`
  );
}
