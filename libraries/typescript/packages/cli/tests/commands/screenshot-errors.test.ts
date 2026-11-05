import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDirectConnection: vi.fn(),
  openSavedConnection: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  readResource: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../../src/commands/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/commands/client.js")>()),
  openDirectConnection: mocks.openDirectConnection,
  openSavedConnection: mocks.openSavedConnection,
}));

import { runScreenshot } from "../../src/commands/screenshot.js";

const nativeFetch = globalThis.fetch;

beforeEach(() => {
  mocks.openDirectConnection.mockResolvedValue(mocks);
  mocks.openSavedConnection.mockResolvedValue(mocks);
  mocks.listTools.mockResolvedValue([
    { name: "show", _meta: { ui: { resourceUri: "ui://views/show.html" } } },
  ]);
  mocks.callTool.mockResolvedValue({ content: [] });
  mocks.readResource.mockResolvedValue({
    contents: [{ text: "<html></html>" }],
  });
  mocks.disconnect.mockResolvedValue(undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (String(input) === "https://inspector.example.test/inspector/health") {
      return Promise.resolve(
        Response.json({
          status: "ok",
          protocol: "mcp-use-inspector-preview",
          version: 1,
          capabilities: ["view-preview"],
        })
      );
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("screenshot URL error classification", () => {
  it.each([false, true])(
    "reports an Inspector health-check network failure with json=%s",
    async (json) => {
      const requestedPaths: Array<string | undefined> = [];
      const server = createServer((request, response) => {
        requestedPaths.push(request.url);
        response.destroy();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      );
      try {
        const address = server.address();
        if (address === null || typeof address === "string") {
          throw new Error("Expected a TCP test server.");
        }
        vi.mocked(globalThis.fetch).mockImplementation(nativeFetch);
        const stdout = vi
          .spyOn(process.stdout, "write")
          .mockImplementation(() => true);
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);
        const args = [
          "--mcp",
          "https://mcp.example.test/mcp",
          "--tool",
          "show",
          "--inspector",
          `http://127.0.0.1:${address.port}`,
        ];
        if (json) args.push("--json");

        await expect(runScreenshot(args)).resolves.toBe(1);

        expect(requestedPaths).toContain("/inspector/health");
        expect(mocks.disconnect).toHaveBeenCalledOnce();
        expect(stdout).not.toHaveBeenCalled();
        const output = stderr.mock.calls.map(([text]) => text).join("");
        if (json) {
          expect(output.trim().split("\n")).toHaveLength(1);
          expect(JSON.parse(output)).toEqual({
            error: { code: "command_failed", message: "fetch failed" },
          });
        } else {
          expect(output).toBe("fetch failed\n");
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  it.each(["--mcp", "--inspector", "--cdp-url"])(
    "rejects malformed %s before connecting or calling a tool",
    async (option) => {
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const args = [
        "--mcp",
        "https://mcp.example.test/mcp",
        "--tool",
        "show",
        "--inspector",
        "https://inspector.example.test",
        "--json",
      ];
      if (option === "--mcp") args[1] = "not a url";
      else if (option === "--inspector") args[5] = "not a url";
      else args.push(option, "not a url");

      await expect(runScreenshot(args)).resolves.toBe(2);

      expect(mocks.openDirectConnection).not.toHaveBeenCalled();
      expect(mocks.callTool).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(
        JSON.parse(stderr.mock.calls.map(([text]) => text).join(""))
      ).toEqual({
        error: {
          code: "usage_error",
          message: `${option} must be a valid absolute URL.`,
        },
      });
    }
  );

  it("reports a malformed server-provided view URI as an operational failure", async () => {
    mocks.listTools.mockResolvedValue([
      {
        name: "show",
        _meta: { ui: { resourceUri: "invalid remote resource" } },
      },
    ]);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runScreenshot([
        "--mcp",
        "https://mcp.example.test/mcp",
        "--tool",
        "show",
        "--inspector",
        "https://inspector.example.test",
        "--json",
      ])
    ).resolves.toBe(1);

    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(stdout).not.toHaveBeenCalled();
    expect(
      JSON.parse(stderr.mock.calls.map(([text]) => text).join(""))
    ).toMatchObject({
      error: { code: "command_failed" },
    });
  });
});
