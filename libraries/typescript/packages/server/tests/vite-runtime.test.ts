import { describe, expect, it, vi } from "vitest";
import { createDevRuntime } from "../src/vite/dev-runtime.js";

function instance(value: string) {
  return {
    fetch: vi.fn(async () => new Response(value)),
    close: vi.fn(async () => {}),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const request = () => new Request("http://localhost/api/mcp");

describe("MCP development lifecycle", () => {
  it("keeps the active instance during loading and errors, then closes it on a successful update", async () => {
    const first = instance("first");
    const next = instance("next");
    const pending = deferred<typeof first>();
    const load = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("syntax error"))
      .mockReturnValueOnce(pending.promise);
    const report = vi.fn();
    const runtime = createDevRuntime(load, report);
    await runtime.reload();
    await runtime.reload();
    expect(await (await runtime.fetch(request())).text()).toBe("first");
    expect(first.close).not.toHaveBeenCalled();
    const update = runtime.reload();
    expect(await (await runtime.fetch(request())).text()).toBe("first");
    pending.resolve(next);
    await update;
    expect(first.close).toHaveBeenCalledOnce();
    expect(await (await runtime.fetch(request())).text()).toBe("next");
    await runtime.close();
    expect(next.close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
  });

  it("discards superseded candidates and never publishes a candidate after shutdown", async () => {
    const stale = instance("stale");
    const latest = instance("latest");
    const pending = deferred<typeof stale>();
    const load = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(latest);
    const runtime = createDevRuntime(load, vi.fn());
    const first = runtime.reload();
    const second = runtime.reload();
    pending.resolve(stale);
    await Promise.all([first, second]);
    expect(stale.close).toHaveBeenCalledOnce();
    expect(await (await runtime.fetch(request())).text()).toBe("latest");
    const final = deferred<typeof stale>();
    load.mockReturnValueOnce(final.promise);
    const update = runtime.reload();
    const close = runtime.close();
    const abandoned = instance("abandoned");
    final.resolve(abandoned);
    await Promise.all([update, close]);
    expect(abandoned.close).toHaveBeenCalledOnce();
    expect(latest.close).toHaveBeenCalledOnce();
    expect((await runtime.fetch(request())).status).toBe(503);
  });
});
