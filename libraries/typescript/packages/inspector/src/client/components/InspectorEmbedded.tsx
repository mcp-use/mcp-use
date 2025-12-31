import { InspectorProvider } from "@/client/context/InspectorContext";
import { McpProvider } from "@/client/context/McpContext";
import { Toaster } from "@/client/components/ui/sonner";
import type { InspectorProps, ServerConfig } from "./Inspector";
import { Inspector } from "./Inspector";

/**
 * InspectorEmbedded - Wrapper component that provides necessary context providers
 * for the embedded Inspector component.
 *
 * This component wraps the Inspector with McpProvider and InspectorProvider,
 * but NOT ThemeProvider (theme should be inherited from parent app).
 *
 * @example
 * ```tsx
 * import { Inspector } from '@mcp-use/inspector/client';
 *
 * function MyApp() {
 *   return (
 *     <Inspector
 *       serverConfig={{
 *         url: "https://example.com/mcp",
 *         name: "My Server"
 *       }}
 *       showTabs={['tools', 'prompts', 'resources']}
 *     />
 *   );
 * }
 * ```
 */
export function InspectorEmbedded(props: InspectorProps) {
  const { serverConfig } = props;

  return (
    <McpProvider embedded={true} initialServer={serverConfig}>
      <InspectorProvider>
        <Inspector {...props} />
        <Toaster position="top-center" />
      </InspectorProvider>
    </McpProvider>
  );
}

// Re-export as default export
export { InspectorEmbedded as Inspector };
export type { InspectorProps, ServerConfig };
