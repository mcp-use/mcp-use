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
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
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
    // Malformed URLs exercise fetch's native error/cause without opening a socket.
    if (String(input).startsWith("not a url")) return nativeFetch(input, init);
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("screenshot URL error classification", () => {
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
