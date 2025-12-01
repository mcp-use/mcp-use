import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_SAMPLING_RESPONSE } from "@/client/types/sampling";

interface SamplingRequestToastProps {
  requestId: string;
  serverName: string;
  onViewDetails: () => void;
  onApprove: (defaultResponse: CreateMessageResult) => void;
  onDeny: () => void;
}

export function SamplingRequestToast({
  requestId: _requestId,
  serverName,
  onViewDetails,
  onApprove,
  onDeny,
}: SamplingRequestToastProps) {
  return (
    <div className="space-y-3">
      <div>
        <strong>Sampling Request Received</strong>
        <p className="text-sm text-muted-foreground mt-1">
          New request from {serverName}
        </p>
      </div>
      <div className="flex gap-2">
        {/* View Details button */}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails();
          }}
        >
          View Details
        </button>
        {/* Approve button */}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onApprove(DEFAULT_SAMPLING_RESPONSE);
          }}
        >
          Approve
        </button>
        {/* Deny button */}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onDeny();
          }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

