import { execFile } from "node:child_process";

type BrowserCommand = {
  command: string;
  args: string[];
};

/**
 * Resolve a validated HTTP(S) URL to a shell-free platform browser command.
 *
 * @internal
 */
export function resolveBrowserCommand(
  value: string,
  platform: NodeJS.Platform = process.platform
): BrowserCommand | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    return undefined;
  }

  const safeUrl = url.toString();
  if (platform === "darwin") {
    return { command: "open", args: [safeUrl] };
  }
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", safeUrl],
    };
  }
  return { command: "xdg-open", args: [safeUrl] };
}

/**
 * Best-effort shell-free launch of an HTTP(S) URL in the default browser.
 *
 * Invalid URLs, credentials-bearing URLs, missing opener programs, and child
 * process failures are ignored because browser launch is only a convenience.
 *
 * @param value - Absolute HTTP(S) URL to open.
 * @internal
 */
export function openBrowser(value: string): void {
  const resolved = resolveBrowserCommand(value);
  if (!resolved) return;

  try {
    const child = execFile(
      resolved.command,
      resolved.args,
      { timeout: 15_000, windowsHide: true },
      () => {}
    );
    child.unref();
  } catch {
    // Browser opening is always best-effort.
  }
}
