import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const packages = [
  "@mcp-use/client",
  "@mcp-use/agent",
  "mcp-use",
  "@mcp-use/cli",
  "@mcp-use/inspector",
  "create-mcp-use-app",
];
const directory = mkdtempSync(join(tmpdir(), "mcp-use-beta-packs-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

try {
  for (const name of packages) {
    const packed = JSON.parse(
      run("pnpm", [
        "--config.node-linker=hoisted",
        "--filter",
        name,
        "pack",
        "--pack-destination",
        directory,
        "--json",
      ])
    );
    const manifest = JSON.parse(
      run("tar", ["-xOf", packed.filename, "package/package.json"])
    );
    if (manifest.name !== name || manifest.version !== packed.version) {
      throw new Error(
        `packed identity mismatch for ${name}: ${manifest.name}@${manifest.version}`
      );
    }
    for (const [dependency, range] of Object.entries(
      manifest.dependencies ?? {}
    )) {
      if (range.startsWith("workspace:"))
        throw new Error(
          `${name} packed an unresolved workspace dependency ${dependency}@${range}`
        );
    }
    const files = new Set(packed.files.map(({ path }) => path));
    for (const dependency of manifest.bundledDependencies ?? []) {
      const prefix = `node_modules/${dependency}/`;
      if (![...files].some((file) => file.startsWith(prefix)))
        throw new Error(
          `${name} is missing bundled dependency ${dependency} from its tarball`
        );
    }
    for (const bin of Object.values(manifest.bin ?? {})) {
      const target = bin.replace(/^\.\//, "");
      if (!files.has(target))
        throw new Error(
          `${name} bin target ${target} is missing from its tarball`
        );
    }
    if (!files.has("package.json") || files.size < 2)
      throw new Error(`${name} produced an empty package tarball`);
    console.log(
      `verified ${manifest.name}@${manifest.version} (${files.size} files)`
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
