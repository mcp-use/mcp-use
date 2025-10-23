import { promises as fs } from 'node:fs'
import path from 'node:path'
import { build, createServer, type InlineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { globby } from 'globby'
import { extractPropsFromComponent } from './schema-generator'

const SRC_DIR = 'resources'
const OUT_DIR = 'dist/resources'


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
            // Build enhanced description with enum and validation info
            let enhancedDescription = prop.description || prop.name
            const constraints: string[] = []
            
            // Add enum values to description
            if (prop.enum && prop.enum.length > 0) {
              constraints.push(`one of: ${prop.enum.join(', ')}`)
            }
            
            // Add validation rules to description
            if (prop.validation) {
              constraints.push(prop.validation)
            }
            
            // Append constraints to description
            if (constraints.length > 0) {
              enhancedDescription += ` (${constraints.join('; ')})`
            }
            
            acc[prop.name] = {
              type: prop.type,
              required: prop.required,
              description: enhancedDescription,
              enum: prop.enum,
              validation: prop.validation,
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


// export async function buildWidgets(projectPath: string) {
//   const srcDir = path.join(projectPath, SRC_DIR)
//   const outDir = path.join(projectPath, OUT_DIR)

//   // Clean dist
//   await fs.rm(outDir, { recursive: true, force: true })

//   // Find all TSX entries
//   const entries = await globby([`${srcDir}/**/*.tsx`])
  
//   // Generate widget manifest
//   console.log(`Generating widget manifest for ${entries.length} component(s)...`)
//   await generateWidgetManifest(entries, projectPath)
  
//   // Build widgets
//   console.log(`Building ${entries.length} widget(s)...`)
  
//   for (const entry of entries) {
//     const { baseName, widgetName } = await buildWidget(entry, projectPath, true)
//     console.log(`\x1b[32m✓\x1b[0m Built ${baseName} -> /mcp-use/widgets/${widgetName}`)
//   }
  
//   // Cleanup temp directory
//   const tempDir = path.join(projectPath, '.mcp-use-temp')
//   await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})

//   console.log('Build complete!')
// }

// // Create Vite dev servers for widgets (for HMR during development)
// export async function startWidgetDevServers(projectPath: string): Promise<Map<string, ViteDevServer>> {
//   const srcDir = path.join(projectPath, SRC_DIR)
//   const entries = await globby([`${srcDir}/**/*.tsx`])
  
//   // Generate manifest
//   await generateWidgetManifest(entries, projectPath)
  
//   const servers = new Map<string, ViteDevServer>()
  
//   for (const entry of entries) {
//     const baseName = path.parse(entry).name
//     const widgetName = path.relative(path.join(projectPath, SRC_DIR), entry).replace(/\.tsx?$/, '')
    
//     // Create temp directory for this widget
//     const tempDir = path.join(projectPath, '.mcp-use-temp', widgetName)
//     await fs.mkdir(tempDir, { recursive: true })
//     const tempEntry = path.join(tempDir, 'entry.tsx')
//     const tempHtml = path.join(tempDir, 'index.html')
    
//     // Write entry and HTML (for dev mode, use /entry.tsx path)
//     await fs.writeFile(tempEntry, createEntryContent(path.resolve(entry)), 'utf8')
//     await fs.writeFile(tempHtml, htmlTemplate(baseName, '/entry.tsx'), 'utf8')
    
//     // Create Vite dev server for this widget
//     const server = await createServer({
//       root: tempDir,
//       plugins: [react()],
//       resolve: {
//         alias: {
//           '@': path.join(projectPath, SRC_DIR),
//         },
//       },
//       server: {
//         middlewareMode: true,
//         hmr: {
//           port: 24678, // Use a fixed port for HMR WebSocket
//         },
//       },
//     })
    
//     servers.set(widgetName, server)
//   }
  
//   console.log(`\x1b[32m✓\x1b[0m Started dev servers for ${servers.size} widget(s) with HMR`)
  
//   return servers
// }
