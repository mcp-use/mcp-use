// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetDebugProvider } from "@/client/context/WidgetDebugContext";
import type { useViewHostProps } from "@/client/hooks/useViewHostProps";
import { ToolResultRenderer } from "../ToolResultRenderer";

// Supply the host connection without requiring Inspector's server/session
// providers. Keep the real panel and ViewRenderer so the URI must reach an
// actual resource read before the sandbox frame can mount.
vi.mock("@/client/hooks/useViewHostProps", () => ({
  useViewHostProps: ({
    resourceUri,
    readResource,
    onLifecycleChange,
  }: Parameters<typeof useViewHostProps>[0]) => ({
    source: {
      kind: "live",
      resourceUri,
      connection: { readResource, callTool: async () => ({}) },
    },
    sandboxUrl: new URL("https://sandbox.example/inspector/sandbox"),
    onLifecycleChange,
  }),
}));

describe("ToolResultRenderer view resource loading", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
  });

  it.each([
    {
      name: "legacy flat metadata",
      toolMeta: { "ui/resourceUri": "ui://weather/forecast.html" },
    },
    {
      name: "nested metadata",
      toolMeta: { ui: { resourceUri: "ui://weather/forecast.html" } },
    },
    {
      name: "nested metadata taking precedence over the flat key",
      toolMeta: {
        ui: { resourceUri: "ui://weather/forecast.html" },
        "ui/resourceUri": "ui://wrong/legacy.html",
      },
    },
  ])("loads the chat view from $name", async ({ toolMeta }) => {
    const readResource = vi.fn(async () => ({
      contents: [
        {
          uri: "ui://weather/forecast.html",
          mimeType: "text/html;profile=mcp-app",
          text: "<html><body>Weather forecast</body></html>",
        },
      ],
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <WidgetDebugProvider>
          <ToolResultRenderer
            toolName="weather"
            toolArgs={{ city: "Tokyo" }}
            result={{ content: [{ type: "text", text: "Sunny" }] }}
            toolMeta={toolMeta}
            serverId="weather-server"
            readResource={readResource}
          />
        </WidgetDebugProvider>
      );
    });

    expect(readResource).toHaveBeenCalledWith("ui://weather/forecast.html");
    expect(container.querySelector("iframe")?.src).toBe(
      "https://sandbox.example/inspector/sandbox"
    );
    expect(
      container.querySelector('[data-testid="mcp-apps-loading-overlay"]')
    ).toBeNull();
  });
});
