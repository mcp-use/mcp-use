import { Bug, Maximize2, PictureInPicture } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface WidgetInspectorControlsProps {
  displayMode: "inline" | "pip" | "fullscreen";
  onDisplayModeChange: (mode: "inline" | "pip" | "fullscreen") => void;
  toolInput: any;
  toolOutput: any;
  toolResult: any;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  toolId: string;
}

export function WidgetInspectorControls({
  displayMode,
  onDisplayModeChange,
  toolInput,
  toolOutput,
  toolResult,
  iframeRef,
  toolId,
}: WidgetInspectorControlsProps) {
  const [isDebugOverlayOpen, setIsDebugOverlayOpen] = useState(false);
  const [widgetState, setWidgetState] = useState<any>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch widget state from iframe
  useEffect(() => {
    if (!isDebugOverlayOpen || !iframeRef.current) return;

    const fetchWidgetState = () => {
      try {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (iframeWindow?.openai?.widgetState !== undefined) {
          setWidgetState(iframeWindow.openai.widgetState);
        }
      } catch (e) {
        // Cross-origin or not accessible
      }
    };

    // Try to access directly if same-origin
    fetchWidgetState();

    // Also request via postMessage
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "mcp-inspector:getWidgetState",
          toolId,
        },
        "*"
      );
    }

    // Listen for widget state updates
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "mcp-inspector:widgetStateResponse" &&
        event.data.toolId === toolId
      ) {
        setWidgetState(event.data.state);
      } else if (
        event.data?.type === "openai:setWidgetState" &&
        event.data.toolId === toolId
      ) {
        setWidgetState(event.data.state);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isDebugOverlayOpen, iframeRef, toolId]);

  // Close overlay when clicking outside
  useEffect(() => {
    if (!isDebugOverlayOpen) return;

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as globalThis.Node)
      ) {
        setIsDebugOverlayOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDebugOverlayOpen]);

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (isDebugOverlayOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDebugOverlayOpen]);

  const formatValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

  return (
    <>
      <div className="flex items-center gap-2">
        {/* View Switcher Buttons - only show when not already in fullscreen/pip */}
        {!isFullscreen && !isPip && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  onClick={() => onDisplayModeChange("fullscreen")}
                >
                  <Maximize2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Enter fullscreen mode</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  onClick={() => onDisplayModeChange("pip")}
                >
                  <PictureInPicture className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Enter picture-in-picture mode</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {/* Debugger Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              onClick={() => setIsDebugOverlayOpen(true)}
            >
              <Bug className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Open debug overlay</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Debug Overlay */}
      {isDebugOverlayOpen && (
        <div
          ref={overlayRef}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#000000",
            color: "#ffffff",
            fontFamily: "monospace",
            fontSize: "12px",
            zIndex: 10000,
            overflow: "auto",
            padding: "16px",
          }}
          onClick={(e) => {
            // Close on backdrop click
            if (e.target === overlayRef.current) {
              setIsDebugOverlayOpen(false);
            }
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setIsDebugOverlayOpen(false)}
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              width: "32px",
              height: "32px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>

          {/* Debug info table */}
          <div
            style={{ maxWidth: "1200px", margin: "0 auto", paddingTop: "40px" }}
          >
            <h1
              style={{
                fontSize: "18px",
                fontWeight: "bold",
                marginBottom: "16px",
                borderBottom: "1px solid #333",
                paddingBottom: "8px",
              }}
            >
              Debug Info
            </h1>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                borderSpacing: 0,
              }}
            >
              <tbody>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Props (Tool Input)
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(toolInput)}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Output (Tool Output)
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(toolOutput)}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Metadata
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(
                      toolResult?._meta ||
                        toolResult?.contents?.[0]?._meta ||
                        null
                    )}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Widget State
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(widgetState)}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Display Mode
                  </td>
                  <td style={{ padding: "8px" }}>{displayMode}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
