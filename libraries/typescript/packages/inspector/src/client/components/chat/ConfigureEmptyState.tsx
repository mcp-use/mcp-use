import { AlertCircle, Key, Settings } from "lucide-react";

import { Button } from "@/client/components/ui/button";

interface ConfigureEmptyStateProps {
  onConfigureClick: () => void;
  /**
   * True when the hosted inspector's managed key cannot be used because the
   * selected MCP server is on localhost. The managed key streams chat through
   * our backend, which runs server-side and cannot reach a server on the
   * user's machine — so we ask them to bring their own key and explain why.
   * Never set on the local inspector, where BYOK is the normal flow anyway.
   */
  managedKeyUnavailable?: boolean;
}

export function ConfigureEmptyState({
  onConfigureClick,
  managedKeyUnavailable = false,
}: ConfigureEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      {managedKeyUnavailable && (
        <div
          role="status"
          data-testid="chat-localhost-managed-key-notice"
          className="mb-6 w-full max-w-md flex items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-left text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            You're connected to a <strong>localhost</strong> MCP server. The
            hosted inspector's managed key runs on our servers and can't reach
            MCP servers on your machine, so chat falls back to using your own
            API key. Add a key below to chat with this server.
          </span>
        </div>
      )}
      <Key className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">
        Configure Your LLM Provider
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        To start chatting with the MCP server, you need to configure your LLM
        provider and API key. Your credentials are stored locally and used only
        for this chat.
      </p>
      <Button
        onClick={onConfigureClick}
        data-testid="chat-configure-api-key-button"
      >
        <Settings className="h-4 w-4 mr-2" />
        Configure API Key
      </Button>
    </div>
  );
}
