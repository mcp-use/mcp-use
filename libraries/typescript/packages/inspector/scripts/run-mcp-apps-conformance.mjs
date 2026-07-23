import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const FIXED_REGRESSION_IDS = [
  "context/light-dark",
  "visibility/app-tool-call-guard",
  "display/no-undeclared-mode",
  "display/unavailable-returns-current",
  "security/csp-no-loosening",
  "security/csp-construct-from-domains",
];

const AUTOMATIC_PASS_IDS = [
  "lifecycle/initialize-capabilities",
  "lifecycle/tool-input",
  "lifecycle/tool-result",
  "lifecycle/tool-input-partial-stop",
  "context/initialize-hostcontext",
  "context/theme-variables",
  ...FIXED_REGRESSION_IDS,
  "tools/proxy-call",
  "display/return-resulting-mode",
  "security/sandbox-permissions",
  "security/csp-allow-declared",
  "dimensions/listen-size-changed",
  "capabilities/server-passthrough",
  "capabilities/content-modalities",
];

function parseArguments(argv) {
  const options = {
    suiteDir: process.env.MCP_APPS_CONFORMANCE_DIR,
    hostPort: 3301,
    suitePort: 3310,
    output: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--") {
      continue;
    } else if (value === "--suite-dir" && next) {
      options.suiteDir = next;
      index += 1;
    } else if (value === "--host-port" && next) {
      options.hostPort = Number(next);
      index += 1;
    } else if (value === "--suite-port" && next) {
      options.suitePort = Number(next);
      index += 1;
    } else if (value === "--output" && next) {
      options.output = next;
      index += 1;
    } else if (value === "--help") {
      console.log(`Usage:
  pnpm test:apps-conformance -- --suite-dir /absolute/path/to/mcp-app-conformance

Options:
  --suite-dir <path>  Local, already-built conformance-suite checkout
  --host-port <port>  Inspector port (default: 3301)
  --suite-port <port> Local conformance MCP port (default: 3310)
  --output <path>     Optional JSON result path

The runner launches only local services, blocks every browser request to an
Alpic domain, verifies the stable automatic checks, and stops before completing
operator/model checks. It never uploads or publishes results.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }

  if (!options.suiteDir) {
    throw new Error(
      "Provide --suite-dir or MCP_APPS_CONFORMANCE_DIR with a local suite checkout"
    );
  }
  if (!path.isAbsolute(options.suiteDir)) {
    throw new Error("--suite-dir must be an absolute local filesystem path");
  }
  if (
    !Number.isInteger(options.hostPort) ||
    !Number.isInteger(options.suitePort)
  ) {
    throw new Error("Host and suite ports must be integers");
  }

  return options;
}

function startProcess(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      log.push(chunk);
      if (process.env.DEBUG_APPS_CONFORMANCE === "1") {
        process.stderr.write(chunk);
      }
    });
  }
  return { child, log };
}

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for localhost:${port}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

function mergeRows(groups) {
  return groups.flatMap(({ group, tests }) =>
    tests.map(({ id, status }) => ({
      id: `${group}/${id}`,
      status,
    }))
  );
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const inspectorDir = path.resolve(import.meta.dirname, "..");
  const suiteEntry = path.join(options.suiteDir, "dist/server/main.js");
  const inspectorEntry = path.join(inspectorDir, "dist/cli.js");

  const suite = startProcess(process.execPath, [suiteEntry], {
    cwd: options.suiteDir,
    env: { ...process.env, PORT: String(options.suitePort) },
  });
  const inspector = startProcess(
    process.execPath,
    [inspectorEntry, "--port", String(options.hostPort), "--no-open"],
    {
      cwd: inspectorDir,
      env: process.env,
    }
  );

  let browser;
  try {
    await Promise.all([
      waitForPort(options.suitePort),
      waitForPort(options.hostPort),
    ]);

    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const blockedAlpicRequests = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.hostname === "alpic.ai" ||
        url.hostname.endsWith(".alpic.ai") ||
        url.hostname === "alpic.live" ||
        url.hostname.endsWith(".alpic.live") ||
        url.hostname === "alpic-ai.github.io"
      ) {
        blockedAlpicRequests.push(route.request().url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const browserErrors = [];
    const browserConsole = [];
    page.on("console", (message) => {
      browserConsole.push({ type: message.type(), text: message.text() });
      if (message.type() === "error") browserErrors.push(message.text());
    });

    const connection = encodeURIComponent(
      JSON.stringify({
        url: `http://localhost:${options.suitePort}/mcp`,
        name: "Local MCP Apps conformance",
        transportType: "http",
        connectionMode: "proxy",
        connectionType: "Via Proxy",
      })
    );
    await page.goto(
      `http://localhost:${options.hostPort}/inspector?autoConnect=${connection}`,
      { waitUntil: "networkidle", timeout: 30_000 }
    );

    await page.getByTestId("tool-item-run_conformance").click();
    await page.getByTestId("tool-execution-execute-button").click();

    await page.locator('iframe[title^="MCP App"]').waitFor({ timeout: 15_000 });
    const frameDeadline = Date.now() + 15_000;
    let resolvedSuiteFrame;
    while (Date.now() < frameDeadline) {
      const candidateFrames = page
        .frames()
        .filter((frame) => frame !== page.mainFrame());
      if (candidateFrames.length >= 2) {
        resolvedSuiteFrame = candidateFrames[candidateFrames.length - 1];
        break;
      }
      await page.waitForTimeout(100);
    }
    if (!resolvedSuiteFrame) {
      throw new Error(
        "The Inspector did not render the conformance app iframe"
      );
    }

    await resolvedSuiteFrame
      .getByText("MCP Apps Conformance", { exact: true })
      .waitFor({ timeout: 15_000 });
    await resolvedSuiteFrame.waitForFunction(
      () => {
        const button = document.querySelector('[data-testid="run"]');
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      undefined,
      { timeout: 15_000 }
    );
    await resolvedSuiteFrame.evaluate(() => {
      const button = document.querySelector('[data-testid="run"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Conformance Run button not found");
      }
      button.click();
    });
    try {
      await resolvedSuiteFrame.waitForFunction(
        (requiredIds) => {
          const statuses = new Map(
            Array.from(document.querySelectorAll(".group")).flatMap((group) => {
              const groupName =
                group.querySelector(".group-name")?.textContent?.trim() ??
                "unknown";
              return Array.from(group.querySelectorAll("li")).map((row) => [
                `${groupName}/${row.querySelector(".tname")?.textContent?.trim()}`,
                row.querySelector(".st")?.textContent?.trim(),
              ]);
            })
          );
          return requiredIds.every((id) => {
            const status = statuses.get(id);
            return (
              status !== undefined && status !== "NOTRUN" && status !== "…"
            );
          });
        },
        AUTOMATIC_PASS_IDS,
        { timeout: 60_000 }
      );
    } catch (error) {
      const currentState = await resolvedSuiteFrame
        .locator("body")
        .innerText()
        .catch(() => "Conformance frame unavailable");
      throw new Error(
        `Timed out waiting for automatic MCP Apps checks.\n${currentState}`,
        { cause: error }
      );
    }

    const groups = await resolvedSuiteFrame.evaluate(() =>
      Array.from(document.querySelectorAll(".group")).map((element) => ({
        group:
          element.querySelector(".group-name")?.textContent?.trim() ??
          "unknown",
        tests: Array.from(element.querySelectorAll("li")).map((row) => ({
          id: row.querySelector(".tname")?.textContent?.trim() ?? "unknown",
          status: row.querySelector(".st")?.textContent?.trim() ?? "NOTRUN",
        })),
      }))
    );
    const results = mergeRows(groups);
    const resultById = new Map(results.map((result) => [result.id, result]));
    const regressions = AUTOMATIC_PASS_IDS.filter(
      (id) => resultById.get(id)?.status !== "PASS"
    );
    const cspAuditLogs = browserConsole.filter((entry) =>
      /\[MCP Apps CSP\]|mcp-apps-csp-applied/.test(entry.text)
    );

    const report = {
      capturedAt: new Date().toISOString(),
      inspectorUrl: `http://localhost:${options.hostPort}/inspector`,
      suiteUrl: `http://localhost:${options.suitePort}/mcp`,
      isolation: {
        alpicRequestsBlocked: blockedAlpicRequests.length,
        attemptedAlpicRequests: blockedAlpicRequests,
      },
      browserErrors,
      operatorChecks: {
        "security/csp-audit-log": {
          status: cspAuditLogs.length > 0 ? "PASS" : "FAIL",
          evidence: cspAuditLogs,
        },
      },
      results,
      fixedRegressionIds: FIXED_REGRESSION_IDS,
      automaticPassIds: AUTOMATIC_PASS_IDS,
      regressions,
    };

    if (options.output) {
      const outputPath = path.resolve(options.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(JSON.stringify(report, null, 2));

    if (blockedAlpicRequests.length > 0) {
      throw new Error(
        `The host attempted ${blockedAlpicRequests.length} request(s) to Alpic domains`
      );
    }
    if (regressions.length > 0) {
      throw new Error(
        `Automatic MCP Apps regressions: ${regressions.join(", ")}`
      );
    }
    if (cspAuditLogs.length === 0) {
      throw new Error(
        "MCP Apps regression: no sanitized CSP audit log was emitted"
      );
    }
  } catch (error) {
    process.stderr.write(
      [
        error instanceof Error ? error.stack : String(error),
        "\nInspector output:\n",
        inspector.log.join(""),
        "\nSuite output:\n",
        suite.log.join(""),
      ].join("")
    );
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await Promise.all([stopProcess(inspector.child), stopProcess(suite.child)]);
  }
}

await run();
