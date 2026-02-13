import { AuroraBackground } from "@/client/components/ui/aurora-background";
import { Badge } from "@/client/components/ui/badge";
import { BlurFade } from "@/client/components/ui/blur-fade";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { ArrowUp, Loader2 } from "lucide-react";
import React from "react";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import { ChatInput } from "./ChatInput";
import { PromptResultsList } from "./PromptResultsList";
import { PromptsDropdown } from "./PromptsDropdown";
import type { LLMConfig, MessageAttachment } from "./types";

interface ChatLandingFormProps {
  mcpServerUrl: string;
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
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onConfigDialogOpenChange: (open: boolean) => void;
  onPromptSelect: (prompt: Prompt) => void;
  onDeletePromptResult: (index: number) => void;
  onAttachmentAdd: (file: File) => void;
  onAttachmentRemove: (index: number) => void;
  /** When true, hides the model badge below the input. */
  hideModelBadge?: boolean;
  /** When true, hides the MCP server URL below the title. */
  hideServerUrl?: boolean;
  /** Optional quick question suggestions displayed below the landing input. */
  quickQuestions?: string[];
  /** Called when a quick question is selected. */
  onQuickQuestionSelect?: (question: string) => void;
}

export function ChatLandingForm({
  mcpServerUrl,
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
  onInputChange,
  onKeyDown,
  onKeyUp,
  onClick,
  onSubmit,
  onConfigDialogOpenChange,
  onPromptSelect,
  onDeletePromptResult,
  onAttachmentAdd,
  onAttachmentRemove,
  hideModelBadge,
  hideServerUrl,
  quickQuestions = [],
  onQuickQuestionSelect,
}: ChatLandingFormProps) {
  // Can send if there's text, prompt results, or attachments
  const canSend =
    inputValue.trim() || promptResults.length > 0 || attachments.length > 0;

  return (
    <AuroraBackground>
      <BlurFade className="w-full max-w-4xl mx-auto px-2 sm:px-4">
        <div className="text-center mb-6 sm:mb-8">
          <h1
            className="text-2xl sm:text-4xl font-light mb-2 dark:text-white"
            data-testid="chat-landing-header"
          >
            Chat with MCP Server
          </h1>
          {!hideServerUrl && (
            <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 font-light break-all px-2">
              {mcpServerUrl}
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex justify-center">
            <div className="relative w-full max-w-2xl">
              <PromptsDropdown
                prompts={prompts}
                isOpen={promptsDropdownOpen}
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
                onInputChange={onInputChange}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onClick={onClick}
                onAttachmentAdd={onAttachmentAdd}
                onAttachmentRemove={onAttachmentRemove}
              />

              <div className="absolute right-0 p-3 bottom-0">
                <Button
                  type="submit"
                  size="sm"
                  className={cn(
                    "h-10 w-10 rounded-full",
                    isLoading && "animate-spin",
                    !canSend && "bg-zinc-400"
                  )}
                  disabled={isLoading || !canSend || !isConnected}
                  data-testid="chat-send-button"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          {quickQuestions.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-2">
              {quickQuestions.map((question) => (
                <Button
                  key={question}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-white/70 dark:bg-black/50"
                  onClick={() => onQuickQuestionSelect?.(question)}
                  disabled={isLoading || !isConnected}
                >
                  {question}
                </Button>
              ))}
            </div>
          )}
          {llmConfig && !hideModelBadge && (
            <div className="flex justify-center mt-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="pl-1 font-mono text-[11px] cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => onConfigDialogOpenChange(true)}
                  >
                    <img
                      src={`https://inspector-cdn.mcp-use.com/providers/${llmConfig.provider}.png`}
                      alt={llmConfig.provider}
                      className="w-4 h-4 mr-0 rounded-full"
                    />
                    {llmConfig.provider}/{llmConfig.model}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Change API Key</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </form>
      </BlurFade>
    </AuroraBackground>
  );
}
