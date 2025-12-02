interface ElicitationRequestToastProps {
  requestId: string;
  serverName: string;
  mode: "form" | "url";
  message: string;
  url?: string;
  onViewDetails: () => void;
  onOpenUrl?: () => void;
  onCancel: () => void;
}

export function ElicitationRequestToast({
  requestId: _requestId,
  serverName,
  mode,
  message,
  url,
  onViewDetails,
  onOpenUrl,
  onCancel,
}: ElicitationRequestToastProps) {
  return (
    <div className="space-y-3">
      <div>
        <strong>Elicitation Request Received</strong>
        <p className="text-sm text-muted-foreground mt-1">
          From {serverName}: {message}
        </p>
        {mode === "url" && url && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">{url}</p>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
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
        {/* Mode-specific action button */}
        {mode === "url" && onOpenUrl && (
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onOpenUrl();
            }}
          >
            Open URL
          </button>
        )}
        {/* Cancel button */}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
