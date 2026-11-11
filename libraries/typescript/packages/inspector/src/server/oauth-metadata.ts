import type { Hono } from "hono";
import {
  isLoopbackInspectorCallback,
  LOCAL_OAUTH_METADATA_PATH,
  OAUTH_METADATA_PATH,
} from "../shared/oauth-metadata.js";

/** Publish public-client metadata before the Inspector's SPA fallback. */
export function registerInspectorOAuthMetadata(app: Hono, basePath = "") {
  const document = (clientId: string, callbackUrl: string, local = false) => ({
    client_id: clientId,
    client_name: local ? "mcp-use Inspector (local)" : "mcp-use Inspector",
    client_uri: "https://mcp-use.com",
    redirect_uris: [callbackUrl],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    ...(local ? { application_type: "native" } : {}),
  });

  // Public deployments may terminate TLS before the Node listener. CIMD IDs
  // always use HTTPS, regardless of the internal request's scheme.
  const publicUrl = (requestUrl: string) => {
    const url = new URL(requestUrl);
    url.protocol = "https:";
    return url;
  };

  app.get(`${basePath}${OAUTH_METADATA_PATH}`, (c) => {
    const url = publicUrl(c.req.url);
    if (url.search)
      return c.json({ error: "Unexpected query parameters" }, 400);
    c.header("Cache-Control", "public, max-age=300");
    return c.json(
      document(url.href, `${url.origin}${basePath}/inspector/oauth/callback`)
    );
  });

  app.get(`${basePath}${LOCAL_OAUTH_METADATA_PATH}/:filename`, (c) => {
    const url = publicUrl(c.req.url);
    const filename = c.req.param("filename");
    if (
      url.search ||
      filename.length > 1400 ||
      !/^[A-Za-z0-9_-]+\.json$/.test(filename)
    ) {
      return c.json({ error: "Invalid local callback" }, 400);
    }
    const encoded = filename.slice(0, -5);
    const callbackUrl = Buffer.from(encoded, "base64url").toString("utf8");
    if (
      Buffer.from(callbackUrl).toString("base64url") !== encoded ||
      !isLoopbackInspectorCallback(callbackUrl)
    ) {
      return c.json({ error: "Invalid local callback" }, 400);
    }
    c.header("Cache-Control", "public, max-age=300");
    return c.json(document(url.href, callbackUrl, true));
  });
}
