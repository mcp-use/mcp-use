import { ChatInput } from "./ChatInput.js";
import { MessageList } from "./MessageList.js";
import { useMangoChat } from "../../hooks/useMangoChat.js";

export interface ChatPanelProps {
  workspaceDir?: string;
}

/**
 * Main chat panel component
 */
export function ChatPanel({ workspaceDir }: ChatPanelProps) {
  const { messages, isStreaming, sendMessage } = useMangoChat(workspaceDir);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🥭</span>
          <div>
            <h1 className="text-lg font-bold">Mango</h1>
            <p className="text-xs text-muted-foreground">
              MCP Server Development Agent
            </p>
          </div>
        </div>
      </div>

      <MessageList messages={messages} isStreaming={isStreaming} />

      <ChatInput onSendMessage={sendMessage} disabled={isStreaming} />
    </div>
  );
}
