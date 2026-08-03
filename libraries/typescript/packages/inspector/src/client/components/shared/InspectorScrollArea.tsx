import { cn } from "@/client/lib/utils";
import { useState, type ReactNode, type Ref } from "react";

interface InspectorScrollAreaProps {
  className?: string;
  scrollRef?: Ref<HTMLDivElement>;
  children: (isScrolled: boolean) => ReactNode;
}

export function InspectorScrollArea({
  className,
  scrollRef,
  children,
}: InspectorScrollAreaProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  return (
    <div
      ref={scrollRef}
      className={cn("h-full overflow-y-auto overscroll-none", className)}
      onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 0)}
    >
      <div className="flex min-h-full flex-col">{children(isScrolled)}</div>
    </div>
  );
}
