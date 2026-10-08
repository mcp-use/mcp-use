import type { Tool } from "@mcp-use/client/react";
import type { ResourceLink } from "mcp-use";
import { useEffect, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";

/** True when a tool advertises the native composer search marker. */
export function isMentionSearchTool(tool: Tool): boolean {
  const extensions = tool._meta?.["openai/extensions"];
  return (
    typeof extensions === "object" &&
    extensions !== null &&
    Object.hasOwn(extensions, "mentions/search")
  );
}

/** Ordinary tool call used by the Inspector preview, including cancellation. */
export type MentionPreviewCall = (
  name: string,
  args: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<unknown>;

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; items: ResourceLink[] };

function itemsFromResult(result: unknown): ResourceLink[] {
  const response = result as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
    structuredContent?: { items?: ResourceLink[] };
  } | null;
  if (response?.isError) {
    throw new Error(
      response.content?.find((item) => item.type === "text")?.text ??
        "Mention search failed"
    );
  }
  const items = response?.structuredContent?.items;
  if (
    !Array.isArray(items) ||
    !items.every(
      (item) =>
        item?.type === "resource_link" &&
        typeof item.name === "string" &&
        typeof item.uri === "string"
    )
  )
    throw new Error("Mention search returned invalid resource links");
  return items;
}

function Search({
  tool,
  callTool,
  isConnected,
}: {
  tool: Tool;
  callTool: MentionPreviewCall;
  isConnected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  useEffect(() => {
    if (!isConnected) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    void callTool(tool.name, { query }, { signal: controller.signal })
      .then((result) => {
        if (active)
          setState({ status: "success", items: itemsFromResult(result) });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tool.name, query, callTool, isConnected]);

  return (
    <div className="space-y-2 mt-3">
      <p className="text-xs text-muted-foreground">
        Search preview. Native composer insertion requires a supporting host.
      </p>
      <Input
        aria-label="Mention query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={!isConnected}
        placeholder="Search items (empty query shows suggestions)"
      />
      {!isConnected ? (
        <p>Connect to search.</p>
      ) : state.status === "loading" ? (
        <p role="status">Searching…</p>
      ) : state.status === "error" ? (
        <p role="alert">{state.message}</p>
      ) : state.items.length === 0 ? (
        <p role="status">No matches</p>
      ) : (
        <ul className="space-y-2" aria-label="Mention results">
          {state.items.map((item, index) => (
            <li key={`${item.uri}:${index}`} className="text-sm">
              <div>{item.title ?? item.name}</div>
              {item.title && (
                <div className="text-xs text-muted-foreground">{item.name}</div>
              )}
              <code className="text-xs break-all">{item.uri}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Preview marked tools through ordinary calls; stale responses are ignored. */
export function MentionSearchPreview({
  tool,
  callTool,
  isConnected,
}: {
  tool: Tool;
  callTool: MentionPreviewCall;
  isConnected: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!isMentionSearchTool(tool)) return null;
  return (
    <div className="mb-4 rounded-md border p-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Preview mentions
      </Button>
      {open && (
        <Search
          key={tool.name}
          tool={tool}
          callTool={callTool}
          isConnected={isConnected}
        />
      )}
    </div>
  );
}
