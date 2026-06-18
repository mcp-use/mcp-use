import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpUseAPI } from "../src/utils/api.js";
import {
  gitHubInstallUrl,
  promptGitHubInstallation,
  resolveInstallFlowMode,
} from "../src/commands/deploy.js";

/**
 * Unit tests for the MCP-2243 deploy GitHub-App installation flow. The deploy
 * command now surfaces the install URL up front and chooses how to proceed
 * based on the `--yes` flag and whether stdin is an interactive TTY — so an
 * agent or CI run never hangs on an unanswerable prompt.
 */

describe("gitHubInstallUrl", () => {
  it("builds the install page URL for the resolved app slug", () => {
    expect(gitHubInstallUrl("mcp-use")).toBe(
      "https://github.com/apps/mcp-use/installations/new"
    );
  });

  it("respects non-production app slugs", () => {
    expect(gitHubInstallUrl("mcp-use-dev")).toBe(
      "https://github.com/apps/mcp-use-dev/installations/new"
    );
    expect(gitHubInstallUrl("mcp-use-local")).toBe(
      "https://github.com/apps/mcp-use-local/installations/new"
    );
  });
});

describe("resolveInstallFlowMode", () => {
  it("returns 'auto' when --yes is set, regardless of TTY", () => {
    expect(resolveInstallFlowMode({ yes: true, isTTY: true })).toBe("auto");
    expect(resolveInstallFlowMode({ yes: true, isTTY: false })).toBe("auto");
  });

  it("returns 'interactive' for a TTY without --yes", () => {
    expect(resolveInstallFlowMode({ yes: false, isTTY: true })).toBe(
      "interactive"
    );
  });

  it("returns 'non-interactive' without a TTY or --yes (agent/CI)", () => {
    expect(resolveInstallFlowMode({ yes: false, isTTY: false })).toBe(
      "non-interactive"
    );
  });
});

/**
 * Drives the real promptGitHubInstallation() through the non-interactive path
 * (no TTY, no --yes) — the agent/CI scenario from MCP-2243. We assert it prints
 * the install URL and bails cleanly, rather than blocking on a prompt. A
 * stubbed API supplies the app slug; reaching the prompt or `open()` would hang
 * the test, so the absence of a hang is itself part of what's verified.
 */
describe("promptGitHubInstallation (non-interactive)", () => {
  const originalIsTTY = process.stdin.isTTY;
  let logs: string[];

  function fakeApi(appName = "mcp-use"): McpUseAPI {
    return {
      getGitHubAppName: vi.fn(async () => appName),
    } as unknown as McpUseAPI;
  }

  const reauth = async (): Promise<McpUseAPI> => {
    throw new Error("reauth should not be called in this flow");
  };

  beforeEach(() => {
    logs = [];
    // Force the non-interactive branch regardless of the real test runner stdio.
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it("prints the install URL and exits cleanly for a missing connection", async () => {
    const api = fakeApi();
    const result = await promptGitHubInstallation(
      api,
      "not_connected",
      undefined,
      {
        reauth,
      }
    );

    expect(result.ok).toBe(false);
    const output = logs.join("\n");
    expect(output).toContain(
      "https://github.com/apps/mcp-use/installations/new"
    );
    expect(output).toContain("GitHub account not connected");
    expect(output).toContain("re-run");
  });

  it("prints the install URL for a repo the app cannot access", async () => {
    const api = fakeApi();
    const result = await promptGitHubInstallation(
      api,
      "no_access",
      "acme/widget",
      {
        reauth,
      }
    );

    expect(result.ok).toBe(false);
    const output = logs.join("\n");
    expect(output).toContain(
      "https://github.com/apps/mcp-use/installations/new"
    );
    expect(output).toContain("acme/widget");
  });

  it("uses the resolved non-production app slug in the URL", async () => {
    const api = fakeApi("mcp-use-dev");
    await promptGitHubInstallation(api, "not_connected", undefined, { reauth });

    expect(logs.join("\n")).toContain(
      "https://github.com/apps/mcp-use-dev/installations/new"
    );
  });
});
