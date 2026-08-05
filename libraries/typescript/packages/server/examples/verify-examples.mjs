#!/usr/bin/env node
/**
 * Runs the example catalog through the public @mcp-use/client API.
 *
 * This is intentionally a Node script instead of a test-runner fixture: each
 * example is built and launched exactly like a user project, and failures keep
 * the child process log in `.mcp-use/example-verification/` for CI artifacts.
 */
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MCPClient } from "@mcp-use/client";

import { examples } from "./registry.mjs";

const examplesRoot = dirname(fileURLToPath(import.meta.url));
const artifactRoot = join(examplesRoot, ".mcp-use", "example-verification");
const cliBinRoot = join(artifactRoot, "bin");
const pathKey =
  Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
  "PATH";
const exampleEnv = {
  ...process.env,
  [pathKey]: `${cliBinRoot}${delimiter}${process.env[pathKey] ?? ""}`,
};
const packageManager = process.env.MCP_USE_EXAMPLES_PM ?? "pnpm";
const selectedIds = new Set(
  process.argv
    .filter((argument) => argument.startsWith("--example="))
    .map((argument) => argument.slice("--example=".length))
);
const skipBuild = process.argv.includes("--skip-build");

const selected = examples.filter(
  (example) => selectedIds.size === 0 || selectedIds.has(example.id)
);

if (selected.length === 0) {
  throw new Error("No examples matched the requested --example values.");
}

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });
await prepareWorkspaceCli();

let failures = 0;
for (const example of selected) {
  try {
    await verifyExample(example);
    console.log(`✓ ${example.id}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${example.id}: ${formatError(error)}`);
  }
}

if (failures > 0) {
  throw new Error(
    `${failures} example verification${failures === 1 ? "" : "s"} failed. Artifacts: ${artifactRoot}`
  );
}

async function prepareWorkspaceCli() {
  // A clean pnpm install cannot link this workspace binary before the server
  // package has been built. Expose the built CLI explicitly to every example.
  const cliEntry = resolve(examplesRoot, "..", "dist", "bin.js");
  await assertExists(
    cliEntry,
    "Build the mcp-use package before verifying server examples."
  );
  await mkdir(cliBinRoot, { recursive: true });

  if (process.platform === "win32") {
    await writeFile(
      join(cliBinRoot, "mcp-use.cmd"),
      `@echo off\r\nnode "${cliEntry}" %*\r\n`
    );
    return;
  }

  const wrapperPath = join(cliBinRoot, "mcp-use");
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(cliEntry).href)};\n`
  );
  await chmod(wrapperPath, 0o755);
}

async function verifyExample(example) {
  const cwd = resolve(examplesRoot, example.directory);
  await assertExists(
    join(cwd, "package.json"),
    `${example.id} is registered but has no package.json`
  );
  const packageJson = JSON.parse(
    await readFile(join(cwd, "package.json"), "utf8")
  );

  await runPackageScript(cwd, packageJson, "typecheck", example.id);
  if (example.verification === "configuration") {
    await verifyConfigurationContract(cwd, example, packageJson);
    console.log(`  ↳ live check skipped: ${example.skippedLiveReason}`);
    return;
  }

  if (!skipBuild && packageJson.scripts?.build) {
    await runPackageScript(cwd, packageJson, "build", example.id);
  }

  await verifyWithClient(cwd, example, packageJson);
}

async function verifyConfigurationContract(cwd, example, packageJson) {
  if (!packageJson.scripts?.build && !packageJson.scripts?.typecheck) {
    throw new Error(`${example.id} must expose a build or typecheck script.`);
  }
  if (example.skippedLiveReason.startsWith("Requires provider")) {
    await assertExists(
      join(cwd, ".env.example"),
      `${example.id} must document its required credentials in .env.example`
    );
    await assertExists(
      join(cwd, "README.md"),
      `${example.id} must document credential setup in README.md`
    );
  }
}

async function verifyWithClient(cwd, example, packageJson) {
  if (!packageJson.scripts?.start) {
    throw new Error(
      `${example.id} must expose a start script for client verification.`
    );
  }
  const port = await freePort();
  const logPath = join(artifactRoot, `${example.id.replaceAll("/", "-")}.log`);
  const server = startExample(cwd, example, port, logPath);
  const origin = `http://127.0.0.1:${port}`;
  const websitePort =
    example.launch === "nextjs-standalone" ? await freePort() : undefined;
  const website = websitePort
    ? startPackageScript(
        cwd,
        "next:start",
        websitePort,
        join(artifactRoot, `${example.id}-website.log`)
      )
    : undefined;
  const websiteOrigin = websitePort
    ? `http://127.0.0.1:${websitePort}`
    : origin;
  const url = `${origin}${example.endpoint ?? "/mcp"}`;
  let client;
  const ignoreExpectedTransportClose = (error) => {
    if (
      error &&
      typeof error === "object" &&
      error.code === "CONNECTION_CLOSED"
    ) {
      return;
    }
    throw error;
  };
  try {
    client = new MCPClient({
      mcpServers: {
        example: {
          url,
          protocolNegotiation: "modern",
          headers: example.headers,
        },
      },
    });
    const connection = await retry(
      () => client.createSession("example"),
      15_000
    );
    await assertConnection(connection, example, origin, websiteOrigin);
  } finally {
    // A server we terminate during cleanup may close its transport first.
    // The example result has already been recorded, so preserve that outcome.
    process.on("uncaughtException", ignoreExpectedTransportClose);
    await client?.closeAllSessions().catch(() => undefined);
    await stop(server);
    if (website) await stop(website);
    process.off("uncaughtException", ignoreExpectedTransportClose);
  }
}

async function assertConnection(connection, example, origin, websiteOrigin) {
  // `info` proves initialize completed through mcp-use's normal negotiation.
  if (!connection.info.server?.name || !connection.info.protocolVersion) {
    throw new Error("Client completed initialization without server metadata.");
  }
  await assertNamed(() => connection.listTools(), example.tools, "tool");
  await assertNamed(
    () => connection.listResources(),
    example.resources,
    "resource"
  );
  await assertNamed(
    () => connection.listResourceTemplates(),
    example.resourceTemplates,
    "resource template"
  );
  await assertNamed(() => connection.listPrompts(), example.prompts, "prompt");

  if (example.view) {
    const tools = await connection.listTools();
    const viewTool = tools.find((tool) => tool._meta?.ui?.resourceUri);
    if (!viewTool)
      throw new Error(
        "Expected at least one tool with an MCP App resource URI."
      );
    const resource = await connection.readResource(
      String(viewTool._meta.ui.resourceUri)
    );
    if (!resource.contents?.length)
      throw new Error("The view resource did not return content.");
    const document = resource.contents
      .map((content) => content.text ?? "")
      .join("\n");
    const entry = document.match(/<script type="module" src="([^"]+)"/i)?.[1];
    if (!entry)
      throw new Error(
        "The MCP App document did not reference a generated view entry."
      );
    const entryResponse = await fetch(new URL(entry, origin));
    if (!entryResponse.ok || !(await entryResponse.text()).trim()) {
      throw new Error("The generated MCP App entry could not be loaded.");
    }
  }

  if (example.landing) {
    const response = await fetch(`${origin}${example.endpoint ?? "/mcp"}`, {
      headers: { accept: "text/html" },
    });
    const body = await response.text();
    if (
      !response.ok ||
      !/text\/html/i.test(response.headers.get("content-type") ?? "") ||
      !body.includes("greet") ||
      !body.includes(example.endpoint ?? "/mcp")
    ) {
      throw new Error("Expected the public landing route to return HTML.");
    }
  }
  if (example.launch === "nextjs-standalone") {
    await retry(async () => {
      const response = await fetch(websiteOrigin);
      const body = await response.text();
      if (
        !response.ok ||
        !body.includes("Next.js + standalone mcp-use") ||
        !body.includes("Shared service ready")
      ) {
        throw new Error(
          "Standalone Next.js landing page did not render the shared service and component."
        );
      }
      return true;
    }, 15_000);
  }
  await assertScenario(connection, example, origin);
}

async function assertScenario(connection, example, origin) {
  const text = (result) =>
    result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n") ?? "";
  switch (example.scenario) {
    case "basic": {
      const result = await connection.callTool("greet", { name: "Ada" });
      if (!text(result).includes("Ada"))
        throw new Error("greet did not include Ada in its response.");
      const resource = await connection.readResource("example://about");
      if (!resource.contents?.length)
        throw new Error("example://about returned no contents.");
      const prompt = await connection.getPrompt("introduce", { name: "Ada" });
      if (!prompt.messages?.length)
        throw new Error("introduce returned no messages.");
      return;
    }
    case "middleware": {
      const deniedClient = new MCPClient({
        mcpServers: {
          denied: {
            url: `${origin}${example.endpoint ?? "/mcp"}`,
            protocolNegotiation: "modern",
          },
        },
      });
      try {
        const deniedConnection = await retry(
          () => deniedClient.createSession("denied"),
          15_000
        );
        await deniedConnection.listTools().then(
          () => {
            throw new Error(
              "Expected tools/list without the access header to fail."
            );
          },
          (error) => {
            if (!String(error).includes("x-example-access")) throw error;
          }
        );
      } finally {
        await deniedClient.closeAllSessions().catch(() => undefined);
      }
      const result = await connection.callTool("echo", { message: "Hi" });
      if (!text(result).includes("middleware"))
        throw new Error("echo response did not prove middleware execution.");
      return;
    }
    case "sampling": {
      const result = await connection.callTool("explain-sampling", {
        task: "summarize",
      });
      if (result.structuredContent?.supported !== false)
        throw new Error(
          "sampling example did not return its unsupported-client guidance."
        );
      return;
    }
    case "sessionless-lifecycle": {
      const result = await connection.callTool("request-info", {});
      if (
        result.structuredContent?.aborted !== false ||
        typeof result.structuredContent?.supportsViews !== "boolean"
      ) {
        throw new Error(
          "request-info did not report the expected request lifecycle state."
        );
      }
      return;
    }
    case "security": {
      const rejected = await rawRequest(origin, "/mcp", {
        Host: "evil.example",
        Origin: "https://evil.example",
      });
      if (rejected !== 403)
        throw new Error(
          `Expected evil Host/Origin to be rejected with 403, received ${rejected}.`
        );
      return;
    }
    case "nextjs": {
      const landing = await fetch(origin);
      const landingHtml = await landing.text();
      if (
        !landing.ok ||
        !landingHtml.includes("Next.js + mcp-use") ||
        !landingHtml.includes("MCP view ready")
      ) {
        throw new Error(
          "Embedded Next.js landing did not render the shared card."
        );
      }
      const preflight = await fetch(`${origin}/api/mcp`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3002" },
      });
      if (
        preflight.status !== 204 ||
        preflight.headers.get("access-control-allow-origin") !== "*"
      ) {
        throw new Error("Embedded Next.js MCP route failed CORS preflight.");
      }
      const result = await connection.callTool("greet", { name: "Ada" });
      if (!text(result).includes("Ada"))
        throw new Error("Next.js greet did not include Ada.");
      const view = await connection.readResource(
        "ui://views/next-status-card.html"
      );
      const document =
        view.contents?.map((content) => content.text ?? "").join("\n") ?? "";
      if (
        !document.includes(
          "/_mcp-use/views/next-status-card/assets/next-status-card-"
        )
      ) {
        throw new Error(
          "Next.js MCP view did not reference its generated view entry."
        );
      }
      const asset = await fetch(
        `${origin}/api/mcp/_mcp-use/public/next-mark.svg`
      );
      if (
        !asset.ok ||
        !/image\/svg\+xml/i.test(asset.headers.get("content-type") ?? "")
      ) {
        throw new Error("Next.js public view asset was not served as SVG.");
      }
      if (asset.headers.get("access-control-allow-origin") !== "*") {
        throw new Error(
          "Next.js public view asset did not allow cross-origin MCP hosts."
        );
      }
      return;
    }
    case "nextjs-standalone": {
      const result = await connection.callTool("project-status", {});
      if (!text(result).includes("shared project service")) {
        throw new Error(
          "Standalone Next.js tool did not call the shared project service."
        );
      }
      if (result.structuredContent?.title !== "Shared service ready") {
        throw new Error(
          "Standalone Next.js tool did not return its structured view data."
        );
      }
      return;
    }
    case "events": {
      await connection.listTools();
      await connection.callTool("ping", {});
      const result = await connection.callTool("recent-events", {});
      if (
        !text(result).includes("tools/list:before") ||
        !text(result).includes("request-id:example-verifier") ||
        !text(result).includes("tools/list:complete")
      ) {
        throw new Error(
          "event observations did not record both tools/list phases and the request header."
        );
      }
      return;
    }
    case "notifications": {
      const notifications = [];
      connection.on("notification", (notification) =>
        notifications.push(notification.method)
      );
      await connection.callTool("publish-changes", {});
      await retry(async () => {
        // The V2 wire does not negotiate resources/subscribe, so an updated
        // notification has no subscription recipient here. Verify the two
        // supported list-change notifications and the refreshed resource.
        const expected = [
          "notifications/tools/list_changed",
          "notifications/resources/list_changed",
        ];
        if (!expected.every((method) => notifications.includes(method))) {
          throw new Error(
            `Expected change notifications, received: ${notifications.join(", ") || "none"}`
          );
        }
        return true;
      }, 2_000);
      const resource = await connection.readResource("example://status");
      if (
        !resource.contents?.some((content) =>
          content.text?.includes('"revision":1')
        )
      ) {
        throw new Error("status resource did not advance to revision 1.");
      }
      return;
    }
    default:
      return;
  }
}

async function assertNamed(request, expected, kind) {
  if (!expected?.length) return;
  const response = await request();
  const values = Array.isArray(response)
    ? response
    : (response.tools ??
      response.resources ??
      response.resourceTemplates ??
      response.prompts ??
      []);
  const names = new Set(
    values.map((value) => (kind === "resource" ? value.uri : value.name))
  );
  for (const name of expected) {
    if (!names.has(name))
      throw new Error(
        `Expected ${kind} '${name}', received: ${[...names].join(", ") || "none"}`
      );
  }
}

function startExample(cwd, example, port, logPath) {
  // Each example reads PORT from its environment. Passing flags through
  // `pnpm run` would leave a literal `--` in the mcp-use CLI arguments.
  const args = ["run", "start"];
  const child = spawn(packageManager, args, {
    cwd,
    env: { ...exampleEnv, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    // Package managers launch the actual server as a child process. Give each
    // example its own group so cleanup reaches Next/mcp-use, not only npm/pnpm.
    detached: process.platform !== "win32",
  });
  child.mcpUseProcessGroup = process.platform !== "win32";
  const log = [];
  child.stdout.on("data", (chunk) => log.push(chunk));
  child.stderr.on("data", (chunk) => log.push(chunk));
  child.once("exit", () => writeFile(logPath, Buffer.concat(log)));
  return child;
}

function startPackageScript(cwd, script, port, logPath) {
  const child = spawn(packageManager, ["run", script], {
    cwd,
    env: { ...exampleEnv, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.mcpUseProcessGroup = process.platform !== "win32";
  const log = [];
  child.stdout.on("data", (chunk) => log.push(chunk));
  child.stderr.on("data", (chunk) => log.push(chunk));
  child.once("exit", () => writeFile(logPath, Buffer.concat(log)));
  return child;
}

async function runPackageScript(cwd, packageJson, script, id) {
  if (!packageJson.scripts?.[script]) return;
  const logPath = join(
    artifactRoot,
    `${id.replaceAll("/", "-")}-${script}.log`
  );
  await run(packageManager, ["run", script], cwd, logPath);
}

async function run(command, args, cwd, logPath) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: exampleEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.once("error", reject);
    child.once("exit", async (code) => {
      await writeFile(logPath, Buffer.concat(output));
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              `${command} ${args.join(" ")} exited with ${code}; see ${logPath}`
            )
          );
    });
  });
}

async function stop(child) {
  signalChildTree(child, "SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  signalChildTree(child, "SIGKILL");
}

function signalChildTree(child, signal) {
  try {
    if (child.mcpUseProcessGroup && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else if (child.exitCode === null) {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function retry(action, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw lastError ?? new Error("Timed out waiting for example server.");
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) =>
        error ? reject(error) : resolvePromise(address.port)
      );
    });
  });
}

async function rawRequest(origin, path, headers) {
  const url = new URL(path, origin);
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolvePromise(response.statusCode));
      }
    );
    request.once("error", reject);
    request.end();
  });
}

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
