// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolResultDisplay, type ToolResult } from "../ToolResultDisplay";

describe("ToolResultDisplay mixed authentication", () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
  });

  it("only authenticates and reruns the pending result being displayed", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    roots.push(root);
    const onAuthenticateAndRerun = vi.fn();
    const result: ToolResult = {
      toolName: "protected_profile",
      args: {},
      result: null,
      authorizationRequired: true,
      timestamp: 42,
    };
    const render = (pendingAuthorizationTimestamp: number) => (
      <ToolResultDisplay
        results={[result]}
        copiedResult={null}
        serverId="http://localhost:3001/mcp"
        readResource={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onFullscreen={vi.fn()}
        onAuthenticateAndRerun={onAuthenticateAndRerun}
        pendingAuthorizationTimestamp={pendingAuthorizationTimestamp}
      />
    );

    await act(async () => root.render(render(99)));
    let button = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-result-authenticate-rerun"]'
    )!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(onAuthenticateAndRerun).not.toHaveBeenCalled();

    await act(async () => root.render(render(42)));
    button = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-result-authenticate-rerun"]'
    )!;
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onAuthenticateAndRerun).toHaveBeenCalledWith(42);
  });
});
