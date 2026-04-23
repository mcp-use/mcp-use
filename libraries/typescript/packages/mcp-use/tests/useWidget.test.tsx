// @vitest-environment jsdom
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it } from "vitest";
import { useWidget } from "../src/react/useWidget";

type HookResult = ReturnType<typeof useWidget<Record<string, unknown>, unknown>>;

// Tiny harness that renders nothing visible but captures the hook's return value
// on every render so tests can assert against it.
function Harness({ onResult }: { onResult: (r: HookResult) => void }) {
  const result = useWidget();
  onResult(result);
  return null;
}

function renderHook() {
  let latest: HookResult | undefined;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <Harness onResult={(r) => (latest = r)} />
    );
  });
  return {
    get result() {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    unmount: () => renderer?.unmount(),
  };
}

function resetWindow() {
  // Clear any openai global that a prior test set.
  delete (window as unknown as { openai?: unknown }).openai;
  // Reset the URL to have no search string.
  window.history.replaceState(null, "", "/");
}

describe("useWidget isPending — openai provider", () => {
  beforeEach(() => {
    resetWindow();
  });

  it("stays pending when window.openai.toolOutput is undefined", () => {
    // Host has wired up `window.openai` but hasn't delivered tool output yet.
    // Previously useOpenAiGlobal's `undefined === null` check failed, flipping
    // isPending to false on the very first render.
    (window as unknown as { openai: Record<string, unknown> }).openai = {};
    const hook = renderHook();
    expect(hook.result.isPending).toBe(true);
    hook.unmount();
  });

  it("stays pending when only toolOutput is populated but metadata is not", () => {
    (window as unknown as { openai: Record<string, unknown> }).openai = {
      toolOutput: { hello: "world" },
    };
    const hook = renderHook();
    // isPending flips as soon as either toolOutput OR toolResponseMetadata arrives
    expect(hook.result.isPending).toBe(false);
    hook.unmount();
  });

  it("stays pending when only metadata is populated but toolOutput is not", () => {
    (window as unknown as { openai: Record<string, unknown> }).openai = {
      toolResponseMetadata: { _meta: "x" },
    };
    const hook = renderHook();
    expect(hook.result.isPending).toBe(false);
    hook.unmount();
  });
});

describe("useWidget isPending — mcp-ui url-params fallback", () => {
  beforeEach(() => {
    resetWindow();
  });

  it("stays pending when running standalone without mcpUseParams", () => {
    // No iframe, no `mcpUseParams` — previously the empty-object default made
    // isPending read false and widgets rendered with empty props.
    const hook = renderHook();
    expect(hook.result.isPending).toBe(true);
    hook.unmount();
  });

  it("resolves when mcpUseParams supplies toolOutput", () => {
    const params = encodeURIComponent(
      JSON.stringify({
        toolInput: {},
        toolOutput: { foo: "bar" },
        toolId: "tool-1",
      })
    );
    window.history.replaceState(null, "", `/?mcpUseParams=${params}`);
    const hook = renderHook();
    expect(hook.result.isPending).toBe(false);
    hook.unmount();
  });
});
