import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadClientPackage: vi.fn(),
}));

vi.mock("../../src/client/load-client.js", () => ({
  loadClientPackage: mocks.loadClientPackage,
}));

// A view-backed tool, so the command gets as far as calling it.
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

let homeDirectory: string;
let runScreenshot: (argv: readonly string[]) => Promise<number>;
let stdout = "";
let stderr = "";

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  homeDirectory = await mkdtemp(join(tmpdir(), "mcp-use-screenshot-"));
  vi.stubEnv("HOME", homeDirectory);
  vi.stubEnv("USERPROFILE", homeDirectory);

  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  connection.discoverAuthorization.mockResolvedValue(undefined);
  connection.disconnect.mockResolvedValue(undefined);
  connection.listTools.mockResolvedValue([viewTool]);
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
  await rm(homeDirectory, { recursive: true, force: true });
});

const screenshotArgs = [
  "--mcp",
  "https://mcp.example.com/mcp",
  "--tool",
  "show_app",
];

describe("screenshot when the tool fails", () => {
  it("prints the tool's error text", async () => {
    connection.callTool.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Database unavailable" },
        { type: "image", data: "aGk=", mimeType: "image/png" },
        { type: "text", text: "    at load (db.js:3:5)\n" },
      ],
      isError: true,
    });

    await expect(runScreenshot(screenshotArgs)).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(stderr).toBe(
      "Tool show_app returned an error:\n" +
        "Database unavailable\n" +
        "    at load (db.js:3:5)\n"
    );
    expect(connection.readResource).not.toHaveBeenCalled();
  });

  it("reports a failed tool that returns no text", async () => {
    connection.callTool.mockResolvedValueOnce({
      content: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
      isError: true,
    });

    await expect(runScreenshot(screenshotArgs)).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(stderr).toBe("Tool show_app returned an error.\n");
  });

  it("keeps the JSON error unchanged", async () => {
    const result = {
      content: [{ type: "text", text: "Database unavailable" }],
      isError: true,
    };
    connection.callTool.mockResolvedValueOnce(result);

    await expect(runScreenshot([...screenshotArgs, "--json"])).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: "tool_failed",
        message: "Tool show_app returned an error.",
        details: result,
      },
    });
  });
});
