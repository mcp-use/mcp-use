import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTHORIZATION_URL = "https://auth.example.com/authorize?state=test";

const mocks = vi.hoisted(() => ({
  closePrompt: vi.fn(),
  config: undefined as
    | { mcpServers: Record<string, { authProvider?: unknown }> }
    | undefined,
  createInterface: vi.fn(),
  loadClientPackage: vi.fn(),
  openBrowser: vi.fn(),
  question: vi.fn(),
  triggerOAuth: false,
}));

vi.mock("node:readline/promises", () => ({
  createInterface: mocks.createInterface,
}));

vi.mock("../../src/commands/load-client.js", () => ({
  loadClientPackage: mocks.loadClientPackage,
}));

vi.mock("../../src/commands/shared.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commands/shared.js")>();
  return { ...actual, openBrowser: mocks.openBrowser };
});

const connection = {
  callTool: vi.fn(),
  disconnect: vi.fn(),
  getPrompt: vi.fn(),
  listPrompts: vi.fn(),
  listResources: vi.fn(),
  listTools: vi.fn(),
  readResource: vi.fn(),
};

let homeDirectory: string;
let runClient: (argv: readonly string[]) => Promise<number>;
let stdout = "";
let stderr = "";
let stdinTtyDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  mocks.config = undefined;
  mocks.triggerOAuth = false;
  homeDirectory = await mkdtemp(join(tmpdir(), "mcp-use-client-"));
  vi.stubEnv("HOME", homeDirectory);
  stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  setStdinTty(false);

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

  connection.callTool.mockResolvedValue({
    content: [{ type: "text", text: "called" }],
  });
  connection.disconnect.mockResolvedValue(undefined);
  connection.getPrompt.mockResolvedValue({
    messages: [{ role: "user", content: { type: "text", text: "Hello, Ada" } }],
  });
  connection.listPrompts.mockResolvedValue([{ name: "hello" }]);
  connection.listResources.mockResolvedValue([{ uri: "file:///notes.txt" }]);
  connection.listTools.mockResolvedValue([
    { name: "echo", description: "Echo input" },
  ]);
  connection.readResource.mockResolvedValue({
    contents: [{ uri: "file:///notes.txt", text: "notes" }],
  });

  mocks.question.mockResolvedValue("");
  mocks.createInterface.mockReturnValue({
    close: mocks.closePrompt,
    question: mocks.question,
  });
  mocks.loadClientPackage.mockResolvedValue({
    createOAuthProvider: async (
      _url: string,
      options: { openBrowser: (url: string) => Promise<void> }
    ) => ({ options }),
    MCPClient: class {
      constructor(config: {
        mcpServers: Record<string, { authProvider?: unknown }>;
      }) {
        mocks.config = config;
      }

      async connect(name: string): Promise<typeof connection> {
        const provider = mocks.config?.mcpServers[name]?.authProvider as
          | { options: { openBrowser: (url: string) => Promise<void> } }
          | undefined;
        if (mocks.triggerOAuth && provider !== undefined) {
          await provider.options.openBrowser(AUTHORIZATION_URL);
        }
        return connection;
      }
    },
  });

  ({ runClient } = await import("../../src/commands/client.js"));
});

afterEach(async () => {
  if (stdinTtyDescriptor === undefined) {
    Reflect.deleteProperty(process.stdin, "isTTY");
  } else {
    Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(homeDirectory, { recursive: true, force: true });
});

describe("client JSON output", () => {
  it("accepts --json throughout every data-returning command", async () => {
    await expect(
      runClient([
        "connect",
        "demo",
        "https://mcp.example.com/mcp",
        "--no-oauth",
      ])
    ).resolves.toBe(0);

    const cases: Array<{ argv: string[]; expected: unknown }> = [
      {
        argv: ["--json", "list"],
        expected: [
          {
            name: "demo",
            oauth: false,
            protocol: "auto",
            url: "https://mcp.example.com/mcp",
          },
        ],
      },
      {
        argv: ["demo", "--json", "tools", "list"],
        expected: [{ name: "echo", description: "Echo input" }],
      },
      {
        argv: ["demo", "tools", "--json", "describe", "echo"],
        expected: { name: "echo", description: "Echo input" },
      },
      {
        argv: ["demo", "tools", "call", "echo", '{"value":1}', "--json"],
        expected: { content: [{ type: "text", text: "called" }] },
      },
      {
        argv: ["demo", "resources", "list", "--json"],
        expected: [{ uri: "file:///notes.txt" }],
      },
      {
        argv: ["demo", "resources", "--json", "read", "file:///notes.txt"],
        expected: {
          contents: [{ uri: "file:///notes.txt", text: "notes" }],
        },
      },
      {
        argv: ["demo", "prompts", "list", "--json"],
        expected: [{ name: "hello" }],
      },
      {
        argv: ["demo", "prompts", "get", "--json", "hello", "name=Ada"],
        expected: {
          messages: [
            {
              role: "user",
              content: { type: "text", text: "Hello, Ada" },
            },
          ],
        },
      },
      {
        argv: ["--json", "demo", "auth", "status"],
        expected: { name: "demo", oauth: false, authenticated: false },
      },
      {
        argv: ["demo", "auth", "logout", "--yes", "--json"],
        expected: { loggedOut: "demo" },
      },
    ];

    for (const testCase of cases) {
      stdout = "";
      stderr = "";
      await expect(runClient(testCase.argv)).resolves.toBe(0);
      expect(stdout.endsWith("\n")).toBe(true);
      expect(stdout.match(/\n/g)).toHaveLength(1);
      expect(JSON.parse(stdout)).toEqual(testCase.expected);
      expect(stderr).toBe("");
    }
  });

  it("emits one JSON error envelope without stdout", async () => {
    await runClient([
      "connect",
      "demo",
      "https://mcp.example.com/mcp",
      "--no-oauth",
    ]);
    stdout = "";
    stderr = "";

    await expect(
      runClient(["demo", "tools", "describe", "missing", "--json"])
    ).resolves.toBe(2);

    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      error: { code: "usage_error", message: "Tool not found: missing" },
    });
    expect(stderr.match(/\n/g)).toHaveLength(1);
  });

  it("retains a failed tool result in JSON error details", async () => {
    await runClient([
      "connect",
      "demo",
      "https://mcp.example.com/mcp",
      "--no-oauth",
    ]);
    const result = {
      content: [{ type: "text", text: "bad input" }],
      isError: true,
    };
    connection.callTool.mockResolvedValueOnce(result);
    stdout = "";
    stderr = "";

    await expect(
      runClient(["--json", "demo", "tools", "call", "echo"])
    ).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: "tool_error",
        message: "Tool echo returned an error.",
        details: result,
      },
    });
  });
});

describe("client human-readable output", () => {
  it("separates tool names and descriptions with a hyphen", async () => {
    await expect(
      runClient([
        "connect",
        "human-output",
        "https://mcp.example.com/mcp",
        "--no-oauth",
      ])
    ).resolves.toBe(0);
    stdout = "";

    await expect(runClient(["human-output", "tools", "list"])).resolves.toBe(0);

    expect(stdout).toBe("echo - Echo input\n");
    expect(stderr).toBe("");
  });

  it("rejects --json for remove in every position", async () => {
    await expect(
      runClient([
        "connect",
        "remove-json",
        "https://mcp.example.com/mcp",
        "--no-oauth",
      ])
    ).resolves.toBe(0);

    for (const argv of [
      ["--json", "remove", "remove-json", "--yes"],
      ["remove", "--json", "remove-json", "--yes"],
      ["remove", "remove-json", "--yes", "--json"],
    ]) {
      stdout = "";
      stderr = "";

      await expect(runClient(argv)).resolves.toBe(2);

      expect(stdout).toBe("");
      expect(stderr).toBe("mcp-use client remove does not support --json.\n");
    }

    stdout = "";
    stderr = "";
    await expect(runClient(["list", "--json"])).resolves.toBe(0);
    expect(JSON.parse(stdout)).toContainEqual({
      name: "remove-json",
      oauth: false,
      protocol: "auto",
      url: "https://mcp.example.com/mcp",
    });
    expect(stderr).toBe("");
  });
});

describe("client OAuth browser UX", () => {
  it("waits for Enter before opening a browser in an interactive TTY", async () => {
    setStdinTty(true);
    mocks.triggerOAuth = true;

    await expect(
      runClient(["connect", "oauth", "https://mcp.example.com/mcp"])
    ).resolves.toBe(0);

    expect(mocks.question).toHaveBeenCalledOnce();
    expect(mocks.question).toHaveBeenCalledWith(
      "This server requires OAuth. Press Enter to open your browser."
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(AUTHORIZATION_URL);
    expect(mocks.question.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openBrowser.mock.invocationCallOrder[0]!
    );
    expect(stderr).toBe("");
  });

  it.each([
    { label: "non-TTY", tty: false, before: [], after: [] },
    { label: "--no-open", tty: true, before: [], after: ["--no-open"] },
    { label: "--json", tty: true, before: ["--json"], after: [] },
  ])(
    "prints the URL without prompting or opening under $label",
    async (mode) => {
      setStdinTty(mode.tty);
      mocks.triggerOAuth = true;

      await expect(
        runClient([
          ...mode.before,
          "connect",
          `oauth-${mode.label.replace(/[^a-z]/gi, "")}`,
          "https://mcp.example.com/mcp",
          ...mode.after,
        ])
      ).resolves.toBe(0);

      expect(mocks.question).not.toHaveBeenCalled();
      expect(mocks.openBrowser).not.toHaveBeenCalled();
      expect(stderr).toBe(
        `Open this URL to authenticate:\n${AUTHORIZATION_URL}\n`
      );
      if (mode.label === "--json") {
        expect(JSON.parse(stdout)).toMatchObject({
          protocol: "auto",
          url: "https://mcp.example.com/mcp",
        });
        expect(stdout.match(/\n/g)).toHaveLength(1);
      }
    }
  );
});

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}
