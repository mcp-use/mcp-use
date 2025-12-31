/**
 * MCP Inspector - Client Components
 *
 * This module exports the embeddable Inspector component that can be used
 * in any React application. The component provides a complete MCP server
 * inspector interface with support for tools, prompts, resources, chat,
 * and more.
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
 *         name: "My Server",
 *         transportType: "http"
 *       }}
 *       showTabs={['tools', 'prompts', 'resources', 'chat']}
 *       apiUrl="https://api.example.com"
 *     />
 *   );
 * }
 * ```
 */

export { Inspector } from "./components/InspectorEmbedded";
export type { InspectorProps, ServerConfig } from "./components/Inspector";
export type { TabType } from "./context/InspectorContext";
