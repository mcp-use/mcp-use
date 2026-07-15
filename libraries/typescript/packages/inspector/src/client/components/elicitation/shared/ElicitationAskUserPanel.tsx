import { useMemo, useState } from "react";
import type { ElicitResult } from "@modelcontextprotocol/client";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { PendingElicitationRequest } from "@/client/types/pending-requests";
import {
  AskUserQuestions,
  type AskUserAnswer,
} from "@/client/components/ui/ask-user-questions";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import {
  answersToFormData,
  elicitationToAskUserQuestions,
  getMissingRequiredFromAnswers,
  schemaToDefaultAnswers,
} from "./elicitationToAskUserQuestions";

interface ElicitationAskUserPanelProps {
  request: PendingElicitationRequest;
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
  /** Root `data-testid` for e2e hooks. */
  testId?: string;
  /** Show decline/cancel actions below the question flow. */
  showSecondaryActions?: boolean;
  /** Prefix for secondary action test ids (panel vs inline). */
  actionTestIdPrefix?: string;
  compact?: boolean;
}

export function ElicitationAskUserPanel({
  request,
  onApprove,
  onReject,
  testId = "elicitation-ask-user",
  showSecondaryActions = true,
  actionTestIdPrefix = "elicitation",
  compact = false,
}: ElicitationAskUserPanelProps) {
  const [responded, setResponded] = useState(false);
  const [responseLabel, setResponseLabel] = useState("");

  const questions = useMemo(
    () => elicitationToAskUserQuestions(request.request),
    [request.request]
  );

  const defaultAnswers = useMemo(
    () => schemaToDefaultAnswers(questions, request.request),
    [questions, request.request]
  );

  const mode = request.request.mode || "form";
  const isUrlMode = mode === "url";
  const url =
    isUrlMode && "url" in request.request ? request.request.url : undefined;

  const finish = (label: string, result: ElicitResult) => {
    setResponded(true);
    setResponseLabel(label);
    onApprove(request.id, result);
  };

  const handleComplete = (answers: Record<string, AskUserAnswer>) => {
    if (responded) return;

    if (isUrlMode) {
      const confirmed = answers.__url_confirm__?.selectedIds.includes("confirmed");
      if (!confirmed) {
        toast.error("Confirm you've completed the external action");
        return;
      }
      finish("accepted", { action: "accept" });
      return;
    }

    const missing = getMissingRequiredFromAnswers(
      questions,
      answers,
      request.request
    );
    if (missing.length > 0) {
      toast.error("Missing required fields", {
        description: `Please fill in: ${missing.join(", ")}`,
      });
      return;
    }

    finish("accepted", {
      action: "accept",
      content: answersToFormData(
        questions,
        answers,
        request.request
      ) as ElicitResult["content"],
    });
  };

  if (responded) {
    return (
      <div
        className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground max-w-2xl"
        data-testid={`${testId}-responded`}
      >
        Elicitation {responseLabel} — the tool will continue executing.
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "rounded-lg border bg-card shadow-sm p-4 space-y-4 max-w-2xl"
          : "space-y-4"
      }
      data-testid={testId}
    >
      {compact && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-card-foreground">
            Elicitation Request
          </span>
          <Badge
            variant="outline"
            className={
              isUrlMode
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                : "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
            }
          >
            {mode}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {request.serverName}
          </span>
        </div>
      )}

      {isUrlMode && url && (
        <div className="flex items-center gap-2 p-2 bg-muted rounded border">
          <code className="flex-1 text-xs font-mono break-all">{url}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(url, "_blank")}
            data-testid={`${actionTestIdPrefix}-open-url`}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open
          </Button>
        </div>
      )}

      {!isUrlMode && !compact && (
        <p className="text-sm text-muted-foreground">{request.request.message}</p>
      )}

      {compact && !isUrlMode && (
        <p className="text-sm text-card-foreground">{request.request.message}</p>
      )}

      <AskUserQuestions
        questions={questions}
        defaultAnswers={defaultAnswers}
        onComplete={handleComplete}
        data-testid={`${testId}-questions`}
      />

      {showSecondaryActions && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => finish("declined", { action: "decline" })}
            data-testid={`${actionTestIdPrefix}-decline-button`}
          >
            Decline
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResponded(true);
              setResponseLabel("cancelled");
              onReject(request.id, "User cancelled elicitation request");
            }}
            data-testid={`${actionTestIdPrefix}-cancel-button`}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
