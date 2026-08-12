import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspaceRoot = process.cwd();
const packageRoot = join(workspaceRoot, "packages", "server");
const loader = join(packageRoot, "tests", "budgets", "module-trace-loader.mjs");
const scratch = mkdtempSync(join(tmpdir(), "mcp-use-release-install-"));
const suppliedArtifactDirectory = process.env.MCP_USE_PACKED_ARTIFACT_DIR;
const artifactDirectory = suppliedArtifactDirectory
  ? resolve(suppliedArtifactDirectory)
  : join(scratch, "artifacts");
const installDirectory = join(scratch, "install");
const cliInstallDirectory = join(scratch, "cli-install");
const tunnelInstallDirectory = join(scratch, "tunnel-install");
const allowedExtraneous = new Set([
  "@emnapi/core",
  "@emnapi/runtime",
  "@emnapi/wasi-threads",
  "@napi-rs/wasm-runtime",
  "@tybys/wasm-util",
  "tslib",
]);

try {
  if (!suppliedArtifactDirectory) mkdirSync(artifactDirectory);
  mkdirSync(installDirectory);
  mkdirSync(cliInstallDirectory);
  mkdirSync(tunnelInstallDirectory);
  const tarballs = new Map();
  for (const name of [
    "@mcp-use/client",
    "@mcp-use/cli",
    "@mcp-use/inspector",
    "@mcp-use/tunnel",
    "mcp-use",
  ]) {
    if (suppliedArtifactDirectory) {
      tarballs.set(name, findPackedArtifact(name));
    } else {
      const packed = JSON.parse(
        run(
          "pnpm",
          [
            "--config.node-linker=hoisted",
            "--filter",
            name,
            "pack",
            "--pack-destination",
            artifactDirectory,
            "--json",
          ],
          workspaceRoot
        )
      );
      tarballs.set(name, packed.filename);
    }
  }

  writeFileSync(
    join(installDirectory, "package.json"),
    `${JSON.stringify({ name: "release-install", private: true, type: "module" }, null, 2)}\n`
  );
  const install = runResult(
    "npm",
    [
      "install",
      "--omit=dev",
      ...[
        "@mcp-use/client",
        "@mcp-use/cli",
        "@mcp-use/inspector",
        "mcp-use",
      ].map((name) => tarballs.get(name)),
    ],
    installDirectory
  );
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const installOutput = `${install.stdout}\n${install.stderr}`;
  assert.equal(
    /pkg\.pr\.new/i.test(installOutput) && /invalid/i.test(installOutput),
    false,
    installOutput
  );

  const frameworkManifest = readJson(
    join(installDirectory, "node_modules", "mcp-use", "package.json")
  );
  writeFileSync(
    join(cliInstallDirectory, "package.json"),
    `${JSON.stringify({ name: "cli-release-install", private: true, type: "module" }, null, 2)}\n`
  );
  run(
    "npm",
    ["install", "--omit=dev", tarballs.get("@mcp-use/cli")],
    cliInstallDirectory
  );
  writeFileSync(
    join(tunnelInstallDirectory, "package.json"),
    `${JSON.stringify({ name: "tunnel-release-install", private: true, type: "module" }, null, 2)}\n`
  );
  run(
    "npm",
    ["install", "--omit=dev", tarballs.get("@mcp-use/tunnel")],
    tunnelInstallDirectory
  );
  const cliManifest = readJson(
    join(cliInstallDirectory, "node_modules", "@mcp-use", "cli", "package.json")
  );
  const tunnelManifest = readJson(
    join(
      tunnelInstallDirectory,
      "node_modules",
      "@mcp-use",
      "tunnel",
      "package.json"
    )
  );
  assert.equal(frameworkManifest.dependencies?.["@mcp-use/tunnel"], undefined);
  assert.equal(cliManifest.dependencies?.["@mcp-use/tunnel"], undefined);
  assert.notEqual(frameworkManifest.version, cliManifest.version);
  const frameworkBin = join(
    installDirectory,
    "node_modules",
    "mcp-use",
    "dist",
    "bin.js"
  );
  const installedFrameworkBin = installedBin(installDirectory, "mcp-use");
  const installedCliBin = installedBin(cliInstallDirectory, "mcp-use");
  assert.equal(
    runInstalledBin(
      installedFrameworkBin,
      ["--version"],
      installDirectory
    ).trim(),
    frameworkManifest.version
  );
  assert.equal(
    runInstalledBin(installedCliBin, ["--version"], cliInstallDirectory).trim(),
    cliManifest.version
  );
  assert.match(
    runInstalledBin(
      installedBin(tunnelInstallDirectory, "mcp-tunnel"),
      ["--help"],
      tunnelInstallDirectory
    ),
    /Usage: mcp-tunnel/
  );
  assert.equal(
    run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const tunnel = await import("@mcp-use/tunnel"); console.log(typeof tunnel.createTunnelManager)',
      ],
      tunnelInstallDirectory
    ).trim(),
    "function"
  );

  for (const directory of [installDirectory, cliInstallDirectory]) {
    assert.equal(
      existsSync(join(directory, "node_modules", "@mcp-use", "tunnel")),
      false,
      "embedded tunnel support must not install @mcp-use/tunnel"
    );
  }

  verifyDependencyGraph(installDirectory, frameworkManifest);
  verifyRuntimeImport(installDirectory, []);
  verifyRuntimeImport(installDirectory, ["--conditions=workerd"]);

  writeFileSync(
    join(installDirectory, "index.ts"),
    `import { MCPServer } from "mcp-use";\n` +
      `export default new MCPServer({ name: "release-smoke", version: "1.0.0" });\n`
  );
  run(process.execPath, [frameworkBin, "build"], installDirectory);
  const buildDirectory = join(installDirectory, ".mcp-use", "build");
  assert.ok(directoryBytes(buildDirectory) <= 1024 * 1024);
  assert.deepEqual(
    findFiles(buildDirectory, (file) => file.endsWith(".map")),
    []
  );

  const devPort = await availablePort();
  await verifyServerCommand(installDirectory, "dev", devPort, false);
  const startPort = await availablePort();
  const startTrace = await verifyServerCommand(
    installDirectory,
    "start",
    startPort,
    true
  );
  assert.deepEqual(
    parseResolutions(startTrace)
      .map(({ url }) => url)
      .filter((url) =>
        /@mcp-use\/client|@modelcontextprotocol\/sdk|\/node_modules\/(?:vite|@vitejs)\/|\/commands\/(?:dev|build)\.js/.test(
          url
        )
      ),
    []
  );

  const installedBytes = directoryBytes(join(installDirectory, "node_modules"));
  assert.ok(
    installedBytes <= 110 * 1024 * 1024,
    `clean install is ${(installedBytes / 1024 / 1024).toFixed(3)} MiB`
  );
  console.log(
    JSON.stringify(
      {
        node: process.version,
        npm: run("npm", ["--version"], installDirectory).trim(),
        frameworkVersion: frameworkManifest.version,
        cliVersion: cliManifest.version,
        tunnelVersion: tunnelManifest.version,
        installedBytes,
        installedMiB: installedBytes / 1024 / 1024,
        toolBuildBytes: directoryBytes(buildDirectory),
      },
      null,
      2
    )
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function verifyDependencyGraph(directory, frameworkManifest) {
  const packages = JSON.parse(run("npm", ["query", "*", "--json"], directory));
  const versions = new Map();
  for (const pkg of packages) {
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string")
      continue;
    const seen = versions.get(pkg.name) ?? new Set();
    seen.add(pkg.version);
    versions.set(pkg.name, seen);
  }
  const duplicates = [...versions]
    .filter(([, seen]) => seen.size > 1)
    .map(([name, seen]) => `${name}: ${[...seen].join(", ")}`);
  assert.deepEqual(duplicates, []);
  assert.equal(versions.has("@modelcontextprotocol/sdk"), false);
  for (const name of [
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    "@modelcontextprotocol/server",
  ]) {
    const physicalPackages = packages.filter((pkg) => pkg.name === name);
    assert.equal(
      physicalPackages.length,
      1,
      `${name} has ${physicalPackages.length} physical installs`
    );
    assert.deepEqual(
      [...(versions.get(name) ?? [])],
      [frameworkManifest.dependencies[name]]
    );
  }

  const extraneous = JSON.parse(
    run("npm", ["query", ":extraneous", "--json"], directory)
  );
  const lock = readJson(join(directory, "package-lock.json"));
  for (const pkg of extraneous) {
    assert.ok(
      allowedExtraneous.has(pkg.name),
      `unexpected extraneous ${pkg.name}`
    );
    assert.equal(lock.packages[pkg.location]?.optional, true);
  }
}

function findPackedArtifact(name) {
  const slug = name.replace(/^@/, "").replace("/", "-");
  const match = readdirSync(artifactDirectory).find((file) =>
    new RegExp(`^${slug}-\\d.*\\.tgz$`).test(file)
  );
  assert.ok(match, `missing packed artifact for ${name}`);
  return join(artifactDirectory, match);
}

function verifyRuntimeImport(directory, conditions) {
  const result = runResult(
    process.execPath,
    [
      ...conditions,
      "--experimental-loader",
      loader,
      "--input-type=module",
      "--eval",
      'await import("mcp-use")',
    ],
    directory,
    { NODE_NO_WARNINGS: "1" }
  );
  assert.equal(result.status, 0, result.stderr);
  const resolutions = parseResolutions(result.stderr);
  const builtins = [...new Set(resolutions.map(({ url }) => url))].filter(
    (url) => url.startsWith("node:")
  );
  if (conditions.includes("--conditions=workerd")) {
    assert.deepEqual(builtins, []);
    assert.ok(
      resolutions.some(({ url }) => url.includes("shimsWorkerd.mjs")),
      resolutions
        .map(({ url }) => url)
        .slice(0, 40)
        .join("\n")
    );
  } else {
    const allowedBuiltins = new Map([
      [
        "node:process",
        /(?:@modelcontextprotocol\/server\/dist\/shimsNode|\/mcp-use\/dist\/index-node)\.(?:mjs|js)$/,
      ],
      ["node:http", /\/mcp-use\/dist\/index-node\.js$/],
    ]);
    for (const resolution of resolutions.filter(({ url }) =>
      url.startsWith("node:")
    )) {
      const allowedParent = allowedBuiltins.get(resolution.url);
      assert.ok(allowedParent, `unexpected Node builtin: ${resolution.url}`);
      assert.match(
        resolution.parentURL ?? "",
        allowedParent,
        `${resolution.url} loaded by unexpected parent`
      );
    }
  }
}

async function verifyServerCommand(directory, command, port, trace) {
  const bin = join(directory, "node_modules", "mcp-use", "dist", "bin.js");
  const args = [
    ...(trace ? ["--experimental-loader", loader] : []),
    bin,
    command,
    "--port",
    String(port),
    ...(command === "dev" ? ["--no-open", "--no-inspector"] : []),
  ];
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`);
        return response.status === 204;
      } catch {
        return false;
      }
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : error}\n${output}`
    );
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
  return output;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for server readiness");
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function parseResolutions(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("MCP_USE_RESOLVE "))
    .map((line) => JSON.parse(line.slice("MCP_USE_RESOLVE ".length)));
}

function run(command, args, cwd, extraEnv = {}) {
  const result = runResult(command, args, cwd, extraEnv);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function runResult(command, args, cwd, extraEnv = {}) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
}

function installedBin(directory, name) {
  return join(
    directory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name
  );
}

function runInstalledBin(command, args, cwd) {
  if (process.platform !== "win32") return run(command, args, cwd);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function directoryBytes(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return (
      total +
      (entry.isDirectory() ? directoryBytes(child) : statSync(child).size)
    );
  }, 0);
}

function findFiles(path, predicate) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory()
      ? findFiles(child, predicate)
      : predicate(child)
        ? [child]
        : [];
  });
}
