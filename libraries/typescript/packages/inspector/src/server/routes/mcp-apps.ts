/**
 * MCP Apps (SEP-1865) Server Routes
 *
 * Provides endpoints for storing widget data and serving widget HTML.
 * Reuses existing widget storage infrastructure from shared-utils-browser.ts
 */

import type { Hono } from "hono";
import { getWidgetData, storeWidgetData } from "../shared-utils-browser.js";

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

// Helper to fetch with retry for cold-start Vite dev server
async function fetchWithRetry(
  url: string,
  maxRetries = 3,
  delay = 1000
): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to fetch after ${maxRetries} retries`);
}

// Sandbox proxy HTML (inlined to avoid file path issues at runtime)
const SANDBOX_PROXY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src * 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * blob: data: 'unsafe-inline'; connect-src * data: blob: about:; frame-src * blob: data: http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*;"
    />
    <title>MCP Apps Sandbox Proxy</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
      * { box-sizing: border-box; }
      iframe { display: block; background-color: transparent; border: 0px none transparent; padding: 0px; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <script>
      function sanitizeDomain(domain) {
        if (typeof domain !== "string") return "";
        return domain.replace(/['"<>;]/g, "").trim();
      }

      function buildAllowAttribute(permissions) {
        if (!permissions) return "";
        const allowList = [];
        if (permissions.camera) allowList.push("camera *");
        if (permissions.microphone) allowList.push("microphone *");
        if (permissions.geolocation) allowList.push("geolocation *");
        if (permissions.clipboardWrite) allowList.push("clipboard-write *");
        return allowList.join("; ");
      }

      function buildCSP(csp) {
        if (!csp) {
          return [
            "default-src 'none'",
            "script-src 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            "img-src data:",
            "font-src data:",
            "media-src data:",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
          ].join("; ");
        }

        const connectDomains = (csp.connectDomains || []).map(sanitizeDomain).filter(Boolean);
        const resourceDomains = (csp.resourceDomains || []).map(sanitizeDomain).filter(Boolean);
        const frameDomains = (csp.frameDomains || []).map(sanitizeDomain).filter(Boolean);
        const baseUriDomains = (csp.baseUriDomains || []).map(sanitizeDomain).filter(Boolean);

        const connectSrc = connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
        const resourceSrc = resourceDomains.length > 0 ? ["data:", "blob:", ...resourceDomains].join(" ") : "data: blob:";
        const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
        const baseUri = baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";

        return [
          "default-src 'none'",
          "script-src 'unsafe-inline' " + resourceSrc,
          "style-src 'unsafe-inline' " + resourceSrc,
          "img-src " + resourceSrc,
          "font-src " + resourceSrc,
          "media-src " + resourceSrc,
          "connect-src " + connectSrc,
          "frame-src " + frameSrc,
          "object-src 'none'",
          "base-uri " + baseUri,
        ].join("; ");
      }

      function buildViolationListenerScript() {
        return \`<script>
document.addEventListener('securitypolicyviolation', function(e) {
  var violation = {
    type: 'mcp-apps:csp-violation',
    directive: e.violatedDirective,
    blockedUri: e.blockedURI,
    sourceFile: e.sourceFile || null,
    lineNumber: e.lineNumber || null,
    columnNumber: e.columnNumber || null,
    effectiveDirective: e.effectiveDirective,
    originalPolicy: e.originalPolicy,
    disposition: e.disposition,
    timestamp: Date.now()
  };
  console.warn('[MCP Apps CSP Violation]', violation.directive, ':', violation.blockedUri);
  window.parent.postMessage(violation, '*');
});
</\` + \`script>\`;
      }

      function injectCSP(html, cspValue) {
        const cspMeta = '<meta http-equiv="Content-Security-Policy" content="' + cspValue + '">';
        const violationListener = buildViolationListenerScript();
        const injection = cspMeta + violationListener;

        if (html.includes("<head>")) {
          return html.replace("<head>", "<head>" + injection);
        } else if (html.includes("<HEAD>")) {
          return html.replace("<HEAD>", "<HEAD>" + injection);
        } else if (html.includes("<html>")) {
          return html.replace("<html>", "<html><head>" + injection + "</head>");
        } else if (html.includes("<HTML>")) {
          return html.replace("<HTML>", "<HTML><head>" + injection + "</head>");
        } else if (html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
          return html.replace(/(<!DOCTYPE[^>]*>|<!doctype[^>]*>)/i, "$1<head>" + injection + "</head>");
        } else {
          return injection + html;
        }
      }

      const inner = document.createElement("iframe");
      inner.style = "width:100%; height:100%; border:none;";
      inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      document.body.appendChild(inner);

      window.addEventListener("message", async (event) => {
        if (event.source === window.parent) {
          if (event.data && event.data.method === "ui/notifications/sandbox-resource-ready") {
            const { html, sandbox, csp, permissions, permissive } = event.data.params || {};
            if (typeof sandbox === "string") {
              inner.setAttribute("sandbox", sandbox);
            }
            const allowAttribute = buildAllowAttribute(permissions);
            if (allowAttribute) {
              inner.setAttribute("allow", allowAttribute);
            }
            if (typeof html === "string") {
              if (permissive) {
                const permissiveCsp = [
                  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: about:",
                  "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
                  "style-src * 'unsafe-inline' data: blob:",
                  "img-src * data: blob: https: http:",
                  "media-src * data: blob: https: http:",
                  "font-src * data: blob: https: http:",
                  "connect-src * data: blob: https: http: ws: wss: about:",
                  "frame-src * data: blob: https: http: about:",
                  "object-src * data: blob:",
                  "base-uri *",
                  "form-action *",
                ].join("; ");
                const processedHtml = injectCSP(html, permissiveCsp);
                inner.srcdoc = processedHtml;
              } else {
                const cspValue = buildCSP(csp);
                const processedHtml = injectCSP(html, cspValue);
                inner.srcdoc = processedHtml;
              }
            }
          } else {
            if (inner && inner.contentWindow) {
              inner.contentWindow.postMessage(event.data, "*");
            }
          }
        } else if (event.source === inner.contentWindow) {
          window.parent.postMessage(event.data, "*");
        }
      });

      window.parent.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-proxy-ready",
        params: {},
      }, "*");
    </script>
  </body>
</html>`;

/**
 * Register MCP Apps routes on the provided Hono app
 */
export function registerMcpAppsRoutes(app: Hono) {
  // Store widget data - reuses existing storeWidgetData function
  app.post("/inspector/api/mcp-apps/widget/store", async (c) => {
    try {
      const body = await c.req.json();
      const result = storeWidgetData({
        ...body,
        protocol: "mcp-apps", // Tag as MCP Apps protocol
      });

      if (!result.success) {
        return c.json(result, 400);
      }

      return c.json(result);
    } catch (error) {
      console.error("[MCP Apps] Error storing widget data:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  // Serve widget content with CSP metadata (SEP-1865)
  app.get("/inspector/api/mcp-apps/widget-content/:toolId", async (c) => {
    try {
      const toolId = c.req.param("toolId");
      const cspModeParam = c.req.query("csp_mode") as
        | "permissive"
        | "widget-declared"
        | undefined;

      const widgetData = getWidgetData(toolId);

      if (!widgetData) {
        return c.json({ error: "Widget data not found or expired" }, 404);
      }

      const { resourceData, mcpAppsCsp, mcpAppsPermissions } = widgetData;

      // Extract HTML content from the pre-fetched resource data
      let htmlContent = "";
      let mimeType: string | undefined;

      const contentsArray = Array.isArray(resourceData?.contents)
        ? resourceData.contents
        : [];

      const firstContent = contentsArray[0];
      if (firstContent) {
        mimeType = firstContent.mimeType;
        if (typeof firstContent.text === "string") {
          htmlContent = firstContent.text;
        } else if (typeof firstContent.blob === "string") {
          htmlContent = Buffer.from(firstContent.blob, "base64").toString(
            "utf-8"
          );
        }
      }

      if (!htmlContent) {
        return c.json({ error: "No HTML content in resource" }, 404);
      }

      // SEP-1865: Validate MIME type
      const mimeTypeValid = mimeType === RESOURCE_MIME_TYPE;
      const mimeTypeWarning = !mimeTypeValid
        ? mimeType
          ? `Invalid MIME type "${mimeType}" - SEP-1865 requires "${RESOURCE_MIME_TYPE}"`
          : `Missing MIME type - SEP-1865 requires "${RESOURCE_MIME_TYPE}"`
        : null;

      if (mimeTypeWarning) {
        console.warn("[MCP Apps] MIME type validation:", mimeTypeWarning, {
          resourceUri: widgetData.uri,
        });
      }

      // Determine CSP mode
      const cspMode = cspModeParam || "permissive";
      const isPermissive = cspMode === "permissive";

      // Inject window.__mcpPublicUrl for mcp_url support (needed for useWidget hook)
      let processedHtml = htmlContent;
      if (widgetData.devServerBaseUrl) {
        const injectionScript = `<script>window.__mcpPublicUrl = "${widgetData.devServerBaseUrl}/mcp-use/public";</script>`;

        // Inject after <head> tag if present
        if (processedHtml.includes("<head>")) {
          processedHtml = processedHtml.replace(
            /<head>/i,
            `<head>\n    ${injectionScript}`
          );
        } else {
          // Fallback: inject at the beginning
          processedHtml = injectionScript + processedHtml;
        }
      }

      // Return JSON with HTML and metadata for CSP enforcement
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return c.json({
        html: processedHtml,
        csp: isPermissive ? undefined : mcpAppsCsp,
        permissions: mcpAppsPermissions,
        permissive: isPermissive,
        cspMode,
        mimeType,
        mimeTypeValid,
        mimeTypeWarning,
      });
    } catch (error) {
      console.error("[MCP Apps] Error fetching widget content:", error);
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  });

  // Dev widget content endpoint - fetches live HTML from Vite dev server
  app.get("/inspector/api/mcp-apps/dev-widget-content/:toolId", async (c) => {
    try {
      const toolId = c.req.param("toolId");
      const cspModeParam = c.req.query("csp_mode") as
        | "permissive"
        | "widget-declared"
        | undefined;

      const widgetData = getWidgetData(toolId);

      if (!widgetData?.devWidgetUrl || !widgetData?.devServerBaseUrl) {
        return c.json({ error: "Dev widget data not found or expired" }, 404);
      }

      console.log(
        `[MCP Apps] Fetching live HTML from Vite dev server: ${widgetData.devWidgetUrl}`
      );

      // Fetch HTML from Vite dev server with retry logic for cold starts
      const response = await fetchWithRetry(widgetData.devWidgetUrl);
      if (!response.ok) {
        return c.json(
          { error: `Failed to fetch from dev server (${response.status})` },
          response.status as 400 | 404 | 500
        );
      }

      const htmlContent = await response.text();

      // Determine CSP mode
      const cspMode = cspModeParam || "permissive";
      const isPermissive = cspMode === "permissive";

      // Inject window.__mcpPublicUrl for mcp_url support (needed for useWidget hook)
      let processedHtml = htmlContent;
      if (widgetData.devServerBaseUrl) {
        const injectionScript = `<script>window.__mcpPublicUrl = "${widgetData.devServerBaseUrl}/mcp-use/public";</script>`;

        // Inject after <head> tag if present
        if (processedHtml.includes("<head>")) {
          processedHtml = processedHtml.replace(
            /<head>/i,
            `<head>\n    ${injectionScript}`
          );
        } else {
          // Fallback: inject at the beginning
          processedHtml = injectionScript + processedHtml;
        }
      }

      // Return JSON with fresh HTML from Vite
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return c.json({
        html: processedHtml,
        csp: isPermissive ? undefined : widgetData.mcpAppsCsp,
        permissions: widgetData.mcpAppsPermissions,
        mimeTypeValid: true, // Dev mode widgets always valid
      });
    } catch (error) {
      console.error("[MCP Apps] Error fetching dev widget:", error);
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  });

  // Serve sandbox proxy HTML
  app.get("/inspector/api/mcp-apps/sandbox-proxy", (c) => {
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");

    // Allow cross-origin framing between localhost and 127.0.0.1 for double-iframe architecture
    // Uses wildcard ports so it works regardless of which port the server runs on
    // Also includes production domain wildcards and optional custom domains via env var
    const additionalFrameAncestors = process.env.FRAME_ANCESTORS || "";
    const frameAncestors = [
      "'self'",
      // Local development
      "http://localhost:*",
      "http://127.0.0.1:*",
      "https://localhost:*",
      "https://127.0.0.1:*",
      // Production - allow mcp-use.com subdomain pattern (sandbox-* convention)
      "https://*.mcp-use.com",
      "http://*.mcp-use.com",
      // Custom domains from environment variable
      additionalFrameAncestors,
    ]
      .filter(Boolean)
      .join(" ");

    c.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    // Remove X-Frame-Options as it doesn't support multiple origins (CSP frame-ancestors takes precedence)
    c.res.headers.delete("X-Frame-Options");
    return c.body(SANDBOX_PROXY_HTML);
  });
}
