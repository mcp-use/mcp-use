import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/client/lib/utils";
import { Spinner } from "@/client/components/ui/spinner";

interface CompletionInputProps {
  /** Controlled value */
  value: string;
  /** Called whenever the value changes (typed or suggestion selected) */
  onChange: (value: string) => void;
  /**
   * Async function that fetches completion suggestions for the current value.
   * Return [] to show no suggestions. Errors are swallowed by the hook layer.
   */
  onFetchSuggestions: (value: string) => Promise<string[]>;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  "data-testid"?: string;
  className?: string;
}

/**
 * A controlled text input with autocomplete dropdown powered by server-side
 * completion suggestions (MCP `completion/complete`).
 *
 * Features:
 * - Triggers `onFetchSuggestions` as the user types (debouncing is handled
 *   by the caller's `useCompletion` hook, so this component does not
 *   add extra delay)
 * - Keyboard navigation: ArrowUp / ArrowDown to move, Enter to select,
 *   Escape to close the dropdown
 * - Gracefully degrades to a plain input when no suggestions are returned
 * - Shows a loading spinner while fetching
 * - Closes on outside click
 */
export function CompletionInput({
  value,
  onChange,
  onFetchSuggestions,
  placeholder,
  id,
  disabled,
  "data-testid": dataTestId,
  className,
}: CompletionInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchIdRef = useRef(0); // tracks latest fetch to discard stale results

  // ── Fetch suggestions whenever value changes ──────────────────────────────
  useEffect(() => {
    // Don't fetch when empty — hide dropdown
    if (!value) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const id = ++fetchIdRef.current;
    setIsLoading(true);

    onFetchSuggestions(value).then((results) => {
      // Ignore stale responses
      if (id !== fetchIdRef.current) return;
      setIsLoading(false);
      setSuggestions(results);
      setIsOpen(results.length > 0);
      setActiveIndex(-1);
    });
  }, [value, onFetchSuggestions]);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Enter":
          if (activeIndex >= 0 && suggestions[activeIndex]) {
            e.preventDefault();
            selectSuggestion(suggestions[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, activeIndex]
  );

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      setSuggestions([]);
      setIsOpen(false);
      setActiveIndex(-1);
      // Return focus to input after selection
      inputRef.current?.focus();
    },
    [onChange]
  );

  return (
    <div ref={containerRef} className="relative w-full" data-testid={dataTestId ? `${dataTestId}-wrapper` : undefined}>
      {/* Input row */}
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          data-testid={dataTestId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            isLoading && "pr-8",
            className
          )}
        />
        {isLoading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Completion suggestions"
          className={cn(
            "absolute z-50 mt-1 w-full max-h-48 overflow-y-auto",
            "rounded-md border border-border bg-popover shadow-md",
            "text-sm text-popover-foreground"
          )}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => {
                // Prevent blur on input before click is processed
                e.preventDefault();
                selectSuggestion(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "cursor-pointer px-3 py-2 truncate transition-colors",
                index === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
