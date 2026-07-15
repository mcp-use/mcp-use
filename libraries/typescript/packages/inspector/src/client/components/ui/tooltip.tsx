"use client";

import * as React from "react";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { motion } from "motion/react";
import { cn } from "@/client/lib/utils";
import { spring } from "@/client/lib/springs";
import { fontWeights } from "@/client/lib/font-weight";
import { useShape } from "@/client/lib/shape-context";

// ---------------------------------------------------------------------------
// Portal container context
// ---------------------------------------------------------------------------

const TooltipPortalContainerContext = createContext<HTMLElement | null>(null);

function TooltipPortalContainer({
  value,
  children,
}: {
  value: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <TooltipPortalContainerContext.Provider value={value}>
      {children}
    </TooltipPortalContainerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEFAULT_DELAY = 200;

// Tracks whether an app-level <TooltipProvider> is above us. Each Tooltip
// only wraps itself in a local primitive Provider when there isn't one —
// a per-instance Provider would defeat cross-tooltip skip-delay grouping
// (moving between adjacent tooltips would re-wait the full delay).
const TooltipGroupContext = createContext(false);

interface TooltipProviderProps {
  children: ReactNode;
  /** Hover delay before tooltips open, in ms. Defaults to 200. */
  delayDuration?: number;
  /** After a tooltip closes, adjacent tooltips opened within this window
   *  skip the hover delay, in ms. Defaults to 300. */
  skipDelayDuration?: number;
}

/** Groups descendant Tooltips so that once one opens, moving to an adjacent
 *  trigger shows its tooltip instantly instead of re-waiting the full delay.
 *  Wrap once at the app (or section) level; bare Tooltips still work without
 *  it via a per-instance fallback. */
function TooltipProvider({
  children,
  delayDuration = DEFAULT_DELAY,
  skipDelayDuration = 300,
}: TooltipProviderProps) {
  return (
    <TooltipGroupContext.Provider value={true}>
      <TooltipPrimitive.Provider
        delay={delayDuration}
        timeout={skipDelayDuration}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipGroupContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  sideOffset?: number;
  /** Hover delay before this tooltip opens, in ms. Defaults to 200, or to the
   *  ambient TooltipProvider's delayDuration when one is present. */
  delayDuration?: number;
  className?: string;
  /** When true, forces the tooltip open. When false, forces it closed. When undefined, uses default hover/focus behavior. */
  forceOpen?: boolean;
  /** Called when the tooltip's internal open state changes (before forceOpen is applied). */
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

function getSlideOffset(side: TooltipSide) {
  switch (side) {
    case "top":
      return { y: 4 };
    case "bottom":
      return { y: -4 };
    case "left":
      return { x: 4 };
    case "right":
      return { x: -4 };
  }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function FluidTooltip({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delayDuration,
  className,
  forceOpen,
  onOpenChange: onOpenChangeProp,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = forceOpen !== undefined ? forceOpen : internalOpen;
  const shape = useShape();
  const portalContainer = useContext(TooltipPortalContainerContext);
  const hasAmbientProvider = useContext(TooltipGroupContext);

  const slideOffset = getSlideOffset(side);

  const tooltip = (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        setInternalOpen(v);
        onOpenChangeProp?.(v);
      }}
    >
      {/* An explicit delayDuration overrides the ambient provider's delay;
          left undefined, the trigger inherits it from the provider. */}
      <TooltipPrimitive.Trigger render={children} delay={delayDuration} />
      <TooltipPrimitive.Portal container={portalContainer ?? undefined}>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          className="z-50"
        >
          <TooltipPrimitive.Popup
            render={(props, state) => {
              const exiting = state.transitionStatus === "ending";
              const {
                style: baseStyle,
                // motion.div has incompatible drag/animation event signatures —
                // strip the React-DOM versions so they don't fight motion's own.
                onDrag: _onDrag,
                onDragStart: _onDragStart,
                onDragEnd: _onDragEnd,
                onAnimationStart: _onAnimationStart,
                onAnimationEnd: _onAnimationEnd,
                onAnimationIteration: _onAnimationIteration,
                ...rest
              } = props as React.HTMLAttributes<HTMLDivElement>;
              return (
                <motion.div
                  {...rest}
                  className={cn(
                    // Trim recenters the label; the padding bump only applies
                    // where text-box is supported, keeping the same overall
                    // height (~26px) as untrimmed browsers.
                    "bg-foreground text-background text-[12px] px-2 py-1",
                    "[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both]:py-2",
                    shape.bg,
                    className
                  )}
                  style={{
                    ...(baseStyle as React.CSSProperties | undefined),
                    fontVariationSettings: fontWeights.medium,
                  }}
                  initial={{ opacity: 0, ...slideOffset }}
                  animate={
                    exiting
                      ? { opacity: 0, ...slideOffset }
                      : { opacity: 1, x: 0, y: 0 }
                  }
                  transition={exiting ? spring.fast.exit : spring.fast}
                />
              );
            }}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );

  // Fallback: without an ambient TooltipProvider, give this instance its own
  // so a bare <Tooltip> keeps the library's default delay. Grouped skip-delay
  // needs the shared app-level TooltipProvider.
  if (hasAmbientProvider) return tooltip;

  return (
    <TooltipPrimitive.Provider delay={delayDuration ?? DEFAULT_DELAY}>
      {tooltip}
    </TooltipPrimitive.Provider>
  );
}

export { FluidTooltip, TooltipPortalContainer, TooltipProvider };
export type { TooltipProps, TooltipProviderProps, TooltipSide };

// ---------------------------------------------------------------------------
// shadcn-compatible compound API (Tooltip > TooltipTrigger + TooltipContent)
// ---------------------------------------------------------------------------

type TooltipTriggerProps = {
  render: React.ReactElement;
  nativeButton?: boolean;
};

type TooltipContentProps = {
  children?: React.ReactNode;
  side?: TooltipSide;
  className?: string;
  sideOffset?: number;
};

function TooltipTrigger(_props: TooltipTriggerProps) {
  return null;
}
TooltipTrigger.displayName = "TooltipTrigger";

function TooltipContent(_props: TooltipContentProps) {
  return null;
}
TooltipContent.displayName = "TooltipContent";

function TooltipCompound({
  children,
  delayDuration,
  open,
  onOpenChange,
}: {
  children: React.ReactNode;
  delayDuration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  let trigger: React.ReactElement | null = null;
  let content: React.ReactNode = null;
  let side: TooltipSide = "top";
  let className: string | undefined;
  let sideOffset: number | undefined;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === TooltipTrigger) {
      const props = child.props as TooltipTriggerProps;
      trigger = props.render;
    }
    if (child.type === TooltipContent) {
      const props = child.props as TooltipContentProps;
      content = props.children;
      side = props.side ?? "top";
      className = props.className;
      sideOffset = props.sideOffset;
    }
  });

  if (!trigger) {
    return <>{children}</>;
  }

  return (
    <FluidTooltip
      content={content}
      side={side}
      sideOffset={sideOffset}
      className={className}
      delayDuration={delayDuration}
      forceOpen={open}
      onOpenChange={onOpenChange}
    >
      {trigger}
    </FluidTooltip>
  );
}

export {
  TooltipCompound as Tooltip,
  TooltipTrigger,
  TooltipContent,
};
