"use client";

import { cn } from "@/client/lib/utils";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type AccordionValue = string | string[];

interface AccordionContextValue {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);
const AccordionItemContext = createContext<string | null>(null);

export function Accordion({
  type = "single",
  collapsible = true,
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  type?: "single" | "multiple";
  collapsible?: boolean;
  value?: AccordionValue;
  defaultValue?: AccordionValue;
  onValueChange?: (value: AccordionValue) => void;
  className?: string;
  children: ReactNode;
}) {
  const [internalValue, setInternalValue] = useState<AccordionValue>(
    defaultValue ?? (type === "multiple" ? [] : "")
  );
  const current = value ?? internalValue;

  const context = useMemo<AccordionContextValue>(() => {
    const openValues = new Set(
      Array.isArray(current) ? current : current ? [current] : []
    );
    return {
      isOpen: (itemValue) => openValues.has(itemValue),
      toggle: (itemValue) => {
        let next: AccordionValue;
        if (type === "multiple") {
          next = openValues.has(itemValue)
            ? [...openValues].filter((item) => item !== itemValue)
            : [...openValues, itemValue];
        } else {
          next =
            openValues.has(itemValue) && collapsible ? "" : itemValue;
        }
        if (value === undefined) setInternalValue(next);
        onValueChange?.(next);
      },
    };
  }, [collapsible, current, onValueChange, type, value]);

  return (
    <AccordionContext.Provider value={context}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({
  value,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value: string }) {
  return (
    <AccordionItemContext.Provider value={value}>
      <div className={className} {...props} />
    </AccordionItemContext.Provider>
  );
}

export function AccordionTrigger({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const accordion = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);
  if (!accordion || value === null) {
    throw new Error("AccordionTrigger must be inside an AccordionItem");
  }

  return (
    <button
      type="button"
      aria-expanded={accordion.isOpen(value)}
      onClick={() => accordion.toggle(value)}
      className={cn(className)}
      {...props}
    />
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const accordion = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);
  if (!accordion || value === null) {
    throw new Error("AccordionContent must be inside an AccordionItem");
  }
  const open = accordion.isOpen(value);

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className
      )}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
