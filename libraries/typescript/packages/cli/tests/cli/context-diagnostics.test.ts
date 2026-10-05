import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { mcpUseViewsPlugin } from "../../src/cli/views-plugin.js";
import { sanitizeContextDiagnostic } from "../../src/cli/context-diagnostics.js";

describe("development context diagnostics", () => {
  it("retains protocol structure and strips text, image bytes, metadata and unknown fields", () => {
    const result = sanitizeContextDiagnostic({
      event: "ack",
      seq: 3,
      ms: 100,
      metaPresent: true,
      updateIdType: "undefined",
      secret: "private",
      updateId: "private-id",
      payload: {
        content: [
          {
            type: "image",
            fingerprint: "abcd1234",
            data: "private-base64",
            text: "private-text",
            _meta: { secret: "private" },
          },
        ],
        structured: "abc",
        privateContent: "private-state",
      },
    });
    expect(result).toEqual({
      event: "ack",
      seq: 3,
      ms: 100,
      metaPresent: true,
      updateIdType: "undefined",
      payload: {
        content: [{ type: "image", fingerprint: "abcd1234" }],
        structured: "abc",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("rejects arbitrary events and sanitizes malformed shapes", () => {
    expect(
      sanitizeContextDiagnostic({ event: "arbitrary private text" })
    ).toBeUndefined();
    expect(
      sanitizeContextDiagnostic({
        event: "write",
        payload: {
          content: [{ type: "private", fingerprint: "private" }],
          structured: "private",
        },
      })
    ).toEqual({
      event: "write",
      payload: {
        content: [{ type: "unknown", fingerprint: null }],
        structured: null,
      },
    });
  });
});

it("forwards sanitized diagnostics only with development configuration", () => {
  const on = vi.fn();
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const server = { ws: { on }, config: { logger: { info } } };
  for (const dev of [undefined, { reactRefresh: false }]) {
    const plugin = mcpUseViewsPlugin({
      getViews: () => [],
      ...(dev && { dev }),
    });
    const hook = plugin.configureServer;
    if (typeof hook !== "function")
      throw new Error("Missing configureServer hook");
    hook.call({} as never, server as never);
    if (!dev) expect(on).not.toHaveBeenCalled();
  }
  expect(on).toHaveBeenCalledTimes(1);
  const handler = on.mock.calls[0]![1] as (
    data: unknown,
    client: object
  ) => void;
  const client = {};
  handler({ event: "blocked", seq: 1, secret: "private-payload" }, client);
  expect(info).toHaveBeenCalledWith(
    '[mcp-use context] {"event":"blocked","seq":1}'
  );
  for (let i = 0; i < 100; i++) handler({ event: "blocked", seq: i }, client);
  expect(info.mock.calls.length).toBeLessThanOrEqual(80);
});

it("initializes collection before bootstrap only in development view entries", () => {
  for (const dev of [undefined, { reactRefresh: false }]) {
    const plugin = mcpUseViewsPlugin({
      getViews: () => [{ name: "demo", entryPath: "/views/demo/view.tsx" }],
      ...(dev && { dev }),
    });
    const load = plugin.load as (id: string) => string;
    const source = load("\0virtual:mcp-use/views/demo");
    if (dev) {
      expect(source.indexOf("window.__mcpContextTrace ??=")).toBeLessThan(
        source.indexOf("bootstrapView(viewModule)")
      );
      expect(source).toContain(
        "import.meta.hot.dispose(() => clearInterval(contextTimer))"
      );
    } else {
      expect(source).not.toContain("__mcpContextTrace");
      expect(source).not.toContain("context-diagnostic");
    }
  }
});
