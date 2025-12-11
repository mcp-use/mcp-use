import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-version",
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          `  <script>window.__MANGO_VERSION__ = "${packageJson.version}";</script>\n  </head>`
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "mcp-use/react": path.resolve(
        __dirname,
        "../mcp-use/dist/src/react/index.js"
      ),
      "mcp-use/browser": path.resolve(
        __dirname,
        "../mcp-use/dist/src/browser.js"
      ),
    },
  },
  define: {
    "process.env": "{}",
    "process.platform": '"browser"',
    __MANGO_VERSION__: JSON.stringify(packageJson.version),
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["mcp-use/react"],
  },
  build: {
    minify: true,
    outDir: "dist/client",
    rollupOptions: {
      external: ["child_process", "fs", "os", "node:stream", "node:process"],
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
    },
  },
  server: {
    port: 5175,
    host: true,
    proxy: {
      "^/api/.*": {
        target: "http://localhost:5176",
        changeOrigin: true,
      },
    },
  },
});
