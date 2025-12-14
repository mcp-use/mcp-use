import { useState } from "react";
import { motion } from "framer-motion";
import {
  Code,
  Database,
  FileText,
  Wrench,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface MCPPrimitiveCardProps {
  type: "tool" | "resource" | "prompt";
  data: any;
  position: { x: number; y: number };
  callTool?: (name: string, args: any) => Promise<any>;
  readResource?: (uri: string) => Promise<any>;
}

export function MCPPrimitiveCard({
  type,
  data,
  position,
  callTool,
  readResource,
}: MCPPrimitiveCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const getIcon = () => {
    switch (type) {
      case "tool":
        return <Wrench className="w-5 h-5 text-blue-600" />;
      case "resource":
        return <Database className="w-5 h-5 text-green-600" />;
      case "prompt":
        return <FileText className="w-5 h-5 text-purple-600" />;
    }
  };

  const getTitle = () => {
    switch (type) {
      case "tool":
        return data.name || "Unnamed Tool";
      case "resource":
        return data.name || data.uri || "Unnamed Resource";
      case "prompt":
        return data.name || "Unnamed Prompt";
    }
  };

  const getDescription = () => {
    return data.description || "No description available";
  };

  const handleExecute = async () => {
    if (type !== "tool" || !callTool) return;

    setIsExecuting(true);
    try {
      const resultData = await callTool(data.name, {});
      setResult(resultData);
      setIsExpanded(true);
    } catch (error) {
      console.error("Error executing tool:", error);
      setResult({ error: "Failed to execute tool" });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReadResource = async () => {
    if (type !== "resource" || !readResource) return;

    setIsExecuting(true);
    try {
      const resultData = await readResource(data.uri);
      setResult(resultData);
      setIsExpanded(true);
    } catch (error) {
      console.error("Error reading resource:", error);
      setResult({ error: "Failed to read resource" });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="absolute"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: "400px",
      }}
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">{getIcon()}</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {getTitle()}
              </h3>
              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                {getDescription()}
              </p>
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Details */}
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="p-4 bg-gray-50"
          >
            {/* Tool details */}
            {type === "tool" && (
              <div className="space-y-3">
                {data.inputSchema?.properties && (
                  <div>
                    <p className="text-xs font-medium text-gray-700 mb-2">
                      Parameters:
                    </p>
                    <div className="space-y-1">
                      {Object.keys(data.inputSchema.properties).map((key) => (
                        <div
                          key={key}
                          className="text-xs text-gray-600 flex items-center gap-2"
                        >
                          <Code className="w-3 h-3" />
                          <span className="font-mono">{key}</span>
                          <span className="text-gray-400">
                            ({data.inputSchema.properties[key].type})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExecuting ? "Executing..." : "Execute Tool"}
                </button>
              </div>
            )}

            {/* Resource details */}
            {type === "resource" && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1">URI:</p>
                  <p className="text-xs text-gray-600 font-mono break-all">
                    {data.uri}
                  </p>
                </div>
                {data.mimeType && (
                  <div>
                    <p className="text-xs font-medium text-gray-700 mb-1">
                      MIME Type:
                    </p>
                    <p className="text-xs text-gray-600 font-mono">
                      {data.mimeType}
                    </p>
                  </div>
                )}
                <button
                  onClick={handleReadResource}
                  disabled={isExecuting}
                  className="w-full px-3 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExecuting ? "Reading..." : "Read Resource"}
                </button>
              </div>
            )}

            {/* Prompt details */}
            {type === "prompt" && (
              <div className="space-y-3">
                {data.arguments && data.arguments.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-700 mb-2">
                      Arguments:
                    </p>
                    <div className="space-y-1">
                      {data.arguments.map((arg: any, index: number) => (
                        <div
                          key={index}
                          className="text-xs text-gray-600 flex items-center gap-2"
                        >
                          <Code className="w-3 h-3" />
                          <span className="font-mono">{arg.name}</span>
                          {arg.required && (
                            <span className="text-red-500 text-[10px]">
                              required
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs font-medium text-gray-700 mb-2">
                  Result:
                </p>
                <div className="bg-white rounded-lg p-3 max-h-48 overflow-y-auto">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
