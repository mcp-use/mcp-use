/**
 * MCP Apps sandbox-proxy HTML for ViewRenderer blob URLs.
 *
 * Browser-only — no Node/Hono imports. The host iframe loads this document
 * from a blob: URL; it proxies postMessage to the inner widget srcdoc iframe.
 */

import type {
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "./ext-apps-bridge.js";
import type { ViewCspMode } from "./types.js";

type ViewSandboxBlobUrlOptions = {
  cspMode: ViewCspMode;
  permissions?: McpUiResourcePermissions;
  widgetCsp?: McpUiResourceCsp;
};

function applySandboxSearchParams(
  url: URL,
  options: ViewSandboxBlobUrlOptions
): void {
  const { cspMode, permissions, widgetCsp } = options;
  url.searchParams.set(
    "v",
    JSON.stringify({ cspMode, permissions, widgetCsp })
  );
  url.searchParams.set("csp_mode", cspMode);
  if (permissions && Object.keys(permissions).length > 0) {
    url.searchParams.set("permissions", JSON.stringify(permissions));
  }
  if (widgetCsp && Object.keys(widgetCsp).length > 0) {
    url.searchParams.set("widget_csp", JSON.stringify(widgetCsp));
  }
}

/** Build a blob: sandbox iframe URL (no backend sandbox-proxy route). */
export function buildViewSandboxBlobUrl(
  options: ViewSandboxBlobUrlOptions
): URL {
  const searchUrl = new URL("https://sandbox.invalid/");
  applySandboxSearchParams(searchUrl, options);
  const html = buildSandboxProxyBlobHtml(searchUrl.search);
  return new URL(URL.createObjectURL(new Blob([html], { type: "text/html" })));
}

/**
 * Raw sandbox-proxy document (query config via location.search or __SANDBOX_SEARCH__).
 *
 * Inner guest iframe keeps `allow-same-origin` for srcdoc widget rendering;
 * browsers may warn that allow-scripts + allow-same-origin can escape sandboxing.
 */
const SANDBOX_PROXY_HTML: string =
  '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <meta\n      http-equiv="Content-Security-Policy"\n      content="default-src \'self\'; img-src * data: blob: \'unsafe-inline\'; media-src * blob: data:; font-src * blob: data:; script-src * \'wasm-unsafe-eval\' \'unsafe-inline\' \'unsafe-eval\' blob: data:; style-src * blob: data: \'unsafe-inline\'; connect-src * data: blob: about:; frame-src * blob: data: http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*;"\n    />\n    <title>MCP Apps Sandbox Proxy</title>\n    <style>\n      html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }\n      * { box-sizing: border-box; }\n      iframe { display: block; background-color: transparent; border: 0px none transparent; padding: 0px; width: 100%; height: 100%; }\n    </style>\n  </head>\n  <body>\n    <script>\n      function sanitizeDomain(domain) {\n        if (typeof domain !== "string") return "";\n        return domain.replace(/[\'"<>;]/g, "").trim();\n      }\n\n      function buildAllowAttribute(permissions) {\n        if (!permissions) return "";\n        const allowList = [];\n        if (permissions.camera) allowList.push("camera *");\n        if (permissions.microphone) allowList.push("microphone *");\n        if (permissions.geolocation) allowList.push("geolocation *");\n        if (permissions.clipboardWrite) allowList.push("clipboard-write *");\n        return allowList.join("; ");\n      }\n\n      function buildCSP(csp) {\n        if (!csp) {\n          return [\n            "default-src \'none\'",\n            "script-src \'unsafe-inline\'",\n            "style-src \'unsafe-inline\'",\n            "img-src data:",\n            "font-src data:",\n            "media-src data:",\n            "connect-src \'none\'",\n            "frame-src \'none\'",\n            "object-src \'none\'",\n            "base-uri \'none\'",\n          ].join("; ");\n        }\n\n        const connectDomains = (csp.connectDomains || []).map(sanitizeDomain).filter(Boolean);\n        const resourceDomains = (csp.resourceDomains || []).map(sanitizeDomain).filter(Boolean);\n        const frameDomains = (csp.frameDomains || []).map(sanitizeDomain).filter(Boolean);\n        const baseUriDomains = (csp.baseUriDomains || []).map(sanitizeDomain).filter(Boolean);\n        const scriptDirectives = (csp.scriptDirectives || []).filter(function(d) { return typeof d === "string" && d.length > 0; });\n\n        const connectSrc = connectDomains.length > 0 ? connectDomains.join(" ") : "\'none\'";\n        const resourceSrc = resourceDomains.length > 0 ? ["data:", "blob:", ...resourceDomains].join(" ") : "data: blob:";\n        const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "\'none\'";\n        const baseUri = baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "\'none\'";\n        const scriptSrcParts = ["\'unsafe-inline\'", resourceSrc];\n        if (scriptDirectives.length > 0) scriptSrcParts.push(scriptDirectives.join(" "));\n\n        return [\n          "default-src \'none\'",\n          "script-src " + scriptSrcParts.join(" "),\n          "style-src \'unsafe-inline\' " + resourceSrc,\n          "img-src " + resourceSrc,\n          "font-src " + resourceSrc,\n          "media-src " + resourceSrc,\n          "connect-src " + connectSrc,\n          "frame-src " + frameSrc,\n          "object-src \'none\'",\n          "base-uri " + baseUri,\n        ].join("; ");\n      }\n\n      function buildViolationListenerScript() {\n        return `<script>\ndocument.addEventListener(\'securitypolicyviolation\', function(e) {\n  var violation = {\n    type: \'mcp-apps:csp-violation\',\n    directive: e.violatedDirective,\n    blockedUri: e.blockedURI,\n    sourceFile: e.sourceFile || null,\n    lineNumber: e.lineNumber || null,\n    columnNumber: e.columnNumber || null,\n    effectiveDirective: e.effectiveDirective,\n    originalPolicy: e.originalPolicy,\n    disposition: e.disposition,\n    timestamp: Date.now()\n  };\n  console.warn(\'[MCP Apps CSP Violation]\', violation.directive, \':\', violation.blockedUri);\n  window.parent.postMessage(violation, \'*\');\n});\n\nfunction serializeConsoleArgs(args) {\n  try {\n    return Array.from(args || []).map(function(arg) {\n      if (arg instanceof Error) {\n        return {\n          type: \'Error\',\n          message: arg.message,\n          stack: arg.stack,\n          name: arg.name,\n        };\n      }\n      if (typeof arg === \'object\' && arg !== null) {\n        try {\n          return JSON.parse(JSON.stringify(arg));\n        } catch (e) {\n          return String(arg);\n        }\n      }\n      return arg;\n    });\n  } catch (e) {\n    return [String(args)];\n  }\n}\n\nfunction sendConsoleToParent(level, args) {\n  try {\n    window.parent.postMessage({\n      type: \'iframe-console-log\',\n      level: level,\n      args: serializeConsoleArgs(args),\n      timestamp: new Date().toISOString(),\n      url: window.location.href,\n    }, \'*\');\n  } catch (e) {}\n}\n\nvar originalConsoleError = console.error.bind(console);\nconsole.error = function() {\n  var args = Array.from(arguments);\n  originalConsoleError.apply(console, args);\n  sendConsoleToParent(\'error\', args);\n};\n\nwindow.addEventListener(\'error\', function(event) {\n  sendConsoleToParent(\'error\', [{\n    message: event.message,\n    filename: event.filename,\n    lineno: event.lineno,\n    colno: event.colno,\n    error: event.error ? {\n      message: event.error.message,\n      stack: event.error.stack,\n      name: event.error.name,\n    } : null,\n  }]);\n});\n\nwindow.addEventListener(\'unhandledrejection\', function(event) {\n  sendConsoleToParent(\'error\', [{\n    message: \'Unhandled Promise Rejection\',\n    reason: event.reason ? String(event.reason) : \'Unknown\',\n    error: event.reason instanceof Error ? {\n      message: event.reason.message,\n      stack: event.reason.stack,\n      name: event.reason.name,\n    } : null,\n  }]);\n});\n</` + `script>`;\n      }\n\n      function injectCSP(html, cspValue) {\n        const cspMeta = \'<meta http-equiv="Content-Security-Policy" content="\' + cspValue + \'">\';\n        const violationListener = buildViolationListenerScript();\n        const injection = cspMeta + violationListener;\n\n        if (html.includes("<head>")) {\n          return html.replace("<head>", "<head>" + injection);\n        } else if (html.includes("<HEAD>")) {\n          return html.replace("<HEAD>", "<HEAD>" + injection);\n        } else if (html.includes("<html>")) {\n          return html.replace("<html>", "<html><head>" + injection + "</head>");\n        } else if (html.includes("<HTML>")) {\n          return html.replace("<HTML>", "<HTML><head>" + injection + "</head>");\n        } else if (html.includes("<!DOCTYPE") || html.includes("<!doctype")) {\n          return html.replace(/(<!DOCTYPE[^>]*>|<!doctype[^>]*>)/i, "$1<head>" + injection + "</head>");\n        } else {\n          return injection + html;\n        }\n      }\n\n      // Query params from host (csp_mode, permissions, widget_csp). AppFrame only\n      // sends { html, csp } in sandbox-resource-ready; we carry the rest on the URL.\n      // Blob URLs cannot reliably carry search params, so the CDN shell injects\n      // window.__SANDBOX_SEARCH__ via buildSandboxProxyBlobHtml.\n      const query = new URLSearchParams(\n        typeof window.__SANDBOX_SEARCH__ === "string"\n          ? window.__SANDBOX_SEARCH__\n          : location.search\n      );\n      const queryCspMode = query.get("csp_mode") || "permissive";\n      let queryPermissions = null;\n      let queryWidgetCsp = null;\n      try {\n        const rawPerm = query.get("permissions");\n        if (rawPerm) queryPermissions = JSON.parse(rawPerm);\n      } catch (e) {}\n      try {\n        const rawCsp = query.get("widget_csp");\n        if (rawCsp) queryWidgetCsp = JSON.parse(rawCsp);\n      } catch (e) {}\n\n      const inner = document.createElement("iframe");\n      inner.style = "width:100%; height:100%; border:none;";\n      inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");\n      document.body.appendChild(inner);\n\n      window.addEventListener("message", async (event) => {\n        if (event.source === window.parent) {\n          if (event.data && event.data.method === "ui/notifications/sandbox-resource-ready") {\n            const params = event.data.params || {};\n            const html = params.html;\n            const sandbox = params.sandbox;\n            // Prefer message csp when present; fall back to URL widget_csp\n            const csp = params.csp != null ? params.csp : queryWidgetCsp;\n            const permissions = params.permissions != null ? params.permissions : queryPermissions;\n            const permissive =\n              typeof params.permissive === "boolean"\n                ? params.permissive\n                : queryCspMode === "permissive";\n            if (typeof sandbox === "string") {\n              inner.setAttribute("sandbox", sandbox);\n            }\n            const allowAttribute = buildAllowAttribute(permissions);\n            if (allowAttribute) {\n              inner.setAttribute("allow", allowAttribute);\n            }\n            if (typeof html === "string") {\n              if (permissive) {\n                const permissiveCsp = [\n                  "default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob: filesystem: about:",\n                  "script-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:",\n                  "style-src * \'unsafe-inline\' data: blob:",\n                  "img-src * data: blob: https: http:",\n                  "media-src * data: blob: https: http:",\n                  "font-src * data: blob: https: http:",\n                  "connect-src * data: blob: https: http: ws: wss: about:",\n                  "frame-src * data: blob: https: http: about:",\n                  "object-src * data: blob:",\n                  "base-uri *",\n                  "form-action *",\n                ].join("; ");\n                const processedHtml = injectCSP(html, permissiveCsp);\n                inner.srcdoc = processedHtml;\n              } else {\n                const cspValue = buildCSP(csp);\n                const processedHtml = injectCSP(html, cspValue);\n                inner.srcdoc = processedHtml;\n              }\n            }\n          } else {\n            if (inner && inner.contentWindow) {\n              inner.contentWindow.postMessage(event.data, "*");\n            }\n          }\n        } else if (event.source === inner.contentWindow) {\n          window.parent.postMessage(event.data, "*");\n        }\n      });\n\n      window.parent.postMessage({\n        jsonrpc: "2.0",\n        method: "ui/notifications/sandbox-proxy-ready",\n        params: {},\n      }, "*");\n    </script>\n  </body>\n</html>';

/**
 * Build sandbox-proxy HTML for a Blob URL, injecting search params that Blob
 * URLs cannot carry reliably.
 *
 * JSON-escapes the search string (incl. `<` → `\\u003c`) so it cannot break
 * out of the inline script tag.
 */
export function buildSandboxProxyBlobHtml(search: string): string {
  const escaped = JSON.stringify(search).replace(/</g, "\\u003c");
  const inject =
    "<script>window.__SANDBOX_SEARCH__ = " + escaped + ";</script>";
  return SANDBOX_PROXY_HTML.replace("<body>", "<body>" + inject);
}
