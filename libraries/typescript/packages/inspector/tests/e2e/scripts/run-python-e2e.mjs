#!/usr/bin/env node

/**
 * E2E tests for the Python MCP server.
 *
 * 1. Build the inspector (dist/app: inspector.js.gz + inspector.css.gz).
 * 2. Assemble a legacy CDN layout (index.html + assets/*) in dist/e2e-cdn and serve it with
 *    npx http-server. The Python loader fetches `${INSPECTOR_CDN_BASE_URL}/index.html` and
 *    rewrites `/inspector/assets/` references to the CDN, so the shell must use those paths.
 * 3. Start the Python server (examples/server/server_example.py) with INSPECTOR_CDN_BASE_URL set.
 * 4. Run Playwright tests against the Python server's inspector at http://localhost:8000/inspector.
 *
 * Uses libraries/python/.venv if present; otherwise PYTHON_CMD or python3.
 * Create the venv and install deps: cd libraries/python && python3 -m venv .venv && .venv/bin/pip install -e .
 *
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inspectorDir = resolve(__dirname, "../../..");
const repoRoot = resolve(inspectorDir, "../../../..");
const pythonDir = resolve(repoRoot, "libraries/python");

const CDN_SERVER_PORT = 2967;
const PYTHON_SERVER_PORT = 8000;

const childProcesses = [];

function cleanup(exitCode = 0) {
  console.log("\n🧹 Cleaning up processes...");
  childProcesses.forEach((proc) => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  });
  process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

function runCommand(command, args, cwd, description) {
  return new Promise((resolve, reject) => {
    console.log(`📦 ${description}...`);
    console.log(`   Running: ${command} ${args.join(" ")}`);

    const proc = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: true,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ ${description} completed\n`);
        resolve();
      } else {
        reject(new Error(`${description} failed with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`${description} error: ${err.message}`));
    });
  });
}

function startBackgroundProcess(command, args, cwd, description, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 ${description}...`);
    console.log(`   Running: ${command} ${args.join(" ")}`);

    const proc = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        ...env,
      },
    });

    childProcesses.push(proc);

    proc.on("error", (err) => {
      reject(new Error(`${description} error: ${err.message}`));
    });

    setTimeout(() => {
      if (proc.exitCode === null) {
        console.log(`✅ ${description} started\n`);
        resolve(proc);
      } else {
        reject(
          new Error(
            `${description} exited immediately with code ${proc.exitCode}`
          )
        );
      }
    }, 1500);
  });
}

async function waitForUrl(url, description, options = {}) {
  const { delay = 0 } = options;
  console.log(`⏳ Waiting for ${description} at ${url}...`);
  try {
    await waitOn({
      resources: [url],
      timeout: 60000,
      interval: 1000,
      delay,
      verbose: false,
    });
    console.log(`✅ ${description} is ready\n`);
  } catch (err) {
    throw new Error(`${description} failed to start: ${err.message}`);
  }
}

/**
 * Build a legacy-layout CDN directory from the v2 inspector build.
 *
 * v2 emits dist/app/{inspector.js.gz,inspector.css.gz,favicons...} and the
 * server renders its own HTML shell. The Python package still loads the
 * inspector the v1 way: fetch `<cdn>/index.html` and rewrite
 * `/inspector/assets/` paths to `<cdn>/assets/`. Recreate that shape here.
 */
function buildLegacyCdnLayout() {
  const appDir = join(inspectorDir, "dist", "app");
  const cdnDir = join(inspectorDir, "dist", "e2e-cdn");
  const assetsDir = join(cdnDir, "assets");
  rmSync(cdnDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });

  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = join(appDir, entry.name);
    if (entry.name.endsWith(".gz")) {
      writeFileSync(
        join(assetsDir, entry.name.slice(0, -3)),
        gunzipSync(readFileSync(source))
      );
    } else {
      copyFileSync(source, join(assetsDir, entry.name));
    }
  }

  const missing = ["inspector.js", "inspector.css"].filter(
    (name) => !existsSync(join(assetsDir, name))
  );
  if (missing.length > 0) {
    throw new Error(
      `Inspector build is missing ${missing.join(", ")} in dist/app; run "pnpm build" first`
    );
  }

  // Mirrors the runtime shell in src/server/inspector-shell.ts. The Python
  // server is same-origin with the inspector, so no proxy is configured.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="/inspector/assets/inspector.css" />
    <title>Inspector | mcp-use</title>
    <script>window.__MCP_BASE_PATH__ = "";</script>
    <script>window.__MCP_PROXY_URL__ = null;</script>
    <script>window.__MCP_INSPECTOR_MODE__ = "embedded";</script>
    <script>window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;try{localStorage.setItem("MCP_USE_ANONYMIZED_TELEMETRY","false");}catch(e){}</script>
  </head>
  <body>
    <script>
      if (typeof window !== "undefined" && typeof window.process === "undefined") {
        window.process = {
          env: {},
          platform: "browser",
          browser: true,
          version: "v18.0.0",
          versions: { node: "18.0.0" },
          cwd: () => "/",
          nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
        };
      }
    </script>
    <div id="root"></div>
    <script type="module" src="/inspector/assets/inspector.js"></script>
  </body>
</html>
`;
  writeFileSync(join(cdnDir, "index.html"), html);
  console.log(`📁 Legacy CDN layout assembled at ${cdnDir}\n`);
  return cdnDir;
}

async function main() {
  const additionalArgs = process.argv.slice(2);

  console.log("\n🧪 Running Python server E2E tests\n");

  try {
    // 1. Build inspector
    await runCommand("pnpm", ["build"], inspectorDir, "Building inspector");

    // 2. Serve a legacy CDN layout built from dist/app (Python server will fetch from this URL)
    const cdnDir = buildLegacyCdnLayout();
    await startBackgroundProcess(
      "npx",
      ["http-server", cdnDir, "-p", String(CDN_SERVER_PORT), "--cors"],
      inspectorDir,
      "Starting http-server (inspector dist as CDN)"
    );
    await waitForUrl(
      `http://127.0.0.1:${CDN_SERVER_PORT}`,
      "http-server (CDN)"
    );

    const cdnBaseUrl = `http://127.0.0.1:${CDN_SERVER_PORT}`;

    // 3. Start Python server with venv activated when present (fetches inspector via INSPECTOR_CDN_BASE_URL)
    const venvDir = join(pythonDir, ".venv");
    const venvPython =
      process.platform === "win32"
        ? join(venvDir, "Scripts", "python.exe")
        : join(venvDir, "bin", "python");
    const serverEnv = {
      INSPECTOR_CDN_BASE_URL: cdnBaseUrl,
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
    };

    if (existsSync(venvPython)) {
      // Run with venv env (VIRTUAL_ENV + PATH) so we're "in" the venv
      serverEnv.VIRTUAL_ENV = venvDir;
      const venvBin =
        process.platform === "win32"
          ? join(venvDir, "Scripts")
          : join(venvDir, "bin");
      const pathSep = process.platform === "win32" ? ";" : ":";
      serverEnv.PATH = `${venvBin}${pathSep}${process.env.PATH || ""}`;
      await startBackgroundProcess(
        venvPython,
        ["examples/server/server_example.py"],
        pythonDir,
        "Starting Python MCP server (.venv)",
        serverEnv
      );
    } else {
      const pythonCmd = process.env.PYTHON_CMD || "python3";
      await startBackgroundProcess(
        pythonCmd,
        ["examples/server/server_example.py"],
        pythonDir,
        `Starting Python MCP server (${pythonCmd})`,
        serverEnv
      );
    }
    await waitForUrl(`tcp:127.0.0.1:${PYTHON_SERVER_PORT}`, "Python server", {
      delay: 2000,
    });

    // 4. Run Playwright
    console.log("🎭 Running Playwright tests...\n");

    const playwrightArgs = [
      "test",
      "tests/e2e/python.test.ts",
      ...additionalArgs,
    ];

    const playwrightProc = spawn("npx", ["playwright", ...playwrightArgs], {
      cwd: inspectorDir,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        TEST_SERVER_URL: `http://127.0.0.1:${PYTHON_SERVER_PORT}/mcp`,
        PYTHON_INSPECTOR_URL: `http://127.0.0.1:${PYTHON_SERVER_PORT}/inspector`,
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
      },
    });

    childProcesses.push(playwrightProc);

    playwrightProc.on("close", (code) => {
      if (code === 0) {
        console.log("\n✅ All tests passed!\n");
      } else {
        console.log(`\n❌ Tests failed with code ${code}\n`);
      }
      // cleanup() exits the process; pass the Playwright exit code through.
      cleanup(code ?? 1);
    });
  } catch (err) {
    console.error("\n❌ Error:", err.message, "\n");
    cleanup(1);
  }
}

main();
