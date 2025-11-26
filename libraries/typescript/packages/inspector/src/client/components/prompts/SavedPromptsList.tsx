import { Clock } from "lucide-react";
import { ListItem } from "@/client/components/shared";

export interface SavedPrompt {
  id: string;
  name: string;
  promptName: string;
  args: Record<string, unknown>;
  savedAt: number;
  serverId?: string;
  serverName?: string;
}

interface SavedPromptsListProps {
  savedPrompts: SavedPrompt[];
  selectedPrompt: SavedPrompt | null;
  onLoadPrompt: (prompt: SavedPrompt) => void;
  onDeletePrompt: (id: string) => void;
  focusedIndex: number;
}

export function SavedPromptsList({
  savedPrompts,
  selectedPrompt,
  onLoadPrompt,
  onDeletePrompt,
  focusedIndex,
}: SavedPromptsListProps) {
  if (savedPrompts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Clock className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No history</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          Prompts you execute will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 border-r dark:border-zinc-700 overscroll-contain">
      {savedPrompts.map((prompt, index) => (
        <ListItem
          key={prompt.id}
          id={`saved-prompt-${prompt.id}`}
          isSelected={selectedPrompt?.id === prompt.id}
          isFocused={focusedIndex === index}
          icon={<Clock className="h-4 w-4" />}
          title={prompt.name}
          description={`${prompt.promptName} - ${new Date(prompt.savedAt).toLocaleString()}`}
          onClick={() => onLoadPrompt(prompt)}
        />
      ))}
    </div>
  );
}
