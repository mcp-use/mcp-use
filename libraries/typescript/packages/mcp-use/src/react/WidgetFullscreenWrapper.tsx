/**
 * Wrapper component that automatically adds a close button when widget is in fullscreen mode.
 * This ensures users can exit fullscreen without needing to add their own close button,
 * which would conflict with ChatGPT's own controls when deployed.
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

interface WidgetFullscreenWrapperProps {
  children: React.ReactNode;
  className?: string;
  position?: Position;
  attachTo?: HTMLElement | null;
  showLabels?: boolean;
}

/**
 * Wrapper component that adds icon buttons for fullscreen and pip modes.
 * Icons are only visible on hover with smooth opacity transitions.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   return (
 *     <WidgetFullscreenWrapper position="top-right" showLabels>
 *       <div>My widget content</div>
 *     </WidgetFullscreenWrapper>
 *   );
 * };
 * ```
 */
export function WidgetFullscreenWrapper({
  children,
  className = "",
  position = "top-right",
  attachTo,
  showLabels = true,
}: WidgetFullscreenWrapperProps) {
  const { displayMode, requestDisplayMode, theme, safeArea, isAvailable } =
    useWidget();
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFullscreen = displayMode === "fullscreen" && isAvailable;
  const isPip = displayMode === "pip" && isAvailable;

  // Theme-aware styling
  const isDark = theme === "dark";
  const buttonBg = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.7)";
  const buttonBgHover = isDark
    ? "rgba(255, 255, 255, 0.2)"
    : "rgba(0, 0, 0, 0.9)";
  const buttonColor = isDark ? "white" : "white";

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

  // Calculate tooltip position based on button position
  // Tooltip should be diagonally opposite to button position
  const getTooltipStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      position: "absolute",
      padding: "4px 8px",
      backgroundColor: isDark ? "rgba(0, 0, 0, 0.9)" : "rgba(0, 0, 0, 0.9)",
      color: "white",
      borderRadius: "4px",
      fontSize: "12px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      transition: "opacity 0.2s ease-in-out",
    };

    switch (position) {
      case "top-right":
        // Tooltip at bottom-left
        return {
          ...baseStyles,
          top: "100%",
          left: "0",
          marginTop: "8px",
        };
      case "top-left":
        // Tooltip at bottom-right
        return {
          ...baseStyles,
          top: "100%",
          right: "0",
          marginTop: "8px",
        };
      case "top-center":
        // Tooltip at bottom-center
        return {
          ...baseStyles,
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: "8px",
        };
      case "bottom-right":
        // Tooltip at top-left
        return {
          ...baseStyles,
          bottom: "100%",
          left: "0",
          marginBottom: "8px",
        };
      case "bottom-left":
        // Tooltip at top-right
        return {
          ...baseStyles,
          bottom: "100%",
          right: "0",
          marginBottom: "8px",
        };
      case "bottom-center":
        // Tooltip at top-center
        return {
          ...baseStyles,
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginBottom: "8px",
        };
      case "center-left":
        // Tooltip at center-right
        return {
          ...baseStyles,
          left: "100%",
          top: "50%",
          transform: "translateY(-50%)",
          marginLeft: "8px",
        };
      case "center-right":
        // Tooltip at center-left
        return {
          ...baseStyles,
          right: "100%",
          top: "50%",
          transform: "translateY(-50%)",
          marginRight: "8px",
        };
      default:
        // Default fallback
        return {
          ...baseStyles,
          top: "100%",
          left: "0",
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

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        // width: "fit-content",
        height: "fit-content",
      }}
      onMouseEnter={() => !attachTo && setIsHovered(true)}
      onMouseLeave={() => !attachTo && setIsHovered(false)}
    >
      {!isFullscreen && !isPip && (
        <div style={getPositionStyles()}>
          <IconButton onClick={handleFullscreen} label="Fullscreen">
            <path d="M15 3h6v6" />
            <path d="m21 3-7 7" />
            <path d="m3 21 7-7" />
            <path d="M9 21H3v-6" />
          </IconButton>
          <IconButton onClick={handlePip} label="Picture in Picture">
            <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
            <rect width="10" height="7" x="12" y="13" rx="2" />
          </IconButton>
        </div>
      )}
      {children}
    </div>
  );
}
