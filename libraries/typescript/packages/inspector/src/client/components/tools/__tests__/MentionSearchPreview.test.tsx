// @vitest-environment jsdom
import { act } from "react";
import type { Tool } from "@mcp-use/client/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MentionSearchPreview,
  isMentionSearchTool,
  type MentionPreviewCall,
} from "../MentionSearchPreview";

const tool = {
  name: "workspace.mentions",
  inputSchema: { type: "object" as const },
  _meta: { "openai/extensions": { "mentions/search": {} } },
};
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});
async function render(callTool: MentionPreviewCall, selected: Tool = tool) {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MentionSearchPreview tool={selected} callTool={callTool} isConnected />
    )
  );
}
async function open() {
  await act(async () =>
    (container.querySelector("button") as HTMLButtonElement).click()
  );
}
async function query(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("mention preview", () => {
  it("only offers the preview for marked tools", async () => {
    expect(isMentionSearchTool(tool)).toBe(true);
    expect(
      isMentionSearchTool({ name: "ordinary", inputSchema: { type: "object" } })
    ).toBe(false);
    const call = vi.fn(async () => ({}));
    await render(call, { ...tool, _meta: {} });
    expect(container.textContent).toBe("");
    expect(call).not.toHaveBeenCalled();
  });

  it("sends empty queries and renders names, titles and URIs", async () => {
    const call = vi.fn(async () => ({
      content: [],
      structuredContent: {
        items: [
          {
            type: "resource_link",
            uri: "workspace://file/1",
            name: "roadmap.md",
            title: "Roadmap",
          },
        ],
      },
    }));
    await render(call);
    expect(call).not.toHaveBeenCalled();
    await open();
    expect(call).toHaveBeenCalledWith(
      tool.name,
      { query: "" },
      { signal: expect.any(AbortSignal) }
    );
    expect(container.textContent).toContain("Roadmap");
    expect(container.textContent).toContain("roadmap.md");
    expect(container.textContent).toContain("workspace://file/1");
  });

  it.each([
    {
      response: { structuredContent: { items: [] } },
      text: "No matches",
      role: "status",
    },
    {
      response: {
        isError: true,
        content: [{ type: "text", text: "Access denied" }],
      },
      text: "Access denied",
      role: "alert",
    },
    {
      response: { structuredContent: { items: [{ type: "text" }] } },
      text: "invalid resource links",
      role: "alert",
    },
  ])(
    "keeps empty results separate from errors: $text",
    async ({ response, text, role }) => {
      await render(vi.fn(async () => response));
      await open();
      expect(
        container.querySelector(`[role="${role}"]`)?.textContent
      ).toContain(text);
    }
  );

  it("shows thrown tool errors", async () => {
    await render(
      vi.fn(async () => {
        throw new Error("Disconnected");
      })
    );
    await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Disconnected"
    );
  });

  it("aborts superseded searches and ignores slow stale responses even if abort is ignored", async () => {
    const pending: {
      resolve: (value: unknown) => void;
      signal: AbortSignal;
    }[] = [];
    const call = vi.fn<MentionPreviewCall>(
      (_name, _args, { signal }) =>
        new Promise((resolve) => pending.push({ resolve, signal }))
    );
    await render(call);
    await open();
    await query("road");
    expect(call).toHaveBeenLastCalledWith(
      tool.name,
      { query: "road" },
      { signal: expect.any(AbortSignal) }
    );
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () =>
      pending[1]!.resolve({
        structuredContent: {
          items: [
            { type: "resource_link", name: "Newest", uri: "workspace://new" },
          ],
        },
      })
    );
    await act(async () =>
      pending[0]!.resolve({
        structuredContent: {
          items: [
            { type: "resource_link", name: "Stale", uri: "workspace://old" },
          ],
        },
      })
    );
    expect(container.textContent).toContain("Newest");
    expect(container.textContent).not.toContain("Stale");
    await act(async () =>
      (container.querySelector("button") as HTMLButtonElement).click()
    );
    expect(pending[1]!.signal.aborted).toBe(true);
  });
});
