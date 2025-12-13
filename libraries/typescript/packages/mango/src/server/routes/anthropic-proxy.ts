/**
 * Anthropic API Proxy
 *
 * This proxy injects the API key into requests from the E2B sandbox.
 * The sandbox never sees the actual API key - it just sends requests
 * to this proxy endpoint, and we add authentication before forwarding.
 *
 * Security benefits:
 * - API key stays on the server, never in sandbox
 * - Can log/audit all agent requests
 * - Can enforce rate limits per user
 * - Can block specific endpoints if needed
 */
import { Hono } from "hono";

export const anthropicProxyRoutes = new Hono();

/**
 * Proxy all requests to Anthropic API
 * Handles: /api/anthropic-proxy/v1/messages, etc.
 */
anthropicProxyRoutes.all("/*", async (c) => {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey) {
    console.error("❌ ANTHROPIC_API_KEY not configured for proxy");
    return c.json({ error: "API key not configured" }, 500);
  }

  // Get the path after /api/anthropic-proxy
  const path = c.req.path.replace("/api/anthropic-proxy", "");
  const targetUrl = `https://api.anthropic.com${path}`;

  console.log(`🔄 Proxying ${c.req.method} ${path} → Anthropic API`);

  try {
    // Clone headers, add API key
    const headers = new Headers();

    // Copy relevant headers from original request
    const originalHeaders = c.req.raw.headers;
    for (const [key, value] of originalHeaders.entries()) {
      // Skip headers that shouldn't be forwarded
      if (
        key.toLowerCase() === "host" ||
        key.toLowerCase() === "content-length" ||
        key.toLowerCase() === "x-api-key"
      ) {
        continue;
      }
      headers.set(key, value);
    }

    // Inject API key (this is the key security feature)
    headers.set("x-api-key", anthropicApiKey);
    headers.set("anthropic-version", "2023-06-01");

    // Ensure content-type is set for POST requests
    if (c.req.method === "POST" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    // Forward request to Anthropic
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body:
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? c.req.raw.body
          : undefined,
      // @ts-ignore - duplex is needed for streaming request bodies
      duplex: "half",
    });

    console.log(`✅ Anthropic responded: ${response.status}`);

    // Create response headers
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      // Skip problematic headers
      if (
        key.toLowerCase() === "content-encoding" ||
        key.toLowerCase() === "transfer-encoding"
      ) {
        continue;
      }
      responseHeaders.set(key, value);
    }

    // Stream response back (important for /v1/messages streaming)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`❌ Proxy error: ${error.message}`);
    return c.json(
      {
        error: "Proxy error",
        details: error.message,
      },
      502
    );
  }
});
