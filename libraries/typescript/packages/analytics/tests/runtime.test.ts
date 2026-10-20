import { EventEmitter } from "node:events";

import type { Mock } from "vitest";

import {
  isTruthyFlag,
  onTerminationSignal,
  readEnv,
  runtimeName,
  uuidv7,
  vercelWaitUntil,
  type RuntimeGlobals,
} from "../src/runtime.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("uuidv7", () => {
  it("is a v7 UUID carrying the millisecond timestamp", () => {
    const id = uuidv7(0x0123456789ab);
    expect(id).toMatch(
      /^01234567-89ab-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("sorts by time and is unique", () => {
    const ids = Array.from({ length: 50 }, (_, i) =>
      uuidv7(1_700_000_000_000 + i)
    );
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(
      1000
    );
  });
});

describe("environment", () => {
  it("parses boolean flags", () => {
    for (const value of ["1", "true", "True", " yes ", "on"])
      expect(isTruthyFlag(value)).toBe(true);
    for (const value of [undefined, "", "0", "false", "off", "no"])
      expect(isTruthyFlag(value)).toBe(false);
  });

  it("falls back to Deno.env when process.env lacks the variable", () => {
    vi.stubEnv("MANUFACT_TEST_ONLY_VAR", undefined);
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) =>
          name === "MANUFACT_TEST_ONLY_VAR" ? "deno" : undefined,
      },
    });
    expect(readEnv("MANUFACT_TEST_ONLY_VAR")).toBe("deno");
  });

  it("treats a Deno permission error as unset", () => {
    vi.stubGlobal("Deno", {
      env: {
        get: () => {
          throw new Error("PermissionDenied");
        },
      },
    });
    expect(readEnv("MANUFACT_TEST_ONLY_MISSING")).toBeUndefined();
  });

  it("names the runtime", () => {
    expect(runtimeName()).toBe(`node/${process.versions.node}`);
    vi.stubGlobal("Bun", { version: "1.3.0" });
    expect(runtimeName()).toBe("bun/1.3.0");
  });
});

describe("vercelWaitUntil", () => {
  const key = Symbol.for("@vercel/request-context");

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[key];
  });

  it("returns the request context's waitUntil when present", () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[key] = {
      get: () => ({ waitUntil }),
    };
    expect(vercelWaitUntil()).toBe(waitUntil);
  });

  it("is undefined outside Vercel or outside a request", () => {
    expect(vercelWaitUntil()).toBeUndefined();
    (globalThis as Record<symbol, unknown>)[key] = { get: () => undefined };
    expect(vercelWaitUntil()).toBeUndefined();
  });
});

describe("onTerminationSignal", () => {
  type FakeProcess = EventEmitter & {
    pid: number;
    exitCode?: number | string;
    versions: Record<string, string>;
    kill: Mock<(pid: number, signal?: string) => void>;
    exit: Mock<(code?: number) => void>;
  };

  function fakeProcess(): FakeProcess {
    return Object.assign(new EventEmitter(), {
      pid: 4242,
      versions: { node: "22.11.0" },
      kill: vi.fn<(pid: number, signal?: string) => void>(),
      exit: vi.fn<(code?: number) => void>(),
    });
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs nothing on Deno, Workers, edge runtimes or without process signals", () => {
    const flush = vi.fn(async () => undefined);
    const cases: RuntimeGlobals[] = [
      {},
      { process: fakeProcess(), Deno: { version: { deno: "2.5.0" } } },
      {
        process: fakeProcess(),
        navigator: { userAgent: "Cloudflare-Workers" },
      },
      { process: fakeProcess(), EdgeRuntime: "edge-runtime" },
      { process: Object.assign(fakeProcess(), { versions: {} }) },
      { process: { ...fakeProcess(), kill: undefined } as never },
    ];
    for (const g of cases) {
      expect(onTerminationSignal(flush, 2_000, g)).toBe(false);
      const proc = g.process as FakeProcess | undefined;
      if (proc instanceof EventEmitter) {
        expect(proc.listenerCount("SIGINT")).toBe(0);
        expect(proc.listenerCount("SIGTERM")).toBe(0);
      }
    }
    // Bun exposes process.versions.node too; either name is enough.
    const bun = Object.assign(fakeProcess(), { versions: {} });
    expect(
      onTerminationSignal(flush, 2_000, {
        process: bun,
        Bun: { version: "1.3.0" },
      })
    ).toBe(true);
  });

  it.each(["SIGINT", "SIGTERM"])(
    "flushes on %s when nothing else listens, then raises it again so the process still dies by it",
    async (signal) => {
      const proc = fakeProcess();
      const done = deferred();
      const flush = vi.fn(() => done.promise);
      expect(onTerminationSignal(flush, 2_000, { process: proc })).toBe(true);
      proc.emit(signal);
      // The flush starts synchronously, as the final one.
      expect(flush).toHaveBeenCalledWith(true);
      await Promise.resolve();
      expect(proc.kill).not.toHaveBeenCalled();
      done.resolve();
      await vi.waitFor(() =>
        expect(proc.kill).toHaveBeenCalledWith(4242, signal)
      );
      expect(proc.listenerCount(signal)).toBe(0);
      expect(proc.exit).not.toHaveBeenCalled();
    }
  );

  it("raises the signal after the bound when the flush hangs, and at once on a second signal", async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    const flush = vi.fn(() => new Promise<void>(() => undefined));
    onTerminationSignal(flush, 2_000, { process: proc });
    proc.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith(4242, "SIGTERM");

    const impatient = fakeProcess();
    onTerminationSignal(flush, 2_000, { process: impatient });
    impatient.emit("SIGINT");
    impatient.emit("SIGINT");
    expect(impatient.kill).toHaveBeenCalledTimes(1);
    expect(impatient.kill).toHaveBeenCalledWith(4242, "SIGINT");
  });

  it("only flushes when the application listens, whenever it registered, and never exits", async () => {
    for (const order of ["before", "after"] as const) {
      const proc = fakeProcess();
      const app = vi.fn();
      if (order === "before") proc.on("SIGINT", app);
      const flush = vi.fn(async () => undefined);
      onTerminationSignal(flush, 2_000, { process: proc });
      if (order === "after") proc.on("SIGINT", app);
      proc.emit("SIGINT");
      expect(flush).toHaveBeenCalledWith(false);
      expect(app).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(proc.kill).not.toHaveBeenCalled();
      expect(proc.exit).not.toHaveBeenCalled();
      expect(proc.listenerCount("SIGINT")).toBe(2);
    }
  });

  it("holds a process.exit() the application calls during the flush, then exits with its code", async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    const exit = proc.exit;
    proc.on("SIGTERM", () => proc.exit(3));
    const done = deferred();
    onTerminationSignal(() => done.promise, 2_000, { process: proc });
    proc.emit("SIGTERM");
    expect(exit).not.toHaveBeenCalled();
    expect(proc.exitCode).toBe(3);
    done.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(3);
    expect(proc.exit).toBe(exit);
    expect(proc.kill).not.toHaveBeenCalled();

    // A flush that never ends holds the exit for the bound only.
    const stuck = fakeProcess();
    const stuckExit = stuck.exit;
    stuck.on("SIGINT", () => stuck.exit());
    onTerminationSignal(() => new Promise<void>(() => undefined), 2_000, {
      process: stuck,
    });
    stuck.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(stuckExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stuckExit).toHaveBeenCalledWith(undefined);
    expect(stuck.exit).toBe(stuckExit);
  });

  it("leaves process.exit alone when there is nothing to send", async () => {
    const proc = fakeProcess();
    const exit = proc.exit;
    proc.on("SIGINT", () => undefined);
    onTerminationSignal(async () => undefined, 2_000, { process: proc });
    proc.emit("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(proc.exit).toBe(exit);
    proc.exit(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("treats a framework handler that removes itself (Skybridge) as the application's", async () => {
    const proc = fakeProcess();
    const shutdown = (): void => {
      proc.off("SIGTERM", shutdown);
      proc.off("SIGINT", shutdown);
    };
    proc.on("SIGTERM", shutdown);
    proc.on("SIGINT", shutdown);
    const flush = vi.fn(() => new Promise<void>(() => undefined));
    onTerminationSignal(flush, 2_000, { process: proc });
    proc.emit("SIGINT");
    expect(flush).toHaveBeenCalledWith(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(proc.kill).not.toHaveBeenCalled();
    // Its second Ctrl+C falls through to the default again: exit at once.
    proc.emit("SIGINT");
    expect(proc.kill).toHaveBeenCalledWith(4242, "SIGINT");
  });
});
