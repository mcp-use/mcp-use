/**
 * Generic Popover + Select component
 * Reusable pattern for popover-based selection controls
 */

import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

export interface PopoverSelectOption<T = string> {
  value: T;
  label: string;
  description?: string;
}

export interface PopoverSelectProps<T = string> {
  label: string;
  value: T;
  options: ReadonlyArray<PopoverSelectOption<T>>;
  onChange: (value: T) => void;
  displayValue?: string;
  icon?: React.ReactNode;
  width?: string;
  buttonClassName?: string;
}

export function PopoverSelect<T extends string = string>({
  label,
  value,
  options,
  onChange,
  displayValue,
  icon,
  width = "w-[200px]",
  buttonClassName,
}: PopoverSelectProps<T>) {
  const selectedOption = options.find((opt) => opt.value === value);
  const display = displayValue || selectedOption?.label || value;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={buttonClassName}>
          {icon}
          <span className="ml-1.5">{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={width} align="start">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            {label}
          </label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                  {option.description && (
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
