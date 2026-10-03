import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import process from "node:process";
import {
  StdioConnector,
  StdioConnectionManager,
} from "../../../src/transport/stdio.js";

const failingHandshakeServer = String.raw`
const readline = require("node:readline");

// Emit PID on stderr immediately
process.stderr.write(process.pid + "\n");

let held;
let released = false;
process.on("SIGUSR2", () => {
  released = true;
  clearInterval(held);
});

const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => {
  if (!released) {
    held = setInterval(() => {}, 1000);
  }
});

lines.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: "injected initialization failure" },
        }) + "\n"
      );
    }
  } catch {}
});
`;

const workingServer = String.raw`
const readline = require("node:readline");

// Emit PID on stderr immediately
process.stderr.write(process.pid + "\n");

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    let result;
    if (request.method === "initialize") {
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: {},
        serverInfo: { name: "working-server", version: "1.0.0" }
      };
    } else if (request.method === "tools/list") {
      result = { tools: [] };
    } else {
      return;
    }
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n"
    );
  } catch {}
});
`;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("StdioConnector process lifecycle and exit guarantees", () => {
  it("ensures the child process is terminated when connection fails", async () => {
    let capturedPid: number | null = null;
    const errlog = new Writable({
      write(chunk, _encoding, callback) {
        const text = chunk.toString().trim();
        const num = Number(text);
        if (!Number.isNaN(num) && num > 0) {
          capturedPid = num;
        }
        callback();
      },
    });

    const connector = new StdioConnector({
      command: process.execPath,
      args: ["-e", failingHandshakeServer],
      errlog,
    });

    try {
      await expect(connector.connect()).rejects.toThrow(
        "injected initialization failure"
      );

      expect(capturedPid).not.toBeNull();
      const pid = capturedPid!;

      // Verify the child process is dead as soon as connect() rejection settles
      expect(isPidAlive(pid)).toBe(false);
    } finally {
      if (capturedPid && isPidAlive(capturedPid)) {
        try {
          process.kill(capturedPid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("prevents dual-process overlap during sequential retry after failed handshake", async () => {
    const pids: number[] = [];
    const errlog = new Writable({
      write(chunk, _encoding, callback) {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          const num = Number(line.trim());
          if (!Number.isNaN(num) && num > 0) {
            pids.push(num);
          }
        }
        callback();
      },
    });

    const connector = new StdioConnector({
      command: process.execPath,
      args: ["-e", failingHandshakeServer],
      errlog,
    });

    try {
      // First attempt fails during initialize
      await expect(connector.connect()).rejects.toThrow(
        "injected initialization failure"
      );
      expect(pids.length).toBeGreaterThanOrEqual(1);
      const firstPid = pids[0];

      // Predecessor must be dead immediately upon rejection
      expect(isPidAlive(firstPid)).toBe(false);

      // Mutate args to point to working server for retry attempt
      (connector as any).args = ["-e", workingServer];

      // Second attempt succeeds
      await connector.connect();
      expect(connector.connected).toBe(true);
      expect(pids.length).toBeGreaterThanOrEqual(2);
      const secondPid = pids[1];

      // First PID must remain dead, second PID must be active
      expect(firstPid).not.toBe(secondPid);
      expect(isPidAlive(firstPid)).toBe(false);
      expect(isPidAlive(secondPid)).toBe(true);

      await connector.disconnect();
      expect(isPidAlive(secondPid)).toBe(false);
    } finally {
      for (const pid of pids) {
        if (isPidAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }
    }
  });

  it("ensures normal disconnect awaits child process termination before resolving", async () => {
    let capturedPid: number | null = null;
    const errlog = new Writable({
      write(chunk, _encoding, callback) {
        const num = Number(chunk.toString().trim());
        if (!Number.isNaN(num) && num > 0) {
          capturedPid = num;
        }
        callback();
      },
    });

    const connector = new StdioConnector({
      command: process.execPath,
      args: ["-e", workingServer],
      errlog,
    });

    try {
      await connector.connect();
      expect(connector.connected).toBe(true);
      expect(capturedPid).not.toBeNull();
      const pid = capturedPid!;

      expect(isPidAlive(pid)).toBe(true);
      expect(connector.pid).toBe(pid);

      await connector.disconnect();

      // Child must be reaped as soon as disconnect() resolves
      expect(isPidAlive(pid)).toBe(false);
      expect(connector.pid).toBeNull();
    } finally {
      if (capturedPid && isPidAlive(capturedPid)) {
        try {
          process.kill(capturedPid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("coalesces concurrent transport.close() calls onto a single in-flight promise", async () => {
    const manager = new StdioConnectionManager({
      command: process.execPath,
      args: ["-e", workingServer],
    });

    const transport = await manager.start();
    await transport.start();
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    expect(manager.childProcess).not.toBeNull();

    // Fire two concurrent close calls
    const [close1, close2] = [transport.close(), transport.close()];
    await Promise.all([close1, close2]);

    await manager.stop();
    expect(isPidAlive(pid!)).toBe(false);
  });
});
