import {
  cancelledRequestId,
  cancelRequest,
  onAbort,
  requesterScope,
  watchCancellation,
} from "../src/cancel.js";
import { resetAnalytics } from "./helpers/state.js";

afterEach(async () => {
  await resetAnalytics();
});

function headers(
  values: Record<string, string>
): (name: string) => string | undefined {
  return (name) => values[name];
}

describe("stateless cancellation", () => {
  it("cancels the one request with that id from the same requester", () => {
    const alice = requesterScope(headers({ authorization: "Bearer a" }));
    const bob = requesterScope(headers({ authorization: "Bearer b" }));
    const cancelled: string[] = [];
    const stopAlice = watchCancellation(1, alice, () =>
      cancelled.push("alice")
    );
    watchCancellation(1, bob, () => cancelled.push("bob"));
    watchCancellation("1", alice, () => cancelled.push("alice-string-id"));

    cancelRequest(1, alice);
    expect(cancelled).toEqual(["alice"]);
    // Once cancelled (or settled), it is no longer watched.
    cancelRequest(1, alice);
    stopAlice();
    expect(cancelled).toEqual(["alice"]);
  });

  it("cancels nothing when the requester cannot be told apart", () => {
    const scope = requesterScope(headers({ "user-agent": "node" }));
    const cancelled: number[] = [];
    watchCancellation(3, scope, () => cancelled.push(1));
    watchCancellation(3, scope, () => cancelled.push(2));
    cancelRequest(3, scope);
    expect(cancelled).toEqual([]);
  });

  it("stops watching a settled request", () => {
    const scope = requesterScope(headers({}));
    const cancel = vi.fn();
    const stop = watchCancellation(5, scope, cancel);
    stop();
    stop();
    cancelRequest(5, scope);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("tells requesters apart by credentials, user agent and forwarding headers", () => {
    const base = { authorization: "Bearer a", "user-agent": "claude" };
    expect(requesterScope(headers(base))).toBe(requesterScope(headers(base)));
    const variants: Array<Record<string, string>> = [
      { authorization: "Bearer b" },
      { "user-agent": "cursor" },
      { "x-forwarded-for": "203.0.113.9" },
      { "cf-connecting-ip": "203.0.113.9" },
    ];
    for (const extra of variants) {
      expect(requesterScope(headers({ ...base, ...extra }))).not.toBe(
        requesterScope(headers(base))
      );
    }
  });

  it("reads the request id of notifications/cancelled only", () => {
    expect(
      cancelledRequestId({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 4, reason: "x" },
      })
    ).toBe(4);
    expect(
      cancelledRequestId({
        method: "notifications/cancelled",
        params: { requestId: "a" },
      })
    ).toBe("a");
    for (const message of [
      { method: "notifications/cancelled", params: {} },
      { method: "notifications/cancelled", id: 1, params: { requestId: 4 } },
      { method: "notifications/progress", params: { requestId: 4 } },
      null,
      "notifications/cancelled",
    ]) {
      expect(cancelledRequestId(message)).toBeUndefined();
    }
  });
});

describe("onAbort", () => {
  it("fires once when any signal aborts and stops listening afterwards", () => {
    const a = new AbortController();
    const b = new AbortController();
    const listener = vi.fn();
    onAbort([a.signal, b.signal, undefined, {}], listener);
    b.abort();
    a.abort();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires at once for an already aborted signal and never after stop()", () => {
    const listener = vi.fn();
    onAbort([AbortSignal.abort()], listener);
    expect(listener).toHaveBeenCalledTimes(1);

    const later = new AbortController();
    const other = vi.fn();
    const stop = onAbort([later.signal, later.signal], other);
    stop();
    later.abort();
    expect(other).not.toHaveBeenCalled();
  });
});
