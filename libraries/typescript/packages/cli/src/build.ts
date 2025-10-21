import { promises as fs } from 'node:fs'
import path from 'node:path'
import { build, type InlineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { globby } from 'globby'
import { extractPropsFromComponent } from './schema-generator'

const ROUTE_PREFIX = '/mcp-use/widgets'
const SRC_DIR = 'resources'
const OUT_DIR = 'dist/resources'

function toRoute(file: string) {
  const rel = file.replace(new RegExp(`^${SRC_DIR}/`), '').replace(/\.tsx?$/, '')
  return `${ROUTE_PREFIX}/${rel}`
}

function outDirForRoute(route: string) {
  return path.join(OUT_DIR, route.replace(/^\//, ''))
}

function htmlTemplate({ title, scriptPath, isDev = false }: { title: string, scriptPath: string, isDev?: boolean }) {
  const liveReloadScript = isDev ? `
    <script type="module">
      // Simple live reload for development
      const connect = () => {
        const ws = new WebSocket('ws://localhost:3001/__live_reload')
        ws.onmessage = () => window.location.reload()
        ws.onclose = () => setTimeout(connect, 1000)
      }
      connect()
    </script>` : ''
  
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title} Widget</title>
    <style>
      body {
        margin: 0;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        background: #f5f5f5;
      }
      #widget-root {
        max-width: 1200px;
        margin: 0 auto;
      }
    </style>
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="${scriptPath}"></script>${liveReloadScript}
  </body>
</html>`
}

// Create a virtual entry file content
function createEntryContent(componentPath: string): string {
  return `import '@tailwindcss/browser'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Component from '${componentPath}'

// Parse props from URL params
const urlParams = new URLSearchParams(window.location.search)
const propsParam = urlParams.get('props')
let props = {}
if (propsParam) {
  try {
    props = JSON.parse(decodeURIComponent(propsParam))
  } catch (error) {
    console.error('Error parsing props from URL:', error)
  }
}

// Mount the component
const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component {...props} />)
}
`
}

async function generateWidgetManifest(entries: string[], projectPath: string) {
  const outDir = path.join(projectPath, OUT_DIR)
  const manifest: Record<string, any> = {}
  
  for (const entry of entries) {
    try {
      const schema = extractPropsFromComponent(entry)
      if (schema) {
        const relativePath = path.relative(projectPath, entry)
        const widgetName = relativePath.replace(new RegExp(`^${SRC_DIR}/`), '').replace(/\.tsx?$/, '')
        
        manifest[widgetName] = {
          name: widgetName,
          description: schema.metadata?.description,
          props: schema.props.reduce((acc, prop) => {
            acc[prop.name] = {
              type: prop.type,
              required: prop.required,
              description: prop.description,
              enum: prop.enum,
            }
            return acc
          }, {} as Record<string, any>),
        }
      }
    } catch (error) {
      console.error(`Failed to extract schema for ${entry}:`, error)
    }
  }
  
  // Write manifest to dist/resources
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  )
}

function createViteConfig(
  entry: string, 
  projectPath: string, 
  outDir: string, 
  baseName: string,
  minify: boolean,
  watch: boolean = false
): InlineConfig {
  return {
    root: projectPath,
    plugins: [react()],
    build: {
      outDir,
      emptyOutDir: false,
      minify,
      sourcemap: !minify,
      watch: watch ? {} : null,
      rollupOptions: {
        input: entry,
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/asset-[hash].[ext]',
        },
      },
    },
    resolve: {
      alias: {
        '@': path.join(projectPath, SRC_DIR),
      },
    },
  }
}

async function buildWidget(entry: string, projectPath: string, minify = true, isDev = false, useWatch = false) {
  const relativePath = path.relative(projectPath, entry)
  const route = toRoute(relativePath)
  const pageOutDir = path.join(projectPath, outDirForRoute(route))
  const baseName = path.parse(entry).name

  // Create a temporary entry file
  const tempDir = path.join(projectPath, '.mcp-use-temp')
  await fs.mkdir(tempDir, { recursive: true })
  const tempEntry = path.join(tempDir, `${baseName}-entry.tsx`)
  
  // Write the entry file
  const entryContent = createEntryContent(path.resolve(entry))
  await fs.writeFile(tempEntry, entryContent, 'utf8')

  const mainJs = `${baseName}-entry.js`

  try {
    // Build with Vite
    await build(createViteConfig(tempEntry, projectPath, pageOutDir, baseName, minify, useWatch))

    // Write index.html
    await fs.writeFile(
      path.join(pageOutDir, 'index.html'),
      htmlTemplate({
        title: baseName,
        scriptPath: `./assets/${mainJs}`,
        isDev,
      }),
      'utf8',
    )

    return { baseName, route }
  } finally {
    // Don't cleanup in watch mode, we'll reuse the temp files
    if (!isDev) {
      await fs.rm(tempEntry, { force: true }).catch(() => {})
    }
  }
}

// Live reload server
const liveReloadClients: Set<any> = new Set()

export async function createLiveReloadServer() {
  const { WebSocketServer } = await import('ws')
  const wss = new WebSocketServer({ port: 3001 })
  
  wss.on('connection', (ws: any) => {
    liveReloadClients.add(ws)
    ws.on('close', () => liveReloadClients.delete(ws))
  })
  
  return {
    reload: () => {
      liveReloadClients.forEach(client => {
        if (client.readyState === 1) { // OPEN
          client.send('reload')
        }
      })
    },
    close: () => wss.close(),
  }
}

export async function buildWidgets(projectPath: string, watch = false) {
  const srcDir = path.join(projectPath, SRC_DIR)
  const outDir = path.join(projectPath, OUT_DIR)

  // Clean dist
  await fs.rm(outDir, { recursive: true, force: true })

  // Find all TSX entries
  const entries = await globby([`${srcDir}/**/*.tsx`])
  
  // Generate widget manifest
  if (!watch) {
    console.log(`Generating widget manifest for ${entries.length} component(s)...`)
  }
  await generateWidgetManifest(entries, projectPath)
  
  if (watch) {
    // Watch mode - use Vite's build watch with live reload
    console.log(`\x1b[32m✓\x1b[0m Widget builder watching ${entries.length} file(s)...`)
    
    // Start live reload server
    const liveReload = await createLiveReloadServer()
    console.log(`\x1b[32m✓\x1b[0m Live reload server running on port 3001`)
    
    const tempDir = path.join(projectPath, '.mcp-use-temp')
    await fs.mkdir(tempDir, { recursive: true })
    
    // Start Vite watch builds for each entry
    const buildPromises = entries.map(async (entry) => {
      const relativePath = path.relative(projectPath, entry)
      const route = toRoute(relativePath)
      const pageOutDir = path.join(projectPath, outDirForRoute(route))
      const baseName = path.parse(entry).name

      // Create a temporary entry file
      const tempEntry = path.join(tempDir, `${baseName}-entry.tsx`)
      const entryContent = createEntryContent(path.resolve(entry))
      await fs.writeFile(tempEntry, entryContent, 'utf8')

      const mainJs = `${baseName}-entry.js`

      // Write initial index.html
      await fs.mkdir(pageOutDir, { recursive: true })
      await fs.writeFile(
        path.join(pageOutDir, 'index.html'),
        htmlTemplate({
          title: baseName,
          scriptPath: `./assets/${mainJs}`,
          isDev: true,
        }),
        'utf8',
      )

      // Start Vite build in watch mode
      const viteConfig = createViteConfig(tempEntry, projectPath, pageOutDir, baseName, false, true)
      
      // Add a plugin to trigger live reload on rebuild
      if (!viteConfig.plugins) viteConfig.plugins = []
      viteConfig.plugins.push({
        name: 'live-reload-trigger',
        closeBundle() {
          console.log(`\x1b[32m✓\x1b[0m Rebuilt ${baseName}`)
          liveReload.reload()
        },
      })

      return build(viteConfig)
    })

    await Promise.all(buildPromises)

    // Keep the process running
    return () => {
      liveReload.close()
    }
  } else {
    // Build once
    console.log(`Building ${entries.length} widget files...`)
    
    for (const entry of entries) {
      const { baseName, route } = await buildWidget(entry, projectPath, true, false)
      console.log(`\x1b[32m✓\x1b[0m Built ${baseName} -> ${route}`)
    }
    
    // Cleanup temp directory
    const tempDir = path.join(projectPath, '.mcp-use-temp')
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})

    console.log('Build complete!')
  }
}
