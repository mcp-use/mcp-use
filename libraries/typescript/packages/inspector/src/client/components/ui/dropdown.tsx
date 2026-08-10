"use client";

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type ComponentProps,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu } from "@base-ui/react/menu";
import {
  DropdownContext,
  type MenuItemRenderOptions,
} from "@/client/components/ui/menu-item";
import { cn } from "@/client/lib/utils";
import { spring, exitFallbackMs } from "@/client/lib/springs";
import { useProximityHover } from "@/client/hooks/use-proximity-hover";
import { shapeMap } from "@/client/lib/shape-context";
import { Elevated } from "@/client/lib/elevated";

// Dropdown opts out of the global pill/rounded shape context — popover surfaces
// look cleaner with the smaller "rounded" radii regardless of how the rest of
// the UI is shaped (the heavy pill bubbling distorts perceived padding at this
// scale and produces the corner-shadow asymmetry).
const shape = shapeMap.rounded;

// ---------------------------------------------------------------------------
// Panel context — shared by the inline Dropdown and the popup DropdownContent.
//
// The context object itself lives in menu-item.tsx so MenuItem resolves
// whichever dropdown provider actually wraps it, even when dropdowns built
// on different primitives render side by side. Re-exported here so the
// public dropdown API is unchanged.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dropdown (inline panel)
//
// An always-rendered panel — no trigger, positioning, or dismissal. Because it
// sits statically in the page it does NOT claim popup menu semantics: the
// container is a plain role="group" (pass `aria-label` to name it). The real
// role="menu" lives on the popup DropdownContent below, which Base UI wires to
// a trigger. Consumers who hand-roll a trigger around the inline panel get
// grouping semantics rather than a falsely-announced popup menu.
// ---------------------------------------------------------------------------

interface DropdownProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  checkedIndex?: number;
}

const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(
  ({ children, checkedIndex, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;
    const checkedRect = checkedIndex != null ? itemRects[checkedIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    const isHoveringOther =
      activeIndex !== null && activeIndex !== checkedIndex;

    return (
      <DropdownContext.Provider
        value={{ registerItem, activeIndex, checkedIndex }}
      >
        <Elevated
          offset={2}
          shadowLevel={3}
          ref={(node) => {
            (
              containerRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
            if (typeof ref === "function") ref(node);
            else if (ref)
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node;
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onFocus={(e) => {
            const indexAttr = (e.target as HTMLElement)
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setActiveIndex(idx);
              setFocusedIndex(
                (e.target as HTMLElement).matches(":focus-visible") ? idx : null
              );
            }
          }}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            setFocusedIndex(null);
            setActiveIndex(null);
          }}
          onKeyDown={(e) => {
            const items = Array.from(
              containerRef.current?.querySelectorAll(
                '[role="menuitem"], [role="menuitemradio"]'
              ) ?? []
            ) as HTMLElement[];
            const currentIdx = items.indexOf(e.target as HTMLElement);
            if (currentIdx === -1) return;

            if (
              ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(
                e.key
              )
            ) {
              e.preventDefault();
              const next = ["ArrowDown", "ArrowRight"].includes(e.key)
                ? (currentIdx + 1) % items.length
                : (currentIdx - 1 + items.length) % items.length;
              items[next].focus();
            } else if (e.key === "Home") {
              e.preventDefault();
              items[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              items[items.length - 1]?.focus();
            }
          }}
          role="group"
          className={cn(
            `relative flex flex-col gap-0.5 w-72 max-w-full ${shape.container} p-1 select-none`,
            className
          )}
          {...props}
        >
          {/* Selected background */}
          <AnimatePresence>
            {checkedRect && (
              <motion.div
                className={`absolute ${shape.bg} bg-active pointer-events-none`}
                initial={false}
                animate={{
                  top: checkedRect.top,
                  left: checkedRect.left,
                  width: checkedRect.width,
                  height: checkedRect.height,
                  opacity: isHoveringOther ? 0.8 : 1,
                }}
                exit={{ opacity: 0, transition: spring.moderate.exit }}
                transition={{
                  ...spring.moderate,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Hover background */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className={`absolute ${shape.bg} bg-hover pointer-events-none`}
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
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Focus ring */}
          <AnimatePresence>
            {focusRect && (
              <motion.div
                className={`absolute ${shape.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
                initial={false}
                animate={{
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                  height: focusRect.height + 4,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {children}
        </Elevated>
      </DropdownContext.Provider>
    );
  }
);

Dropdown.displayName = "Dropdown";

// ---------------------------------------------------------------------------
// DropdownMenu (popup root)
//
// Built on Base UI's Menu primitive, which owns the trigger wiring,
// positioning (collision flipping, anchor tracking), dismissal (outside
// press, focus-out, Escape), roving highlight, typeahead, and close-on-select.
// This layer keeps the proximity-hover overlays and the
// spring open/close animation (via actionsRef deferred unmount) — the same
// verified pattern as select.tsx.
// ---------------------------------------------------------------------------

interface DropdownMenuActions {
  unmount: () => void;
  close: () => void;
}

interface DropdownMenuContextValue {
  open: boolean;
  actionsRef: React.RefObject<DropdownMenuActions | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
  null
);

function useDropdownMenuContext() {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx)
    throw new Error(
      "DropdownMenu compound components must be inside <DropdownMenu>"
    );
  return ctx;
}

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

function DropdownMenu({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : internalOpen;
  const actionsRef = useRef<DropdownMenuActions | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange]
  );

  const ctx = useMemo(() => ({ open, actionsRef }), [open]);

  return (
    <DropdownMenuContext.Provider value={ctx}>
      <Menu.Root
        open={open}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef}
        disabled={disabled}
        // Non-modal: the page keeps scrolling and the Positioner tracks the
        // anchor, so the popup follows its trigger instead of detaching.
        modal={false}
      >
        {children}
      </Menu.Root>
    </DropdownMenuContext.Provider>
  );
}

DropdownMenu.displayName = "DropdownMenu";

// ---------------------------------------------------------------------------
// DropdownTrigger
//
// Base UI's Menu.Trigger, re-exported under the library name. Composes via
// the `render` prop, so any element can be the trigger:
//
//   <DropdownTrigger render={<Button variant="secondary">Open</Button>} />
// ---------------------------------------------------------------------------

const DropdownTrigger = Menu.Trigger;

// ---------------------------------------------------------------------------
// DropdownContent (popup panel)
//
// Portal > Positioner > Popup carrying the exact inline-panel visuals:
// Elevated surface, proximity-hover overlays, animated selected background,
// and animated focus ring. Children are wrapped in a Menu.RadioGroup so
// radio-style MenuItems (boolean `checked`) get correct aria-checked from
// `checkedIndex`.
// ---------------------------------------------------------------------------

type MenuPositionerProps = ComponentProps<typeof Menu.Positioner>;

interface DropdownContentProps {
  children: ReactNode;
  className?: string;
  /** Index of the checked item. Drives the animated selected background and
   *  the radio-group value announced to assistive tech. */
  checkedIndex?: number;
  side?: MenuPositionerProps["side"];
  align?: MenuPositionerProps["align"];
  sideOffset?: number;
}

const DropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(
  (
    {
      className,
      children,
      checkedIndex,
      side = "bottom",
      align = "start",
      sideOffset = 6,
    },
    ref
  ) => {
    const { open, actionsRef } = useDropdownMenuContext();
    const containerRef = useRef<HTMLDivElement>(null);

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    // Release Base UI's deferred unmount once the exit tween has played.
    // onAnimationComplete on the motion.div is the primary signal; this
    // timeout is a fallback for throttled/background tabs where rAF-driven
    // animation callbacks can stall. The popup exits with spring.fast, so the
    // fallback tracks that tier's exit duration plus a safety buffer.
    useEffect(() => {
      if (open) return;
      const id = setTimeout(
        () => actionsRef.current?.unmount(),
        exitFallbackMs(spring.fast)
      );
      return () => clearTimeout(id);
    }, [open, actionsRef]);

    // Measure items once the popup has mounted.
    useEffect(() => {
      if (!open) return;
      // Double rAF: first waits for React commit, second for layout
      let inner: number;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          measureItems();
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [open, measureItems]);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;
    const checkedRect = checkedIndex != null ? itemRects[checkedIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    const isHoveringOther =
      activeIndex !== null && activeIndex !== checkedIndex;

    // Inside the popup, Base UI's Menu.Item / Menu.RadioItem own the role,
    // aria-checked, tabIndex, roving highlight, typeahead, and Enter/Space/
    // click activation (activation synthesizes a click, so the row div's
    // onClick also fires for keyboard). The render div carries the Fluid
    // Functionalism visuals and the proximity-hover registration.
    const renderMenuItem = useCallback(
      ({
        radio,
        value,
        disabled,
        label,
        closeOnClick,
        element,
        children,
      }: MenuItemRenderOptions) =>
        radio ? (
          <Menu.RadioItem
            value={value}
            disabled={disabled}
            label={label}
            closeOnClick={closeOnClick}
            render={element}
          >
            {children}
          </Menu.RadioItem>
        ) : (
          <Menu.Item
            disabled={disabled}
            label={label}
            closeOnClick={closeOnClick}
            render={element}
          >
            {children}
          </Menu.Item>
        ),
      []
    );

    const contentCtx = useMemo(
      () => ({
        registerItem,
        activeIndex,
        checkedIndex,
        inMenu: true,
        renderMenuItem,
      }),
      [registerItem, activeIndex, checkedIndex, renderMenuItem]
    );

    return (
      <Menu.Portal>
        <Menu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-50 outline-none"
        >
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
            animate={
              open
                ? { opacity: 1, y: 0, scaleY: 1 }
                : { opacity: 0, y: -4, scaleY: 0.96 }
            }
            transition={open ? spring.fast : spring.fast.exit}
            style={{ transformOrigin: "top center" }}
            // Base UI defers unmount while actionsRef is set; release it once
            // the exit spring has finished so the close animation fully plays.
            onAnimationComplete={() => {
              if (!open) actionsRef.current?.unmount();
            }}
          >
            <DropdownContext.Provider value={contentCtx}>
              <Menu.Popup
                render={
                  <Elevated
                    offset={2}
                    shadowLevel={3}
                    ref={(node: HTMLDivElement | null) => {
                      (
                        containerRef as React.MutableRefObject<HTMLDivElement | null>
                      ).current = node;
                      if (typeof ref === "function") ref(node);
                      else if (ref)
                        (
                          ref as React.MutableRefObject<HTMLDivElement | null>
                        ).current = node;
                    }}
                  />
                }
                onMouseEnter={() => {
                  handlers.onMouseEnter();
                  setFocusedIndex(null);
                }}
                onMouseMove={handlers.onMouseMove}
                onMouseLeave={handlers.onMouseLeave}
                onFocus={(e) => {
                  const indexAttr = (e.target as HTMLElement)
                    .closest("[data-proximity-index]")
                    ?.getAttribute("data-proximity-index");
                  if (indexAttr != null) {
                    const idx = Number(indexAttr);
                    setActiveIndex(idx);
                    setFocusedIndex(
                      (e.target as HTMLElement).matches(":focus-visible")
                        ? idx
                        : null
                    );
                  }
                }}
                onBlur={(e) => {
                  if (containerRef.current?.contains(e.relatedTarget as Node))
                    return;
                  setFocusedIndex(null);
                  setActiveIndex(null);
                }}
                className={cn(
                  // min-w tracks the trigger via the Positioner's
                  // --anchor-width var.
                  `relative flex flex-col gap-0.5 w-72 max-w-full min-w-[var(--anchor-width)] max-h-[min(480px,var(--available-height))] overflow-y-auto ${shape.container} p-1 select-none outline-none`,
                  className
                )}
              >
                {/* Selected background */}
                <AnimatePresence>
                  {checkedRect && (
                    <motion.div
                      className={`absolute ${shape.bg} bg-active pointer-events-none`}
                      initial={false}
                      animate={{
                        top: checkedRect.top,
                        left: checkedRect.left,
                        width: checkedRect.width,
                        height: checkedRect.height,
                        opacity: isHoveringOther ? 0.8 : 1,
                      }}
                      exit={{ opacity: 0, transition: spring.moderate.exit }}
                      transition={{
                        ...spring.moderate,
                        opacity: { duration: 0.08 },
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Hover background */}
                <AnimatePresence>
                  {activeRect && (
                    <motion.div
                      key={sessionRef.current}
                      className={`absolute ${shape.bg} bg-hover pointer-events-none`}
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
                      transition={{
                        ...spring.fast,
                        opacity: { duration: 0.08 },
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Focus ring */}
                <AnimatePresence>
                  {focusRect && (
                    <motion.div
                      className={`absolute ${shape.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
                      initial={false}
                      animate={{
                        left: focusRect.left - 2,
                        top: focusRect.top - 2,
                        width: focusRect.width + 4,
                        height: focusRect.height + 4,
                      }}
                      exit={{ opacity: 0, transition: spring.fast.exit }}
                      transition={{
                        ...spring.fast,
                        opacity: { duration: 0.08 },
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* display: contents keeps items direct flex children of the
                    popup so proximity measurement and gap layout still work,
                    while the group provides the radio value context. */}
                {checkedIndex != null ? (
                  <Menu.RadioGroup value={checkedIndex} className="contents">
                    {children}
                  </Menu.RadioGroup>
                ) : (
                  children
                )}
              </Menu.Popup>
            </DropdownContext.Provider>
          </motion.div>
        </Menu.Positioner>
      </Menu.Portal>
    );
  }
);

DropdownContent.displayName = "DropdownContent";

// ---------------------------------------------------------------------------
// DropdownLabel
// ---------------------------------------------------------------------------

const DropdownLabel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-2 py-1.5 text-[11px] text-muted-foreground", className)}
    {...props}
  />
));

DropdownLabel.displayName = "DropdownLabel";

// ---------------------------------------------------------------------------
// DropdownSeparator
// ---------------------------------------------------------------------------

const DropdownSeparator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    className={cn("my-1 -mx-1 h-px bg-border/60", className)}
    {...props}
  />
));

DropdownSeparator.displayName = "DropdownSeparator";

export {
  DropdownLabel,
  DropdownSeparator,
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
};
