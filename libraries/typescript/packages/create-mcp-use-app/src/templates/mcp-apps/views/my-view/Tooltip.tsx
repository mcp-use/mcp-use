import { useRef, useState, type ReactNode } from "react";

/** Hover/focus tooltip clamped to the nearest [data-card-shell] ancestor. */
export function Tooltip({
  label,
  children,
  multiline = false,
}: {
  label: string;
  children: ReactNode;
  multiline?: boolean;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, maxWidth: 320 });

  const show = () => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    const card = wrap?.closest("[data-card-shell]");
    if (!wrap || !tip || !card) {
      setOpen(true);
      return;
    }
    const pad = 12;
    const cardR = card.getBoundingClientRect();
    const wrapR = wrap.getBoundingClientRect();
    const maxWidth = Math.min(320, Math.max(160, cardR.width - pad * 2));
    Object.assign(tip.style, {
      maxWidth: `${maxWidth}px`,
      visibility: "hidden",
      opacity: "1",
    });
    const w = tip.offsetWidth;
    tip.style.visibility = "";
    tip.style.opacity = "";
    const left =
      Math.max(
        cardR.left + pad,
        Math.min(wrapR.left + wrapR.width / 2 - w / 2, cardR.right - pad - w)
      ) - wrapR.left;
    setPos({ left, maxWidth });
    setOpen(true);
  };

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        ref={tipRef}
        role="tooltip"
        style={{
          left: pos.left,
          maxWidth: pos.maxWidth,
          opacity: open ? 1 : 0,
        }}
        className={`pointer-events-none absolute top-full z-30 mt-1.5 w-max rounded-lg bg-zinc-900 px-3 py-2 text-[11px] font-medium text-white transition-opacity duration-200 dark:bg-zinc-800 dark:text-neutral-100 ${
          multiline
            ? "whitespace-normal text-left leading-snug"
            : "whitespace-nowrap"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
