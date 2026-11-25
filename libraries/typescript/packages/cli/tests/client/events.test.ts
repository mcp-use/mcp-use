/**
 * `mcp-use client <server> events …` through the built bin (PLAN.md §11.3).
 *
 * Grammar tests run against a saved server on an unroutable port: they must
 * exit 2 before any connection. The end-to-end tests start a real MCPServer
 * (and a deliberately non-conformant server for `check`) as child processes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect } from "vitest";

import { test, type Cli } from "../helpers/cli-test.js";

const FIXTURES = fileURLToPath(
  new URL("../fixtures/client-events/", import.meta.url)
);
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));

async function seedServer(cli: Cli, name: string, url: string): Promise<void> {
  await mkdir(join(cli.home, ".mcp-use", "client"), { recursive: true });
  await writeFile(
    join(cli.home, ".mcp-use", "client", "servers.json"),
    JSON.stringify({
      servers: { [name]: { url, oauth: false, protocol: "auto" } },
    })
  );
}

// Port 9 (discard) on loopback: any connection attempt fails fast, so a test
// that reaches the network would not pass by accident.
const UNREACHABLE = "http://127.0.0.1:9/mcp";

describe("client <server> events grammar", () => {
  test("help lists the events commands", async ({ cli }) => {
    const result = await cli.run(["client", "demo", "events", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: mcp-use client <name> events <command>"
    );
    for (const op of [
      "list",
      "subscribe <event>",
      "unsubscribe <event>",
      "listen <event>",
      "poll <event>",
      "stream <event>",
      "check",
    ]) {
      expect(result.stdout).toContain(`  ${op}`);
    }
  });

  test("check help documents the report formats", async ({ cli }) => {
    const result = await cli.run(["client", "demo", "events", "check", "-h"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--format <text|json|junit>");
  });

  test.for([
    [
      ["events", "subscribe", "note.created"],
      "events subscribe needs --url <callback>: the webhook receiver the server delivers to. Use `events listen` to receive locally.",
    ],
    [
      ["events", "poll", "note.created", "--args", "[1]"],
      "--args must be a JSON object (got [1])",
    ],
    [
      ["events", "listen", "note.created", "--mode", "sse"],
      "--mode must be webhook, push or poll (got sse)",
    ],
    [
      ["events", "listen", "note.created", "--mode", "poll", "--tunnel"],
      "--tunnel only applies to --mode webhook",
    ],
    [
      ["events", "stream", "note.created", "--heartbeat", "soon"],
      "--heartbeat must be a duration such as 30s, 10m or 1h (got soon)",
    ],
    [
      ["events", "check", "--dialect", "mcp"],
      "--dialect for check takes openai and/or sep-3415 (got mcp)",
    ],
    [
      ["events", "check", "--format", "xml"],
      "--format must be text, json or junit (got xml)",
    ],
    [
      ["events", "list", "--dialect", "claude"],
      "--dialect must be auto, sep-3415 or chatgpt (got claude)",
    ],
    [
      ["events", "rename"],
      "Usage: mcp-use client demo events <list|subscribe|unsubscribe|listen|poll|stream|check> ...",
    ],
  ] as const)(
    "exits 2 before connecting: %j",
    async ([args, message], { cli }) => {
      await seedServer(cli, "demo", UNREACHABLE);

      const result = await cli.run(["client", "demo", ...args, "--json"]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.errorJson).toEqual({
        error: { code: "usage_error", message },
      });
    }
  );
});

// The end-to-end suite needs the Events implementation in the workspace
// build: the client lane (WP-28/29), the server engine (WP-10..WP-27) and the
// conformance catalog (WP-05). On branches that still carry their
// `notBuilt` skeletons it is skipped.
// TODO(events): drop this gate once events/integration is the base branch.
async function eventsBuilt(): Promise<boolean> {
  try {
    const client = (await import(
      pathToFileURL(join(PACKAGES, "client", "dist", "index.js")).href
    )) as Record<string, unknown>;
    const conformance = (await import(
      pathToFileURL(
        join(PACKAGES, "events-core", "dist", "conformance", "index.js")
      ).href
    )) as { CATALOG?: readonly unknown[] };
    return (
      typeof client.createEventsConnection === "function" &&
      (conformance.CATALOG?.length ?? 0) > 0
    );
  } catch {
    return false;
  }
}

const BUILT = await eventsBuilt();

interface Fixture {
  url: string;
  child: ChildProcess;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function startFixture(file: string): Promise<Fixture> {
  // `MCPServer.listen` does not report an ephemeral port, so pick one here.
  const port = await freePort();
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(FIXTURES, file)], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /READY (\d+)/.exec(out);
      if (match) resolve({ url: `http://127.0.0.1:${match[1]}/mcp`, child });
    });
    child.once("exit", (code) =>
      reject(new Error(`${file} exited with ${code} before READY`))
    );
  });
}

describe.skipIf(!BUILT)("client <server> events against a real server", () => {
  let server: Fixture;
  let broken: Fixture;

  beforeAll(async () => {
    server = await startFixture("server.mjs");
    broken = await startFixture("non-conformant.mjs");
  });
  afterAll(() => {
    server?.child.kill();
    broken?.child.kill();
  });

  test("list prints the event and its delivery modes", async ({ cli }) => {
    await seedServer(cli, "notes", server.url);

    const result = await cli.run(["client", "notes", "events", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "note.created [push,poll] - A note was created.\n"
    );
  });

  test("poll returns an event emitted after the cursor", async ({ cli }) => {
    await seedServer(cli, "notes", server.url);
    const first = await cli.run([
      "client",
      "notes",
      "events",
      "poll",
      "note.created",
      "--json",
    ]);
    expect(first.exitCode).toBe(0);
    const { cursor } = first.json as { cursor: string | null };

    const emitted = await cli.run([
      "client",
      "notes",
      "tools",
      "call",
      "create_note",
      "folder=inbox",
      "noteId=n-poll",
      "title=Hello",
    ]);
    expect(emitted.exitCode).toBe(0);

    const second = await cli.run([
      "client",
      "notes",
      "events",
      "poll",
      "note.created",
      "--cursor",
      cursor ?? "null",
      "--json",
    ]);

    expect(second.exitCode).toBe(0);
    const page = second.json as {
      events: Array<{ eventId: string; name: string; data: unknown }>;
    };
    expect(
      page.events.map((e) => ({
        eventId: e.eventId,
        name: e.name,
        data: e.data,
      }))
    ).toEqual([
      {
        eventId: "n-poll",
        name: "note.created",
        data: { folder: "inbox", noteId: "n-poll", title: "Hello" },
      },
    ]);
  });

  test("listen --mode poll prints one line per delivery and stops after --count", async ({
    cli,
  }) => {
    await seedServer(cli, "notes", server.url);
    const start = await cli.run([
      "client",
      "notes",
      "events",
      "poll",
      "note.created",
      "--json",
    ]);
    const { cursor } = start.json as { cursor: string | null };
    await cli.run([
      "client",
      "notes",
      "tools",
      "call",
      "create_note",
      "folder=work",
      "noteId=n-listen",
      "title=Plan",
    ]);

    const result = await cli.run([
      "client",
      "notes",
      "events",
      "listen",
      "note.created",
      "--mode",
      "poll",
      "--cursor",
      cursor ?? "null",
      "--count",
      "1",
    ]);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\S+ n-listen - - cursor=\S+ \{"folder":"work","noteId":"n-listen","title":"Plan"\}$/
    );
  });

  test("check exits 1 and writes JUnit for a non-conformant server", async ({
    cli,
  }) => {
    await seedServer(cli, "broken", broken.url);

    const result = await cli.run([
      "client",
      "broken",
      "events",
      "check",
      "--format",
      "junit",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.startsWith("<?xml")).toBe(true);
    expect(result.stdout).toContain("<failure");
  });
});
