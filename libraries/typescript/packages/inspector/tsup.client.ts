import { defineConfig } from "tsup";

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
    "@mcp-use/client",
    "@mcp-use/client/react",
    "sonner",
    "e2b",
    "@e2b/code-interpreter",
  ],
});
