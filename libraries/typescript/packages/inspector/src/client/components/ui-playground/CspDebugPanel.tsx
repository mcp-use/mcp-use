/**
 * CSP Debug Panel
 *
 * Displays CSP violations and provides suggested fixes.
 * Reuses the same pattern as JsonRpcLoggerView for consistency.
 */

import { AlertTriangle, Copy, Shield } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useWidgetDebug } from "../../context/WidgetDebugContext";
import { JSONDisplay } from "../shared/JSONDisplay";
import { Button } from "../ui/button";

interface CspDebugPanelProps {
  widgetId: string;
}

export function CspDebugPanel({ widgetId }: CspDebugPanelProps) {
  const { widgets } = useWidgetDebug();
  const widget = widgets.get(widgetId);

  const violations = widget?.cspViolations || [];

  // Generate suggested CSP fix
  const suggestedFix = useMemo(() => {
    if (violations.length === 0) return null;

    const connectDomains = new Set<string>();
    const resourceDomains = new Set<string>();

    violations.forEach((v) => {
      try {
        const url = new URL(v.blockedUri);
        const origin = url.origin;

        if (
          v.directive === "connect-src" ||
          v.effectiveDirective === "connect-src"
        ) {
          connectDomains.add(origin);
        } else if (
          [
            "script-src",
            "style-src",
            "img-src",
            "font-src",
            "media-src",
          ].includes(v.directive || v.effectiveDirective)
        ) {
          resourceDomains.add(origin);
        }
      } catch {
        // Invalid URL, skip
      }
    });

    const fix: any = {};
    if (connectDomains.size > 0) {
      fix.connectDomains = Array.from(connectDomains);
    }
    if (resourceDomains.size > 0) {
      fix.resourceDomains = Array.from(resourceDomains);
    }

    return Object.keys(fix).length > 0 ? fix : null;
  }, [violations]);

  const copySuggestedFix = async () => {
    if (!suggestedFix) return;

    try {
      const jsonString = JSON.stringify(
        {
          type: "mcpApps",
          metadata: {
            csp: suggestedFix,
          },
        },
        null,
        2
      );
      await navigator.clipboard.writeText(jsonString);
      toast.success("Suggested fix copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  if (!widget) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Widget not found
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <h3 className="text-sm font-medium">CSP Violations</h3>
            {violations.length > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                {violations.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Suggested Fix */}
        {suggestedFix && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Suggested Fix
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={copySuggestedFix}
                className="h-6 px-2"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
              Add this to your widget's metadata to fix CSP violations:
            </p>
            <JSONDisplay data={{ csp: suggestedFix }} />
          </div>
        )}

        {/* Violations List */}
        {violations.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="w-12 h-12 mx-auto mb-3 text-green-500 dark:text-green-400" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No CSP Violations
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              All resources are properly whitelisted
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Blocked Requests</h4>
            {violations.map((violation, idx) => (
              <div
                key={idx}
                className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-yellow-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded">
                        {violation.directive || violation.effectiveDirective}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(violation.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm font-medium break-all">
                      {violation.blockedUri}
                    </div>
                    {violation.sourceFile && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {violation.sourceFile}
                        {violation.lineNumber && `:${violation.lineNumber}`}
                        {violation.columnNumber && `:${violation.columnNumber}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Current CSP Info */}
        {widget.protocol === "mcp-apps" && (
          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mt-4">
            <h4 className="text-sm font-medium mb-2">Current Configuration</h4>
            <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-xs">
              <div className="space-y-1">
                <div>
                  <span className="font-medium">Protocol:</span> MCP Apps
                  (SEP-1865)
                </div>
                <div>
                  <span className="font-medium">CSP Mode:</span>{" "}
                  {widget.hostContext?.cspMode || "permissive"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
