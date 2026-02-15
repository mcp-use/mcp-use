import type { LLMConfig } from "./types";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
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
  /** When true, hides the API key config badge/button and dialog. */
  hideConfigButton?: boolean;
  /** Label for the clear/new-chat button. Default: "New Chat". */
  clearButtonLabel?: string;
  /** When true, hides the "Chat" title in the header. */
  hideTitle?: boolean;
  /** When true, hides the icon on the clear/new-chat button. */
  clearButtonHideIcon?: boolean;
  /** When true, hides the keyboard shortcut (⌘O) on the clear/new-chat button. */
  clearButtonHideShortcut?: boolean;
  /** Button variant for the clear/new-chat button. Default: "default". */
  clearButtonVariant?: "default" | "secondary" | "ghost" | "outline";
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
  hideConfigButton,
  clearButtonLabel,
  hideTitle,
  clearButtonHideIcon,
  clearButtonHideShortcut,
  clearButtonVariant,
}: ChatHeaderProps) {
  return (
    <div className="flex flex-row absolute top-0 right-0 z-10 w-full items-center justify-between p-1 pt-2 gap-2">
      <div className="flex items-center gap-2 rounded-full p-2 px-2 sm:px-4 bg-background/40 backdrop-blur-sm">
        {!hideTitle && <h3 className="text-xl sm:text-3xl font-base">Chat</h3>}
        {llmConfig && !hideConfigButton && (
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
        {llmConfig && !hideConfigButton && (
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
        {/* New Chat / Clear button */}
        {hasMessages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={clearButtonVariant ?? "default"}
                size="default"
                className={`p-2 cursor-pointer ${clearButtonHideShortcut ? "sm:px-3" : "sm:pr-1 sm:pl-3"}`}
                onClick={onClearChat}
              >
                {!clearButtonHideIcon && (
                  <SquarePen className="h-4 w-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">
                  {clearButtonLabel ?? "New Chat"}
                </span>
                {!clearButtonHideShortcut && (
                  <span className="hidden sm:inline text-[12px] border text-zinc-300 p-1 rounded-full border-zinc-300 dark:text-zinc-600 dark:border-zinc-500 ml-2">
                    ⌘O
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{clearButtonLabel ?? "New Chat"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Always render the dialog for when it's opened (hidden when externally managed) */}
        {!hideConfigButton && (
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
        )}
      </div>
    </div>
  );
}
