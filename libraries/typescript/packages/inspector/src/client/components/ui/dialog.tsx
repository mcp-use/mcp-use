"use client";

import { Button } from "@/client/components/ui/button";
import { useIcon } from "@/client/lib/icon-context";
import { useShape } from "@/client/lib/shape-context";
import { spring } from "@/client/lib/springs";
import { surfaceClasses } from "@/client/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@/client/lib/surface-context";
import { cn } from "@/client/lib/utils";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const DIALOG_OFFSET = 4;
const STICKY_HEADER_H = "h-14";

const DialogChromeContext = createContext<{
  scrollable: boolean;
  setStickyHeader: (value: boolean) => void;
} | null>(null);

function DialogCloseButton({ className }: { className?: string }) {
  const XIcon = useIcon("x");
  return (
    <DialogPrimitive.Close
      render={
        <Button variant="ghost" size="icon-sm" className={className}>
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      }
    />
  );
}

interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

function Dialog({
  children,
  open,
  defaultOpen,
  onOpenChange,
  modal,
}: DialogProps) {
  // Base UI's Root handles controlled/uncontrolled state internally. We only
  // narrow the (open, eventDetails) callback to (open) for our public prop.
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => onOpenChange?.(next)}
      modal={modal}
    >
      {children}
    </DialogPrimitive.Root>
  );
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "lg";
  /** Scrollable panel: p-0 flex column; pad header/body/footer instead of the shell. */
  scrollable?: boolean;
  /** Portal target. When set, the overlay and panel render inside this element
   *  (positioned `absolute`) instead of covering the viewport (`fixed`). Pair
   *  with a `position: relative; overflow: hidden` container — and usually
   *  `<Dialog modal={false}>` — to scope a dialog to a bounded region, e.g. a
   *  docs preview. Defaults to the document body / full-viewport behaviour. */
  container?: HTMLElement | null;
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, size = "sm", scrollable = false, container, ...props }, ref) => {
    const shape = useShape();
    const substrate = useSurface();
    const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);
    const [hasStickyHeader, setHasStickyHeader] = useState(false);
    const setStickyHeader = useCallback((value: boolean) => {
      setHasStickyHeader(value);
    }, []);

    // No `if (!open) return null` here — Base UI's `<DialogPrimitive.Popup>`
    // handles mount/unmount itself, and waits for the framer-motion opacity
    // tween below to finish (via `element.getAnimations()`) before unmounting.
    // Returning null early would short-circuit the closing animation.
    return (
      <DialogPrimitive.Portal container={container ?? undefined}>
        <DialogPrimitive.Backdrop
          render={(backdropProps, state) => {
            const exiting = state.transitionStatus === "ending";
            const {
              style: _style,
              onDrag: _onDrag,
              onDragStart: _onDragStart,
              onDragEnd: _onDragEnd,
              onAnimationStart: _onAnimationStart,
              onAnimationEnd: _onAnimationEnd,
              onAnimationIteration: _onAnimationIteration,
              ...rest
            } = backdropProps as React.HTMLAttributes<HTMLDivElement>;
            return (
              <motion.div
                {...rest}
                className={cn(
                  container ? "absolute" : "fixed",
                  "inset-0 z-50 bg-black/40 dark:bg-black/80"
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: exiting ? 0 : 1 }}
                transition={exiting ? spring.slow.exit : spring.slow}
              />
            );
          }}
        />
        <DialogPrimitive.Popup
          ref={ref}
          render={(popupProps, state) => {
            const exiting = state.transitionStatus === "ending";
            const {
              style: baseStyle,
              onDrag: _onDrag,
              onDragStart: _onDragStart,
              onDragEnd: _onDragEnd,
              onAnimationStart: _onAnimationStart,
              onAnimationEnd: _onAnimationEnd,
              onAnimationIteration: _onAnimationIteration,
              ...rest
            } = popupProps as React.HTMLAttributes<HTMLDivElement>;
            return (
              <motion.div
                // Base UI's props first (data attrs, refs, role, etc.)…
                {...rest}
                // …then the consumer's `<DialogContent>` props (className,
                // event handlers, data-*, etc.) land on the visible motion.div.
                {...(props as Omit<
                  React.HTMLAttributes<HTMLDivElement>,
                  | "onDrag"
                  | "onDragStart"
                  | "onDragEnd"
                  | "onAnimationStart"
                  | "onAnimationEnd"
                  | "onAnimationIteration"
                >)}
                className={cn(
                  container ? "absolute" : "fixed",
                  "left-1/2 top-1/2 z-50 w-[calc(100%-2rem)]",
                  surfaceClasses(dialogLevel),
                  "p-6 focus:outline-none",
                  size === "sm" && "max-w-[400px]",
                  size === "lg" && "max-w-[540px]",
                  shape.container,
                  scrollable && "flex flex-col overflow-hidden p-0",
                  className
                )}
                style={{
                  ...(baseStyle as React.CSSProperties | undefined),
                  ...(props.style as React.CSSProperties | undefined),
                }}
                initial={{ opacity: 0, scale: 0.97, x: "-50%", y: "-50%" }}
                animate={{
                  opacity: exiting ? 0 : 1,
                  scale: exiting ? 0.97 : 1,
                  x: "-50%",
                  y: "-50%",
                }}
                transition={exiting ? spring.slow.exit : spring.slow}
              >
                <SurfaceProvider value={dialogLevel}>
                  <DialogChromeContext.Provider
                    value={{ scrollable, setStickyHeader }}
                  >
                    {children}
                    {!hasStickyHeader && (
                      <DialogCloseButton className="absolute right-3 top-3 z-20" />
                    )}
                  </DialogChromeContext.Provider>
                </SurfaceProvider>
              </motion.div>
            );
          }}
        />
      </DialogPrimitive.Portal>
    );
  }
);
DialogContent.displayName = "DialogContent";

interface DialogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  sticky?: boolean;
}

function DialogHeader({ className, sticky, children, ...props }: DialogHeaderProps) {
  const chrome = useContext(DialogChromeContext);

  useLayoutEffect(() => {
    if (!sticky) return;
    chrome?.setStickyHeader(true);
    return () => chrome?.setStickyHeader(false);
  }, [sticky, chrome]);

  if (sticky) {
    return (
      <div
        className={cn(
          "sticky top-0 z-10 mb-0 flex shrink-0 items-center gap-2 border-b border-border/50 bg-white/50 px-6 backdrop-blur-xs dark:bg-black/50",
          STICKY_HEADER_H,
          className
        )}
        {...props}
      >
        {children}
        <DialogCloseButton className="ml-auto shrink-0" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-1.5",
        chrome?.scrollable && "px-6 pt-6",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const chrome = useContext(DialogChromeContext);

  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto overscroll-none pt-2",
        chrome?.scrollable ? "px-6 pb-6" : "-mx-6 px-6",
        className
      )}
      {...props}
    />
  );
}

interface DialogJsonSectionProps extends HTMLAttributes<HTMLDivElement> {
  onCopy?: () => void | Promise<void>;
}

function DialogJsonSection({
  className,
  onCopy,
  children,
  ...props
}: DialogJsonSectionProps) {
  const CopyIcon = useIcon("copy");
  const CheckIcon = useIcon("check");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!onCopy) return;
    try {
      await onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ponytail: caller handles toasts if needed
    }
  };

  return (
    <div
      className={cn(
        "group/json relative -mx-6 bg-muted/20 px-6 pt-6 pb-4",
        className
      )}
      {...props}
    >
      {onCopy ? (
        <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/json:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            title="Copy"
          >
            {copied ? (
              <CheckIcon className="text-green-600" />
            ) : (
              <CopyIcon />
            )}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const chrome = useContext(DialogChromeContext);

  return (
    <div
      className={cn(
        "mt-6 flex justify-end gap-2",
        chrome?.scrollable && "px-6 pb-6",
        className
      )}
      {...props}
    />
  );
}

const DialogTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("m-0 text-[16px] leading-none text-foreground", className)}
    style={{ fontVariationSettings: "'wght' 700" }}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogJsonSection, DialogTitle, DialogTrigger
};

