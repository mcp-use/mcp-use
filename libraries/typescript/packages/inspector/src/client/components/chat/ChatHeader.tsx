import type { LLMConfig } from "./types";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Copy, Download, SquarePen } from "lucide-react";
import { ConfigurationDialog } from "./ConfigurationDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

interface ChatHeaderProps {
  llmConfig: LLMConfig | null;
  hasMessages: boolean;
  configDialogOpen: boolean;
  onConfigDialogOpenChange: (open: boolean) => void;
  onClearChat: () => void;
  onCopyChat?: () => void;
  onExportChat?: (format: "json" | "markdown") => void;
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
  /**
   * When set, the header shows a "Free tier" badge (instead of the local
   * provider/model badge) and passes this info down to the ConfigurationDialog
   * so it renders a Sign-in CTA above the bring-your-own-key form.
   * Used in hosted inspector mode where the LLM is managed server-side.
   */
  freeTierInfo?: {
    onLoginClick: () => void;
  };
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
  /** When true, hides the "New Chat" / clear button entirely. */
  hideClearButton?: boolean;
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
  freeTierInfo,
  clearButtonLabel,
  hideTitle,
  clearButtonHideIcon,
  clearButtonHideShortcut,
  clearButtonVariant,
  hideClearButton,
  onCopyChat,
  onExportChat,
}: ChatHeaderProps) {
  return (
    <div className="flex flex-row absolute top-0 right-0 z-10 w-full items-center justify-between p-1 pt-2 gap-2">
      <div className="flex items-center gap-2 rounded-full p-2 px-2 sm:px-4">
        {!hideTitle && <h3 className="text-xl sm:text-3xl font-base">Chat</h3>}
        {llmConfig && (!hideConfigButton || freeTierInfo) && (
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
              <p>
                {freeTierInfo ? "Change model / upgrade" : "Change API Key"}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-2 pr-2 sm:pr-3 pt-0 sm:pt-2 shrink-0">
        {/* Mobile: Show provider icon button when config exists (leftmost on mobile) */}
        {llmConfig && (!hideConfigButton || freeTierInfo) && (
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
        {!hideClearButton && hasMessages && (
          <div className="flex items-center gap-1">
            {onCopyChat && (
              <Button
                data-testid="chat-copy-button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 px-3"
                onClick={onCopyChat}
              >
                <Copy className="h-4 w-4" />
                <span className="hidden sm:inline">Copy</span>
              </Button>
            )}

            {onExportChat && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid="chat-export-button"
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1.5 px-3"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid="chat-export-json"
                    onClick={() => onExportChat("json")}
                  >
                    Export as JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="chat-export-markdown"
                    onClick={() => onExportChat("markdown")}
                  >
                    Export as Markdown
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="w-[1px] h-4 bg-border mx-1" />

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
          </div>
        )}
        {/* Always render the dialog for when it's opened. In hosted-managed mode
            `freeTierInfo` is set and the dialog renders a Sign-in CTA above the
            bring-your-own-key form. */}
        {(!hideConfigButton || freeTierInfo) && (
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
            showClearButton={!!llmConfig && !freeTierInfo}
            buttonLabel={llmConfig ? "Change API Key" : "Configure API Key"}
            freeTierInfo={freeTierInfo}
          />
        )}
      </div>
    </div>
  );
}
