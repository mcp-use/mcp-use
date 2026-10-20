import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerInspectorOAuthMetadata } from "../../src/server/oauth-metadata.js";
import { registerInspectorShell } from "../../src/server/inspector-shell.js";
import { createDevApiApp } from "../../src/server/create-dev-api-app.js";
import {
  getInspectorClientMetadataUrl,
  HOSTED_INSPECTOR_ORIGIN,
  LOCAL_OAUTH_METADATA_PATH,
} from "../../src/shared/oauth-metadata.js";

describe("Inspector CIMD", () => {
  const app = new Hono();
  registerInspectorOAuthMetadata(app);
  registerInspectorOAuthMetadata(app, "/custom/mcp");

  it.each([
    "https://inspector.example.com/inspector/oauth/callback",
    "https://inspector.example.com/custom/mcp/inspector/oauth/callback",
    "http://localhost:8080/inspector/oauth/callback",
    "http://localhost:8081/inspector/oauth/callback",
    "http://127.0.0.1:49152/mcp/inspector/oauth/callback",
    "http://[::1]:65535/custom/mcp/inspector/oauth/callback",
    "https://localhost:9443/mcp/inspector/oauth/callback",
  ])("serves an exact public-client document for %s", async (callbackUrl) => {
    const clientId = getInspectorClientMetadataUrl(callbackUrl)!;
    const response = await app.request(clientId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      client_id: clientId,
      client_name: callbackUrl.includes("inspector.example.com")
        ? "mcp-use Inspector"
        : "mcp-use Inspector (local)",
      client_uri: "https://mcp-use.com",
      redirect_uris: [callbackUrl],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      ...(callbackUrl.includes("inspector.example.com")
        ? {}
        : { application_type: "native" }),
    });
    expect(new URL(clientId).protocol).toBe("https:");
    expect(new URL(clientId).search).toBe("");
    if (
      callbackUrl.includes("localhost") ||
      callbackUrl.includes("127.0.0.1")
    ) {
      expect(new URL(clientId).origin).toBe(HOSTED_INSPECTOR_ORIGIN);
    }
  });

  it.each([
    "https://evil.example/inspector/oauth/callback",
    "http://localhost.evil.example:8080/inspector/oauth/callback",
    "http://192.168.1.10:8080/inspector/oauth/callback",
    "http://127.0.0.2:8080/inspector/oauth/callback",
    "http://user:password@localhost:8080/inspector/oauth/callback",
    "http://localhost:8080/inspector/oauth/callback?next=https://evil.example",
    "http://localhost:8080/inspector/oauth/callback#fragment",
    "http://localhost:8080/other/callback",
    "http://localhost:8080/a/../inspector/oauth/callback",
    "http://2130706433:8080/inspector/oauth/callback",
    // eslint-disable-next-line no-script-url -- Rejected URL, never evaluated.
    "javascript:alert(1)",
    "not a URL",
  ])("rejects an unsafe local metadata callback: %s", async (callback) => {
    const encoded = Buffer.from(callback).toString("base64url");
    const response = await app.request(
      `${HOSTED_INSPECTOR_ORIGIN}${LOCAL_OAUTH_METADATA_PATH}/${encoded}.json`
    );
    expect(response.status).toBe(400);
  });

  it.each(["!.json", "a.json", "a".repeat(1401) + ".json"])(
    "rejects malformed callback encodings",
    async (filename) => {
      const response = await app.request(
        `${HOSTED_INSPECTOR_ORIGIN}${LOCAL_OAUTH_METADATA_PATH}/${filename}`
      );
      expect(response.status).toBe(400);
    }
  );

  it("does not select CIMD for insecure remote or invalid callbacks", () => {
    for (const callback of [
      "http://inspector.example.com/inspector/oauth/callback",
      "http://192.168.1.10:8080/inspector/oauth/callback",
      "https://inspector.example.com/inspector/oauth/callback?query=1",
      "https://user@inspector.example.com/inspector/oauth/callback",
      "not a URL",
    ]) {
      expect(getInspectorClientMetadataUrl(callback)).toBeUndefined();
    }
  });

  it("uses HTTPS when public TLS terminates before the listener", async () => {
    const response = await app.request(
      "http://inspector.example.com/inspector/oauth/client-metadata.json"
    );
    expect(await response.json()).toMatchObject({
      client_id:
        "https://inspector.example.com/inspector/oauth/client-metadata.json",
      redirect_uris: ["https://inspector.example.com/inspector/oauth/callback"],
    });
  });

  it("rejects query parameters instead of publishing a different client ID", async () => {
    const clientId = getInspectorClientMetadataUrl(
      "http://localhost:8080/inspector/oauth/callback"
    )!;
    for (const url of [
      clientId,
      "https://inspector.example.com/inspector/oauth/client-metadata.json",
    ]) {
      expect(
        (await app.request(`${url}?redirect_uri=https://evil.example`)).status
      ).toBe(400);
    }
  });

  it("registers JSON before the standalone and mounted SPA fallbacks", async () => {
    for (const basePath of ["", "/mcp", "/custom/mcp"]) {
      const shell = new Hono();
      registerInspectorShell(shell, {}, basePath);
      const clientId = getInspectorClientMetadataUrl(
        `https://inspector.example.com${basePath}/inspector/oauth/callback`
      )!;
      const response = await shell.request(clientId);
      expect(response.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(await response.json()).toMatchObject({ client_id: clientId });
    }
  });

  it("serves metadata in the Vite development API", async () => {
    const clientId = getInspectorClientMetadataUrl(
      "http://localhost:3000/inspector/oauth/callback"
    )!;
    const response = await createDevApiApp().request(clientId);
    expect(await response.json()).toMatchObject({ client_id: clientId });
  });
});
