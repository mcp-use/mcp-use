import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpUseAPI } from "../src/utils/api.js";

/**
 * Unit tests for the MCP-2467 deploy repo-access check. The CLI now asks the
 * backend an authoritative, per-installation `repos/:owner/:repo/access`
 * question (single GitHub `repos.get`) instead of listing/paginating repos,
 * which previously missed repos on later pages and hung on very large orgs.
 */

interface Installation {
  id: string;
  installationId: string;
  login: string;
  type: string;
}

function makeApi(): McpUseAPI {
  // orgId is set so resolveOrganizationId() short-circuits without a network call.
  return new McpUseAPI("https://api.test", "key", "org-123");
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Routes fetch calls: the installations list endpoint returns `installations`,
 * and each `.../repos/:owner/:repo/access` endpoint resolves to `accessByInst`
 * keyed on installationId (defaults to false / 404 when absent).
 */
function installFetch(
  installations: Installation[],
  accessByInst: Record<string, boolean>
): { calls: string[] } {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("/github/installations?")) {
      return jsonResponse({
        installations: installations.map((i) => ({
          id: i.id,
          installationId: i.installationId,
          account: { login: i.login, avatar_url: null, type: i.type },
        })),
      });
    }
    const m = url.match(
      /\/github\/installations\/([^/]+)\/repos\/[^/]+\/[^/]+\/access$/
    );
    if (m) {
      const instId = m[1]!;
      const hasAccess = accessByInst[instId] ?? false;
      if (!hasAccess) return jsonResponse({ error: "Not Found" }, 404);
      return jsonResponse({ hasAccess: true });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

const ORG_INSTALL: Installation = {
  id: "db-org",
  installationId: "1001",
  login: "acme",
  type: "Organization",
};
const USER_INSTALL: Installation = {
  id: "db-user",
  installationId: "2002",
  login: "octocat",
  type: "User",
};

describe("McpUseAPI.checkGitHubRepoAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true via the owner-matched installation and queries it first", async () => {
    // Owner-matched installation listed second to prove ordering puts it first.
    const { calls } = installFetch([USER_INSTALL, ORG_INSTALL], {
      "1001": true,
    });
    const api = makeApi();

    await expect(api.checkGitHubRepoAccess("acme", "widget")).resolves.toBe(
      true
    );

    const accessCalls = calls.filter((u) => u.includes("/access"));
    // First access check hits the owner-matched org installation and matches,
    // so the non-matching user installation is never queried.
    expect(accessCalls).toHaveLength(1);
    expect(accessCalls[0]).toBe(
      "https://api.test/github/installations/1001/repos/acme/widget/access"
    );
  });

  it("finds the repo via a non-owner installation when the owner-matched one has no access", async () => {
    // Repo owner "acme" has no matching installation login; access is granted
    // through the "octocat" installation instead (MCP-2358 cross-installation).
    const { calls } = installFetch([ORG_INSTALL, USER_INSTALL], {
      "2002": true,
    });
    const api = makeApi();

    await expect(api.checkGitHubRepoAccess("acme", "widget")).resolves.toBe(
      true
    );
    const accessCalls = calls.filter((u) => u.includes("/access"));
    expect(accessCalls.length).toBeGreaterThanOrEqual(1);
    expect(accessCalls).toContain(
      "https://api.test/github/installations/2002/repos/acme/widget/access"
    );
  });

  it("returns false when no installation can access the repo", async () => {
    installFetch([ORG_INSTALL, USER_INSTALL], {});
    const api = makeApi();

    await expect(api.checkGitHubRepoAccess("acme", "ghost")).resolves.toBe(
      false
    );
  });

  it("returns false when there are no installations", async () => {
    const { calls } = installFetch([], {});
    const api = makeApi();

    await expect(api.checkGitHubRepoAccess("acme", "widget")).resolves.toBe(
      false
    );
    expect(calls.filter((u) => u.includes("/access"))).toHaveLength(0);
  });
});
