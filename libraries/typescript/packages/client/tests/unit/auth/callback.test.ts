// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredState } from "../../../src/auth/session-store.js";
import { LocalStorageKVStore } from "../../../src/auth/storage.js";

const mocks = vi.hoisted(() => ({
  finishAuth: vi.fn(),
  providerConstructor: vi.fn(),
  transportConstructor: vi.fn(),
  proxyFetch: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) {
      mocks.transportConstructor(url, options);
    }

    finishAuth(params: URLSearchParams) {
      return mocks.finishAuth(params);
    }
  },
}));

vi.mock("../../../src/auth/browser.js", () => ({
  BrowserOAuthClientProvider: class {
    constructor(serverUrl: string, options: unknown) {
      mocks.providerConstructor(serverUrl, options);
    }

    getProxyFetch() {
      return mocks.proxyFetch;
    }

    getKey(suffix: string) {
      return `mcp:auth_server-hash_${suffix}`;
    }
  },
}));

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

const state = "callback-state";
const stateKey = `custom:auth:state_${state}`;
const providerOptions: StoredState["providerOptions"] = {
  serverUrl: "https://mcp.example.com/mcp",
  storageKeyPrefix: "custom:auth",
  clientName: "Test client",
  clientUri: "https://app.example.com",
  callbackUrl: "https://app.example.com/oauth/callback",
  oauthProxyUrl: "https://app.example.com/inspector/api/oauth",
  clientMetadataUrl: "https://app.example.com/oauth/client-metadata.json",
  scope: "read write",
};

function storeState(overrides: Partial<StoredState> = {}) {
  localStorage.setItem(
    stateKey,
    JSON.stringify({
      expiry: Date.now() + 60_000,
      serverUrlHash: "server-hash",
      providerOptions,
      flowType: "popup",
      ...overrides,
    } satisfies StoredState)
  );
}

function setCallbackUrl(query: string) {
  window.history.replaceState({}, "", `/oauth/callback?${query}`);
}

describe("onMcpAuthorization", () => {
  const postMessage = vi.fn();
  const close = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mocks.finishAuth.mockReset().mockResolvedValue(undefined);
    mocks.providerConstructor.mockReset();
    mocks.transportConstructor.mockReset();
    mocks.proxyFetch.mockReset();
    vi.stubGlobal("localStorage", makeStorage());
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false, postMessage },
    });
    vi.spyOn(window, "close").mockImplementation(close);
    postMessage.mockReset();
    close.mockReset();
    setCallbackUrl(`code=authorization-code&state=${state}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent callback completion", async () => {
    storeState();
    let resolveFinish!: () => void;
    mocks.finishAuth.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFinish = resolve;
      })
    );
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    const first = onMcpAuthorization();
    const second = onMcpAuthorization();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(mocks.finishAuth).toHaveBeenCalledOnce());
    resolveFinish();
    await first;
  });

  it("rejects an unknown state before invoking the SDK", async () => {
    setCallbackUrl("code=authorization-code&state=wrong-state");
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    expect(mocks.finishAuth).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        state: "wrong-state",
        error: expect.stringContaining("Invalid or expired OAuth state"),
      }),
      window.location.origin
    );
  });

  it("rejects and removes expired state before invoking the SDK", async () => {
    storeState({ expiry: Date.now() - 1 });
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    expect(localStorage.getItem(stateKey)).toBeNull();
    expect(mocks.finishAuth).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("expired"),
      }),
      window.location.origin
    );
  });

  it("signals success after SDK callback completion", async () => {
    storeState();
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "mcp_auth_callback",
        success: true,
        state,
        serverUrlHash: "server-hash",
      },
      window.location.origin
    );
    expect(close).toHaveBeenCalledOnce();
    expect(localStorage.getItem(stateKey)).toBeNull();
  });

  it("returns the authorization response to the opener without exchanging it", async () => {
    storeState({ completeAuthorizationInOpener: true });
    setCallbackUrl(
      `code=authorization-code&iss=https%3A%2F%2Fauth.example.com&state=${state}`
    );
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    expect(mocks.providerConstructor).not.toHaveBeenCalled();
    expect(mocks.finishAuth).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "mcp_auth_callback",
        success: true,
        state,
        serverUrlHash: "server-hash",
        authorizationCode: "authorization-code",
        issuer: "https://auth.example.com",
      },
      window.location.origin
    );
    expect(localStorage.getItem(stateKey)).toBeNull();
  });

  it("decrypts a persisted state record before completing the callback", async () => {
    const storedState: StoredState = {
      expiry: Date.now() + 60_000,
      serverUrlHash: "server-hash",
      providerOptions,
      flowType: "popup",
    };
    await new LocalStorageKVStore().set(stateKey, JSON.stringify(storedState));
    expect(localStorage.getItem(stateKey)).not.toContain("serverUrlHash");

    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");
    await onMcpAuthorization();

    expect(mocks.finishAuth).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        state,
        serverUrlHash: "server-hash",
      }),
      window.location.origin
    );
    expect(localStorage.getItem(stateKey)).toBeNull();
  });

  it("lets the SDK interpret callback errors and signals the result", async () => {
    storeState();
    setCallbackUrl(
      `error=access_denied&error_description=No+thanks&state=${state}`
    );
    mocks.finishAuth.mockRejectedValue(new Error("No thanks"));
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    const callbackParams = mocks.finishAuth.mock
      .calls[0]?.[0] as URLSearchParams;
    expect(callbackParams.get("error")).toBe("access_denied");
    expect(callbackParams.get("error_description")).toBe("No thanks");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        state,
        serverUrlHash: "server-hash",
        error: "No thanks",
      }),
      window.location.origin
    );
  });

  it("rehydrates authoritative proxy options for SDK completion", async () => {
    storeState();
    const { onMcpAuthorization } =
      await import("../../../src/auth/callback.js");

    await onMcpAuthorization();

    const { serverUrl, ...expectedOptions } = providerOptions;
    expect(mocks.providerConstructor).toHaveBeenCalledWith(
      serverUrl,
      expectedOptions
    );
    expect(mocks.transportConstructor).toHaveBeenCalledWith(
      new URL(serverUrl),
      expect.objectContaining({ fetch: mocks.proxyFetch })
    );
  });
});
