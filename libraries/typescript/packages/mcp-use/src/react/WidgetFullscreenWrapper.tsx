/**
 * Wrapper component that automatically adds a close button when widget is in fullscreen mode.
 * This ensures users can exit fullscreen without needing to add their own close button,
 * which would conflict with ChatGPT's own controls when deployed.
 */

import React from "react";
import { useWidget } from "./useWidget.js";

interface WidgetFullscreenWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wrapper component that adds a close button when in fullscreen mode.
 * 
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   return (
 *     <WidgetFullscreenWrapper>
 *       <div>My widget content</div>
 *     </WidgetFullscreenWrapper>
 *   );
 * };
 * ```
 */
export function WidgetFullscreenWrapper({
  children,
  className = "",
}: WidgetFullscreenWrapperProps) {
  const { displayMode, requestDisplayMode, theme, safeArea, isAvailable } =
    useWidget();
  const isFullscreen = displayMode === "fullscreen" && isAvailable;

  const handleClose = async () => {
    try {
      await requestDisplayMode("inline");
    } catch (error) {
      console.error("Failed to exit fullscreen:", error);
    }
  };

  // Theme-aware styling
  const isDark = theme === "dark";
  const buttonBg = isDark
    ? "rgba(255, 255, 255, 0.1)"
    : "rgba(0, 0, 0, 0.7)";
  const buttonBgHover = isDark
    ? "rgba(255, 255, 255, 0.2)"
    : "rgba(0, 0, 0, 0.9)";
  const buttonColor = isDark ? "white" : "white";
  const topOffset = safeArea?.insets?.top
    ? `${Math.max(16, safeArea.insets.top + 8)}px`
    : "16px";
  const rightOffset = safeArea?.insets?.right
    ? `${Math.max(16, safeArea.insets.right + 8)}px`
    : "16px";

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {isFullscreen && (
        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            top: topOffset,
            right: rightOffset,
            zIndex: 1000,
            padding: "8px 12px",
            backgroundColor: buttonBg,
            color: buttonColor,
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "background-color 0.2s, opacity 0.2s",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: isDark
              ? "0 2px 8px rgba(0, 0, 0, 0.3)"
              : "0 2px 8px rgba(0, 0, 0, 0.2)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = buttonBgHover;
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = buttonBg;
            e.currentTarget.style.opacity = "1";
          }}
          aria-label="Exit fullscreen"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Close
        </button>
      )}
      {children}
    </div>
  );
}
