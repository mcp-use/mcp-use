import { Terminal, FileEdit, FileText, Code } from "lucide-react";
import { MessagePart } from "../../hooks/useChatStream";

interface ToolCallDisplayProps {
  part: MessagePart & { type: "tool_call" };
}

export function ToolCallDisplay({ part }: ToolCallDisplayProps) {
  const getToolIcon = () => {
    const toolName = part.tool.toLowerCase();
    if (toolName.includes("bash") || toolName.includes("shell")) {
      return <Terminal className="w-4 h-4 text-blue-600" />;
    }
    if (toolName.includes("write") || toolName.includes("edit")) {
      return <FileEdit className="w-4 h-4 text-green-600" />;
    }
    if (toolName.includes("read")) {
      return <FileText className="w-4 h-4 text-purple-600" />;
    }
    return <Code className="w-4 h-4 text-gray-600" />;
  };

  const renderToolContent = () => {
    const toolName = part.tool.toLowerCase();
    const input = part.input || {};

    // Skip empty or streaming-only inputs
    if (input._streaming && Object.keys(input).length === 1) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-xs text-gray-500 italic">
            Loading parameters...
          </span>
        </div>
      );
    }

    // Bash/Shell commands
    if (toolName.includes("bash") || toolName === "bash") {
      return (
        <div className="space-y-2">
          {input.description && (
            <p className="text-xs text-gray-500">{input.description}</p>
          )}
          {input.command && (
            <div className="bg-gray-900 rounded-md p-2 font-mono text-xs">
              <div className="flex items-center gap-1.5 mb-1 text-gray-400">
                <span className="text-green-400">❯</span>
                <span>bash</span>
              </div>
              <pre className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                {input.command}
              </pre>
            </div>
          )}
        </div>
      );
    }

    // Write file
    if (toolName.includes("write") || toolName === "write") {
      return (
        <div className="space-y-2">
          {input.description && (
            <p className="text-xs text-gray-500">{input.description}</p>
          )}
          {input.file_path && (
            <div className="flex items-center gap-2 text-gray-700">
              <FileEdit className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs font-mono">{input.file_path}</span>
            </div>
          )}
        </div>
      );
    }

    // Read file
    if (toolName.includes("read") || toolName === "read") {
      return (
        <div className="space-y-2">
          {input.description && (
            <p className="text-xs text-gray-500">{input.description}</p>
          )}
          {input.file_path && (
            <div className="flex items-center gap-2 text-gray-700">
              <FileText className="w-3.5 h-3.5 text-purple-600" />
              <span className="text-xs font-mono">{input.file_path}</span>
            </div>
          )}
        </div>
      );
    }

    // Edit file
    if (toolName.includes("edit") || toolName === "edit") {
      return (
        <div className="space-y-2">
          {input.description && (
            <p className="text-xs text-gray-500">{input.description}</p>
          )}
          {input.file_path && (
            <div className="flex items-center gap-2 text-gray-700">
              <Code className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-xs font-mono">{input.file_path}</span>
            </div>
          )}
          {input._streaming && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs text-gray-500 italic">Editing...</span>
            </div>
          )}
        </div>
      );
    }

    // Generic tool - show clean key-value pairs
    const displayKeys = Object.keys(input).filter((k) => !k.startsWith("_"));
    if (displayKeys.length === 0) {
      return null;
    }

    return (
      <div className="space-y-1.5">
        {displayKeys.slice(0, 3).map((key) => (
          <div key={key} className="flex items-start gap-2 text-xs">
            <span className="font-medium text-gray-600 min-w-[80px]">
              {key}:
            </span>
            <span className="text-gray-500 break-all flex-1">
              {typeof input[key] === "string" && input[key].length > 100
                ? input[key].substring(0, 100) + "..."
                : typeof input[key] === "string"
                  ? input[key]
                  : JSON.stringify(input[key])}
            </span>
          </div>
        ))}
        {displayKeys.length > 3 && (
          <p className="text-xs text-gray-400 italic">
            +{displayKeys.length - 3} more parameters
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-[90%] bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="flex items-start gap-2">
        {getToolIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 mb-2">
            {part.tool}
          </p>
          {renderToolContent()}

          {/* Result */}
          {part.result && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs font-medium text-gray-700 mb-2">
                ✓ Completed
              </p>
              {typeof part.result === "string" && part.result.length < 200 ? (
                <p className="text-xs text-green-700">{part.result}</p>
              ) : (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                    View result
                  </summary>
                  <div className="mt-2 bg-white rounded p-2 max-h-32 overflow-y-auto">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                      {typeof part.result === "string"
                        ? part.result
                        : JSON.stringify(part.result, null, 2)}
                    </pre>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
