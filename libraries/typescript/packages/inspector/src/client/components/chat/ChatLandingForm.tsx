import { BlurFade } from "@/client/components/ui/blur-fade";
import { Button } from "@/client/components/ui/button";
import React from "react";
import { ChatInputArea } from "./ChatInputArea";

type ChatInputAreaProps = React.ComponentProps<typeof ChatInputArea>;

interface ChatLandingFormProps extends ChatInputAreaProps {
  serverDisplayName: string;
  /** Optional quick question suggestions displayed below the landing input. */
  quickQuestions?: string[];
  /** Called when a quick question is selected. */
  onQuickQuestionSelect?: (question: string) => void;
}

export function ChatLandingForm({
  serverDisplayName,
  quickQuestions = [],
  onQuickQuestionSelect,
  ...inputAreaProps
}: ChatLandingFormProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <BlurFade className="w-full max-w-4xl mx-auto px-2 sm:px-4">
        <div className="text-center mb-6 sm:mb-8">
          <h1
            className="text-2xl sm:text-4xl font-light mb-2 dark:text-white"
            data-testid="chat-landing-header"
          >
            Chat with {serverDisplayName}
          </h1>
        </div>

        <div className="space-y-6">
          <ChatInputArea {...inputAreaProps} />

          {quickQuestions.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-2">
              {quickQuestions.map((question) => (
                <Button
                  key={question}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-white/70 dark:bg-black/50 text-gray-900 dark:text-white"
                  onClick={() => onQuickQuestionSelect?.(question)}
                  disabled={
                    inputAreaProps.isLoading || !inputAreaProps.isConnected
                  }
                >
                  {question}
                </Button>
              ))}
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
