/**
 * Unit tests for tunnel manager auto-respawn during `mcp-use dev`.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { createTunnelManager } from "../../src/cli/tunnel.js";

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as MockChild;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();
  return child;
}

function emitTunnelReady(
  child: MockChild,
  url = "https://my-tunnel.local.mcp-use.run"
): void {
  child.stdout.emit("data", Buffer.from(`\n  ${url}\n`));
}

function spawnArgsForCall(index: number): string[] {
  return spawnMock.mock.calls[index]?.[1] as string[];
}

describe("createTunnelManager", () => {
  let stateFilePath: string;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );
    const dir = mkdtempSync(join(tmpdir(), "mcp-use-tunnel-test-"));
    stateFilePath = join(dir, "tunnel.json");
    writeFileSync(
      stateFilePath,
      JSON.stringify({ subdomain: "my-tunnel" }, null, 2)
    );
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("respawns the tunnel child with the saved subdomain after unexpected exit", async () => {
    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementation(() => {
      if (spawnMock.mock.calls.length === 1) {
        return first;
      }
      return second;
    });

    const tunnel = createTunnelManager(stateFilePath);
    const startPromise = tunnel.start(3000);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    emitTunnelReady(first);
    await startPromise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnArgsForCall(0)).toEqual(
      expect.arrayContaining(["--subdomain", "my-tunnel"])
    );
    expect(tunnel.status().url).toBe("https://my-tunnel.local.mcp-use.run");

    first.emit("exit", 0);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    emitTunnelReady(second);
    await vi.waitFor(() => {
      expect(tunnel.status().url).toBe("https://my-tunnel.local.mcp-use.run");
    });
    expect(spawnArgsForCall(1)).toEqual(
      expect.arrayContaining(["--subdomain", "my-tunnel"])
    );
  });

  it("does not respawn after an intentional stop", async () => {
    const child = createMockChild();
    spawnMock.mockImplementation(() => child);

    const tunnel = createTunnelManager(stateFilePath);
    const startPromise = tunnel.start(3000);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    emitTunnelReady(child);
    await startPromise;

    await tunnel.stop();
    child.emit("exit", 0);

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(tunnel.status().url).toBeNull();
  });
});
