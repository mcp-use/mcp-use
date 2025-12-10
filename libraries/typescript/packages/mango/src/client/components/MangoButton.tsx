/**
 * MangoButton - Floating action button to open Mango chat
 */

import React from "react";

export interface MangoButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
}

export function MangoButton({
  onClick,
  isLoading = false,
  className = "",
}: MangoButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`
        fixed bottom-6 right-6 z-50
        w-14 h-14 rounded-full
        bg-gradient-to-br from-orange-400 to-orange-600
        hover:from-orange-500 hover:to-orange-700
        active:scale-95
        shadow-lg hover:shadow-xl
        transition-all duration-200
        flex items-center justify-center
        text-2xl
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      aria-label="Open Mango AI Assistant"
      title="Open Mango - AI assistant for MCP servers"
    >
      {isLoading ? (
        <svg
          className="animate-spin h-6 w-6 text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <span role="img" aria-label="mango">
          🥭
        </span>
      )}
    </button>
  );
}
