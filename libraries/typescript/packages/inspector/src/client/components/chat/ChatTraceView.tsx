import { JSONDisplay } from "../shared/JSONDisplay";
import type {
  InspectorTokenUsage,
  InspectorTraceEvent,
} from "./trace";
import { buildRawChatPayload } from "./trace";

export type ChatView = "conv" | "raw";

export function ChatRawView({
  events,
  usage,
}: {
  events: InspectorTraceEvent[];
  usage?: InspectorTokenUsage;
}) {
  if (events.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Raw request/response data will appear after the next message.
      </p>
    );
  }

  const payload = buildRawChatPayload(events, usage);

  return (
    <div className="mx-auto max-w-4xl" data-testid="chat-raw-view">
      <JSONDisplay
        data={payload}
        filename="chat-raw.json"
        collapsible
        defaultExpanded={false}
      />
    </div>
  );
}
