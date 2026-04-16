import { McpUseProvider, useWidget } from "mcp-use/react";
import React from "react";

export interface CodePreviewProps {
  language?: string;
  description?: string;
  code?: string;
}

/**
 * Streaming + structured props: useWidget for partialToolInput / isStreaming; optional props from inline JSX spread.
 */
const CodePreview: React.FC<CodePreviewProps> = ({
  language: langIn,
  description: descIn,
  code: codeIn,
}) => {
  const { props, isPending, isStreaming, partialToolInput, theme } =
    useWidget<CodePreviewProps>();

  const isDark = theme === "dark";

  const displayLanguage =
    props.language ??
    langIn ??
    (partialToolInput as Partial<CodePreviewProps> | null)?.language ??
    "";
  const displayDescription =
    props.description ??
    descIn ??
    (partialToolInput as Partial<CodePreviewProps> | null)?.description ??
    "";
  const displayCode =
    props.code ??
    codeIn ??
    (partialToolInput as Partial<CodePreviewProps> | null)?.code ??
    "";

  if (isPending && !isStreaming) {
    return (
      <McpUseProvider autoSize>
        <div
          className={`rounded-xl p-6 ${
            isDark
              ? "bg-gray-900 border border-gray-700"
              : "bg-gray-50 border border-gray-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`animate-spin rounded-full h-5 w-5 border-2 border-t-transparent ${
                isDark ? "border-blue-400" : "border-blue-600"
              }`}
            />
            <span className={isDark ? "text-gray-400" : "text-gray-500"}>
              Waiting for code generation...
            </span>
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div
        className={`rounded-xl overflow-hidden ${
          isDark
            ? "bg-gray-900 border border-gray-700"
            : "bg-white border border-gray-200"
        }`}
      >
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            isDark
              ? "bg-gray-800 border-gray-700"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {displayLanguage && (
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded ${
                  isDark
                    ? "bg-blue-900/50 text-blue-300"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {displayLanguage}
              </span>
            )}
            {displayDescription && (
              <span
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {displayDescription}
              </span>
            )}
          </div>

          {isStreaming && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    isDark ? "bg-green-400" : "bg-green-500"
                  }`}
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    isDark ? "bg-green-400" : "bg-green-500"
                  }`}
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    isDark ? "bg-green-400" : "bg-green-500"
                  }`}
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              <span
                className={`text-xs ${isDark ? "text-green-400" : "text-green-600"}`}
              >
                streaming...
              </span>
            </div>
          )}

          {!isStreaming && !isPending && (
            <span
              className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              complete
            </span>
          )}
        </div>

        <div className="relative">
          <pre
            className={`p-4 text-sm font-mono overflow-x-auto ${
              isDark ? "text-gray-300" : "text-gray-800"
            }`}
            style={{
              minHeight: "80px",
              maxHeight: "400px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <code>
              {displayCode || (
                <span className={isDark ? "text-gray-600" : "text-gray-400"}>
                  // Code will appear here as it streams in...
                </span>
              )}
            </code>
            {isStreaming && (
              <span
                className={`inline-block w-2 h-4 ml-0.5 animate-pulse ${
                  isDark ? "bg-green-400" : "bg-green-500"
                }`}
                style={{ verticalAlign: "text-bottom" }}
              />
            )}
          </pre>
        </div>

        <div
          className={`px-4 py-2 border-t text-xs ${
            isDark
              ? "bg-gray-800/50 border-gray-700 text-gray-500"
              : "bg-gray-50/50 border-gray-200 text-gray-400"
          }`}
        >
          <span>
            isStreaming: {String(isStreaming)} | isPending: {String(isPending)}{" "}
            | partialToolInput: {partialToolInput ? "present" : "null"} | code
            length: {displayCode.length}
          </span>
        </div>
      </div>
    </McpUseProvider>
  );
};

export default CodePreview;
