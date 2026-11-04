/**
 * Saved-server behaviour of `mcp-use client`, through the built bin.
 *
 * Saved servers live in `<HOME>/.mcp-use/client/servers.json`. Tests seed it,
 * run the CLI with a throwaway HOME, and read it back.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { test, type Cli } from "../helpers/cli-test.js";

function serversPath(cli: Cli): string {
  return join(cli.home, ".mcp-use", "client", "servers.json");
}

async function seedServers(
  cli: Cli,
  servers: Record<string, { url: string; oauth: boolean; protocol: string }>
): Promise<void> {
  await mkdir(join(cli.home, ".mcp-use", "client"), { recursive: true });
  await writeFile(serversPath(cli), JSON.stringify({ servers }));
}

async function savedServers(cli: Cli): Promise<unknown> {
  return JSON.parse(await readFile(serversPath(cli), "utf8"));
}

const DEMO = {
  url: "https://demo.example.com/mcp",
  oauth: false,
  protocol: "auto",
};
const OTHER = {
  url: "https://other.example.com/mcp",
  oauth: false,
  protocol: "auto",
};

describe("client remove", () => {
  test("fails instead of reporting a remove that never happened", async ({
    cli,
  }) => {
    const result = await cli.run(["client", "remove", "never-saved", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.errorJson).toEqual({
      error: {
        code: "usage_error",
        message:
          "Unknown saved server: never-saved. Run `mcp-use client list` to see saved servers.",
      },
    });
  });

  test.for([
    [["client", "remove", "demo", "--json"]],
    [["client", "--json", "remove", "demo"]],
    [["client", "remove", "--json", "demo"]],
  ] as const)(
    "%s removes only that server, without confirmation",
    async ([args], { cli }) => {
      await seedServers(cli, { demo: DEMO, other: OTHER });

      const result = await cli.run(args);

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.json).toEqual({ removed: "demo" });
      expect(await savedServers(cli)).toEqual({ servers: { other: OTHER } });
    }
  );

  test("rejects --yes and keeps the server", async ({ cli }) => {
    await seedServers(cli, { demo: DEMO });

    const result = await cli.run(["client", "remove", "demo", "--yes"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option '--yes'");
    expect(await savedServers(cli)).toEqual({ servers: { demo: DEMO } });
  });
});

describe("client protocol modes", () => {
  test.for(["2025-11-25", "2026-07-28", "invalid"])(
    "rejects --protocol %s before saving or connecting",
    async (protocol, { cli, cloud }) => {
      const result = await cli.run([
        "client",
        "connect",
        "invalid-protocol",
        `${cloud.origin}/mcp`,
        "--no-oauth",
        "--protocol",
        protocol,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Invalid protocol. Expected auto, legacy, or modern.\n"
      );
      expect(existsSync(serversPath(cli))).toBe(false);
      expect(cloud.requests).toEqual([]);
    }
  );

  test("migrates saved revision values to named modes", async ({ cli }) => {
    await seedServers(cli, {
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
    });

    const result = await cli.run(["client", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual([
      {
        name: "old",
        url: "https://old.example.com/mcp",
        oauth: false,
        protocol: "legacy",
      },
      {
        name: "new",
        url: "https://new.example.com/mcp",
        oauth: false,
        protocol: "modern",
      },
    ]);
    expect(await savedServers(cli)).toEqual({
      servers: {
        old: {
          url: "https://old.example.com/mcp",
          oauth: false,
          protocol: "legacy",
        },
        new: {
          url: "https://new.example.com/mcp",
          oauth: false,
          protocol: "modern",
        },
      },
    });
  });
});

describe("client option validation", () => {
  // The saved server points at the test's local HTTP fake, so any connection
  // attempt shows up in `cloud.requests`.
  test("rejects an unknown option before contacting the server", async ({
    cli,
    cloud,
  }) => {
    await seedServers(cli, {
      remote: { url: `${cloud.origin}/mcp`, oauth: true, protocol: "auto" },
    });

    const result = await cli.run([
      "client",
      "remote",
      "tools",
      "list",
      "--no-open",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option '--no-open'");
    expect(cloud.requests).toEqual([]);
  });

  test("contacts the server once the options are valid", async ({
    cli,
    cloud,
  }) => {
    cloud.on("POST", "/mcp", { status: 500, body: {} });
    await seedServers(cli, {
      remote: { url: `${cloud.origin}/mcp`, oauth: true, protocol: "auto" },
    });

    const result = await cli.run([
      "client",
      "remote",
      "tools",
      "list",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(cloud.requestsTo("POST", "/mcp").length).toBeGreaterThan(0);
  });
});
