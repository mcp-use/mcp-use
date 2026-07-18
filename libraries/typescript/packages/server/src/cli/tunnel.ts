/**
 * Tunnel lifecycle for `mcp-use dev` — spawns `@mcp-use/tunnel`,
 * parses the public URL from stdout, persists the subdomain under
 * `.mcp-use/state/tunnel.json`, and releases it through the tunnel API before
 * reuse.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";

/** Default base URL for the tunnel reservation/release API. */
const DEFAULT_TUNNEL_API = "https://local.mcp-use.run";

/**
 * Base URL of the tunnel API (subdomain reservation/release). Overridable via
 * the `MCP_USE_TUNNEL_API` environment variable.
 */
export function tunnelApiBase(): string {
  return process.env["MCP_USE_TUNNEL_API"] ?? DEFAULT_TUNNEL_API;
}

/** On-disk shape of `.mcp-use/state/tunnel.json`. */
interface TunnelStateFile {
  /** Last successfully assigned tunnel subdomain. */
  subdomain: string;
}

/**
 * Minimal tunnel manager surface used by {@link createDevApiHandler} and
 * {@link runDev}.
 */
export interface TunnelManager {
  /**
   * Start (or attach) a tunnel targeting `port` and return the public origin
   * URL and assigned subdomain.
   */
  start(port: number): Promise<{ url: string; subdomain: string }>;
  /** Stop the tunnel child process and release the subdomain. */
  stop(): Promise<void>;
  /** Current tunnel public origin URL, or `null` when no tunnel is active. */
  status(): { url: string | null };
}

const RESPAWN_BACKOFF_INITIAL_MS = 1_000;
const RESPAWN_BACKOFF_MAX_MS = 30_000;

/**
 * Create a tunnel manager that reads and writes subdomain state at
 * `stateFilePath` (typically `.mcp-use/state/tunnel.json`).
 *
 * @param stateFilePath - Absolute path to the tunnel state JSON file.
 *
 * @example
 * ```ts
 * const tunnel = createTunnelManager(paths.tunnel);
 * const { url } = await tunnel.start(3000);
 * console.log(url); // https://happy-cat.local.mcp-use.run
 * ```
 */
export function createTunnelManager(stateFilePath: string): TunnelManager {
  let proc: ChildProcess | undefined;
  let currentUrl: string | null = null;
  let currentSubdomain: string | undefined;
  let activePort: number | undefined;
  let intentionalStop = false;
  let respawnInFlight: Promise<void> | undefined;
  let respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const markShutdown = (): void => {
    if (
      proc !== undefined &&
      "markShutdown" in proc &&
      typeof (proc as { markShutdown?: () => void }).markShutdown === "function"
    ) {
      (proc as { markShutdown: () => void }).markShutdown();
    }
  };

  const releaseSubdomain = async (subdomain: string): Promise<void> => {
    try {
      await fetch(`${tunnelApiBase()}/api/tunnels/${subdomain}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      // Best-effort cleanup; ignore DELETE failures.
    }
  };

  const loadSavedSubdomain = async (): Promise<string | undefined> => {
    try {
      const content = await readFile(stateFilePath, "utf8");
      const state = JSON.parse(content) as Partial<TunnelStateFile>;
      return typeof state.subdomain === "string" ? state.subdomain : undefined;
    } catch {
      return undefined;
    }
  };

  const persistSubdomain = async (subdomain: string): Promise<void> => {
    try {
      await mkdir(dirname(stateFilePath), { recursive: true });
      await writeFile(
        stateFilePath,
        JSON.stringify({ subdomain } satisfies TunnelStateFile, null, 2),
        "utf8"
      );
    } catch (error) {
      console.warn(
        `[mcp-use] failed to save tunnel subdomain: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  let scheduleRespawn: () => void = () => {};

  const spawnTunnel = (
    port: number,
    subdomain?: string
  ): Promise<{ url: string; subdomain: string; process: ChildProcess }> =>
    new Promise((resolve, reject) => {
      console.log(`[mcp-use] starting tunnel for port ${port}…`);

      const userAgent = process.env["npm_config_user_agent"] ?? "";
      const [tunnelCommand, tunnelArgs] = userAgent.startsWith("pnpm/")
        ? ["pnpm", ["--silent", "dlx", "@mcp-use/tunnel", String(port)]]
        : userAgent.startsWith("bun/")
          ? ["bunx", ["@mcp-use/tunnel", String(port)]]
          : [
              "npx",
              ["--yes", "--prefer-offline", "@mcp-use/tunnel", String(port)],
            ];
      if (subdomain !== undefined) {
        tunnelArgs.push("--subdomain", subdomain);
      }

      const child = spawn(tunnelCommand, tunnelArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      let resolved = false;
      let shuttingDown = false;

      const markChildShutdown = (): void => {
        shuttingDown = true;
      };
      (child as unknown as { markShutdown: () => void }).markShutdown =
        markChildShutdown;

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        const isShutdownMessage =
          text.includes("Shutting down") || text.includes("🛑");
        const isErrorMessage = text.includes("✖") || text.includes("Error:");

        if (!shuttingDown && !isShutdownMessage && !isErrorMessage) {
          process.stdout.write(text);
        }

        const urlMatch = text.match(/https?:\/\/([a-z0-9-]+\.[a-z0-9.-]+)/i);
        if (urlMatch !== null && !resolved) {
          const url = urlMatch[0];
          const fullDomain = urlMatch[1] ?? "";
          const subdomainMatch = fullDomain.match(/^([a-z0-9-]+)\./i);
          let extractedSubdomain =
            subdomainMatch?.[1] ?? fullDomain.split(".")[0] ?? "";
          if (!/^[a-z0-9-]+$/i.test(extractedSubdomain)) {
            console.warn(
              `[mcp-use] warning: extracted subdomain "${extractedSubdomain}" does not match expected format`
            );
            extractedSubdomain = "";
          }
          resolved = true;
          clearTimeout(setupTimeout);
          // No log here — the tunnel child's own stdout (passed through
          // above) already announces the public URL.
          resolve({ url, subdomain: extractedSubdomain, process: child });
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        if (
          !shuttingDown &&
          !text.includes("INFO") &&
          !text.includes("bore_cli") &&
          !text.includes("Shutting down") &&
          // npx inherits pnpm-only npm_config_* env vars (e.g.
          // minimum-release-age, verify-deps-before-run) and warns about
          // every key it doesn't recognize — pure noise for the user.
          !/npm warn Unknown (?:env|project|user|builtin) config/.test(text)
        ) {
          process.stderr.write(data);
        }
      });

      child.on("error", (error) => {
        if (!resolved) {
          clearTimeout(setupTimeout);
          reject(new Error(`Failed to start tunnel: ${error.message}`));
        }
      });

      child.on("exit", (code) => {
        if (code !== 0 && code !== null && !resolved) {
          clearTimeout(setupTimeout);
          reject(new Error(`Tunnel process exited with code ${code}`));
        }
        // The tunnel CLI can exit after setup when its bore connection or
        // server-side registration disappears. Do not keep reporting a dead
        // public URL through dev/info; respawn while dev is still running.
        if (proc === child) {
          proc = undefined;
          currentUrl = null;
          if (intentionalStop) {
            currentSubdomain = undefined;
          } else {
            scheduleRespawn();
          }
        }
      });

      const setupTimeout = setTimeout(() => {
        if (!resolved) {
          child.kill();
          reject(new Error("Tunnel setup timed out"));
        }
      }, 30_000);
    });

  scheduleRespawn = (): void => {
    if (intentionalStop || activePort === undefined || currentUrl !== null) {
      return;
    }
    if (respawnInFlight !== undefined) {
      return;
    }

    respawnInFlight = (async (): Promise<void> => {
      while (
        !intentionalStop &&
        activePort !== undefined &&
        currentUrl === null
      ) {
        console.log("[mcp-use] tunnel disconnected, restarting…");
        const subdomain = currentSubdomain ?? (await loadSavedSubdomain());
        try {
          if (subdomain !== undefined) {
            await releaseSubdomain(subdomain);
          }

          let tunnelInfo: Awaited<ReturnType<typeof spawnTunnel>>;
          try {
            tunnelInfo = await spawnTunnel(activePort, subdomain);
          } catch (error) {
            if (subdomain !== undefined) {
              console.log(
                `[mcp-use] subdomain "${subdomain}" unavailable, requesting a new one…`
              );
              tunnelInfo = await spawnTunnel(activePort, undefined);
            } else {
              throw error;
            }
          }

          proc = tunnelInfo.process;
          currentUrl = tunnelInfo.url;
          currentSubdomain = tunnelInfo.subdomain;
          await persistSubdomain(tunnelInfo.subdomain);
          respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
          return;
        } catch (error) {
          console.warn(
            `[mcp-use] tunnel restart failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await sleep(respawnBackoffMs);
          respawnBackoffMs = Math.min(
            respawnBackoffMs * 2,
            RESPAWN_BACKOFF_MAX_MS
          );
        }
      }
    })().finally(() => {
      respawnInFlight = undefined;
    });
  };

  return {
    status(): { url: string | null } {
      return { url: currentUrl };
    },

    async start(port: number): Promise<{ url: string; subdomain: string }> {
      intentionalStop = false;
      activePort = port;

      if (currentUrl !== null) {
        return {
          url: currentUrl,
          subdomain: currentSubdomain ?? "",
        };
      }

      const existingSubdomain = await loadSavedSubdomain();
      if (existingSubdomain !== undefined) {
        console.log(`[mcp-use] found existing subdomain: ${existingSubdomain}`);
        await releaseSubdomain(existingSubdomain);
      }

      let tunnelInfo: Awaited<ReturnType<typeof spawnTunnel>>;
      try {
        tunnelInfo = await spawnTunnel(port, existingSubdomain);
      } catch (error) {
        if (existingSubdomain !== undefined) {
          console.log(
            `[mcp-use] subdomain "${existingSubdomain}" unavailable, requesting a new one…`
          );
          tunnelInfo = await spawnTunnel(port, undefined);
        } else {
          throw error;
        }
      }

      proc = tunnelInfo.process;
      currentUrl = tunnelInfo.url;
      currentSubdomain = tunnelInfo.subdomain;
      await persistSubdomain(tunnelInfo.subdomain);

      return { url: tunnelInfo.url, subdomain: tunnelInfo.subdomain };
    },

    async stop(): Promise<void> {
      intentionalStop = true;
      markShutdown();

      if (respawnInFlight !== undefined) {
        await respawnInFlight;
      }

      if (currentSubdomain !== undefined) {
        await releaseSubdomain(currentSubdomain);
      }

      if (proc !== undefined) {
        proc.kill("SIGINT");
        proc = undefined;
      }

      activePort = undefined;
      currentUrl = null;
      currentSubdomain = undefined;
      respawnBackoffMs = RESPAWN_BACKOFF_INITIAL_MS;
    },
  };
}
