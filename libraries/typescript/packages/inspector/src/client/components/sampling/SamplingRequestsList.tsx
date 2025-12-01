import type { PendingSamplingRequest } from "@/client/types/sampling";
import { ListItem } from "@/client/components/shared/ListItem";
import { NotFound } from "@/client/components/ui/not-found";

interface SamplingRequestsListProps {
  requests: PendingSamplingRequest[];
  selectedRequest: PendingSamplingRequest | null;
  onRequestSelect: (request: PendingSamplingRequest) => void;
  focusedIndex: number;
  formatRelativeTime: (timestamp: number) => string;
  listRef?:
    | React.RefObject<HTMLDivElement>
    | React.MutableRefObject<HTMLDivElement | null>;
}

export function SamplingRequestsList({
  requests,
  selectedRequest,
  onRequestSelect,
  focusedIndex,
  formatRelativeTime,
  listRef,
}: SamplingRequestsListProps) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <NotFound vertical noBorder message="No sampling requests" />
      </div>
    );
  }

  return (
    <div ref={listRef} className="overflow-y-auto flex-1 overscroll-contain">
      {requests.map((request, index) => {
        const messageCount = request.request.params?.messages?.length || 0;
        const maxTokens = request.request.params?.maxTokens;

        return (
          <ListItem
            key={request.id}
            id={`sampling-request-${request.id}`}
            isSelected={selectedRequest?.id === request.id}
            isFocused={focusedIndex === index}
            title={
              <span className="flex items-center gap-3">
                {request.serverName}
                <span className="size-1.5 block rounded-full bg-orange-500" />
              </span>
            }
            description={(() => {
              const timeStr = formatRelativeTime(request.timestamp);
              const details = [];
              if (messageCount > 0) {
                details.push(
                  `${messageCount} message${messageCount > 1 ? "s" : ""}`
                );
              }
              if (maxTokens) {
                details.push(`max ${maxTokens} tokens`);
              }
              const detailsStr =
                details.length > 0 ? ` | ${details.join(", ")}` : "";
              return timeStr + detailsStr;
            })()}
            onClick={() => onRequestSelect(request)}
          />
        );
      })}
    </div>
  );
}
