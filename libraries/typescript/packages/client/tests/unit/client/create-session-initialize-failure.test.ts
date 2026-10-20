/**
 * Regression: BaseMCPClient.createSession must tear down the connector it
 * created when auto-initialization fails. The session never leaves
 * openSession(), so without an explicit disconnect the stdio child process
 * stays alive and unreachable from closeSession()/closeAllSessions().
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { BaseMCPClient } from "../../../src/core/base.js";
import type { ServerConfig } from "../../../src/core/config.js";
import type { BaseConnector } from "../../../src/transport/base.js";
import { StdioConnector } from "../../../src/transport/stdio.js";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/tools-list-error-server.mjs", import.meta.url)
);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

class FailingInitializeClient extends BaseMCPClient {
  public connector: BaseConnector | undefined;
  public pidFile = "";

  protected createConnectorFromConfig(
    _serverConfig: ServerConfig
  ): BaseConnector {
    this.connector = new StdioConnector({
      command: process.execPath,
      args: [fixturePath, "internal-error", this.pidFile],
      protocolNegotiation: "legacy",
    });
    return this.connector;
  }

  protected async createDefaultOAuthProvider(): Promise<never> {
    throw new Error("not needed for this test");
  }
}

describe("BaseMCPClient.createSession initialization failure", () => {
  it("disconnects the connector and terminates the stdio child", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "mcp-create-session-init-failure-")
    );
    const pidFile = join(directory, "child.pid");
    const client = new FailingInitializeClient({
      mcpServers: { demo: { command: process.execPath } },
    });
    client.pidFile = pidFile;

    onTestFinished(async () => {
      try {
        if (existsSync(pidFile)) {
          const cleanupPid = Number(readFileSync(pidFile, "utf8").trim());
          if (Number.isInteger(cleanupPid) && isAlive(cleanupPid)) {
            process.kill(cleanupPid, "SIGKILL");
          }
        }
        await client.connector?.disconnect();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    await expect(client.createSession("demo")).rejects.toThrow(
      "storage backend unavailable"
    );

    expect(client.connector?.isClientConnected).toBe(false);

    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(pid)).toBe(true);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: 3000,
    });
  });
});
