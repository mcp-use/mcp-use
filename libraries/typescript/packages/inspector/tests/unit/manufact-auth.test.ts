import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
const popup = { closed: false, close: vi.fn(), location: { href: "" } };
const opener = { postMessage: vi.fn() };

vi.stubGlobal("crypto", webcrypto);
vi.stubGlobal("CustomEvent", class {
  constructor(public type: string) {}
});
vi.stubGlobal("window", {
  location: {
    origin: "http://localhost:3005",
    href: "http://localhost:3005/inspector",
  },
  localStorage,
  open: vi.fn(() => popup),
  opener,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  setInterval: vi.fn(() => 1),
  clearInterval: vi.fn(),
  setTimeout: vi.fn(() => 1),
  clearTimeout: vi.fn(),
});

const {
  authorizeManufact,
  canShareManufactSession,
  completeManufactAuthorization,
  getManufactAccessToken,
  getSharedManufactSession,
  logoutManufact,
} = await import("../../src/client/auth/manufact-auth");

const metadata = {
  authorization_endpoint: "https://cloud.example/api/auth/oauth2/authorize",
  token_endpoint: "https://cloud.example/api/auth/oauth2/token",
  userinfo_endpoint: "https://cloud.example/api/auth/oauth2/userinfo",
  registration_endpoint: "https://cloud.example/api/auth/oauth2/register",
};

describe("Manufact Inspector OAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    popup.location.href = "";
    popup.closed = false;
    vi.clearAllMocks();
  });

  it("registers a public client, uses PKCE, and completes the code flow", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/get-session")) {
        return Response.json(null);
      }
      if (url.endsWith("openid-configuration")) {
        return Response.json(metadata);
      }
      if (url === metadata.registration_endpoint) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
        });
        return Response.json({ client_id: "inspector-client" }, { status: 201 });
      }
      if (url === metadata.token_endpoint) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code_verifier")).toBeTruthy();
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }
      if (url === metadata.userinfo_endpoint) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer access-token"
        );
        return Response.json({
          sub: "user-1",
          name: "Inspector User",
          email: "user@example.com",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await authorizeManufact(
      "https://cloud.example/api/v1/inspector/chat/stream"
    );
    const authorizationUrl = new URL(popup.location.href);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      metadata.authorization_endpoint
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256"
    );
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();

    authorizationUrl.pathname = "/inspector/auth/callback";
    authorizationUrl.search = new URLSearchParams({
      code: "authorization-code",
      state: authorizationUrl.searchParams.get("state")!,
    }).toString();
    await completeManufactAuthorization(authorizationUrl);

    await expect(
      getManufactAccessToken(
        "https://cloud.example/api/v1/inspector/chat/stream"
      )
    ).resolves.toBe("access-token");
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: "manufact:oauth-complete",
        authOrigin: "https://cloud.example",
      },
      "http://localhost:3005"
    );
  });

  it("shares sessions only across trusted Manufact or local origins", () => {
    expect(
      canShareManufactSession(
        "https://inspector.manufact.com/inspector",
        "https://cloud.manufact.com"
      )
    ).toBe(true);
    expect(
      canShareManufactSession(
        "http://localhost:3005/inspector",
        "http://localhost:8000"
      )
    ).toBe(false);
    expect(
      canShareManufactSession(
        "http://localhost:8000/inspector",
        "http://localhost:8000"
      )
    ).toBe(true);
    expect(
      canShareManufactSession(
        "https://inspector.mcp-use.com/inspector",
        "https://cloud.manufact.com"
      )
    ).toBe(false);
  });

  it("rejects callbacks without a matching state", async () => {
    await expect(
      completeManufactAuthorization(
        new URL(
          "http://localhost:3005/inspector/auth/callback?code=x&state=unknown"
        )
      )
    ).rejects.toThrow("OAuth state is invalid or expired");
  });

  it("reuses a shared Manufact cookie session before OAuth", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.credentials).toBe("include");
      return Response.json({
        user: {
          id: "shared-user",
          name: "Shared Session",
          email: "shared@example.com",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getSharedManufactSession(
        "https://cloud.manufact.com/api/v1/inspector/chat/stream"
      )
    ).resolves.toMatchObject({ id: "shared-user" });
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).endsWith("/api/auth/get-session")
      )
    ).toHaveLength(1);
  });

  it("refreshes an expired access token", async () => {
    localStorage.setItem(
      "mcp-inspector:manufact-auth:client:https://cloud.example",
      JSON.stringify({ client_id: "inspector-client" })
    );
    localStorage.setItem(
      "mcp-inspector:manufact-auth:tokens:https://cloud.example",
      JSON.stringify({
        access_token: "expired-token",
        refresh_token: "refresh-token",
        expires_at: Date.now() - 1,
      })
    );
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("openid-configuration")) return Response.json(metadata);
      if (url === metadata.token_endpoint) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("refresh_token");
        return Response.json({
          access_token: "refreshed-token",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getManufactAccessToken(
        "https://cloud.example/api/v1/inspector/chat/stream"
      )
    ).resolves.toBe("refreshed-token");
  });

  it("revokes OAuth tokens on disconnect without global sign-out", async () => {
    localStorage.setItem(
      "mcp-inspector:manufact-auth:client:https://cloud.example",
      JSON.stringify({ client_id: "inspector-client" })
    );
    localStorage.setItem(
      "mcp-inspector:manufact-auth:tokens:https://cloud.example",
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Date.now() + 3600_000,
      })
    );
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("openid-configuration")) return Response.json(metadata);
      if (url.endsWith("/oauth2/revoke")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_id")).toBe("inspector-client");
        expect(body.get("token")).toBe("refresh-token");
        expect(body.get("token_type_hint")).toBe("refresh_token");
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/api/auth/get-session")) {
        return Response.json({
          user: { id: "still-there", email: "user@example.com" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await logoutManufact(
      "https://cloud.example/api/v1/inspector/chat/stream",
      "oauth"
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://cloud.example/api/auth/sign-out",
      expect.anything()
    );
    expect(
      localStorage.getItem(
        "mcp-inspector:manufact-auth:tokens:https://cloud.example"
      )
    ).toBeNull();
    expect(
      localStorage.getItem(
        "mcp-inspector:manufact-auth:skip-session:https://cloud.example"
      )
    ).toBe("1");
  });

  it("signs out the shared Manufact session via the trusted website origin", async () => {
    const popup = { closed: true };
    vi.mocked(window.open).mockReturnValueOnce(
      popup as unknown as Window
    );
    vi.mocked(window.setInterval).mockImplementation((fn: TimerHandler) => {
      if (typeof fn === "function") fn();
      return 1;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/auth/get-session")) return Response.json(null);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await logoutManufact(
      "https://cloud.manufact.com/api/v1/inspector/chat/stream",
      "session"
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://manufact.com/auth/embedded-sign-out",
      "manufact-sign-out",
      "width=420,height=320"
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://cloud.manufact.com/api/auth/sign-out",
      expect.anything()
    );
  });
});
