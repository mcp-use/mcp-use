/**
 * Tests for React Host Adaptor Module
 *
 * Tests for host type detection, validation, and adaptor creation.
 * Note: Full React hook testing requires DOM environment (jsdom/happy-dom).
 * These tests focus on the non-React parts of the host adaptor system.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We need to mock window before importing the modules
const mockWindow = {
  mcpUse: undefined as { hostType?: string } | undefined,
  openai: undefined as object | undefined,
  parent: null as Window | null,
  location: {
    href: "http://localhost:3000",
    search: "",
  },
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  matchMedia: vi.fn(),
};

// Set up window mock before imports
vi.stubGlobal("window", mockWindow);

// Also stub localStorage globally (some code accesses it directly)
vi.stubGlobal("localStorage", mockWindow.localStorage);

// Now import the modules
import {
  detectHostType,
  createHostAdaptor,
  resetHostAdaptor,
  getHostAdaptor,
} from "../../../src/react/host/index.js";
import { StandaloneAdaptor } from "../../../src/react/host/standalone-adaptor.js";
import { AppsSdkAdaptor } from "../../../src/react/host/apps-sdk-adaptor.js";
import { McpAppAdaptor } from "../../../src/react/host/mcp-app-adaptor.js";

describe("Host Adaptor Module", () => {
  beforeEach(() => {
    // Reset mocks and adaptor instance before each test
    resetHostAdaptor();
    mockWindow.mcpUse = undefined;
    mockWindow.openai = undefined;
    mockWindow.parent = mockWindow as unknown as Window; // Same as window (not in iframe)
    mockWindow.location.search = "";
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetHostAdaptor();
  });

  describe("detectHostType", () => {
    it("should return 'standalone' when window.mcpUse.hostType is not set and not in iframe", () => {
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      expect(detectHostType()).toBe("standalone");
    });

    it("should return explicit hostType when set to valid value 'standalone'", () => {
      mockWindow.mcpUse = { hostType: "standalone" };

      expect(detectHostType()).toBe("standalone");
    });

    it("should return explicit hostType when set to valid value 'apps-sdk'", () => {
      mockWindow.mcpUse = { hostType: "apps-sdk" };

      expect(detectHostType()).toBe("apps-sdk");
    });

    it("should return explicit hostType when set to valid value 'mcp-app'", () => {
      mockWindow.mcpUse = { hostType: "mcp-app" };

      expect(detectHostType()).toBe("mcp-app");
    });

    it("should ignore invalid hostType values and fall back to detection", () => {
      mockWindow.mcpUse = { hostType: "invalid-type" };
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;

      // Should fall back to standalone since not in iframe and no openai
      expect(detectHostType()).toBe("standalone");
    });

    it("should detect 'apps-sdk' when window.openai is present", () => {
      mockWindow.openai = { toolInput: {} };
      mockWindow.mcpUse = undefined;

      expect(detectHostType()).toBe("apps-sdk");
    });

    it("should detect 'mcp-app' when in iframe without window.openai", () => {
      mockWindow.parent = {} as Window; // Different from window (in iframe)
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      expect(detectHostType()).toBe("mcp-app");
    });

    it("should prioritize explicit hostType over auto-detection", () => {
      mockWindow.mcpUse = { hostType: "standalone" };
      mockWindow.openai = { toolInput: {} }; // Would normally detect as apps-sdk

      expect(detectHostType()).toBe("standalone");
    });

    it("should prioritize window.openai over iframe detection", () => {
      mockWindow.parent = {} as Window; // In iframe
      mockWindow.openai = { toolInput: {} }; // But has openai
      mockWindow.mcpUse = undefined;

      expect(detectHostType()).toBe("apps-sdk");
    });
  });

  describe("createHostAdaptor", () => {
    it("should create StandaloneAdaptor for standalone host type", () => {
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      const adaptor = createHostAdaptor();

      expect(adaptor).toBeInstanceOf(StandaloneAdaptor);
    });

    it("should create AppsSdkAdaptor for apps-sdk host type", () => {
      mockWindow.openai = { toolInput: {} };
      mockWindow.mcpUse = undefined;

      const adaptor = createHostAdaptor();

      expect(adaptor).toBeInstanceOf(AppsSdkAdaptor);
    });

    it("should create McpAppAdaptor for mcp-app host type", () => {
      mockWindow.parent = {} as Window; // In iframe
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      const adaptor = createHostAdaptor();

      expect(adaptor).toBeInstanceOf(McpAppAdaptor);
    });

    it("should return the same instance on subsequent calls (singleton)", () => {
      mockWindow.parent = mockWindow as unknown as Window;

      const adaptor1 = createHostAdaptor();
      const adaptor2 = createHostAdaptor();

      expect(adaptor1).toBe(adaptor2);
    });

    it("should return null from getHostAdaptor before creation", () => {
      expect(getHostAdaptor()).toBeNull();
    });

    it("should return adaptor from getHostAdaptor after creation", () => {
      mockWindow.parent = mockWindow as unknown as Window;

      const created = createHostAdaptor();
      const retrieved = getHostAdaptor();

      expect(retrieved).toBe(created);
    });

    it("should reset adaptor instance with resetHostAdaptor", () => {
      mockWindow.parent = mockWindow as unknown as Window;

      createHostAdaptor();
      expect(getHostAdaptor()).not.toBeNull();

      resetHostAdaptor();
      expect(getHostAdaptor()).toBeNull();
    });

    it("should create adaptor with explicit hostType option", () => {
      // Set up environment that would normally detect as standalone
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      // But explicitly request mcp-app adaptor
      const adaptor = createHostAdaptor({ hostType: "mcp-app" });

      expect(adaptor).toBeInstanceOf(McpAppAdaptor);
      expect(adaptor.hostType).toBe("mcp-app");
    });

    it("should prioritize explicit hostType option over auto-detection", () => {
      // Set up environment that would detect as apps-sdk
      mockWindow.openai = { toolInput: {} };

      // But explicitly request standalone adaptor
      const adaptor = createHostAdaptor({ hostType: "standalone" });

      expect(adaptor).toBeInstanceOf(StandaloneAdaptor);
      expect(adaptor.hostType).toBe("standalone");
    });

    it("should prioritize explicit hostType option over window.mcpUse.hostType", () => {
      // Set up window.mcpUse.hostType
      mockWindow.mcpUse = { hostType: "apps-sdk" };
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;

      // But explicitly request mcp-app adaptor via parameter
      const adaptor = createHostAdaptor({ hostType: "mcp-app" });

      expect(adaptor).toBeInstanceOf(McpAppAdaptor);
      expect(adaptor.hostType).toBe("mcp-app");
    });

    it("should fall back to detectHostType when no explicit hostType provided", () => {
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;
      mockWindow.mcpUse = undefined;

      const adaptor = createHostAdaptor({});

      expect(adaptor).toBeInstanceOf(StandaloneAdaptor);
    });
  });

  describe("StandaloneAdaptor", () => {
    let adaptor: StandaloneAdaptor;

    beforeEach(() => {
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;
      mockWindow.location.search = "";
      mockWindow.localStorage.getItem.mockReturnValue(null);
      adaptor = new StandaloneAdaptor();
    });

    it("should report isAvailable as true when not in iframe", () => {
      mockWindow.parent = mockWindow as unknown as Window;
      mockWindow.openai = undefined;

      expect(adaptor.isAvailable()).toBe(true);
    });

    it("should report isAvailable as false when in iframe", () => {
      mockWindow.parent = {} as Window;

      expect(adaptor.isAvailable()).toBe(false);
    });

    it("should report isAvailable as false when window.openai exists", () => {
      mockWindow.openai = { toolInput: {} };

      expect(adaptor.isAvailable()).toBe(false);
    });

    it("should return 'standalone' for getHostType", () => {
      expect(adaptor.hostType).toBe("standalone");
    });

    it("should return undefined for getToolInput when no URL params", () => {
      mockWindow.location.search = "";

      expect(adaptor.getToolInput()).toBeUndefined();
    });

    it("should return null for getToolOutput initially", () => {
      expect(adaptor.getToolOutput()).toBeNull();
    });

    it("should return null for getWidgetState initially", () => {
      expect(adaptor.getWidgetState()).toBeNull();
    });

    it("should return 'light' theme by default when matchMedia is not available", () => {
      mockWindow.matchMedia = undefined as unknown as typeof window.matchMedia;

      const freshAdaptor = new StandaloneAdaptor();
      expect(freshAdaptor.getTheme()).toBe("light");
    });

    it("should return 'dark' theme when system prefers dark", () => {
      mockWindow.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const freshAdaptor = new StandaloneAdaptor();
      expect(freshAdaptor.getTheme()).toBe("dark");
    });

    it("should return 'light' theme when system prefers light", () => {
      mockWindow.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const freshAdaptor = new StandaloneAdaptor();
      expect(freshAdaptor.getTheme()).toBe("light");
    });

    it("should return 'inline' for getDisplayMode", () => {
      expect(adaptor.getDisplayMode()).toBe("inline");
    });

    it("should increment revision on subscribe callback", () => {
      const initialRevision = adaptor.getRevision();
      const callback = vi.fn();

      adaptor.subscribe(callback);

      // Revision should still be the same until state changes
      expect(adaptor.getRevision()).toBe(initialRevision);
    });

    it("should call subscriber callback when notified", async () => {
      const callback = vi.fn();
      adaptor.subscribe(callback);

      // Set widget state to trigger notification
      await adaptor.setWidgetState({ test: true });

      expect(callback).toHaveBeenCalled();
    });

    it("should unsubscribe correctly", async () => {
      const callback = vi.fn();
      const unsubscribe = adaptor.subscribe(callback);

      unsubscribe();

      // State change should not trigger callback after unsubscribe
      await adaptor.setWidgetState({ test: true });

      // Callback should only have been called from setWidgetState before unsubscribe
      // Actually, the callback is called during setWidgetState, then we unsubscribe
      // Let's reset and try again
      callback.mockClear();
      await adaptor.setWidgetState({ test: false });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should persist widget state to localStorage", async () => {
      await adaptor.setWidgetState({ foo: "bar" });

      expect(mockWindow.localStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining("mcp-use-widget-state"),
        expect.stringContaining("foo")
      );
    });
  });

  describe("AppsSdkAdaptor", () => {
    let adaptor: AppsSdkAdaptor;

    beforeEach(() => {
      mockWindow.openai = {
        toolInput: { city: "London" },
        toolOutput: { temperature: 20 },
        setWidgetState: vi.fn(),
      };
      adaptor = new AppsSdkAdaptor();
    });

    it("should report isAvailable as true when window.openai exists", () => {
      expect(adaptor.isAvailable()).toBe(true);
    });

    it("should report isAvailable as false when window.openai is undefined", () => {
      mockWindow.openai = undefined;
      const freshAdaptor = new AppsSdkAdaptor();

      expect(freshAdaptor.isAvailable()).toBe(false);
    });

    it("should return 'apps-sdk' for getHostType", () => {
      expect(adaptor.hostType).toBe("apps-sdk");
    });

    it("should return toolInput from window.openai", () => {
      expect(adaptor.getToolInput()).toEqual({ city: "London" });
    });

    it("should return toolOutput from window.openai", () => {
      expect(adaptor.getToolOutput()).toEqual({ temperature: 20 });
    });
  });

  describe("McpAppAdaptor", () => {
    let adaptor: McpAppAdaptor;

    beforeEach(() => {
      mockWindow.parent = {} as Window; // In iframe
      mockWindow.openai = undefined;
      adaptor = new McpAppAdaptor();
    });

    it("should report isAvailable as true when in iframe without openai", () => {
      expect(adaptor.isAvailable()).toBe(true);
    });

    it("should report isAvailable as false when not in iframe", () => {
      mockWindow.parent = mockWindow as unknown as Window;
      const freshAdaptor = new McpAppAdaptor();

      expect(freshAdaptor.isAvailable()).toBe(false);
    });

    it("should report isAvailable as false when window.openai exists", () => {
      mockWindow.openai = { toolInput: {} };
      const freshAdaptor = new McpAppAdaptor();

      expect(freshAdaptor.isAvailable()).toBe(false);
    });

    it("should return 'mcp-app' for getHostType", () => {
      expect(adaptor.hostType).toBe("mcp-app");
    });

    it("should return undefined for getToolInput before initialization", () => {
      expect(adaptor.getToolInput()).toBeUndefined();
    });

    it("should return null for getToolOutput before initialization", () => {
      expect(adaptor.getToolOutput()).toBeNull();
    });

    it("should return null for getWidgetState before initialization", () => {
      expect(adaptor.getWidgetState()).toBeNull();
    });
  });

  describe("Selective Subscriptions", () => {
    describe("StandaloneAdaptor", () => {
      let adaptor: StandaloneAdaptor;

      beforeEach(() => {
        mockWindow.parent = mockWindow as unknown as Window;
        mockWindow.openai = undefined;
        mockWindow.location.search = "";
        mockWindow.localStorage.getItem.mockReturnValue(null);
        adaptor = new StandaloneAdaptor();
      });

      it("should notify all-changes subscriber on any state change", async () => {
        const callback = vi.fn();
        adaptor.subscribe(callback);

        await adaptor.setWidgetState({ test: true });

        expect(callback).toHaveBeenCalledTimes(1);
      });

      it("should notify selective subscriber only when subscribed key changes", async () => {
        const widgetStateCallback = vi.fn();
        const themeCallback = vi.fn();

        adaptor.subscribe(["widgetState"], widgetStateCallback);
        adaptor.subscribe(["theme"], themeCallback);

        await adaptor.setWidgetState({ test: true });

        expect(widgetStateCallback).toHaveBeenCalledTimes(1);
        expect(themeCallback).not.toHaveBeenCalled();
      });

      it("should notify selective subscriber when any of multiple subscribed keys change", async () => {
        const callback = vi.fn();
        adaptor.subscribe(["widgetState", "theme"], callback);

        await adaptor.setWidgetState({ test: true });

        expect(callback).toHaveBeenCalledTimes(1);
      });

      it("should not notify selective subscriber when unsubscribed key changes", async () => {
        const callback = vi.fn();
        adaptor.subscribe(["theme"], callback);

        await adaptor.setWidgetState({ test: true });

        expect(callback).not.toHaveBeenCalled();
      });

      it("should unsubscribe selective subscriber correctly", async () => {
        const callback = vi.fn();
        const unsubscribe = adaptor.subscribe(["widgetState"], callback);

        unsubscribe();
        await adaptor.setWidgetState({ test: true });

        expect(callback).not.toHaveBeenCalled();
      });

      it("should support multiple selective subscribers for same key", async () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        adaptor.subscribe(["widgetState"], callback1);
        adaptor.subscribe(["widgetState"], callback2);

        await adaptor.setWidgetState({ test: true });

        expect(callback1).toHaveBeenCalledTimes(1);
        expect(callback2).toHaveBeenCalledTimes(1);
      });

      it("should handle mixed all-changes and selective subscribers", async () => {
        const allChangesCallback = vi.fn();
        const selectiveCallback = vi.fn();

        adaptor.subscribe(allChangesCallback);
        adaptor.subscribe(["theme"], selectiveCallback);

        await adaptor.setWidgetState({ test: true });

        // All-changes should be notified
        expect(allChangesCallback).toHaveBeenCalledTimes(1);
        // Selective should not (widgetState changed, not theme)
        expect(selectiveCallback).not.toHaveBeenCalled();
      });

      it("should notify toolInput subscriber when setToolInput is called", () => {
        const callback = vi.fn();
        adaptor.subscribe(["toolInput"], callback);

        adaptor.setToolInput({ city: "London" });

        expect(callback).toHaveBeenCalledTimes(1);
      });

      it("should notify toolResponseMetadata subscriber when setProps is called", () => {
        const callback = vi.fn();
        adaptor.subscribe(["toolResponseMetadata"], callback);

        adaptor.setProps({ color: "blue" });

        expect(callback).toHaveBeenCalledTimes(1);
      });
    });
  });
});
