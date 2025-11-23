import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { JSONDisplay } from "../shared/JSONDisplay";
import { Check, X } from "lucide-react";
import type { CreateMessageResult, ErrorData } from "mcp-use";

interface SamplingResponseDisplayProps {
  result: CreateMessageResult | ErrorData;
  timestamp: number;
}

export function SamplingResponseDisplay({
  result,
  timestamp,
}: SamplingResponseDisplayProps) {
  const isError = "code" in result;

  return (
    <Card
      className={`p-4 border-2 ${
        isError
          ? "border-red-500/20 bg-red-500/5"
          : "border-emerald-500/20 bg-emerald-500/5"
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                isError
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }
            >
              {isError ? (
                <>
                  <X className="h-3 w-3 mr-1" />
                  Sampling Error
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Sampling Response
                </>
              )}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {isError ? (
          <div className="space-y-2">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Error Code: {result.code}
              </div>
              <div className="p-2 bg-muted rounded text-sm text-red-600 dark:text-red-400">
                {result.message}
              </div>
            </div>
            {result.data && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Error Data:
                </div>
                <JSONDisplay data={result.data} filename="error-data.json" />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Response:
              </div>
              <div className="p-2 bg-muted rounded text-sm font-mono whitespace-pre-wrap">
                {result.content.text}
              </div>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Model: {result.model}</span>
              <span>Stop Reason: {result.stopReason}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

