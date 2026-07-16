import type { ElicitResult } from "@modelcontextprotocol/client";
import { motion } from "motion/react";
import type { PendingElicitationRequest } from "@/client/types/pending-requests";
import { spring } from "@/client/lib/springs";
import { ElicitationAskUserPanel } from "@/client/components/elicitation/shared/ElicitationAskUserPanel";

interface FloatingChatElicitationProps {
  requests: PendingElicitationRequest[];
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
}

export function FloatingChatElicitation({
  requests,
  onApprove,
  onReject,
}: FloatingChatElicitationProps) {
  if (requests.length === 0) return null;

  return (
    <div
      className="mb-3 space-y-3 pointer-events-auto"
      data-testid="floating-elicitation-stack"
    >
      {requests.map((request) => (
        <motion.div
          key={request.id}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={spring.moderate}
        >
          <ElicitationAskUserPanel
            request={request}
            onApprove={onApprove}
            onReject={onReject}
          />
        </motion.div>
      ))}
    </div>
  );
}
