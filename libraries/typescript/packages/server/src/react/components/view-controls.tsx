import React, { useRef, useState } from "react";

import { useDisplayMode } from "../hooks/use-display-mode.js";
import { useHostContext } from "../hooks/use-host-context.js";
import { useToolContext } from "../hooks/use-tool-context.js";

/**
 * Static styles for the debug overlay. Hoisted to module scope so the objects
 * keep stable identities across renders (this runtime ships no stylesheet, so
 * CSS classes are not an option here).
 */
const debugOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  boxSizing: "border-box",
  padding: "56px 16px 16px",
  background: "#111",
  color: "#eee",
  overflow: "auto",
};

const debugContentStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const debugCloseButtonStyle: React.CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  zIndex: 10001,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  border: "2px solid #111",
  borderRadius: 9999,
  background: "#fff",
  color: "#111",
  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.45)",
  cursor: "pointer",
  fontSize: 26,
  fontWeight: 600,
  lineHeight: 1,
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
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const displayModeBeforeDebugRef = useRef(displayMode);
  const restoreDisplayModeOnCloseRef = useRef(false);

  const showControls = enableDebugger || viewControls;

  const openDebugger = () => {
    displayModeBeforeDebugRef.current = displayMode;
    setOpen(true);

    const canExpand =
      displayMode !== "fullscreen" &&
      availableDisplayModes.includes("fullscreen");
    restoreDisplayModeOnCloseRef.current = canExpand;

    if (canExpand) {
      void requestDisplayMode({ mode: "fullscreen" }).catch(() => {
        // The overlay remains usable inline when the host denies expansion.
        restoreDisplayModeOnCloseRef.current = false;
      });
    }
  };

  const closeDebugger = () => {
    setOpen(false);

    if (!restoreDisplayModeOnCloseRef.current) return;
    restoreDisplayModeOnCloseRef.current = false;
    void requestDisplayMode({
      mode: displayModeBeforeDebugRef.current,
    }).catch(() => {
      // The host owns display mode; closing the overlay must never be blocked.
    });
  };

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
                  onClick={() =>
                    void requestDisplayMode({ mode: "fullscreen" })
                  }
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
            <button type="button" aria-label="Debug" onClick={openDebugger}>
              Debug
            </button>
          )}
        </div>
      )}
      {children}
      {enableDebugger && open && (
        <div
          style={debugOverlayStyle}
          role="dialog"
          aria-modal="true"
          aria-label="Debug info"
        >
          <button
            type="button"
            style={debugCloseButtonStyle}
            aria-label="Close debug"
            title="Close debug"
            onClick={closeDebugger}
          >
            ×
          </button>
          <pre style={debugContentStyle}>
            {JSON.stringify(
              {
                status: context.status,
                toolOutput:
                  context.status === "ready" ? context.toolOutput : undefined,
                content:
                  context.status === "ready" || context.status === "error"
                    ? context.content
                    : undefined,
                toolInput: context.toolInput,
                meta:
                  context.status === "ready" || context.status === "error"
                    ? context.meta
                    : undefined,
                error: context.status === "error" ? context.error : undefined,
                theme: host.theme,
                displayMode: host.displayMode,
                isAvailable: host.isAvailable,
              },
              null,
              2
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
