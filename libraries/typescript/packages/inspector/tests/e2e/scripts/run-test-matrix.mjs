#!/usr/bin/env node

/**
 * E2E Test Matrix Runner
 *
 * Automatically builds and starts the conformance server before running Playwright tests.
 * Supports three test modes:
 * - builtin: Server dev with built-in inspector on port 3000 (for HMR testing)
 * - prod: Built server on port 3002, built inspector on port 3000
 * - mix: Built server on port 3002, dev inspector on port 3000
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the mode from command line argument
const mode = process.argv[2];
if (!["builtin", "prod", "mix"].includes(mode)) {
  console.error(
    "Usage: node run-test-matrix.mjs <builtin|prod|mix> [test-file] [playwright-options]"
  );
  console.error("\nExamples:");
  console.error("  node run-test-matrix.mjs mix tests/e2e/setup.test.ts");
  console.error(
    '  node run-test-matrix.mjs mix tests/e2e/chat.test.ts -g "should send message"'
  );
  console.error("  node run-test-matrix.mjs builtin --headed");
  process.exit(1);
}

// Collect any additional arguments to pass to playwright (e.g., specific test files)
const additionalArgs = process.argv.slice(3);

console.log(`\n🧪 Running E2E tests in ${mode} mode\n`);
if (additionalArgs.length > 0) {
  console.log(`📝 Test files: ${additionalArgs.join(", ")}\n`);
}

// Resolve paths
const inspectorDir = resolve(__dirname, "../../..");
const conformanceServerDir = resolve(
  inspectorDir,
  "../mcp-use/examples/server/features/conformance"
);

// Track child processes for cleanup
const childProcesses = [];

// Cleanup handler
function cleanup() {
  console.log("\n🧹 Cleaning up processes...");
  childProcesses.forEach((proc) => {
    try {
      proc.kill("SIGTERM");
    } catch (err) {
      // Process may already be dead
    }
  });
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Helper to run a command and wait for it to complete
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

// Helper to start a background process
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

    // Give it a moment to start
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
    }, 1000);
  });
}

// Helper to wait for a URL to be ready
async function waitForUrl(url, description) {
  console.log(`⏳ Waiting for ${description} at ${url}...`);
  try {
    await waitOn({
      resources: [url],
      timeout: 120000, // 2 minutes
      interval: 1000,
      verbose: false,
    });
    console.log(`✅ ${description} is ready\n`);
  } catch (err) {
    throw new Error(`${description} failed to start: ${err.message}`);
  }
}

// Main execution
async function main() {
  try {
    // Step 1: Build conformance server (needed for all modes)
    await runCommand(
      "pnpm",
      ["--filter", "conformance-server", "build"],
      conformanceServerDir,
      "Building conformance server"
    );

    // Mode-specific setup
    let playwrightEnv = {
      // Disable telemetry during tests to prevent network errors and tracking
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
      NODE_ENV: "test",
    };

    if (mode === "builtin") {
      // Builtin mode: Server dev with built-in inspector on port 3000
      playwrightEnv = {
        ...playwrightEnv,
        TEST_SERVER_MODE: "builtin-dev",
      };

      // Start conformance server in dev mode (includes built-in inspector)
      await startBackgroundProcess(
        "pnpm",
        ["--filter", "conformance-server", "dev", "--no-open"],
        conformanceServerDir,
        "Starting conformance server with built-in inspector",
        playwrightEnv
      );

      // Wait for the built-in inspector to be ready
      await waitForUrl("http://localhost:3000/inspector", "Built-in inspector");
    } else if (mode === "prod") {
      // Prod mode: Built server on port 3002, built inspector on port 3000
      playwrightEnv = {
        ...playwrightEnv,
        TEST_MODE: "production",
        TEST_SERVER_MODE: "external-built",
      };

      // Build inspector
      await runCommand("pnpm", ["build"], inspectorDir, "Building inspector");

      // Start conformance server on port 3002
      await startBackgroundProcess(
        "pnpm",
        ["--filter", "conformance-server", "start", "--port", "3002"],
        conformanceServerDir,
        "Starting conformance server on port 3002",
        playwrightEnv
      );

      // Wait for conformance server to be ready
      await waitForUrl("http://localhost:3002/mcp", "Conformance server");
    } else if (mode === "mix") {
      // Mix mode: Built server on port 3002, dev inspector on port 3000
      playwrightEnv = {
        ...playwrightEnv,
        TEST_MODE: "dev",
        TEST_SERVER_MODE: "external-built",
      };

      // Start conformance server on port 3002
      await startBackgroundProcess(
        "pnpm",
        ["--filter", "conformance-server", "start", "--port", "3002"],
        conformanceServerDir,
        "Starting conformance server on port 3002",
        playwrightEnv
      );

      // Wait for conformance server to be ready
      await waitForUrl("http://localhost:3002/mcp", "Conformance server");
    }

    // Step 2: Run Playwright tests
    console.log("🎭 Running Playwright tests...\n");

    // Build playwright args with test exclusions
    const playwrightArgs = ["test"];

    // Skip auth tests for all modes
    // Skip connection and setup tests for builtin mode only (they test external server scenarios)
    // Skip HMR tests for prod and mix modes (HMR only works in builtin dev mode)
    if (mode === "builtin") {
      playwrightArgs.push(
        "--grep-invert",
        "auth-flows.test.ts|connection.test.ts|setup.test.ts"
      );
      console.log(
        "⏭️  Skipping auth-flows, connection, and setup tests (not applicable for builtin mode)\n"
      );
    } else {
      playwrightArgs.push("--grep-invert", "auth-flows.test.ts|hmr.test.ts");
      console.log(
        "⏭️  Skipping auth-flows and HMR tests (HMR only works in builtin dev mode)\n"
      );
    }

    // Add any additional arguments (e.g., specific test files)
    if (additionalArgs.length > 0) {
      playwrightArgs.push(...additionalArgs);
    }

    // Check if HMR tests are being run (they modify files and need serial execution)
    const isRunningHmrTests =
      additionalArgs.some((arg) => arg.includes("hmr.test.ts")) ||
      (mode === "builtin" && additionalArgs.length === 0);

    if (isRunningHmrTests) {
      // Force serial execution for HMR tests to prevent file conflicts
      playwrightArgs.push("--workers=1");
      console.log(
        "⚙️  Running with --workers=1 (HMR tests modify files and must run serially)\n"
      );
    }

    const playwrightProc = spawn("playwright", playwrightArgs, {
      cwd: inspectorDir,
      stdio: "inherit",
      shell: false, // Don't use shell to avoid argument parsing issues
      env: {
        ...process.env,
        ...playwrightEnv,
      },
    });

    childProcesses.push(playwrightProc);

    playwrightProc.on("close", async (code) => {
      // Restore modified files after HMR tests (whether they pass or fail)
      if (isRunningHmrTests) {
        console.log("\n🔄 Restoring modified conformance server files...");
        try {
          await runCommand(
            "git",
            ["restore", "."],
            conformanceServerDir,
            "Restoring conformance server files"
          );
        } catch (err) {
          console.log("⚠️  Warning: Could not restore files:", err.message);
        }
      }

      if (code === 0) {
        console.log("\n✅ All tests passed!\n");
      } else {
        console.log(`\n❌ Tests failed with code ${code}\n`);
      }
      cleanup();
      process.exit(code);
    });
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    cleanup();
    process.exit(1);
  }
}

main();
