// ============================================================================
// EVERYTHING WIDGET — exercises every typed widget API from mcp-use/react
// ============================================================================

import {
  useState,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  memo,
  Component,
  type ReactNode,
  type FormEvent,
  type CSSProperties,
} from "react";
import {
  McpUseProvider,
  useWidget,
  useWidgetProps,
  useWidgetState,
  useWidgetTheme,
  ErrorBoundary,
  type WidgetMetadata,
  type UseWidgetResult,
  type CallToolResponse,
  type Theme,
  type UnknownObject,
} from "mcp-use/react";
import { z } from "zod";

// ============================================================================
// STEP 1: Define props schema separately (NOT inline)
// ============================================================================

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
});

const propsSchema = z.object({
  items: z.array(itemSchema),
  categories: z.array(z.string()),
  totalCount: z.number(),
});

// ============================================================================
// STEP 2: Reference schema variable in metadata
// ============================================================================

export const widgetMetadata: WidgetMetadata = {
  description: "Everything widget exercising all typed widget APIs",
  props: propsSchema,
  exposeAsTool: false,
};

// ============================================================================
// STEP 3: Infer Props type from schema variable
// ============================================================================

type Props = z.infer<typeof propsSchema>;
type Item = z.infer<typeof itemSchema>;

// ============================================================================
// useReducer — discriminated union actions + typed state
// ============================================================================

interface FilterState {
  search: string;
  category: string;
  sortBy: "name" | "price";
  sortOrder: "asc" | "desc";
  selectedIds: Set<string>;
}

type FilterAction =
  | { type: "SET_SEARCH"; payload: string }
  | { type: "SET_CATEGORY"; payload: string }
  | { type: "SET_SORT"; payload: "name" | "price" }
  | { type: "TOGGLE_SORT_ORDER" }
  | { type: "TOGGLE_SELECT"; payload: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "RESET" };

const initialFilterState: FilterState = {
  search: "",
  category: "all",
  sortBy: "name",
  sortOrder: "asc",
  selectedIds: new Set(),
};

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "SET_SEARCH":
      return { ...state, search: action.payload };
    case "SET_CATEGORY":
      return { ...state, category: action.payload };
    case "SET_SORT":
      return { ...state, sortBy: action.payload };
    case "TOGGLE_SORT_ORDER":
      return {
        ...state,
        sortOrder: state.sortOrder === "asc" ? "desc" : "asc",
      };
    case "TOGGLE_SELECT": {
      const next = new Set(state.selectedIds);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, selectedIds: next };
    }
    case "CLEAR_SELECTION":
      return { ...state, selectedIds: new Set() };
    case "RESET":
      return initialFilterState;
    default:
      return state;
  }
}

// ============================================================================
// useDebounce — custom generic hook
// ============================================================================

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ============================================================================
// Theme-aware colors hook — exercises useWidgetTheme() return type
// ============================================================================

function useColors() {
  const theme: Theme = useWidgetTheme();
  return useMemo(
    () => ({
      background: theme === "dark" ? "#1e1e1e" : "#ffffff",
      text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
      textSecondary: theme === "dark" ? "#a0a0a0" : "#666666",
      border: theme === "dark" ? "#333333" : "#e0e0e0",
      hover: theme === "dark" ? "#2a2a2a" : "#f5f5f5",
      primary: theme === "dark" ? "#60a5fa" : "#2563eb",
      error: theme === "dark" ? "#f87171" : "#dc2626",
    }),
    [theme]
  );
}

// ============================================================================
// React.memo child component — typed props, stable callback refs
// ============================================================================

interface ItemRowProps {
  item: Item;
  selected: boolean;
  loading: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (id: string, action: string) => Promise<void>;
  colors: ReturnType<typeof useColors>;
}

const ItemRow = memo(function ItemRow({
  item,
  selected,
  loading,
  onToggleSelect,
  onAction,
  colors,
}: ItemRowProps) {
  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: selected ? colors.hover : "transparent",
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div style={rowStyle}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(item.id)}
        aria-label={`Select ${item.name}`}
      />
      <span style={{ flex: 1, color: colors.text }}>{item.name}</span>
      <span style={{ color: colors.textSecondary }}>{item.category}</span>
      <span style={{ color: colors.primary, fontWeight: "bold" }}>
        ${item.price.toFixed(2)}
      </span>
      <button
        onClick={() => onAction(item.id, "inspect")}
        disabled={loading}
        style={{
          color: colors.primary,
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
        aria-label={`Inspect ${item.name}`}
      >
        Inspect
      </button>
    </div>
  );
});

// ============================================================================
// Class-based error boundary — exercises Component<P, S> generics
// ============================================================================

interface CustomErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface CustomErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class CustomErrorBoundary extends Component<
  CustomErrorBoundaryProps,
  CustomErrorBoundaryState
> {
  constructor(props: CustomErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CustomErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    console.error("Widget error:", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div>Something went wrong: {this.state.error?.message}</div>
        )
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// STEP 4: Default export — main widget component
// Exercises: useWidget<Props>(), isPending guard, callTool, setState/state,
//            useWidgetProps, useWidgetState, useCallback, useMemo, useState,
//            useReducer, useEffect, form handling, React.CSSProperties
// ============================================================================

export default function EverythingWidget() {
  // Core hook with generic type parameter — UseWidgetResult<Props> validates return type
  const {
    props,
    isPending,
    callTool,
    state,
    setState,
    theme,
    toolInput,
    output,
    displayMode,
    safeArea,
    maxHeight,
    userAgent,
    locale,
    mcp_url,
    isAvailable,
  }: UseWidgetResult<Props> = useWidget<Props>();

  // Standalone hooks — exercises their type signatures
  const standaloneProps = useWidgetProps<Props>();
  const [widgetState, setWidgetState] = useWidgetState<{
    favorites: string[];
  }>();

  // isPending guard — required before accessing props
  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 16, textAlign: "center" }}>Loading...</div>
      </McpUseProvider>
    );
  }

  // After guard: props is fully typed as Props (not Partial<Props>)
  return (
    <McpUseProvider autoSize>
      <ErrorBoundary>
        <CustomErrorBoundary>
          <WidgetContent
            props={props}
            callTool={callTool}
            state={state}
            setState={setState}
          />
        </CustomErrorBoundary>
      </ErrorBoundary>
    </McpUseProvider>
  );
}

// ============================================================================
// Inner content component — separated to use hooks after isPending guard
// ============================================================================

interface WidgetContentProps {
  props: Props;
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResponse>;
  state: UnknownObject | null;
  setState: (
    state: UnknownObject | ((prev: UnknownObject | null) => UnknownObject)
  ) => Promise<void>;
}

function WidgetContent({
  props,
  callTool,
  state,
  setState,
}: WidgetContentProps) {
  const colors = useColors();

  // useReducer with typed actions
  const [filters, dispatch] = useReducer(filterReducer, initialFilterState);

  // useState with explicit generics
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [formValue, setFormValue] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"list" | "form" | "info">("list");

  // Debounced search
  const debouncedSearch = useDebounce(filters.search, 300);

  // State initialization from async props
  useEffect(() => {
    if (props.categories.length > 0 && filters.category === "all") {
      // Props arrived — could initialize category from first item
    }
  }, [props.categories, filters.category]);

  // useMemo for filtered + sorted items
  const filteredItems = useMemo(() => {
    let result = props.items;

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((i) => i.name.toLowerCase().includes(q));
    }

    if (filters.category !== "all") {
      result = result.filter((i) => i.category === filters.category);
    }

    result = [...result].sort((a, b) => {
      const cmp =
        filters.sortBy === "price"
          ? a.price - b.price
          : a.name.localeCompare(b.name);
      return filters.sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [
    props.items,
    debouncedSearch,
    filters.category,
    filters.sortBy,
    filters.sortOrder,
  ]);

  // useCallback for stable handler references passed to memo'd children
  const handleToggleSelect = useCallback((id: string) => {
    dispatch({ type: "TOGGLE_SELECT", payload: id });
  }, []);

  const handleItemAction = useCallback(
    async (id: string, action: string) => {
      setLoadingId(id);
      setErrorMsg(null);
      try {
        const response: CallToolResponse = await callTool("get-cached-data", {
          key: id,
        });
        console.log(`Action ${action} on ${id}:`, response);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Action failed");
      } finally {
        setLoadingId(null);
      }
    },
    [callTool]
  );

  // Form submit handler — React.FormEvent typing
  const handleFormSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!formValue.trim()) return;
      try {
        await callTool("greet-user", { name: formValue });
        setFormValue("");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Submit failed");
      }
    },
    [callTool, formValue]
  );

  // Container style — React.CSSProperties
  const containerStyle: CSSProperties = {
    fontFamily: "system-ui, sans-serif",
    backgroundColor: colors.background,
    color: colors.text,
    padding: 16,
    minHeight: 200,
  };

  const tabStyle = (tab: string): CSSProperties => ({
    padding: "8px 16px",
    border: "none",
    borderBottom:
      activeTab === tab
        ? `2px solid ${colors.primary}`
        : "2px solid transparent",
    background: "none",
    color: activeTab === tab ? colors.primary : colors.textSecondary,
    cursor: "pointer",
  });

  return (
    <div style={containerStyle}>
      {/* Tabs — useState for UI state */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: `1px solid ${colors.border}`,
          marginBottom: 12,
        }}
      >
        <button style={tabStyle("list")} onClick={() => setActiveTab("list")}>
          List ({filteredItems.length})
        </button>
        <button style={tabStyle("form")} onClick={() => setActiveTab("form")}>
          Form
        </button>
        <button style={tabStyle("info")} onClick={() => setActiveTab("info")}>
          Info
        </button>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div
          style={{
            padding: 8,
            marginBottom: 8,
            backgroundColor: colors.error,
            color: "#fff",
            borderRadius: 4,
          }}
        >
          {errorMsg}
          <button
            onClick={() => setErrorMsg(null)}
            style={{
              marginLeft: 8,
              color: "#fff",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tab: List */}
      {activeTab === "list" && (
        <div>
          {/* Search + filter controls */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Search..."
              value={filters.search}
              onChange={(e) =>
                dispatch({ type: "SET_SEARCH", payload: e.target.value })
              }
              style={{
                flex: 1,
                padding: 6,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                backgroundColor: colors.background,
                color: colors.text,
              }}
            />
            <select
              value={filters.category}
              onChange={(e) =>
                dispatch({ type: "SET_CATEGORY", payload: e.target.value })
              }
              style={{
                padding: 6,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                backgroundColor: colors.background,
                color: colors.text,
              }}
            >
              <option value="all">All</option>
              {props.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => dispatch({ type: "TOGGLE_SORT_ORDER" })}
              style={{
                padding: "6px 12px",
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                backgroundColor: colors.background,
                color: colors.text,
                cursor: "pointer",
              }}
            >
              {filters.sortOrder === "asc" ? "Asc" : "Desc"}
            </button>
          </div>

          {/* Batch action — multi-select */}
          {filters.selectedIds.size > 0 && (
            <div
              style={{
                padding: 8,
                marginBottom: 8,
                backgroundColor: colors.hover,
                borderRadius: 4,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span>{filters.selectedIds.size} selected</span>
              <button
                onClick={() => dispatch({ type: "CLEAR_SELECTION" })}
                style={{
                  color: colors.primary,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Item list — memo'd rows */}
          {filteredItems.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 24,
                color: colors.textSecondary,
              }}
            >
              No items found
            </div>
          ) : (
            filteredItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={filters.selectedIds.has(item.id)}
                loading={loadingId === item.id}
                onToggleSelect={handleToggleSelect}
                onAction={handleItemAction}
                colors={colors}
              />
            ))
          )}
        </div>
      )}

      {/* Tab: Form — exercises FormEvent, callTool from form submit */}
      {activeTab === "form" && (
        <form
          onSubmit={handleFormSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label htmlFor="greet-input" style={{ color: colors.textSecondary }}>
            Name to greet:
          </label>
          <input
            id="greet-input"
            type="text"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            placeholder="Enter a name..."
            style={{
              padding: 8,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              backgroundColor: colors.background,
              color: colors.text,
            }}
          />
          <button
            type="submit"
            disabled={!formValue.trim()}
            style={{
              padding: "8px 16px",
              backgroundColor: colors.primary,
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Call greet-user tool
          </button>
        </form>
      )}

      {/* Tab: Info — displays widget context values for type verification */}
      {activeTab === "info" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 13,
          }}
        >
          <div>
            <strong>Total items:</strong> {props.totalCount}
          </div>
          <div>
            <strong>Categories:</strong> {props.categories.join(", ")}
          </div>
          <div>
            <strong>State:</strong> {state ? JSON.stringify(state) : "null"}
          </div>
        </div>
      )}
    </div>
  );
}
