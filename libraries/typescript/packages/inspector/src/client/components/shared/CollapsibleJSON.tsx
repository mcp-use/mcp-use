import { cn } from "@/client/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

const VALUE_CLASS: Record<string, string> = {
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  boolean: "text-violet-600 dark:text-violet-400",
  null: "text-zinc-500 dark:text-zinc-400",
  key: "text-sky-600 dark:text-sky-400",
  punctuation: "text-muted-foreground",
};

function formatPrimitive(value: unknown): ReactNode {
  if (value === null) {
    return <span className={VALUE_CLASS.null}>null</span>;
  }
  if (typeof value === "string") {
    return (
      <span className={VALUE_CLASS.string}>
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className={VALUE_CLASS.number}>{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className={VALUE_CLASS.boolean}>{String(value)}</span>;
  }
  return <span className={VALUE_CLASS.string}>{JSON.stringify(value)}</span>;
}

function collectionSummary(value: object): string {
  return Array.isArray(value)
    ? `[${value.length}]`
    : `{${Object.keys(value).length}}`;
}

function JsonNode({
  label,
  value,
  depth,
  defaultExpanded,
}: {
  label?: string;
  value: unknown;
  depth: number;
  defaultExpanded: boolean;
}) {
  const isCollection =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).length > 0
      : Array.isArray(value)
        ? value.length > 0
        : false;

  const [open, setOpen] = useState(
    isCollection && (defaultExpanded || depth === 0)
  );

  if (!isCollection) {
    const isArray = Array.isArray(value);
    const emptyLabel = isArray ? "[]" : "{}";
    if (value !== null && typeof value === "object") {
      return (
        <div
          className="font-mono text-[0.8rem] leading-relaxed"
          style={{ paddingLeft: depth * 12 }}
        >
          {label != null && (
            <>
              <span className={VALUE_CLASS.key}>{JSON.stringify(label)}</span>
              <span className={VALUE_CLASS.punctuation}>: </span>
            </>
          )}
          <span className={VALUE_CLASS.punctuation}>{emptyLabel}</span>
        </div>
      );
    }

    return (
      <div
        className="font-mono text-[0.8rem] leading-relaxed"
        style={{ paddingLeft: depth * 12 }}
      >
        {label != null && (
          <>
            <span className={VALUE_CLASS.key}>{JSON.stringify(label)}</span>
            <span className={VALUE_CLASS.punctuation}>: </span>
          </>
        )}
        {formatPrimitive(value)}
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const isArray = Array.isArray(value);
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";

  return (
    <div className="font-mono text-[0.8rem] leading-relaxed">
      <div
        className="flex items-start gap-0.5"
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-90"
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          {label != null && (
            <>
              <span className={VALUE_CLASS.key}>{JSON.stringify(label)}</span>
              <span className={VALUE_CLASS.punctuation}>: </span>
            </>
          )}
          <span className={VALUE_CLASS.punctuation}>{bracketOpen}</span>
          {!open && (
            <>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mx-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {collectionSummary(value)}
              </button>
              <span className={VALUE_CLASS.punctuation}>{bracketClose}</span>
            </>
          )}
        </div>
      </div>
      {open && (
        <div>
          {entries.map(([entryLabel, entryValue]) => (
            <JsonNode
              key={`${depth}-${entryLabel}`}
              label={entryLabel}
              value={entryValue}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
            />
          ))}
          <div style={{ paddingLeft: depth * 12 }}>
            <span className={VALUE_CLASS.punctuation}>{bracketClose}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function CollapsibleJSON({
  data,
  defaultExpanded = true,
  className,
}: {
  data: unknown;
  defaultExpanded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]",
        className
      )}
      data-testid="collapsible-json"
    >
      <JsonNode value={data} depth={0} defaultExpanded={defaultExpanded} />
    </div>
  );
}
