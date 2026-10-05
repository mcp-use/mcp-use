import type { ModelContextBlock } from "../src/react/types/model-context.js";
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
    activate?: boolean;
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
  const store = new ModelContextStore({ connect });
  if (options.activate !== false) store.activateAttachments();
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

  it("rejects conflicting helper/raw presentation", () => {
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

  it("restores model context before defaults without echoing or treating private widget state as model context", async () => {
    const widgetWrite = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      openai: {
        widgetState: { privateContent: { sort: "private" } },
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
    await expect(store.add("next", text("Next"))).rejects.toThrow();
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
    await expect(store.add("next", text("Next"))).rejects.toThrow();
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
    await expect(store.add("next", text("Next"))).rejects.toThrow("duplicate");
    expect(writes).toHaveLength(0);
  });

  it("attempts retained selection on the next mutation after a definite rejection, but blocks uncertain outcomes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const generic = fixture({ openai: false });
    const add = generic.store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("denied");
    await tick();
    generic.responses[0]!.reject(
      Object.assign(new Error("denied"), {
        name: "ProtocolError",
        code: -32602,
      })
    );
    await rejected;
    expect(generic.store.getSnapshot()).toMatchObject({
      pending: false,
      error: { message: "denied", name: "ProtocolError" },
    });
    const retry = generic.store.add("next", text("Next"));
    await tick();
    generic.responses[1]!.resolve({});
    await retry;
    const uncertain = fixture();
    const operation = uncertain.store.add("a", text("A"));
    const failure = expect(operation).rejects.toThrow("uncertain");
    await tick();
    uncertain.responses[0]!.resolve({});
    await failure;
    await expect(uncertain.store.add("next", text("Next"))).rejects.toThrow(
      "uncertain"
    );
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
    await expect(store.add("next", text("Next"))).rejects.toThrow(
      "without its content"
    );
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

  it("allows a new mutation after a host rejection but never replays a timed-out publication", async () => {
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
    const retry = store.add("next", text("Next"));
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
    await expect(store.add("next", text("Next"))).rejects.toThrow("uncertain");
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
    { clear: false, action: "remove" },
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
        action === "remove" ? store.remove("c") : store.add("d", text("D"))
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

describe("automatic context activation and friendly presentation", () => {
  function widget(state: Record<string, unknown> = {}, write = vi.fn()) {
    const browser = Object.assign(new EventTarget(), {
      openai: { widgetState: state, setWidgetState: write },
    });
    vi.stubGlobal("window", browser);
    return browser;
  }

  it("reserves native delivery before co-rendered defaults flush and ignores later widget events", async () => {
    const browser = widget({ privateContent: { panel: "cart" } });
    const { store, writes, responses } = fixture({ activate: false });
    store.initializeViewState({ sort: "price" });
    store.activateAttachments();
    const add = store.add("a", text("A"));
    browser.dispatchEvent(
      Object.assign(new Event("openai:set_globals"), {
        detail: {
          globals: { widgetState: { modelContent: { sort: "stale" } } },
        },
      })
    );
    await tick();
    expect(browser.openai.setWidgetState).not.toHaveBeenCalled();
    expect(browser.openai.widgetState).toEqual({
      privateContent: { panel: "cart" },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.content[0]).toEqual(
      text(JSON.stringify({ sort: "price", _uiContext: "" }))
    );
    responses[0]!.resolve(ack("native"));
    await add;
  });

  it.each([
    { modelContent: { selected: "book" } },
    { imageIds: ["image-1"] },
    { modelContent: 42 },
    { modelContent: false },
  ])(
    "rejects model-visible widget persistence without clearing it: %j",
    async (state) => {
      const browser = widget(state);
      const { store, writes, connect } = fixture();
      await expect(store.add("a", text("A"))).rejects.toThrow(
        "model-visible widget state"
      );
      expect(browser.openai.widgetState).toEqual(state);
      expect(browser.openai.setWidgetState).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    }
  );

  it("waits for an old widget write and rejects unsafe late activation", async () => {
    const old = deferred<void>();
    const browser = widget(
      {},
      vi.fn(() => old.promise)
    );
    const { store, writes } = fixture({ activate: false });
    store.initializeViewState({ sort: "price" });
    await tick();
    expect(browser.openai.setWidgetState).toHaveBeenCalledTimes(1);
    const add = store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("model-visible widget state");
    await tick();
    expect(writes).toHaveLength(0);
    old.resolve();
    await rejected;
    expect(writes).toHaveLength(0);
  });

  it.each([false, true])(
    "drains an old native send, with uncertain failure=%s",
    async (fail) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { store, app, writes, responses } = fixture({ activate: false });
      store.initializeViewState({ sort: "price" });
      await tick();
      expect(writes).toHaveLength(1);
      const add = store.add("a", text("A"));
      const result = add.catch((error: unknown) => error);
      await tick();
      expect(writes).toHaveLength(1);
      if (fail) responses[0]!.reject(new Error("connection lost"));
      else {
        vi.spyOn(app, "getHostContext").mockReturnValue({
          "openai/modelContext": { updateId: "legacy", ...writes[0] },
        } as ReturnType<App["getHostContext"]>);
        responses[0]!.resolve(ack("legacy"));
      }
      await tick();
      if (fail) {
        expect(await result).toEqual(
          expect.objectContaining({
            message: expect.stringContaining("uncertain legacy"),
          })
        );
        expect(writes).toHaveLength(1);
      } else {
        expect(writes).toHaveLength(2);
        expect(writes[1]!.content).toEqual([...writes[0]!.content, text("A")]);
        responses[1]!.resolve(ack("native"));
        expect(await result).toEqual({ status: "synced" });
      }
    }
  );

  it("disposes during a native handoff without waiting for the old write", async () => {
    const { store, writes, responses } = fixture({ activate: false });
    store.initializeViewState({ sort: "price" });
    await tick();
    const add = store.add("a", text("A"));
    const rejected = expect(add).rejects.toThrow("disposed");
    store.dispose();
    await rejected;
    responses[0]!.resolve(ack("late"));
    await tick();
    expect(writes).toHaveLength(1);
  });

  it("retains failed intent, never retries background changes, and recovers on a valid mutation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, writes, responses } = fixture();
    const rejected = expect(store.add("a", text("A"))).rejects.toThrow(
      "denied"
    );
    await tick();
    responses[0]!.reject(
      Object.assign(new Error("denied"), {
        name: "ProtocolError",
        code: -32602,
      })
    );
    await rejected;
    store.updateViewState(() => ({ sort: "price" }));
    store.setNode({ id: "background", parentId: null, content: "catalog" });
    await expect(
      store.add("bad", { type: "text", text: "bad", title: "" })
    ).rejects.toThrow();
    await tick();
    expect(writes).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({
      pending: false,
      error: { message: "denied" },
    });
    expect(store.getSnapshot().attachments.map(({ key }) => key)).toEqual([
      "a",
    ]);
    const add = store.add("b", text("B"));
    await tick();
    expect(writes[1]!.content).toContainEqual(text("A"));
    expect(writes[1]!.content).toContainEqual(text("B"));
    expect(writes[1]!.structuredContent).toEqual({
      sort: "price",
      _uiContext: "- catalog",
    });
    responses[1]!.resolve(ack("recovered"));
    await add;
    expect(store.getSnapshot()).toMatchObject({ pending: false, error: null });
  });

  it("round-trips titles across all four kinds, including native resource-link precedence", async () => {
    const content = [
      normalizeContextBlock({
        type: "text",
        text: "Text",
        title: "Text label",
        audience: ["user"],
        thumbnail: { src: "https://example.com/icon.png" },
      }),
      normalizeContextBlock({
        type: "image",
        data: "aA==",
        mimeType: "image/png",
        title: "Image label",
      }),
      normalizeContextBlock({
        type: "resource_link",
        uri: "book://a",
        name: "a",
        title: "Native label",
        _meta: { "openai/title": "Other metadata", custom: true },
      }),
      normalizeContextBlock({
        type: "resource",
        resource: { uri: "book://a/sample", text: "Sample" },
        title: "Sample label",
      }),
    ];
    expect(content[3]!._meta).toEqual({ "mcp-use/title": "Sample label" });
    const { store, writes } = fixture({
      initial: { updateId: "restored", content },
    });
    await store.prepare();
    const blocks = store.getSnapshot().attachments.map(({ block }) => block);
    expect(blocks.map((block) => (block as { title?: string }).title)).toEqual([
      "Text label",
      "Image label",
      "Native label",
      "Sample label",
    ]);
    expect(blocks[0]).toMatchObject({
      audience: ["user"],
      thumbnail: { src: "https://example.com/icon.png" },
    });
    expect(blocks[2]!._meta).toEqual({
      "openai/title": "Other metadata",
      custom: true,
    });
    expect(
      blocks.map((block) => normalizeContextBlock(block as ModelContextBlock))
    ).toEqual(content);
    expect(Object.isFrozen(blocks[0])).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("preserves removal of the visible generated projection across later attachment mutations", async () => {
    const { store, writes, responses, observe } = fixture();
    store.initializeViewState({ sort: "price" });
    const first = store.add("a", text("A"));
    await tick();
    responses[0]!.resolve(ack("U1"));
    await first;
    observe({
      updateId: "removed-background",
      structuredContent: writes[0]!.structuredContent,
      content: [text("A")],
    });
    const second = store.add("b", text("B"));
    await tick();
    expect(writes[1]!.content).toEqual([text("A"), text("B")]);
    responses[1]!.resolve(ack("U2"));
    await second;
  });
});

it("preserves explicit unsent state changes across native activation hydration", async () => {
  const { store, app, writes, responses } = fixture({ activate: false });
  store.initializeViewState({ count: 0 });
  await tick();
  store.updateViewState(() => ({ count: 1 }));
  vi.spyOn(app, "getHostContext").mockReturnValue({
    "openai/modelContext": { updateId: "legacy", ...writes[0] },
  } as ReturnType<App["getHostContext"]>);
  const add = store.add("a", text("A"));
  // A later functional update must see the retained explicit intent, not count:0.
  store.updateViewState((previous) => ({ count: Number(previous?.count) + 1 }));
  responses[0]!.resolve(ack("legacy"));
  await tick();
  expect(store.getViewStateSnapshot()).toEqual({ count: 2 });
  expect(writes[1]!.structuredContent).toEqual({ count: 2, _uiContext: "" });
  responses[1]!.resolve(ack("native"));
  await add;
});

it.each([
  null,
  undefined,
  {
    updateId: "old",
    structuredContent: { count: 0, _uiContext: "" },
    content: [text(JSON.stringify({ count: 0, _uiContext: "" }))],
  },
])(
  "blocks stale or missing readback after an acknowledged legacy native write: %j",
  async (initial) => {
    const { store, responses, writes } = fixture({ activate: false, initial });
    store.initializeViewState({ count: 0 });
    store.updateViewState(() => ({ count: 1 }));
    await tick();
    responses[0]!.resolve(ack("current"));
    await tick();
    await expect(store.add("a", text("A"))).rejects.toThrow(
      "cached host state"
    );
    expect(store.getViewStateSnapshot()).toEqual({ count: 1 });
    expect(writes).toHaveLength(1);
  }
);
