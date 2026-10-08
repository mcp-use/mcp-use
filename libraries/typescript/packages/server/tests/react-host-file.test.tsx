// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import type { ReadResourceResult } from "@modelcontextprotocol/server";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useHostFile,
  useOpenFile,
  type HostFileContent,
  type HostFileOptions,
} from "../src/react/index.js";
import { ViewRuntimeProvider } from "../src/react/runtime/view-runtime-context.js";
import { normalizeViewConfig } from "../src/react/runtime/view-config.js";
import {
  createMcpAppRuntime,
  type McpAppRuntime,
} from "../src/react/runtime/view-runtime.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

const URI = "host-resource://opaque handle/%2F?token=secret";
const FILE = { name: "notes.md", resourceUri: URI };
const runtimes: McpAppRuntime[] = [];
const bridges: AppBridge[] = [];
const text = (
  value = "Hello",
  meta: Record<string, unknown> = { writable: true, etag: "v1" }
): ReadResourceResult => ({
  contents: [
    {
      uri: URI,
      text: value,
      mimeType: "text/plain",
      _meta: { "openai/resource": meta },
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(
  capabilities: McpUiHostCapabilities = {
    experimental: { "openai/resource": {}, "openai/files": {} },
  }
) {
  const [guest, host] = createPairedTransports();
  const start = vi.spyOn(guest, "start");
  const runtime = createMcpAppRuntime(normalizeViewConfig(), {
    transport: guest,
  });
  const bridge = new AppBridge(
    null,
    { name: "file-host", version: "1" },
    capabilities
  );
  runtimes.push(runtime);
  bridges.push(bridge);
  const read = vi.fn(async (): Promise<ReadResourceResult> => text());
  const write = vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      outcome: "saved",
      etag: "v2",
    })
  );
  const subscribe = vi.fn(async () => ({}));
  const unsubscribe = vi.fn(async () => ({}));
  const open = vi.fn(async () => ({}));
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  bridge.fallbackRequestHandler = async (request) => {
    requests.push({
      method: request.method,
      ...(request.params && { params: request.params }),
    });
    switch (request.method) {
      case "resources/read":
        return read();
      case "resources/subscribe":
        return subscribe();
      case "resources/unsubscribe":
        return unsubscribe();
      case "openai/resources/write":
        return write();
      case "openai/files/open":
        return open();
      default:
        throw new Error(`Unexpected request ${request.method}`);
    }
  };
  await bridge.connect(host);
  await runtime.connect();
  return {
    runtime,
    bridge,
    read,
    write,
    subscribe,
    unsubscribe,
    open,
    requests,
    start,
  };
}
function mount(
  runtime: McpAppRuntime,
  options: HostFileOptions = {},
  strict = false
) {
  return renderHook((props: HostFileOptions) => useHostFile(props), {
    initialProps: options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <ViewRuntimeProvider runtime={runtime}>
        {strict ? <StrictMode>{children}</StrictMode> : children}
      </ViewRuntimeProvider>
    ),
  });
}
async function input(
  bridge: AppBridge,
  args: Record<string, unknown> = { file: FILE }
) {
  await act(async () => {
    await bridge.sendToolInput({ arguments: args });
  });
}
async function ready(handle: ReturnType<typeof mount>) {
  await waitFor(() => expect(handle.result.current.status).toBe("ready"));
}
async function update(bridge: AppBridge, uri = URI) {
  await act(async () => {
    await bridge.notification({
      method: "notifications/resources/updated",
      params: { uri },
    });
  });
}

afterEach(async () => {
  cleanup();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  vi.restoreAllMocks();
});

describe("host file wire and opening lifetime", () => {
  it.each([undefined, "text", "blob"] as const)(
    "sends the exact %s representation and selects matching-item metadata",
    async (representation) => {
      const host = await setup();
      host.read.mockResolvedValue({
        contents: [
          {
            uri: "other",
            text: "wrong",
            _meta: { "openai/resource": { writable: false, etag: "wrong" } },
          },
          ...text("", { writable: true, etag: "opaque\n token" }).contents,
        ],
        _meta: { "openai/resource": { writable: false } },
      });
      const hook = mount(host.runtime, {
        ...(representation && { representation }),
        subscribe: false,
      });
      expect(hook.result.current.status).toBe("pending");
      await input(host.bridge);
      await ready(hook);
      expect(host.requests).toEqual([
        {
          method: "resources/read",
          params: {
            uri: URI,
            ...(representation && {
              _meta: { "openai/resource": { representation } },
            }),
          },
        },
      ]);
      expect(hook.result.current.data).toEqual({
        uri: URI,
        text: "",
        mimeType: "text/plain",
        writable: true,
        etag: "opaque\n token",
      });
      expect(hook.result.current.canWrite).toBe(true);
      expect(host.start).toHaveBeenCalledTimes(1);
    }
  );

  it("accepts blob fallback without conversion and an empty blob", async () => {
    const host = await setup();
    host.read.mockResolvedValue({
      contents: [
        {
          uri: URI,
          blob: "",
          _meta: { "openai/resource": { writable: true, etag: "v1" } },
        },
      ],
    });
    const hook = mount(host.runtime, {
      representation: "text",
      subscribe: false,
    });
    await input(host.bridge);
    await ready(hook);
    expect(hook.result.current.data).toEqual({
      uri: URI,
      blob: "",
      writable: true,
      etag: "v1",
    });
    await act(async () => {
      await hook.result.current.write({ blob: "SGVsbG8=" }, { ifMatch: "v1" });
    });
    expect(host.requests.at(-1)).toEqual({
      method: "openai/resources/write",
      params: { uri: URI, blob: "SGVsbG8=", ifMatch: "v1" },
    });
    expect(hook.result.current.data).toEqual({
      uri: URI,
      blob: "SGVsbG8=",
      writable: true,
      etag: "v2",
    });
  });

  it("never authorizes partial input and freezes the first complete opening identity before result latch", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await act(async () => {
      await host.bridge.sendToolInputPartial({ arguments: { file: FILE } });
    });
    expect(hook.result.current.status).toBe("pending");
    expect(host.read).not.toHaveBeenCalled();
    await input(host.bridge);
    await ready(hook);
    await input(host.bridge, {
      file: { name: "ambient", resourceUri: "other" },
    });
    await act(async () => {
      await host.bridge.sendToolResult({ content: [], structuredContent: {} });
    });
    await input(host.bridge, {
      file: { name: "later", resourceUri: "another" },
    });
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.file).toEqual(FILE);
    expect(host.requests.every((r) => r.params?.uri === URI)).toBe(true);
    // Extra JS fields never substitute the opened identity.
    await act(async () => {
      await hook.result.current.write(
        { text: "safe", uri: "other" } as HostFileContent,
        { ifMatch: "v1" }
      );
    });
    expect(host.requests.at(-1)?.params).toEqual({
      uri: URI,
      text: "safe",
      ifMatch: "v1",
    });
  });

  it("captures complete input before hooks mount, and ignores complete input after latch", async () => {
    const first = await setup();
    await input(first.bridge);
    await act(async () => {
      await first.bridge.sendToolResult({ content: [], structuredContent: {} });
    });
    const hook = mount(first.runtime, { subscribe: false });
    await ready(hook);
    const second = await setup();
    await act(async () => {
      await second.bridge.sendToolResult({
        content: [],
        structuredContent: {},
      });
    });
    await input(second.bridge);
    const late = mount(second.runtime);
    expect(late.result.current.status).toBe("pending");
    expect(second.read).not.toHaveBeenCalled();
  });

  it.each([
    { file: null },
    { file: {} },
    { file: { name: "a", resourceUri: "  " } },
    { file: { name: 1, resourceUri: URI } },
  ])("rejects malformed complete input %j without traffic", async (args) => {
    const host = await setup();
    const hook = mount(host.runtime);
    await input(host.bridge, args);
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error?.message).toMatch(/Malformed complete/);
    expect(host.requests).toEqual([]);
  });

  it.each([{ serverResources: {}, experimental: { "openai/files": {} } }, {}])(
    "requires the dedicated resource capability %j",
    async (capabilities) => {
      const host = await setup(capabilities);
      const hook = mount(host.runtime);
      await input(host.bridge);
      expect(hook.result.current.status).toBe("unsupported");
      await expect(hook.result.current.refresh()).rejects.toThrow(
        /No supported/
      );
      expect(host.requests).toEqual([]);
    }
  );

  it("reports completed non-file input as unsupported without traffic", async () => {
    const host = await setup();
    const hook = mount(host.runtime);
    await input(host.bridge, {});
    expect(hook.result.current.status).toBe("unsupported");
    expect(host.requests).toEqual([]);
  });

  it.each([
    { contents: [] },
    { contents: [{ uri: "other", text: "x" }] },
    { contents: [{ uri: URI, text: "a", blob: "YQ==" }] },
  ])("rejects unmatched/malformed contents %j", async (result) => {
    const host = await setup();
    host.read.mockResolvedValue(result as ReadResourceResult);
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.canWrite).toBe(false);
    await expect(
      hook.result.current.write({ text: "x" }, { ifMatch: "v1" })
    ).rejects.toThrow(/valid writable/);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("retains contents on inaccessible-URI errors and preserves handshake failures", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    host.read.mockRejectedValue(new Error("inaccessible resource"));
    await act(async () => {
      await expect(hook.result.current.refresh()).rejects.toThrow(
        /inaccessible resource/
      );
    });
    expect(hook.result.current.data?.etag).toBe("v1");
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.canWrite).toBe(false);
    const absent = new Error("host absent during handshake");
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: {
        async start() {},
        async send() {
          throw absent;
        },
        async close() {},
      },
    });
    runtimes.push(runtime);
    const failed = mount(runtime);
    await waitFor(() => expect(failed.result.current.status).toBe("error"));
    expect(failed.result.current.error?.message).toContain("host absent");
    await expect(runtime.connect()).rejects.toThrow(/host absent/);
  });
});

describe("guarded writes and races", () => {
  it.each([
    {},
    { writable: false, etag: "v1" },
    { writable: "true", etag: "v1" },
    { writable: true },
    { writable: true, etag: "" },
    { writable: true, etag: 12 },
  ])("leaves no-permission/no-ETag resources readable %j", async (meta) => {
    const host = await setup();
    host.read.mockResolvedValue(text("Hello", meta));
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    expect(hook.result.current.canWrite).toBe(false);
    await expect(
      hook.result.current.write({ text: "new" }, { ifMatch: "v1" })
    ).rejects.toThrow(/valid writable/);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("keeps reads, writes, notifications and cleanup on the opening URI when public identities are mutated", async () => {
    const host = await setup();
    const hook = mount(host.runtime);
    await input(host.bridge);
    await ready(hook);
    await waitFor(() => expect(hook.result.current.isSubscribed).toBe(true));
    const substitute = "host-resource://another-file";
    const exposedFile = hook.result.current.file!;
    exposedFile.resourceUri = substitute;
    hook.result.current.data!.uri = substitute;

    await expect(
      hook.result.current.write({ text: "forbidden" }, { ifMatch: "v1" })
    ).rejects.toThrow(/valid writable/);
    expect(host.write).not.toHaveBeenCalled();
    await update(host.bridge, substitute);
    expect(host.read).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(
      host.requests
        .filter((request) => request.method === "resources/read")
        .at(-1)?.params
    ).toEqual({ uri: URI });
    expect(hook.result.current.data?.uri).toBe(URI);

    // A separately mutated display identity cannot taint saved contents either.
    hook.result.current.file!.resourceUri = substitute;
    await act(async () => {
      await hook.result.current.write({ text: "saved" }, { ifMatch: "v1" });
    });
    expect(
      host.requests.filter(
        (request) => request.method === "openai/resources/write"
      )
    ).toEqual([
      {
        method: "openai/resources/write",
        params: { uri: URI, text: "saved", ifMatch: "v1" },
      },
    ]);
    expect(hook.result.current.data).toMatchObject({
      uri: URI,
      text: "saved",
      etag: "v2",
    });

    await update(host.bridge);
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(3));
    hook.unmount();
    await waitFor(() => expect(host.unsubscribe).toHaveBeenCalledTimes(1));
    expect(
      host.requests.filter((request) => /subscribe/.test(request.method))
    ).toEqual([
      { method: "resources/subscribe", params: { uri: URI } },
      { method: "resources/unsubscribe", params: { uri: URI } },
    ]);
    expect(host.requests.every((request) => request.params?.uri === URI)).toBe(
      true
    );
  });

  it("rejects attempts to substitute the snapshot URI before writing", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    hook.result.current.data!.uri = "host-resource://another-file";
    await expect(
      hook.result.current.write({ text: "replacement" }, { ifMatch: "v1" })
    ).rejects.toThrow(/valid writable/);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("requires explicit non-empty tokens and exactly one content form", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    await expect(
      hook.result.current.write({ text: "x" }, {} as { ifMatch: string })
    ).rejects.toThrow(/explicit non-empty/);
    await expect(
      hook.result.current.write({ text: "x" }, { ifMatch: "" })
    ).rejects.toThrow(/explicit non-empty/);
    await expect(
      hook.result.current.write(
        { text: "x", blob: "eA==" } as unknown as HostFileContent,
        { ifMatch: "v1" }
      )
    ).rejects.toThrow(/exactly one/);
    await expect(
      hook.result.current.write({} as HostFileContent, { ifMatch: "v1" })
    ).rejects.toThrow(/exactly one/);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("adopts saved contents, retains conflict/too-large contents and explicitly refreshes", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    await act(async () => {
      expect(
        await hook.result.current.write(
          { text: "new" },
          { ifMatch: "draft-v1" }
        )
      ).toEqual({ outcome: "saved", etag: "v2" });
    });
    expect(host.requests.at(-1)?.params).toEqual({
      uri: URI,
      text: "new",
      ifMatch: "draft-v1",
    });
    expect(hook.result.current.data?.etag).toBe("v2");
    host.write.mockResolvedValueOnce({ outcome: "too-large", maxBytes: 10 });
    await act(async () => {
      expect(
        await hook.result.current.write({ text: "huge" }, { ifMatch: "v2" })
      ).toEqual({ outcome: "too-large", maxBytes: 10 });
    });
    expect(hook.result.current.data).toMatchObject({ text: "new", etag: "v2" });
    host.write.mockResolvedValueOnce({ outcome: "conflict", etag: "v3" });
    await act(async () => {
      expect(
        await hook.result.current.write({ text: "draft" }, { ifMatch: "v2" })
      ).toEqual({ outcome: "conflict", etag: "v3" });
    });
    expect(hook.result.current.data).toMatchObject({ text: "new", etag: "v2" });
    expect(hook.result.current.canWrite).toBe(false);
    expect(host.read).toHaveBeenCalledTimes(1);
    host.read.mockResolvedValue(
      text("external", { writable: true, etag: "v3" })
    );
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.data).toMatchObject({
      text: "external",
      etag: "v3",
    });
    expect(hook.result.current.canWrite).toBe(true);
  });

  it.each([
    { outcome: "saved" },
    { outcome: "conflict", etag: "" },
    { outcome: "too-large", maxBytes: -1 },
    { outcome: "unknown" },
  ])(
    "rejects malformed write result %j without corrupting the snapshot",
    async (response) => {
      const host = await setup();
      host.write.mockResolvedValue(response);
      const hook = mount(host.runtime, { subscribe: false });
      await input(host.bridge);
      await ready(hook);
      await act(async () => {
        await expect(
          hook.result.current.write({ text: "draft" }, { ifMatch: "v1" })
        ).rejects.toThrow(/Malformed/);
      });
      expect(hook.result.current.data).toMatchObject({
        text: "Hello",
        etag: "v1",
      });
      expect(hook.result.current.canWrite).toBe(false);
    }
  );

  it("preserves write transport errors and serializes concurrent writes without retrying", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    const gate = deferred<Record<string, unknown>>();
    host.write.mockReturnValueOnce(gate.promise);
    const first = hook.result.current.write(
      { text: "first" },
      { ifMatch: "v1" }
    );
    const mutable = { text: "second" };
    const second = hook.result.current.write(mutable, { ifMatch: "v1" });
    mutable.text = "tampered";
    await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
    host.write.mockResolvedValueOnce({ outcome: "conflict", etag: "v2" });
    await act(async () => {
      gate.resolve({ outcome: "saved", etag: "v2" });
      await first;
      await second;
    });
    expect(host.write).toHaveBeenCalledTimes(2);
    expect(host.requests.at(-1)?.params).toEqual({
      uri: URI,
      text: "second",
      ifMatch: "v1",
    });
    expect(hook.result.current.data).toMatchObject({
      text: "first",
      etag: "v2",
    });
    await act(async () => {
      await hook.result.current.refresh();
    });
    host.write.mockRejectedValueOnce(new Error("write denied"));
    await act(async () => {
      await expect(
        hook.result.current.write({ text: "draft" }, { ifMatch: "v1" })
      ).rejects.toThrow(/write denied/);
    });
    expect(hook.result.current.error?.message).toMatch(/write denied/);
    expect(hook.result.current.canWrite).toBe(false);
  });

  it.each(["notification", "manual refresh"])(
    "preserves newer contents observed by %s before a delayed saved response",
    async (observation) => {
      const host = await setup();
      const hook = mount(host.runtime);
      await input(host.bridge);
      await ready(hook);
      await waitFor(() => expect(hook.result.current.isSubscribed).toBe(true));
      const delayed = deferred<Record<string, unknown>>();
      host.write.mockReturnValueOnce(delayed.promise);
      const saving = hook.result.current.write(
        { text: "saved-v2" },
        { ifMatch: "v1" }
      );
      await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
      host.read.mockResolvedValueOnce(
        text("external-v3", { writable: true, etag: "v3" })
      );
      if (observation === "notification") await update(host.bridge);
      else
        await act(async () => {
          await hook.result.current.refresh();
        });
      await waitFor(() => expect(hook.result.current.data?.etag).toBe("v3"));
      await act(async () => {
        delayed.resolve({ outcome: "saved", etag: "v2" });
        expect(await saving).toEqual({ outcome: "saved", etag: "v2" });
      });
      expect(hook.result.current.data).toMatchObject({
        text: "external-v3",
        etag: "v3",
      });
      expect(hook.result.current.canWrite).toBe(true);
    }
  );

  it("keeps a resource invalidation pending when a saved response arrives before its read", async () => {
    const host = await setup();
    const hook = mount(host.runtime);
    await input(host.bridge);
    await ready(hook);
    await waitFor(() => expect(hook.result.current.isSubscribed).toBe(true));
    const save = deferred<Record<string, unknown>>();
    host.write.mockReturnValueOnce(save.promise);
    const saving = hook.result.current.write(
      { text: "saved-v2" },
      { ifMatch: "v1" }
    );
    await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
    const read = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(read.promise);
    await update(host.bridge);
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(2));
    await act(async () => {
      save.resolve({ outcome: "saved", etag: "v2" });
      await saving;
    });
    expect(hook.result.current.data).toMatchObject({
      text: "Hello",
      etag: "v1",
    });
    expect(hook.result.current.canWrite).toBe(false);
    expect(hook.result.current.isRefreshing).toBe(true);
    await act(async () => {
      read.resolve(text("external-v3", { writable: true, etag: "v3" }));
    });
    await waitFor(() => expect(hook.result.current.data?.etag).toBe("v3"));
    expect(hook.result.current.canWrite).toBe(true);
  });

  it("adopts a save after an earlier read completes while its response is pending", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    const read = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(read.promise);
    let refreshing!: ReturnType<typeof hook.result.current.refresh>;
    act(() => {
      refreshing = hook.result.current.refresh();
    });
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(2));
    const save = deferred<Record<string, unknown>>();
    host.write.mockReturnValueOnce(save.promise);
    const saving = hook.result.current.write(
      { text: "saved-v2" },
      { ifMatch: "v1" }
    );
    await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
    await act(async () => {
      read.resolve(text("Hello"));
      await refreshing;
    });
    await act(async () => {
      save.resolve({ outcome: "saved", etag: "v2" });
      await saving;
    });
    expect(hook.result.current.data).toMatchObject({
      text: "saved-v2",
      etag: "v2",
    });
    expect(hook.result.current.canWrite).toBe(true);
  });

  it("ignores a slow pre-save read and stale read failure", async () => {
    const host = await setup();
    const hook = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(hook);
    const slow = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(slow.promise);
    let refresh!: Promise<ReadResourceResult | unknown>;
    act(() => {
      refresh = hook.result.current.refresh();
    });
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(2));
    await act(async () => {
      await hook.result.current.write({ text: "saved" }, { ifMatch: "v1" });
      slow.resolve(text("old"));
      await refresh;
    });
    expect(hook.result.current.data).toMatchObject({
      text: "saved",
      etag: "v2",
    });
    const failed = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(failed.promise);
    let rejected!: Promise<unknown>;
    act(() => {
      rejected = hook.result.current.refresh().catch((e) => e);
    });
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(3));
    await act(async () => {
      await hook.result.current.write(
        { text: "saved again" },
        { ifMatch: "v2" }
      );
      failed.reject(new Error("old failure"));
      await rejected;
    });
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.canWrite).toBe(true);
    expect(hook.result.current.error).toBeUndefined();
  });

  it("rechecks permission before a queued write and ignores older cross-representation permissions", async () => {
    const host = await setup();
    const a = mount(host.runtime, { subscribe: false });
    await input(host.bridge);
    await ready(a);
    const gate = deferred<Record<string, unknown>>();
    host.write.mockReturnValueOnce(gate.promise);
    const first = a.result.current.write({ text: "first" }, { ifMatch: "v1" });
    const blocked = expect(
      a.result.current.write({ text: "queued" }, { ifMatch: "v1" })
    ).rejects.toThrow(/valid writable/);
    await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
    host.read.mockResolvedValueOnce(
      text("current", { writable: false, etag: "v2" })
    );
    await act(async () => {
      await a.result.current.refresh();
      gate.resolve({ outcome: "saved", etag: "v3" });
      await first;
      await blocked;
    });
    expect(host.write).toHaveBeenCalledTimes(1);
    expect(a.result.current.canWrite).toBe(false);
    const old = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(old.promise);
    const b = mount(host.runtime, { representation: "blob", subscribe: false });
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(3));
    host.read.mockResolvedValueOnce(
      text("readonly", { writable: false, etag: "v4" })
    );
    await act(async () => {
      await a.result.current.refresh();
      old.resolve(text("old", { writable: true, etag: "v3" }));
    });
    await ready(b);
    expect(b.result.current.canWrite).toBe(false);
  });

  it("ignores old read/save completions after representation change or remount", async () => {
    const host = await setup();
    const slow = deferred<ReadResourceResult>();
    host.read.mockReturnValueOnce(slow.promise);
    const hook = mount(host.runtime, {
      representation: "text",
      subscribe: false,
    });
    await input(host.bridge);
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(1));
    const oldRefresh = hook.result.current.refresh;
    const oldWrite = hook.result.current.write;
    host.read.mockResolvedValueOnce({
      contents: [
        {
          uri: URI,
          blob: "bmV3",
          _meta: { "openai/resource": { writable: true, etag: "fresh" } },
        },
      ],
    });
    hook.rerender({ representation: "blob", subscribe: false });
    await ready(hook);
    await act(async () => {
      slow.resolve(text("old"));
    });
    expect(hook.result.current.data).toMatchObject({
      blob: "bmV3",
      etag: "fresh",
    });
    await expect(oldRefresh()).rejects.toThrow(/inactive/);
    await expect(oldWrite({ text: "old" }, { ifMatch: "v1" })).rejects.toThrow(
      /inactive/
    );
    const save = deferred<Record<string, unknown>>();
    host.write.mockReturnValueOnce(save.promise);
    const pending = hook.result.current.write(
      { blob: "b2xk" },
      { ifMatch: "fresh" }
    );
    const rejected = expect(pending).rejects.toThrow(/inactive/);
    await waitFor(() => expect(host.write).toHaveBeenCalledTimes(1));
    hook.unmount();
    host.read.mockResolvedValueOnce(
      text("remounted", { writable: true, etag: "new-mount" })
    );
    const fresh = mount(host.runtime, { subscribe: false });
    await ready(fresh);
    await act(async () => {
      save.resolve({ outcome: "saved", etag: "old-save" });
      await rejected;
    });
    expect(fresh.result.current.data).toMatchObject({
      text: "remounted",
      etag: "new-mount",
    });
  });
});

describe("shared host subscriptions and independent file opening", () => {
  it("shares one subscription, filters notifications, and unsubscribes after the last consumer", async () => {
    const host = await setup();
    const a = mount(host.runtime);
    const b = mount(host.runtime, { representation: "blob" });
    await input(host.bridge);
    await ready(a);
    await ready(b);
    await waitFor(() =>
      expect(
        a.result.current.isSubscribed && b.result.current.isSubscribed
      ).toBe(true)
    );
    expect(host.subscribe).toHaveBeenCalledTimes(1);
    await update(host.bridge, "unrelated");
    expect(host.read).toHaveBeenCalledTimes(2);
    host.read.mockResolvedValue(
      text("updated", { writable: false, etag: "new" })
    );
    await update(host.bridge);
    await waitFor(() => expect(host.read).toHaveBeenCalledTimes(4));
    expect(a.result.current.data).toMatchObject({
      text: "updated",
      etag: "new",
    });
    expect(a.result.current.canWrite).toBe(false);
    a.unmount();
    expect(host.unsubscribe).not.toHaveBeenCalled();
    b.unmount();
    await waitFor(() => expect(host.unsubscribe).toHaveBeenCalledTimes(1));
    expect(host.requests.filter((r) => /subscribe/.test(r.method))).toEqual([
      { method: "resources/subscribe", params: { uri: URI } },
      { method: "resources/unsubscribe", params: { uri: URI } },
    ]);
    await update(host.bridge);
    expect(host.read).toHaveBeenCalledTimes(4);
  });

  it("keeps subscription failures separate and manual reads usable", async () => {
    const host = await setup();
    host.subscribe.mockRejectedValueOnce(new Error("subscription denied"));
    const hook = mount(host.runtime);
    await input(host.bridge);
    await ready(hook);
    await waitFor(() =>
      expect(hook.result.current.subscriptionError?.message).toMatch(
        /subscription denied/
      )
    );
    expect(hook.result.current.isSubscribed).toBe(false);
    expect(hook.result.current.error).toBeUndefined();
    host.read.mockResolvedValueOnce(text("manual"));
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.data).toMatchObject({ text: "manual" });
    expect(hook.result.current.subscriptionError?.message).toMatch(
      /subscription denied/
    );
  });

  it("cleans up a pending subscription on unmount and runtime disposal", async () => {
    const host = await setup();
    const pending = deferred<Record<string, never>>();
    host.subscribe.mockReturnValueOnce(pending.promise);
    const hook = mount(host.runtime);
    await input(host.bridge);
    await ready(hook);
    await waitFor(() => expect(host.subscribe).toHaveBeenCalledTimes(1));
    hook.unmount();
    const disposal = host.runtime.dispose();
    pending.resolve({});
    await disposal;
    expect(host.unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.runtime.getApp()).toBeNull();
    expect(host.runtime.hostFileStore.sessions.size).toBe(0);
  });

  it("works under StrictMode and releases subscriptions when representation/subscription changes", async () => {
    const host = await setup();
    await input(host.bridge);
    const hook = mount(host.runtime, { representation: "text" }, true);
    await ready(hook);
    await waitFor(() => expect(hook.result.current.isSubscribed).toBe(true));
    hook.rerender({ representation: "blob", subscribe: false });
    await ready(hook);
    await waitFor(() => expect(host.unsubscribe).toHaveBeenCalledTimes(1));
    expect(hook.result.current.isSubscribed).toBe(false);
    expect(host.start).toHaveBeenCalledTimes(1);
    const readCount = host.read.mock.calls.length;
    await update(host.bridge);
    expect(host.read).toHaveBeenCalledTimes(readCount);
  });

  it("opens an untouched server-provided path independently of resource support", async () => {
    const host = await setup({ experimental: { "openai/files": {} } });
    const hook = renderHook(() => useOpenFile(), {
      wrapper: ({ children }) => (
        <ViewRuntimeProvider runtime={host.runtime}>
          {children}
        </ViewRuntimeProvider>
      ),
    });
    const openFile = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(openFile);
    await openFile({ path: "C:\\host\\generated.stl" });
    expect(host.requests).toEqual([
      {
        method: "openai/files/open",
        params: { path: "C:\\host\\generated.stl" },
      },
    ]);
    await expect(openFile({ path: " " })).rejects.toThrow(/non-blank/);
    host.open.mockRejectedValueOnce(new Error("opening denied"));
    await expect(
      openFile({ path: "/execution/generated.stl" })
    ).rejects.toThrow(/opening denied/);
    await host.runtime.dispose();
    await expect(
      openFile({ path: "/execution/generated.stl" })
    ).rejects.toThrow(/disposed/);
  });

  it("rejects opening without its dedicated capability before traffic", async () => {
    const host = await setup({
      experimental: { "openai/resource": {} },
      openLinks: {},
    });
    await expect(
      host.runtime.openFile({ path: "/execution/generated.stl" })
    ).rejects.toThrow(/openai\/files/);
    expect(host.requests).toEqual([]);
  });
});
