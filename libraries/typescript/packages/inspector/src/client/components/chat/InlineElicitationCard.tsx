import type { ElicitResult } from "@modelcontextprotocol/client";
import type { PendingElicitationRequest } from "@/client/types/pending-requests";
import { ElicitationAskUserPanel } from "@/client/components/elicitation/shared/ElicitationAskUserPanel";

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
  return (
    <ElicitationAskUserPanel
      request={request}
      onApprove={onApprove}
      onReject={onReject}
      testId="inline-elicitation"
      actionTestIdPrefix="inline-elicitation"
      compact
      showSecondaryActions
    />
  );
}
