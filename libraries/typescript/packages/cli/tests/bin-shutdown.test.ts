/** Production shutdown regressions with no listeners or network connections. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const started = vi.hoisted(() => ({
  close: vi.fn(),
}));

vi.mock("../src/commands/start.js", () => ({
  runStart: async () => ({
    url: "http://localhost:3000/mcp",
    close: started.close,
  }),
}));

import { main } from "../src/bin/main.js";

type SignalListener = (signal: NodeJS.Signals) => void;
let signals: Record<"SIGINT" | "SIGTERM", Set<SignalListener>>;

beforeEach(() => {
  signals = {
    SIGINT: new Set(process.listeners("SIGINT")),
    SIGTERM: new Set(process.listeners("SIGTERM")),
  };
  started.close.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signals[signal].has(listener)) process.off(signal, listener);
    }
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("production shutdown", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "keeps swallowing duplicate %s events until close completes",
    async (signal) => {
      let completeClose!: () => void;
      started.close.mockReturnValue(
        new Promise<void>((resolve) => {
          completeClose = resolve;
        })
      );
      await expect(main(["start"])).resolves.toBe(0);
      const listener = process
        .listeners(signal)
        .find((candidate) => !signals[signal].has(candidate));
      expect(listener).toBeDefined();

      // Actual EventEmitter dispatch removes a once listener; directly calling
      // the retrieved callback would miss the production bug.
      process.emit(signal, signal);
      expect(process.listeners(signal)).toContain(listener);
      process.emit(signal, signal);
      await vi.waitFor(() => expect(started.close).toHaveBeenCalledOnce());
      expect(process.exit).not.toHaveBeenCalled();

      completeClose();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(started.close).toHaveBeenCalledOnce();
      expect(process.listeners(signal)).not.toContain(listener);
      for (const otherSignal of ["SIGINT", "SIGTERM"] as const) {
        expect(new Set(process.listeners(otherSignal))).toEqual(
          signals[otherSignal]
        );
      }
    }
  );

  it("shares close when SIGINT is followed by SIGTERM", async () => {
    let completeClose!: () => void;
    started.close.mockReturnValue(
      new Promise<void>((resolve) => {
        completeClose = resolve;
      })
    );
    await main(["start"]);
    process.emit("SIGINT", "SIGINT");
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(started.close).toHaveBeenCalledOnce());
    expect(process.exit).not.toHaveBeenCalled();
    completeClose();
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
  });

  it("keeps a rejected close as a failing exit and clears its deadline", async () => {
    vi.useFakeTimers();
    const failure = new Error("server close failed");
    started.close.mockRejectedValue(failure);
    await main(["start"]);
    process.emit("SIGTERM", "SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(console.error).toHaveBeenCalledWith(failure.message);
    expect(vi.getTimerCount()).toBe(0);
    expect(new Set(process.listeners("SIGTERM"))).toEqual(signals.SIGTERM);
  });

  it("also treats a synchronous close throw as a failure", async () => {
    const failure = new Error("synchronous close failed");
    started.close.mockImplementation(() => {
      throw failure;
    });
    await main(["start"]);
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(console.error).toHaveBeenCalledWith(failure.message);
  });

  it("fails a stalled close after the conservative 30-second deadline", async () => {
    vi.useFakeTimers();
    started.close.mockReturnValue(new Promise<void>(() => {}));
    await main(["start"]);
    process.emit("SIGTERM", "SIGTERM");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(started.close).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(console.error).toHaveBeenCalledWith(
      "Production server shutdown timed out after 30 seconds."
    );
    expect(new Set(process.listeners("SIGINT"))).toEqual(signals.SIGINT);
    expect(new Set(process.listeners("SIGTERM"))).toEqual(signals.SIGTERM);
    expect(vi.getTimerCount()).toBe(0);
  });
});
