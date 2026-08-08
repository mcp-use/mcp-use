import { cn } from "@/client/lib/utils";
import { useEffect, useRef, useState } from "react";
import { isPlaceholderTitle } from "./chat-title";

const CHAR_MS = 28;
const MAX_BLUR_PX = 3;
const START_OPACITY = 0.72;

interface ChatTitleRevealProps {
  chatId: string;
  title: string;
  className?: string;
  onRevealComplete?: () => void;
}

/** Reveals a generated title over the placeholder with blur-fade typing. */
export function ChatTitleReveal({
  chatId,
  title,
  className,
  onRevealComplete,
}: ChatTitleRevealProps) {
  const [visible, setVisible] = useState(title);
  const [blurPx, setBlurPx] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const prevTitleRef = useRef(title);
  const animatedKeyRef = useRef<string | null>(null);
  const prevChatIdRef = useRef(chatId);

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      prevTitleRef.current = title;
      animatedKeyRef.current = null;
      setVisible(title);
      setBlurPx(0);
      setOpacity(1);
      return;
    }
  }, [chatId, title]);

  useEffect(() => {
    const animationKey = `${chatId}:${title}`;
    if (animatedKeyRef.current === animationKey) {
      setVisible(title);
      setBlurPx(0);
      setOpacity(1);
      return;
    }

    const prev = prevTitleRef.current;
    const shouldAnimate =
      isPlaceholderTitle(prev) && !isPlaceholderTitle(title) && title !== prev;

    prevTitleRef.current = title;

    if (!shouldAnimate) {
      setVisible(title);
      setBlurPx(0);
      setOpacity(1);
      return;
    }

    animatedKeyRef.current = animationKey;
    let index = 0;
    const len = title.length;
    setVisible("");
    setBlurPx(MAX_BLUR_PX);
    setOpacity(START_OPACITY);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      index += 1;
      const progress = len > 0 ? index / len : 1;
      setVisible(title.slice(0, index));
      setBlurPx(MAX_BLUR_PX * (1 - progress));
      setOpacity(START_OPACITY + (1 - START_OPACITY) * progress);
      if (index < len) {
        timer = setTimeout(tick, CHAR_MS);
      } else {
        onRevealComplete?.();
      }
    };

    timer = setTimeout(tick, CHAR_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [chatId, title, onRevealComplete]);

  return (
    <span
      className={cn(
        "block truncate transition-[filter,opacity] duration-75",
        className
      )}
      style={{
        filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        opacity,
      }}
    >
      {visible}
    </span>
  );
}
