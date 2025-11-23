/**
 * Wrapper component that adds control buttons for widget debugging and view controls.
 * Combines debug button and view controls (fullscreen/pip) with shared hover logic.
 */

import React, { useEffect, useRef, useState } from "react";
import { useWidget } from "./useWidget.js";

type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

interface WidgetControlsProps {
  children: React.ReactNode;
  className?: string;
  position?: Position;
  attachTo?: HTMLElement | null;
  showLabels?: boolean;
  /**
   * Enable debug button to display widget debug information
   * @default false
   */
  debugger?: boolean;
  /**
   * Enable fullscreen and pip view controls
   * - `true` = show both pip and fullscreen buttons
   * - `"pip"` = show only pip button
   * - `"fullscreen"` = show only fullscreen button
   * @default false
   */
  viewControls?: boolean | "pip" | "fullscreen";
}

/**
 * Wrapper component that adds control buttons for widget debugging and view controls.
 * All buttons share the same hover logic and are rendered together.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   return (
 *     <WidgetControls debugger viewControls position="top-right">
 *       <div>My widget content</div>
 *     </WidgetControls>
 *   );
 * };
 * ```
 */
export function WidgetControls({
  children,
  className = "",
  position = "top-right",
  attachTo,
  showLabels = true,
  debugger: enableDebugger = false,
  viewControls = false,
}: WidgetControlsProps) {
  const {
    props,
    output,
    metadata,
    state,
    theme,
    displayMode,
    safeArea,
    maxHeight,
    userAgent,
    locale,
    isAvailable,
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,
    setState,
  } = useWidget();
  const [isHovered, setIsHovered] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [windowOpenAiKeys, setWindowOpenAiKeys] = useState<string[]>([]);
  const [actionResult, setActionResult] = useState<string>("");
  const [toolName, setToolName] = useState<string>("get-my-city");
  const [toolArgs, setToolArgs] = useState<string>("{}");
  const [followUpMessage, setFollowUpMessage] = useState<string>(
    "Test follow-up message"
  );
  const [externalUrl, setExternalUrl] = useState<string>(
    "https://docs.mcp-use.com"
  );
  const isFullscreen = displayMode === "fullscreen" && isAvailable;
  const isPip = displayMode === "pip" && isAvailable;

  // Detect if we're in dev mode (running in inspector dev widget proxy)
  // In dev mode, hide the controls as they're shown in the inspector instead
  const isDevMode =
    typeof window !== "undefined" &&
    window.location.pathname.includes("/inspector/api/dev-widget/");

  // Get window.openai keys
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (typeof window !== "undefined" && window.openai) {
        try {
          const keys = Object.keys(window.openai);
          setWindowOpenAiKeys(keys);
        } catch (e) {
          setWindowOpenAiKeys([]);
        }
      } else {
        setWindowOpenAiKeys([]);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  // Theme-aware styling
  const isDark = theme === "dark";

  // Calculate position classes and dynamic offsets based on position prop and safe area
  const getPositionClasses = () => {
    const baseClasses = [
      "absolute",
      "z-[1000]",
      "flex",
      "gap-2",
      "transition-opacity",
      "duration-200",
      "ease-in-out",
      isHovered ? "opacity-100" : "opacity-0",
      isHovered ? "pointer-events-auto" : "pointer-events-none",
    ];

    switch (position) {
      case "top-left":
        return [...baseClasses, "top-4", "left-4"];
      case "top-center":
        return [...baseClasses, "top-4", "left-1/2", "-translate-x-1/2"];
      case "top-right":
        return [...baseClasses, "top-4", "right-4"];
      case "center-left":
        return [...baseClasses, "top-1/2", "left-4", "-translate-y-1/2"];
      case "center-right":
        return [...baseClasses, "top-1/2", "right-4", "-translate-y-1/2"];
      case "bottom-left":
        return [...baseClasses, "bottom-4", "left-4"];
      case "bottom-center":
        return [...baseClasses, "bottom-4", "left-1/2", "-translate-x-1/2"];
      case "bottom-right":
        return [...baseClasses, "bottom-4", "right-4"];
      default:
        return [...baseClasses, "top-4", "right-4"];
    }
  };

  // Get dynamic offset styles for safe area (must remain inline)
  const getPositionOffsetStyles = (): React.CSSProperties => {
    const baseOffset = 16;
    const topOffset = safeArea?.insets?.top
      ? Math.max(baseOffset, safeArea.insets.top + 8)
      : baseOffset;
    const rightOffset = safeArea?.insets?.right
      ? Math.max(baseOffset, safeArea.insets.right + 8)
      : baseOffset;
    const bottomOffset = safeArea?.insets?.bottom
      ? Math.max(baseOffset, safeArea.insets.bottom + 8)
      : baseOffset;
    const leftOffset = safeArea?.insets?.left
      ? Math.max(baseOffset, safeArea.insets.left + 8)
      : baseOffset;

    const styles: React.CSSProperties = {};

    switch (position) {
      case "top-left":
        styles.top = `${topOffset}px`;
        styles.left = `${leftOffset}px`;
        break;
      case "top-center":
        styles.top = `${topOffset}px`;
        break;
      case "top-right":
        styles.top = `${topOffset}px`;
        styles.right = `${rightOffset}px`;
        break;
      case "center-left":
        styles.left = `${leftOffset}px`;
        break;
      case "center-right":
        styles.right = `${rightOffset}px`;
        break;
      case "bottom-left":
        styles.bottom = `${bottomOffset}px`;
        styles.left = `${leftOffset}px`;
        break;
      case "bottom-center":
        styles.bottom = `${bottomOffset}px`;
        break;
      case "bottom-right":
        styles.bottom = `${bottomOffset}px`;
        styles.right = `${rightOffset}px`;
        break;
      default:
        styles.top = `${topOffset}px`;
        styles.right = `${rightOffset}px`;
        break;
    }

    return styles;
  };

  // Attach hover handlers to custom element if provided
  useEffect(() => {
    if (!attachTo) return;

    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => setIsHovered(false);

    attachTo.addEventListener("mouseenter", handleMouseEnter);
    attachTo.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      attachTo.removeEventListener("mouseenter", handleMouseEnter);
      attachTo.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [attachTo]);

  // Close overlay when clicking outside
  useEffect(() => {
    if (!isOverlayOpen) return;

    const handleClickOutside = (event: any) => {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as any)
      ) {
        setIsOverlayOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOverlayOpen]);

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (isOverlayOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOverlayOpen]);

  const handleToggleOverlay = () => {
    setIsOverlayOpen(!isOverlayOpen);
  };

  const handleCallTool = async () => {
    try {
      setActionResult("Calling tool...");
      const args = toolArgs.trim() ? JSON.parse(toolArgs) : {};
      const result = await callTool(toolName, args);
      setActionResult(`Success: ${JSON.stringify(result, null, 2)}`);
    } catch (error: any) {
      setActionResult(`Error: ${error.message}`);
    }
  };

  const handleSendFollowUpMessage = async () => {
    try {
      setActionResult("Sending follow-up message...");
      await sendFollowUpMessage(followUpMessage);
      setActionResult("Follow-up message sent successfully");
    } catch (error: any) {
      setActionResult(`Error: ${error.message}`);
    }
  };

  const handleOpenExternal = () => {
    try {
      openExternal(externalUrl);
      setActionResult(`Opened external link: ${externalUrl}`);
    } catch (error: any) {
      setActionResult(`Error: ${error.message}`);
    }
  };

  const handleRequestDisplayMode = async (
    mode: "inline" | "pip" | "fullscreen"
  ) => {
    try {
      setActionResult(`Requesting display mode: ${mode}...`);
      const result = await requestDisplayMode(mode);
      setActionResult(`Display mode granted: ${result.mode}`);
    } catch (error: any) {
      setActionResult(`Error: ${error.message}`);
    }
  };

  const handleSetState = async () => {
    try {
      const newState = state
        ? { ...state, debugTimestamp: new Date().toISOString() }
        : { debugTimestamp: new Date().toISOString() };
      setActionResult("Setting state...");
      await setState(newState);
      setActionResult(`State updated: ${JSON.stringify(newState, null, 2)}`);
    } catch (error: any) {
      setActionResult(`Error: ${error.message}`);
    }
  };

  const handleFullscreen = async () => {
    try {
      await requestDisplayMode("fullscreen");
    } catch (error) {
      console.error("Failed to go fullscreen:", error);
    }
  };

  const handlePip = async () => {
    try {
      await requestDisplayMode("pip");
    } catch (error) {
      console.error("Failed to go pip:", error);
    }
  };

  const getTooltipClasses = () => {
    const baseClasses = [
      "absolute",
      "px-2",
      "py-1",
      "bg-black/90",
      "text-white",
      "rounded",
      "text-xs",
      "whitespace-nowrap",
      "pointer-events-none",
      "transition-opacity",
      "duration-200",
      "ease-in-out",
    ];

    switch (position) {
      case "top-right":
        return [...baseClasses, "top-full", "right-0", "mt-2"];
      case "top-left":
        return [...baseClasses, "top-full", "left-0", "mt-2"];
      case "top-center":
        return [
          ...baseClasses,
          "top-full",
          "left-1/2",
          "-translate-x-1/2",
          "mt-2",
        ];
      case "bottom-right":
        return [...baseClasses, "bottom-full", "right-0", "mb-2"];
      case "bottom-left":
        return [...baseClasses, "bottom-full", "left-0", "mb-2"];
      case "bottom-center":
        return [
          ...baseClasses,
          "bottom-full",
          "left-1/2",
          "-translate-x-1/2",
          "mb-2",
        ];
      case "center-left":
        return [
          ...baseClasses,
          "left-full",
          "top-1/2",
          "-translate-y-1/2",
          "ml-2",
        ];
      case "center-right":
        return [
          ...baseClasses,
          "right-full",
          "top-1/2",
          "-translate-y-1/2",
          "mr-2",
        ];
      default:
        return [...baseClasses, "top-full", "right-0", "mt-2"];
    }
  };

  const IconButton = ({
    onClick,
    label,
    children: icon,
  }: {
    onClick: () => void;
    label: string;
    children: React.ReactNode;
  }) => {
    const [isButtonHovered, setIsButtonHovered] = useState(false);
    const tooltipClasses = getTooltipClasses();

    return (
      <button
        className={`p-2 ${isDark ? "bg-white/10 hover:bg-white/20" : "bg-black/70 hover:bg-black/90"} text-white border-none rounded-lg cursor-pointer flex items-center justify-center w-8 h-8 transition-colors duration-200 backdrop-blur-md ${isDark ? "shadow-[0_2px_8px_rgba(0,0,0,0.3)]" : "shadow-[0_2px_8px_rgba(0,0,0,0.2)]"} relative`}
        onMouseEnter={() => setIsButtonHovered(true)}
        onMouseLeave={() => setIsButtonHovered(false)}
        onClick={onClick}
        aria-label={label}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="block"
        >
          {icon}
        </svg>
        {showLabels && (
          <span
            className={`${tooltipClasses.join(" ")} ${isButtonHovered ? "opacity-100" : "opacity-0"}`}
          >
            {label}
          </span>
        )}
      </button>
    );
  };

  // Format value for display in table
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

  // Simplify user agent for display
  const formatUserAgent = (ua: typeof userAgent): string => {
    if (!ua) return "N/A";
    return `${ua.device?.type || "unknown"}`;
  };

  // Simplify safe area for display
  const formatSafeArea = (sa: typeof safeArea): string => {
    if (!sa?.insets) return "N/A";
    const { top, bottom, left, right } = sa.insets;
    return `T:${top} B:${bottom} L:${left} R:${right}`;
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`${className} relative h-fit`}
        onMouseEnter={() => !attachTo && setIsHovered(true)}
        onMouseLeave={() => !attachTo && setIsHovered(false)}
      >
        {/* Inline styles needed for dynamic safe area offsets */}
        <div
          className={getPositionClasses().join(" ")}
          style={getPositionOffsetStyles()}
        >
          {/* In dev mode, hide all controls as they're shown in the inspector instead */}
          {!isDevMode && (
            <>
              {/* View controls (fullscreen/pip) - only show when not already in fullscreen/pip */}
              {!isFullscreen && !isPip && (
                <>
                  {(viewControls === true || viewControls === "fullscreen") && (
                    <IconButton onClick={handleFullscreen} label="Fullscreen">
                      <path d="M15 3h6v6" />
                      <path d="m21 3-7 7" />
                      <path d="m3 21 7-7" />
                      <path d="M9 21H3v-6" />
                    </IconButton>
                  )}
                  {(viewControls === true || viewControls === "pip") && (
                    <IconButton onClick={handlePip} label="Picture in Picture">
                      <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
                      <rect width="10" height="7" x="12" y="13" rx="2" />
                    </IconButton>
                  )}
                </>
              )}
              {/* Debug button - only show if debugger prop is true */}
              {enableDebugger && (
                <IconButton onClick={handleToggleOverlay} label="Debug Info">
                  <path d="M12 20v-9" />
                  <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
                  <path d="M14.12 3.88 16 2" />
                  <path d="M21 21a4 4 0 0 0-3.81-4" />
                  <path d="M21 5a4 4 0 0 1-3.55 3.97" />
                  <path d="M22 13h-4" />
                  <path d="M3 21a4 4 0 0 1 3.81-4" />
                  <path d="M3 5a4 4 0 0 0 3.55 3.97" />
                  <path d="M6 13H2" />
                  <path d="m8 2 1.88 1.88" />
                  <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
                </IconButton>
              )}
            </>
          )}
        </div>
        {children}
      </div>

      {isOverlayOpen && enableDebugger && (
        <div
          ref={overlayRef}
          className="fixed inset-0 bg-black text-white font-mono text-xs z-[10000] overflow-auto p-4"
          onClick={(e) => {
            // Close on backdrop click
            if (e.target === overlayRef.current) {
              setIsOverlayOpen(false);
            }
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setIsOverlayOpen(false)}
            className="absolute top-4 right-4 bg-white/10 text-white border-none rounded w-8 h-8 cursor-pointer flex items-center justify-center text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>

          {/* Debug info table */}
          <div className="max-w-[1200px] mx-auto pt-10">
            <h1 className="text-lg font-bold mb-4 border-b border-gray-700 pb-2">
              Debug Info
            </h1>

            <table className="w-full border-collapse border-spacing-0">
              <tbody>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">Props</td>
                  <td className="p-2 whitespace-pre-wrap break-all">
                    {formatValue(props)}
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">Output</td>
                  <td className="p-2 whitespace-pre-wrap break-all">
                    {formatValue(output)}
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    Metadata
                  </td>
                  <td className="p-2 whitespace-pre-wrap break-all">
                    {formatValue(metadata)}
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">State</td>
                  <td className="p-2 whitespace-pre-wrap break-all">
                    {formatValue(state)}
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">Theme</td>
                  <td className="p-2">{theme}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    Display Mode
                  </td>
                  <td className="p-2">{displayMode}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">Locale</td>
                  <td className="p-2">{locale}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    Max Height
                  </td>
                  <td className="p-2">{maxHeight}px</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    User Agent
                  </td>
                  <td className="p-2">{formatUserAgent(userAgent)}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    Safe Area
                  </td>
                  <td className="p-2">{formatSafeArea(safeArea)}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    API Available
                  </td>
                  <td className="p-2">{isAvailable ? "Yes" : "No"}</td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="p-2 font-bold w-[200px] align-top">
                    window.openai Keys
                  </td>
                  <td className="p-2">
                    {windowOpenAiKeys.length > 0
                      ? windowOpenAiKeys.join(", ")
                      : "N/A"}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Actions Section */}
            <h2 className="text-base font-bold mt-8 mb-4 border-b border-gray-700 pb-2">
              Actions
            </h2>

            <div className="flex flex-col gap-3">
              {/* Call Tool */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="Tool name"
                  className="py-1.5 px-2 bg-[#1a1a1a] text-white border border-gray-700 rounded font-mono text-xs w-[150px]"
                />
                <input
                  type="text"
                  value={toolArgs}
                  onChange={(e) => setToolArgs(e.target.value)}
                  placeholder='{"key": "value"}'
                  className="py-1.5 px-2 bg-[#1a1a1a] text-white border border-gray-700 rounded font-mono text-xs flex-1"
                />
                <button
                  onClick={handleCallTool}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs"
                >
                  Call Tool
                </button>
              </div>

              {/* Send Follow-Up Message */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Follow-up message"
                  className="py-1.5 px-2 bg-[#1a1a1a] text-white border border-gray-700 rounded font-mono text-xs flex-1"
                />
                <button
                  onClick={handleSendFollowUpMessage}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs"
                >
                  Send Follow-Up
                </button>
              </div>

              {/* Open External */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="External URL"
                  className="py-1.5 px-2 bg-[#1a1a1a] text-white border border-gray-700 rounded font-mono text-xs flex-1"
                />
                <button
                  onClick={handleOpenExternal}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs"
                >
                  Open Link
                </button>
              </div>

              {/* Request Display Mode */}
              <div className="flex gap-2 items-center">
                <span className="w-[150px] text-xs">Display Mode:</span>
                <button
                  onClick={() => handleRequestDisplayMode("inline")}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs flex-1"
                >
                  Inline
                </button>
                <button
                  onClick={() => handleRequestDisplayMode("pip")}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs flex-1"
                >
                  PiP
                </button>
                <button
                  onClick={() => handleRequestDisplayMode("fullscreen")}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs flex-1"
                >
                  Fullscreen
                </button>
              </div>

              {/* Set State */}
              <div className="flex gap-2 items-center">
                <button
                  onClick={handleSetState}
                  className="py-1.5 px-3 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-xs"
                >
                  Set State (Add Timestamp)
                </button>
              </div>

              {/* Action Result */}
              {actionResult && (
                <div className="mt-2 p-2 bg-[#1a1a1a] border border-gray-700 rounded whitespace-pre-wrap break-all text-[11px] max-h-[200px] overflow-auto">
                  <div className="font-bold mb-1 text-gray-400">Result:</div>
                  {actionResult}
                  <button
                    onClick={() => setActionResult("")}
                    className="mt-2 py-1 px-2 bg-gray-800 text-white border border-gray-600 rounded cursor-pointer font-mono text-[11px]"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
