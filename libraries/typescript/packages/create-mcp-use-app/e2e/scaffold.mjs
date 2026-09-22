#!/usr/bin/env node

/**
 * End-to-end check for create-mcp-use-app: scaffold a project from the packed
 * tarball, install it against this build's mcp-use tarballs, start `dev`, and
 * wait for the MCP endpoint to answer. CI runs it once per OS × package
 * manager × template; it has no dependencies so it runs outside the monorepo.
 *
 * Usage:
 *   node e2e/scaffold.mjs --pm <npm|yarn|pnpm> --template <name>
 *     --packages <dir> [--dev] [--work-dir <dir>] [--port <n>]
 *
 * `--packages` is searched recursively for the create-mcp-use-app, mcp-use,
 * @mcp-use/cli and @mcp-use/inspector tarballs. To produce them locally:
 *   pnpm build && for p in create-mcp-use-app server cli inspector; do
 *     (cd packages/$p && pnpm pack --pack-destination /tmp/mcp-use-tarballs); done
 *
 * With `--dev` the project uses workspace:* dependencies, which only resolve
 * inside the monorepo, so only the scaffold is checked.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const APP_NAME = "test-app";
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;
const isWindows = process.platform === "win32";

const { values } = parseArgs({
  options: {
    pm: { type: "string" },
    template: { type: "string" },
    packages: { type: "string" },
    dev: { type: "boolean", default: false },
    "work-dir": { type: "string" },
    port: { type: "string", default: "3000" },
  },
});

const pm = values.pm;
if (
  !["npm", "yarn", "pnpm"].includes(pm) ||
  !values.template ||
  !values.packages
) {
  console.error(
    "Usage: scaffold.mjs --pm <npm|yarn|pnpm> --template <name> --packages <dir> [--dev] [--work-dir <dir>] [--port <n>]"
  );
  process.exit(2);
}

const packagesDir = path.resolve(values.packages);
const workDir = values["work-dir"]
  ? path.resolve(values["work-dir"])
  : mkdtempSync(path.join(tmpdir(), "create-mcp-use-app-e2e-"));
const appDir = path.join(workDir, APP_NAME);
const port = Number(values.port);
let tarballs;

try {
  tarballs = {
    "create-mcp-use-app": findTarball(/^create-mcp-use-app-\d.*\.tgz$/),
    "mcp-use": findTarball(/^mcp-use-\d.*\.tgz$/),
    "@mcp-use/cli": findTarball(/^mcp-use-cli-\d.*\.tgz$/),
    "@mcp-use/inspector": findTarball(/^mcp-use-inspector-\d.*\.tgz$/),
  };

  step(`Scaffold ${values.template} with ${pm} in ${workDir}`);
  mkdirSync(workDir, { recursive: true });
  scaffold();

  if (values.dev) {
    console.log(
      "--dev uses workspace:* dependencies; skipping install and dev"
    );
  } else {
    step("Install against this build's tarballs");
    useLocalTarballs();
    // Yarn Berry defaults to immutable installs on CI, which forbids creating
    // the lockfile this fresh project needs. Yarn 1 ignores the variable.
    run(pm, ["install"], appDir, {
      ...process.env,
      YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
    });

    step("Start dev server");
    await checkDevServer();
  }
  console.log("✅ create-mcp-use-app e2e passed");
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}

function scaffold() {
  const createArgs = [APP_NAME, "--template", values.template];
  if (values.dev) {
    createArgs.push("--dev");
  } else {
    // Pin the tarball's version so scaffolding skips the npm dist-tag lookup
    // (a network flake source); the install step swaps in the tarball anyway.
    const sdkVersion = path
      .basename(tarballs["mcp-use"])
      .replace(/^mcp-use-(.+)\.tgz$/, "$1");
    createArgs.push("--sdk-version", sdkVersion);
  }
  const tarball = tarballs["create-mcp-use-app"];
  const commands = {
    npm: [
      "npx",
      ["--yes", `--package=${tarball}`, "create-mcp-use-app", ...createArgs],
    ],
    yarn: [
      "yarn",
      [
        "dlx",
        "-p",
        `create-mcp-use-app@file:${tarball}`,
        "create-mcp-use-app",
        ...createArgs,
      ],
    ],
    pnpm: [
      "pnpm",
      [`--package=${tarball}`, "dlx", "create-mcp-use-app", ...createArgs],
    ],
  };
  run(...commands[pm], workDir);

  for (const file of ["package.json", "index.ts"]) {
    if (!existsSync(path.join(appDir, file))) {
      fail(`Scaffolded project is missing ${file}`);
    }
  }
  console.log("✅ Project created");
}

/**
 * Copy the tarballs into the project and point mcp-use (direct) plus
 * @mcp-use/cli and @mcp-use/inspector (transitive) at them. Copying keeps the
 * `file:` specs relative, which every package manager accepts on every OS.
 */
function useLocalTarballs() {
  const vendorDir = path.join(appDir, ".tarballs");
  mkdirSync(vendorDir, { recursive: true });
  const spec = (name) => {
    const file = path.basename(tarballs[name]);
    copyFileSync(tarballs[name], path.join(vendorDir, file));
    return `file:./.tarballs/${file}`;
  };

  const packageJsonPath = path.join(appDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  pkg.dependencies["mcp-use"] = spec("mcp-use");
  const transitive = {
    "@mcp-use/cli": spec("@mcp-use/cli"),
    "@mcp-use/inspector": spec("@mcp-use/inspector"),
  };
  if (pm === "npm") pkg.overrides = transitive;
  if (pm === "yarn") pkg.resolutions = transitive;
  if (pm === "pnpm") {
    const overrides = Object.entries(transitive)
      .map(([name, value]) => `  "${name}": "${value}"\n`)
      .join("");
    writeFileSync(
      path.join(appDir, "pnpm-workspace.yaml"),
      `overrides:\n${overrides}`
    );
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function checkDevServer() {
  const url = `http://127.0.0.1:${port}/mcp`;
  const child = spawnCommand(pm, pm === "npm" ? ["run", "dev"] : ["dev"], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
    // Own process group on Unix so the whole tree can be signalled at once.
    detached: !isWindows,
  });

  let exitCode = null;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitCode = code ?? signal;
      resolve();
    });
  });
  const stop = () => stopTree(child, exited);
  process.once("SIGINT", () => stop().then(() => process.exit(130)));

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exitCode !== null) {
        fail(`Dev server exited before responding (exit ${exitCode})`);
      }
      const status = await probe(url);
      if (status !== null) {
        if (status >= 500)
          fail(`Dev server responded HTTP ${status} at ${url}`);
        console.log(`✅ Dev server responded at ${url} (HTTP ${status})`);
        return;
      }
      await sleep(1000);
    }
    fail(
      `Dev server did not respond at ${url} within ${READY_TIMEOUT_MS / 1000}s`
    );
  } finally {
    await stop();
  }
}

/**
 * Kill the dev server and everything it spawned. `child.pid` is a real OS
 * PID here (unlike `$!` in Git Bash), so taskkill /T is safe on Windows.
 */
async function stopTree(child, exited) {
  const running = child.exitCode === null && child.signalCode === null;
  if (isWindows) {
    // Only while cmd.exe is alive: once it exits, its PID can be reused.
    if (running) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    }
  } else {
    // Signal the group even if the direct child exited; the server it
    // started may still be running in it.
    killGroup(child.pid, "SIGTERM");
  }
  const stopped = await Promise.race([
    exited.then(() => true),
    sleep(STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!stopped) {
    if (!isWindows) killGroup(child.pid, "SIGKILL");
    console.warn(
      "Dev server did not exit after being stopped; not waiting for it"
    );
    child.unref();
  }
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone.
  }
}

/** HTTP status from `url`, or null while nothing is listening. */
async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

function findTarball(pattern) {
  const matches = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (pattern.test(entry.name)) matches.push(entryPath);
    }
  };
  walk(packagesDir);
  if (matches.length !== 1) {
    fail(
      `Expected one tarball matching ${pattern} in ${packagesDir}, found ${matches.length}`
    );
  }
  return matches[0];
}

function run(command, args, cwd, env = process.env) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, shellArgs(args), {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    shell: isWindows,
  });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

function spawnCommand(command, args, options) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return spawn(command, shellArgs(args), { ...options, shell: isWindows });
}

/**
 * npm, npx, yarn and pnpm are .cmd shims on Windows, which Node only runs
 * through a shell. Quote arguments so paths survive cmd.exe.
 */
function shellArgs(args) {
  if (!isWindows) return args;
  return args.map((arg) =>
    /[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg
  );
}

function step(title) {
  console.log(`\n▶ ${title}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Throw so pending `finally` cleanup (stopping the dev server) still runs. */
function fail(message) {
  throw new Error(message);
}
