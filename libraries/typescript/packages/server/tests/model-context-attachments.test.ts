import type { App } from "@modelcontextprotocol/ext-apps";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelContextStore } from "../src/react/runtime/model-context-store.js";
import { normalizeContextBlock } from "../src/react/runtime/model-context-wire.js";
import type { ContextPayload } from "../src/react/runtime/model-context.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}
const text = (value: string) => ({ type: "text" as const, text: value });
const all = {
  text: {},
  image: {},
  resourceLink: {},
  resource: {},
  structuredContent: {},
};
const ack = (updateId: string) => ({
  _meta: { "openai/modelContext": { updateId } },
});

function fixture(
  options: {
    openai?: boolean;
    initial?: unknown;
    support?: Record<string, unknown>;
    delayed?: boolean;
  } = {}
) {
  const writes: ContextPayload[] = [];
  const responses: ReturnType<typeof deferred<unknown>>[] = [];
  const connection = deferred<App>();
  const app = {
    getHostCapabilities: () => ({
      updateModelContext: options.support ?? all,
      ...(options.openai !== false && {
        experimental: { "openai/modelContext": {} },
      }),
    }),
    getHostContext: () =>
      options.initial === undefined
        ? {}
        : { "openai/modelContext": options.initial },
    updateModelContext: (payload: ContextPayload) => {
      writes.push(payload);
      const response = deferred<unknown>();
      responses.push(response);
      return response.promise;
    },
  } as unknown as App;
  const connect = vi.fn(() =>
    options.delayed ? connection.promise : Promise.resolve(app)
  );
  const store = new ModelContextStore({ connect }, true);
  const observe = (value: unknown) =>
    store.receiveHostContext({ "openai/modelContext": value });
  return { store, writes, responses, app, connect, connection, observe };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native model context", () => {
  it("waits for connection, composes concurrent native modalities, and normalizes presentation", async () => {
    const { store, connection, app, writes, responses } = fixture({
      delayed: true,
    });
    const adds = [
      store.add("summary", {
        type: "text",
        text: "Summary",
        title: "Book",
        thumbnail: { src: "https://example.com/cover.png" },
        audience: ["user"],
        _meta: { custom: 1 },
      }),
      store.add("cover", {
        type: "image",
        data: "aA==",
        mimeType: "image/png",
        title: "Cover",
      }),
      store.add("link", {
        type: "resource_link",
        uri: "https://example.com/book",
        name: "book",
        title: "Manual",
      }),
      store.add("sample", {
        type: "resource",
        resource: {
          uri: "book://sample",
          text: "Sample",
          mimeType: "text/plain",
        },
      }),
    ];
    expect(store.getSnapshot().pending).toBe(true);
    expect(store.getSnapshot().attachments).toEqual([]);
    connection.resolve(app);
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.content).toHaveLength(4);
    expect(writes[0]!.content[0]).toEqual({
      type: "text",
      text: "Summary",
      _meta: {
        custom: 1,
        "openai/title": "Book",
        "openai/thumbnail": { src: "https://example.com/cover.png" },
      },
      annotations: { audience: ["user"] },
    });
    expect(writes[0]!.content[1]).toMatchObject({
      type: "image",
      data: "aA==",
      _meta: { "openai/title": "Cover" },
    });
    responses[0]!.resolve(ack("U1"));
    expect(await Promise.all(adds)).toEqual(
      Array(4).fill({ status: "synced" })
    );
    expect(store.getSnapshot().pending).toBe(false);
  });

  it("rejects unsupported operations without partial commits or shared validation errors", async () => {
    const { store, writes, responses } = fixture({
      support: { text: {} },
      openai: false,
    });
    await expect(
      store.add("photo", { type: "image", data: "aA==", mimeType: "image/png" })
    ).rejects.toThrow("image context");
    expect(store.getSnapshot()).toMatchObject({
      attachments: [],
      pending: false,
      error: null,
    });
    const valid = store.add("text", text("A"));
    await tick();
    responses[0]!.resolve({});
    await valid;
    expect(writes[0]!.content).toEqual([text("A")]);
    const empty = fixture({ support: {} });
    await expect(empty.store.add("text", text("A"))).rejects.toThrow(
      "text context"
    );
    expect(empty.writes).toHaveLength(0);
  });

  it("requires explicit migration and rejects conflicting helper/raw presentation", async () => {
    const store = new ModelContextStore({ connect: vi.fn() });
    await expect(store.add("a", text("A"))).rejects.toThrow(
      "viewConfig.modelContext"
    );
    expect(() =>
      normalizeContextBlock({
        type: "text",
        text: "A",
        title: "one",
        _meta: { "openai/title": "two" },
      })
    ).toThrow("Conflicting");
    expect(() =>
      normalizeContextBlock({
        type: "text",
        text: "A",
        audience: ["user"],
        annotations: { audience: ["assistant"] },
      })
    ).toThrow("Conflicting");
  });

  it("restores model context before defaults without echoing or reading stale widget state", async () => {
    const widgetWrite = vi.fn();
    vi.stubGlobal("window", {
      openai: {
        widgetState: { modelContent: { sort: "stale" } },
        setWidgetState: widgetWrite,
      },
    });
    const structuredContent = { sort: "name", _uiContext: "" };
    const initial = {
      updateId: "restored",
      structuredContent,
      content: [
        {
          ...text(JSON.stringify(structuredContent)),
          annotations: { audience: ["assistant"] },
        },
        { type: "image", data: "aA==", mimeType: "image/png" },
      ],
    };
    const { store, writes, responses } = fixture({ initial, delayed: false });
    store.initializeViewState({ sort: "price" });
    await store.prepare();
    await tick();
    expect(store.getViewStateSnapshot()).toEqual({ sort: "name" });
    expect(writes).toHaveLength(0);
    expect(store.getSnapshot().attachments).toHaveLength(1);
    expect(store.getSnapshot().attachments[0]!.key).toMatch(/^@restored:/);
    const clear = store.clearSelection();
    await tick();
    expect(writes[0]!.structuredContent).toEqual(structuredContent);
    expect(writes[0]!.content).toHaveLength(1);
    responses[0]!.resolve(ack("clear"));
    await clear;
    expect(widgetWrite).not.toHaveBeenCalled();
  });

  it("keeps confirmed composer removals out of later state updates and ignores stale echoes", async () => {
    const { store, writes, responses, observe } = fixture();
    const a = store.add("a", text("A"));
    const b = store.add("b", text("B"));
    await tick();
    responses[0]!.resolve(ack("U1"));
    await Promise.all([a, b]);
    observe({ updateId: "removed", content: [text("A")] });
    expect(store.getSnapshot().attachments.map((item) => item.key)).toEqual([
      "a",
    ]);
    expect(store.getSnapshot().pending).toBe(false);
    observe({ updateId: "U1", ...writes[0] });
    store.receiveHostContext({ theme: "dark" });
    expect(writes).toHaveLength(1);
    store.updateViewState(() => ({ sort: "price" }));
    await tick();
    expect(writes[1]!.content).not.toContainEqual(text("B"));
    responses[1]!.resolve(ack("U2"));
    await tick();
    const readd = store.add("b", text("B"));
    await tick();
    responses[2]!.resolve(ack("U3"));
    await readd;
    expect(store.getSnapshot().attachments.map((item) => item.key)).toEqual([
      "a",
      "b",
    ]);
  });

  it("buffers echo before response and keeps a newer addition pending", async () => {
    const { store, writes, responses, observe } = fixture();
    const a = store.add("a", text("A"));
    await tick();
    observe({ updateId: "U1", ...writes[0] });
    const b = store.add("b", text("B"));
    responses[0]!.resolve(ack("U1"));
    await a;
    await tick();
    expect(store.getSnapshot().pending).toBe(true);
    expect(writes[1]!.content).toEqual([text("A"), text("B")]);
    responses[1]!.resolve(ack("U2"));
    await b;
  });

  it("suppresses agreed removals during a write and blocks retry when ordering is unknown", async () => {
    const { store, writes, responses, observe } = fixture();
    const first = Promise.all([
      store.add("a", text("A")),
      store.add("b", text("B")),
    ]);
    await tick();
    responses[0]!.resolve(ack("U1"));
    await first;
    const update = store.add("a", text("A2"));
    const rejected = expect(update).rejects.toThrow("publication paused");
    await tick();
    observe({ updateId: "removed", content: [text("A")] });
    responses[1]!.resolve(ack("U2"));
    await rejected;
    await tick();
    await expect(store.retryContext()).rejects.toThrow();
    expect(store.getSnapshot().pending).toBe(false);
    expect(writes).toHaveLength(2);
  });

  it("blocks null during an in-flight addition and malformed or changed host payloads", async () => {
    const { store, responses, observe, writes } = fixture({ initial: null });
    const add = store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("ordering");
    await tick();
    observe(null);
    responses[0]!.resolve(ack("U1"));
    await rejected;
    await expect(store.retryContext()).rejects.toThrow();
    expect(writes).toHaveLength(1);
    const malformed = fixture({ initial: { content: [] } });
    await expect(malformed.store.prepare()).rejects.toThrow("updateId");
  });

  it("preserves opaque restored background and blocks ambiguous duplicate removals", async () => {
    const { store, observe, writes } = fixture({
      initial: {
        updateId: "R",
        content: [
          text("same"),
          text("same"),
          { ...text("background"), annotations: { audience: ["assistant"] } },
        ],
      },
    });
    await store.prepare();
    expect(store.getSnapshot().attachments).toHaveLength(2);
    observe({
      updateId: "remove-one",
      content: [
        text("same"),
        { ...text("background"), annotations: { audience: ["assistant"] } },
      ],
    });
    await expect(store.retryContext()).rejects.toThrow("duplicate");
    expect(writes).toHaveLength(0);
  });

  it("retries a rejected generic write, but blocks uncertain OpenAI outcomes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const generic = fixture({ openai: false });
    const add = generic.store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("denied");
    await tick();
    generic.responses[0]!.reject(new Error("denied"));
    await rejected;
    expect(generic.store.getSnapshot()).toMatchObject({
      pending: false,
      error: new Error("denied"),
    });
    const retry = generic.store.retryContext();
    await tick();
    generic.responses[1]!.resolve({});
    await retry;
    const uncertain = fixture();
    const operation = uncertain.store.add("a", text("A"));
    const failure = expect(operation).rejects.toThrow("uncertain");
    await tick();
    uncertain.responses[0]!.resolve({});
    await failure;
    await expect(uncertain.store.retryContext()).rejects.toThrow("uncertain");
    expect(uncertain.writes).toHaveLength(1);
  });

  it("retains opaque structured state when descriptions mount and never restores removed background", async () => {
    const { store, writes, responses, observe } = fixture({
      initial: {
        updateId: "R",
        structuredContent: { opaque: "retained" },
        content: [
          {
            ...text("private-looking evidence"),
            annotations: { audience: ["assistant"] },
          },
        ],
      },
    });
    await store.prepare();
    observe({
      updateId: "removed",
      structuredContent: { opaque: "retained" },
      content: [],
    });
    store.setNode({ id: "n", parentId: null, content: "Catalog" });
    const add = store.add("a", text("A"));
    await tick();
    expect(writes.at(-1)!.structuredContent).toEqual({ opaque: "retained" });
    expect(writes.at(-1)!.content).toEqual([text("A")]);
    responses.at(-1)!.resolve(ack("U1"));
    await add;
    store.updateViewState(() => ({ sort: "price" }));
    await tick();
    expect(writes.at(-1)!.structuredContent).toEqual({
      opaque: "retained",
      sort: "price",
      _uiContext: "- Catalog",
    });
    responses.at(-1)!.resolve(ack("U2"));
    await tick();
  });

  it("does not echo an initial clear or remounted description after a host clear", async () => {
    const { store, writes, responses, observe } = fixture({ initial: null });
    store.setNode({ id: "n", parentId: null, content: "Catalog" });
    await store.prepare();
    await tick();
    expect(writes).toHaveLength(0);
    store.updateViewState(() => ({ sort: "price" }));
    await tick();
    responses[0]!.resolve(ack("U1"));
    await tick();
    observe(null);
    store.removeNode("n");
    store.setNode({ id: "new", parentId: null, content: "Catalog" });
    store.initializeViewState({ sort: "price" });
    await tick();
    expect(writes).toHaveLength(1);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("accepts a known revision-only echo but refuses to infer removal from an unknown partial snapshot", async () => {
    const { store, responses, observe } = fixture();
    const add = store.add("a", text("A"));
    await tick();
    responses[0]!.resolve(ack("U1"));
    await add;
    observe({ updateId: "U1" });
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().attachments).toHaveLength(1);
    observe({ updateId: "unknown" });
    await expect(store.retryContext()).rejects.toThrow("without its content");
  });

  it("rejects unsupported state before committing and validates raw presentation metadata", async () => {
    const { store, writes } = fixture({ support: { text: {} }, initial: null });
    await store.prepare();
    expect(() => store.updateViewState(() => ({ sort: "price" }))).toThrow(
      "structured"
    );
    expect(store.getViewStateSnapshot()).toBeNull();
    expect(store.getSnapshot().error).toBeNull();
    expect(writes).toHaveLength(0);
    await expect(
      store.add("a", { type: "text", text: "A", title: "" })
    ).rejects.toThrow("nonempty");
    await expect(
      store.add("a", {
        type: "image",
        data: "aA==",
        mimeType: "image/png",
        _meta: { "openai/thumbnail": { src: "x" } },
      })
    ).rejects.toThrow("thumbnail");
  });

  it("allows explicit retry of a host rejection but never retries a timed-out publication", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, responses, writes } = fixture();
    const add = store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("denied");
    await tick();
    responses[0]!.reject(
      Object.assign(new Error("denied"), {
        name: "ProtocolError",
        code: -32602,
      })
    );
    await rejected;
    const retry = store.retryContext();
    await tick();
    responses[1]!.resolve(ack("U2"));
    await retry;
    const changed = store.add("b", text("B"));
    const timeout = expect(changed).rejects.toThrow("uncertain");
    await tick();
    responses[2]!.reject(
      Object.assign(new Error("Request timed out"), {
        name: "SdkError",
        code: "REQUEST_TIMEOUT",
      })
    );
    await timeout;
    await expect(store.retryContext()).rejects.toThrow("uncertain");
    expect(writes).toHaveLength(3);
  });

  it("rejects partial removal of identical opaque background and late unsupported defaults", async () => {
    const background = {
      ...text("opaque evidence"),
      annotations: { audience: ["assistant"] },
    };
    const restored = fixture({
      initial: { updateId: "R", content: [background, background] },
    });
    await restored.store.prepare();
    restored.observe({ updateId: "removed-one", content: [background] });
    await expect(restored.store.add("a", text("A"))).rejects.toThrow(
      "duplicate"
    );
    expect(restored.writes).toHaveLength(0);
    const late = fixture({ support: { text: {} }, openai: false });
    await late.store.prepare();
    expect(() => late.store.initializeViewState({ sort: "price" })).toThrow(
      "structured"
    );
    expect(late.store.getViewStateSnapshot()).toBeNull();
    const add = late.store.add("a", text("A"));
    await tick();
    late.responses[0]!.resolve({});
    await add;
  });

  it("pauses a queued selection when a host clear arrives before its intent commits", async () => {
    const { store, observe, writes } = fixture({
      initial: { updateId: "R", content: [text("A")] },
    });
    await store.prepare();
    const add = store.add("b", text("B"));
    const rejected = expect(add).rejects.toThrow("ordering");
    observe(null);
    await rejected;
    expect(store.getSnapshot().attachments).toEqual([]);
    expect(store.getSnapshot().pending).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it.each([
    { clear: false, action: "retry" },
    { clear: true, action: "add" },
  ])(
    "reconciles buffered clear=$clear before $action after a rejected write",
    async ({ clear, action }) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { store, responses, observe, writes } = fixture();
      const initial = Promise.all([
        store.add("a", text("A")),
        store.add("b", text("B")),
      ]);
      await tick();
      responses[0]!.resolve(ack("U1"));
      await initial;
      const add = store.add("c", text("C"));
      const rejected = expect(add).rejects.toThrow();
      await tick();
      observe(clear ? null : { updateId: "removed-b", content: [text("A")] });
      responses[1]!.reject(
        Object.assign(new Error("denied"), {
          name: "ProtocolError",
          code: -32602,
        })
      );
      await rejected;
      const retry = (
        action === "retry" ? store.retryContext() : store.add("d", text("D"))
      ).catch((error: unknown) => error);
      await tick();
      expect(writes).toHaveLength(2);
      expect(await retry).toBeInstanceOf(Error);
      expect(
        store.getSnapshot().attachments.map((item) => item.key)
      ).not.toContain("b");
      expect(store.getSnapshot().pending).toBe(false);
    }
  );

  it("cancels queued initialization on disposal and never publishes after late connection", async () => {
    const { store, app, connection, writes } = fixture({ delayed: true });
    const add = store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("disposed");
    store.dispose();
    await rejected;
    connection.resolve(app);
    await tick();
    expect(writes).toHaveLength(0);
  });
});
