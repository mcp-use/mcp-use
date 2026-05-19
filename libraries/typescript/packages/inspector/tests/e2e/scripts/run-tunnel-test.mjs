#!/usr/bin/env node

/**
 * test_tunnel: E2E test for tunnel functionality (dev --tunnel and start --tunnel).
 *
 * 1. Spawn conformance server with `dev --tunnel`, capture output, poll for tunnel URL, kill.
 * 2. Build conformance server, spawn with `start --tunnel`, same poll-for-URL check.
 *
 * Uses the conformance server from packages/mcp-use/examples/server/features/conformance.
 * Must be run from libraries/typescript (monorepo root) so pnpm --filter works.
 */

import { spawn } from "node:child_process";
import {
  createWriteStream,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inspectorDir = resolve(__dirname, "../../..");
const typescriptRoot = resolve(inspectorDir, "../..");
const conformanceServerDir = resolve(
  inspectorDir,
  "../mcp-use/examples/server/features/conformance"
);

const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\/mcp/i;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 45000;

const childProcesses = [];

function clearTunnelSubdomain() {
  const manifestPath = join(conformanceServerDir, "dist", "mcp-use.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (manifest.tunnel) {
      delete manifest.tunnel;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }
}

function cleanup() {
  console.log("\nCleaning up processes...");
  childProcesses.forEach((proc) => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  });
  process.exit(1);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

function runCommand(command, args, cwd, description) {
  return new Promise((resolve, reject) => {
    console.log(`[test_tunnel] ${description}...`);
    console.log(`   Running: ${command} ${args.join(" ")}`);

    const proc = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
      },
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[test_tunnel] ${description} completed\n`);
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

function startTunnelProcess(command, args, cwd, logPath) {
  return new Promise((resolve, reject) => {
    const logStream = createWriteStream(logPath, { flags: "a" });

    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: {
        ...process.env,
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
      },
    });

    childProcesses.push(proc);

    proc.stdout?.on("data", (data) => {
      logStream.write(data);
    });
    proc.stderr?.on("data", (data) => {
      logStream.write(data);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start tunnel process: ${err.message}`));
    });

    // Give it a moment to start
    setTimeout(() => {
      if (proc.exitCode === null) {
        resolve(proc);
      } else {
        reject(
          new Error(
            `Tunnel process exited immediately with code ${proc.exitCode}`
          )
        );
      }
    }, 1000);
  });
}

function pollForTunnelUrl(logPath) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      try {
        const content = readFileSync(logPath, "utf-8");
        const match = content.match(TUNNEL_URL_REGEX);
        if (match) {
          clearInterval(interval);
          resolve(match[0]);
          return;
        }
      } catch {
        // File may not exist yet
      }
      if (Date.now() - start >= POLL_TIMEOUT_MS) {
        clearInterval(interval);
        resolve(null);
      }
    }, POLL_INTERVAL_MS);
  });
}

async function waitForTunnelUrl(logPath, phase) {
  console.log(`[test_tunnel] Polling for tunnel URL (${phase})...`);
  const url = await pollForTunnelUrl(logPath);
  if (url) {
    console.log(`[test_tunnel] Tunnel URL found: ${url}\n`);
    return url;
  }
  return null;
}

async function runTunnelPhase(phase, command, args, logPath) {
  const proc = await startTunnelProcess(command, args, typescriptRoot, logPath);
  const url = await waitForTunnelUrl(logPath, phase);

  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  childProcesses.splice(childProcesses.indexOf(proc), 1);

  if (!url) {
    const logContent = readFileSync(logPath, "utf-8");
    console.error(`[test_tunnel] Tunnel URL not found in ${phase} output:`);
    console.error("---");
    console.error(logContent);
    console.error("---");
    throw new Error(`${phase}: Tunnel URL was not generated within 45s`);
  }

  return url;
}

async function main() {
  console.log("\n[test_tunnel] Running tunnel E2E test\n");

  const tmpDir = mkdtempSync(resolve(tmpdir(), "tunnel-test-"));
  const devLogPath = `${tmpDir}/tunnel-dev.log`;
  const startLogPath = `${tmpDir}/tunnel-start.log`;

  try {
    // Clear any persisted tunnel subdomain so we get fresh URLs
    // (leftover from previous runs would cause "subdomain already taken")
    clearTunnelSubdomain();

    // Phase 1: dev --tunnel
    console.log("[test_tunnel] Phase 1: dev --tunnel\n");
    await runTunnelPhase(
      "dev --tunnel",
      "pnpm",
      ["--filter", "conformance-server", "dev", "--tunnel", "--no-open"],
      devLogPath
    );

    // Phase 2: build + start --tunnel
    console.log("[test_tunnel] Phase 2: build + start --tunnel\n");
    await runCommand(
      "pnpm",
      ["--filter", "conformance-server", "build"],
      typescriptRoot,
      "Building conformance server"
    );

    // Clear persisted tunnel subdomain so start --tunnel gets a fresh URL
    // (dev --tunnel wrote it; reusing it would fail with "subdomain already taken")
    clearTunnelSubdomain();

    await runTunnelPhase(
      "start --tunnel",
      "pnpm",
      ["--filter", "conformance-server", "start", "--tunnel"],
      startLogPath
    );

    console.log("[test_tunnel] All tunnel tests passed!\n");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    console.error(`\n[test_tunnel] Error: ${err.message}\n`);
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main();
