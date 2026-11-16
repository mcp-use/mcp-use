import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserCandidates } from "../../src/client/screenshot.js";

const mocks = vi.hoisted(() => ({
  loadClientPackage: vi.fn(),
}));

vi.mock("../../src/client/load-client.js", () => ({
  loadClientPackage: mocks.loadClientPackage,
}));

const hasBrowser = browserCandidates(process.platform, process.env).some(
  (candidate) => existsSync(candidate)
);

const viewTool = {
  name: "show_app",
  _meta: { ui: { resourceUri: "ui://widget/app.html" } },
};

const connection = {
  authorization: undefined,
  callTool: vi.fn(),
  discoverAuthorization: vi.fn(),
  disconnect: vi.fn(),
  listTools: vi.fn(),
  readResource: vi.fn(),
};

// The real Inspector serves the View's sandbox from its other loopback
// origin, and the sandbox renders the widget in a same-origin srcdoc iframe.
const widget = '<div class="tracker-table">Applications</div>';
const sandboxPage = `<!doctype html><body><script>
  const inner = document.createElement("iframe");
  inner.srcdoc = ${JSON.stringify(widget)};
  document.body.appendChild(inner);
</script></body>`;

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, host, () =>
      resolve((server.address() as AddressInfo).port)
    );
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

let workDirectory: string;
let inspector: Server;
let sandbox: Server;
let inspectorOrigin: string;
let runScreenshot: (argv: readonly string[]) => Promise<number>;
let stderr = "";

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  workDirectory = await mkdtemp(join(tmpdir(), "mcp-use-screenshot-"));

  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  sandbox = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(sandboxPage);
  });
  const sandboxPort = await listen(sandbox, "localhost");

  inspector = createServer((request, response) => {
    if (request.url === "/inspector/health") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          status: "ok",
          protocol: "mcp-use-inspector-preview",
          version: 1,
          capabilities: ["view-preview"],
        })
      );
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><body data-view-ready="true">` +
        `<iframe src="http://localhost:${sandboxPort}/sandbox"></iframe></body>`
    );
  });
  inspectorOrigin = `http://127.0.0.1:${await listen(inspector, "127.0.0.1")}`;

  connection.discoverAuthorization.mockResolvedValue(undefined);
  connection.disconnect.mockResolvedValue(undefined);
  connection.listTools.mockResolvedValue([viewTool]);
  connection.callTool.mockResolvedValue({ content: [] });
  connection.readResource.mockResolvedValue({
    contents: [{ uri: "ui://widget/app.html", text: widget }],
  });
  mocks.loadClientPackage.mockResolvedValue({
    logger: { level: "info" },
    MCPClient: class {
      async connect(): Promise<typeof connection> {
        return connection;
      }
    },
  });

  ({ runScreenshot } = await import("../../src/client/screenshot.js"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close(inspector);
  await close(sandbox);
  await rm(workDirectory, { recursive: true, force: true });
});

function screenshotArgs(selector: string, output: string): string[] {
  return [
    "--mcp",
    "https://mcp.example.com/mcp",
    "--tool",
    "show_app",
    "--inspector",
    inspectorOrigin,
    "--wait-for",
    selector,
    "--timeout",
    "10000",
    "--output",
    output,
    "--json",
  ];
}

describe.skipIf(!hasBrowser)("screenshot --wait-for", () => {
  it("finds a selector inside the View", async () => {
    const output = join(workDirectory, "view.png");

    await expect(
      runScreenshot(screenshotArgs(".tracker-table", output))
    ).resolves.toBe(0);

    expect(stderr).toBe("");
    const png = await readFile(output);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 30_000);

  it("times out when the selector is in neither the page nor the View", async () => {
    const output = join(workDirectory, "view.png");

    await expect(
      runScreenshot(screenshotArgs(".not-rendered", output))
    ).resolves.toBe(1);

    expect(JSON.parse(stderr).error.code).toBe("browser_timeout");
    expect(existsSync(output)).toBe(false);
  }, 30_000);
});
