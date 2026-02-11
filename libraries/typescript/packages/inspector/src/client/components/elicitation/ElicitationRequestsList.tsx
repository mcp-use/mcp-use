import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { ListItem } from "@/client/components/shared/ListItem";
import { NotFound } from "@/client/components/ui/not-found";
import { Badge } from "@/client/components/ui/badge";

interface ElicitationRequestsListProps {
  requests: PendingElicitationRequest[];
  selectedRequest: PendingElicitationRequest | null;
  onRequestSelect: (request: PendingElicitationRequest) => void;
  focusedIndex: number;
  formatRelativeTime: (timestamp: number) => string;
  listRef?:
    | React.RefObject<HTMLDivElement>
    | React.MutableRefObject<HTMLDivElement | null>;
}

export function ElicitationRequestsList({
  requests,
  selectedRequest,
  onRequestSelect,
  focusedIndex,
  formatRelativeTime,
  listRef,
}: ElicitationRequestsListProps) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <NotFound vertical noBorder message="No elicitation requests" />
      </div>
    );
  }

  return (
    <div ref={listRef} className="overflow-y-auto flex-1 overscroll-contain">
      {requests.map((request, index) => {
        const mode = request.request.mode || "form";
        const hasSchema =
          mode === "form" &&
          "requestedSchema" in request.request &&
          request.request.requestedSchema;

        return (
          <ListItem
            key={request.id}
            id={`elicitation-request-${request.id}`}
            data-testid={`elicitation-request-item-${index}`}
            isSelected={selectedRequest?.id === request.id}
            isFocused={focusedIndex === index}
            title={
              <span className="flex items-center gap-3">
                {request.serverName}
                <Badge
                  variant="outline"
                  className={
                    mode === "url"
                      ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50"
                      : "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/50"
                  }
                >
                  {mode}
                </Badge>
              </span>
            }
            description={(() => {
              const timeStr = formatRelativeTime(request.timestamp);
              const details = [];
              if (hasSchema) {
                details.push("with schema");
              }
              if (mode === "url") {
                details.push("external action");
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
