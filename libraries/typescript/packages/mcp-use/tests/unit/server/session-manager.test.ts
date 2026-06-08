import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startIdleCleanup,
  type SessionData,
} from "../../../src/server/sessions/index.js";

describe("startIdleCleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cleans server resources for expired sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const sessions = new Map<string, SessionData>([
      [
        "expired-session",
        {
          lastAccessedAt: Date.now() - 2_000,
          transport: {} as SessionData["transport"],
        },
      ],
    ]);
    const closeTransport = vi.fn();
    const transports = new Map([
      [
        "expired-session",
        {
          close: closeTransport,
        },
      ],
    ]);
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

    expect(interval).toBeDefined();

    vi.advanceTimersByTime(60_000);

    expect(sessions.has("expired-session")).toBe(false);
    expect(transports.has("expired-session")).toBe(false);
    expect(closeTransport).toHaveBeenCalledTimes(1);
    expect(mcpServerInstance.cleanupSessionSubscriptions).toHaveBeenCalledWith(
      "expired-session"
    );
    expect(mcpServerInstance.cleanupSessionRefs).toHaveBeenCalledWith(
      "expired-session"
    );

    clearInterval(interval);
  });
});
