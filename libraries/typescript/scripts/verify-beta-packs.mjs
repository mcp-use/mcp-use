import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
const packedPackages = new Map();

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

function containsRequireCondition(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsRequireCondition);
  return Object.entries(value).some(
    ([condition, target]) =>
      condition === "require" || containsRequireCondition(target)
  );
}

function verifyAgentPackageFormat() {
  const agent = packedPackages.get("@mcp-use/agent");
  const client = packedPackages.get("@mcp-use/client");
  if (!agent || !client)
    throw new Error("agent package-format verification requires both tarballs");

  if (Object.hasOwn(agent.manifest, "main"))
    throw new Error("@mcp-use/agent must not publish a CommonJS main field");
  if (containsRequireCondition(agent.manifest.exports))
    throw new Error(
      "@mcp-use/agent must not publish require export conditions"
    );

  const cjsArtifacts = [...agent.files].filter((file) =>
    /\.cjs(?:\.map)?$/.test(file)
  );
  if (cjsArtifacts.length > 0)
    throw new Error(
      `@mcp-use/agent published CommonJS artifacts: ${cjsArtifacts.join(", ")}`
    );

  for (const subpath of [".", "./browser", "./langchain"]) {
    const target = agent.manifest.exports?.[subpath]?.import;
    if (typeof target !== "string" || !target.endsWith(".js"))
      throw new Error(
        `@mcp-use/agent ${subpath} must advertise an ESM .js import target`
      );
    if (!agent.files.has(target.replace(/^\.\//, "")))
      throw new Error(
        `@mcp-use/agent ${subpath} import target ${target} is missing from its tarball`
      );
  }

  const consumer = join(directory, "agent-esm-consumer");
  const consumerModules = join(consumer, "node_modules");
  mkdirSync(consumerModules, { recursive: true });

  for (const packageData of [agent, client]) {
    const destination = join(
      consumerModules,
      ...packageData.manifest.name.split("/")
    );
    mkdirSync(destination, { recursive: true });
    run("tar", [
      "-xzf",
      packageData.packed.filename,
      "-C",
      destination,
      "--strip-components=1",
    ]);
  }

  // Resolve external runtime and peer dependencies from the workspace install.
  // Their own dependency links remain intact, while the package under test is
  // always the content extracted from the publish tarball above.
  const dependencySources = new Map([
    ["@langchain/core", "agent"],
    ["@modelcontextprotocol/client", "client"],
    ["@modelcontextprotocol/ext-apps", "client"],
    ["langchain", "agent"],
    ["zod", "agent"],
  ]);
  for (const [dependency, workspacePackage] of dependencySources) {
    const source = join(
      root,
      "packages",
      workspacePackage,
      "node_modules",
      ...dependency.split("/")
    );
    if (!existsSync(source))
      throw new Error(
        `workspace install is missing consumer dependency ${dependency}`
      );
    const target = join(consumerModules, ...dependency.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, "junction");
  }

  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const root = await import("@mcp-use/agent");
       const browser = await import("@mcp-use/agent/browser");
       const langchain = await import("@mcp-use/agent/langchain");
       if (typeof root.MCPAgent !== "function") throw new Error("missing root MCPAgent export");
       if (typeof browser.MCPAgent !== "function") throw new Error("missing browser MCPAgent export");
       if (typeof langchain.LangChainMCPAgent !== "function") throw new Error("missing LangChainMCPAgent export");`,
    ],
    { cwd: consumer }
  );

  const required = spawnSync(
    process.execPath,
    ["--eval", 'require("@mcp-use/agent")'],
    { cwd: consumer, encoding: "utf8" }
  );
  if (required.error) throw required.error;
  if (required.status === 0)
    throw new Error("@mcp-use/agent unexpectedly supports direct require()");
  if (
    !`${required.stdout}${required.stderr}`.includes(
      "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
  )
    throw new Error(
      `@mcp-use/agent require() failed for an unexpected reason:\n${required.stdout}${required.stderr}`
    );

  console.log("verified @mcp-use/agent ESM-only consumer behavior");
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
    packedPackages.set(name, { files, manifest, packed });
    console.log(
      `verified ${manifest.name}@${manifest.version} (${files.size} files)`
    );
  }
  verifyAgentPackageFormat();
} finally {
  rmSync(directory, { recursive: true, force: true });
}
