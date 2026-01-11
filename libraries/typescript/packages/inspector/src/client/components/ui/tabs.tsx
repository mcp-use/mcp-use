"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

interface TabsContextType {
  activeValue: string;
  handleValueChange: (value: string) => void;
  collapsed: boolean;
  handleCollapsedChange: (collapsed: boolean) => void;
}

const TabsContext = React.createContext<TabsContextType | undefined>(undefined);

function useTabs() {
  const context = React.use(TabsContext);
  if (!context) {
    throw new Error("useTabs must be used within a TabsProvider");
  }
  return context;
}

interface TabsListContextType {
  variant: "default" | "underline";
  collapsed: boolean;
  handleCollapsedChange: (collapsed: boolean) => void;
}

const TabsListContext = React.createContext<TabsListContextType | undefined>(
  undefined
);

function useTabsList() {
  const context = React.use(TabsListContext);
  return context;
}

interface TabsProps {
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function Tabs({
  ref,
  children,
  defaultValue,
  value,
  onValueChange,
  className,
  collapsed: collapsedProp,
  onCollapsedChange,
  ...props
}: TabsProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const [activeValue, setActiveValue] = React.useState(defaultValue || "");
  const isControlled = value !== undefined;
  const isCollapsedControlled = collapsedProp !== undefined;
  const [collapsed, setCollapsed] = React.useState(false);
  const handleValueChange = React.useCallback(
    (val: string) => {
      if (!isControlled) {
        setActiveValue(val);
      }
      onValueChange?.(val);
    },
    [isControlled, onValueChange]
  );

  const currentValue = isControlled ? value : activeValue;
  const currentCollapsed = isCollapsedControlled ? collapsedProp : collapsed;

  const handleCollapsedChange = React.useCallback(
    (collapsed: boolean) => {
      if (!isCollapsedControlled) {
        setCollapsed(collapsed);
      }
      onCollapsedChange?.(collapsed);
    },
    [isCollapsedControlled, onCollapsedChange]
  );

  return (
    <TabsContext
      value={{
        activeValue: currentValue,
        handleValueChange,
        collapsed: currentCollapsed,
        handleCollapsedChange,
      }}
    >
      <div
        ref={ref}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext>
  );
}
Tabs.displayName = "Tabs";

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "underline";
  collapsible?: boolean;
}

function TabsList({
  ref: _ref,
  children,
  className,
  variant = "default",
  collapsible = false,
  ...props
}: TabsListProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const { activeValue, collapsed, handleCollapsedChange } = useTabs();
  const [indicatorStyle, setIndicatorStyle] = React.useState({
    width: 0,
    left: 0,
  });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  // We don't need activeIndex anymore since we use data attributes to find the active tab

  // Debounced update function
  const updateIndicator = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Find the inner div that contains the tabs (excluding the toggle button)
    const tabsContainer = container.querySelector(
      "div:first-child"
    ) as HTMLElement;
    if (!tabsContainer) return;

    // Find the active button by data attribute (works even when wrapped in Tooltip)
    const activeTrigger = tabsContainer.querySelector(
      `button[data-tab-value="${activeValue}"]`
    ) as HTMLElement;

    if (activeTrigger && activeValue) {
      // Use tabsContainer as reference for positioning
      const containerRect = tabsContainer.getBoundingClientRect();
      const triggerRect = activeTrigger.getBoundingClientRect();

      setIndicatorStyle({
        width: triggerRect.width,
        left: triggerRect.left - containerRect.left,
      });
    } else {
      // Reset if no active trigger found
      setIndicatorStyle({ width: 0, left: 0 });
    }
  }, [activeValue]);

  // Debounced version of updateIndicator
  const debouncedUpdateIndicator = React.useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(updateIndicator, 16); // ~60fps
  }, [updateIndicator]);

  // Update indicator when active tab changes or collapsed state changes
  React.useEffect(() => {
    // Use a small delay to ensure DOM is updated
    const timeoutId = setTimeout(updateIndicator, 10);
    return () => clearTimeout(timeoutId);
  }, [updateIndicator, collapsed]);

  // Set up ResizeObserver for the container
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create ResizeObserver to watch for container size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      debouncedUpdateIndicator();
    });

    resizeObserverRef.current.observe(container);

    // Also observe all button elements for size changes (excluding toggle button)
    const tabsContainer = container.querySelector(
      "div:first-child"
    ) as HTMLElement;
    if (tabsContainer) {
      const triggers = tabsContainer.querySelectorAll("button[data-tab-value]");
      triggers.forEach((trigger) => {
        if (resizeObserverRef.current) {
          resizeObserverRef.current.observe(trigger);
        }
      });
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [debouncedUpdateIndicator]);

  // Fallback window resize listener for broader compatibility
  React.useEffect(() => {
    const handleResize = () => {
      debouncedUpdateIndicator();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [debouncedUpdateIndicator]);

  // Apply dynamic styles using inline styles for better reliability
  const indicatorRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (indicatorRef.current) {
      indicatorRef.current.style.width = `${indicatorStyle.width}px`;
      indicatorRef.current.style.left = `${indicatorStyle.left}px`;
    }
  }, [indicatorStyle]);

  return (
    <TabsListContext value={{ variant, collapsed, handleCollapsedChange }}>
      <div
        ref={containerRef}
        className={cn(
          "relative flex items-center bg-none gap-1",
          variant === "default" &&
            "p-1 rounded-full border border-zinc-300 dark:border-zinc-600",
          variant === "underline" &&
            "border-b border-zinc-200 dark:border-zinc-700",
          className
        )}
        {...props}
      >
        <div role="tablist" className="flex-1 flex items-center relative">
          {children}
          <span
            ref={indicatorRef}
            className={cn(
              "absolute transition-all duration-500 ease-in-out z-0",
              variant === "default" &&
                "bg-white dark:bg-zinc-700 rounded-full h-[calc(100%)] top-0 border border-zinc-300 dark:border-zinc-600",
              variant === "underline" && "bottom-0 h-0.5 bg-black dark:bg-white"
            )}
          />
        </div>
      </div>
    </TabsListContext>
  );
}
TabsList.displayName = "TabsList";

interface TabsTriggerProps {
  children: React.ReactNode;
  value: string;
  className?: string;
  disabled?: boolean;
  icon?: LucideIcon;
  title?: string;
  showDot?: boolean;
}

// conditional tooltip wrapper if collapsed
const ConditionalTooltip = ({
  children,
  title,
  collapsed,
}: {
  children: React.ReactNode;
  title: string | undefined;
  collapsed: boolean;
}) => {
  if (!title || !collapsed) return children;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * TabsTrigger component with optional Lucide icon support.
 *
 * @example
 * ```tsx
 * import { Settings, User } from 'lucide-react'
 *
 * <TabsTrigger value="settings" icon={Settings}>
 *   Settings
 * </TabsTrigger>
 * ```
 */
const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  TabsTriggerProps & { ref?: React.RefObject<HTMLButtonElement | null> }
>(
  (
    {
      children,
      value,
      className,
      disabled,
      icon: Icon,
      title: titleProp,
      showDot = false,
      ...props
    },
    ref
  ) => {
    const { activeValue, handleValueChange, collapsed } = useTabs();
    const tabsListContext = useTabsList();
    const variant = tabsListContext?.variant || "default";
    const isActive = activeValue === value;

    // Use title prop when provided (for collapsed mode tooltips)
    const title = collapsed && titleProp ? titleProp : undefined;

    return (
      <ConditionalTooltip title={titleProp as string} collapsed={collapsed}>
        <button
          ref={ref}
          disabled={disabled}
          onClick={() => handleValueChange(value)}
          data-tab-value={value}
          data-tab-active={isActive}
          role="tab"
          aria-selected={isActive ? "true" : "false"}
          title={title}
          className={cn(
            "relative z-10 flex-1 inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all duration-500 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
            variant === "default" && "py-2.5",
            variant === "default" && "rounded-md px-4",
            // variant === "default" && collapsed && "rounded-md px-1.5 aspect-square",
            variant === "underline" &&
              "px-6 py-3 border-b-2 border-transparent",
            isActive && "text-foreground",
            !isActive && "text-muted-foreground hover:text-foreground",
            className
          )}
          {...props}
        >
          {Icon && (
            <Icon
              className={cn(
                "h-4 w-4 transition-all duration-500 ease-in-out",
                !collapsed && "mr-2",
                collapsed && "mr-0!"
              )}
            />
          )}
          {showDot && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 dark:bg-orange-400 border-2 border-white dark:border-zinc-900 rounded-full transition-opacity duration-300 z-10 animate-status-pulse-orange" />
          )}
          <span
            className={cn(
              "transition-all duration-500 ease-in-out overflow-hidden",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
            )}
          >
            {children}
          </span>
        </button>
      </ConditionalTooltip>
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

interface TabsContentProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

function TabsContent({
  ref,
  children,
  value,
  className,
  ...props
}: TabsContentProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const { activeValue } = useTabs();
  const isActive = activeValue === value;

  if (!isActive) return null;

  return (
    <div
      ref={ref}
      role="tabpanel"
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger, useTabs, useTabsList };
