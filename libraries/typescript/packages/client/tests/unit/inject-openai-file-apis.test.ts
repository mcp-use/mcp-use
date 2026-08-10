// @vitest-environment jsdom
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/ext-apps/app-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";

import { injectOpenAiFileApis } from "../../src/react/view/inject-openai-file-apis.js";

async function runInjectedFileApis(html: string) {
  const injected = injectOpenAiFileApis(html);
  expect(injected).toContain("uploadFile");
  expect(injected).toContain("getFileDownloadUrl");

  const parsed = new DOMParser().parseFromString(injected, "text/html");
  const script = Array.from(parsed.scripts).find((candidate) =>
    candidate.textContent?.includes("api.uploadFile")
  );
  expect(script?.textContent).toBeTruthy();
  // eslint-disable-next-line no-new-func
  new Function(script!.textContent!)();

  const api = (
    window as unknown as {
      openai?: {
        uploadFile?: (file: File) => Promise<{ fileId: string }>;
        getFileDownloadUrl?: (ref: {
          fileId: string;
        }) => Promise<{ downloadUrl: string }>;
      };
    }
  ).openai;

  expect(api?.uploadFile).toBeTypeOf("function");
  expect(api?.getFileDownloadUrl).toBeTypeOf("function");

  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const { fileId } = await api!.uploadFile!(file);
  expect(fileId).toBeTruthy();

  const { downloadUrl } = await api!.getFileDownloadUrl!({ fileId });
  expect(downloadUrl).toMatch(/^blob:/);

  const response = await fetch(downloadUrl);
  expect(await response.text()).toBe("hello");

  Reflect.deleteProperty(window, "openai");
}

function mountInjectedBridge() {
  const injected = injectOpenAiFileApis(
    "<html><head></head><body></body></html>"
  );
  const parsed = new DOMParser().parseFromString(injected, "text/html");
  const script = Array.from(parsed.scripts).find((candidate) =>
    candidate.textContent?.includes("mcp-use-openai-compat")
  );
  expect(script?.textContent).toBeTruthy();

  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const guest = iframe.contentWindow!;
  guest.setTimeout = window.setTimeout.bind(window);
  guest.clearTimeout = window.clearTimeout.bind(window);
  Object.defineProperty(guest.URL, "createObjectURL", {
    configurable: true,
    value: URL.createObjectURL.bind(URL),
  });

  guest.Function(script!.textContent!)();

  return {
    guest,
    cleanup: () => iframe.remove(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("injectOpenAiFileApis", () => {
  it("injects into head and round-trips upload/download", async () => {
    await runInjectedFileApis("<html><head></head><body></body></html>");
  });

  it("prepends when html has no head", async () => {
    await runInjectedFileApis("<div>widget</div>");
  });

  it("handles mixed-case tags and long doctypes without regular expressions", () => {
    const attributes = ' data-test="x"'.repeat(2_000);
    const html = `<!DoCtYpE html${attributes}><HtMl><HeAd></HeAd></HtMl>`;
    const injected = injectOpenAiFileApis(html);
    expect(injected).toContain("<HeAd><script>");
    expect(injected.indexOf("uploadFile")).toBeLessThan(
      injected.indexOf("</HeAd>")
    );
  });

  it("populates the shared window.openai aliases and supported extensions", () => {
    const { guest, cleanup } = mountInjectedBridge();
    const openai = (guest as typeof guest & { openai: Record<string, unknown> })
      .openai;

    expect(openai).toMatchObject({
      toolInput: null,
      toolOutput: null,
      toolResponseMetadata: null,
      theme: "light",
      displayMode: "inline",
      locale: "en",
    });
    for (const method of [
      "callTool",
      "sendFollowUpMessage",
      "openExternal",
      "requestDisplayMode",
      "setWidgetState",
      "notifyIntrinsicHeight",
      "uploadFile",
      "getFileDownloadUrl",
    ]) {
      expect(openai[method]).toBeTypeOf("function");
    }
    for (const unsupportedExtension of [
      "requestModal",
      "requestClose",
      "selectFiles",
      "setOpenInAppUrl",
      "requestCheckout",
    ]) {
      expect(openai[unsupportedExtension]).toBeUndefined();
    }

    cleanup();
  });

  it("maps MCP Apps lifecycle notifications to OpenAI globals", () => {
    const { guest, cleanup } = mountInjectedBridge();
    const openai = (
      guest as typeof guest & {
        openai: {
          toolInput: unknown;
          toolOutput: unknown;
          toolResponseMetadata: unknown;
          theme: unknown;
          displayMode: unknown;
          locale: unknown;
          view: unknown;
        };
      }
    ).openai;
    const globalsEvents: Record<string, unknown>[] = [];
    guest.addEventListener("openai:set_globals", (event) => {
      globalsEvents.push(
        (event as CustomEvent<{ globals: Record<string, unknown> }>).detail
          .globals
      );
    });

    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input-partial",
          params: { arguments: { question: "Cho" } },
        },
      })
    );
    expect(openai.toolInput).toBeNull();
    expect(globalsEvents).toHaveLength(0);

    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: { question: "Choose" } },
        },
      })
    );
    const toolResult = {
      content: [],
      structuredContent: { options: ["A", "B"] },
      _meta: { source: "test" },
    };
    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: toolResult,
        },
      })
    );
    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: {
            theme: "dark",
            displayMode: "fullscreen",
            locale: "de-CH",
            view: { id: "poll" },
          },
        },
      })
    );

    expect(openai.toolInput).toEqual({ question: "Choose" });
    expect(openai.toolOutput).toEqual({ options: ["A", "B"] });
    expect(openai.toolResponseMetadata).toEqual(toolResult);
    expect(openai.theme).toBe("dark");
    expect(openai.displayMode).toBe("fullscreen");
    expect(openai.locale).toBe("de-CH");
    expect(openai.view).toEqual({ id: "poll" });
    expect(globalsEvents).toHaveLength(3);

    cleanup();
  });

  it("keeps widget state private and updates it synchronously", () => {
    vi.useFakeTimers();
    const { guest, cleanup } = mountInjectedBridge();
    const postMessage = vi.spyOn(guest.parent, "postMessage");
    const openai = (
      guest as typeof guest & {
        openai: {
          widgetState: unknown;
          setWidgetState: (state: unknown) => unknown;
        };
      }
    ).openai;
    const state = {
      modelContent: "Selected image",
      privateContent: { selectedId: "private-1" },
      imageIds: ["file-1"],
    };

    expect(openai.setWidgetState(state)).toBeUndefined();
    expect(openai.widgetState).toEqual(state);
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "ui/update-model-context" }),
      "*"
    );

    cleanup();
  });

  it("does not start a second handshake after a native V2 view connects", async () => {
    vi.useFakeTimers();
    const { guest, cleanup } = mountInjectedBridge();
    const postMessage = vi.spyOn(guest.parent, "postMessage");

    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            hostInfo: { name: "Inspector", version: "test" },
            hostContext: { theme: "light" },
          },
        },
      })
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "ui/initialize" }),
      "*"
    );
    cleanup();
  });

  it("falls back to an MCP Apps handshake for legacy useWidget bundles", async () => {
    vi.useFakeTimers();
    const { guest, cleanup } = mountInjectedBridge();
    const postMessage = vi.spyOn(guest.parent, "postMessage");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: "2.0",
        method: "ui/initialize",
      }),
      "*"
    );

    const initialize = postMessage.mock.calls.find(
      ([message]) => (message as { method?: string }).method === "ui/initialize"
    )?.[0] as {
      id: string;
      params: { protocolVersion: string };
    };
    expect(initialize.params.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    guest.dispatchEvent(
      new guest.MessageEvent("message", {
        source: guest.parent,
        data: {
          jsonrpc: "2.0",
          id: initialize.id,
          result: {
            hostInfo: { name: "Inspector", version: "test" },
            hostContext: { theme: "dark" },
          },
        },
      })
    );
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
        params: {},
      },
      "*"
    );
    expect(
      (guest as typeof guest & { openai: { theme: string } }).openai.theme
    ).toBe("dark");

    cleanup();
  });
});

describe("injectOpenAiFileApis HTML shape", () => {
  it("places script before existing head content", () => {
    const html = "<html><head><title>x</title></head></html>";
    const injected = injectOpenAiFileApis(html);
    expect(injected.indexOf("uploadFile")).toBeLessThan(
      injected.indexOf("<title>")
    );
  });

  it("ignores greater-than characters inside quoted head attributes", () => {
    const html =
      "<html><head data-label=\"a > b\" data-other='c > d'><title>x</title></head></html>";
    const injected = injectOpenAiFileApis(html);

    expect(injected).toContain(
      "<head data-label=\"a > b\" data-other='c > d'><script>"
    );
    expect(injected.indexOf("uploadFile")).toBeLessThan(
      injected.indexOf("<title>")
    );
  });
});
