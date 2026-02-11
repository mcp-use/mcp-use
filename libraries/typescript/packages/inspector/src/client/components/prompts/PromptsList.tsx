import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { MessageSquare } from "lucide-react";
import { ListItem } from "@/client/components/shared";
import { Badge } from "@/client/components/ui/badge";

interface PromptsListProps {
  prompts: Prompt[];
  selectedPrompt: Prompt | null;
  onPromptSelect: (prompt: Prompt) => void;
  focusedIndex: number;
}

export function PromptsList({
  prompts,
  selectedPrompt,
  onPromptSelect,
  focusedIndex,
}: PromptsListProps) {
  if (prompts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <MessageSquare className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No prompts available</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 border-r dark:border-zinc-700 overscroll-contain">
      {prompts.map((prompt, index) => (
        <ListItem
          key={prompt.name}
          id={`prompt-${prompt.name}`}
          data-testid={`prompt-item-${prompt.name}`}
          isSelected={selectedPrompt?.name === prompt.name}
          isFocused={focusedIndex === index}
          icon={<MessageSquare className="h-4 w-4" />}
          title={prompt.name}
          description={prompt.description}
          metadata={
            prompt.arguments &&
            prompt.arguments.length > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
              >
                {prompt.arguments.length} args
              </Badge>
            )
          }
          onClick={() => onPromptSelect(prompt)}
        />
      ))}
    </div>
  );
}
