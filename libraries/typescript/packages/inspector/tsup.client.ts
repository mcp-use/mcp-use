import { defineConfig } from "tsup";
import path from "node:path";

const stubDir = path.resolve(__dirname, "src/client/stubs");

export default defineConfig({
  entry: ["src/client/index.ts"],
  format: ["esm"],
  outDir: "dist/client",
  tsconfig: "tsconfig.client.json",
  splitting: false,
  external: [
    "react",
    "react-dom",
    "lucide-react",
    // mcp-use/react is browser-safe — keep external so React context is shared with host app.
    "mcp-use/react",
    "@modelcontextprotocol/sdk",
    "sonner",
    "@langchain/openai",
    "@langchain/anthropic",
    "@langchain/google-genai",
    "@langchain/core",
    "langchain",
    "@mcp-ui/client",
  ],
  // mcp-use/browser is dynamically imported by the chat hook. Its pre-built dist
  // shares tsup chunks with the Node.js MCPClient entry, creating transitive deps
  // on child_process, node:fs, node:async_hooks, etc. We bundle it here with
  // browser stubs so consumers get a clean, self-contained client bundle.
  // This can be removed once mcp-use isolates its browser build from server chunks.
  //
  // IMPORTANT: mcp-use/react MUST stay external (it's in the `external` list above)
  // so the React context (McpClientContext) is shared with the host app.
  // A plain `noExternal: ["mcp-use"]` overrides the external rule for all subpaths,
  // so we use a regex that matches mcp-use but excludes the /react subpath.
  noExternal: [/^mcp-use(?!\/react)/],
  esbuildOptions(options) {
    options.alias = {
      // --- Node.js built-in modules (from mcp-use's bundled MCPClient code) ---
      "node:async_hooks": path.join(stubDir, "async_hooks.js"),
      "node:fs": path.join(stubDir, "fs.js"),
      "node:fs/promises": path.join(stubDir, "fs-promises.js"),
      "node:stream": path.join(stubDir, "stream.js"),
      "node:process": path.join(stubDir, "process.js"),
      "node:child_process": path.join(stubDir, "child_process.js"),
      async_hooks: path.join(stubDir, "async_hooks.js"),
      fs: path.join(stubDir, "fs.js"),
      "fs/promises": path.join(stubDir, "fs-promises.js"),
      child_process: path.join(stubDir, "child_process.js"),
      path: path.join(stubDir, "path.js"),
      util: path.join(stubDir, "util.js"),
      os: path.join(stubDir, "process.js"), // os module stub (re-use process stub)
      tty: path.join(stubDir, "process.js"), // tty module stub
      crypto: path.join(stubDir, "process.js"), // crypto module stub
      "posthog-node": path.join(stubDir, "posthog-node.js"),

      // --- Node.js-only SDK transports ---
      // StdioClientTransport uses child_process via cross-spawn. Never used in
      // browser, but pulled in by MCPClient which supports multiple transports.
      // Alias takes precedence over the @modelcontextprotocol/sdk external rule.
      "@modelcontextprotocol/sdk/client/stdio.js": path.join(
        stubDir,
        "stdio-transport.js"
      ),
      "@modelcontextprotocol/sdk/client/stdio": path.join(
        stubDir,
        "stdio-transport.js"
      ),
    };
  },
});
