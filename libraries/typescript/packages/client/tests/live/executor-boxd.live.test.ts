/**
 * Runs the boxd code executor against real boxd machines.
 * Skipped unless BOXD_E2E=1. Needs BOXD_API_KEY and @boxd-sh/sdk.
 *
 *   BOXD_E2E=1 BOXD_API_KEY=... pnpm --filter @mcp-use/client exec vitest run tests/live/executor-boxd.live.test.ts
 *
 * Optional: BOXD_ORG, BOXD_REGION (default "fra"), BOXD_E2E_NAME_PREFIX
 * (default "mcp-use-e2e"), BOXD_E2E_LABELS ("k=v,k2=v2").
 * Each test deletes the machine it created through client.close().
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCPClient } from "../../src/core/node.js";

const enabled = process.env.BOXD_E2E === "1";
const region = process.env.BOXD_REGION ?? "fra";

function machineName(): string {
  const prefix = process.env.BOXD_E2E_NAME_PREFIX ?? "mcp-use-e2e";
  return `${prefix}-${Date.now().toString(36)}`;
}

function labels(): Record<string, string> {
  const pairs = (process.env.BOXD_E2E_LABELS ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => pair.split("=") as [string, string]);
  return { "mcp-use-test": "executor-boxd", ...Object.fromEntries(pairs) };
}

async function getMachine(id: string) {
  // @ts-ignore - Optional dependency, may not be installed
  const { Boxd } = await import("@boxd-sh/sdk");
  return new Boxd({ region }).machines.get(id);
}

// Test console output is not shown, so write straight to stdout
function log(line: string): void {
  process.stdout.write(`[boxd live] ${line}\n`);
}

function machineIdOf(client: MCPClient): string {
  return (client as any)._codeExecutor.machineId;
}

describe.skipIf(!enabled)("boxd code executor (live)", () => {
  it("runs code with MCP tool calls in an isolated machine and deletes it on close()", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-use-boxd-live-"));
    fs.writeFileSync(path.join(dir, "hello.txt"), "hello from the host");
    const client = new MCPClient(
      {
        mcpServers: {
          fs: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", dir],
          },
        },
      },
      {
        codeMode: {
          enabled: true,
          executor: "boxd",
          executorOptions: { region, name: machineName(), labels: labels() },
        },
      }
    );

    let machineId = "";
    try {
      const out = await client.executeCode(`
          const os = require("node:os");
          const text = await fs.read_text_file({ path: ${JSON.stringify(
            path.join(dir, "hello.txt")
          )} });
          console.log("ran on", os.hostname());
          return { text, user: os.userInfo().username };
        `);
      machineId = machineIdOf(client);
      log(`machine ${machineId} ${JSON.stringify(out)}`);

      expect(out.error).toBeNull();
      expect(out.result).toEqual({ text: "hello from the host", user: "boxd" });
      expect(out.logs.join("\n")).toContain("ran on");

      const machine = await getMachine(machineId);
      expect(machine.networking.isolated).toBe(true);

      const second = await client.executeCode("return process.version;");
      expect(machineIdOf(client)).toBe(machineId);
      expect(second.result).toMatch(/^v\d+/);
    } finally {
      await client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await expect(getMachine(machineId)).rejects.toMatchObject({
      name: "NotFoundError",
    });
  }, 180_000);

  it("reports errors and timeouts from code running in the machine", async () => {
    const client = new MCPClient(
      {},
      {
        codeMode: {
          enabled: true,
          executor: "boxd",
          executorOptions: { region, name: machineName(), labels: labels() },
        },
      }
    );

    try {
      const thrown = await client.executeCode(`throw new Error("boom");`);
      log(`machine ${machineIdOf(client)}`);
      expect(thrown.error).toContain("boom");

      const slow = await client.executeCode(
        "await new Promise((r) => setTimeout(r, 60_000));",
        3_000
      );
      expect(slow.error).toBe("Script execution timed out");

      const after = await client.executeCode("return 1 + 1;");
      expect(after.result).toBe(2);
    } finally {
      await client.close();
    }
  }, 180_000);
});
