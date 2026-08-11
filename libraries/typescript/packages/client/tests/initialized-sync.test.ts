import { describe, expect, it, vi } from "vitest";
import { installInitializedSync } from "../src/react/view/initialized-sync.js";

describe("installInitializedSync", () => {
  it("replays host state after every guest initialization", async () => {
    const previous = vi.fn();
    const synchronize = vi.fn().mockResolvedValue(undefined);
    const bridge = { oninitialized: previous };
    const firstSynchronization = installInitializedSync(
      bridge,
      synchronize,
      vi.fn()
    );

    bridge.oninitialized?.({ generation: 1 });
    await firstSynchronization;
    bridge.oninitialized?.({ generation: 2 });
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(2));

    expect(previous).toHaveBeenCalledTimes(2);
  });

  it("reports replacement failures and keeps synchronizing", async () => {
    const laterError = new Error("replacement sync failed");
    const synchronize = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(laterError)
      .mockResolvedValueOnce(undefined);
    const onLaterError = vi.fn();
    const bridge = { oninitialized: undefined };
    const firstSynchronization = installInitializedSync(
      bridge,
      synchronize,
      onLaterError
    );

    bridge.oninitialized?.();
    await firstSynchronization;
    bridge.oninitialized?.();
    await vi.waitFor(() =>
      expect(onLaterError).toHaveBeenCalledWith(laterError)
    );
    bridge.oninitialized?.();
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(3));
  });
});
