import { afterEach, describe, expect, it, vi } from "vitest";

import { startIdleCleanup } from "../../../src/server/sessions/session-manager.js";
import type { SessionData } from "../../../src/server/sessions/session-manager.js";

describe("startIdleCleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cleans session refs when idle cleanup evicts an expired session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sessions = new Map<string, SessionData>([
      [
        "expired-session",
        {
          lastAccessedAt: 1_000,
          transport: {} as SessionData["transport"],
        },
      ],
    ]);
    const transports = new Map([["expired-session", { close: vi.fn() }]]);
    const mcpServerInstance = {
      cleanupSessionSubscriptions: vi.fn(),
      cleanupSessionRefs: vi.fn(),
    };

    const interval = startIdleCleanup(
      sessions,
      1_000,
      transports,
      mcpServerInstance
    );

    vi.advanceTimersByTime(60_000);
    if (interval) {
      clearInterval(interval);
    }

    expect(sessions.has("expired-session")).toBe(false);
    expect(transports.has("expired-session")).toBe(false);
    expect(mcpServerInstance.cleanupSessionSubscriptions).toHaveBeenCalledWith(
      "expired-session"
    );
    expect(mcpServerInstance.cleanupSessionRefs).toHaveBeenCalledWith(
      "expired-session"
    );
  });
});
