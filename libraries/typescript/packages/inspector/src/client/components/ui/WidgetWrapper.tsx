import { cn } from "../../lib/utils";

interface WidgetWrapperProps {
  children: React.ReactNode;
  className?: string;
  noWrapper?: boolean;
}

/**
 * Widget wrapper with dotted radial gradient background
 * Shared by OpenAI Apps SDK and MCP Apps renderers
 */
export function WidgetWrapper({
  children,
  className,
  noWrapper,
}: WidgetWrapperProps) {
  if (noWrapper) {
    return children;
  }
  return (
    <div
      className={cn(
        "bg-zinc-100 dark:bg-zinc-900 bg-[radial-gradient(circle,_rgba(0,0,0,0.2)_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_rgba(255,255,255,0.2)_1px,_transparent_1px)] bg-[length:32px_32px]",
        className
      )}
    >
      {children}
    </div>
  );
}
