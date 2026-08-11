import { Check, Copy, Loader2, LockKeyhole, Wrench, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/client/components/ui/sheet";
import { cn } from "@/client/lib/utils";
import { copyToClipboard } from "@/client/utils/browser";
import { analyzeJSON } from "@/client/utils/jsonUtils";
import { JSONDisplay } from "../shared/JSONDisplay";

interface ToolCallDisplayProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: any;
  state?: "call" | "authorization-required" | "result" | "error";
  partialArgs?: Record<string, unknown>;
  onAuthenticate?: (toolCallId: string) => Promise<void> | void;
  isAuthenticating?: boolean;
  authorizationError?: string | null;
  toolCallId?: string;
}

export function ToolCallDisplay({
  toolName,
  args,
  result,
  state = "result",
  partialArgs,
  onAuthenticate,
  isAuthenticating = false,
  authorizationError,
  toolCallId,
}: ToolCallDisplayProps) {
  const displayArgs = state === "call" && partialArgs ? partialArgs : args;

  const getStatusIcon = () => {
    switch (state) {
      case "call":
        return (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />
        );
      case "authorization-required":
        return (
          <LockKeyhole className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        );
      case "result":
        return (
          <Check className="h-4 w-4 text-emerald-800 dark:text-emerald-400" />
        );
      case "error":
        return <X className="h-4 w-4 text-red-500 dark:text-red-400" />;
      default:
        return (
          <Check className="h-4 w-4 text-emerald-800 dark:text-emerald-400" />
        );
    }
  };

  const getStatusBg = () => {
    switch (state) {
      case "call":
        return " bg-blue-500/20 dark:bg-blue-500/20";
      case "authorization-required":
        return " bg-amber-400/30 dark:bg-amber-500/25";
      case "result":
        return " bg-emerald-500/20 dark:bg-emerald-500/20";
      case "error":
        return " bg-red-500/20 dark:bg-red-500/20";
      default:
        return " bg-emerald-500/20 dark:bg-emerald-500/20";
    }
  };

  const formatContent = (content: any): string => {
    if (typeof content === "object") {
      const jsonInfo = analyzeJSON(content);
      return jsonInfo.preview;
    }
    return String(content);
  };

  return (
    <div className="my-4 flex w-fit max-w-full flex-col items-start gap-2">
      <Sheet>
        <SheetTrigger
          render={
            <div
              className={cn(
                "flex max-w-min items-center gap-3 rounded-full border p-1 transition-colors cursor-pointer",
                state === "authorization-required"
                  ? "border-amber-400/70 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
                  : "bg-card hover:bg-accent/50"
              )}
              data-testid={`chat-tool-call-${toolName}`}
            >
              {/* Tool Icon */}
              <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0">
                <Wrench className="size-4 text-muted-foreground" />
              </div>

              {/* Tool Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {toolName}(
                    {Object.keys(displayArgs).length > 0 ? (
                      <span className="bg-muted-foreground/20 rounded-full px-1.5 mx-1 py-0.5 text-xs">
                        {Object.keys(displayArgs).length} args
                      </span>
                    ) : (
                      ""
                    )}
                    )
                  </span>
                </div>
              </div>

              {/* Status Icon */}
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center",
                  getStatusBg()
                )}
                data-testid={`chat-tool-call-status-${state}`}
              >
                {getStatusIcon()}
              </div>
            </div>
          }
          nativeButton={false}
        />

        <SheetContent
          side="right"
          className="w-[400px] sm:w-[540px] p-4 overflow-y-auto"
          data-testid="chat-tool-drawer"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Tool Call Details
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              {toolName} — {state}
              {state === "call" && (
                <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  streaming…
                </span>
              )}
              {state === "authorization-required" && (
                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <LockKeyhole className="h-3 w-3" />
                  authentication required
                </span>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* Arguments */}
            <div>
              <h3 className="text-sm font-medium mb-2">Arguments</h3>
              <div className="relative" data-testid="chat-tool-drawer-args">
                <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto border font-mono leading-relaxed max-h-48 whitespace-pre-wrap break-words">
                  {formatContent(displayArgs)}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(formatContent(displayArgs))}
                  className="absolute top-2 right-2 h-6 w-6 p-0 opacity-70 hover:opacity-100"
                  title="Copy arguments"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Result */}
            {result && (
              <div>
                <h3 className="text-sm font-medium mb-2">Result</h3>
                <div className="relative" data-testid="chat-tool-drawer-result">
                  {typeof result === "string" ? (
                    <div
                      className={cn(
                        "p-3 rounded-lg border text-sm leading-relaxed max-h-48 overflow-x-auto whitespace-pre-wrap break-words max-w-full",
                        state === "error"
                          ? "bg-destructive/10 border-destructive/20 text-destructive-foreground"
                          : "bg-muted/30 border-border"
                      )}
                    >
                      {result.startsWith("Error") ? (
                        <div className="font-mono">
                          <div className="font-semibold text-destructive mb-1">
                            Error:
                          </div>
                          <div className="whitespace-pre-wrap break-words">
                            {result.replace(/^Error:\s*/, "")}
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap font-mono break-words">
                          {result}
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(result)}
                        className="absolute top-2 right-2 h-6 w-6 p-0 opacity-70 hover:opacity-100"
                        title="Copy result"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "p-3 rounded-lg border text-sm leading-relaxed max-h-96 overflow-y-auto max-w-full",
                        state === "error"
                          ? "bg-destructive/10 border-destructive/20 text-destructive-foreground"
                          : "bg-muted/30 border-border"
                      )}
                    >
                      <JSONDisplay
                        data={result}
                        filename={`tool-call-${toolName}-result-${Date.now()}.json`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          copyToClipboard(JSON.stringify(result, null, 2))
                        }
                        className="absolute top-2 right-2 h-6 w-6 p-0 opacity-70 hover:opacity-100"
                        title="Copy result"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {state === "authorization-required" && toolCallId && onAuthenticate && (
        <div className="flex flex-col items-start gap-1.5 pl-1">
          <Button
            data-testid={`chat-tool-authenticate-${toolCallId}`}
            size="sm"
            onClick={() => void onAuthenticate(toolCallId)}
            disabled={isAuthenticating}
            className="bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-600 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
          >
            {isAuthenticating ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <LockKeyhole className="size-3.5" aria-hidden />
            )}
            {isAuthenticating ? "Authenticating…" : "Authenticate"}
          </Button>
          {authorizationError && (
            <p className="max-w-sm text-xs text-red-700 dark:text-red-300">
              {authorizationError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
