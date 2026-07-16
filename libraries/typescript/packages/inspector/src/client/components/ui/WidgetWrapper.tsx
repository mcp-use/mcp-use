import { cn } from "../../lib/utils";

interface WidgetWrapperProps {
  children: React.ReactNode;
  className?: string;
  noWrapper?: boolean;
}

/**
 * Widget wrapper with dotted radial gradient background
 * Shared by MCP Apps renderers
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
        "flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-800",
        "[background-image:radial-gradient(circle,rgba(0,0,0,0.12)_1px,transparent_1px)]",
        "dark:[background-image:radial-gradient(circle,rgba(255,255,255,0.1)_1px,transparent_1px)]",
        "bg-[length:32px_32px]",
        className
      )}
    >
      {children}
    </div>
  );
}
