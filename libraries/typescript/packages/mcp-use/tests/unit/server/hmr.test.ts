import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPServer } from "../../../src/server/index.js";

describe("HMR - syncRegistrationsFrom", () => {
  let server: MCPServer;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console to capture HMR logs (the actual output users see)
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getLogs = () => logSpy.mock.calls.map((call) => call.join(" "));
  const getErrors = () => errorSpy.mock.calls.map((call) => call.join(" "));
  const getDebugLogs = () => debugSpy.mock.calls.map((call) => call.join(" "));

  describe("Tool Registration", () => {
    it("should add new tools and log the change", () => {
      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "new-tool",
          description: "A new tool",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      const initialToolCount = server.registrations.tools.size;

      // Sync registrations (triggers HMR)
      server.syncRegistrationsFrom(otherServer);

      // Verify registration was added
      expect(server.registrations.tools.size).toBe(initialToolCount + 1);
      expect(server.registrations.tools.has("new-tool")).toBe(true);

      // Verify HMR logs (what users see in terminal)
      const logs = getLogs();
      expect(
        logs.some((log) => log.includes("[HMR] Registration changes:"))
      ).toBe(true);
      expect(logs.some((log) => log.includes("+ Tools: new-tool"))).toBe(true);
    });

    it("should update existing tools and log the change", () => {
      // Add initial tool
      server.tool(
        {
          name: "existing-tool",
          description: "Original description",
        },
        async () => ({ content: [{ type: "text" as const, text: "old" }] })
      );

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "existing-tool",
          description: "Updated description",
        },
        async () => ({ content: [{ type: "text" as const, text: "new" }] })
      );

      logSpy.mockClear();
      server.syncRegistrationsFrom(otherServer);

      // Verify registration was updated
      const toolReg = server.registrations.tools.get("existing-tool");
      expect(toolReg?.config.description).toBe("Updated description");

      // Verify HMR logs show update (not add)
      const logs = getLogs();
      expect(logs.some((log) => log.includes("~ Tools: existing-tool"))).toBe(
        true
      );
    });

    it("should inject new tools into active sessions", () => {
      // Create a mock session (simulating connected client)
      const mockSession = {
        id: "test-session",
        server: {
          _registeredTools: {},
          sendToolListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "injected-tool",
          description: "Tool to inject",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      server.syncRegistrationsFrom(otherServer);

      // Verify tool was injected into active session
      const nativeServer = mockSession.server as any;
      expect(nativeServer._registeredTools["injected-tool"]).toBeDefined();
      expect(nativeServer._registeredTools["injected-tool"].description).toBe(
        "Tool to inject"
      );

      // Verify notification was sent
      expect(mockSession.server.sendToolListChanged).toHaveBeenCalled();
    });

    it("should preserve widget tools during sync", () => {
      // Simulate a widget tool (registered by the widget system)
      server.registrations.tools.set("widget-tool", {
        config: {
          name: "widget-tool",
          description: "A widget tool",
        },
        handler: async () => ({ content: [] }),
      } as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "regular-tool",
          description: "A regular tool",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      // Sync should not remove widget-tool (HMR doesn't remove)
      server.syncRegistrationsFrom(otherServer);

      expect(server.registrations.tools.has("widget-tool")).toBe(true);
      expect(server.registrations.tools.has("regular-tool")).toBe(true);
    });
  });

  describe("Prompt Registration", () => {
    it("should add new prompts and log the change", () => {
      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.prompt(
        {
          name: "new-prompt",
          description: "A new prompt",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      const initialPromptCount = server.registrations.prompts.size;

      server.syncRegistrationsFrom(otherServer);

      // Verify registration was added
      expect(server.registrations.prompts.size).toBe(initialPromptCount + 1);
      expect(server.registrations.prompts.has("new-prompt")).toBe(true);

      // Verify HMR logs
      const logs = getLogs();
      expect(logs.some((log) => log.includes("+ Prompts: new-prompt"))).toBe(
        true
      );
    });

    it("should inject new prompts into active sessions", () => {
      const mockSession = {
        id: "test-session",
        server: {
          _registeredPrompts: {},
          sendPromptListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.prompt(
        {
          name: "injected-prompt",
          description: "Prompt to inject",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      server.syncRegistrationsFrom(otherServer);

      // Verify prompt was injected
      const nativeServer = mockSession.server as any;
      expect(nativeServer._registeredPrompts["injected-prompt"]).toBeDefined();

      // Verify notification was sent
      expect(mockSession.server.sendPromptListChanged).toHaveBeenCalled();
    });
  });

  describe("Resource Registration", () => {
    it("should add new resources and log the change", () => {
      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.resource(
        {
          name: "new-resource",
          uri: "test://resource",
          description: "A new resource",
        },
        async () => ({ contents: [{ uri: "test://resource", text: "test" }] })
      );

      const initialResourceCount = server.registrations.resources.size;

      server.syncRegistrationsFrom(otherServer);

      // Verify registration was added
      expect(server.registrations.resources.size).toBe(
        initialResourceCount + 1
      );
      expect(
        server.registrations.resources.has("new-resource:test://resource")
      ).toBe(true);

      // Verify HMR logs
      const logs = getLogs();
      expect(
        logs.some((log) =>
          log.includes("+ Resources: new-resource:test://resource")
        )
      ).toBe(true);
    });

    it("should inject new resources into active sessions", () => {
      const mockSession = {
        id: "test-session",
        server: {
          _registeredResources: {},
          sendResourceListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.resource(
        {
          name: "injected-resource",
          uri: "test://injected",
          description: "Resource to inject",
        },
        async () => ({ contents: [{ uri: "test://injected", text: "test" }] })
      );

      server.syncRegistrationsFrom(otherServer);

      // Verify resource was injected
      const nativeServer = mockSession.server as any;
      expect(
        nativeServer._registeredResources["injected-resource:test://injected"]
      ).toBeDefined();

      // Verify notification was sent
      expect(mockSession.server.sendResourceListChanged).toHaveBeenCalled();
    });
  });

  describe("Notification Sending", () => {
    it("should send tool list changed notification when tools are added", () => {
      const sendToolListChanged = vi.fn();
      const mockSession = {
        id: "test-session",
        server: {
          _registeredTools: {},
          sendToolListChanged,
          sendPromptListChanged: vi.fn(),
          sendResourceListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "new-tool",
          description: "New tool",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      server.syncRegistrationsFrom(otherServer);

      // Verify notification was sent
      expect(sendToolListChanged).toHaveBeenCalled();
    });

    it("should not send notification if no changes detected", () => {
      const sendToolListChanged = vi.fn();
      const mockSession = {
        id: "test-session",
        server: {
          _registeredTools: {},
          sendToolListChanged,
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      logSpy.mockClear();
      server.syncRegistrationsFrom(otherServer);

      // Verify no notification sent
      expect(sendToolListChanged).not.toHaveBeenCalled();

      // Verify log says no changes
      const logs = getLogs();
      expect(
        logs.some((log) =>
          log.includes("[HMR] No registration changes detected")
        )
      ).toBe(true);
    });

    it("should handle notification errors gracefully and log debug message", () => {
      const sendToolListChanged = vi.fn().mockImplementation(() => {
        throw new Error("Notification not supported");
      });

      const mockSession = {
        id: "test-session",
        server: {
          _registeredTools: {},
          sendToolListChanged,
          sendPromptListChanged: vi.fn(),
          sendResourceListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "new-tool",
          description: "New tool",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      // Should not throw
      expect(() => {
        server.syncRegistrationsFrom(otherServer);
      }).not.toThrow();

      // Verify debug log was written
      const debugLogs = getDebugLogs();
      expect(
        debugLogs.some((log) =>
          log.includes("Failed to send tools/list_changed")
        )
      ).toBe(true);
      expect(debugLogs.some((log) => log.includes("test-session"))).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle injection errors gracefully and log error", () => {
      const mockSession = {
        id: "bad-session",
        server: {} as any, // Missing _registeredTools
      };

      server.sessions.set("bad-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "tool-to-fail",
          description: "This should fail to inject",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      // Should not throw
      expect(() => {
        server.syncRegistrationsFrom(otherServer);
      }).not.toThrow();

      // Verify error was logged
      const errors = getErrors();
      expect(
        errors.some((log) =>
          log.includes('Failed to inject tool "tool-to-fail"')
        )
      ).toBe(true);
      expect(errors.some((log) => log.includes("bad-session"))).toBe(true);
      expect(
        errors.some((log) =>
          log.includes("Native server missing _registeredTools object")
        )
      ).toBe(true);
    });
  });

  describe("Registered Entry Methods", () => {
    it("should create entries with enable/disable/remove/update methods", () => {
      const mockSession = {
        id: "test-session",
        server: {
          _registeredTools: {},
          sendToolListChanged: vi.fn(),
        } as any,
      };

      server.sessions.set("test-session", mockSession as any);

      const otherServer = new MCPServer({
        name: "other-server",
        version: "1.0.0",
      });

      otherServer.tool(
        {
          name: "method-test-tool",
          description: "Test tool methods",
        },
        async () => ({ content: [{ type: "text" as const, text: "test" }] })
      );

      server.syncRegistrationsFrom(otherServer);

      const nativeServer = mockSession.server as any;
      const toolEntry = nativeServer._registeredTools["method-test-tool"];

      // Verify methods exist
      expect(toolEntry).toBeDefined();
      expect(typeof toolEntry.enable).toBe("function");
      expect(typeof toolEntry.disable).toBe("function");
      expect(typeof toolEntry.remove).toBe("function");
      expect(typeof toolEntry.update).toBe("function");

      // Test enable/disable
      expect(toolEntry.enabled).toBe(true);
      toolEntry.disable();
      expect(toolEntry.enabled).toBe(false);
      toolEntry.enable();
      expect(toolEntry.enabled).toBe(true);

      // Test update
      toolEntry.update({ description: "Updated description" });
      expect(toolEntry.description).toBe("Updated description");

      // Test remove
      toolEntry.remove();
      expect(nativeServer._registeredTools["method-test-tool"]).toBeUndefined();
    });
  });

  describe("Real-world HMR Scenarios", () => {
    it("should handle typical development workflow: edit tool description", () => {
      // Initial state
      server.tool(
        {
          name: "api-call",
          description: "Makes an API call",
        },
        async () => ({ content: [{ type: "text" as const, text: "result" }] })
      );

      // Developer edits the file and changes description
      const updatedServer = new MCPServer({
        name: "updated",
        version: "1.0.0",
      });

      updatedServer.tool(
        {
          name: "api-call",
          description: "Makes an API call with retry logic",
        },
        async () => ({ content: [{ type: "text" as const, text: "result" }] })
      );

      logSpy.mockClear();
      server.syncRegistrationsFrom(updatedServer);

      // Verify logs show the update
      const logs = getLogs();
      expect(
        logs.some((log) => log.includes("[HMR] Registration changes:"))
      ).toBe(true);
      expect(logs.some((log) => log.includes("~ Tools: api-call"))).toBe(true);

      // Verify the tool was updated
      const tool = server.registrations.tools.get("api-call");
      expect(tool?.config.description).toBe(
        "Makes an API call with retry logic"
      );
    });

    it("should handle adding multiple new capabilities at once", () => {
      const updatedServer = new MCPServer({
        name: "updated",
        version: "1.0.0",
      });

      updatedServer.tool(
        { name: "tool-a", description: "Tool A" },
        async () => ({ content: [{ type: "text" as const, text: "a" }] })
      );

      updatedServer.tool(
        { name: "tool-b", description: "Tool B" },
        async () => ({ content: [{ type: "text" as const, text: "b" }] })
      );

      updatedServer.prompt(
        { name: "prompt-a", description: "Prompt A" },
        async () => ({ content: [{ type: "text" as const, text: "a" }] })
      );

      logSpy.mockClear();
      server.syncRegistrationsFrom(updatedServer);

      // Verify all were added
      expect(server.registrations.tools.has("tool-a")).toBe(true);
      expect(server.registrations.tools.has("tool-b")).toBe(true);
      expect(server.registrations.prompts.has("prompt-a")).toBe(true);

      // Verify logs show all additions (tools are listed on one line)
      const logs = getLogs();
      const toolsLog = logs.find((log) => log.includes("+ Tools:"));
      expect(toolsLog).toBeDefined();
      expect(toolsLog).toContain("tool-a");
      expect(toolsLog).toContain("tool-b");
      expect(logs.some((log) => log.includes("+ Prompts: prompt-a"))).toBe(
        true
      );
    });
  });
});
