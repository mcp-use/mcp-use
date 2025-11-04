import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Read version from package.json
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  base: '/inspector',
  plugins: [
    react(),
    tailwindcss(),
    // Custom plugin to inject version into HTML
    {
      name: 'inject-version',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `  <script>window.__INSPECTOR_VERSION__ = "${packageJson.version}";</script>\n  </head>`,
        )
      },
    },
    // Custom plugin to handle OAuth callback redirects in dev mode
    {
      name: 'oauth-callback-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/oauth/callback')) {
            const url = new URL(req.url, 'http://localhost')
            const queryString = url.search
            res.writeHead(302, { Location: `/inspector/oauth/callback${queryString}` })
            res.end()
            return
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'mcp-use/react': path.resolve(__dirname, '../mcp-use/dist/src/react/index.js'),
      'mcp-use/browser': path.resolve(__dirname, '../mcp-use/dist/src/browser.js'),
      'posthog-node': path.resolve(__dirname, './src/client/stubs/posthog-node.js'),
      '@scarf/scarf': path.resolve(__dirname, './src/client/stubs/@scarf/scarf.js'),
      'dotenv': path.resolve(__dirname, './src/client/stubs/dotenv.js'),
      'util': path.resolve(__dirname, './src/client/stubs/util.js'),
      'path': path.resolve(__dirname, './src/client/stubs/path.js'),
      'process': path.resolve(__dirname, './src/client/stubs/process.js'),
      'node:async_hooks': path.resolve(__dirname, './src/client/stubs/async_hooks.js'),
    },
  },
  define: {
    // Define process.env for browser compatibility
    'process.env': '{}',
    'process.platform': '"browser"',
    // Inject version from package.json at build time
    '__INSPECTOR_VERSION__': JSON.stringify(packageJson.version),
    // Ensure global is defined
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: [
      'mcp-use/react',
      'react-syntax-highlighter',
      'refractor/lib/core',
    ],
    exclude: ['posthog-node'], // Exclude Node.js-only packages
  },
  ssr: {
    noExternal: ['react-syntax-highlighter', 'refractor'],
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress warnings about externalized modules for refractor
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.exporter?.includes('refractor')) {
          return
        }
        warn(warning)
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external connections
    proxy: {
      // Proxy API requests to the backend server
      '^/inspector/api/.*': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
