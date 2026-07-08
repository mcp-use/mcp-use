/**
 * MCP Apps (SEP-1865) Server Routes
 *
 * Serves the double-iframe sandbox proxy. Guest HTML is resolved client-side;
 * AppFrame posts `ui/notifications/sandbox-resource-ready` with `{ html, csp }`.
 * CSP mode / permissions / declared CSP arrive as URL query params on this page
 * (we omit SandboxConfig.csp so AppFrame does not add a competing `csp` param).
 */

import type { Hono } from "hono";

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
        const scriptDirectives = (csp.scriptDirectives || []).filter(function(d) { return typeof d === "string" && d.length > 0; });

        const connectSrc = connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
        const resourceSrc = resourceDomains.length > 0 ? ["data:", "blob:", ...resourceDomains].join(" ") : "data: blob:";
        const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
        const baseUri = baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";
        const scriptSrcParts = ["'unsafe-inline'", resourceSrc];
        if (scriptDirectives.length > 0) scriptSrcParts.push(scriptDirectives.join(" "));

        return [
          "default-src 'none'",
          "script-src " + scriptSrcParts.join(" "),
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

function serializeConsoleArgs(args) {
  try {
    return Array.from(args || []).map(function(arg) {
      if (arg instanceof Error) {
        return {
          type: 'Error',
          message: arg.message,
          stack: arg.stack,
          name: arg.name,
        };
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.parse(JSON.stringify(arg));
        } catch (e) {
          return String(arg);
        }
      }
      return arg;
    });
  } catch (e) {
    return [String(args)];
  }
}

function sendConsoleToParent(level, args) {
  try {
    window.parent.postMessage({
      type: 'iframe-console-log',
      level: level,
      args: serializeConsoleArgs(args),
      timestamp: new Date().toISOString(),
      url: window.location.href,
    }, '*');
  } catch (e) {}
}

var originalConsoleError = console.error.bind(console);
console.error = function() {
  var args = Array.from(arguments);
  originalConsoleError.apply(console, args);
  sendConsoleToParent('error', args);
};

window.addEventListener('error', function(event) {
  sendConsoleToParent('error', [{
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error ? {
      message: event.error.message,
      stack: event.error.stack,
      name: event.error.name,
    } : null,
  }]);
});

window.addEventListener('unhandledrejection', function(event) {
  sendConsoleToParent('error', [{
    message: 'Unhandled Promise Rejection',
    reason: event.reason ? String(event.reason) : 'Unknown',
    error: event.reason instanceof Error ? {
      message: event.reason.message,
      stack: event.reason.stack,
      name: event.reason.name,
    } : null,
  }]);
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

      // Query params from host (csp_mode, permissions, widget_csp). AppFrame only
      // sends { html, csp } in sandbox-resource-ready; we carry the rest on the URL.
      const query = new URLSearchParams(location.search);
      const queryCspMode = query.get("csp_mode") || "permissive";
      let queryPermissions = null;
      let queryWidgetCsp = null;
      try {
        const rawPerm = query.get("permissions");
        if (rawPerm) queryPermissions = JSON.parse(rawPerm);
      } catch (e) {}
      try {
        const rawCsp = query.get("widget_csp");
        if (rawCsp) queryWidgetCsp = JSON.parse(rawCsp);
      } catch (e) {}

      const inner = document.createElement("iframe");
      inner.style = "width:100%; height:100%; border:none;";
      inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      document.body.appendChild(inner);

      window.addEventListener("message", async (event) => {
        if (event.source === window.parent) {
          if (event.data && event.data.method === "ui/notifications/sandbox-resource-ready") {
            const params = event.data.params || {};
            const html = params.html;
            const sandbox = params.sandbox;
            // Prefer message csp when present; fall back to URL widget_csp
            const csp = params.csp != null ? params.csp : queryWidgetCsp;
            const permissions = params.permissions != null ? params.permissions : queryPermissions;
            const permissive =
              typeof params.permissive === "boolean"
                ? params.permissive
                : queryCspMode === "permissive";
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
export function registerMcpAppsRoutes(app: Hono, basePath: string = "") {
  // All MCP Apps routes relocate under the server-wide basePath.
  const p = (suffix: string) => `${basePath}${suffix}`;

  // Serve sandbox proxy HTML
  app.get(p("/inspector/api/mcp-apps/sandbox-proxy"), (c) => {
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");

    // When FRAME_ANCESTORS is set: extend the built-in list (backward compatible). When unset: allow all (*).
    const additionalFrameAncestors = process.env.FRAME_ANCESTORS || "";
    const frameAncestors = additionalFrameAncestors
      ? [
          "'self'",
          "http://localhost:*",
          "http://127.0.0.1:*",
          "https://localhost:*",
          "https://127.0.0.1:*",
          additionalFrameAncestors,
        ]
          .filter(Boolean)
          .join(" ")
      : "*";

    c.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    // Remove X-Frame-Options as it doesn't support multiple origins (CSP frame-ancestors takes precedence)
    c.res.headers.delete("X-Frame-Options");
    return c.body(SANDBOX_PROXY_HTML);
  });
}
