import { Button } from "@/client/components/ui/button";
import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface ChatScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ChatScrollToBottomButton({
  visible,
  onClick,
}: ChatScrollToBottomButtonProps) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-30 flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <Button
              type="button"
              variant="secondary"
              className="pointer-events-auto size-9 rounded-full border bg-background/95 p-0 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
              onClick={onClick}
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
              data-testid="chat-scroll-to-bottom"
            >
              <ArrowDown className="size-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
