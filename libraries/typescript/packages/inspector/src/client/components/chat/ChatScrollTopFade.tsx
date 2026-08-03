import { cn } from "@/client/lib/utils";

interface ChatScrollTopFadeProps {
  visible: boolean;
}

/** Masks scroll content under the absolute chat header (matches ChatTab scroll padding). */
export function ChatScrollTopFade({ visible }: ChatScrollTopFadeProps) {
  return (
    <div
      aria-hidden
      className={cn(
        // Under ChatHeader (z-10 / z-50), above messages. Taller band + longer ramp.
        "pointer-events-none absolute inset-x-0 top-0 z-[5] h-32 bg-[linear-gradient(to_bottom,var(--background)_0%,var(--background)_24%,transparent_46%)] transition-opacity duration-200 sm:h-36",
        visible ? "opacity-100" : "opacity-0"
      )}
    />
  );
}
