import React, { useState } from "react";

import { useViewActions } from "../bridge/view-bridge.js";
import { useHostContext } from "../hooks/use-host-context.js";
import { useToolContext } from "../hooks/use-tool-context.js";

/**
 * Static styles for the debug overlay `<pre>`. Hoisted to module scope so the
 * object keeps a stable identity across renders (this runtime ships no
 * stylesheet, so a CSS class is not an option here).
 */
const debugOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  margin: 0,
  padding: 16,
  background: "#111",
  color: "#eee",
  overflow: "auto",
  fontSize: 12,
};

interface ViewControlsProps {
  children: React.ReactNode;
  /** Show a debug overlay with view state and action testers. */
  debugger?: boolean;
  /** Show fullscreen / PiP display-mode buttons. */
  viewControls?: boolean | "pip" | "fullscreen";
}

/**
 * Dev-only overlay with debug info and bridge action testers.
 */
export function ViewControls({
  children,
  debugger: enableDebugger = false,
  viewControls = false,
}: ViewControlsProps) {
  const context = useToolContext();
  const host = useHostContext();
  const { requestDisplayMode } = useViewActions();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const showControls = enableDebugger || viewControls;

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showControls && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 1000,
            display: "flex",
            gap: 8,
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        >
          {viewControls && host.displayMode === "inline" && (
            <>
              {(viewControls === true || viewControls === "fullscreen") && (
                <button
                  type="button"
                  aria-label="Fullscreen"
                  onClick={() => void requestDisplayMode({ mode: "fullscreen" })}
                >
                  FS
                </button>
              )}
              {(viewControls === true || viewControls === "pip") && (
                <button
                  type="button"
                  aria-label="Picture in picture"
                  onClick={() => void requestDisplayMode({ mode: "pip" })}
                >
                  PiP
                </button>
              )}
            </>
          )}
          {enableDebugger && (
            <button type="button" aria-label="Debug" onClick={() => setOpen((v) => !v)}>
              Debug
            </button>
          )}
        </div>
      )}
      {children}
      {enableDebugger && open && (
        <pre style={debugOverlayStyle}>
          {JSON.stringify(
            {
              toolOutput:
                context.status === "ready" ? context.toolOutput : undefined,
              content: context.status === "ready" ? context.content : undefined,
              toolInput: context.toolInput,
              meta: context.status === "ready" ? context.meta : undefined,
              theme: host.theme,
              displayMode: host.displayMode,
              isAvailable: host.isAvailable,
            },
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
}
