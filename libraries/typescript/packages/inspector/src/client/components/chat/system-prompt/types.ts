export interface ChatSystemPromptProvider {
  prompt: string | null;
  savePrompt: (prompt: string) => Promise<void>;
  isLoading?: boolean;
  isSaving?: boolean;
  disabled?: boolean;
}
