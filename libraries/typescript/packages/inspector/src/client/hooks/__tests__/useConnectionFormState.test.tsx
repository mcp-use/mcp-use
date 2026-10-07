// @vitest-environment jsdom

import type { McpServer } from "@mcp-use/client/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoredConnectionConfig,
  saveStoredConnectionConfig,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";
import { useConnectionFormState } from "../useConnectionFormState";

describe("connection settings timeout hydration", () => {
  const roots = new Set<Root>();
  let form: ReturnType<typeof useConnectionFormState>;

  function Form({ connection }: { connection: McpServer }) {
    form = useConnectionFormState(connection, true);
    return null;
  }

  function server(url: string): McpServer {
    return { id: url, url, displayName: "Example" } as McpServer;
  }

  async function mount(connection: McpServer): Promise<Root> {
    const root = createRoot(document.createElement("div"));
    roots.add(root);
    await act(async () => root.render(<Form connection={connection} />));
    return root;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    roots.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("preserves cleared timeouts through remount and an alias-only save", async () => {
    const url = "https://example.com/mcp";
    saveStoredConnectionConfig(url, {
      url,
      transportType: "http",
      requestTimeout: 3000,
      maxTotalTimeout: 4000,
    });
    const root = await mount(server(url));
    expect(form.requestTimeout).toBe("3000");
    expect(form.maxTotalTimeout).toBe("4000");

    await act(async () => {
      form.setRequestTimeout("");
      form.setMaxTotalTimeout("");
    });
    saveStoredConnectionConfig(url, form.buildConfig()!);
    await act(async () => root.unmount());
    roots.delete(root);

    await mount(server(url));
    expect(form.requestTimeout).toBe("");
    expect(form.maxTotalTimeout).toBe("");
    await act(async () => form.setAlias("Renamed"));
    saveStoredConnectionConfig(url, form.buildConfig()!);

    const saved = getStoredConnectionConfig<EditableConnectionConfig>(url);
    expect(saved).toMatchObject({ displayName: "Renamed" });
    expect(saved?.requestTimeout).toBeUndefined();
    expect(saved?.maxTotalTimeout).toBeUndefined();
  });

  it("does not carry another connection's timeout settings into unsaved fields", async () => {
    const firstUrl = "https://first.example/mcp";
    const secondUrl = "https://second.example/mcp";
    saveStoredConnectionConfig(firstUrl, {
      url: firstUrl,
      transportType: "http",
      requestTimeout: 700,
      maxTotalTimeout: 1000,
      resetTimeoutOnProgress: false,
    });
    const root = await mount(server(firstUrl));
    expect(form.resetTimeoutOnProgress).toBe("False");

    await act(async () => root.render(<Form connection={server(secondUrl)} />));
    expect(form.requestTimeout).toBe("");
    expect(form.maxTotalTimeout).toBe("");
    expect(form.resetTimeoutOnProgress).toBe("True");
    expect(form.buildConfig()).toMatchObject({
      url: secondUrl,
      requestTimeout: undefined,
      maxTotalTimeout: undefined,
      resetTimeoutOnProgress: true,
    });
  });
});
