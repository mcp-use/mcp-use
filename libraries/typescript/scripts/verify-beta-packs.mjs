import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
    if (name === "@mcp-use/inspector") {
      verifyInspectorPack(packed, manifest, files);
    } else if (name === "@mcp-use/cli") {
      verifyCliPack(packed, manifest, files);
    } else if (name === "mcp-use") {
      verifyFrameworkPack(packed, manifest, files);
    }
    console.log(
      `verified ${manifest.name}@${manifest.version} (${files.size} files)`
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function verifyInspectorPack(packed, manifest, files) {
  const { packedBytes, unpackedBytes } = packMetrics(packed, "inspector");

  if (Object.keys(manifest.dependencies ?? {}).length !== 0)
    throw new Error("@mcp-use/inspector must have zero regular dependencies");
  if (packedBytes > 1_100_000)
    throw new Error(`Inspector packed budget exceeded: ${packedBytes} bytes`);
  if (unpackedBytes > 1_600_000)
    throw new Error(
      `Inspector unpacked budget exceeded: ${unpackedBytes} bytes`
    );
  if (files.size > 40)
    throw new Error(`Inspector file budget exceeded: ${files.size} files`);
}

function verifyCliPack(packed, manifest, files) {
  const { packedBytes, unpackedBytes } = packMetrics(packed, "cli");
  if (manifest.dependencies?.["mcp-use"] !== undefined)
    throw new Error("@mcp-use/cli must not depend back on mcp-use");
  for (const dependency of ["@mcp-use/client", "@mcp-use/inspector"]) {
    if (manifest.dependencies?.[dependency] !== undefined)
      throw new Error(`@mcp-use/cli must keep ${dependency} as a peer`);
    if (manifest.peerDependencies?.[dependency] === undefined)
      throw new Error(`@mcp-use/cli is missing peer ${dependency}`);
    if (manifest.peerDependenciesMeta?.[dependency]?.optional !== true)
      throw new Error(`@mcp-use/cli peer ${dependency} must be optional`);
  }
  if (packedBytes > 100_000)
    throw new Error(`CLI packed budget exceeded: ${packedBytes} bytes`);
  if (unpackedBytes > 250_000)
    throw new Error(`CLI unpacked budget exceeded: ${unpackedBytes} bytes`);
  if (files.size > 40)
    throw new Error(`CLI file budget exceeded: ${files.size} files`);
}

function verifyFrameworkPack(packed, manifest, files) {
  const { packedBytes, unpackedBytes } = packMetrics(packed, "framework");
  if ((manifest.bundledDependencies ?? []).length !== 0)
    throw new Error("mcp-use must not publish bundledDependencies");
  for (const dependency of ["@mcp-use/cli", "@mcp-use/inspector"]) {
    if (manifest.dependencies?.[dependency] === undefined)
      throw new Error(`mcp-use must depend on ${dependency}`);
  }
  if (packedBytes > 250_000)
    throw new Error(`mcp-use packed budget exceeded: ${packedBytes} bytes`);
  if (unpackedBytes > 1_000_000)
    throw new Error(`mcp-use unpacked budget exceeded: ${unpackedBytes} bytes`);
  if (files.size > 150)
    throw new Error(`mcp-use file budget exceeded: ${files.size} files`);
  if ([...files].some((file) => file.endsWith(".tsbuildinfo")))
    throw new Error("mcp-use must not publish TypeScript build metadata");
}

function packMetrics(packed, label) {
  const packedBytes = statSync(packed.filename).size;
  const unpackDirectory = join(directory, `${label}-unpacked`);
  mkdirSync(unpackDirectory);
  run("tar", ["-xzf", packed.filename, "-C", unpackDirectory]);
  return {
    packedBytes,
    unpackedBytes: directorySize(join(unpackDirectory, "package")),
  };
}

function directorySize(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return (
      total +
      (entry.isDirectory() ? directorySize(child) : statSync(child).size)
    );
  }, 0);
}
