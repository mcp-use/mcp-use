import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/client/index.ts"],
  format: ["esm"],
  outDir: "dist/client",
  tsconfig: "tsconfig.client.json",
  splitting: false,
  minify: true,
  sourcemap: false,
  dts: true,
  external: [
    "@base-ui/react",
    "@mcp-use/agent",
    "class-variance-authority",
    "clsx",
    "react",
    "react-dom",
    "lucide-react",
    "@mcp-use/client",
    "@mcp-use/client/react",
    "sonner",
    "markdown-to-jsx",
    "motion",
    "react-resizable-panels",
    "tailwind-merge",
  ],
});
