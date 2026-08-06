import { Check, LibraryBig, MessageSquare } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { cn } from "@/client/lib/utils";
import { useEffect } from "react";
import type { Prompt, Skill } from "@mcp-use/client/react";

interface PromptsDropdownProps {
  isOpen?: boolean;
  focusedIndex: number;
  prompts: Prompt[];
  skills: Skill[];
  enabledSkillUris: Set<string>;
  selectedPrompt: Prompt | null;
  onPromptSelect: (prompt: Prompt) => void;
  onSkillSelect: (skill: Skill) => void;
}

function skillName(skill: Skill): string {
  return typeof skill.frontmatter.name === "string"
    ? skill.frontmatter.name
    : skill.uri;
}

export function PromptsDropdown({
  isOpen,
  focusedIndex,
  prompts,
  skills,
  enabledSkillUris,
  selectedPrompt,
  onPromptSelect,
  onSkillSelect,
}: PromptsDropdownProps) {
  if (!isOpen) return null;

  // Scroll to focused index
  useEffect(() => {
    if (focusedIndex >= 0) {
      const element = document.getElementById(
        `prompt-suggestion-${focusedIndex}`
      );
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex]);

  return (
    <div
      className="absolute bottom-full left-0 right-0 max-w-3xl w-full max-h-[300px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-30 flex flex-col gap-2 mb-1"
      data-testid="chat-prompts-dropdown"
    >
      <div className="p-2">
        {prompts.length > 0 && (
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            Prompts
          </div>
        )}
        {prompts.map((prompt, index) => (
          <Tooltip key={index}>
            <TooltipTrigger
              render={
                <Button
                  id={`prompt-suggestion-${index}`}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "w-full flex items-center px-3 py-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-left justify-start",
                    focusedIndex === index && "bg-zinc-200 dark:bg-zinc-700"
                  )}
                  onClick={() => onPromptSelect(prompt)}
                  data-testid={`chat-prompt-option-${index}`}
                >
                  <div className="flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      {prompt.name}
                      {selectedPrompt?.name === prompt.name && (
                        <Spinner className="size-3 text-zinc-600 dark:text-zinc-400" />
                      )}
                    </div>
                  </div>
                </Button>
              }
              nativeButton
            />
            <TooltipContent>{prompt.description}</TooltipContent>
          </Tooltip>
        ))}
        {skills.length > 0 && (
          <div className="mt-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            Skills
          </div>
        )}
        {skills.map((skill, index) => {
          const suggestionIndex = prompts.length + index;
          const enabled = enabledSkillUris.has(skill.uri);
          return (
            <Tooltip key={skill.uri}>
              <TooltipTrigger
                render={
                  <Button
                    id={`prompt-suggestion-${suggestionIndex}`}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-left justify-start",
                      focusedIndex === suggestionIndex &&
                        "bg-zinc-200 dark:bg-zinc-700"
                    )}
                    onClick={() => onSkillSelect(skill)}
                    data-testid={`chat-skill-option-${index}`}
                  >
                    <LibraryBig className="h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {skillName(skill)}
                    </span>
                    {enabled && <Check className="size-4 shrink-0" />}
                  </Button>
                }
                nativeButton
              />
              <TooltipContent>
                {String(skill.frontmatter.description ?? skill.uri)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
