import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  children?: React.ReactNode;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  triggerClassName,
  children,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center justify-between gap-1 rounded-md border border-input bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900 px-3 py-2 text-sm cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            triggerClassName
          )}
        >
          {children || (
            <span className="text-xs">
              {selectedOption?.label || placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[300px] p-0", className)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={(currentValue) => {
                    onValueChange(currentValue);
                    setOpen(false);
                  }}
                  keywords={[option.label]}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
