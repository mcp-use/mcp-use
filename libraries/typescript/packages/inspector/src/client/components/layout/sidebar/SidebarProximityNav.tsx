import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";

import { useProximityHoverKeys } from "@/client/hooks/use-proximity-hover-keys";
import { spring } from "@/client/lib/springs";
import { cn } from "@/client/lib/utils";

/**
 * Sidebar nav highlight, ported from fluidfunctionalism.com/docs/dropdown.
 *
 * Two absolutely-positioned backgrounds:
 * - Active (current route): cross-fades on navigation — fades out at the old
 *   row and fades in at the new row (no positional slide on click).
 * - Hover: slides between rows with springs while the cursor is in the nav.
 *
 * Rows register their DOM node + key via context; `useProximityHoverKeys`
 * tracks the row nearest the cursor and exposes each row's rect for positioning.
 */

type ItemRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type PillBleed = { left: number; right: number };

/** Match `.sidebar-nav-pill-bleed-x` negative margins for the gliding pill bg. */
function readSidebarPillBleed(el: HTMLElement | null): PillBleed {
  if (!el) return { left: 0, right: 0 };
  const cs = getComputedStyle(el);
  const bleed =
    Number.parseFloat(cs.getPropertyValue("--sidebar-nav-pill-bleed")) || 0;
  const scrollbarW =
    Number.parseFloat(cs.getPropertyValue("--sidebar-nav-scrollbar-width")) ||
    0;
  const trimRight =
    Number.parseFloat(
      cs.getPropertyValue("--sidebar-nav-pill-outer-trim-right")
    ) || 0;
  return { left: bleed, right: bleed + scrollbarW + trimRight };
}

function expandRectForPillBleed(rect: ItemRect, bleed: PillBleed): ItemRect {
  return {
    ...rect,
    left: rect.left - bleed.left,
    width: rect.width + bleed.left + bleed.right,
  };
}

type ProximityContextValue = {
  registerItem: (key: string, el: HTMLElement | null) => void;
};

const ProximityContext = createContext<ProximityContextValue | null>(null);

/**
 * Returns `getRowRef(key)` → a ref callback for a nav row. Callbacks are cached
 * per key so they keep a stable identity across renders (React would otherwise
 * fire register(null)/register(node) every render, thrashing measurement).
 * Safe to call inside a `.map()` since it is not itself a hook.
 */
export function useSidebarProximityRowRefs() {
  const ctx = useContext(ProximityContext);
  const registerRef = useRef(ctx?.registerItem);
  registerRef.current = ctx?.registerItem;
  const cacheRef = useRef(new Map<string, (n: HTMLElement | null) => void>());
  return useCallback((key: string) => {
    const cache = cacheRef.current;
    let cb = cache.get(key);
    if (!cb) {
      cb = (node: HTMLElement | null) => registerRef.current?.(key, node);
      cache.set(key, cb);
    }
    return cb;
  }, []);
}

export function SidebarProximityNav({
  children,
  isActiveKey,
  className,
}: {
  children: ReactNode;
  /** Predicate identifying the active-route row key (drives the resting bg). */
  isActiveKey: (key: string) => boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    activeKey,
    itemRects,
    sessionRef,
    handlers,
    registerItem,
    measureItems,
  } = useProximityHoverKeys(containerRef);

  const ctxValue = useMemo<ProximityContextValue>(
    () => ({ registerItem }),
    [registerItem]
  );

  const checkedKey =
    Object.keys(itemRects).find((key) => isActiveKey(key)) ?? null;

  // Remeasure after mount / child updates and when the active tab changes.
  useLayoutEffect(() => {
    measureItems();
  }, [measureItems, children, checkedKey]);

  const pillBleed = readSidebarPillBleed(containerRef.current);

  const activeRectRaw = activeKey ? itemRects[activeKey] : null;
  const checkedRectRaw = checkedKey ? itemRects[checkedKey] : null;
  const activeRect = activeRectRaw
    ? expandRectForPillBleed(activeRectRaw, pillBleed)
    : null;
  const checkedRect = checkedRectRaw
    ? expandRectForPillBleed(checkedRectRaw, pillBleed)
    : null;
  const isHoveringOther = activeKey !== null && activeKey !== checkedKey;

  return (
    <ProximityContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        onMouseEnter={handlers.onMouseEnter}
        onMouseMove={handlers.onMouseMove}
        onMouseLeave={handlers.onMouseLeave}
        className={cn("relative isolate", className)}
      >
        {/* Active-route background — cross-fades on route change, no slide. */}
        <AnimatePresence initial={false}>
          {checkedRect && checkedKey ? (
            <motion.div
              key={checkedKey}
              aria-hidden
              className="pointer-events-none absolute -z-20 rounded-full bg-sidebar-accent"
              initial={{
                opacity: 0,
                top: checkedRect.top,
                left: checkedRect.left,
                width: checkedRect.width,
                height: checkedRect.height,
              }}
              animate={{
                opacity: isHoveringOther ? 0.85 : 1,
                top: checkedRect.top,
                left: checkedRect.left,
                width: checkedRect.width,
                height: checkedRect.height,
              }}
              exit={{ opacity: 0, transition: spring.fast.exit }}
              transition={{
                opacity: { duration: 0.08 },
                top: { duration: 0 },
                left: { duration: 0 },
                width: { duration: 0 },
                height: { duration: 0 },
              }}
            />
          ) : null}
        </AnimatePresence>

        {/* Hover background — slides between rows, fades out on leave. */}
        <AnimatePresence>
          {activeRect ? (
            <motion.div
              key={sessionRef.current}
              aria-hidden
              className="pointer-events-none absolute -z-10 rounded-full bg-sidebar-accent"
              initial={{
                opacity: 0,
                top: checkedRect?.top ?? activeRect.top,
                left: checkedRect?.left ?? activeRect.left,
                width: checkedRect?.width ?? activeRect.width,
                height: checkedRect?.height ?? activeRect.height,
              }}
              animate={{
                opacity: 1,
                top: activeRect.top,
                left: activeRect.left,
                width: activeRect.width,
                height: activeRect.height,
              }}
              exit={{ opacity: 0, transition: spring.fast.exit }}
              transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
            />
          ) : null}
        </AnimatePresence>

        {children}
      </div>
    </ProximityContext.Provider>
  );
}
