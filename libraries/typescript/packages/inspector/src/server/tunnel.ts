import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TUNNEL_URL_REGEX = /https?:\/\/([a-z0-9-]+\.[a-z0-9.-]+)/i;
const SETUP_TIMEOUT_MS = 30_000;

interface TunnelState {
  url: string;
  subdomain: string;
  process: ChildProcess;
}

let serverPort: number | null = null;
let activeTunnel: TunnelState | null = null;

export function setServerPort(port: number) {
  serverPort = port;
}

export function getTunnelStatus(): {
  url: string | null;
  subdomain: string | null;
} {
  if (!activeTunnel) {
    return { url: null, subdomain: null };
  }
  return { url: activeTunnel.url, subdomain: activeTunnel.subdomain };
}

function readSubdomainFromManifest(): string | undefined {
  const projectPath = process.env.MCP_USE_PROJECT_PATH || process.cwd();
  try {
    const raw = readFileSync(
      join(projectPath, "dist", "mcp-use.json"),
      "utf-8"
    );
    const manifest = JSON.parse(raw);
    return manifest?.tunnel?.subdomain || undefined;
  } catch {
    return undefined;
  }
}

export async function startTunnel(
  subdomain?: string
): Promise<{ url: string; subdomain: string }> {
  if (activeTunnel) {
    return { url: activeTunnel.url, subdomain: activeTunnel.subdomain };
  }

  if (!serverPort) {
    throw new Error("Server port not set. Cannot start tunnel.");
  }

  const resolvedSubdomain = subdomain ?? readSubdomainFromManifest();
  const port = serverPort;

  return new Promise((resolve, reject) => {
    console.log(`[Tunnel] Starting tunnel for port ${port}...`);

    const tunnelArgs = ["--yes", "@mcp-use/tunnel", String(port)];
    if (resolvedSubdomain) {
      tunnelArgs.push("--subdomain", resolvedSubdomain);
      console.log(`[Tunnel] Reusing subdomain: ${resolvedSubdomain}`);
    }
    const proc = spawn("npx", tunnelArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let resolved = false;

    const setupTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(new Error("Tunnel setup timed out after 30s"));
      }
    }, SETUP_TIMEOUT_MS);

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      const isShutdownMessage =
        text.includes("Shutting down") || text.includes("🛑");
      if (!isShutdownMessage) {
        process.stdout.write(`[Tunnel] ${text}`);
      }

      const urlMatch = text.match(TUNNEL_URL_REGEX);
      if (urlMatch && !resolved) {
        const url = urlMatch[0];
        const fullDomain = urlMatch[1];
        const subdomainMatch = fullDomain.match(/^([a-z0-9-]+)\./i);
        const extractedSubdomain = subdomainMatch
          ? subdomainMatch[1]
          : fullDomain.split(".")[0];

        resolved = true;
        clearTimeout(setupTimeout);

        activeTunnel = { url, subdomain: extractedSubdomain, process: proc };

        proc.on("exit", () => {
          if (activeTunnel?.process === proc) {
            console.log("[Tunnel] Process exited, clearing state");
            activeTunnel = null;
          }
        });

        console.log(`[Tunnel] Established: ${url}`);
        resolve({ url, subdomain: extractedSubdomain });
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (
        !text.includes("INFO") &&
        !text.includes("bore_cli") &&
        !text.includes("Shutting down")
      ) {
        process.stderr.write(`[Tunnel] ${text}`);
      }
    });

    proc.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(setupTimeout);
        reject(new Error(`Failed to start tunnel: ${error.message}`));
      }
    });

    proc.on("exit", (code) => {
      if (!resolved && code !== 0) {
        resolved = true;
        clearTimeout(setupTimeout);
        reject(new Error(`Tunnel process exited with code ${code}`));
      }
    });
  });
}

export function stopTunnel(): boolean {
  if (!activeTunnel) {
    return false;
  }

  try {
    activeTunnel.process.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  activeTunnel = null;
  console.log("[Tunnel] Stopped");
  return true;
}
