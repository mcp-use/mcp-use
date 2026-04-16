// libraries/typescript/packages/inspector/src/client/components/chat/InlineElicitationCard.tsx
import { useState } from "react";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Badge } from "@/client/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  ElicitationFormFields,
  useElicitationForm,
} from "@/client/components/elicitation/shared";

interface InlineElicitationCardProps {
  request: PendingElicitationRequest;
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
}

export function InlineElicitationCard({
  request,
  onApprove,
  onReject,
}: InlineElicitationCardProps) {
  const {
    formData,
    setFieldValue,
    getMissingRequiredFields,
    urlCompleted,
    setUrlCompleted,
    mode,
    isFormMode,
    isUrlMode,
  } = useElicitationForm(request);

  const [responded, setResponded] = useState(false);
  const [responseLabel, setResponseLabel] = useState<string>("");

  const handleAccept = () => {
    if (responded) return;
    if (isFormMode) {
      const missing = getMissingRequiredFields();
      if (missing.length > 0) {
        toast.error("Missing required fields", {
          description: `Please fill in: ${missing.join(", ")}`,
        });
        return;
      }
      setResponded(true);
      setResponseLabel("accepted");
      onApprove(request.id, { action: "accept", content: formData });
    } else if (isUrlMode) {
      setResponded(true);
      setResponseLabel("accepted");
      onApprove(request.id, { action: "accept" });
    }
  };

  const handleDecline = () => {
    if (responded) return;
    setResponded(true);
    setResponseLabel("declined");
    onApprove(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    if (responded) return;
    setResponded(true);
    setResponseLabel("cancelled");
    onReject(request.id, "User cancelled elicitation request");
  };

  const urlModeUrl =
    isUrlMode && "url" in request.request
      ? (request.request as { url: string }).url
      : null;

  // Collapsed summary after responding
  if (responded) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground max-w-2xl">
        Elicitation {responseLabel} — the tool will continue executing.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm p-4 space-y-4 max-w-2xl">
      {/* Header */}
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

      {/* Server message */}
      <p className="text-sm text-card-foreground">{request.request.message}</p>

      {/* URL mode */}
      {isUrlMode && "url" in request.request && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-muted rounded border">
            <code className="flex-1 text-xs font-mono break-all">
              {urlModeUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                window.open(urlModeUrl ?? "", "_blank");
                setUrlCompleted(true);
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`inline-url-done-${request.id}`}
              checked={urlCompleted}
              onCheckedChange={(c) => setUrlCompleted(!!c)}
            />
            <Label
              htmlFor={`inline-url-done-${request.id}`}
              className="text-sm font-normal cursor-pointer"
            >
              I have completed the required action
            </Label>
          </div>
        </div>
      )}

      {/* Form mode */}
      {isFormMode && (
        <ElicitationFormFields
          request={request}
          formData={formData}
          onFieldChange={setFieldValue}
          idPrefix={`inline-field-${request.id}`}
          testIdPrefix="inline-elicitation-field"
          fieldContainerClassName="space-y-1.5"
          textareaRows={3}
          showOuterLabelForBoolean={false}
          emptyFallback={
            <p className="text-sm text-muted-foreground">
              No form schema provided.
            </p>
          }
        />
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleAccept}
          disabled={isUrlMode && !urlCompleted}
          data-testid="inline-elicitation-accept"
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDecline}
          data-testid="inline-elicitation-decline"
        >
          Decline
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCancel}
          data-testid="inline-elicitation-cancel"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
