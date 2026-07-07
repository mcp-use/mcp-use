import React, { useState } from "react";

import { useView } from "../hooks/use-view.js";

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
  const view = useView();
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
          {viewControls && view.displayMode === "inline" && (
            <>
              {(viewControls === true || viewControls === "fullscreen") && (
                <button
                  type="button"
                  aria-label="Fullscreen"
                  onClick={() => void view.requestDisplayMode({ mode: "fullscreen" })}
                >
                  FS
                </button>
              )}
              {(viewControls === true || viewControls === "pip") && (
                <button
                  type="button"
                  aria-label="Picture in picture"
                  onClick={() => void view.requestDisplayMode({ mode: "pip" })}
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
        <pre
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            margin: 0,
            padding: 16,
            background: "#111",
            color: "#eee",
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {JSON.stringify(
            {
              props: view.props,
              toolInput: view.toolInput,
              meta: view.meta,
              theme: view.theme,
              displayMode: view.displayMode,
              isAvailable: view.isAvailable,
            },
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
}
