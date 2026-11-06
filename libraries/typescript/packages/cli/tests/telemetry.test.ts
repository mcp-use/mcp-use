import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCliUsage } from "../src/telemetry.js";
import { test as cliTest } from "./helpers/cli-test.js";

describe("anonymous CLI analytics", () => {
  let home: string;
  const capture = vi.fn<typeof fetch>();

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-telemetry-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MCP_USE_ANONYMIZED_TELEMETRY", "true");
    vi.stubEnv("DO_NOT_TRACK", "0");
    vi.stubGlobal("__MCP_USE_CLI_VERSION__", "5.0.0");
    vi.stubGlobal("__MCP_USE_POSTHOG_HOST__", "https://capture.invalid");
    vi.stubGlobal("__MCP_USE_POSTHOG_KEY__", "test-project-token");
    capture.mockReset().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", capture);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  function events() {
    return capture.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  }

  it("reuses a private installation ID across commands without loading auth", async () => {
    vi.stubEnv("CI", "true");
    await captureCliUsage(["org", "use", "private-org", "--json"]);
    await captureCliUsage(["dev", "--path", "/private/project"]);
    const [first, second] = events();
    expect(first.distinct_id).toMatch(/^cli:[0-9a-f-]{36}$/);
    expect(second.distinct_id).toBe(first.distinct_id);
    expect(first.properties).toMatchObject({
      command: "org",
      subcommand: "use",
      cli_version: "5.0.0",
      is_ci: true,
      $process_person_profile: false,
      $geoip_disable: true,
    });
    const state = JSON.parse(
      await readFile(join(home, ".mcp-use", "cli-telemetry.json"), "utf8")
    );
    expect(first.distinct_id).toBe(`cli:${state.installationId}`);
    expect(JSON.stringify(events())).not.toMatch(
      /private-org|private\/project/
    );
  });

  it.each([
    [
      [
        "client",
        "secret-server",
        "tools",
        "call",
        "secret-tool",
        "token=secret",
      ],
      "client",
      "tools call",
      false,
    ],
    [
      [
        "client",
        "connect",
        "secret-server",
        "https://private.example?token=secret",
      ],
      "client",
      "connect",
      false,
    ],
    [["alerts", "remove", "secret-rule"], "alerts", "rm", false],
    [["env", "set", "SECRET=secret"], "env", "set", false],
    [
      ["org", "invites", "send", "secret@example.com"],
      "org",
      "invites send",
      false,
    ],
    [
      ["client", "--json", "secret-server", "tools", "list"],
      "client",
      "tools list",
      false,
    ],
    [["skills", "add"], "skills", "install", false],
    [["servers", "--", "list"], "servers", "list", false],
    [["servers", "secret-operation"], "servers", undefined, false],
    [["secret-command"], "unknown", undefined, false],
    [["help", "org", "use"], "org", "use", true],
    [["build", "--help"], "build", undefined, true],
    [["--version"], "version", undefined, false],
    [["dev", "--version"], "version", undefined, false],
    [["build", "-v"], "version", undefined, false],
    [["typecheck", "--", "--version"], "typecheck", undefined, false],
    [["dev", "--port", "invalid", "--version"], "dev", undefined, false],
    [["servers", "get", "--version"], "servers", "get", false],
    [[], "help", undefined, true],
  ] as const)(
    "captures only known command literals for %j",
    async (argv, command, subcommand, help) => {
      await captureCliUsage(argv);
      expect(events()).toHaveLength(1);
      expect(events()[0].properties).toMatchObject({ command, is_help: help });
      expect(events()[0].properties.subcommand).toBe(subcommand);
      expect(JSON.stringify(events())).not.toMatch(/secret|private\.example/);
    }
  );

  it.each([
    ["MCP_USE_ANONYMIZED_TELEMETRY", "false"],
    ["MCP_USE_ANONYMIZED_TELEMETRY", "FALSE"],
    ["MCP_USE_ANONYMIZED_TELEMETRY", "FaLsE"],
    ["DO_NOT_TRACK", "1"],
    ["NODE_ENV", "test"],
  ])("%s=%s prevents network and identity writes", async (name, value) => {
    vi.stubEnv(name, value);
    await captureCliUsage(["dev"]);
    expect(capture).not.toHaveBeenCalled();
    await expect(
      readFile(join(home, ".mcp-use", "cli-telemetry.json"))
    ).rejects.toThrow();
  });

  it("skips capture when identity storage is unavailable", async () => {
    await writeFile(join(home, ".mcp-use"), "not a directory");
    await captureCliUsage(["dev"]);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(["", "{", "null", "{}", '{"installationId":"invalid"}'])(
    "repairs damaged installation state %j and keeps the recovered ID",
    async (contents) => {
      const directory = join(home, ".mcp-use");
      const file = join(directory, "cli-telemetry.json");
      await mkdir(directory);
      await writeFile(file, contents);
      await captureCliUsage(["dev"]);
      await captureCliUsage(["build"]);
      expect(events()).toHaveLength(2);
      expect(events()[0].distinct_id).toMatch(/^cli:[0-9a-f-]{36}$/);
      expect(events()[1].distinct_id).toBe(events()[0].distinct_id);
      expect(JSON.parse(await readFile(file, "utf8")).installationId).toBe(
        events()[0].distinct_id.slice(4)
      );
      expect(await readdir(directory)).toEqual(["cli-telemetry.json"]);
    }
  );

  it("leaves an active repair alone and recovers an abandoned lock", async () => {
    const directory = join(home, ".mcp-use");
    const file = join(directory, "cli-telemetry.json");
    const lock = `${file}.lock`;
    await mkdir(directory);
    await writeFile(file, "{");
    await mkdir(lock);
    await captureCliUsage(["dev"]);
    expect(capture).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe("{");
    const stale = new Date(Date.now() - 120_000);
    await utimes(lock, stale, stale);
    await captureCliUsage(["dev"]);
    expect(events()).toHaveLength(1);
    expect(await readdir(directory)).toEqual(["cli-telemetry.json"]);
  });

  it("silently tolerates offline capture", async () => {
    capture.mockRejectedValue(new Error("offline"));
    await expect(captureCliUsage(["dev"])).resolves.toBeUndefined();
  });

  it("aborts a stalled request within 500 ms, even if fetch ignores abort", async () => {
    vi.useFakeTimers();
    capture.mockImplementation(() => new Promise(() => {}));
    const pending = captureCliUsage(["dev"]);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeUndefined();
    expect(capture.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

cliTest(
  "built bin captures once, persists identity, and flushes before build exits",
  async ({ cli }) => {
    const output = join(cli.cwd, "events.jsonl");
    const preload = join(cli.cwd, "capture.mjs");
    await writeFile(
      preload,
      `
    import { appendFile } from "node:fs/promises";
    globalThis.fetch = async (url, options) => {
      if (url !== "https://eu.i.posthog.com/i/v0/e/") throw new Error("Unexpected network request");
      await new Promise(resolve => setTimeout(resolve, 25));
      await appendFile(${JSON.stringify(output)}, options.body + "\\n");
      return new Response("{}");
    };
  `
    );
    const env = {
      MCP_USE_ANONYMIZED_TELEMETRY: "true",
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    };
    const help = await cli.run(["help", "org", "use"], { env });
    // Build help still takes runBin's explicit-exit path, without loading the
    // build pipeline. Loading those modules on a busy Windows runner can
    // legitimately exhaust the best-effort capture's 500 ms delivery budget.
    const build = await cli.run(["build", "--help"], { env });
    const failed = await cli.run(["unknown-command", "/private/missing.ts"], {
      env,
    });
    expect(help.exitCode).toBe(0);
    expect(build.exitCode).toBe(0);
    expect(build.stdout).toContain("Usage: mcp-use build");
    expect(build.stderr).toBe("");
    expect(failed.exitCode).toBe(2);
    const events = (await readFile(output, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe("mcp_use_cli_command");
    expect(events[0].properties).toMatchObject({
      command: "org",
      subcommand: "use",
      is_help: true,
    });
    expect(events[1].properties).toMatchObject({
      command: "build",
      is_help: true,
    });
    expect(events[0].distinct_id).toBe(events[1].distinct_id);
    expect(events[2].properties).toMatchObject({
      command: "unknown",
      is_help: false,
    });
    expect(events[2].distinct_id).toBe(events[0].distinct_id);
    expect(JSON.stringify(events)).not.toMatch(
      /unknown-command|private|missing\.ts/
    );
    expect(
      events.every(
        (event) => typeof event.api_key === "string" && event.api_key.length > 0
      )
    ).toBe(true);

    // Several real processes repairing the same damaged state must converge
    // on one ID. A contender can skip capture while another owns the lock.
    const identityFile = join(cli.home, ".mcp-use", "cli-telemetry.json");
    await writeFile(identityFile, "{");
    await writeFile(output, "");
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => cli.run(["--version"], { env }))
    );
    expect(concurrent.every((result) => result.exitCode === 0)).toBe(true);
    const recovered = (await readFile(output, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(recovered.length).toBeGreaterThan(0);
    expect(new Set(recovered.map((event) => event.distinct_id)).size).toBe(1);
    const saved = JSON.parse(await readFile(identityFile, "utf8"));
    expect(recovered[0].distinct_id).toBe(`cli:${saved.installationId}`);
  }
);
