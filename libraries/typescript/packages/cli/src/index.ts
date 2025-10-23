#!/usr/bin/env node
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

program
  .command('build')
  .description('Build TypeScript and MCP UI widgets')
  .option('-p, --path <path>', 'Path to project directory', process.cwd())
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      
      console.log(chalk.cyan.bold(`mcp-use v${packageJson.version}`));
      
      // Build widgets first (this generates schemas)
      // await buildWidgets(projectPath);
      
      // Then run tsc (now schemas are available for import)
      console.log(chalk.gray('Building TypeScript...'));
      await runCommand('npx', ['tsc'], projectPath);
      console.log(chalk.green('✓ TypeScript build complete!'));
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
