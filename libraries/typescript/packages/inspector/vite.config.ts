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
    },
  },
  define: {
    // Define process.env for browser compatibility
    'process.env': {},
    // Inject version from package.json at build time
    '__INSPECTOR_VERSION__': JSON.stringify(packageJson.version),
  },
  optimizeDeps: {
    include: ['mcp-use/react'],
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
  build: {
    outDir: 'dist/client',
  },
})
