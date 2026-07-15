import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { Prompt } from "@modelcontextprotocol/client";
import { ArrowUp, Loader2 } from "lucide-react";
import React from "react";
import type { ElicitResult } from "@modelcontextprotocol/client";
import type { PendingElicitationRequest } from "@/client/types/pending-requests";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import { ChatInput } from "./ChatInput";
import { ModelConfigBadge } from "./providerMeta";
import { PromptResultsList } from "./PromptResultsList";
import { PromptsDropdown } from "./PromptsDropdown";
import type { ToolInfo } from "./ToolSelector";
import type { LLMConfig, MessageAttachment } from "./types";
import { FloatingChatElicitation } from "./FloatingChatElicitation";
import { SystemPromptButton } from "./SystemPromptButton";
import type { ChatSystemPromptProvider } from "./system-prompt/types";

interface ChatInputAreaProps {
  inputValue: string;
  isConnected: boolean;
  isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  llmConfig: LLMConfig | null;
  promptsDropdownOpen: boolean;
  promptFocusedIndex: number;
  prompts: Prompt[];
  selectedPrompt: Prompt | null;
  promptResults: PromptResult[];
  attachments: MessageAttachment[];
  tools?: ToolInfo[];
  disabledTools?: Set<string>;
  onDisabledToolsChange?: (disabledTools: Set<string>) => void;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: () => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
  onConfigDialogOpenChange: (open: boolean) => void;
  onPromptSelect: (prompt: Prompt) => void;
  onDeletePromptResult: (index: number) => void;
  onAttachmentAdd: (file: File) => void;
  onAttachmentRemove: (index: number) => void;
  /** When true, hides the model badge in the input toolbar. */
  hideModelBadge?: boolean;
  /**
   * When set (hosted-managed mode), keeps the model badge visible for upgrade
   * even when `hideModelBadge` is true.
   */
  freeTierInfo?: {
    onLoginClick: () => void;
  };
  /** Optional followup suggestions rendered above the chat input. */
  followups?: string[];
  /** Called when a followup suggestion is selected. */
  onFollowupSelect?: (followup: string) => void;
  /** Pending MCP elicitation requests — rendered floating above the composer. */
  pendingElicitationRequests?: PendingElicitationRequest[];
  onApproveElicitation?: (requestId: string, result: ElicitResult) => void;
  onRejectElicitation?: (requestId: string, error?: string) => void;
  /** Pluggable system prompt source (localStorage or host API). */
  systemPromptProvider?: ChatSystemPromptProvider;
}

export function ChatInputArea({
  inputValue,
  isConnected,
  isLoading,
  textareaRef,
  llmConfig,
  promptsDropdownOpen,
  promptFocusedIndex,
  prompts,
  selectedPrompt,
  promptResults,
  attachments,
  tools,
  disabledTools,
  onDisabledToolsChange,
  onInputChange,
  onKeyDown,
  onKeyUp,
  onClick,
  onSendMessage,
  onStopStreaming,
  onConfigDialogOpenChange,
  onPromptSelect,
  onDeletePromptResult,
  onAttachmentAdd,
  onAttachmentRemove,
  hideModelBadge,
  freeTierInfo,
  followups = [],
  onFollowupSelect,
  pendingElicitationRequests,
  onApproveElicitation,
  onRejectElicitation,
  systemPromptProvider,
}: ChatInputAreaProps) {
  const canSend =
    inputValue.trim() || promptResults.length > 0 || attachments.length > 0;
  const hasPendingElicitation = (pendingElicitationRequests?.length ?? 0) > 0;

  const modelBadge =
    llmConfig && (!hideModelBadge || freeTierInfo) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <ModelConfigBadge
              provider={llmConfig.provider}
              model={llmConfig.model}
              className="shrink-0"
              onClick={() => onConfigDialogOpenChange(true)}
            />
          }
          nativeButton
        />
        <TooltipContent>
          <p>
            {freeTierInfo ? "Change model / upgrade" : "Change API Key"}
          </p>
        </TooltipContent>
      </Tooltip>
    ) : null;

  return (
    <div className="w-full flex shrink-0 flex-col items-center px-2 pb-2 pt-0 sm:px-4 sm:pb-2 text-foreground">
      <div className="relative w-full max-w-3xl backdrop-blur-xl">
        {hasPendingElicitation &&
          onApproveElicitation &&
          onRejectElicitation && (
            <FloatingChatElicitation
              requests={pendingElicitationRequests!}
              onApprove={onApproveElicitation}
              onReject={onRejectElicitation}
            />
          )}
        {followups.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {followups.map((followup) => (
              <Button
                key={followup}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => onFollowupSelect?.(followup)}
                disabled={isLoading || !isConnected}
              >
                {followup}
              </Button>
            ))}
          </div>
        )}
        <PromptsDropdown
          isOpen={promptsDropdownOpen}
          prompts={prompts}
          selectedPrompt={selectedPrompt}
          focusedIndex={promptFocusedIndex}
          onPromptSelect={onPromptSelect}
        />
        <PromptResultsList
          promptResults={promptResults}
          onDeletePromptResult={onDeletePromptResult}
        />

        <ChatInput
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          attachments={attachments}
          placeholder="Ask a question or request an action..."
          className={cn(
            "bg-white/80 dark:text-white dark:bg-black backdrop-blur-sm border-gray-200 dark:border-zinc-800",
            promptResults.length > 0 && "pt-16"
          )}
          tools={tools}
          disabledTools={disabledTools}
          onDisabledToolsChange={onDisabledToolsChange}
          onInputChange={onInputChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          onAttachmentAdd={onAttachmentAdd}
          onAttachmentRemove={onAttachmentRemove}
          inlineControls={
            llmConfig && systemPromptProvider ? (
              <SystemPromptButton
                compact
                value={systemPromptProvider.prompt}
                onSave={systemPromptProvider.savePrompt}
                disabled={
                  !isConnected ||
                  isLoading ||
                  systemPromptProvider.disabled
                }
                isSaving={systemPromptProvider.isSaving}
              />
            ) : null
          }
          trailingControls={
            <>
              {modelBadge}
              <Button
                type="button"
                size="sm"
                className={cn(
                  "h-8 w-8 rounded-full p-0",
                  isLoading && "animate-spin",
                  !canSend && !isLoading && "bg-zinc-400"
                )}
                disabled={!isLoading && (!canSend || !isConnected || hasPendingElicitation)}
                title={isLoading ? "Stop streaming" : "Send"}
                onClick={isLoading ? onStopStreaming : onSendMessage}
                data-testid="chat-send-button"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          }
        />
      </div>
    </div>
  );
}
