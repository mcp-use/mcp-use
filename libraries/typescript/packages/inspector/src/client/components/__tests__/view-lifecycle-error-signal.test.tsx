// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ViewLifecycleEvent } from "@mcp-use/client/react";
import { useViewLifecycleErrorSignal } from "../ViewPreview";

/**
 * Mount the hook alone and hand back its emit callback, so a lifecycle
 * sequence can be replayed against the real `useRef` identity the component
 * would give it.
 */
function mountSignal(): {
  emit: (event: ViewLifecycleEvent) => void;
  root: Root;
} {
  let onLifecycle!: (event: ViewLifecycleEvent) => void;

  function Probe() {
    onLifecycle = useViewLifecycleErrorSignal();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });

  return { emit: (event) => act(() => onLifecycle(event)), root };
}

describe("useViewLifecycleErrorSignal", () => {
  let root: Root | undefined;
  let emit: (event: ViewLifecycleEvent) => void;

  beforeEach(() => {
    ({ emit, root } = mountSignal());
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    delete document.body.dataset.viewError;
    delete document.body.dataset.viewErrorMessage;
  });

  it("keeps the failure marker when a superseded attempt's teardown arrives after the error", () => {
    emit({ status: "connecting" });
    emit({ status: "error", error: "sandbox connect failed" });

    expect(document.body.dataset.viewError).toBe("view_load_failed");

    // Late "closed" from the older bridge attempt — it must not erase the
    // current attempt's failure.
    emit({ status: "closed" });

    expect(document.body.dataset.viewError).toBe("view_load_failed");
    expect(document.body.dataset.viewErrorMessage).toBe(
      "sandbox connect failed"
    );
  });

  it("keeps the failure marker across a late tearing-down", () => {
    emit({ status: "resolving" });
    emit({ status: "error", error: "resource not found" });
    emit({ status: "tearing-down" });

    expect(document.body.dataset.viewError).toBe("view_load_failed");
  });

  it("ignores a post-initialization error", () => {
    emit({ status: "connecting" });
    emit({ status: "initialized" });
    emit({ status: "error", error: "HMR re-sync failed" });

    expect(document.body.dataset.viewError).toBeUndefined();
  });

  it("re-arms on a bridge reconnect after a successful initialization", () => {
    emit({ status: "connecting" });
    emit({ status: "ready" });
    emit({ status: "connecting" });
    emit({ status: "error", error: "reconnect handshake failed" });

    expect(document.body.dataset.viewError).toBe("view_load_failed");
  });

  it("clears a previous failure once a fresh attempt starts and succeeds", () => {
    emit({ status: "connecting" });
    emit({ status: "error", error: "sandbox connect failed" });

    emit({ status: "resolving" });
    expect(document.body.dataset.viewError).toBeUndefined();

    emit({ status: "sandbox-loading" });
    emit({ status: "connecting" });
    emit({ status: "ready" });

    expect(document.body.dataset.viewError).toBeUndefined();
    expect(document.body.dataset.viewErrorMessage).toBeUndefined();
  });
});
