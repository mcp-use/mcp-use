// @vitest-environment jsdom

/**
 * Tests for runAuthPopup — the opener-owned OAuth popup flow. The opener must
 * always reach one of four terminal outcomes (success / cancelled / timeout /
 * error) so the parent can never get stuck in "authenticating".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAuthPopup,
  MCP_AUTH_BROADCAST_CHANNEL,
  MCP_AUTH_CALLBACK_MESSAGE_TYPE,
  type McpAuthCallbackMessage,
} from "../../../src/auth/popup-runner.js";

const TOKENS_KEY = "mcp:auth_abc123_tokens";
const FLOW_STATE = "state-aaa";

/**
 * Minimal in-memory Storage. We stub `localStorage` with this rather than rely
 * on the ambient one: Node 25+ exposes a built-in global `localStorage` that
 * shadows jsdom's and lacks the full Storage surface, so a stub keeps the test
 * deterministic across Node/jsdom versions.
 */
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

/** Minimal popup stub: starts open, can be "closed" by the test. */
function makePopupStub(): { closed: boolean } {
  return { closed: false };
}

/** Post a result message through the window's `message` event listeners. */
function postCallbackMessage(
  payload: McpAuthCallbackMessage,
  origin = window.location.origin
) {
  window.dispatchEvent(new MessageEvent("message", { data: payload, origin }));
}

/** Simulate another document writing tokens to localStorage (storage event). */
function dispatchTokenStorageEvent(value: string | null = "{}") {
  window.dispatchEvent(
    new StorageEvent("storage", { key: TOKENS_KEY, newValue: value })
  );
}

describe("runAuthPopup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves success on a matching-state result message", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
    });

    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      state: FLOW_STATE,
    });

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("ignores result messages belonging to a different flow's state", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      timeoutMs: 1000,
    });

    // Wrong state — must be ignored.
    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      state: "some-other-flow",
    });

    // Nothing settled yet; advance to the timeout (no tokens stored).
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ kind: "timeout" });
  });

  it("accepts a state-less result message for back-compat", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
    });

    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
    });

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("resolves error on a failure result message", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
    });

    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: false,
      error: "access_denied",
      state: FLOW_STATE,
    });

    await expect(promise).resolves.toEqual({
      kind: "error",
      error: "access_denied",
    });
  });

  it("resolves success when a result arrives over BroadcastChannel", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
    });

    const channel = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
    channel.postMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      state: FLOW_STATE,
    } satisfies McpAuthCallbackMessage);

    await expect(promise).resolves.toEqual({ kind: "success" });
    channel.close();
  });

  it("resolves success on a storage event for the tokens key (severed-opener path)", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
    });

    dispatchTokenStorageEvent('{"access_token":"x"}');

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("resolves cancelled when the popup is closed without tokens", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      closePollMs: 100,
      closeGraceMs: 400,
    });

    popup.closed = true;
    // Closed detected on the poll, then the grace window before deciding.
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(400);

    await expect(promise).resolves.toEqual({ kind: "cancelled" });
  });

  it("resolves success when tokens land during the post-close grace window (COOP false-closed)", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      closePollMs: 100,
      closeGraceMs: 10000,
    });

    // COOP swap: WindowProxy reports closed while the real window is still
    // completing the flow.
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);

    // Tokens arrive a few seconds later via the storage event.
    await vi.advanceTimersByTimeAsync(3000);
    dispatchTokenStorageEvent('{"access_token":"x"}');

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("resolves success when a result message arrives during the post-close grace window", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      closePollMs: 100,
      closeGraceMs: 10000,
    });

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(3000);

    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      state: FLOW_STATE,
    });

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("resolves success when the popup closed but tokens already landed", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      closePollMs: 100,
    });

    // Popup persisted tokens then closed before its message dispatched.
    localStorage.setItem(TOKENS_KEY, '{"access_token":"x"}');
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("resolves timeout when nothing happens and no tokens are stored", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      timeoutMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ kind: "timeout" });
  });

  it("resolves success at timeout if tokens are present (missed message recovery)", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      timeoutMs: 5000,
    });

    localStorage.setItem(TOKENS_KEY, '{"access_token":"x"}');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("works with a null popup (blocked / out-of-band), relying on message/timeout", async () => {
    const promise = runAuthPopup({
      popup: null,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      timeoutMs: 2000,
    });

    postCallbackMessage({
      type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      state: FLOW_STATE,
    });

    await expect(promise).resolves.toEqual({ kind: "success" });
  });

  it("ignores result messages from an unexpected origin", async () => {
    const popup = makePopupStub();
    const promise = runAuthPopup({
      popup: popup as unknown as Window,
      state: FLOW_STATE,
      tokensKey: TOKENS_KEY,
      timeoutMs: 1000,
      expectedOrigin: "https://app.example.com",
    });

    postCallbackMessage(
      {
        type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
        success: true,
        state: FLOW_STATE,
      },
      "https://evil.example.com"
    );

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ kind: "timeout" });
  });
});
