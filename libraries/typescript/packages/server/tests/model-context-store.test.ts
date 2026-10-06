import type { App } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it, vi } from "vitest";
import { ModelContextStore } from "../src/react/runtime/model-context-store.js";
import type { ContextPayload } from "../src/react/runtime/model-context.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function fixture() {
  const writes: ContextPayload[] = [];
  const responses: ReturnType<typeof deferred>[] = [];
  const app = {
    getHostCapabilities: () => ({ updateModelContext: { text: {} } }),
    updateModelContext: (payload: ContextPayload) => {
      writes.push(payload);
      const response = deferred();
      responses.push(response);
      return response.promise;
    },
  } as unknown as App;
  return {
    store: new ModelContextStore({ connect: async () => app }),
    writes,
    responses,
  };
}

describe("ModelContextStore contribution coordinator", () => {
  it("rejects identical Unicode-key metadata regardless of insertion order", async () => {
    const { store, responses } = fixture();
    const add = store.addAttachment("a", {
      type: "text",
      text: "A",
      _meta: { é: 1, "e\u0301": 2 },
    });
    const duplicate = expect(
      store.addAttachment("b", {
        type: "text",
        text: "A",
        _meta: { "e\u0301": 2, é: 1 },
      })
    ).rejects.toThrow("identical");
    await tick();
    responses[0]!.resolve();
    await add;
    await duplicate;
  });

  it("lets the newer publication settle its waiter after an older write fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { store, writes, responses } = fixture();
      const first = store.addAttachment("a", { type: "text", text: "A" });
      const failed = expect(first).rejects.toThrow("denied");
      await tick();
      const outcomes: string[] = [];
      const second = store.addAttachment("b", { type: "text", text: "B" });
      void second.then(
        (result) => outcomes.push(result.status),
        () => outcomes.push("rejected")
      );
      responses[0]!.reject(new Error("denied"));
      await failed;
      await tick();
      expect(writes).toHaveLength(2);
      expect(outcomes).toEqual([]);
      responses[1]!.resolve();
      await expect(second).resolves.toEqual({ status: "synced" });
    } finally {
      warning.mockRestore();
    }
  });

  it("ignores pre-reset acknowledgements when the next test publishes equal content", async () => {
    const { store, writes, responses } = fixture();
    const old = store.addAttachment("a", { type: "text", text: "A" });
    const cancelled = expect(old).rejects.toThrow("reset");
    await tick();
    store.resetForTesting();
    await cancelled;
    responses[0]!.resolve();
    await tick();
    const fresh = store.addAttachment("a", { type: "text", text: "A" });
    await tick();
    expect(writes).toHaveLength(2);
    responses[1]!.resolve();
    await expect(fresh).resolves.toEqual({ status: "synced" });
  });

  it("coalesces different keys with state and descriptions, and clears only attachments", async () => {
    const { store, writes, responses } = fixture();
    store.initializeViewState({ sort: "price" });
    store.setNode({ id: "same", parentId: null, content: "Catalog" });
    const first = store.addAttachment("same", {
      type: "text",
      text: "summary",
    });
    const second = store.addAttachment("photo", {
      type: "image",
      data: "aA==",
      mimeType: "image/png",
    });
    expect(store.getSnapshot().pending).toBe(true);
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.content).toHaveLength(3);
    expect(writes[0]!.structuredContent).toEqual({
      sort: "price",
      _uiContext: "- Catalog",
    });
    expect(writes[0]!.content[0]).not.toHaveProperty("annotations");
    responses[0]!.resolve();
    expect(await first).toEqual({ status: "synced" });
    expect(await second).toEqual({ status: "synced" });
    const clear = store.clearAttachments();
    await tick();
    expect(writes[1]!.content).toHaveLength(1);
    expect(writes[1]!.structuredContent).toEqual(writes[0]!.structuredContent);
    responses[1]!.resolve();
    await clear;
  });

  it("reports same-key supersession and preserves immutable in-flight payloads", async () => {
    const { store, writes, responses } = fixture();
    const state = { nested: { count: 1 } };
    store.initializeViewState(state);
    const first = store.addAttachment("a", { type: "text", text: "old" });
    await tick();
    const second = store.addAttachment("a", { type: "text", text: "new" });
    state.nested.count = 2;
    store.updateViewState(() => state);
    expect(await first).toEqual({ status: "superseded" });
    responses[0]!.resolve();
    await tick();
    expect(writes[0]!.structuredContent?.nested).toEqual({ count: 1 });
    expect(writes[1]!.structuredContent?.nested).toEqual({ count: 2 });
    expect(store.getSnapshot().pending).toBe(true);
    responses[1]!.resolve();
    expect(await second).toEqual({ status: "synced" });
    expect(store.getSnapshot().pending).toBe(false);
  });

  it("settles adds removed before dispatch and rejects indistinguishable duplicate blocks", async () => {
    const { store, writes, responses } = fixture();
    const add = store.addAttachment("a", { type: "text", text: "A" });
    const duplicate = expect(
      store.addAttachment("b", { type: "text", text: "A" })
    ).rejects.toThrow("identical");
    const remove = store.removeAttachment("a");
    await duplicate;
    expect(await add).toEqual({ status: "superseded" });
    await tick();
    responses[0]!.resolve();
    await remove;
    expect(writes[0]!.content).toHaveLength(1);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("retains failed desired entries and retries the latest snapshot explicitly", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, writes, responses } = fixture();
    const add = store.addAttachment("a", { type: "text", text: "A" });
    const rejected = expect(add).rejects.toThrow("denied");
    await tick();
    responses[0]!.reject(new Error("denied"));
    await rejected;
    await tick();
    expect(store.getSnapshot()).toMatchObject({
      pending: false,
      error: new Error("denied"),
    });
    const retry = store.retry();
    expect(store.getSnapshot()).toMatchObject({ pending: true, error: null });
    await tick();
    expect(writes[1]!).toEqual(writes[0]!);
    responses[1]!.resolve();
    await retry;
    warning.mockRestore();
  });

  it("does not acknowledge an empty clear or retry from an older in-flight add", async () => {
    const { store, responses } = fixture();
    const add = store.addAttachment("a", { type: "text", text: "A" });
    await tick();
    const remove = store.removeAttachment("a");
    const clear = store.clearAttachments();
    const retry = store.retry();
    let cleared = false;
    let retried = false;
    void clear.then(() => {
      cleared = true;
    });
    void retry.then(() => {
      retried = true;
    });
    responses[0]!.resolve();
    await tick();
    expect(cleared).toBe(false);
    expect(retried).toBe(false);
    responses[1]!.resolve();
    await Promise.all([add, remove, clear, retry]);
    expect(cleared).toBe(true);
    expect(retried).toBe(true);
  });

  it("can retry after a synchronous widget bridge failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setWidgetState = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("widget failure");
      })
      .mockReturnValue(undefined);
    vi.stubGlobal("window", {
      openai: { setWidgetState },
      addEventListener() {},
      removeEventListener() {},
    });
    try {
      const { store } = fixture();
      store.initializeViewState({ count: 1 });
      await tick();
      expect(store.getSnapshot().error?.message).toBe("widget failure");
      await expect(store.retry()).resolves.toEqual({ status: "synced" });
      expect(setWidgetState).toHaveBeenCalledTimes(2);
      store.dispose();
    } finally {
      vi.unstubAllGlobals();
      warning.mockRestore();
    }
  });

  it("does not dispatch a deferred widget write after disposal", async () => {
    const setWidgetState = vi.fn();
    vi.stubGlobal("window", {
      openai: { setWidgetState },
      addEventListener() {},
      removeEventListener() {},
    });
    try {
      const { store } = fixture();
      store.initializeViewState({ count: 1 });
      await Promise.resolve();
      store.dispose();
      await tick();
      expect(setWidgetState).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("disposal rejects waiters and fences late responses without sending a clear", async () => {
    const { store, writes, responses } = fixture();
    const add = store.addAttachment("a", { type: "text", text: "A" });
    const rejected = expect(add).rejects.toThrow("disposed");
    await tick();
    store.dispose();
    await rejected;
    responses[0]!.resolve();
    await tick();
    expect(writes).toHaveLength(1);
    expect(store.getSnapshot().attachments).toEqual([]);
  });
});
