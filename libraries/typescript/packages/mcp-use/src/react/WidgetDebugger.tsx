/**
 * Wrapper component that adds a debug button to display widget debug information.
 * Shows a bug icon button that opens a minimal overlay with debug data in table format.
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

interface WidgetDebuggerProps {
  children: React.ReactNode;
  className?: string;
  position?: Position;
  attachTo?: HTMLElement | null;
  showLabels?: boolean;
}

/**
 * Wrapper component that adds a debug button to display widget debug information.
 * The button shows a bug icon and opens an overlay with debug data in a minimal table format.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   return (
 *     <WidgetDebugger position="top-right">
 *       <div>My widget content</div>
 *     </WidgetDebugger>
 *   );
 * };
 * ```
 */
export function WidgetDebugger({
  children,
  className = "",
  position = "top-right",
  attachTo,
  showLabels = true,
}: WidgetDebuggerProps) {
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
  const [followUpMessage, setFollowUpMessage] = useState<string>("Test follow-up message");
  const [externalUrl, setExternalUrl] = useState<string>("https://docs.mcp-use.com");
  const isFullscreen = displayMode === "fullscreen" && isAvailable;
  const isPip = displayMode === "pip" && isAvailable;

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
  const buttonBg = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.7)";
  const buttonBgHover = isDark
    ? "rgba(255, 255, 255, 0.2)"
    : "rgba(0, 0, 0, 0.9)";
  const buttonColor = "white";

  // Calculate position based on position prop and safe area
  const getPositionStyles = (): React.CSSProperties => {
    const baseOffset = 16;
    const topOffset = safeArea?.insets?.top
      ? `${Math.max(baseOffset, safeArea.insets.top + 8)}px`
      : `${baseOffset}px`;
    const rightOffset = safeArea?.insets?.right
      ? `${Math.max(baseOffset, safeArea.insets.right + 8)}px`
      : `${baseOffset}px`;
    const bottomOffset = safeArea?.insets?.bottom
      ? `${Math.max(baseOffset, safeArea.insets.bottom + 8)}px`
      : `${baseOffset}px`;
    const leftOffset = safeArea?.insets?.left
      ? `${Math.max(baseOffset, safeArea.insets.left + 8)}px`
      : `${baseOffset}px`;

    const styles: React.CSSProperties = {
      position: "absolute",
      zIndex: 1000,
      display: "flex",
      gap: "8px",
      opacity: isHovered ? 1 : 0,
      transition: "opacity 0.2s ease-in-out",
      pointerEvents: isHovered ? "auto" : "none",
    };

    switch (position) {
      case "top-left":
        styles.top = topOffset;
        styles.left = leftOffset;
        break;
      case "top-center":
        styles.top = topOffset;
        styles.left = "50%";
        styles.transform = "translateX(-50%)";
        break;
      case "top-right":
        styles.top = topOffset;
        styles.right = rightOffset;
        // Offset to the left when not in fullscreen/pip to make room for WidgetFullscreenWrapper buttons
        // 32px (maximize) + 8px (gap) + 32px (pip) + 8px (gap to bug button) = 80px
        if (!isFullscreen && !isPip) {
          styles.right = `calc(${rightOffset} + 80px)`;
        }
        break;
      case "center-left":
        styles.top = "50%";
        styles.left = leftOffset;
        styles.transform = "translateY(-50%)";
        break;
      case "center-right":
        styles.top = "50%";
        styles.right = rightOffset;
        styles.transform = "translateY(-50%)";
        break;
      case "bottom-left":
        styles.bottom = bottomOffset;
        styles.left = leftOffset;
        break;
      case "bottom-center":
        styles.bottom = bottomOffset;
        styles.left = "50%";
        styles.transform = "translateX(-50%)";
        break;
      case "bottom-right":
        styles.bottom = bottomOffset;
        styles.right = rightOffset;
        break;
      default:
        styles.top = topOffset;
        styles.right = rightOffset;
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

    const handleClickOutside = (event: MouseEvent) => {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as Node)
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

  const getTooltipStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      position: "absolute",
      padding: "4px 8px",
      backgroundColor: "rgba(0, 0, 0, 0.9)",
      color: "white",
      borderRadius: "4px",
      fontSize: "12px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      transition: "opacity 0.2s ease-in-out",
    };

    switch (position) {
      case "top-right":
        return {
          ...baseStyles,
          top: "100%",
          right: "0",
          marginTop: "8px",
        };
      case "top-left":
        return {
          ...baseStyles,
          top: "100%",
          left: "0",
          marginTop: "8px",
        };
      case "top-center":
        return {
          ...baseStyles,
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: "8px",
        };
      case "bottom-right":
        return {
          ...baseStyles,
          bottom: "100%",
          right: "0",
          marginBottom: "8px",
        };
      case "bottom-left":
        return {
          ...baseStyles,
          bottom: "100%",
          left: "0",
          marginBottom: "8px",
        };
      case "bottom-center":
        return {
          ...baseStyles,
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginBottom: "8px",
        };
      case "center-left":
        return {
          ...baseStyles,
          left: "100%",
          top: "50%",
          transform: "translateY(-50%)",
          marginLeft: "8px",
        };
      case "center-right":
        return {
          ...baseStyles,
          right: "100%",
          top: "50%",
          transform: "translateY(-50%)",
          marginRight: "8px",
        };
      default:
        return {
          ...baseStyles,
          top: "100%",
          right: "0",
          marginTop: "8px",
        };
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
    const tooltipStyles = getTooltipStyles();

    return (
      <button
        style={{
          padding: "8px",
          backgroundColor: buttonBg,
          color: buttonColor,
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "32px",
          height: "32px",
          transition: "background-color 0.2s",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: isDark
            ? "0 2px 8px rgba(0, 0, 0, 0.3)"
            : "0 2px 8px rgba(0, 0, 0, 0.2)",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = buttonBgHover;
          setIsButtonHovered(true);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = buttonBg;
          setIsButtonHovered(false);
        }}
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
          style={{ display: "block" }}
        >
          {icon}
        </svg>
        {showLabels && (
          <span
            style={{
              ...tooltipStyles,
              opacity: isButtonHovered ? 1 : 0,
            }}
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
        className={className}
        style={{
          position: "relative",
          height: "fit-content",
        }}
        onMouseEnter={() => !attachTo && setIsHovered(true)}
        onMouseLeave={() => !attachTo && setIsHovered(false)}
      >
        <div style={getPositionStyles()}>
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
        </div>
        {children}
      </div>

      {isOverlayOpen && (
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
              setIsOverlayOpen(false);
            }
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setIsOverlayOpen(false)}
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
          <div style={{ maxWidth: "1200px", margin: "0 auto", paddingTop: "40px" }}>
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
                    Props
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(props)}
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
                    Output
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(output)}
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
                    {formatValue(metadata)}
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
                    State
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(state)}
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
                    Theme
                  </td>
                  <td style={{ padding: "8px" }}>{theme}</td>
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
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <td
                    style={{
                      padding: "8px",
                      fontWeight: "bold",
                      width: "200px",
                      verticalAlign: "top",
                    }}
                  >
                    Locale
                  </td>
                  <td style={{ padding: "8px" }}>{locale}</td>
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
                    Max Height
                  </td>
                  <td style={{ padding: "8px" }}>{maxHeight}px</td>
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
                    User Agent
                  </td>
                  <td style={{ padding: "8px" }}>
                    {formatUserAgent(userAgent)}
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
                    Safe Area
                  </td>
                  <td style={{ padding: "8px" }}>
                    {formatSafeArea(safeArea)}
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
                    API Available
                  </td>
                  <td style={{ padding: "8px" }}>
                    {isAvailable ? "Yes" : "No"}
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
                    window.openai Keys
                  </td>
                  <td style={{ padding: "8px" }}>
                    {windowOpenAiKeys.length > 0
                      ? windowOpenAiKeys.join(", ")
                      : "N/A"}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Actions Section */}
            <h2
              style={{
                fontSize: "16px",
                fontWeight: "bold",
                marginTop: "32px",
                marginBottom: "16px",
                borderBottom: "1px solid #333",
                paddingBottom: "8px",
              }}
            >
              Actions
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Call Tool */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="Tool name"
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "#1a1a1a",
                    color: "#ffffff",
                    border: "1px solid #333",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    width: "150px",
                  }}
                />
                <input
                  type="text"
                  value={toolArgs}
                  onChange={(e) => setToolArgs(e.target.value)}
                  placeholder='{"key": "value"}'
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "#1a1a1a",
                    color: "#ffffff",
                    border: "1px solid #333",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                />
                <button
                  onClick={handleCallTool}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  Call Tool
                </button>
              </div>

              {/* Send Follow-Up Message */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Follow-up message"
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "#1a1a1a",
                    color: "#ffffff",
                    border: "1px solid #333",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                />
                <button
                  onClick={handleSendFollowUpMessage}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  Send Follow-Up
                </button>
              </div>

              {/* Open External */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="External URL"
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "#1a1a1a",
                    color: "#ffffff",
                    border: "1px solid #333",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                />
                <button
                  onClick={handleOpenExternal}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  Open Link
                </button>
              </div>

              {/* Request Display Mode */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ width: "150px", fontSize: "12px" }}>
                  Display Mode:
                </span>
                <button
                  onClick={() => handleRequestDisplayMode("inline")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                >
                  Inline
                </button>
                <button
                  onClick={() => handleRequestDisplayMode("pip")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                >
                  PiP
                </button>
                <button
                  onClick={() => handleRequestDisplayMode("fullscreen")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    flex: 1,
                  }}
                >
                  Fullscreen
                </button>
              </div>

              {/* Set State */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={handleSetState}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#333",
                    color: "#ffffff",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  Set State (Add Timestamp)
                </button>
              </div>

              {/* Action Result */}
              {actionResult && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px",
                    backgroundColor: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: "4px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: "11px",
                    maxHeight: "200px",
                    overflow: "auto",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "bold",
                      marginBottom: "4px",
                      color: "#aaa",
                    }}
                  >
                    Result:
                  </div>
                  {actionResult}
                  <button
                    onClick={() => setActionResult("")}
                    style={{
                      marginTop: "8px",
                      padding: "4px 8px",
                      backgroundColor: "#333",
                      color: "#ffffff",
                      border: "1px solid #555",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontFamily: "monospace",
                      fontSize: "11px",
                    }}
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

