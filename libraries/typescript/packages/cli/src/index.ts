#!/usr/bin/env node
import { Command } from 'commander';
import { buildWidgets } from './build';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import open from 'open';
const program = new Command();


const packageContent = readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
const packageJson = JSON.parse(packageContent)
const packageVersion = packageJson.version || 'unknown'


program
  .name('mcp-use')
  .description('MCP CLI tool')
  .version(packageVersion);

// Helper to check if port is available
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`);
    return false; // Port is in use
  } catch {
    return true; // Port is available
  }
}

// Helper to find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('No available ports found');
}

// Helper to check if server is ready
async function waitForServer(port: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/inspector`);
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
function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
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

program
  .command('build')
  .description('Build TypeScript and MCP UI widgets')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      
      console.log(`\x1b[36m\x1b[1mmcp-use\x1b[0m \x1b[90mVersion: ${packageJson.version}\x1b[0m\n`);
      
      // Build widgets first (this generates schemas)
      await buildWidgets(projectPath, false);
      
      // Then run tsc (now schemas are available for import)
      console.log('Building TypeScript...');
      await runCommand('npx', ['tsc'], projectPath);
      console.log('\x1b[32m✓\x1b[0m TypeScript build complete!');
    } catch (error) {
      console.error('Build failed:', error);
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Run development server with auto-reload and inspector')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .option('--port <port>', 'Server port', '3000')
  .option('--no-open', 'Do not auto-open inspector')
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      let port = parseInt(options.port, 10);
      
      console.log(`\x1b[36m\x1b[1mmcp-use\x1b[0m \x1b[90mVersion: ${packageJson.version}\x1b[0m\n`);

      // Check if port is available, find alternative if needed
      if (!(await isPortAvailable(port))) {
        console.log(`\x1b[33m⚠️  Port ${port} is already in use\x1b[0m`);
        const availablePort = await findAvailablePort(port);
        console.log(`\x1b[32m✓\x1b[0m Using port ${availablePort} instead`);
        port = availablePort;
      }

      // Find the main source file
      let serverFile = 'index.ts';
      try {
        await access(path.join(projectPath, serverFile));
      } catch {
        serverFile = 'src/server.ts';
      }

      // Start all processes concurrently
      const processes: any[] = [];
      
      // 1. TypeScript watch
      const tscProc = spawn('npx', ['tsc', '--watch'], {
        cwd: projectPath,
        stdio: 'pipe',
        shell: false,
      });
      
      let tscReady = false;
      tscProc.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Watching for file changes') && !tscReady) {
          console.log('\x1b[32m✓\x1b[0m TypeScript compiler watching...');
          tscReady = true;
        }
        // Forward other TypeScript output
        if (!output.includes('Watching for file changes') && output.trim()) {
          process.stdout.write(output);
        }
      });
      
      tscProc.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });
      
      processes.push(tscProc);

      // 2. Widget builder watch - run in background
      buildWidgets(projectPath, true).catch((error) => {
        console.error('Widget builder failed:', error);
      });

      // Wait a bit for initial builds
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Server with tsx
      console.log(`\x1b[32m✓\x1b[0m Starting server with tsx watch ${serverFile}...`);
      const serverProc = spawn('npx', ['tsx', 'watch', serverFile], {
        cwd: projectPath,
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, PORT: String(port) },
      });
      
      serverProc.on('error', (err) => {
        console.error('\x1b[31m✗\x1b[0m Server process error:', err);
      });
      
      serverProc.on('exit', (code, signal) => {
        if (code !== null && code !== 0) {
          console.error(`\x1b[31m✗\x1b[0m Server process exited with code ${code}`);
        }
        if (signal) {
          console.error(`\x1b[31m✗\x1b[0m Server process killed with signal ${signal}`);
        }
      });
      
      processes.push(serverProc);

      // Auto-open inspector if enabled
      if (options.open !== false) {
        const startTime = Date.now();
        const ready = await waitForServer(port);
        if (ready) {
          const mcpUrl = `http://localhost:${port}/mcp`;
          const inspectorUrl = `http://localhost:${port}/inspector?autoConnect=${encodeURIComponent(mcpUrl)}`;
          const readyTime = Date.now() - startTime;
          console.log(`\n\x1b[32m✓\x1b[0m Ready in ${readyTime}ms`);
          console.log(`Local:    http://localhost:${port}`);
          console.log(`Network:  http://localhost:${port}`);
          console.log(`MCP:      ${mcpUrl}`);
          console.log(`Inspector: ${inspectorUrl}\n`);
          await open(inspectorUrl);
        }
      }

      // Handle cleanup
      const cleanup = () => {
        console.log('\n\nShutting down...');
        processes.forEach(proc => proc.kill());
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep the process running
      await new Promise(() => {});
    } catch (error) {
      console.error('Dev mode failed:', error);
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
        env: { ...process.env, PORT: String(port) },
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
