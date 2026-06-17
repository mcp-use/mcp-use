import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendNotificationToAll,
  sendNotificationToSession,
} from "../../../src/server/sessions/notifications.js";
import { ResourceSubscriptionManager } from "../../../src/server/resources/subscriptions.js";
import type { SessionData } from "../../../src/server/sessions/session-manager.js";

describe("Notification Logging", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe("sendNotificationToAll", () => {
    it("should log success when sending to active sessions", async () => {
      const mockTransport = {
        send: vi.fn().mockResolvedValue(undefined),
      };
      const sessions = new Map<string, SessionData>([
        [
          "session-1",
          { transport: mockTransport as any, lastAccessedAt: Date.now() },
        ],
      ]);

      await sendNotificationToAll(sessions, "notifications/tools/list_changed");

      expect(mockTransport.send).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith(
        "[MCP] Sent notification to session session-1: notifications/tools/list_changed"
      );
    });

    it("should log failure when transport.send throws an error", async () => {
      const mockTransport = {
        send: vi.fn().mockRejectedValue(new Error("Connection lost")),
      };
      const sessions = new Map<string, SessionData>([
        [
          "session-1",
          { transport: mockTransport as any, lastAccessedAt: Date.now() },
        ],
      ]);

      await sendNotificationToAll(sessions, "notifications/tools/list_changed");

      expect(mockTransport.send).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        "[MCP] Failed to send notification to session session-1: Error: Connection lost"
      );
    });
  });

  describe("sendNotificationToSession", () => {
    it("should log success when sending to target session", async () => {
      const mockTransport = {
        send: vi.fn().mockResolvedValue(undefined),
      };
      const sessions = new Map<string, SessionData>([
        [
          "session-1",
          { transport: mockTransport as any, lastAccessedAt: Date.now() },
        ],
      ]);

      const result = await sendNotificationToSession(
        sessions,
        "session-1",
        "notifications/tools/list_changed"
      );

      expect(result).toBe(true);
      expect(mockTransport.send).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith(
        "[MCP] Sent notification to session session-1: notifications/tools/list_changed"
      );
    });

    it("should log failure when transport.send throws an error", async () => {
      const mockTransport = {
        send: vi.fn().mockRejectedValue(new Error("Connection reset")),
      };
      const sessions = new Map<string, SessionData>([
        [
          "session-1",
          { transport: mockTransport as any, lastAccessedAt: Date.now() },
        ],
      ]);

      const result = await sendNotificationToSession(
        sessions,
        "session-1",
        "notifications/tools/list_changed"
      );

      expect(result).toBe(false);
      expect(mockTransport.send).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        "[MCP] Failed to send notification to session session-1: Error: Connection reset"
      );
    });
  });

  describe("ResourceSubscriptionManager notifyResourceUpdated", () => {
    it("should log success when sending resource update", async () => {
      const manager = new ResourceSubscriptionManager();
      const mockSendResourceUpdated = vi.fn().mockResolvedValue(undefined);
      const mockSession = {
        server: {
          server: {
            sendResourceUpdated: mockSendResourceUpdated,
          },
        },
      };

      const sessions = new Map<string, SessionData>([
        ["session-1", mockSession as any],
      ]);

      // Manually add subscription
      manager["subscriptions"].set(
        "ui://widget/weather",
        new Set(["session-1"])
      );

      await manager.notifyResourceUpdated("ui://widget/weather", sessions);

      expect(mockSendResourceUpdated).toHaveBeenCalledWith({
        uri: "ui://widget/weather",
      });
      expect(logSpy).toHaveBeenCalledWith(
        "[MCP] Sent notification to session session-1: notifications/resources/updated"
      );
    });

    it("should log failure when sendResourceUpdated throws an error", async () => {
      const manager = new ResourceSubscriptionManager();
      const mockSendResourceUpdated = vi
        .fn()
        .mockRejectedValue(new Error("Subscription closed"));
      const mockSession = {
        server: {
          server: {
            sendResourceUpdated: mockSendResourceUpdated,
          },
        },
      };

      const sessions = new Map<string, SessionData>([
        ["session-1", mockSession as any],
      ]);

      // Manually add subscription
      manager["subscriptions"].set(
        "ui://widget/weather",
        new Set(["session-1"])
      );

      await manager.notifyResourceUpdated("ui://widget/weather", sessions);

      expect(mockSendResourceUpdated).toHaveBeenCalledWith({
        uri: "ui://widget/weather",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "[MCP] Failed to send notification to session session-1: Error: Subscription closed"
      );
    });
  });
});
