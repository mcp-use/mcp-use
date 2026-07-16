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
  testId?: string;
  actionTestIdPrefix?: string;
}

export function ElicitationAskUserPanel({
  request,
  onApprove,
  onReject,
  testId = "inline-elicitation",
  actionTestIdPrefix = "inline-elicitation",
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
      const confirmed =
        answers.__url_confirm__?.selectedIds.includes("confirmed");
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
      <p
        className="text-sm text-muted-foreground"
        data-testid={`${testId}-responded`}
      >
        Elicitation {responseLabel} — the tool will continue executing.
      </p>
    );
  }

  const intro = (
    <div className="space-y-2">
      <p className="text-foreground/90">{request.request.message}</p>
      {isUrlMode && url && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
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
    </div>
  );

  return (
    <AskUserQuestions
      questions={questions}
      defaultAnswers={defaultAnswers}
      onComplete={handleComplete}
      intro={intro}
      onCancel={() =>
        onReject(request.id, "User cancelled elicitation request")
      }
      cancelLabel="Cancel"
      footerLeading={
        <button
          type="button"
          className="shrink-0 cursor-pointer text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => finish("declined", { action: "decline" })}
          data-testid={`${actionTestIdPrefix}-decline-button`}
        >
          Decline
        </button>
      }
      className="w-full max-w-none shadow-lg"
      data-testid={testId}
    />
  );
}
