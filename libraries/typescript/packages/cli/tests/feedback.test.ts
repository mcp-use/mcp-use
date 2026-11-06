import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect } from "vitest";

import { test as base } from "./helpers/cli-test.js";

// Replace only the external capture boundary, inside the real CLI process.
// Every request is recorded; unexpected network access fails rather than
// contacting PostHog or using credentials from the developer's machine.
const test = base.extend<{
  capture: { env: Record<string, string>; events(): Promise<unknown[]> };
}>({
  capture: async ({ cli }, use) => {
    const requests = join(cli.cwd, "requests.jsonl");
    const preload = join(cli.cwd, "capture.mjs");
    await writeFile(requests, "");
    await writeFile(
      preload,
      `
      import { appendFileSync } from "node:fs";
      globalThis.fetch = async (url, init) => {
        if (url !== "https://eu.i.posthog.com/i/v0/e/" || init.method !== "POST")
          throw new Error("Unexpected network request");
        appendFileSync(process.env.FEEDBACK_REQUESTS, init.body + "\\n");
        if (process.env.FEEDBACK_REPLY === "offline")
          throw new Error("private network details and report text");
        if (process.env.FEEDBACK_REPLY === "timeout") return new Promise(() => {});
        return new Response('{"status":"Ok"}', { status: Number(process.env.FEEDBACK_REPLY || 200) });
      };
    `
    );
    await use({
      env: {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        FEEDBACK_REQUESTS: requests,
      },
      events: async () =>
        (await readFile(requests, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
    });
  },
});

describe("explicit CLI feedback", () => {
  test("accepts feedback without login and despite passive telemetry opt-outs", async ({
    cli,
    capture,
  }) => {
    const result = await cli.run(
      [
        "feedback",
        "send",
        "Deploy output should show the server URL.",
        "--json",
      ],
      { env: { ...capture.env, DO_NOT_TRACK: "1", NODE_ENV: "test" } }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toEqual({
      accepted: true,
      reportId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const events = (await capture.events()) as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "mcp_use_cli_feedback",
      uuid: (result.json as { reportId: string }).reportId,
      distinct_id: expect.stringMatching(/^cli:[0-9a-f-]{36}$/),
      properties: {
        message: "Deploy output should show the server URL.",
        report_id: (result.json as { reportId: string }).reportId,
        cli_version: expect.any(String),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    expect(JSON.stringify(events)).not.toContain(cli.cwd);
    expect(JSON.stringify(events)).not.toContain(cli.home);
  });

  test("reuses the anonymous identity and prints a human receipt by default", async ({
    cli,
    capture,
  }) => {
    const first = await cli.run(
      ["feedback", "send", "  A clearer error would help.  "],
      { env: capture.env }
    );
    const second = await cli.run(
      ["feedback", "send", "The env push help is useful.", "--json"],
      { env: capture.env }
    );
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toMatch(
      /^Feedback accepted\. Report ID: [0-9a-f-]{36}\n$/
    );
    expect(first.stderr).toBe("");
    expect(second.exitCode).toBe(0);
    const events = (await capture.events()) as Array<{
      distinct_id: string;
      properties: Record<string, unknown>;
    }>;
    expect(events).toHaveLength(2);
    expect(events[0]!.properties).toMatchObject({
      message: "A clearer error would help.",
    });
    expect(events[0]!.properties).not.toHaveProperty("related_command");
    expect(events[1]!.properties).not.toHaveProperty("related_command");
    expect(events[0]!.properties).not.toHaveProperty("source");
    expect(events[1]!.properties).not.toHaveProperty("source");
    expect(events[1]!.distinct_id).toBe(events[0]!.distinct_id);
  });

  test("can submit when installation identity storage is unavailable", async ({
    cli,
    capture,
  }) => {
    await writeFile(join(cli.home, ".mcp-use"), "not a directory");
    const result = await cli.run(
      ["feedback", "send", "Readonly home report", "--json"],
      { env: capture.env }
    );
    expect(result.exitCode).toBe(0);
    expect(await capture.events()).toHaveLength(1);
  });

  test.for(["x", "😀"])(
    "accepts a message at the documented size limit: %s",
    async (character, { cli, capture }) => {
      const result = await cli.run(
        ["feedback", "send", character.repeat(10_000), "--json"],
        { env: capture.env }
      );
      expect(result.exitCode).toBe(0);
      expect(await capture.events()).toHaveLength(1);
    }
  );

  test("prints human delivery failures only on stderr", async ({
    cli,
    capture,
  }) => {
    const result = await cli.run(["feedback", "send", "Report text"], {
      env: { ...capture.env, FEEDBACK_REPLY: "500" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HTTP 500");
    expect(result.stderr).not.toContain("Report text");
    expect(await capture.events()).toHaveLength(1);
  });

  test("sends a quoted multiline message as one report", async ({
    cli,
    capture,
  }) => {
    const result = await cli.run(
      [
        "feedback",
        "send",
        "Deploy should show the URL.\nThe --json output should include it too.",
        "--json",
      ],
      { env: capture.env }
    );
    expect(result.exitCode).toBe(0);
    expect(await capture.events()).toMatchObject([
      {
        properties: {
          message:
            "Deploy should show the URL.\nThe --json output should include it too.",
        },
      },
    ]);
  });

  test.for([
    ["send"],
    ["send", "   "],
    ["send", "x".repeat(10_001)],
    ["send", "Report", "extra"],
    ["send", "Report", "--unknown"],
    ["send", "--message", "Report"],
    ["send", "Report", "--command", "deploy"],
    ["send", "Report", "--source", "agent"],
    ["list"],
    [],
  ])(
    "rejects invalid arguments without submitting",
    async (args, { cli, capture }) => {
      const result = await cli.run(["feedback", ...args, "--json"], {
        env: capture.env,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({ error: { code: "usage_error" } });
      expect(await capture.events()).toEqual([]);
    }
  );

  test.for(["400", "429", "500", "offline"])(
    "reports delivery failure without echoing report or network details: %s",
    async (reply, { cli, capture }) => {
      const result = await cli.run(
        ["feedback", "send", "private report", "--json"],
        {
          env: { ...capture.env, FEEDBACK_REPLY: reply },
        }
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({
        error: {
          code:
            reply === "offline"
              ? "feedback_network_error"
              : "feedback_rejected",
        },
      });
      expect(result.stdout).not.toMatch(/private report|private network/);
      expect(await capture.events()).toHaveLength(1);
    }
  );

  test("bounds delivery even when the transport ignores abort", async ({
    cli,
    capture,
  }) => {
    const result = await cli.run(
      ["feedback", "send", "Timeout report", "--json"],
      {
        env: { ...capture.env, FEEDBACK_REPLY: "timeout" },
        timeoutMs: 20_000,
      }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({ error: { code: "feedback_timeout" } });
    expect(await capture.events()).toHaveLength(1);
  }, 25_000);

  test("keeps report contents out of the passive command event", async ({
    cli,
    capture,
  }) => {
    await mkdir(join(cli.home, ".mcp-use"), { recursive: true });
    const result = await cli.run(
      ["feedback", "send", "Explicit report text", "--json"],
      {
        env: { ...capture.env, MCP_USE_ANONYMIZED_TELEMETRY: "true" },
      }
    );
    expect(result.exitCode).toBe(0);
    const events = (await capture.events()) as Array<{
      event: string;
      distinct_id: string;
      properties: Record<string, unknown>;
    }>;
    expect(events).toHaveLength(2);
    const usage = events.find((event) => event.event === "mcp_use_cli_command");
    const feedback = events.find(
      (event) => event.event === "mcp_use_cli_feedback"
    );
    expect(usage?.properties).toMatchObject({
      command: "feedback",
      subcommand: "send",
      is_help: false,
    });
    expect(JSON.stringify(usage)).not.toContain("Explicit report text");
    expect(feedback?.distinct_id).toBe(usage?.distinct_id);
  });
});
