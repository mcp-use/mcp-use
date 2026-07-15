"use client";

import * as React from "react";
import { cn } from "@/client/lib/utils";

interface CommandContextValue {
  search: string;
  setSearch: (value: string) => void;
  activeValue: string | null;
  setActiveValue: (value: string | null) => void;
  visibleCount: number;
  registerVisible: () => () => void;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommandContext() {
  const ctx = React.useContext(CommandContext);
  if (!ctx) throw new Error("Command components must be used within <Command>");
  return ctx;
}

export { useCommandContext };

function matchesSearch(text: string, search: string) {
  if (!search) return true;
  return text.toLowerCase().includes(search.toLowerCase());
}

const Command = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const [search, setSearch] = React.useState("");
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(0);

  const registerVisible = React.useCallback(() => {
    setVisibleCount((c) => c + 1);
    return () => setVisibleCount((c) => Math.max(0, c - 1));
  }, []);

  return (
    <CommandContext.Provider
      value={{
        search,
        setSearch,
        activeValue,
        setActiveValue,
        visibleCount,
        registerVisible,
      }}
    >
      <div
        ref={ref}
        className={cn(
          "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
          className
        )}
        {...props}
      />
    </CommandContext.Provider>
  );
});
Command.displayName = "Command";

const CommandInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const { search, setSearch } = useCommandContext();
  return (
    <div className="flex items-center border-b px-3">
      <input
        ref={ref}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  );
});
CommandInput.displayName = "CommandInput";

const CommandList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = "CommandList";

const CommandEmpty = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { visibleCount } = useCommandContext();
  if (visibleCount > 0) return null;
  return (
    <div
      ref={ref}
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  );
});
CommandEmpty.displayName = "CommandEmpty";

const CommandGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[data-command-group-heading]]:px-2 [&_[data-command-group-heading]]:py-1.5 [&_[data-command-group-heading]]:text-xs [&_[data-command-group-heading]]:font-medium [&_[data-command-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

interface CommandItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  value: string;
  keywords?: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  (
    { className, value, keywords, onSelect, disabled, onClick, ...props },
    ref
  ) => {
    const { search, activeValue, setActiveValue, registerVisible } =
      useCommandContext();
    const searchable = keywords ? `${value} ${keywords}` : value;
    const visible = matchesSearch(searchable, search);
    const selected = activeValue === value;

    React.useLayoutEffect(() => {
      if (!visible) return;
      return registerVisible();
    }, [visible, registerVisible]);

    React.useEffect(() => {
      if (visible && activeValue === null && !disabled) {
        setActiveValue(value);
      }
    }, [visible, activeValue, disabled, setActiveValue, value]);

    if (!visible) return null;

    return (
      <div
        ref={ref}
        role="option"
        aria-selected={selected}
        data-selected={selected}
        data-disabled={disabled}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50",
          className
        )}
        onMouseEnter={() => !disabled && setActiveValue(value)}
        onClick={(e) => {
          onClick?.(e);
          if (!disabled) onSelect?.(value);
        }}
        {...props}
      />
    );
  }
);
CommandItem.displayName = "CommandItem";

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
};
