import { useWidgetDebug } from "@/client/context/WidgetDebugContext";
import { cn } from "@/client/lib/utils";
import { Switch } from "./switch";

interface ProtocolToggleProps {
  className?: string;
}

/**
 * Protocol toggle for tools that support both MCP Apps and ChatGPT Apps SDK.
 * Shows OpenAI and MCP logos with a switch to toggle between protocols.
 */
export function ProtocolToggle({ className }: ProtocolToggleProps) {
  const { playground, updatePlaygroundSettings } = useWidgetDebug();

  const isMcpAppsSelected = playground.selectedProtocol === "mcp-apps";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 border rounded-lg bg-muted/30",
        className
      )}
    >
      <p className="text-xs text-muted-foreground">
        This tool supports both ChatGPT Apps and MCP Apps (ext-apps). Toggle
        between protocols:
      </p>

      <div className="flex items-center justify-center gap-3">
        {/* OpenAI Logo */}
        <div
          className={cn(
            "transition-opacity flex items-center",
            isMcpAppsSelected ? "opacity-40" : "opacity-100"
          )}
          title="ChatGPT Apps SDK"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="OpenAI logo"
          >
            <path d="M22.2 9.2c-.4-2.4-2.2-4.4-4.6-5-2.4-.6-4.8.2-6.6 2-1.8-1.8-4.2-2.6-6.6-2-2.4.6-4.2 2.6-4.6 5-.4 2.4.4 4.8 2.2 6.6-1.8 1.8-2.6 4.2-2.2 6.6.4 2.4 2.2 4.4 4.6 5 2.4.6 4.8-.2 6.6-2 1.8 1.8 4.2 2.6 6.6 2 2.4-.6 4.2-2.6 4.6-5 .4-2.4-.4-4.8-2.2-6.6 1.8-1.8 2.6-4.2 2.2-6.6z" />
          </svg>
        </div>

        {/* Toggle Switch */}
        <Switch
          checked={isMcpAppsSelected}
          onCheckedChange={(checked) => {
            updatePlaygroundSettings({
              selectedProtocol: checked ? "mcp-apps" : "chatgpt-app",
            });
          }}
          aria-label="Toggle between ChatGPT Apps and MCP Apps"
        />

        {/* MCP Logo - Using a simple rectangle as placeholder */}
        <div
          className={cn(
            "transition-opacity flex items-center",
            isMcpAppsSelected ? "opacity-100" : "opacity-40"
          )}
          title="MCP Apps (SEP-1865)"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="MCP logo"
          >
            {/* Simple geometric logo for MCP */}
            <rect width="24" height="24" rx="4" />
            <text
              x="12"
              y="16"
              textAnchor="middle"
              fill="white"
              fontSize="10"
              fontWeight="bold"
            >
              M
            </text>
          </svg>
        </div>
      </div>

      <div className="text-xs text-center text-muted-foreground">
        {isMcpAppsSelected
          ? "MCP Apps (JSON-RPC)"
          : "ChatGPT Apps (window.openai)"}
      </div>
    </div>
  );
}
