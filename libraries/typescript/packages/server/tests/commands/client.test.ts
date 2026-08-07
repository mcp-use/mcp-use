import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTHORIZATION_LAUNCHER_URL = "http://127.0.0.1:33418/authorize";

let homeDirectory: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => homeDirectory || actual.homedir(),
  };
});

const mocks = vi.hoisted(() => ({
  closePrompt: vi.fn(),
  connectCall: vi.fn(),
  connectError: undefined as unknown,
  config: undefined as
    | {
        mcpServers: Record<
          string,
          {
            authProvider?: unknown;
            clientOptions?: { supportedProtocolVersions?: string[] };
            protocolNegotiation?: "auto" | "legacy" | { pin: "2026-07-28" };
            url?: string;
            command?: string;
            args?: string[];
          }
        >;
      }
    | undefined,
  createInterface: vi.fn(),
  loadClientPackage: vi.fn(),
  logger: { level: "info" },
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

let runClient: (argv: readonly string[]) => Promise<number>;
let stdout = "";
let stderr = "";
let stdinTtyDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  mocks.config = undefined;
  mocks.connectError = undefined;
  mocks.connectCall.mockReset();
  mocks.triggerOAuth = false;
  mocks.logger.level = "info";
  homeDirectory = await mkdtemp(join(tmpdir(), "mcp-use-client-"));
  vi.stubEnv("HOME", homeDirectory);
  vi.stubEnv("USERPROFILE", homeDirectory);
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
    logger: mocks.logger,
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
        mocks.connectCall(name);
        if (mocks.connectError !== undefined) throw mocks.connectError;
        const provider = mocks.config?.mcpServers[name]?.authProvider as
          | { options: { openBrowser: (url: string) => Promise<void> } }
          | undefined;
        if (mocks.triggerOAuth && provider !== undefined) {
          await provider.options.openBrowser(AUTHORIZATION_LAUNCHER_URL);
          if (mocks.logger.level === "silent") {
            await new Promise<never>(() => {});
          }
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
  it("redacts URL credentials, query values, and fragments from results", async () => {
    const rawUrl =
      "https://user-secret:password-secret@mcp.example.com/mcp?token=query-secret#fragment-secret";

    await expect(
      runClient(["connect", "signed-url", rawUrl, "--no-oauth", "--json"])
    ).resolves.toBe(0);

    expect(stdout).not.toContain("user-secret");
    expect(stdout).not.toContain("password-secret");
    expect(stdout).not.toContain("query-secret");
    expect(stdout).not.toContain("fragment-secret");
    expect(JSON.parse(stdout)).toMatchObject({
      name: "signed-url",
      url: expect.stringContaining("REDACTED"),
    });
    expect(mocks.config?.mcpServers["signed-url"]).toMatchObject({
      url: rawUrl,
    });

    stdout = "";
    await expect(runClient(["list", "--json"])).resolves.toBe(0);
    expect(stdout).not.toContain("user-secret");
    expect(stdout).not.toContain("password-secret");
    expect(stdout).not.toContain("query-secret");
    expect(stdout).not.toContain("fragment-secret");
  });

  it("preserves quoted stdio command paths and arguments when saving", async () => {
    await expect(
      runClient([
        "connect",
        "local",
        '"/opt/MCP Servers/server" "--config=dev env.json"',
        "--stdio",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(JSON.parse(stdout)).toEqual({
      name: "local",
      type: "stdio",
      command: "/opt/MCP Servers/server",
      args: ["--config=dev env.json"],
      protocol: "auto",
    });
    expect(mocks.config?.mcpServers.local).toEqual({
      command: "/opt/MCP Servers/server",
      args: ["--config=dev env.json"],
      protocolNegotiation: "auto",
    });
    expect(mocks.connectCall).toHaveBeenCalledWith("local");

    const { getGlobalStateDir } = await import("../../src/commands/shared.js");
    const saved = JSON.parse(
      await readFile(join(getGlobalStateDir(), "client", "servers.json"), {
        encoding: "utf8",
      })
    ) as {
      servers: Record<
        string,
        { type: string; command: string; args: string[] }
      >;
    };
    expect(saved.servers.local).toMatchObject({
      type: "stdio",
      command: "/opt/MCP Servers/server",
      args: ["--config=dev env.json"],
    });
  });

  it("returns structured OAuth recovery without URL, state, logs, or browser", async () => {
    mocks.triggerOAuth = true;

    await expect(
      runClient([
        "connect",
        "oauth-json",
        "https://mcp.example.com/mcp",
        "--json",
      ])
    ).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(stderr.trim().split("\n")).toHaveLength(1);
    expect(stderr).not.toContain(AUTHORIZATION_LAUNCHER_URL);
    expect(stderr).not.toContain("state=test");
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: "oauth_interaction_required",
        message:
          "OAuth interaction is required; retry this command without --json in a terminal.",
        details: {
          server: "oauth-json",
          nextSteps: [
            {
              description: "Authenticate interactively in a terminal",
              command: "mcp-use client connect oauth-json <url> --no-open",
            },
          ],
        },
      },
    });
    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(mocks.logger.level).toBe("silent");
    expect(mocks.loadClientPackage).toHaveBeenCalledWith({
      allowInstall: false,
    });
  });

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
            type: "http",
            oauth: false,
            protocol: "auto",
            url: "https://mcp.example.com/mcp",
            target: "https://mcp.example.com/mcp",
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

  it("redacts static headers and signed URL components from connection errors", async () => {
    const headerSecret = "header-token-secret";
    const querySecret = "query-token-secret";
    mocks.connectError = new Error(
      `Rejected Bearer ${headerSecret} while fetching https://mcp.example.com/mcp?token=${querySecret}`
    );

    await expect(
      runClient([
        "connect",
        "secret-error",
        `https://mcp.example.com/mcp?token=${querySecret}`,
        "--no-oauth",
        "-H",
        `Authorization: Bearer ${headerSecret}`,
        "--json",
      ])
    ).resolves.toBe(1);

    expect(stdout).toBe("");
    expect(stderr).not.toContain(headerSecret);
    expect(stderr).not.toContain(querySecret);
    expect(JSON.parse(stderr)).toMatchObject({
      error: {
        code: "command_failed",
        message: expect.stringContaining("[REDACTED]"),
      },
    });
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

  it("removes without confirmation and supports JSON anywhere", async () => {
    await expect(
      runClient([
        "connect",
        "remove-json",
        "https://mcp.example.com/mcp",
        "--no-oauth",
      ])
    ).resolves.toBe(0);
    stdout = "";

    await expect(runClient(["remove", "remove-json", "--json"])).resolves.toBe(
      0
    );
    expect(JSON.parse(stdout)).toEqual({ removed: "remove-json" });
    expect(stderr).toBe("");

    await runClient([
      "connect",
      "remove-flags",
      "https://mcp.example.com/mcp",
      "--no-oauth",
    ]);

    for (const argv of [
      ["--json", "remove", "remove-flags"],
      ["remove", "--json", "remove-flags"],
      ["remove", "remove-flags", "--json"],
    ]) {
      stdout = "";
      stderr = "";

      await expect(runClient(argv)).resolves.toBe(0);

      expect(JSON.parse(stdout)).toEqual({ removed: "remove-flags" });
      expect(stderr).toBe("");
      await runClient([
        "connect",
        "remove-flags",
        "https://mcp.example.com/mcp",
        "--no-oauth",
      ]);
    }

    stdout = "";
    stderr = "";
    await expect(runClient(["remove", "remove-flags", "--yes"])).resolves.toBe(
      2
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown option '--yes'");

    stderr = "";
    await expect(runClient(["list", "--json"])).resolves.toBe(0);
    expect(JSON.parse(stdout)).toContainEqual({
      name: "remove-flags",
      type: "http",
      oauth: false,
      protocol: "auto",
      url: "https://mcp.example.com/mcp",
      target: "https://mcp.example.com/mcp",
    });
    expect(stderr).toBe("");
  });
});

describe("client protocol selection", () => {
  it.each([
    {
      protocol: "auto",
      expected: {
        protocolNegotiation: "auto",
      },
    },
    {
      protocol: "modern",
      expected: {
        protocolNegotiation: { pin: "2026-07-28" },
      },
    },
    {
      protocol: "legacy",
      expected: {
        clientOptions: {
          supportedProtocolVersions: ["2025-11-25"],
        },
        protocolNegotiation: "legacy",
      },
    },
  ] as const)(
    "maps --protocol $protocol to the official SDK negotiation options",
    async ({ protocol, expected }) => {
      await expect(
        runClient([
          "connect",
          `protocol-${protocol}`,
          "https://mcp.example.com/mcp",
          "--no-oauth",
          "--protocol",
          protocol,
        ])
      ).resolves.toBe(0);

      expect(mocks.config?.mcpServers[`protocol-${protocol}`]).toMatchObject(
        expected
      );
    }
  );

  it("advertises only named protocol modes in help and validation errors", async () => {
    await expect(runClient(["connect", "--help"])).resolves.toBe(0);
    expect(stdout).toContain("--protocol <auto|legacy|modern>");
    expect(stdout).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    for (const value of ["2025-11-25", "2026-07-28", "invalid"]) {
      stdout = "";
      stderr = "";
      await expect(
        runClient([
          "connect",
          "invalid-protocol",
          "https://mcp.example.com/mcp",
          "--no-oauth",
          "--protocol",
          value,
        ])
      ).resolves.toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        "Invalid protocol. Expected auto, legacy, or modern.\n"
      );
    }
  });

  it("migrates saved revision values before listing or reconnecting", async () => {
    const { getGlobalStateDir } = await import("../../src/commands/shared.js");
    const clientDirectory = join(getGlobalStateDir(), "client");
    const serversPath = join(clientDirectory, "servers.json");
    await mkdir(clientDirectory, { recursive: true });
    await writeFile(
      serversPath,
      JSON.stringify({
        servers: {
          old: {
            url: "https://old.example.com/mcp",
            oauth: false,
            protocol: "2025-11-25",
          },
          new: {
            url: "https://new.example.com/mcp",
            oauth: false,
            protocol: "2026-07-28",
          },
        },
      })
    );

    await expect(runClient(["list", "--json"])).resolves.toBe(0);
    expect(JSON.parse(stdout)).toEqual([
      {
        name: "old",
        type: "http",
        url: "https://old.example.com/mcp",
        oauth: false,
        protocol: "legacy",
        target: "https://old.example.com/mcp",
      },
      {
        name: "new",
        type: "http",
        url: "https://new.example.com/mcp",
        oauth: false,
        protocol: "modern",
        target: "https://new.example.com/mcp",
      },
    ]);
    expect(await readFile(serversPath, "utf8")).not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
    await rm(clientDirectory, { recursive: true, force: true });
  });

  it.each([
    {
      protocol: "legacy",
      upstream:
        "Unsupported protocol version: 2025-11-25; supported: 2026-07-28",
      message: "Server does not support the requested legacy protocol.",
    },
    {
      protocol: "modern",
      upstream: "The server did not offer pinned protocol version 2026-07-28",
      message:
        "Server does not support the requested modern protocol (stateless/sessionless, no fallback).",
    },
  ] as const)(
    "reports a named mismatch error for strict $protocol mode",
    async ({ protocol, upstream, message }) => {
      mocks.connectError = new Error(upstream);

      await expect(
        runClient([
          "connect",
          `mismatch-${protocol}`,
          "https://mcp.example.com/mcp",
          "--no-oauth",
          "--protocol",
          protocol,
          "--json",
        ])
      ).resolves.toBe(1);

      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toEqual({
        error: { code: "protocol_mismatch", message },
      });
      expect(stderr).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  );
});

describe("client OAuth browser UX", () => {
  it("validates saved command options before connecting or starting OAuth", async () => {
    await runClient([
      "connect",
      "oauth-validation",
      "https://mcp.example.com/mcp",
    ]);
    const callsBefore = mocks.connectCall.mock.calls.length;
    stdout = "";
    stderr = "";
    mocks.triggerOAuth = true;

    await expect(
      runClient(["oauth-validation", "tools", "list", "--no-open"])
    ).resolves.toBe(2);

    expect(mocks.connectCall).toHaveBeenCalledTimes(callsBefore);
    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(stderr).toContain("Unknown option '--no-open'");
  });

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
    expect(mocks.openBrowser).toHaveBeenCalledWith(AUTHORIZATION_LAUNCHER_URL);
    expect(mocks.question.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openBrowser.mock.invocationCallOrder[0]!
    );
    expect(stderr).toBe("");
  });

  it.each([
    { label: "non-TTY", tty: false, before: [], after: [] },
    { label: "--no-open", tty: true, before: [], after: ["--no-open"] },
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
        `Open this URL to authenticate:\n${AUTHORIZATION_LAUNCHER_URL}\n`
      );
    }
  );
});

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}
