import type { LLMConfig } from "./types";

import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mcp-use/inspector/ui";
import { SquarePen } from "lucide-react";
import { ConfigurationDialog } from "./ConfigurationDialog";

interface ChatHeaderProps {
  llmConfig: LLMConfig | null;
  hasMessages: boolean;
  configDialogOpen: boolean;
  onConfigDialogOpenChange: (open: boolean) => void;
  onClearChat: () => void;
  // Configuration props
  tempProvider: "openai" | "anthropic" | "google";
  tempModel: string;
  tempApiKey: string;
  onProviderChange: (provider: "openai" | "anthropic" | "google") => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onSaveConfig: () => void;
  onClearConfig: () => void;
}

export function ChatHeader({
  llmConfig,
  hasMessages,
  configDialogOpen,
  onConfigDialogOpenChange,
  onClearChat,
  tempProvider,
  tempModel,
  tempApiKey,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onSaveConfig,
  onClearConfig,
}: ChatHeaderProps) {
  return (
    <div className="flex flex-row absolute top-0 right-0 z-10 w-full items-center justify-between p-1 pt-2 gap-2">
      <div className="flex items-center gap-2 rounded-full p-2 px-2 sm:px-4 bg-background/40 backdrop-blur-sm">
        <h3 className="text-xl sm:text-3xl font-base">Chat</h3>
        {llmConfig && (
          <>
            {/* Desktop: Show badge with text */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="hidden sm:flex ml-2 pl-1 font-mono text-[11px] cursor-pointer hover:bg-secondary/80 transition-colors"
                  onClick={() => onConfigDialogOpenChange(true)}
                >
                  <img
                    src={`https://inspector-cdn.mcp-use.com/providers/${llmConfig.provider}.png`}
                    alt={llmConfig.provider}
                    className="w-4 h-4 mr-0"
                  />
                  {llmConfig.provider}/{llmConfig.model}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Change API Key</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 pr-2 sm:pr-3 pt-0 sm:pt-2 shrink-0">
        {/* Mobile: Show provider icon button when config exists (leftmost on mobile) */}
        {llmConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="p-2 sm:hidden"
                onClick={() => onConfigDialogOpenChange(true)}
              >
                <img
                  src={`https://inspector-cdn.mcp-use.com/providers/${llmConfig.provider}.png`}
                  alt={llmConfig.provider}
                  className="w-4 h-4"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Change API Key</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* New Chat button - rightmost on mobile, primary style */}
        {hasMessages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="default"
                className="p-2 sm:pr-1 sm:pl-3 cursor-pointer"
                onClick={onClearChat}
              >
                <SquarePen className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">New Chat</span>
                <span className="hidden sm:inline text-[12px] border text-zinc-300 p-1 rounded-full border-zinc-300 dark:text-zinc-600 dark:border-zinc-500 ml-2">
                  ⌘O
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>New Chat</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Desktop: Show ConfigurationDialog button when no config */}
        {!llmConfig && (
          <div className="hidden sm:block">
            <ConfigurationDialog
              open={configDialogOpen}
              onOpenChange={onConfigDialogOpenChange}
              tempProvider={tempProvider}
              tempModel={tempModel}
              tempApiKey={tempApiKey}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
              onApiKeyChange={onApiKeyChange}
              onSave={onSaveConfig}
              onClear={onClearConfig}
              showClearButton={!!llmConfig}
              buttonLabel={llmConfig ? "Change API Key" : "Configure API Key"}
            />
          </div>
        )}
        {/* Always render the dialog for when it's opened */}
        <ConfigurationDialog
          open={configDialogOpen}
          onOpenChange={onConfigDialogOpenChange}
          tempProvider={tempProvider}
          tempModel={tempModel}
          tempApiKey={tempApiKey}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onApiKeyChange={onApiKeyChange}
          onSave={onSaveConfig}
          onClear={onClearConfig}
          showClearButton={!!llmConfig}
          buttonLabel={llmConfig ? "Change API Key" : "Configure API Key"}
        />
      </div>
    </div>
  );
}
