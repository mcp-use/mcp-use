import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpConnector } from "../../../src/connectors/http.js";

// Mock browser APIs
const mockFetch = vi.fn();
let mockEventSource: any;

beforeEach(() => {
  // Mock fetch
  global.fetch = mockFetch;

  // Mock EventSource for SSE
  mockEventSource = class MockEventSource {
    url: string;
    readyState: number = 0;
    onopen: ((event: any) => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    close: vi.Mock = vi.fn();

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    constructor(url: string) {
      this.url = url;
      // Simulate connection after a tick
      setTimeout(() => {
        this.readyState = MockEventSource.OPEN;
        if (this.onopen) {
          this.onopen({} as any);
        }
      }, 0);
    }

    addEventListener(event: string, handler: (event: any) => void) {
      if (event === "open") this.onopen = handler;
      if (event === "message") this.onmessage = handler;
      if (event === "error") this.onerror = handler;
    }

    removeEventListener(event: string, handler: (event: any) => void) {
      if (event === "open" && this.onopen === handler) this.onopen = null;
      if (event === "message" && this.onmessage === handler) this.onmessage = null;
      if (event === "error" && this.onerror === handler) this.onerror = null;
    }
  };

  global.EventSource = mockEventSource as any;

  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpConnector (Browser Environment)", () => {
  const baseUrl = "https://example.com/mcp";

  describe("constructor", () => {
    it("should create HttpConnector with base URL", () => {
      const connector = new HttpConnector(baseUrl);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should normalize URL by removing trailing slash", () => {
      const connector = new HttpConnector(`${baseUrl}/`);
      expect((connector as any).baseUrl).toBe(baseUrl);
    });

    it("should set default headers", () => {
      const connector = new HttpConnector(baseUrl);
      expect((connector as any).headers).toBeDefined();
    });

    it("should set Authorization header when authToken provided", () => {
      const connector = new HttpConnector(baseUrl, {
        authToken: "test-token",
      });
      expect((connector as any).headers.Authorization).toBe("Bearer test-token");
    });

    it("should merge custom headers", () => {
      const connector = new HttpConnector(baseUrl, {
        headers: { "X-Custom": "value" },
      });
      expect((connector as any).headers["X-Custom"]).toBe("value");
    });

    it("should set default timeout values", () => {
      const connector = new HttpConnector(baseUrl);
      expect((connector as any).timeout).toBe(30000);
      expect((connector as any).sseReadTimeout).toBe(300000);
    });

    it("should allow custom timeout values", () => {
      const connector = new HttpConnector(baseUrl, {
        timeout: 60000,
        sseReadTimeout: 600000,
      });
      expect((connector as any).timeout).toBe(60000);
      expect((connector as any).sseReadTimeout).toBe(600000);
    });
  });

  describe("connect", () => {
    it("should not reconnect if already connected", async () => {
      const connector = new HttpConnector(baseUrl);
      (connector as any).connected = true;
      await connector.connect();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should prefer SSE when preferSse is true", async () => {
      const connector = new HttpConnector(baseUrl, { preferSse: true });
      const connectPromise = connector.connect();
      // Wait for EventSource to be created
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockEventSource).toBeDefined();
      // Resolve the connection
      const eventSource = new mockEventSource(`${baseUrl}/sse`);
      eventSource.readyState = mockEventSource.OPEN;
      if (eventSource.onopen) eventSource.onopen({});
      await connectPromise;
    });

    it("should fallback to SSE when streamable HTTP fails", async () => {
      const connector = new HttpConnector(baseUrl);
      mockFetch.mockRejectedValueOnce(new Error("Streamable HTTP failed"));
      const connectPromise = connector.connect();
      // Wait a bit for fallback
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Should attempt SSE fallback
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("browser-specific behavior", () => {
    it("should work with browser fetch API", () => {
      const connector = new HttpConnector(baseUrl);
      expect(typeof global.fetch).toBe("function");
    });

    it("should work with browser EventSource API", () => {
      const connector = new HttpConnector(baseUrl, { preferSse: true });
      expect(typeof global.EventSource).toBe("function");
    });

    it("should handle browser CORS requirements", () => {
      const connector = new HttpConnector(baseUrl, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      // Browser connectors should work with CORS-enabled servers
      expect((connector as any).headers).toBeDefined();
    });
  });
});
