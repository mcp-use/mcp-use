#!/usr/bin/env node
import 'dotenv/config'
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import open from 'open';
import chalk from 'chalk';
const program = new Command();

const packageContent = readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
const packageJson = JSON.parse(packageContent)
const packageVersion = packageJson.version || 'unknown'


program
  .name('mcp-use')
  .description('Create and run MCP servers with ui resources widgets')
  .version(packageVersion);

// Helper to check if port is available
async function isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
  try {
    await fetch(`http://${host}:${port}`);
    return false; // Port is in use
  } catch {
    return true; // Port is available
  }
}

// Helper to find an available port
async function findAvailablePort(startPort: number, host: string = 'localhost'): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error('No available ports found');
}

// Helper to check if server is ready
async function waitForServer(port: number, host: string = 'localhost', maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://${host}:${port}/inspector`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

// Helper to run a command
function runCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: env ? { ...process.env, ...env } : process.env,
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}


async function findServerFile(projectPath: string): Promise<string> {
  const candidates = ['index.ts', 'src/index.ts', 'server.ts', 'src/server.ts'];
  for (const candidate of candidates) {
    try {
      await access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('No server file found');
}

async function buildWidgets(projectPath: string): Promise<string[]> {
  const { promises: fs } = await import('node:fs');
  const { build } = await import('vite');
  const resourcesDir = path.join(projectPath, 'resources');
  
  // Get base URL from environment or use default
  const mcpUrl = process.env.MCP_URL
  if (!mcpUrl) {
    console.log(chalk.yellow('⚠️  MCP_URL not set - using relative paths (widgets may not work correctly)'));
    console.log(chalk.gray('   Set MCP_URL environment variable for production builds (e.g., https://myserver.com)'));
  }
  
  // Check if resources directory exists
  try {
    await access(resourcesDir);
  } catch {
    console.log(chalk.gray('No resources/ directory found - skipping widget build'));
    return [];
  }
  
  // Find all TSX widget files
  let entries: string[] = [];
  try {
    const files = await fs.readdir(resourcesDir);
    entries = files
      .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map(f => path.join(resourcesDir, f));
  } catch (error) {
    console.log(chalk.gray('No widgets found in resources/ directory'));
    return [];
  }
  
  if (entries.length === 0) {
    console.log(chalk.gray('No widgets found in resources/ directory'));
    return [];
  }
  
  console.log(chalk.gray(`Building ${entries.length} widget(s)...`));
  
  const react = (await import('@vitejs/plugin-react')).default;
  // @ts-ignore - @tailwindcss/vite may not have type declarations
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  
  const builtWidgets: string[] = [];
  
  for (const entry of entries) {
    const baseName = path.basename(entry).replace(/\.tsx?$/, '');
    const widgetName = baseName;
    
    console.log(chalk.gray(`  - Building ${widgetName}...`));
    
    // Create temp directory for build artifacts
    const tempDir = path.join(projectPath, '.mcp-use', widgetName);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create CSS file with Tailwind directives
    const relativeResourcesPath = path.relative(tempDir, resourcesDir).replace(/\\/g, '/');
    const cssContent = `@import "tailwindcss";\n\n/* Configure Tailwind to scan the resources directory */\n@source "${relativeResourcesPath}";\n`;
    await fs.writeFile(path.join(tempDir, 'styles.css'), cssContent, 'utf8');
    
    // Create entry file
    const entryContent = `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Component from '${entry}'

const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component />)
}
`;
    
    // Create HTML template
    const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${widgetName} Widget</title>
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="/entry.tsx"></script>
  </body>
</html>`;
    
    await fs.writeFile(path.join(tempDir, 'entry.tsx'), entryContent, 'utf8');
    await fs.writeFile(path.join(tempDir, 'index.html'), htmlContent, 'utf8');
    
    // Build with Vite
    const outDir = path.join(projectPath, 'dist', 'resources', 'widgets', widgetName);
    
    // Set base URL: use MCP_URL if set, otherwise relative path
    const baseUrl = mcpUrl 
      ? `${mcpUrl}/mcp-use/widgets/${widgetName}/`
      : `/mcp-use/widgets/${widgetName}/`;
    
    // Extract metadata from widget before building
    let widgetMetadata: any = {};
    try {
      // Use a completely isolated temp directory for metadata extraction to avoid conflicts
      const metadataTempDir = path.join(projectPath, '.mcp-use', `${widgetName}-metadata`);
      await fs.mkdir(metadataTempDir, { recursive: true });
      
      const { createServer } = await import('vite');
      const metadataServer = await createServer({
        root: metadataTempDir,
        cacheDir: path.join(metadataTempDir, '.vite-cache'),
        plugins: [tailwindcss(), react()],
        resolve: {
          alias: {
            '@': resourcesDir,
          },
        },
        server: {
          middlewareMode: true,
        },
        clearScreen: false,
        logLevel: 'silent',
        customLogger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
          warnOnce: () => {},
        },
      });
      
      try {
        const mod = await metadataServer.ssrLoadModule(entry);
        if (mod.widgetMetadata) {
          widgetMetadata = {
            description: mod.widgetMetadata.description,
            inputs: mod.widgetMetadata.inputs?.shape || {},
          };
        }
        // Give a moment for any background esbuild operations to complete
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(chalk.yellow(`    ⚠ Could not extract metadata for ${widgetName}`));
      } finally {
        await metadataServer.close();
        // Clean up metadata temp directory
        try {
          await fs.rm(metadataTempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      // Silently skip metadata extraction if it fails
    }
    
    try {
      
      await build({
        root: tempDir,
        base: baseUrl,
        plugins: [tailwindcss(), react()],
        resolve: {
          alias: {
            '@': resourcesDir,
          },
        },
        build: {
          outDir,
          emptyOutDir: true,
          rollupOptions: {
            input: path.join(tempDir, 'index.html'),
          },
        },
      });
      
      // Save metadata to a JSON file alongside the built widget
      const metadataPath = path.join(outDir, 'metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(widgetMetadata, null, 2), 'utf8');
      
      builtWidgets.push(widgetName);
      console.log(chalk.green(`    ✓ Built ${widgetName}`));
    } catch (error) {
      console.error(chalk.red(`    ✗ Failed to build ${widgetName}:`), error);
    }
  }
  
  return builtWidgets;
}

program
  .command('build')
  .description('Build TypeScript and MCP UI widgets')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .option('--with-inspector', 'Include inspector in production build', false)
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      const { promises: fs } = await import('node:fs');
      
      console.log(chalk.cyan.bold(`mcp-use v${packageJson.version}`));
      
      // Build widgets first (this generates schemas)
      const builtWidgets = await buildWidgets(projectPath);
      
      // Then run tsc (now schemas are available for import)
      console.log(chalk.gray('Building TypeScript...'));
      await runCommand('npx', ['tsc'], projectPath);
      console.log(chalk.green('✓ TypeScript build complete!'));
      
      // Create build manifest
      const manifestPath = path.join(projectPath, 'dist', '.mcp-use-manifest.json');
      const manifest = {
        includeInspector: options.withInspector || false,
        buildTime: new Date().toISOString(),
        widgets: builtWidgets,
      };
      
      await fs.mkdir(path.dirname(manifestPath), { recursive: true });
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(chalk.green('✓ Build manifest created'));
      
      console.log(chalk.green.bold(`\n✓ Build complete!`));
      if (builtWidgets.length > 0) {
        console.log(chalk.gray(`  ${builtWidgets.length} widget(s) built`));
      }
      if (options.withInspector) {
        console.log(chalk.gray('  Inspector included'));
      }
    } catch (error) {
      console.error(chalk.red('Build failed:'), error);
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Run development server with auto-reload and inspector')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .option('--port <port>', 'Server port', '3000')
  .option('--host <host>', 'Server host', 'localhost')
  .option('--no-open', 'Do not auto-open inspector')
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      let port = parseInt(options.port, 10);
      const host = options.host;
      
      console.log(chalk.cyan.bold(`mcp-use v${packageJson.version}`));

      // Check if port is available, find alternative if needed
      if (!(await isPortAvailable(port, host))) {
        console.log(chalk.yellow.bold(`⚠️  Port ${port} is already in use`));
        const availablePort = await findAvailablePort(port, host);
        console.log(chalk.green.bold(`✓ Using port ${availablePort} instead`));
        port = availablePort;
      }

      // // Find the main source file
      const serverFile = await findServerFile(projectPath);

      // Start all processes concurrently
      const processes: any[] = [];
      
      const serverProc = runCommand('npx', ['tsx', 'watch', serverFile], projectPath, {
        PORT: String(port),
        HOST: host,
        NODE_ENV: 'development',
      });
      processes.push(serverProc);

      // Auto-open inspector if enabled
      if (options.open !== false) {
        const startTime = Date.now();
        const ready = await waitForServer(port, host);
        if (ready) {
          const mcpUrl = `http://${host}:${port}/mcp`;
          const inspectorUrl = `http://${host}:${port}/inspector?autoConnect=${encodeURIComponent(mcpUrl)}`;
          const readyTime = Date.now() - startTime;
          console.log(chalk.green.bold(`✓ Ready in ${readyTime}ms`));
          console.log(chalk.whiteBright(`Local:    http://${host}:${port}`));
          console.log(chalk.whiteBright(`Network:  http://${host}:${port}`));
          console.log(chalk.whiteBright(`MCP:      ${mcpUrl}`));
          console.log(chalk.whiteBright(`Inspector: ${inspectorUrl}\n`));
          await open(inspectorUrl);
        }
      }

      // Handle cleanup
      const cleanup = () => {
        console.log(chalk.gray('\n\nShutting down...'));
        processes.forEach(proc => proc.kill());
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep the process running
      await new Promise(() => {});
    } catch (error) {
      console.error(chalk.red('Dev mode failed:'), error);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start production server')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .option('--port <port>', 'Server port', '3000')
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      const port = parseInt(options.port, 10);

      console.log(`\x1b[36m\x1b[1mmcp-use\x1b[0m \x1b[90mVersion: ${packageJson.version}\x1b[0m\n`);

      // Find the built server file
      let serverFile = 'dist/index.js';
      try {
        await access(path.join(projectPath, serverFile));
      } catch {
        serverFile = 'dist/server.js';
      }

      console.log('Starting production server...');
      const serverProc = spawn('node', [serverFile], {
        cwd: projectPath,
        stdio: 'inherit',
        env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
      });

      // Handle cleanup
      const cleanup = () => {
        console.log('\n\nShutting down...');
        serverProc.kill();
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      serverProc.on('exit', (code) => {
        process.exit(code || 0);
      });
    } catch (error) {
      console.error('Start failed:', error);
      process.exit(1);
    }
  });

program.parse();
