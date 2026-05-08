import { useCallback, useMemo, useState } from "react";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { Play, Link } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { CompletionInput } from "@/client/components/shared/CompletionInput";
import { cn } from "@/client/lib/utils";

interface ResourceTemplatePanelProps {
  /** The selected resource template (contains the uriTemplate string). */
  template: ResourceTemplate;
  /** Whether the MCP connection is ready. Controls the Read button. */
  isConnected: boolean;
  /** Called with the fully-substituted URI when the user clicks "Read". */
  onRead: (uri: string) => void;
  /**
   * Fetches completion suggestions for a template variable.
   *
   * @param templateUri - The raw template URI (e.g. "file:///{path}")
   * @param varName     - The variable name being filled in (e.g. "path")
   * @param value       - The partial value typed so far
   */
  onFetchSuggestions: (
    templateUri: string,
    varName: string,
    value: string
  ) => Promise<string[]>;
}

/**
 * Extract `{variableName}` tokens from a URI template string.
 * Handles both simple `{var}` and RFC 6570 operators like `{+var}`, `{#var}`.
 *
 * @example
 * parseTemplateVars("file:///{path}/to/{name}") // => ["path", "name"]
 */
function parseTemplateVars(uriTemplate: string): string[] {
  const matches = uriTemplate.matchAll(/\{([+#./;?&]?)([^}]+)\}/g);
  const vars: string[] = [];
  for (const match of matches) {
    // match[2] may be comma-separated for multi-var expressions like {a,b}
    const names = match[2].split(",").map((n) => n.trim());
    vars.push(...names);
  }
  // Deduplicate while preserving order
  return [...new Set(vars)];
}

/**
 * Substitute template variables into the URI template.
 * Replaces `{var}` (and `{+var}`, `{#var}`) with the given value.
 */
function buildUri(
  uriTemplate: string,
  values: Record<string, string>
): string {
  return uriTemplate.replace(
    /\{([+#./;?&]?)([^}]+)\}/g,
    (_match, _operator, expression) => {
      const names = expression.split(",").map((n: string) => n.trim());
      const parts = names.map((n: string) => values[n] ?? "");
      return parts.join(",");
    }
  );
}

/**
 * Panel for filling in and reading a resource template URI.
 *
 * Renders one `CompletionInput` per template variable (`{var}` token) with
 * server-side completion suggestions, a live URI preview, and a "Read
 * Resource" button that calls `onRead` with the substituted URI.
 */
export function ResourceTemplatePanel({
  template,
  isConnected,
  onRead,
  onFetchSuggestions,
}: ResourceTemplatePanelProps) {
  const vars = useMemo(
    () => parseTemplateVars(template.uriTemplate),
    [template.uriTemplate]
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v, ""]))
  );
  const [isLoading, setIsLoading] = useState(false);

  // Rebuild the values map if the template changes (different selection)
  // This avoids stale values from previous templates
  const stableVarKey = vars.join(",");
  useMemo(() => {
    setValues(Object.fromEntries(vars.map((v) => [v, ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableVarKey]);

  const builtUri = useMemo(
    () => buildUri(template.uriTemplate, values),
    [template.uriTemplate, values]
  );

  const handleVarChange = useCallback((varName: string, value: string) => {
    setValues((prev) => ({ ...prev, [varName]: value }));
  }, []);

  const handleRead = useCallback(async () => {
    if (!isConnected || isLoading) return;
    setIsLoading(true);
    try {
      onRead(builtUri);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, isLoading, onRead, builtUri]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-3 sm:p-6 pt-3 pb-4 pr-3">
        <div className="flex flex-row items-start justify-between mb-0 gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-semibold truncate font-mono">
              {template.name}
            </h3>
            {template.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-1">
                {template.description}
              </p>
            )}
          </div>
          <Button
            onClick={handleRead}
            disabled={isLoading || !isConnected}
            size="sm"
            className="flex-shrink-0 gap-2"
            data-testid="resource-template-read-button"
          >
            {isLoading ? (
              <>
                <Spinner className="h-4 w-4" />
                <span className="hidden sm:inline">Reading…</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                <span className="hidden sm:inline">Read Resource</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Variable inputs ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-4 pr-3 space-y-4">
        {vars.length === 0 ? (
          /* No variables — the template is a static URI */
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400 text-sm">
            No variables — click Read Resource to fetch
          </div>
        ) : (
          vars.map((varName) => (
            <div key={varName} className="space-y-1.5">
              <Label
                htmlFor={`template-var-${varName}`}
                className="text-sm font-medium"
              >
                <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded mr-1">
                  {`{${varName}}`}
                </span>
                {varName}
              </Label>
              <CompletionInput
                id={`template-var-${varName}`}
                data-testid={`template-var-${varName}`}
                value={values[varName] ?? ""}
                onChange={(v) => handleVarChange(varName, v)}
                onFetchSuggestions={(v) =>
                  onFetchSuggestions(template.uriTemplate, varName, v)
                }
                placeholder={`Value for {${varName}}`}
              />
            </div>
          ))
        )}

        {/* ── Live URI preview ──────────────────────────────────────────── */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link className="h-3.5 w-3.5" />
            <span>URI Preview</span>
          </div>
          <div
            className={cn(
              "font-mono text-xs break-all rounded-md border border-border bg-muted/50 px-3 py-2",
              "text-muted-foreground"
            )}
            data-testid="template-uri-preview"
          >
            {builtUri || template.uriTemplate}
          </div>
        </div>
      </div>
    </div>
  );
}
