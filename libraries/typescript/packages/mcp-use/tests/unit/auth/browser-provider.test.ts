import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser-provider.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// Mock browser APIs
const mockLocalStorage: Record<string, string> = {};
let mockWindow: any;

beforeEach(() => {
  // Mock localStorage
  mockLocalStorage = {};
  global.localStorage = {
    getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      mockLocalStorage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete mockLocalStorage[key];
    }),
    clear: vi.fn(() => {
      Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
    }),
    key: vi.fn((index: number) => {
      const keys = Object.keys(mockLocalStorage);
      return keys[index] || null;
    }),
    get length() {
      return Object.keys(mockLocalStorage).length;
    },
  } as any;

  // Mock window
  mockWindow = {
    location: {
      origin: "https://example.com",
      href: "https://example.com/test",
      search: "",
      pathname: "/test",
    },
    open: vi.fn(() => ({
      closed: false,
      focus: vi.fn(),
      postMessage: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  global.window = mockWindow;

  // Mock crypto
  global.crypto = {
    randomUUID: vi.fn(() => "test-uuid-123"),
  } as any;

  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
});

describe("BrowserOAuthClientProvider", () => {
  const serverUrl = "https://oauth.example.com";
  const defaultOptions = {
    storageKeyPrefix: "mcp:auth",
    clientName: "mcp-use",
    clientUri: "https://example.com",
    callbackUrl: "https://example.com/oauth/callback",
  };

  describe("constructor", () => {
    it("should create a provider with default options", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      expect(provider.serverUrl).toBe(serverUrl);
      expect(provider.storageKeyPrefix).toBe("mcp:auth");
      expect(provider.clientName).toBe("mcp-use");
      expect(provider.redirectUrl).toBe("https://example.com/oauth/callback");
    });

    it("should create a provider with custom options", () => {
      const options = {
        storageKeyPrefix: "custom:auth",
        clientName: "custom-client",
        clientUri: "https://custom.com",
        callbackUrl: "https://custom.com/callback",
      };
      const provider = new BrowserOAuthClientProvider(serverUrl, options);
      expect(provider.storageKeyPrefix).toBe("custom:auth");
      expect(provider.clientName).toBe("custom-client");
      expect(provider.clientUri).toBe("https://custom.com");
      expect(provider.redirectUrl).toBe("https://custom.com/callback");
    });

    it("should use window.location.origin when clientUri not provided", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      expect(provider.clientUri).toBe("https://example.com");
    });

    it("should use window.location for callbackUrl when not provided", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      expect(provider.callbackUrl).toBe("https://example.com/oauth/callback");
    });

    it("should set preventAutoAuth option", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        preventAutoAuth: true,
      });
      expect((provider as any).preventAutoAuth).toBe(true);
    });

    it("should set useRedirectFlow option", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        useRedirectFlow: true,
      });
      expect((provider as any).useRedirectFlow).toBe(true);
    });
  });

  describe("clientMetadata", () => {
    it("should return correct client metadata", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const metadata = provider.clientMetadata;
      expect(metadata.redirect_uris).toEqual(["https://example.com/oauth/callback"]);
      expect(metadata.token_endpoint_auth_method).toBe("none");
      expect(metadata.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(metadata.response_types).toEqual(["code"]);
      expect(metadata.client_name).toBe("mcp-use");
      expect(metadata.client_uri).toBe("https://example.com");
    });
  });

  describe("clientInformation", () => {
    it("should return undefined when no client information stored", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const info = await provider.clientInformation();
      expect(info).toBeUndefined();
    });

    it("should return stored client information", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
        client_secret: "test-secret",
      };
      await provider.saveClientInformation(clientInfo);
      const retrieved = await provider.clientInformation();
      expect(retrieved).toEqual(clientInfo);
    });

    it("should remove invalid client information from storage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const key = provider.getKey("client_info");
      mockLocalStorage[key] = "invalid-json";
      const info = await provider.clientInformation();
      expect(info).toBeUndefined();
      expect(mockLocalStorage[key]).toBeUndefined();
    });
  });

  describe("saveClientInformation", () => {
    it("should save client information to localStorage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
        client_secret: "test-secret",
      };
      await provider.saveClientInformation(clientInfo);
      const key = provider.getKey("client_info");
      expect(mockLocalStorage[key]).toBe(JSON.stringify(clientInfo));
    });
  });

  describe("tokens", () => {
    it("should return undefined when no tokens stored", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const tokens = await provider.tokens();
      expect(tokens).toBeUndefined();
    });

    it("should return stored tokens", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const tokens: OAuthTokens = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      };
      await provider.saveTokens(tokens);
      const retrieved = await provider.tokens();
      expect(retrieved).toEqual(tokens);
    });

    it("should remove invalid tokens from storage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const key = provider.getKey("tokens");
      mockLocalStorage[key] = "invalid-json";
      const tokens = await provider.tokens();
      expect(tokens).toBeUndefined();
      expect(mockLocalStorage[key]).toBeUndefined();
    });
  });

  describe("saveTokens", () => {
    it("should save tokens to localStorage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const tokens: OAuthTokens = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      };
      await provider.saveTokens(tokens);
      const key = provider.getKey("tokens");
      expect(mockLocalStorage[key]).toBe(JSON.stringify(tokens));
    });

    it("should clean up code verifier and last auth URL after saving tokens", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const codeVerifierKey = provider.getKey("code_verifier");
      const lastAuthUrlKey = provider.getKey("last_auth_url");
      mockLocalStorage[codeVerifierKey] = "verifier";
      mockLocalStorage[lastAuthUrlKey] = "https://auth.example.com";
      const tokens: OAuthTokens = {
        access_token: "access-token",
      };
      await provider.saveTokens(tokens);
      expect(mockLocalStorage[codeVerifierKey]).toBeUndefined();
      expect(mockLocalStorage[lastAuthUrlKey]).toBeUndefined();
    });
  });

  describe("codeVerifier", () => {
    it("should throw error when code verifier not found", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      await expect(provider.codeVerifier()).rejects.toThrow("Code verifier not found");
    });

    it("should return stored code verifier", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      await provider.saveCodeVerifier("test-verifier");
      const verifier = await provider.codeVerifier();
      expect(verifier).toBe("test-verifier");
    });
  });

  describe("saveCodeVerifier", () => {
    it("should save code verifier to localStorage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      await provider.saveCodeVerifier("test-verifier");
      const key = provider.getKey("code_verifier");
      expect(mockLocalStorage[key]).toBe("test-verifier");
    });
  });

  describe("prepareAuthorizationUrl", () => {
    it("should add state parameter to URL", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const url = new URL("https://auth.example.com/authorize");
      const authUrl = await provider.prepareAuthorizationUrl(url);
      expect(authUrl).toContain("state=test-uuid-123");
    });

    it("should store state data in localStorage", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const url = new URL("https://auth.example.com/authorize");
      await provider.prepareAuthorizationUrl(url);
      const stateKey = `mcp:auth:state_test-uuid-123`;
      expect(mockLocalStorage[stateKey]).toBeDefined();
      const stateData = JSON.parse(mockLocalStorage[stateKey]);
      expect(stateData.serverUrlHash).toBeDefined();
      expect(stateData.expiry).toBeGreaterThan(Date.now());
      expect(stateData.providerOptions.serverUrl).toBe(serverUrl);
    });

    it("should store last auth URL", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const url = new URL("https://auth.example.com/authorize");
      await provider.prepareAuthorizationUrl(url);
      const lastAuthUrlKey = provider.getKey("last_auth_url");
      expect(mockLocalStorage[lastAuthUrlKey]).toBeDefined();
    });

    it("should store returnUrl for redirect flow", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        useRedirectFlow: true,
      });
      const url = new URL("https://auth.example.com/authorize");
      await provider.prepareAuthorizationUrl(url);
      const stateKey = `mcp:auth:state_test-uuid-123`;
      const stateData = JSON.parse(mockLocalStorage[stateKey]);
      expect(stateData.returnUrl).toBe("https://example.com/test");
    });
  });

  describe("redirectToAuthorization", () => {
    it("should open popup window when preventAutoAuth is false", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        preventAutoAuth: false,
      });
      const url = new URL("https://auth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(mockWindow.open).toHaveBeenCalled();
    });

    it("should not open popup when preventAutoAuth is true", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        preventAutoAuth: true,
      });
      const url = new URL("https://auth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(mockWindow.open).not.toHaveBeenCalled();
    });

    it("should use redirect flow when useRedirectFlow is true", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        useRedirectFlow: true,
        preventAutoAuth: false,
      });
      const url = new URL("https://auth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(mockWindow.open).not.toHaveBeenCalled();
      expect(mockWindow.location.href).toBeDefined();
    });

    it("should call onPopupWindow callback if provided", async () => {
      const onPopupWindow = vi.fn();
      const provider = new BrowserOAuthClientProvider(serverUrl, {
        onPopupWindow,
        preventAutoAuth: false,
      });
      const url = new URL("https://auth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(onPopupWindow).toHaveBeenCalled();
    });
  });

  describe("getLastAttemptedAuthUrl", () => {
    it("should return null when no auth URL stored", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      expect(provider.getLastAttemptedAuthUrl()).toBeNull();
    });

    it("should return stored auth URL", async () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const url = new URL("https://auth.example.com/authorize");
      await provider.prepareAuthorizationUrl(url);
      const lastUrl = provider.getLastAttemptedAuthUrl();
      expect(lastUrl).toBeTruthy();
      expect(lastUrl).toContain("https://auth.example.com/authorize");
    });
  });

  describe("clearStorage", () => {
    it("should clear all storage keys for this provider", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const key1 = provider.getKey("tokens");
      const key2 = provider.getKey("client_info");
      mockLocalStorage[key1] = "value1";
      mockLocalStorage[key2] = "value2";
      mockLocalStorage["other_key"] = "value3";
      const count = provider.clearStorage();
      expect(count).toBe(2);
      expect(mockLocalStorage[key1]).toBeUndefined();
      expect(mockLocalStorage[key2]).toBeUndefined();
      expect(mockLocalStorage["other_key"]).toBe("value3");
    });

    it("should clear state keys for this provider", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const stateKey = `mcp:auth:state_test-state`;
      mockLocalStorage[stateKey] = JSON.stringify({
        serverUrlHash: provider.serverUrlHash,
        expiry: Date.now() + 60000,
      });
      const count = provider.clearStorage();
      expect(count).toBeGreaterThan(0);
      expect(mockLocalStorage[stateKey]).toBeUndefined();
    });
  });

  describe("getKey", () => {
    it("should generate correct storage key", () => {
      const provider = new BrowserOAuthClientProvider(serverUrl);
      const key = provider.getKey("tokens");
      expect(key).toContain("mcp:auth");
      expect(key).toContain("tokens");
      expect(key).toContain(provider.serverUrlHash);
    });
  });
});
