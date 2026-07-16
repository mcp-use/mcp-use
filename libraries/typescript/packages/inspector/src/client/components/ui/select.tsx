"use client";

import {
  Children,
  forwardRef,
  isValidElement,
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  createContext,
  useContext,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { cva, type VariantProps } from "class-variance-authority";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { IconComponent } from "@/client/lib/icon-context";
import { cn } from "@/client/lib/utils";
import { spring, exitFallbackMs } from "@/client/lib/springs";
import { useProximityHover } from "@/client/hooks/use-proximity-hover";
import { useShape } from "@/client/lib/shape-context";
import { Elevated } from "@/client/lib/elevated";

// ---------------------------------------------------------------------------
// Select context
//
// Built on Base UI's Select primitive, which owns positioning (collision
// flipping, anchor tracking), dismissal (outside press, focus-out, Escape
// nesting inside dialogs), list keyboard navigation + typeahead, combobox
// ARIA, and the hidden form input. This layer keeps the
// proximity-hover overlays, the spring open/close animation (via actionsRef
// deferred unmount), and the animated checkmark.
// ---------------------------------------------------------------------------

interface SelectContextValue {
  value: string;
  open: boolean;
  actionsRef: React.RefObject<{ unmount: () => void } | null>;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("Select compound components must be inside <Select>");
  return ctx;
}

// Content context for proximity hover
interface SelectContentContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
  checkedIndex?: number;
}

const SelectContentContext =
  createContext<SelectContentContextValue | null>(null);

// ---------------------------------------------------------------------------
// Select (root)
// ---------------------------------------------------------------------------

interface SelectProps {
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  required?: boolean;
}

/**
 * Walk the children tree collecting `{ value, label }` pairs from SelectItem
 * elements. Passed to Base UI's `items` prop so the trigger can resolve the
 * label of an initial value before the popup has ever mounted (items only
 * render while open). Non-string labels fall back to the raw value, matching
 * the previous labelMap behaviour.
 */
function collectSelectItems(
  node: ReactNode,
  out: { value: string; label: ReactNode }[] = []
) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: unknown;
      label?: string;
      children?: ReactNode;
    };
    if (typeof props.value === "string") {
      out.push({
        value: props.value,
        label:
          props.label ??
          (typeof props.children === "string" ? props.children : props.value),
      });
    } else if (props.children) {
      collectSelectItems(props.children, out);
    }
  });
  return out;
}

function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  name,
  required,
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const actionsRef = useRef<{ unmount: () => void } | null>(null);
  const currentValue = value !== undefined ? value : internalValue;

  const items = useMemo(() => collectSelectItems(children), [children]);

  const handleValueChange = useCallback(
    (next: string | null) => {
      const v = next ?? "";
      if (value === undefined) setInternalValue(v);
      onValueChange?.(v);
    },
    [value, onValueChange]
  );

  const ctx = useMemo(
    () => ({ value: currentValue, open, actionsRef }),
    [currentValue, open]
  );

  return (
    <SelectContext.Provider value={ctx}>
      <SelectPrimitive.Root
        // Always controlled; "" (no selection) maps to Base UI's null.
        value={currentValue === "" ? null : currentValue}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={setOpen}
        actionsRef={actionsRef}
        items={items}
        disabled={disabled}
        name={name}
        required={required}
        // Non-modal: the page keeps scrolling and the Positioner tracks the
        // anchor, so the popup follows its trigger instead of detaching.
        modal={false}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectContext.Provider>
  );
}

Select.displayName = "Select";

// ---------------------------------------------------------------------------
// SelectTrigger
// ---------------------------------------------------------------------------

const triggerVariants = cva(
  [
    "group inline-flex items-center justify-between gap-2 outline-none cursor-pointer",
    "text-[13px] h-9 px-3 min-w-[160px]",
    "transition-all duration-80",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
  ],
  {
    variants: {
      variant: {
        bordered:
          "border border-border bg-transparent text-foreground hover:bg-hover",
        borderless:
          "border border-transparent bg-transparent text-foreground hover:bg-hover",
      },
    },
    defaultVariants: {
      variant: "bordered",
    },
  }
);

interface SelectTriggerProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof triggerVariants> {
  icon?: IconComponent;
  /** Non-lucide adornment (e.g. provider logo) shown before the value. */
  leading?: ReactNode;
  placeholder?: string;
  error?: string;
}

const SelectTriggerBase = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (
    {
      className,
      variant,
      icon: Icon,
      leading,
      placeholder = "Select…",
      error,
      ...props
    },
    ref
  ) => {
    const shape = useShape();

    return (
      <div className="flex flex-col gap-1">
        <SelectPrimitive.Trigger
          ref={ref}
          aria-invalid={!!error || undefined}
          className={cn(
            triggerVariants({ variant }),
            shape.input,
            error && "border-destructive/50 hover:border-destructive/50",
            className
          )}
          {...props}
        >
          <span className="flex items-center gap-2 min-w-0 flex-1">
            {leading}
            {!leading && Icon && (
              <Icon
                size={16}
                strokeWidth={1.5}
                className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-hover:text-foreground group-hover:stroke-[2]"
              />
            )}
            <SelectPrimitive.Value
              placeholder={placeholder}
              // py-1/-my-1: truncate's overflow:hidden clips at the padding
              // box, and the trimmed box excludes ascenders/descenders — the
              // padding gives glyphs room while the negative margin keeps the
              // trimmed layout box.
              className="min-w-0 flex-1 text-left truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1 data-[placeholder]:text-muted-foreground"
            />
          </span>

          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </SelectPrimitive.Trigger>
        {error && (
          <span className="text-[12px] text-destructive pl-3">{error}</span>
        )}
      </div>
    );
  }
);

SelectTriggerBase.displayName = "SelectTrigger";

// ---------------------------------------------------------------------------
// SelectContent
// ---------------------------------------------------------------------------

interface SelectContentProps {
  className?: string;
  children: ReactNode;
}

const SelectContentBase = forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children }, ref) => {
    const { open, value, actionsRef } = useSelectContext();
    const shape = useShape();
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
    const [checkedIndex, setCheckedIndex] = useState<number | undefined>(
      undefined
    );

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

    // Measure items + detect the checked row once the popup has mounted.
    useEffect(() => {
      if (!open) return;
      // Double rAF: first waits for React commit, second for layout
      let inner: number;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          measureItems();
          const container = containerRef.current;
          if (container) {
            const items = Array.from(
              container.querySelectorAll("[data-proximity-index]")
            ) as HTMLElement[];
            const idx = items.findIndex(
              (el) => el.getAttribute("data-value") === value
            );
            setCheckedIndex(idx !== -1 ? idx : undefined);
          }
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [open, measureItems, value]);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;
    const checkedRect = checkedIndex != null ? itemRects[checkedIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    const isHoveringOther =
      activeIndex !== null && activeIndex !== checkedIndex;

    const contentCtx = useMemo(
      () => ({ registerItem, activeIndex, checkedIndex }),
      [registerItem, activeIndex, checkedIndex]
    );

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
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
            <SelectContentContext.Provider value={contentCtx}>
              <SelectPrimitive.Popup
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
                  // min-w tracks the trigger via the Positioner's --anchor-width
                  // var, matching the pre-migration minWidth: triggerRect.width.
                  `relative flex flex-col gap-0.5 min-w-[var(--anchor-width)] max-h-[min(300px,var(--available-height))] overflow-y-auto ${shape.container} p-1 select-none outline-none`,
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

                {children}
              </SelectPrimitive.Popup>
            </SelectContentContext.Provider>
          </motion.div>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    );
  }
);

SelectContentBase.displayName = "SelectContent";

// ---------------------------------------------------------------------------
// SelectItem
// ---------------------------------------------------------------------------

interface SelectItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: IconComponent;
  index: number;
  value: string;
  disabled?: boolean;
}

const SelectItemBase = forwardRef<HTMLDivElement, SelectItemProps>(
  (
    {
      className,
      children,
      icon: Icon,
      value,
      index,
      disabled = false,
      ...props
    },
    ref
  ) => {
    const selectCtx = useSelectContext();
    const contentCtx = useContext(SelectContentContext);
    const internalRef = useRef<HTMLDivElement>(null);
    const shape = useShape();
    const hasMounted = useRef(false);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    // Register with proximity hover
    useEffect(() => {
      contentCtx?.registerItem(index, internalRef.current);
      return () => contentCtx?.registerItem(index, null);
    }, [index, contentCtx]);

    const isActive = contentCtx?.activeIndex === index;
    const isChecked = selectCtx.value === value;
    const skipAnimation = !hasMounted.current;

    return (
      <SelectPrimitive.Item
        value={value}
        disabled={disabled}
        label={typeof children === "string" ? children : undefined}
        render={
          <div
            ref={(node: HTMLDivElement | null) => {
              (
                internalRef as React.MutableRefObject<HTMLDivElement | null>
              ).current = node;
              if (typeof ref === "function") ref(node);
              else if (ref)
                (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                  node;
            }}
            data-proximity-index={index}
            data-value={value}
            className={cn(
              // Fixed height (was py-2 around a 19.5px line box ≈ 35.5px) so
              // the text-box trim on the item text doesn't shrink the row.
              `relative z-10 flex h-9 items-center gap-2 ${shape.item} px-2 text-[13px] cursor-pointer outline-none select-none`,
              "transition-[color] duration-80",
              isActive || isChecked
                ? "text-foreground"
                : "text-muted-foreground",
              disabled && "opacity-50 pointer-events-none",
              className
            )}
            {...props}
          />
        }
      >
        {Icon && (
          <Icon
            size={16}
            strokeWidth={isActive || isChecked ? 2 : 1.5}
            className="shrink-0 transition-[color,stroke-width] duration-80"
          />
        )}

        <SelectPrimitive.ItemText
          // py-1/-my-1 keeps truncate's overflow:hidden from clipping
          // ascenders/descenders outside the trimmed box.
          render={<span className="flex-1 min-w-0 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1" />}
        >
          {children}
        </SelectPrimitive.ItemText>

        <AnimatePresence>
          {isChecked && (
            <motion.svg
              key="check"
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-foreground"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 1 }}
            >
              <motion.path
                d="M4 12L9 17L20 6"
                initial={{ pathLength: skipAnimation ? 1 : 0 }}
                animate={{
                  pathLength: 1,
                  transition: { duration: 0.08, ease: "easeOut" },
                }}
                exit={{
                  pathLength: 0,
                  transition: { duration: 0.04, ease: "easeIn" },
                }}
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </SelectPrimitive.Item>
    );
  }
);

SelectItemBase.displayName = "SelectItem";

// ---------------------------------------------------------------------------
// SelectGroup + SelectLabel + SelectSeparator
// ---------------------------------------------------------------------------

function SelectGroup({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="group" className={className} {...props}>
      {children}
    </div>
  );
}

SelectGroup.displayName = "SelectGroup";

const SelectLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "px-2 py-1.5 text-[11px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);

SelectLabel.displayName = "SelectLabel";

const SelectSeparator = forwardRef<
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

SelectSeparator.displayName = "SelectSeparator";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// shadcn-compatible aliases (auto index, SelectValue in trigger children)
// ---------------------------------------------------------------------------

const SelectIndexContext = createContext<{ next: () => number } | null>(null);

function SelectValue({ placeholder: _placeholder }: { placeholder?: string }) {
  return null;
}
SelectValue.displayName = "SelectValue";

function SelectContentShadcn({
  children,
  ...props
}: SelectContentProps) {
  const indexRef = useRef(0);
  const indexApi = useMemo(
    () => ({
      next: () => indexRef.current++,
    }),
    []
  );
  indexRef.current = 0;

  return (
    <SelectIndexContext.Provider value={indexApi}>
      <SelectContentBase {...props}>{children}</SelectContentBase>
    </SelectIndexContext.Provider>
  );
}

function SelectItemShadcn({
  index,
  label: _label,
  children,
  ...props
}: Omit<SelectItemProps, "index"> & { index?: number; label?: string }) {
  const indexCtx = useContext(SelectIndexContext);
  const resolvedIndex = index ?? indexCtx?.next() ?? 0;
  return (
    <SelectItemBase index={resolvedIndex} {...props}>
      {children}
    </SelectItemBase>
  );
}

function SelectTriggerShadcn({
  children,
  placeholder,
  ...props
}: SelectTriggerProps & { children?: ReactNode }) {
  let resolvedPlaceholder = placeholder;
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === SelectValue) {
      const valueProps = child.props as { placeholder?: string };
      resolvedPlaceholder = valueProps.placeholder ?? resolvedPlaceholder;
    }
  });
  return <SelectTriggerBase placeholder={resolvedPlaceholder} {...props} />;
}

export {
  Select,
  SelectContentShadcn as SelectContent,
  SelectItemShadcn as SelectItem,
  SelectTriggerShadcn as SelectTrigger,
  SelectValue,
};
