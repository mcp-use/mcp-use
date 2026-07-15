import { describe, expect, it, vi } from "vitest";
import {
  createConnectorFromConfig,
  resolveCallbacks,
} from "../../../src/core/config.js";
import { BaseConnector } from "../../../src/transport/base.js";
import { HttpConnector } from "../../../src/transport/http.js";

const sampling = vi.fn().mockResolvedValue({
  role: "assistant",
  content: { type: "text", text: "ok" },
  model: "test",
  stopReason: "endTurn",
});
const elicitation = vi.fn().mockResolvedValue({ action: "accept" as const });

describe("callback configuration", () => {
  it("uses per-server callbacks ahead of global defaults", () => {
    const globalSampling = vi.fn();
    const result = resolveCallbacks(
      { onSampling: sampling },
      { onSampling: globalSampling, onElicitation: elicitation }
    );

    expect(result.onSampling).toBe(sampling);
    expect(result.onElicitation).toBe(elicitation);
  });

  it("keeps canonical callbacks unchanged on connectors", () => {
    const connector = new BaseConnector({
      onSampling: sampling,
      onElicitation: elicitation,
    });

    expect((connector as any).opts.onSampling).toBe(sampling);
    expect((connector as any).opts.onElicitation).toBe(elicitation);
  });

  it("advertises the capabilities supplied by canonical callbacks", () => {
    const connector = new HttpConnector("https://example.com/mcp", {
      onSampling: sampling,
      onElicitation: elicitation,
    });
    const options = (connector as any).buildClientOptions();

    expect(options.capabilities.sampling).toEqual({});
    expect(options.capabilities.elicitation).toEqual({ form: {}, url: {} });
  });

  it("forwards roots and expands viewSupport from HTTP server config", () => {
    const roots = [{ uri: "file:///tmp/example", name: "Example" }];
    const connector = createConnectorFromConfig({
      url: "https://example.com/mcp",
      roots,
      timeout: 1234,
      viewSupport: true,
    }) as HttpConnector;

    expect((connector as any).opts.roots).toBe(roots);
    expect((connector as any).timeout).toBe(1234);
    expect(
      (connector as any).buildClientOptions().capabilities.extensions
    ).toEqual({
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    });
  });
});
