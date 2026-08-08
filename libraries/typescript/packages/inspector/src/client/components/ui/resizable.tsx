"use client";

import { GripVerticalIcon } from "lucide-react";
import * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/client/lib/utils";

const { usePanelRef } = ResizablePrimitive;

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-50 box-content shrink-0",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        // ponytail: 1px line flush with panels; padding + negative margin = drag slop, no visual gap
        "before:pointer-events-none before:absolute before:bg-zinc-200 before:transition-[height,width,background-color] before:duration-200 before:ease-out dark:before:bg-zinc-700",
        "hover:before:bg-foreground/35 dark:hover:before:bg-foreground/45",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:py-1.5 aria-[orientation=horizontal]:-my-1.5",
        "aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1.5 aria-[orientation=horizontal]:before:h-px",
        "hover:aria-[orientation=horizontal]:before:h-0.5",
        "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-px aria-[orientation=vertical]:px-1.5 aria-[orientation=vertical]:-mx-1.5",
        "aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:left-1.5 aria-[orientation=vertical]:before:w-px",
        "hover:aria-[orientation=vertical]:before:w-0.5",
        "[&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex h-4 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs border border-zinc-200 bg-background shadow-sm dark:border-zinc-700">
          <GripVerticalIcon className="size-2.5 text-muted-foreground" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, usePanelRef };
