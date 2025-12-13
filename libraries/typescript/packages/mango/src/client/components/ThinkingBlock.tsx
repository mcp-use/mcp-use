/**
 * ThinkingBlock Component
 * Displays agent's extended thinking in a collapsible block
 */
import React, { useState } from "react";

interface ThinkingBlockProps {
  thinking: string;
  signature?: string;
}

export function ThinkingBlock({ thinking, signature }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking) {
    return null;
  }

  // Truncate thinking for collapsed view
  const truncatedThinking =
    thinking.length > 150 ? thinking.slice(0, 150) + "..." : thinking;

  return (
    <div className="border border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50 dark:bg-purple-950/30 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-purple-600 dark:text-purple-400 text-lg">
            🧠
          </span>
          <span className="text-sm font-medium text-purple-900 dark:text-purple-100">
            Thinking
          </span>
          {signature && (
            <span className="text-xs text-purple-600 dark:text-purple-400 font-mono">
              {signature}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-purple-600 dark:text-purple-400 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isExpanded ? (
        <div className="px-4 py-3 border-t border-purple-200 dark:border-purple-800">
          <pre className="text-xs text-purple-900 dark:text-purple-100 whitespace-pre-wrap font-mono">
            {thinking}
          </pre>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <p className="text-xs text-purple-700 dark:text-purple-300">
            {truncatedThinking}
          </p>
        </div>
      )}
    </div>
  );
}
