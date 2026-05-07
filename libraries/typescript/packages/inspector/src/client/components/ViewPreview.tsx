/**
 * ViewPreview — chromeless preview route for the screenshot CLI.
 *
 * Renders a single MCP Apps view in fullscreen mode against an MCP server,
 * sets `body[data-view-ready="true"]` once the view has rendered + fonts have
 * loaded + two animation frames have elapsed.
 *
 * Reached via `/inspector/preview/:view?props=<base64>&theme=...&server=...`.
 *
 * `props` is a base64-encoded JSON object of shape:
 *   { toolInput?, toolOutput? }
 *
 * `server` is optional; when omitted, defaults to `<origin>/mcp` (the dev
 * server's MCP endpoint).
 */

import { useMcpClient } from "mcp-use/react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { MCPAppsRenderer } from "./MCPAppsRenderer";

const PREVIEW_SERVER_ID = "preview-default";

interface PreviewProps {
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

function decodeProps(raw: string | null): PreviewProps {
  if (!raw) return {};
  try {
    const json = atob(raw);
    const parsed = JSON.parse(json) as PreviewProps;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Fall through to empty
  }
  return {};
}

function findResourceUri(
  resources: { uri: string; name?: string }[],
  view: string
): string | undefined {
  // ui://widget/<view>.html or ui://widget/<view>.<buildId>.html.
  // Match by URI prefix; fall back to name match.
  const prefix = `ui://widget/${view}`;
  const byUri = resources.find(
    (r) => r.uri.startsWith(`${prefix}.`) && r.uri.endsWith(".html")
  );
  if (byUri) return byUri.uri;
  return resources.find((r) => r.name === view)?.uri;
}

export function ViewPreview() {
  const params = useParams<{ view: string }>();
  const [search] = useSearchParams();
  const view = params.view ?? "";

  const previewProps = useMemo(
    () => decodeProps(search.get("props")),
    [search]
  );

  const serverUrl = useMemo(() => {
    const fromQuery = search.get("server");
    if (fromQuery) return fromQuery;
    return `${window.location.origin}/mcp`;
  }, [search]);

  // Forwarded headers from the screenshot CLI (`?headers=<base64 JSON>`),
  // so the preview can authenticate against a remote MCP server. This is
  // a temporary plumb until the CLI grows a full auth-aware MCP client.
  const previewHeaders = useMemo(() => {
    const raw = search.get("headers");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(atob(raw));
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, string>;
      }
    } catch {
      // Fall through.
    }
    return undefined;
  }, [search]);

  const { servers, addServer, storageLoaded } = useMcpClient();
  const server = servers.find((s) => s.id === PREVIEW_SERVER_ID);

  // Add the preview server once storage has loaded (so we don't fight
  // LocalStorageProvider rehydration).
  useEffect(() => {
    if (!storageLoaded) return;
    addServer(PREVIEW_SERVER_ID, {
      url: serverUrl,
      name: "Preview",
      ...(previewHeaders ? { headers: previewHeaders } : {}),
    });
  }, [storageLoaded, serverUrl, previewHeaders, addServer]);

  const ready = server?.state === "ready";
  const failed = server?.state === "failed";

  const resourceUri = useMemo(() => {
    if (!ready) return undefined;
    return findResourceUri(server.resources, view);
  }, [ready, server?.resources, view]);

  const toolCallId = useMemo(
    () => `preview-${view}-${Date.now().toString(36)}`,
    [view]
  );

  // Wrap server.readResource so it satisfies MCPAppsRenderer's signature
  // (which expects a function, not a possibly-undefined method).
  const readResource = useMemo(() => {
    return async (uri: string) => {
      if (!server?.readResource) {
        throw new Error("Server not ready");
      }
      return server.readResource(uri);
    };
  }, [server]);

  const [rendererReady, setRendererReady] = useState(false);

  // Once the renderer signals readiness (iframe load + AppBridge handshake),
  // wait for fonts.ready then two rAF ticks and flip the body data attr.
  useEffect(() => {
    if (!rendererReady) return;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts API may be unavailable; proceed anyway
      }
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      if (cancelled) return;
      document.body.setAttribute("data-view-ready", "true");
    })();
    return () => {
      cancelled = true;
      document.body.removeAttribute("data-view-ready");
    };
  }, [rendererReady]);

  // Make the preview page fill the viewport with no scroll/margins so the
  // rendered view occupies exactly width × height.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlMargin = html.style.margin;
    const prevBodyMargin = body.style.margin;
    const prevBodyOverflow = body.style.overflow;
    html.style.margin = "0";
    body.style.margin = "0";
    body.style.overflow = "hidden";
    return () => {
      html.style.margin = prevHtmlMargin;
      body.style.margin = prevBodyMargin;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  if (failed) {
    return (
      <div style={{ padding: 16, fontFamily: "monospace", color: "#b00" }}>
        Failed to connect to MCP server at {serverUrl}.
      </div>
    );
  }

  if (!ready || !resourceUri) {
    if (ready && !resourceUri) {
      return (
        <div style={{ padding: 16, fontFamily: "monospace", color: "#b00" }}>
          View "{view}" not found on {serverUrl}.
        </div>
      );
    }
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          color: "var(--muted-foreground, #888)",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <MCPAppsRenderer
        serverId={PREVIEW_SERVER_ID}
        toolCallId={toolCallId}
        toolName={view}
        toolInput={previewProps.toolInput}
        toolOutput={previewProps.toolOutput}
        resourceUri={resourceUri}
        readResource={readResource}
        displayMode="fullscreen"
        noWrapper
        chromeless
        onReady={() => setRendererReady(true)}
      />
    </div>
  );
}
