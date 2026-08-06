import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { Prompt, Skill } from "@mcp-use/client/react";
import { ArrowUp, Loader2 } from "lucide-react";
import React from "react";
import type { ElicitResult } from "@mcp-use/client/react";
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
import { SkillContextChips } from "./SkillContextChips";

interface ChatInputAreaProps {
  variant?: "default" | "fullscreen";
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
  skills?: Skill[];
  enabledSkillUris?: Set<string>;
  onEnabledSkillUrisChange?: (enabledUris: Set<string>) => void;
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
  onSkillSelect: (skill: Skill) => void;
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
  managedCloudInfo?: {
    models: import("./useManagedCloudModel").CloudModel[];
    selectedModelId: string;
    onModelChange: (modelId: string) => void;
    isLoading?: boolean;
  };
  modelBadgeMode?: "managed" | "byok";
  modelDisplayName?: string;
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
  variant = "default",
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
  skills = [],
  enabledSkillUris = new Set(),
  onEnabledSkillUrisChange,
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
  onSkillSelect,
  onDeletePromptResult,
  onAttachmentAdd,
  onAttachmentRemove,
  hideModelBadge,
  freeTierInfo,
  managedCloudInfo,
  modelBadgeMode = "byok",
  modelDisplayName,
  followups = [],
  onFollowupSelect,
  pendingElicitationRequests,
  onApproveElicitation,
  onRejectElicitation,
  systemPromptProvider,
}: ChatInputAreaProps) {
  const isFullscreen = variant === "fullscreen";
  const canSend =
    inputValue.trim() || promptResults.length > 0 || attachments.length > 0;
  const hasPendingElicitation = (pendingElicitationRequests?.length ?? 0) > 0;

  const modelBadge =
    llmConfig && (!hideModelBadge || freeTierInfo || managedCloudInfo) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <ModelConfigBadge
              provider={llmConfig.provider}
              model={llmConfig.model}
              displayName={modelDisplayName}
              mode={modelBadgeMode}
              className="shrink-0"
              onClick={() => onConfigDialogOpenChange(true)}
            />
          }
          nativeButton
        />
        <TooltipContent>
          <p>
            {managedCloudInfo || freeTierInfo
              ? "Change model"
              : "Change API Key"}
          </p>
        </TooltipContent>
      </Tooltip>
    ) : null;

  return (
    <div
      className={cn(
        "w-full flex shrink-0 flex-col items-center px-2 pt-0 sm:px-4 text-foreground",
        isFullscreen ? "pb-4 sm:pb-4" : "pb-2 sm:pb-2"
      )}
    >
      <div
        className={cn(
          "relative w-full max-w-3xl",
          !isFullscreen && "backdrop-blur-xl"
        )}
      >
        {!isFullscreen &&
          hasPendingElicitation &&
          onApproveElicitation &&
          onRejectElicitation && (
            <FloatingChatElicitation
              requests={pendingElicitationRequests!}
              onApprove={onApproveElicitation}
              onReject={onRejectElicitation}
            />
          )}
        {!isFullscreen && followups.length > 0 && (
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
        {!isFullscreen && (
          <>
            {onEnabledSkillUrisChange && (
              <SkillContextChips
                skills={skills}
                enabledUris={enabledSkillUris}
                onChange={onEnabledSkillUrisChange}
              />
            )}
            <PromptsDropdown
              isOpen={promptsDropdownOpen}
              prompts={prompts}
              skills={skills}
              enabledSkillUris={enabledSkillUris}
              selectedPrompt={selectedPrompt}
              focusedIndex={promptFocusedIndex}
              onPromptSelect={onPromptSelect}
              onSkillSelect={onSkillSelect}
            />
            <PromptResultsList
              promptResults={promptResults}
              onDeletePromptResult={onDeletePromptResult}
              offsetForSkills={skills.length > 0}
            />
          </>
        )}

        <ChatInput
          variant={variant}
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          attachments={attachments}
          placeholder="Ask a question or request an action..."
          className={cn(
            "bg-white/80 dark:text-white dark:bg-black backdrop-blur-sm border-gray-200 dark:border-zinc-800",
            !isFullscreen &&
              (promptResults.length > 0 || skills.length > 0) &&
              (promptResults.length > 0 && skills.length > 0
                ? "pt-24"
                : "pt-16")
          )}
          showAttachButton={!isFullscreen}
          tools={isFullscreen ? undefined : tools}
          disabledTools={isFullscreen ? undefined : disabledTools}
          onDisabledToolsChange={
            isFullscreen ? undefined : onDisabledToolsChange
          }
          onInputChange={onInputChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          onAttachmentAdd={onAttachmentAdd}
          onAttachmentRemove={onAttachmentRemove}
          inlineControls={
            !isFullscreen && llmConfig && systemPromptProvider ? (
              <SystemPromptButton
                compact
                value={systemPromptProvider.prompt}
                onSave={systemPromptProvider.savePrompt}
                disabled={
                  !isConnected || isLoading || systemPromptProvider.disabled
                }
                isSaving={systemPromptProvider.isSaving}
              />
            ) : null
          }
          trailingControls={
            <>
              {!isFullscreen && modelBadge}
              <Button
                type="button"
                size="sm"
                className={cn(
                  "h-8 w-8 rounded-full p-0",
                  isLoading && "animate-spin",
                  !canSend && !isLoading && "bg-zinc-400"
                )}
                disabled={
                  !isLoading &&
                  (!canSend || !isConnected || hasPendingElicitation)
                }
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
