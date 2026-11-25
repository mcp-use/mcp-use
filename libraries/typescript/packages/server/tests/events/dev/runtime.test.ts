import { afterEach, describe, expect, it } from "vitest";
import {
  activeEventsDev,
  adaptEventBus,
  eventsDevInfo,
  installEventsDev,
  resetEventsDev,
} from "../../../src/events/dev/index.js";

const base = {
  stateDir: "/tmp/proj/.mcp-use/state",
  devPort: 3000,
  basePath: "/mcp",
  token: "tok-1",
};

afterEach(() => resetEventsDev());

describe("dev runtime", () => {
  it("survives re-evaluation: one runtime per state dir, generation advances", () => {
    const first = installEventsDev(base);
    const second = installEventsDev({ ...base, token: "tok-2" });
    expect(second).toBe(first);
    expect(second.generation).toBe(2);
    expect(eventsDevInfo()).toEqual({
      stateDir: "/tmp/proj/.mcp-use/state",
      generation: 2,
      tokenAvailable: true,
      publicOrigin: null,
    });
    expect(second.storeDir).toBe("/tmp/proj/.mcp-use/state/events");
  });

  it("verifies the dev token", () => {
    const rt = installEventsDev(base);
    expect(rt.verifyToken("tok-1")).toBe(true);
    expect(rt.verifyToken("tok-2")).toBe(false);
    expect(rt.verifyToken(null)).toBe(false);
  });

  it("gives the dev principal only to local requests on no-OAuth servers", () => {
    const rt = installEventsDev({
      ...base,
      publicOrigin: "https://abc.tunnel.dev",
    });
    const local = new Request("http://localhost:3000/mcp");
    const tunnel = new Request("http://localhost:3000/mcp", {
      headers: { host: "abc.tunnel.dev" },
    });
    expect(rt.principalFor(local, { oauth: false })).toBe("dev|local");
    expect(rt.principalFor(local, { oauth: true })).toBe(undefined);
    expect(rt.principalFor(tunnel, { oauth: false })).toBe(undefined);
  });

  it("refuses loopback callbacks through the tunnel and trusts the local inbox", () => {
    const rt = installEventsDev({
      ...base,
      publicOrigin: "https://abc.tunnel.dev",
    });
    const local = new Request("http://localhost:3000/mcp");
    const tunnel = new Request("http://x/mcp", {
      headers: { host: "abc.tunnel.dev" },
    });
    const inbox = "http://localhost:3000/mcp/inspector/api/events/hooks/h1";
    expect(rt.trustedCallbackPrefix()).toBe(
      "http://localhost:3000/mcp/inspector/api/events/hooks/"
    );
    expect(rt.checkCallbackUrl(inbox, local)).toEqual({
      ok: true,
      trusted: true,
    });
    expect(rt.checkCallbackUrl("http://localhost:5432/", local)).toEqual({
      ok: true,
      trusted: false,
    });
    expect(rt.checkCallbackUrl(inbox, tunnel)).toEqual({
      ok: false,
      reason: "loopback_via_tunnel",
    });
    expect(rt.checkCallbackUrl("https://example.com/hook", tunnel)).toEqual({
      ok: true,
      trusted: false,
    });
  });

  it("closes streams of older generations on a hot reload (X-17)", () => {
    const rt = installEventsDev(base);
    const closed: string[] = [];
    rt.trackStream(1, (r) => closed.push(`a:${r}`));
    const untrack = rt.trackStream(1, (r) => closed.push(`b:${r}`));
    untrack();
    installEventsDev(base);
    rt.trackStream(2, (r) => closed.push(`c:${r}`));
    expect(closed).toEqual(["a:hot_reload"]);
  });

  it("signals list_changed only when the catalog hash changes", () => {
    const rt = installEventsDev(base);
    const seen: string[] = [];
    rt.onCatalogChanged((c) => seen.push(`${c.previousHash}->${c.hash}`));
    expect(rt.publishCatalog(1, "h1")).toBe(false);
    installEventsDev(base);
    expect(rt.publishCatalog(2, "h1")).toBe(false);
    installEventsDev(base);
    expect(rt.publishCatalog(3, "h2")).toBe(true);
    expect(rt.publishCatalog(2, "h9")).toBe(false);
    expect(seen).toEqual(["h1->h2"]);
  });

  it("rejects non-plain options", () => {
    expect(() =>
      installEventsDev({ ...base, devPort: "3000" } as never)
    ).toThrow(TypeError);
    expect(activeEventsDev()).toBe(undefined);
  });
});

describe("McpUseEventBus adapter", () => {
  it("adapts any structural bus and isolates listener errors", () => {
    const listeners = new Set<(e: unknown) => void>();
    const foreign = {
      publish: (e: unknown) => listeners.forEach((l) => l(e)),
      subscribe: (l: (e: unknown) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const errors: unknown[] = [];
    const bus = adaptEventBus(foreign, (e) => errors.push(e));
    const got: unknown[] = [];
    const off = bus.subscribe((e) => got.push(e));
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.publish({ type: "tools/list_changed" });
    off();
    off();
    bus.publish({ type: "x" });
    expect(got).toEqual([{ type: "tools/list_changed" }]);
    expect(errors.length).toBe(2);
    expect(() => adaptEventBus({ publish() {} })).toThrow(TypeError);
  });
});
