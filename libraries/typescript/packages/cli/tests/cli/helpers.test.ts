import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WAIT_FOR_TIMEOUT_MS, waitFor } from "./helpers.js";

describe("cli test helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a waitFor default timeout close to the test budget", async () => {
    vi.useFakeTimers();

    const pending = waitFor(async () => undefined, { interval: 1000 });
    const rejection = expect(pending).rejects.toThrow(
      `waitFor timed out after ${DEFAULT_WAIT_FOR_TIMEOUT_MS}ms`
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_WAIT_FOR_TIMEOUT_MS);

    await rejection;
  });
});
