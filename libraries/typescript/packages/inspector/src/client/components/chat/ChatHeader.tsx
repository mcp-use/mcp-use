import type { LLMConfig } from "./types";

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
import type { ProviderName } from "@mcp-use/agent";
import { ChatTitleReveal } from "@/client/chat-history/ChatTitleReveal";
import { CHAT_TITLE_SIMPLE } from "@/client/chat-history/chat-title";
import {
  inspectorTabHeaderPadding,
  inspectorTabTitleClass,
} from "@/client/lib/font-weight";
import { cn } from "@/client/lib/utils";
import { TabsSubtle, TabsSubtleItem } from "@/client/components/ui/tabs-subtle";
import {
  chatBarActionButtonClass,
  chatBarTitleFrostedClass,
} from "./chat-bar-styles";

const CHAT_VIEW_TABS_ID = "chat-view";

interface ChatHeaderProps {
  llmConfig: LLMConfig | null;
  hasMessages: boolean;
  configDialogOpen: boolean;
  onConfigDialogOpenChange: (open: boolean) => void;
  onClearChat: () => void;
  onCopyChat?: () => void;
  onExportChat?: (format: "json" | "markdown") => void;
  // Configuration props
  tempProvider: ProviderName;
  tempModel: string;
  tempApiKey: string;
  tempBaseUrl: string;
  onProviderChange: (provider: ProviderName) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
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
  managedCloudInfo?: {
    models: import("./useManagedCloudModel").CloudModel[];
    selectedModelId: string;
    onModelChange: (modelId: string) => void;
    isLoading?: boolean;
  };
  onUseManagedCloud?: () => void;
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
  /** Active chat id — enables animated title reveal in the header. */
  activeChatId?: string | null;
  /** Title for the active chat thread. */
  chatTitle?: string;
  /** When true, shows Conv / Raw tabs in the header. */
  showViewToggle?: boolean;
  /** 0 = Conv, 1 = Raw */
  viewIndex?: 0 | 1;
  onViewIndexChange?: (index: number) => void;
  /** Raise header above host chrome (cloud embed). */
  elevatedHeader?: boolean;
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
  tempBaseUrl,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onBaseUrlChange,
  onSaveConfig,
  onClearConfig,
  hideConfigButton,
  freeTierInfo,
  managedCloudInfo,
  onUseManagedCloud,
  clearButtonLabel,
  hideTitle,
  clearButtonHideIcon,
  clearButtonHideShortcut,
  clearButtonVariant,
  hideClearButton,
  onCopyChat,
  onExportChat,
  activeChatId,
  chatTitle,
  showViewToggle,
  viewIndex = 0,
  onViewIndexChange,
  elevatedHeader,
}: ChatHeaderProps) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center gap-2 overflow-visible",
        inspectorTabHeaderPadding,
        elevatedHeader
          ? "pointer-events-none absolute top-0 right-0 z-50"
          : "absolute top-0 right-0 z-10"
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          elevatedHeader && "pointer-events-auto"
        )}
      >
        {!hideTitle && (
          <h2 className={cn(inspectorTabTitleClass, chatBarTitleFrostedClass)}>
            {activeChatId ? (
              <ChatTitleReveal
                key={activeChatId}
                chatId={activeChatId}
                title={chatTitle ?? CHAT_TITLE_SIMPLE}
              />
            ) : (
              CHAT_TITLE_SIMPLE
            )}
          </h2>
        )}
      </div>

      {showViewToggle && onViewIndexChange && (
        <div
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible px-1",
            elevatedHeader && "pointer-events-auto"
          )}
        >
          <TabsSubtle
            selectedIndex={viewIndex}
            onSelect={onViewIndexChange}
            idPrefix={CHAT_VIEW_TABS_ID}
            className="shrink-0 overflow-visible"
            data-testid="chat-view-tabs"
          >
            <TabsSubtleItem label="Conv" index={0} />
            <TabsSubtleItem label="Raw" index={1} />
          </TabsSubtle>
        </div>
      )}

      <div
        className={cn(
          "ml-auto flex shrink-0 items-center gap-2",
          elevatedHeader && "pointer-events-auto"
        )}
      >
        {/* New Chat / Clear button */}
        {!hideClearButton && hasMessages && (
          <div className="flex items-center gap-1">
            {onCopyChat && (
              <Button
                data-testid="chat-copy-button"
                variant="ghost"
                size="sm"
                className={chatBarActionButtonClass}
                onClick={onCopyChat}
              >
                <Copy className="h-4 w-4" />
                <span className="hidden sm:inline">Copy</span>
              </Button>
            )}

            {onExportChat && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      data-testid="chat-export-button"
                      variant="ghost"
                      size="sm"
                      className={chatBarActionButtonClass}
                    >
                      <Download className="h-4 w-4" />
                      <span className="hidden sm:inline">Export</span>
                    </Button>
                  }
                  nativeButton
                />
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

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger
                render={
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
                }
                nativeButton
              />
              <TooltipContent>
                <p>{clearButtonLabel ?? "New Chat"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        {/* Always render the dialog for when it's opened. In hosted-managed mode
            `freeTierInfo` is set and the dialog renders a Sign-in CTA above the
            bring-your-own-key form. */}
        {(!hideConfigButton || freeTierInfo || managedCloudInfo) && (
          <ConfigurationDialog
            open={configDialogOpen}
            onOpenChange={onConfigDialogOpenChange}
            tempProvider={tempProvider}
            tempModel={tempModel}
            tempApiKey={tempApiKey}
            tempBaseUrl={tempBaseUrl}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
            onApiKeyChange={onApiKeyChange}
            onBaseUrlChange={onBaseUrlChange}
            onSave={onSaveConfig}
            onClear={onClearConfig}
            showClearButton={!!llmConfig && !freeTierInfo && !managedCloudInfo}
            buttonLabel={llmConfig ? "Change API Key" : "Configure API Key"}
            freeTierInfo={freeTierInfo}
            managedCloudInfo={managedCloudInfo}
            onUseManagedCloud={onUseManagedCloud}
          />
        )}
      </div>
    </div>
  );
}
