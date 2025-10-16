interface UserMessageProps {
  content: string;
  timestamp?: Date | number;
}

export function UserMessage({ content, timestamp }: UserMessageProps) {
  if (!content || content.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 justify-end">
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div className="bg-zinc-200 dark:bg-zinc-800 text-primary rounded-full px-4 py-2 max-w-[80%] break-words">
          <p className="text-base leading-7 font-sans text-start break-words">
            {content}
          </p>
        </div>

        {timestamp && (
          <span className="text-xs text-muted-foreground mt-1">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

